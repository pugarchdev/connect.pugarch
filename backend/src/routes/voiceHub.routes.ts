import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireDatabaseConnection } from '../middleware/dbConnection';
import Grievance from '../models/Grievance';
import User from '../models/User';
import { logger } from '../config/logger';
import {
  getAdminRecipients,
  triggerGrievanceEvent,
} from '../services/grievanceTemplateTriggerService';
import { getHierarchicalDepartmentAdmins } from '../services/notificationService';
import { notifyCompanyAdmins } from '../services/inAppNotificationService';
import {
  verifyVoiceHubSignature,
  type VoiceHubCallbackBody,
} from '../services/voiceHubService';
import { normalizePhoneNumber } from '../utils/phoneUtils';

const router = express.Router();

type RawBodyRequest = Request & { rawBody?: Buffer };

function extractMediaAttachments(grievance: any) {
  const mediaList = Array.isArray(grievance?.media) ? grievance.media : [];
  return mediaList
    .filter((item: any) => Boolean(item?.url))
    .map((item: any) => ({
      url: String(item.url),
      type: (item.type === 'video' || item.type === 'document' ? item.type : 'image') as
        | 'image'
        | 'video'
        | 'document',
    }));
}

router.post('/', requireDatabaseConnection, async (req: RawBodyRequest, res: Response) => {
  try {
    const signature = req.header('x-voicehub-signature');
    const rawPayload = req.rawBody ?? JSON.stringify(req.body ?? {});

    if (!verifyVoiceHubSignature(rawPayload, signature)) {
      logger.warn('[VoiceHubCallback] Rejected callback due to invalid X-VoiceHub-Signature');
      return res.status(401).json({ success: false, message: 'Invalid Voice Hub signature' });
    }

    const body = (req.body ?? {}) as VoiceHubCallbackBody;
    const event = body.event || 'call.dtmf';
    const callId = String(body.callId || '').trim();
    const digitPressed = body.digitPressed ? String(body.digitPressed).trim() : null;
    const actionType = body.actionType ? String(body.actionType).toUpperCase() : null;
    const actionPayload =
      body.actionPayload && typeof body.actionPayload === 'object' ? body.actionPayload : {};
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

    const grievanceLookupId = String(
      metadata.grievanceObjectId || body.referenceId || ''
    ).trim();

    if (!grievanceLookupId) {
      return res.status(400).json({ success: false, message: 'Missing grievance referenceId' });
    }

    const grievanceQuery = mongoose.Types.ObjectId.isValid(grievanceLookupId)
      ? { _id: grievanceLookupId }
      : { grievanceId: grievanceLookupId };

    const grievance = await Grievance.findOne(grievanceQuery)
      .populate('departmentId', 'name')
      .populate('subDepartmentId', 'name');

    if (!grievance) {
      logger.warn(`[VoiceHubCallback] Grievance not found for reference=${grievanceLookupId}`);
      return res.status(404).json({ success: false, message: 'Grievance not found' });
    }

    // Idempotency check against timeline entries
    const dedupKey = `${callId}:${event}:${digitPressed ?? 'none'}`;
    const alreadyProcessed = Array.isArray(grievance.timeline)
      ? grievance.timeline.some(
          (entry: any) => entry?.details?.voiceHubDedupKey === dedupKey
        )
      : false;

    if (alreadyProcessed) {
      return res.status(200).json({ ok: true, deduplicated: true, callId });
    }

    // Resolve officer/admin
    let admin: any = null;
    if (metadata.adminUserId && mongoose.Types.ObjectId.isValid(String(metadata.adminUserId))) {
      admin = await User.findById(metadata.adminUserId).lean();
    }
    if (!admin && body.phone) {
      const normalized = normalizePhoneNumber(body.phone);
      admin = await User.findOne({
        companyId: grievance.companyId,
        $or: [{ phone: normalized }, { phone: body.phone }],
      }).lean();
    }

    const deptName = (grievance.departmentId as any)?.name || grievance.category || 'Department';
    const subDeptName = (grievance.subDepartmentId as any)?.name;
    const media = extractMediaAttachments(grievance);

    if (event === 'call.missed') {
      grievance.timeline.push({
        action: 'VOICE_CALL_MISSED',
        details: {
          voiceHubDedupKey: dedupKey,
          callId,
          status: body.status,
          hangupCause: body.hangupCause,
          phone: body.phone,
        },
        performedBy: admin?._id,
        timestamp: new Date(),
      });
      await grievance.save();
      return res.status(200).json({ ok: true, action: 'VOICE_CALL_MISSED', callId });
    }

    // Plug & Play Action Dispatch (supports configured actionType or fallback digit)
    const resolvedAction =
      actionType ||
      (digitPressed === '1'
        ? 'WHATSAPP_DISPATCH'
        : digitPressed === '2'
          ? 'ESCALATE'
          : digitPressed === '0'
            ? 'OPT_OUT'
            : 'CALLBACK_WEBHOOK');

    if (resolvedAction === 'WHATSAPP_DISPATCH') {
      const targetPhone = admin?.phone || (body.phone ? normalizePhoneNumber(body.phone) : null);
      if (targetPhone && actionPayload.resendMedia !== false) {
        await triggerGrievanceEvent({
          eventKey: 'GRIEVANCE_CREATED',
          companyId: grievance.companyId,
          grievance,
          department: { name: deptName },
          subDept: subDeptName ? { name: subDeptName } : undefined,
          recipientPhones: [targetPhone],
          admin: admin || undefined,
          citizenPhone: grievance.citizenPhone,
          language: grievance.language,
          media: media.length > 0 ? media : undefined,
          buttonParam: 'https://sahaj.pugarch.in/',
        });
      }

      grievance.timeline.push({
        action: 'VOICE_ACKNOWLEDGED',
        details: {
          voiceHubDedupKey: dedupKey,
          callId,
          digitPressed,
          actionKey: body.actionKey,
          resentWhatsApp: Boolean(targetPhone),
        },
        performedBy: admin?._id,
        timestamp: new Date(),
      });
      await grievance.save();

      return res.status(200).json({ ok: true, action: 'VOICE_ACKNOWLEDGED', callId });
    }

    if (resolvedAction === 'ESCALATE') {
      const deptId = grievance.subDepartmentId || grievance.departmentId;
      let supervisorPhones: string[] = [];

      if (deptId) {
        const hierarchyAdmins = await getHierarchicalDepartmentAdmins(deptId);
        supervisorPhones = hierarchyAdmins
          .filter((u: any) => !admin || String(u._id) !== String(admin._id))
          .map((u: any) => normalizePhoneNumber(u.phone))
          .filter(Boolean);
      }
      if (supervisorPhones.length === 0) {
        const companyAdmins = await getAdminRecipients(grievance.companyId);
        supervisorPhones = companyAdmins
          .map((a) => a.phone)
          .filter((p) => !admin?.phone || p !== normalizePhoneNumber(admin.phone));
      }

      if (supervisorPhones.length > 0) {
        await triggerGrievanceEvent({
          eventKey: 'GRIEVANCE_CREATED',
          companyId: grievance.companyId,
          grievance,
          department: { name: deptName },
          subDept: subDeptName ? { name: subDeptName } : undefined,
          recipientPhones: supervisorPhones,
          citizenPhone: grievance.citizenPhone,
          language: grievance.language,
          remarks: `Escalated via Voice Call keypress ${digitPressed ?? '2'}`,
          media: media.length > 0 ? media : undefined,
          buttonParam: 'https://sahaj.pugarch.in/',
        });
      }

      await notifyCompanyAdmins({
        companyId: grievance.companyId,
        eventType: 'GRIEVANCE_REMINDER',
        title: 'Grievance Escalated via Voice Call',
        message: `Grievance ${grievance.grievanceId} was escalated via IVR keypress by ${
          admin ? `${admin.firstName || ''} ${admin.lastName || ''}`.trim() : body.phone || 'Officer'
        }.`,
        grievanceId: grievance.grievanceId,
        grievanceObjectId: grievance._id,
        meta: { callId, digitPressed },
      });

      if (actionPayload.flagGrievance !== false) {
        grievance.isFlagged = true;
      }
      grievance.timeline.push({
        action: 'VOICE_ESCALATED',
        details: {
          voiceHubDedupKey: dedupKey,
          callId,
          digitPressed,
          actionKey: body.actionKey,
          notifiedSupervisors: supervisorPhones.length,
        },
        performedBy: admin?._id,
        timestamp: new Date(),
      });
      await grievance.save();

      return res.status(200).json({ ok: true, action: 'VOICE_ESCALATED', callId });
    }

    // Generic / OPT_OUT / Custom Webhook logging
    grievance.timeline.push({
      action: `VOICE_${resolvedAction}`,
      details: {
        voiceHubDedupKey: dedupKey,
        callId,
        digitPressed,
        actionKey: body.actionKey,
        actionPayload,
      },
      performedBy: admin?._id,
      timestamp: new Date(),
    });
    await grievance.save();

    return res.status(200).json({ ok: true, action: resolvedAction, callId });
  } catch (error: any) {
    logger.error('[VoiceHubCallback] Failed processing callback:', error);
    return res.status(500).json({ success: false, message: error?.message || 'Callback error' });
  }
});

export default router;
