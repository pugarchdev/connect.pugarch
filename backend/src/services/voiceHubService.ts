import axios from 'axios';
import crypto from 'node:crypto';
import { logger } from '../config/logger';
import { normalizePhoneNumber } from '../utils/phoneUtils';

export interface GrievanceVoiceCallParams {
  grievance: any;
  admin: any;
  departmentName?: string;
  subDepartmentName?: string;
  language?: string;
}

export interface VoiceHubCallbackBody {
  event?: 'call.dtmf' | 'call.missed' | string;
  callId?: string;
  referenceId?: string;
  portalId?: string;
  portalName?: string | null;
  phone?: string;
  digitPressed?: string | null;
  actionType?: string | null;
  actionLabel?: string | null;
  actionKey?: string | null;
  actionPayload?: Record<string, unknown> | null;
  variables?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  status?: string;
  hangupCause?: string | null;
  plivoCallUuid?: string | null;
  timestamp?: string;
}

export function toE164IndianPhone(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;
  const normalized = normalizePhoneNumber(String(rawPhone));
  const e164 = normalized.startsWith('+') ? normalized : `+${normalized}`;
  if (!/^\+91[6-9]\d{9}$/.test(e164)) {
    return null;
  }
  return e164;
}

export function verifyVoiceHubSignature(
  rawBody: Buffer | string | undefined,
  signatureHeader: string | undefined
): boolean {
  const secret = process.env.VOICE_HUB_CALLBACK_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  if (!rawBody || !signatureHeader) {
    return false;
  }
  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signatureHeader.trim(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export async function triggerGrievanceVoiceCall(
  params: GrievanceVoiceCallParams
): Promise<{ ok: boolean; skipped?: boolean; callId?: string; reason?: string }> {
  const enabled = process.env.VOICE_HUB_ENABLED === 'true';
  if (!enabled) {
    return { ok: false, skipped: true, reason: 'VOICE_HUB_ENABLED is not true' };
  }

  const baseUrl = process.env.VOICE_HUB_BASE_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.VOICE_HUB_API_KEY?.trim();
  const callbackUrl = process.env.VOICE_HUB_CALLBACK_URL?.trim();

  if (!baseUrl || !apiKey) {
    logger.warn('[VoiceHub] Missing VOICE_HUB_BASE_URL or VOICE_HUB_API_KEY; skipping voice call.');
    return { ok: false, skipped: true, reason: 'Voice Hub credentials missing' };
  }

  const e164Phone = toE164IndianPhone(params.admin?.phone);
  if (!e164Phone) {
    logger.warn(`[VoiceHub] Invalid admin phone for voice call: ${params.admin?.phone ?? 'n/a'}`);
    return { ok: false, skipped: true, reason: 'Invalid E.164 phone' };
  }

  const grievance = params.grievance;
  const grievanceObjectId = String(grievance?._id || grievance?.id || '');
  const grievanceCode = String(grievance?.grievanceId || grievanceObjectId || 'New');
  const adminName =
    `${params.admin?.firstName || ''} ${params.admin?.lastName || ''}`.trim() || 'Officer';
  const departmentName = params.departmentName || grievance?.category || 'Department';
  const citizenName = grievance?.citizenName || 'a citizen';
  const rawLang = String(params.language || grievance?.language || 'en').toLowerCase();
  const ttsLanguage = rawLang === 'hi' ? 'hi-IN' : 'en-IN';

  const message =
    ttsLanguage === 'hi-IN'
      ? `नमस्ते ${adminName}। ${departmentName} विभाग में ${citizenName} द्वारा नई शिकायत दर्ज की गई है। व्हाट्सएप पर विवरण प्राप्त करने के लिए 1 दबाएं। उच्च अधिकारी को भेजने के लिए 2 दबाएं। दोबारा सुनने के लिए 9 दबाएं।`
      : `Hello ${adminName}. New ${departmentName} grievance received from ${citizenName}. Press 1 to acknowledge and receive details on WhatsApp. Press 2 to escalate to supervisor. Press 9 to repeat.`;

  const timeoutMs = Number(process.env.VOICE_HUB_TIMEOUT_MS || 5000);
  const adminId = String(params.admin?._id || params.admin?.id || e164Phone);

  try {
    const response = await axios.post(
      `${baseUrl}/api/v1/calls`,
      {
        phone: e164Phone,
        message,
        language: ttsLanguage,
        voice: 'Polly.Aditi',
        reference_id: grievanceObjectId || grievanceCode,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        idempotency_key: `sahaj:grv:${grievanceObjectId || grievanceCode}:${adminId}`,
        variables: {
          adminName,
          departmentName,
          citizenName,
          grievanceCode,
        },
        metadata: {
          grievanceObjectId: grievanceObjectId || undefined,
          grievanceId: grievanceCode,
          companyId: grievance?.companyId ? String(grievance.companyId) : undefined,
          adminUserId: params.admin?._id ? String(params.admin._id) : undefined,
          language: rawLang,
        },
      },
      {
        timeout: Number.isFinite(timeoutMs) ? timeoutMs : 5000,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
      }
    );

    logger.info(
      `[VoiceHub] Outbound call queued callId=${response.data?.id} grievance=${grievanceCode} phone=${e164Phone}`
    );
    return { ok: true, callId: response.data?.id };
  } catch (error: any) {
    logger.error(
      `[VoiceHub] Failed to trigger voice call for grievance ${grievanceCode}: ${
        error?.response?.data?.message || error?.message || error
      }`
    );
    return { ok: false, reason: error?.message || 'Voice Hub API error' };
  }
}
