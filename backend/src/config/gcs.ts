import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

const storageOptions: any = {
  projectId: process.env.GCP_PROJECT_ID,
};

/**
 * Safely parse service account JSON across varied deployment environments
 * (escaped newlines, surrounding quotes, or base64 encoding).
 */
const parseServiceAccountJson = (raw: string): any => {
  let trimmed = raw.trim();

  // Strip enclosing quotes if passed like '"..."' or "''"
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // Attempt base64 decode if string doesn't start with '{'
  if (!trimmed.startsWith('{')) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf-8').trim();
      if (decoded.startsWith('{')) {
        trimmed = decoded;
      }
    } catch {
      // Not base64 encoded
    }
  }

  const parsed = JSON.parse(trimmed);

  // Restore real newlines in private_key if escaped as literal \n
  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
};

// 1. Try environment-variable-based credentials (used on Vercel or when provided)
const rawSaJson = process.env.GCP_SERVICE_ACCOUNT_JSON;
if (rawSaJson && rawSaJson.trim() && rawSaJson.trim() !== 'undefined' && rawSaJson.trim() !== 'null') {
  try {
    storageOptions.credentials = parseServiceAccountJson(rawSaJson);
    logger.info('🔑 Using GCS credentials from GCP_SERVICE_ACCOUNT_JSON environment variable');
  } catch (err: any) {
    logger.warn(`⚠️ Could not parse GCP_SERVICE_ACCOUNT_JSON (${err.message}). Falling back to Application Default Credentials (ADC) or key file.`);
  }
}

// 2. If no valid credentials from environment variable, check for a key file on disk
if (!storageOptions.credentials) {
  const customKeyPath = process.env.GCP_KEY_FILE_PATH ? path.resolve(process.cwd(), process.env.GCP_KEY_FILE_PATH) : null;
  const defaultKeyPath = path.resolve(process.cwd(), 'gcs-service-account.json');

  if (customKeyPath && fs.existsSync(customKeyPath)) {
    storageOptions.keyFilename = customKeyPath;
    logger.info(`📂 Using GCS credentials from key file: ${customKeyPath}`);
  } else if (fs.existsSync(defaultKeyPath)) {
    storageOptions.keyFilename = defaultKeyPath;
    logger.info(`📂 Using GCS credentials from default key file: ${defaultKeyPath}`);
  } else {
    // On Google Cloud Run, Compute Engine, or GKE, the client library automatically
    // discovers credentials from the GCP metadata server via Application Default Credentials (ADC).
    logger.info('☁️ No local service account key file found; using Google Application Default Credentials (ADC)');
  }
}

const storage = new Storage(storageOptions);

export const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || 'chatbot-media-storage-490106');

/**
 * Ensures the GCS bucket exists, has correct CORS, and is configured for public access.
 * Non-blocking and error-tolerant so that metadata conflicts (e.g. concurrent code 9)
 * or IAM restrictions do not crash the service.
 */
export const configureGCS = async (): Promise<void> => {
  try {
    const [exists] = await bucket.exists();
    if (!exists) {
      logger.info(`🏗️ Creating GCS bucket: ${bucket.name}`);
      try {
        await bucket.create({
          location: 'ASIA', // Optimized for India (JHARSGUDA context)
          storageClass: 'STANDARD',
        });
        logger.info(`✅ GCS bucket ${bucket.name} created`);
      } catch (createErr: any) {
        logger.warn(`⚠️ Could not create GCS bucket ${bucket.name}: ${createErr.message}`);
      }
    }

    // Configure CORS (isolated with try/catch to gracefully handle concurrent update code 9)
    try {
      logger.info(`⚙️ Configuring CORS for ${bucket.name}...`);
      await bucket.setCorsConfiguration([
        {
          maxAgeSeconds: 3600,
          method: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
          origin: ['*'], // Allow all origins for the portal dashboard
          responseHeader: [
            'Content-Type',
            'Authorization',
            'Content-Length',
            'User-Agent',
            'x-goog-resumable',
            'ETag',
          ],
        },
      ]);
      logger.info(`✅ GCS CORS configured for ${bucket.name}`);
    } catch (corsErr: any) {
      logger.warn(`⚠️ Non-fatal: Could not update CORS for ${bucket.name} (might have concurrent metadata update or IAM restriction): ${corsErr.message}`);
    }

    // Ensure public read access (isolated with try/catch for Uniform Bucket-Level Access)
    try {
      await bucket.makePublic();
      logger.info(`🔓 GCS bucket ${bucket.name} is now public (allUsers: Storage Object Viewer)`);
    } catch (e: any) {
      logger.warn(`⚠️ Non-fatal: Could not make bucket public (might already be public or Uniform Bucket-Level Access is enforced): ${e.message}`);
    }

    logger.info(`✅ GCS configuration check completed for ${bucket.name}`);
  } catch (error: any) {
    logger.warn(`⚠️ Non-fatal GCS initialization warning: ${error.message}`);
  }
};

export default storage;