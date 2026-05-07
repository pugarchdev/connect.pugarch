import mongoose from 'mongoose';
import moment from 'moment-timezone';
import User from '../models/User';
import Company from '../models/Company';
import CompanyWhatsAppConfig from '../models/CompanyWhatsAppConfig';
import CitizenProfile from '../models/CitizenProfile';
import Role from '../models/Role';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import { sendWhatsAppTemplate, sendMediaSequentially } from './whatsappService';
import { sendGrievanceToAdmin, sendTemplateAndAttachments, WhatsAppAttachment } from './whatsapp/grievanceNotificationFlow.service';
import { buildCitizenMessage, getCitizenStatusLabel } from './citizenMessageBuilder';
import { sanitizeGrievanceDetailsForTemplate, sanitizeNote, sanitizeRemarks, sanitizeText } from '../utils/sanitize';
import { normalizeLanguage } from './templateValidationService';
import { normalizePhoneNumber } from '../utils/phoneUtils';
import { formatTemplateDateTime } from '../utils/templateDateTime';
import { NotificationContextService } from './notificationContextService';
import { TemplateResolverService } from './templateResolverService';
import { logger } from '../config/logger';

export function formatTemplateDate(date: Date = new Date()): string {
  return formatTemplateDateTime(date, 'en-IN');
}

function sanitizeTemplateDataValue(key: string, value: string): string {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey.includes('description') || normalizedKey.includes('grievance_details') || normalizedKey.includes('grievance_summary')) {
    return sanitizeGrievanceDetailsForTemplate(value, 1000);
  }

  if (normalizedKey.includes('url')) {
    return String(value || '').trim().substring(0, 255);
  }

  return sanitizeText(value, 100);
}

async function getCompanyWithConfig(companyId: any): Promise<any> {
  const [company, cfg] = await Promise.all([
    Company.findById(companyId).lean(),
    CompanyWhatsAppConfig.findOne({ companyId, isActive: true }).lean()
  ]);

  if (!company || !cfg) {
    throw new Error('Company WhatsApp config not found for template trigger');
  }

  return {
    ...company,
    _id: companyId,
    whatsappConfig: {
      phoneNumberId: cfg.phoneNumberId,
      accessToken: cfg.accessToken,
      businessAccountId: cfg.businessAccountId,
      rateLimits: cfg.rateLimits
    }
  };
}

export async function getAdminRecipients(companyId: any): Promise<Array<{ phone: string; name: string }>> {
  const companyAdminRoleIds = await Role.find({
    companyId,
    $or: [
      { key: { $in: ['COMPANY_ADMIN', 'COMPANY_HEAD'] } },
      { name: { $regex: /collector|head|commissioner/i } }
    ]
  }).distinct('_id');

  const admins = await User.find({
    companyId,
    isActive: true,
    'notificationSettings.whatsapp': { $ne: false }, 
    $or: [
      { isSuperAdmin: true },
      { level: 1 },
      { customRoleId: { $in: companyAdminRoleIds } }
    ]
  }).select('phone firstName lastName').lean();

  const unique = new Map<string, { phone: string; name: string }>();
  for (const admin of admins as any[]) {
    const phone = normalizePhoneNumber(admin.phone);
    if (!phone) continue;
    unique.set(phone, {
      phone,
      name: `${admin.firstName || ''} ${admin.lastName || ''}`.trim() || 'Officer'
    });
  }

  return Array.from(unique.values());
}

/**
 * NEW: Unified event-based trigger for the PugArch Connect Portal.
 * Handles multitenancy via dynamic template resolution.
 */
export async function triggerGrievanceEvent(options: {
  eventKey: string;
  companyId: any;
  grievance: any;
  recipientPhones?: string[];
  citizenPhone?: string;
  language?: string;
  admin?: any;
  remarks?: string;
  previousDept?: string;
  previousOffice?: string;
  newDept?: string;
  newOffice?: string;
  media?: any[];
  buttonParam?: string;
  department?: any;
  subDept?: any;
  submittedOn?: Date | string;
  reassignedOn?: Date | string;
}) {
  try {
    const companyIdStr = (options.companyId && typeof options.companyId === 'object' && options.companyId._id)
      ? options.companyId._id.toString()
      : options.companyId.toString();

    const company = await getCompanyWithConfig(companyIdStr);
    const language = normalizeLanguage(options.language);

    // 1. Build context
    const context = await NotificationContextService.buildGrievanceContext(options.grievance, {
      admin: options.admin,
      remarks: options.remarks,
      companyName: company.name,
      language,
      previousDept: options.previousDept,
      previousOffice: options.previousOffice,
      newDept: options.newDept,
      newOffice: options.newOffice,
      department: options.department,
      subDept: options.subDept,
      submittedOn: options.submittedOn,
      reassignedOn: options.reassignedOn
    });

    // 2. Resolve template
    const { templateName, values } = await TemplateResolverService.resolveTemplate(
      companyIdStr,
      options.eventKey.toUpperCase(),
      context,
      options.eventKey.toLowerCase() // Use key as fallback name
    );

    // 3. Determine recipients
    const finalPhones = options.recipientPhones?.length 
      ? options.recipientPhones 
      : await getAdminRecipients(companyIdStr);

    // 4. Send notifications
    logger.info(`📢 [Admin Event] Sending "${templateName}" template to ${finalPhones.length} admins for event: ${options.eventKey}`);
    
    // Normalize recipients to objects if they are strings
    const recipients: Array<{ phone: string; name: string }> = (finalPhones as any[]).map(p => {
      if (typeof p === 'string') {
        const adminName = options.admin?.fullName || 
                         (options.admin?.firstName ? `${options.admin.firstName}${options.admin.lastName ? ' ' + options.admin.lastName : ''}` : null);
        return { phone: p, name: adminName || 'Officer' };
      }
      return p as { phone: string; name: string };
    });

    const results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        // Update context with the REAL recipient name for this specific message
        const personalizedContext = { ...context, admin_name: recipient.name };
        
        // Resolve values again with the personalized name
        // (Note: this is efficient because resolveTemplate handles the heavy lifting once)
        const { values: personalizedValues } = await TemplateResolverService.resolveTemplate(
          companyIdStr,
          options.eventKey.toUpperCase(),
          personalizedContext,
          options.eventKey.toLowerCase()
        );

        // 5. Send Template (Text)
        const sendResult = await sendWhatsAppTemplate(
          company, 
          recipient.phone, 
          templateName, 
          personalizedValues, 
          language, 
          undefined, 
          options.buttonParam, 
          {
            recipientType: 'ADMIN',
            citizenPhone: options.citizenPhone || options.grievance?.citizenPhone
          }
        );

        // ⏳ Safety delay (1500ms) to ensure Text Template arrives BEFORE Media Templates in WhatsApp UI
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 6. Send All Media using approved media templates
        if (options.media && options.media.length > 0) {
          await sendMediaSequentially(company, recipient.phone, options.media, recipient.name);
        }

        return sendResult;
      })
    );

    return results;
  } catch (error: any) {
    logger.error(`triggerGrievanceEvent failed: ${error.message}`);
    throw error;
  }
}

/**
 * Legacy support for hardcoded triggers, refactored to use the new system internally where possible.
 */
export async function triggerAdminTemplate(options: {
  event: string;
  companyId: any;
  language?: string;
  values?: string[];
  data?: Record<string, string>;
  recipientPhones?: string[];
  citizenPhone?: string;
  grievance?: any;
}) {
  // If grievance is provided, we prefer the new event system
  if (options.grievance) {
    return triggerGrievanceEvent({
      eventKey: options.event,
      companyId: options.companyId,
      grievance: options.grievance,
      recipientPhones: options.recipientPhones,
      citizenPhone: options.citizenPhone,
      language: options.language,
      remarks: options.data?.remarks
    });
  }

  // Fallback to legacy behavior
  const company = await getCompanyWithConfig(options.companyId);
  const rawRecipients = options.recipientPhones?.length ? options.recipientPhones : await getAdminRecipients(options.companyId);
  const recipients = Array.from(
    new Set(
      rawRecipients
        .map((p: any) => normalizePhoneNumber(typeof p === 'string' ? p : p.phone))
        .filter((phone) => !options.citizenPhone || phone !== normalizePhoneNumber(options.citizenPhone))
        .filter(Boolean)
    )
  ) as string[];
  const language = normalizeLanguage(options.language);
  const safePayload = options.data || options.values || [];

  if (recipients.length === 0) return;

  return Promise.allSettled(
    recipients.map((to) => {
      return sendWhatsAppTemplate(company, to, options.event, safePayload, language, undefined, undefined, {
        recipientType: 'ADMIN',
        citizenPhone: options.citizenPhone
      });
    })
  );
}

export async function triggerCitizenTemplate(options: {
  template: string;
  companyId: any;
  citizenPhone: string;
  language?: string;
  values?: string[];
  data?: Record<string, string>;
  requireNotificationConsent?: boolean;
  mediaUrl?: string;
}) {
  const normalizedPhone = normalizePhoneNumber(options.citizenPhone);
  const rawPhone = String(options.citizenPhone || '').trim();
  const citizenProfile = await CitizenProfile.findOne({
    companyId: options.companyId,
    $or: [
      { phone_number: normalizedPhone },
      { phone_number: rawPhone },
      { phoneNumber: normalizedPhone },
      { phoneNumber: rawPhone }
    ]
  }).select('notification_consent notificationConsent').lean();

  const hasNotificationConsent = Boolean(
    citizenProfile?.notification_consent ?? citizenProfile?.notificationConsent
  );

  if (options.requireNotificationConsent && !hasNotificationConsent) {
    return {
      success: false,
      error: 'Citizen notification consent missing.'
    };
  }

  const company = await getCompanyWithConfig(options.companyId);
  const language = normalizeLanguage(options.language);
  const safePayload = options.data || options.values || [];

  return sendWhatsAppTemplate(company, normalizedPhone, options.template, safePayload, language, options.mediaUrl, undefined, {
    recipientType: 'CITIZEN',
    allowUnsubscribed: !options.requireNotificationConsent
  });
}

export async function triggerCitizenStatusTemplate(options: {
  companyId: any;
  citizenPhone: string;
  citizenName: string;
  grievanceId: string;
  departmentName: string;
  subDepartmentName?: string;
  grievanceSummary?: string;
  status: string;
  resolvedByName?: string;
  formattedResolvedDate?: string;
  remarks?: string;
  language?: string;
  media?: Array<{ url: string; type: 'image' | 'video' | 'document'; caption?: string; filename?: string }>;
  grievance?: any;
  requireNotificationConsent?: boolean;
}) {
  try {
    const companyIdStr = (options.companyId && typeof options.companyId === 'object' && options.companyId._id)
      ? options.companyId._id.toString()
      : options.companyId.toString();

    const status = options.status.toUpperCase();
    const eventKey = `GRIEVANCE_STATUS_${status}`;
    const language = normalizeLanguage(options.language);

    // 1. Build Context
    const context = await NotificationContextService.buildGrievanceContext(options.grievance || {
      grievanceId: options.grievanceId,
      citizenName: options.citizenName,
      citizenPhone: options.citizenPhone,
      description: options.grievanceSummary,
      status: options.status,
      remarks: options.remarks
    }, {
      admin: { fullName: options.resolvedByName || 'Administrator' },
      department: { name: options.departmentName },
      subDept: { name: options.subDepartmentName },
      remarks: options.remarks,
      language
    });

    // 2. Resolve Template and Values
    const { templateName, values } = await TemplateResolverService.resolveTemplate(
      companyIdStr,
      eventKey,
      context
    );

    // 3. Send the Status Template (Text-only)
    try {
      console.log(`📡 [Status Update] Sending template "${templateName}" to ${options.citizenPhone} for grievance ${options.grievanceId}`);
      await triggerCitizenTemplate({
        template: templateName,
        companyId: options.companyId,
        citizenPhone: options.citizenPhone,
        language,
        values,
        requireNotificationConsent: options.requireNotificationConsent
      });
      console.log(`✅ [Status Update] Text template "${templateName}" sent successfully to ${options.citizenPhone}`);
    } catch (templateErr: any) {
      logger.error(`⚠️ [Citizen Notification] Status text template failed: ${templateErr.message}. Proceeding to media...`);
    }

    // ⏳ Safety delay (500ms) to ensure Status Template arrives BEFORE Proof of Work in WhatsApp UI
    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. Send all Proof of Work using approved media templates
    if (options.media && options.media.length > 0) {
      const company = await getCompanyWithConfig(options.companyId);
      await sendMediaSequentially(
        company,
        options.citizenPhone,
        options.media,
        options.citizenName || 'Citizen',
        { allowUnsubscribed: true }
      ).catch(err => logger.error(`❌ [Citizen Media] Sequential send failed: ${err.message}`));
    }
  } catch (error: any) {
    logger.error(`❌ triggerCitizenStatusTemplate failed: ${error.message}`);
    throw error;
  }
}

export async function triggerGrievanceNotifications(options: {
  companyId: any;
  grievanceId: string;
  citizenName: string;
  citizenPhone: string;
  category: string;
  description?: string;
  status: string;
  subDepartmentName?: string;
  language?: string;
  assignedAdmins?: any[];
  companyAdmins?: any[];
  media?: Array<{ url: string; type: 'image' | 'video' | 'document'; caption?: string; filename?: string }>;
  grievance?: any;
  buttonParam?: string;
}) {
  const recipientPhones = (options.assignedAdmins || []).map(a => normalizePhoneNumber(a.phone)).filter(Boolean) as string[];

  return triggerGrievanceEvent({
    eventKey: 'GRIEVANCE_CREATED',
    companyId: options.companyId,
    grievance: options.grievance || {
      grievanceId: options.grievanceId,
      citizenName: options.citizenName,
      citizenPhone: options.citizenPhone,
      description: options.description,
      status: options.status,
    },
    recipientPhones: recipientPhones.length > 0 ? recipientPhones : undefined,
    citizenPhone: options.citizenPhone,
    language: options.language,
    media: options.media,
    buttonParam: options.buttonParam,
    department: { name: options.category },
    subDept: { name: options.subDepartmentName }
  });
}

export async function triggerAdminAssignmentNotification(options: {
  event: 'grievance_assigned_admin_v2' | 'grievance_reassigned_admin_v2' | 'grievance_reverted_company_v2' | string;
  companyId: any;
  grievanceId: string;
  citizenName: string;
  category: string;
  subDepartmentName?: string;
  description?: string;
  recipientPhones: any[];
  language?: string;
  assignedByName?: string;
  reassignedByName?: string;
  revertedByName?: string;
  remarks?: string;
  submittedOn?: Date | string;
  reassignedOn?: Date | string;
  originalDepartmentName?: string;
  originalOfficeName?: string;
  media?: Array<{ url: string; type: 'image' | 'video' | 'document'; caption?: string; filename?: string }>;
  grievance?: any;
  buttonParam?: string;
}) {
  // Convert physical template name to logical key if possible
  let eventKey = options.event.toUpperCase();
  if (eventKey === 'GRIEVANCE_ASSIGNED_ADMIN_V2') eventKey = 'GRIEVANCE_ASSIGNED';
  if (eventKey === 'GRIEVANCE_REASSIGNED_ADMIN_V2') eventKey = 'GRIEVANCE_REASSIGNED';
  if (eventKey === 'GRIEVANCE_REVERTED_COMPANY_V2') eventKey = 'GRIEVANCE_REVERTED';

  return triggerGrievanceEvent({
    eventKey,
    companyId: options.companyId,
    grievance: options.grievance || {
      grievanceId: options.grievanceId,
      citizenName: options.citizenName,
      description: options.description,
    },
    recipientPhones: options.recipientPhones,
    language: options.language,
    remarks: options.remarks,
    admin: { fullName: options.reassignedByName || options.assignedByName || options.revertedByName || 'Administrator' },
    previousDept: options.originalDepartmentName,
    previousOffice: options.originalOfficeName,
    newDept: options.category,
    newOffice: options.subDepartmentName,
    media: options.media,
    buttonParam: options.buttonParam,
    department: { name: options.category },
    subDept: { name: options.subDepartmentName },
    submittedOn: options.submittedOn,
    reassignedOn: options.reassignedOn
  });
}
