import { bucket } from '../config/gcs';
import { logger } from '../config/logger';
import axios from 'axios';
import { randomUUID } from 'crypto';

const MIME_TYPE_MAP: Record<string, string> = {
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'pdf': 'application/pdf',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'mp4': 'video/mp4',
  'csv': 'text/csv'
};

function getProperContentType(fileName: string, currentType: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext && MIME_TYPE_MAP[ext]) {
    return MIME_TYPE_MAP[ext];
  }
  return currentType;
}

/**
 * Uploads a buffer to Google Cloud Storage
 * 
 * @param buffer The file buffer
 * @param fileName The name to store the file as
 * @param contentType The MIME type of the file
 * @param folder The folder in the bucket
 * @returns The public URL of the uploaded file
 */
export async function uploadBufferToGCS(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  folder: string = 'media'
): Promise<string | null> {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    const destination = `${folder}/${randomUUID()}_${fileName}`;
    try {
      const file = bucket.file(destination);
      
      const finalContentType = getProperContentType(fileName, contentType);

      try {
        await file.save(buffer, {
          contentType: finalContentType,
          public: true,
          metadata: {
            cacheControl: 'public, max-age=31536000',
          },
        });
      } catch (saveError: any) {
        if (saveError.message && (saveError.message.includes('uniform') || saveError.message.includes('ACL'))) {
          // Retry without ACL public: true since bucket has Uniform Bucket-Level Access
          await file.save(buffer, {
            contentType: finalContentType,
            metadata: {
              cacheControl: 'public, max-age=31536000',
            },
          });
        } else {
          throw saveError;
        }
      }

      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${destination.split('/').map(segment => encodeURIComponent(segment)).join('/')}`;
      logger.info(`✅ GCS upload success: ${publicUrl}`);
      return publicUrl;
    } catch (error: any) {
      attempt++;
      logger.error(`❌ GCS upload failed (Attempt ${attempt}/${maxAttempts}) for ${fileName}: ${error.message}`, {
        error: error.stack,
        bucket: bucket.name,
        destination
      });
      if (attempt >= maxAttempts) {
        logger.error(`🛑 GCS upload permanently failed after ${maxAttempts} attempts for ${fileName}`);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  return null;
}

/**
 * Downloads media from WhatsApp and uploads it to GCS
 * 
 * @param mediaId WhatsApp media ID
 * @param accessToken WhatsApp access token
 * @param fileName Desired filename
 * @param folder GCS folder
 * @returns Public URL or null
 */
export async function uploadWhatsAppMediaToGCS(
  mediaId: string,
  accessToken: string,
  fileName: string = 'media_file',
  folder: string = 'whatsapp_media'
): Promise<{ url: string; mimeType: string; originalName: string } | null> {
  try {
    if (!mediaId || !accessToken) {
      logger.error('❌ Missing mediaId or accessToken for GCS upload');
      return null;
    }

    // 1. Get media URL from WhatsApp API
    const mediaResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    logger.debug(`🔍 WhatsApp Media API Response:`, mediaResponse.data);
    const downloadUrl = mediaResponse.data.url;
    const mimeType = mediaResponse.data.mime_type || 'application/octet-stream';
    
    // 2. Download the media
    let fileResponse;
    try {
      logger.info(`📥 Downloading WhatsApp media from: ${downloadUrl.substring(0, 50)}...`);
      fileResponse = await axios.get(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'arraybuffer'
      });
    } catch (downloadErr: any) {
      logger.warn(`⚠️ Failed to download media with Authorization header, retrying without it... Error: ${downloadErr.message}`);
      // Fallback: Some signed URLs from Meta fail if the Authorization header is present
      fileResponse = await axios.get(downloadUrl, {
        responseType: 'arraybuffer'
      });
    }
    
    if (!fileResponse || !fileResponse.data) {
      throw new Error('Empty response received from WhatsApp media download');
    }

    const buffer = Buffer.from(fileResponse.data);
    logger.info(`✅ Downloaded ${buffer.length} bytes from WhatsApp`);
    
    // 3. Upload to GCS
    // Try to get a clean extension from our map, otherwise fallback to split
    let ext = 'bin';
    for (const [key, value] of Object.entries(MIME_TYPE_MAP)) {
      if (value === mimeType) {
        ext = key;
        break;
      }
    }
    
    // If not found in map, use the second part of mime type but keep it clean
    if (ext === 'bin' && mimeType.includes('/')) {
      ext = mimeType.split('/')[1].split('.').pop() || 'bin';
    }

    const finalFileName = fileName.includes('.') ? fileName : `${fileName}.${ext}`;
    
    logger.info(`📤 Uploading to GCS: folder=${folder}, file=${finalFileName}, mime=${mimeType}`);
    const cloudUrl = await uploadBufferToGCS(buffer, finalFileName, mimeType, folder);
    
    if (!cloudUrl) {
      logger.error(`❌ GCS upload returned null for ${finalFileName}`);
      return null;
    }

    return {
      url: cloudUrl,
      mimeType,
      originalName: fileName
    };
  } catch (error: any) {
    if (error.response) {
      logger.error(`❌ WhatsApp media to GCS failed (API Error): Status ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
    } else {
      logger.error(`❌ WhatsApp media to GCS failed: ${error.message}`, { stack: error.stack });
    }
    return null;
  }
}

/**
 * Generates a public URL or signed URL for a file in GCS.
 * Since the user requested to use public URLs provided by GCP, we will prioritize
 * returning the public storage.googleapis.com URL.
 * 
 * @param urlOrPath The public URL or raw path in the bucket
 * @param expiresMinutes How long the URL should be valid (default 60 mins) - ignored if returning public URL
 */
export async function getSignedUrl(urlOrPath: string, expiresMinutes: number = 60): Promise<string> {
  try {
    if (!urlOrPath) return '';
    
    // Only attempt to process if it's a GCS URL or a raw path
    const isGcsUrl = urlOrPath.includes('storage.googleapis.com') || (bucket.name && urlOrPath.includes(bucket.name));
    const isRawPath = !urlOrPath.startsWith('http') && (urlOrPath.includes('/') || urlOrPath.includes('.'));

    if (!isGcsUrl && !isRawPath) {
      return urlOrPath;
    }

    let filePath = urlOrPath;
    if (isGcsUrl) {
      // 1. Handle gs:// protocol
      if (urlOrPath.startsWith('gs://')) {
        const pathParts = urlOrPath.replace('gs://', '').split('/');
        pathParts.shift(); // Remove bucket name
        filePath = pathParts.join('/');
      } 
      // 2. Handle storage.googleapis.com URL
      else {
        const urlWithoutParams = urlOrPath.split('?')[0];
        const parts = urlWithoutParams.split(`${bucket.name}/`);
        
        if (parts.length > 1) {
          filePath = decodeURIComponent(parts[1]);
        } else {
          const storageParts = urlWithoutParams.split('storage.googleapis.com/');
          if (storageParts.length > 1) {
            const pathWithBucket = decodeURIComponent(storageParts[1]);
            const pathParts = pathWithBucket.split('/');
            pathParts.shift(); // Remove bucket name
            filePath = pathParts.join('/');
          }
        }
      }
    }

    // Construct the public URL instead of a signed URL
    // This ensures visibility if the bucket/objects are public and avoids signing overhead/errors.
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath.split('/').map(segment => encodeURIComponent(segment)).join('/')}`;
    
    // logger.debug(`🔗 Generated public GCS URL: ${publicUrl}`);
    return publicUrl;
  } catch (error: any) {
    logger.error(`❌ Failed to generate public GCS URL for ${urlOrPath}: ${error.message}`);
    return urlOrPath;
  }
}