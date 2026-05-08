import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import mongoose from 'mongoose';
import { logger } from '../config/logger';
import CompanyEmailConfig from '../models/CompanyEmailConfig';
import CompanyEmailTemplate from '../models/CompanyEmailTemplate';
import Company from '../models/Company';
import CompanyWhatsAppTemplate from '../models/CompanyWhatsAppTemplate';
import ChatbotFlow from '../models/ChatbotFlow';

const DEFAULT_WA_MESSAGE_OVERRIDES: Record<string, string> = {
  grievance_reassigned_admin: `*{localizedCompanyBrand}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *GRIEVANCE REASSIGNED TO YOU*

Respected {recipientName},

Remarks:
🎫 *Reference ID:* {grievanceId}
👤 *Citizen Name:* {citizenName}
🏢 *Department:* {departmentName}
🏢 *Office:* {officeName}
📝 *Grievance Description:*
{grievanceDetails}
📅 *Submitted On:* {submittedDate}
👨‍💼 *Reassigned By:* {reassignedByName}
📝 *Reassignment Note:*
{reassignmentNote}
📅 *Reassigned On:* {reassignedDate}
🏢 *Original Department:* {originalDepartment}
🏢 *Original Office:* {originalOffice}

Please review and take necessary action.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Digital Grievance Redressal System`,
  grievance_status_update: `*{localizedCompanyBrand}*
Your grievance {grievanceId} status has been updated to {newStatus}.`,
  grievance_status_assigned: `*{localizedCompanyBrand}*
Your grievance {grievanceId} has been assigned for resolution.`,
  grievance_status_in_progress: `*{localizedCompanyBrand}*
Work on your grievance {grievanceId} is now in progress.`,
  grievance_status_resolved: `*{localizedCompanyBrand}*
Your grievance {grievanceId} has been resolved.`,
  grievance_status_rejected: `*{localizedCompanyBrand}*
Your grievance {grievanceId} has been rejected. Remarks: {remarks}`
};

/**
 * Reusable SMTP transporter from env (singleton, fallback)
 */
let envTransporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;

const JHARSUGUDA_COMPANY_ID = '69ad4c6eb1ad8e405e6c0858';

const isCollectorateJharsugudaCompany = (companyId: string | mongoose.Types.ObjectId): boolean => {
  if (!companyId) return false;
  return companyId.toString() === JHARSUGUDA_COMPANY_ID;
};

const getLocalizedWhatsAppBrandName = (companyName: string, lang: string, companyId?: string | mongoose.Types.ObjectId): string => {
  if (companyId && !isCollectorateJharsugudaCompany(companyId)) {
    return companyName || 'Government Digital Portal';
  } else if (!companyId && !companyName.toLowerCase().includes('jharsuguda')) {
    return companyName || 'Government Digital Portal';
  }

  switch (String(lang || 'en').toLowerCase()) {
    case 'hi':
      return 'सहज - प्रशासन द्वारा त्वरित पहुंच एवं सहायता, झारसुगुड़ा';
    case 'or':
      return 'ସହଜ - ପ୍ରଶାସନ ଦ୍ୱାରା ସ୍ୱିଫ୍ଟ ଆକ୍ସେସ ଏବଂ ସହାୟତା, ଝାରସୁଗୁଡା';
    default:
      return 'SAHAJ - Swift Access & Help by Administration, Jharsuguda';
  }
};

const shouldPreferLocalizedGrievanceConfirmation = (
  companyId: string | mongoose.Types.ObjectId,
  type: 'grievance' | 'appointment',
  normalizedAction: string,
  lang: string,
): boolean => {
  return (
    type === 'grievance' &&
    normalizedAction === 'confirmation' &&
    ['hi', 'or'].includes(String(lang || 'en').toLowerCase()) &&
    isCollectorateJharsugudaCompany(companyId)
  );
};

const createEnvTransporter = (): Transporter<SMTPTransport.SentMessageInfo> | null => {
  if (envTransporter) return envTransporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT ?? 465);
  const options: SMTPTransport.Options = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: true }
  };
  envTransporter = nodemailer.createTransport(options);
  return envTransporter;
};

/**
 * Get transporter for a company from DB (CompanyEmailConfig). Prefer DB over env.
 */
export async function getTransporterForCompany(companyId: string | mongoose.Types.ObjectId): Promise<Transporter<SMTPTransport.SentMessageInfo> | null> {
  try {
    const id = typeof companyId === 'string' && mongoose.Types.ObjectId.isValid(companyId)
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;
    const config = await CompanyEmailConfig.findOne({ companyId: id, isActive: true });
    if (!config) return null;
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.port === 587,
      auth: config.auth,
      tls: { rejectUnauthorized: true }
    } as SMTPTransport.Options);
  } catch (e) {
    logger.warn('getTransporterForCompany failed:', e);
    return null;
  }
}

export interface SendEmailOptions {
  companyId?: string | mongoose.Types.ObjectId;
}

/**
 * Send email notification. Uses company SMTP from DB when options.companyId is set; otherwise env.
 */
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  text?: string,
  options?: SendEmailOptions
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const recipients = Array.isArray(to) ? to : [to];
    const invalidEmails = recipients.filter(email => !email || !email.includes('@'));
    if (invalidEmails.length > 0) {
      const errorMsg = `Invalid email address(es): ${invalidEmails.join(', ')}`;
      logger.error(`❌ ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    let transport: Transporter<SMTPTransport.SentMessageInfo> | null = null;
    let fromLine: string;

    if (options?.companyId) {
      const id = typeof options.companyId === 'string' && mongoose.Types.ObjectId.isValid(options.companyId)
        ? new mongoose.Types.ObjectId(options.companyId)
        : options.companyId;

      transport = await getTransporterForCompany(id);
      if (transport) {
        const config = await CompanyEmailConfig.findOne({
          companyId: id,
          isActive: true
        });
        fromLine = config
          ? `"${config.fromName}" <${config.fromEmail}>`
          : `"Dashboard" <noreply@dashboard.local>`;
      }
    }

    if (!transport) {
      transport = createEnvTransporter();
      if (!transport) {
        const errorMsg = 'SMTP not configured. Set company Email Config (DB) or SMTP_* env variables.';
        logger.warn(`⚠️ ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
      fromLine = `"${process.env.SMTP_FROM_NAME || 'Government Digital Portal'}" <${process.env.SMTP_USER}>`;
    }

    const mailOptions: SendMailOptions = {
      from: fromLine!,
      to: recipients.join(', '),
      subject,
      text: text ?? subject,
      html
    };

    logger.info(`📧 Attempting to send email to: ${recipients.join(', ')}`);
    const info = await transport.sendMail(mailOptions);
    logger.info(`✅ Email sent successfully to ${recipients.join(', ')} - Message ID: ${info.messageId}`);

    return { success: true };
  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown email error';
    logger.error(`❌ Failed to send email:`, { 
      error: errorMessage, 
      stack: err.stack,
      code: err.code,
      command: err.command,
      address: err.address,
      port: err.port,
      details: err 
    });
    return { success: false, error: errorMessage };
  }
}

/**
 * Test email configuration
 */
export async function testEmailConfiguration(companyId?: string | mongoose.Types.ObjectId): Promise<{ success: boolean; error?: string; details?: any }> {
  try {
    if (companyId) {
      const transport = await getTransporterForCompany(companyId);
      if (!transport) {
        return { success: false, error: 'No email config found for this company' };
      }
      await transport.verify();
      const config = await CompanyEmailConfig.findOne({ companyId, isActive: true });
      return {
        success: true,
        details: config
          ? { host: config.host, port: config.port, fromName: config.fromName, fromEmail: config.fromEmail }
          : undefined
      };
    }

    const transport = createEnvTransporter();
    if (!transport) {
      return {
        success: false,
        error: 'SMTP credentials not configured',
        details: {
          SMTP_USER: process.env.SMTP_USER ? 'Set' : 'Missing',
          SMTP_PASS: process.env.SMTP_PASS ? 'Set' : 'Missing',
          SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com (default)',
          SMTP_PORT: process.env.SMTP_PORT || '465 (default)'
        }
      };
    }
    
    // Test connection by verifying credentials
    await transport.verify();
    
    return {
      success: true,
      details: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || '465',
        user: process.env.SMTP_USER,
        fromName: process.env.SMTP_FROM_NAME || 'Government Digital Portal'
      }
    };
  } catch (err: any) {
    logger.error('❌ testEmailConfiguration failed:', {
      message: err.message,
      code: err.code,
      command: err.command,
      stack: err.stack
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      details: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || '465',
        user: process.env.SMTP_USER,
        error: err,
        code: err.code,
        command: err.command
      }
    };
  }
}

/**
 * Format date and time in a readable format
 */
function formatDateTime(date: Date | string | undefined): string {
  if (!date) return 'N/A';
  const d = typeof date === 'string' ? new Date(date) : date;
  
  try {
    const formatter = new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });
    
    // Some environments' toLocaleString includes "at" or other filler.
    // Using formatToParts allows us to build a precise string.
    const parts = formatter.formatToParts(d);
    const p: Record<string, string> = {};
    parts.forEach(part => { p[part.type] = part.value; });
    
    // Format: "10 March 2026, 09:05:53 AM"
    return `${p.day} ${p.month} ${p.year} at ${p.hour}:${p.minute}:${p.second} ${p.dayPeriod || p.ampm || ''}`.trim().replace(/\s+/g, ' ');
  } catch (e) {
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  }
}

/**
 * Format date in a readable format
 */
function formatDate(date: Date | string | undefined): string {
  if (!date) return 'N/A';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  });
}

/**
 * Format timeline details in a human-readable way
 */
function formatTimelineDetails(details: any, action: string): string {
  if (!details) return '';
  
  if (typeof details === 'string') {
    return details;
  }
  
  if (typeof details !== 'object') {
    return String(details);
  }
  
  // Format based on action type
  if (action === 'ASSIGNED') {
    const parts: string[] = [];
    if (details.fromUserId && details.toUserId) {
      parts.push(`Reassigned from previous officer to ${details.toUserName || 'new officer'}`);
    } else if (details.toUserId) {
      parts.push(`Assigned to ${details.toUserName || 'officer'}`);
    }
    if (details.reason) {
      parts.push(`Reason: ${details.reason}`);
    }
    return parts.length > 0 ? parts.join('. ') : 'Assignment updated';
  }
  
  if (action === 'STATUS_UPDATED') {
    const parts: string[] = [];
    if (details.fromStatus && details.toStatus) {
      parts.push(`Status changed from ${details.fromStatus} to ${details.toStatus}`);
    }
    if (details.remarks) {
      parts.push(`Remarks: ${details.remarks}`);
    }
    return parts.length > 0 ? parts.join('. ') : 'Status updated';
  }
  
  if (action === 'DEPARTMENT_TRANSFER') {
    const parts: string[] = [];
    if (details.toDepartmentId) {
      parts.push('Transferred to different department');
    }
    if (details.reason) {
      parts.push(`Reason: ${details.reason}`);
    }
    return parts.length > 0 ? parts.join('. ') : 'Department transfer';
  }
  
  if (action === 'CREATED') {
    const parts: string[] = [];
    if (details.purpose) {
      parts.push(`Purpose: ${details.purpose}`);
    }
    if (details.date) {
      parts.push(`Scheduled: ${formatDate(details.date)}`);
    }
    if (details.time) {
      parts.push(`Time: ${details.time}`);
    }
    return parts.length > 0 ? parts.join('. ') : 'Created by citizen';
  }
  
  // Fallback: format object keys nicely
  const formatted: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (value !== null && value !== undefined) {
      const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
      formatted.push(`${formattedKey}: ${value}`);
    }
  }
  return formatted.length > 0 ? formatted.join(', ') : '';
}

/**
 * Generate timeline HTML
 */
function generateTimelineHTML(timeline: any[] | undefined, resolvedBy: any, resolvedAt: Date | string | undefined, createdAt: Date | string | undefined, assignedAt: Date | string | undefined, type?: string): string {
  if (!timeline || timeline.length === 0) {
    // Generate basic timeline from available data
    let timelineItems = [];
    
    if (createdAt) {
      timelineItems.push({
        action: 'CREATED',
        timestamp: createdAt,
        performedBy: null,
        details: type === 'appointment' ? 'Appointment booking was created by the citizen' : 'Grievance was successfully registered by the citizen'
      });
    }
    
    if (assignedAt) {
      timelineItems.push({
        action: 'ASSIGNED',
        timestamp: assignedAt,
        performedBy: null,
        details: 'Assigned to an officer for resolution'
      });
    }
    
    if (resolvedAt && resolvedBy) {
      timelineItems.push({
        action: 'RESOLVED',
        timestamp: resolvedAt,
        performedBy: resolvedBy,
        details: 'Resolved by assigned officer'
      });
    }
    
    if (timelineItems.length === 0) return '';
    
    let html = '<div class="timeline-section"><h3 style="color: #0f4c81; margin-top: 20px; margin-bottom: 15px; font-size: 16px; border-bottom: 2px solid #0f4c81; padding-bottom: 8px;">📋 Processing Timeline</h3><div class="timeline">';
    
    timelineItems.forEach((item, index) => {
      const isLast = index === timelineItems.length - 1;
      const performerName = item.performedBy 
        ? (typeof item.performedBy === 'object' 
          ? `${item.performedBy.firstName || ''} ${item.performedBy.lastName || ''}`.trim() 
          : 'Officer')
        : 'System';
      
      html += `
        <div class="timeline-item">
          <div class="timeline-marker ${isLast ? 'active' : ''}"></div>
          <div class="timeline-content">
            <div class="timeline-header">
              <strong>${item.action === 'CREATED' ? '📝 Created' : item.action === 'ASSIGNED' ? '👤 Assigned' : '✅ Resolved'}</strong>
              <span class="timeline-date">${formatDateTime(item.timestamp)}</span>
            </div>
            <div class="timeline-details">${item.details}</div>
            ${item.performedBy ? `<div class="timeline-officer">👨‍💼 Officer: ${performerName}</div>` : ''}
          </div>
        </div>
      `;
    });
    
    html += '</div></div>';
    return html;
  }
  
  // Use provided timeline
  let html = '<div class="timeline-section"><h3 style="color: #0f4c81; margin-top: 20px; margin-bottom: 15px; font-size: 16px; border-bottom: 2px solid #0f4c81; padding-bottom: 8px;">📋 Processing Timeline</h3><div class="timeline">';
  
  timeline.forEach((item, index) => {
    const isLast = index === timeline.length - 1;
    const performerName = item.performedBy 
      ? (typeof item.performedBy === 'object' 
        ? `${item.performedBy.firstName || ''} ${item.performedBy.lastName || ''}`.trim() 
        : typeof item.performedBy === 'string' 
          ? 'Officer'
          : 'Officer')
      : 'System';
    
    const actionLabel = item.action === 'CREATED' ? '📝 Created' 
      : item.action === 'ASSIGNED' ? '👤 Assigned'
      : item.action === 'STATUS_UPDATED' ? '🔄 Status Updated'
      : item.action === 'RESOLVED' ? '✅ Resolved'
      : item.action;
    
    html += `
      <div class="timeline-item">
        <div class="timeline-marker ${isLast ? 'active' : ''}"></div>
        <div class="timeline-content">
          <div class="timeline-header">
            <strong>${actionLabel}</strong>
            <span class="timeline-date">${formatDateTime(item.timestamp)}</span>
          </div>
          ${item.details ? `<div class="timeline-details">${formatTimelineDetails(item.details, item.action)}</div>` : ''}
          ${item.performedBy ? `<div class="timeline-officer">👨‍💼 Officer: ${performerName}</div>` : ''}
        </div>
      </div>
    `;
  });
  
  html += '</div></div>';
  return html;
}

/**
 * Replace placeholders in a string with data values. E.g. {citizenName} -> data.citizenName
 */
const FLEXIBLE_TEMPLATE_KEYS = [
  'recipientName',
  'grievanceId',
  'appointmentId',
  'citizenName',
  'citizenPhone',
  'departmentName',
  'subDepartmentName',
  'officeName',
  'description',
  'grievanceDetails',
  'submittedDate',
  'assignedByName',
  'assignedDate',
  'formattedAssignedDate',
  'reassignedByName',
  'reassignmentNote',
  'reassignedDate',
  'formattedReassignedDate',
  'originalDepartment',
  'originalOffice',
  'formattedDate',
  'remarks',
  'reason',
  'newStatus',
  'resolvedByName',
  'formattedResolvedDate',
  'resolutionTimeText',
  'companyName',
  'localizedCompanyBrand'
];

function normalizeLooseTemplateTokens(str: string): string {
  let normalized = str;

  for (const key of FLEXIBLE_TEMPLATE_KEYS.sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`(^|[^\\w{])(${key})(?=[^\\w}]|$)`, 'g');
    normalized = normalized.replace(pattern, (match, prefix, token) => {
      if (match.includes(`{${token}}`)) return match;
      return `${prefix}{${token}}`;
    });
  }

  return normalized;
}

export function replacePlaceholders(str: string, data: Record<string, any>): string {
  if (!str || typeof str !== 'string') return str;
  return normalizeLooseTemplateTokens(str).replace(/\{([^{}]+)\}/g, (_, key) => {
    const v = data[key];
    // Return the value if it exists, otherwise provide a user-friendly fallback
    return (v != null && v !== '') ? String(v) : '';
  });
}

/**
 * Get email content for a notification: use company custom template if set, else built-in.
 */
export async function getNotificationEmailContent(
  companyId: string | mongoose.Types.ObjectId,
  type: 'grievance' | 'appointment',
  action: string,
  data: any,
  isAdmin: boolean = false
): Promise<{ subject: string; html: string; text: string } | null> {
  const key = `${type}_${action}`;
  const cid = typeof companyId === 'string' && mongoose.Types.ObjectId.isValid(companyId)
    ? new mongoose.Types.ObjectId(companyId)
    : companyId;
  const template = await CompanyEmailTemplate.findOne({ companyId: cid, templateKey: key, isActive: true });
  if (template && template.subject && template.htmlBody) {
    const subject = replacePlaceholders(template.subject, data);
    const html = replacePlaceholders(template.htmlBody, data);
    const text = template.textBody ? replacePlaceholders(template.textBody, data) : subject;
    return { subject, html, text };
  }
  
  // Only use default for core citizen and admin notifications
  if (['created', 'assigned', 'resolved', 'confirmation', 'status_update', 'status_change'].includes(action)) {
    return generateNotificationEmail(type, action as any, data, isAdmin);
  }
  
  logger.warn(`⚠️ No email content template or default fallback for action: ${action}`);
  return null;
}

/**
 * Get WhatsApp message for a notification: use company custom template if set, else return null (caller uses default).
 */
export async function getNotificationWhatsAppMessage(
  companyId: string | mongoose.Types.ObjectId,
  type: 'grievance' | 'appointment',
  action: string,
  data: Record<string, any>
): Promise<string | null> {
  const cid =
    typeof companyId === 'string' && mongoose.Types.ObjectId.isValid(companyId)
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;

  const lang = data.language || data.lang || 'en';

  // 1. Try to fetch from Active Chatbot Flow (Prioritize Flow Definition for Citizen Success)
  if (type === 'grievance' && (action === 'confirmation' || action === 'created')) {
    try {
      const activeFlow = await ChatbotFlow.findOne({ companyId: cid, isActive: true }).lean();
      if (activeFlow && activeFlow.steps) {
        const stepId = `grv_success_${String(lang).toLowerCase()}`;
        const successStep = activeFlow.steps.find((s: any) => s.stepId === stepId);
        
        let flowMessage = successStep?.messageText;
        
        // Fallback: Check translations or UI nodes if primary messageText is empty
        if (!flowMessage || !flowMessage.trim()) {
          if (successStep?.messageTextTranslations && successStep.messageTextTranslations[lang]) {
            flowMessage = successStep.messageTextTranslations[lang];
          } else if (activeFlow.nodes) {
            const node = activeFlow.nodes.find((n: any) => n.id === stepId);
            flowMessage = node?.data?.messageText;
          }
        }

        if (flowMessage && flowMessage.trim()) {
          logger.info(`[WhatsApp Template] Using prioritized message from active flow: ${activeFlow.flowName} (Step: ${stepId})`);
          
          // Use localized brand name if applicable
          let resolvedCompanyName = String(data.companyName || '').trim();
          if (!resolvedCompanyName) {
            const company = await Company.findById(cid).select('name').lean();
            resolvedCompanyName = String(company?.name || '').trim();
          }
          const localizedBrand = getLocalizedWhatsAppBrandName(resolvedCompanyName, lang, cid);
          
          return replacePlaceholders(flowMessage.trim(), {
            ...data,
            companyName: localizedBrand,
            localizedCompanyBrand: localizedBrand
          });
        }
      }
    } catch (err) {
      logger.error(`[WhatsApp Template] Error fetching from ChatbotFlow:`, err);
    }
  }

  let resolvedCompanyName = String(data.companyName || '').trim();

  if (!resolvedCompanyName) {
    const company = await Company.findById(cid).select('name').lean();
    resolvedCompanyName = String(company?.name || '').trim();
  }

  const localizedBrand = getLocalizedWhatsAppBrandName(
    resolvedCompanyName,
    lang,
    cid
  );
  const localizedData = {
    ...data,
    companyName: localizedBrand,
    localizedCompanyBrand: localizedBrand,
  };

  const typePrefix = `${type}_`;
  const normalizedAction = action.startsWith(typePrefix)
    ? action.slice(typePrefix.length)
    : action;

  const attemptKeys = [
    `${type}_${normalizedAction}_${lang}`,
    `${type}_${normalizedAction}`,
    normalizedAction === 'confirmation' ? `${type}_created_${lang}` : '',
    normalizedAction === 'confirmation' ? `${type}_created` : '',
    normalizedAction === 'created' ? `${type}_confirmation_${lang}` : '',
    normalizedAction === 'created' ? `${type}_confirmation` : '',
  ].filter(Boolean);

  const preferLocalizedConfirmation = shouldPreferLocalizedGrievanceConfirmation(
    cid,
    type,
    normalizedAction,
    lang,
  );
  const primaryAttemptKeys = preferLocalizedConfirmation
    ? attemptKeys.filter((key) => key.endsWith(`_${lang}`))
    : attemptKeys;
  const fallbackAttemptKeys = preferLocalizedConfirmation
    ? attemptKeys.filter((key) => !key.endsWith(`_${lang}`))
    : [];

  const canonicalKeys = new Set([
    `${type}_${action}_${lang}`,
    `${type}_${action}`,
  ]);
  let hasExplicitDisableForCanonicalKey = false;

  logger.info(
    `[WhatsApp Template] Resolving message for Type: ${type}, Action: ${action}, Lang: ${lang}`,
  );
  logger.info(`   Attempting keys: ${attemptKeys.join(', ')}`);

  const resolveFromDb = async (keys: string[], label: string) => {
    for (const key of keys) {
      const template = await CompanyWhatsAppTemplate.findOne({
        companyId: cid,
        templateKey: key as any,
      });

      if (!template) continue;

      if (template.isActive === false) {
        logger.info(
          `[WhatsApp Template] ${label} template inactive for key: ${key}`,
        );
        if (canonicalKeys.has(key)) {
          hasExplicitDisableForCanonicalKey = true;
        }
        continue;
      }

      if (template.message && template.message.trim()) {
        logger.info(
          `[WhatsApp Template] Using ${label} custom template for key: ${key}`,
        );
        return replacePlaceholders(template.message.trim(), localizedData);
      }
    }

    return null;
  };

  const resolveFromDefaults = (keys: string[], label: string) => {
    for (const key of keys) {
      const templateMessage = DEFAULT_WA_MESSAGE_OVERRIDES[key];
      if (templateMessage) {
        logger.info(
          `[WhatsApp Template] Using ${label} system default for key: ${key}`,
        );
        return replacePlaceholders(templateMessage, localizedData);
      }
    }

    return null;
  };

  const primaryDbMessage = await resolveFromDb(primaryAttemptKeys, 'primary');
  if (primaryDbMessage) return primaryDbMessage;

  if (hasExplicitDisableForCanonicalKey) {
    logger.info(
      `[WhatsApp Template] Notification suppressed due to inactive canonical template for ${type}_${action}`,
    );
    return null;
  }

  const primaryDefaultMessage = resolveFromDefaults(
    primaryAttemptKeys,
    'primary',
  );
  if (primaryDefaultMessage) return primaryDefaultMessage;

  const fallbackDbMessage = await resolveFromDb(fallbackAttemptKeys, 'fallback');
  if (fallbackDbMessage) return fallbackDbMessage;

  const fallbackDefaultMessage = resolveFromDefaults(
    fallbackAttemptKeys,
    'fallback',
  );
  if (fallbackDefaultMessage) return fallbackDefaultMessage;

  logger.warn(
    `[WhatsApp Template] No template found (Database or Default) for keys: ${attemptKeys.join(', ')}`,
  );
  return null;
}

/**
 * Generate HTML email template for grievance/appointment notifications
 */
export function generateNotificationEmail(
  type: 'grievance' | 'appointment',
  action: 'created' | 'assigned' | 'resolved',
  data: any,
  isAdmin: boolean = false
): { subject: string; html: string; text: string } {
  const companyName = data.companyName || 'Government Digital Portal';
  const recipientName = data.recipientName || 'Admin';

  // Common styles
  const commonStyles = `
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
      line-height: 1.8; 
      color: #2c3e50; 
      background-color: #f5f7fa;
      margin: 0;
      padding: 0;
    }
    .email-container { 
      max-width: 650px; 
      margin: 20px auto; 
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header { 
      background: linear-gradient(135deg, #0f4c81 0%, #1a5f9f 100%); 
      color: white; 
      padding: 30px 20px; 
      text-align: center;
    }
    .header h2 { margin: 0; font-size: 24px; font-weight: 600; }
    .content { 
      padding: 30px; 
      background: #ffffff;
    }
    .greeting {
      font-size: 16px;
      color: #2c3e50;
      margin-bottom: 20px;
    }
    .intro-text {
      font-size: 15px;
      color: #34495e;
      margin-bottom: 25px;
      line-height: 1.8;
    }
    .detail-box {
      background: #f8f9fa;
      border-left: 4px solid #0f4c81;
      padding: 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .detail-row { 
      margin: 12px 0; 
      display: flex;
      align-items: flex-start;
    }
    .detail-label { 
      font-weight: 600; 
      color: #0f4c81; 
      min-width: 140px;
      font-size: 14px;
    }
    .detail-value { 
      color: #2c3e50; 
      flex: 1;
      font-size: 14px;
    }
    .remarks-box { 
      background: #e8f5e9; 
      padding: 18px; 
      border-left: 4px solid #28a745; 
      margin: 20px 0; 
      border-radius: 4px;
    }
    .remarks-title {
      font-weight: 600;
      color: #155724;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .remarks-text {
      color: #2c3e50;
      font-size: 14px;
      line-height: 1.7;
    }
    .timeline-section {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #e0e0e0;
    }
    .timeline {
      position: relative;
      padding-left: 30px;
      margin-top: 15px;
    }
    .timeline-item {
      position: relative;
      margin-bottom: 25px;
    }
    .timeline-marker {
      position: absolute;
      left: -37px;
      top: 5px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #bdc3c7;
      border: 3px solid #ffffff;
      box-shadow: 0 0 0 2px #bdc3c7;
    }
    .timeline-marker.active {
      background: #28a745;
      box-shadow: 0 0 0 2px #28a745;
    }
    .timeline-item:not(:last-child)::before {
      content: '';
      position: absolute;
      left: -31px;
      top: 17px;
      width: 2px;
      height: calc(100% + 8px);
      background: #e0e0e0;
    }
    .timeline-content {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
    }
    .timeline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .timeline-header strong {
      color: #0f4c81;
      font-size: 14px;
    }
    .timeline-date {
      color: #7f8c8d;
      font-size: 12px;
    }
    .timeline-details {
      color: #2c3e50;
      font-size: 13px;
      margin-bottom: 5px;
    }
    .timeline-officer {
      color: #27ae60;
      font-size: 12px;
      font-weight: 500;
      margin-top: 5px;
    }
    .footer { 
      background: #f8f9fa;
      text-align: center; 
      color: #7f8c8d; 
      font-size: 12px; 
      padding: 20px;
      border-top: 1px solid #e0e0e0;
    }
    .footer-text {
      margin: 5px 0;
    }
    .action-button {
      display: inline-block;
      background: #0f4c81;
      color: white;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 5px;
      margin-top: 20px;
      font-weight: 500;
    }
    .admin-link-section {
      margin-top: 25px;
      padding: 20px;
      background: #f1f5f9;
      border-radius: 8px;
      text-align: center;
      border: 1px dashed #cbd5e1;
    }
  `;

  const dashboardLink = 'https://sahaj.pugarch.in/';
  const adminLinkHtml = isAdmin ? `
    <div class="admin-link-section">
      <p style="margin: 0 0 15px 0; font-size: 14px; color: #475569; font-weight: 600;">🔐 ACCESS DASHBOARD</p>
      <a href="${dashboardLink}" class="action-button">Access Dashboard</a>
      <p style="margin: 10px 0 0 0; font-size: 11px; color: #64748b;">Click above to login and manage this record.</p>
    </div>
  ` : '';

  const adminLinkText = isAdmin ? `\n\nACCESS DASHBOARD:\n${dashboardLink}\n` : '';

  if (action === 'created' && type === 'grievance') {
    return {
      subject: `New Grievance Received - ${data.grievanceId} | ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>${commonStyles}</style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <h2>📋 New Grievance Received</h2>
            </div>
            <div class="content">
              <div class="greeting">
                <strong>Respected ${recipientName},</strong>
              </div>
              <div class="intro-text">
                This is to inform you that a new grievance has been received through our digital portal and has been assigned to your department for immediate attention and necessary action.
              </div>
              
              <div class="detail-box">
                <div class="detail-row">
                  <span class="detail-label">🎫 Grievance ID:</span>
                  <span class="detail-value"><strong style="color: #0f4c81;">${data.grievanceId}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">👤 Citizen Name:</span>
                  <span class="detail-value">${data.citizenName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">📞 Contact Number:</span>
                  <span class="detail-value">${data.citizenPhone}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">🏢 Department:</span>
                  <span class="detail-value"><strong>${data.departmentName}</strong></span>
                </div>
                ${data.category ? `
                <div class="detail-row">
                  <span class="detail-label">📁 Category:</span>
                  <span class="detail-value">${data.category}</span>
                </div>
                ` : ''}

                <div class="detail-row" style="align-items: flex-start;">
                  <span class="detail-label">📝 Description:</span>
                  <span class="detail-value" style="white-space: pre-wrap;">${data.description || 'No description provided'}</span>
                </div>
                ${data.createdAt ? `
                <div class="detail-row">
                  <span class="detail-label">📅 Received On:</span>
                  <span class="detail-value">${formatDateTime(data.createdAt)}</span>
                </div>
                ` : ''}
              </div>

              <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <strong style="color: #856404;">⚠️ Action Required:</strong>
                <p style="margin: 8px 0 0 0; color: #856404; font-size: 14px;">
                  Please review this grievance at your earliest convenience and take appropriate action. Kindly ensure timely resolution as per the service level agreement (SLA) guidelines.
                </p>
              </div>

                </p>
              </div>

              ${adminLinkHtml}

              ${generateTimelineHTML(data.timeline, undefined, undefined, data.createdAt, undefined, type)}
            </div>
            <div class="footer">
              <div class="footer-text"><strong>${companyName}</strong></div>
              <div class="footer-text">Digital Grievance Redressal System</div>
              <div class="footer-text" style="margin-top: 10px; font-size: 11px;">
                This is an automated notification. Please do not reply to this email.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `NEW GRIEVANCE RECEIVED\n\nRespected ${recipientName},\n\nA new grievance has been received and assigned to your department.\n\nGrievance ID: ${data.grievanceId}\nCitizen Name: ${data.citizenName}\nContact: ${data.citizenPhone}\nDepartment: ${data.departmentName}\nCategory: ${data.category || 'N/A'}\nDescription: ${data.description}\n${data.createdAt ? `Received On: ${formatDateTime(data.createdAt)}\n` : ''}${adminLinkText}\nPlease review and take necessary action.\n\n${companyName} - Digital Portal`
    };
  }

  if (action === 'created' && type === 'appointment') {
    return {
      subject: `New Appointment Booking Received - ${data.appointmentId} | ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>${commonStyles}</style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <h2>📅 New Appointment Booking Received</h2>
            </div>
            <div class="content">
              <div class="greeting">
                <strong>Respected ${recipientName},</strong>
              </div>
              <div class="intro-text">
                This is to inform you that a new appointment has been booked through our digital portal and has been assigned to your department for scheduling and management.
              </div>
              
              <div class="detail-box">
                <div class="detail-row">
                  <span class="detail-label">🎫 Appointment ID:</span>
                  <span class="detail-value"><strong style="color: #0f4c81;">${data.appointmentId}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">👤 Citizen Name:</span>
                  <span class="detail-value">${data.citizenName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">📞 Contact Number:</span>
                  <span class="detail-value">${data.citizenPhone}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">🏢 Department:</span>
                  <span class="detail-value"><strong>${data.departmentName}</strong></span>
                </div>
                <div class="detail-row" style="align-items: flex-start;">
                  <span class="detail-label">📝 Purpose:</span>
                  <span class="detail-value" style="white-space: pre-wrap;">${data.purpose || 'No purpose specified'}</span>
                </div>
                ${data.appointmentDate ? `
                <div class="detail-row">
                  <span class="detail-label">📅 Scheduled Date:</span>
                  <span class="detail-value"><strong>${formatDate(data.appointmentDate)}</strong></span>
                </div>
                ` : ''}
                ${data.appointmentTime ? `
                <div class="detail-row">
                  <span class="detail-label">⏰ Scheduled Time:</span>
                  <span class="detail-value"><strong>${data.appointmentTime}</strong></span>
                </div>
                ` : ''}
                ${data.createdAt ? `
                <div class="detail-row">
                  <span class="detail-label">📅 Booked On:</span>
                  <span class="detail-value">${formatDateTime(data.createdAt)}</span>
                </div>
                ` : ''}
              </div>

              <div style="background: #d1ecf1; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <strong style="color: #0c5460;">ℹ️ Information:</strong>
                <p style="margin: 8px 0 0 0; color: #0c5460; font-size: 14px;">
                  Please review this appointment booking and ensure proper scheduling. Kindly confirm the appointment with the citizen and make necessary arrangements.
                </p>
              </div>

                </p>
              </div>

              ${adminLinkHtml}

              ${generateTimelineHTML(data.timeline, undefined, undefined, data.createdAt, undefined, type)}
            </div>
            <div class="footer">
              <div class="footer-text"><strong>${companyName}</strong></div>
              <div class="footer-text">Digital Appointment Booking System</div>
              <div class="footer-text" style="margin-top: 10px; font-size: 11px;">
                This is an automated notification. Please do not reply to this email.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `NEW APPOINTMENT BOOKING RECEIVED\n\nRespected ${recipientName},\n\nA new appointment has been booked and assigned to your department.\n\nAppointment ID: ${data.appointmentId}\nCitizen Name: ${data.citizenName}\nContact: ${data.citizenPhone}\nDepartment: ${data.departmentName}\nPurpose: ${data.purpose}\n${data.appointmentDate ? `Scheduled Date: ${formatDate(data.appointmentDate)}\n` : ''}${data.appointmentTime ? `Scheduled Time: ${data.appointmentTime}\n` : ''}${data.createdAt ? `Booked On: ${formatDateTime(data.createdAt)}\n` : ''}${adminLinkText}\nPlease review and confirm the appointment.\n\n${companyName} - Digital Portal`
    };
  }

  if (action === 'assigned' && type === 'grievance') {
    const assignedByName = data.assignedByName || 'Administrator';
    
    return {
      subject: `Grievance Assigned to You - ${data.grievanceId} | ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>${commonStyles}</style>
        </head>
        <body>
          <div class="email-container">
            <div class="header" style="background: linear-gradient(135deg, #1a73e8 0%, #4285f4 100%);">
              <h2>👤 Grievance Assigned to You</h2>
            </div>
            <div class="content">
              <div class="greeting">
                <strong>Respected ${recipientName},</strong>
              </div>
              <div class="intro-text">
                This is to inform you that a grievance has been assigned to you for resolution. You are requested to review the details and take necessary action at the earliest.
              </div>
              
              <div class="detail-box">
                <div class="detail-row">
                  <span class="detail-label">🎫 Grievance ID:</span>
                  <span class="detail-value"><strong style="color: #1a73e8;">${data.grievanceId}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">👤 Citizen Name:</span>
                  <span class="detail-value">${data.citizenName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">📞 Contact Number:</span>
                  <span class="detail-value">${data.citizenPhone}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">🏢 Department:</span>
                  <span class="detail-value"><strong>${data.departmentName}</strong></span>
                </div>

                <div class="detail-row" style="align-items: flex-start;">
                  <span class="detail-label">📝 Description:</span>
                  <span class="detail-value" style="white-space: pre-wrap;">${data.description || 'No description provided'}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">👨‍💼 Assigned By:</span>
                  <span class="detail-value">${assignedByName}</span>
                </div>
                ${data.assignedAt ? `
                <div class="detail-row">
                  <span class="detail-label">📅 Assigned On:</span>
                  <span class="detail-value">${formatDateTime(data.assignedAt)}</span>
                </div>
                ` : ''}
              </div>

              <div style="background: #e3f2fd; border-left: 4px solid #1a73e8; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <strong style="color: #1565c0;">📌 Your Action Required:</strong>
                <p style="margin: 8px 0 0 0; color: #1565c0; font-size: 14px;">
                  Please contact the citizen, investigate the matter, and provide a resolution. Kindly update the status and add remarks as you progress with the resolution process.
                </p>
              </div>

                </p>
              </div>

              ${adminLinkHtml}

              ${generateTimelineHTML(data.timeline, undefined, undefined, data.createdAt, data.assignedAt, type)}
            </div>
            <div class="footer">
              <div class="footer-text"><strong>${companyName}</strong></div>
              <div class="footer-text">Digital Grievance Redressal System</div>
              <div class="footer-text" style="margin-top: 10px; font-size: 11px;">
                This is an automated notification. Please do not reply to this email.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `GRIEVANCE ASSIGNED TO YOU\n\nRespected ${recipientName},\n\nA grievance has been assigned to you for resolution.\n\nGrievance ID: ${data.grievanceId}\nCitizen Name: ${data.citizenName}\nContact: ${data.citizenPhone}\nDepartment: ${data.departmentName}\nDescription: ${data.description}\nAssigned By: ${assignedByName}\n${data.assignedAt ? `Assigned On: ${formatDateTime(data.assignedAt)}\n` : ''}${adminLinkText}\nPlease review and take necessary action.\n\n${companyName} - Digital Portal`
    };
  }

  if (action === 'assigned' && type === 'appointment') {
    const assignedByName = data.assignedByName || 'Administrator';
    
    return {
      subject: `Appointment Assigned to You - ${data.appointmentId} | ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>${commonStyles}</style>
        </head>
        <body>
          <div class="email-container">
            <div class="header" style="background: linear-gradient(135deg, #1a73e8 0%, #4285f4 100%);">
              <h2>📅 Appointment Assigned to You</h2>
            </div>
            <div class="content">
              <div class="greeting">
                <strong>Respected ${recipientName},</strong>
              </div>
              <div class="intro-text">
                This is to inform you that an appointment has been assigned to you for management. You are requested to review the details and ensure proper scheduling and coordination.
              </div>
              
              <div class="detail-box">
                <div class="detail-row">
                  <span class="detail-label">🎫 Appointment ID:</span>
                  <span class="detail-value"><strong style="color: #1a73e8;">${data.appointmentId}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">👤 Citizen Name:</span>
                  <span class="detail-value">${data.citizenName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">📞 Contact Number:</span>
                  <span class="detail-value">${data.citizenPhone}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">🏢 Department:</span>
                  <span class="detail-value"><strong>${data.departmentName}</strong></span>
                </div>
                <div class="detail-row" style="align-items: flex-start;">
                  <span class="detail-label">📝 Purpose:</span>
                  <span class="detail-value" style="white-space: pre-wrap;">${data.purpose || 'No purpose specified'}</span>
                </div>
                ${data.appointmentDate ? `
                <div class="detail-row">
                  <span class="detail-label">📅 Scheduled Date:</span>
                  <span class="detail-value"><strong>${formatDate(data.appointmentDate)}</strong></span>
                </div>
                ` : ''}
                ${data.appointmentTime ? `
                <div class="detail-row">
                  <span class="detail-label">⏰ Scheduled Time:</span>
                  <span class="detail-value"><strong>${data.appointmentTime}</strong></span>
                </div>
                ` : ''}
                <div class="detail-row">
                  <span class="detail-label">👨‍💼 Assigned By:</span>
                  <span class="detail-value">${assignedByName}</span>
                </div>
                ${data.assignedAt ? `
                <div class="detail-row">
                  <span class="detail-label">📅 Assigned On:</span>
                  <span class="detail-value">${formatDateTime(data.assignedAt)}</span>
                </div>
                ` : ''}
              </div>

              <div style="background: #e3f2fd; border-left: 4px solid #1a73e8; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <strong style="color: #1565c0;">📌 Your Action Required:</strong>
                <p style="margin: 8px 0 0 0; color: #1565c0; font-size: 14px;">
                  Please confirm the appointment with the citizen, ensure all necessary arrangements are made, and update the status accordingly.
                </p>
              </div>

                </p>
              </div>

              ${adminLinkHtml}

              ${generateTimelineHTML(data.timeline, undefined, undefined, data.createdAt, data.assignedAt, type)}
            </div>
            <div class="footer">
              <div class="footer-text"><strong>${companyName}</strong></div>
              <div class="footer-text">Digital Appointment Booking System</div>
              <div class="footer-text" style="margin-top: 10px; font-size: 11px;">
                This is an automated notification. Please do not reply to this email.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `APPOINTMENT ASSIGNED TO YOU\n\nRespected ${recipientName},\n\nAn appointment has been assigned to you for management.\n\nAppointment ID: ${data.appointmentId}\nCitizen Name: ${data.citizenName}\nContact: ${data.citizenPhone}\nDepartment: ${data.departmentName}\nPurpose: ${data.purpose}\n${data.appointmentDate ? `Scheduled Date: ${formatDate(data.appointmentDate)}\n` : ''}${data.appointmentTime ? `Scheduled Time: ${data.appointmentTime}\n` : ''}Assigned By: ${assignedByName}\n${data.assignedAt ? `Assigned On: ${formatDateTime(data.assignedAt)}\n` : ''}${adminLinkText}\nPlease review and confirm the appointment.\n\n${companyName} - Digital Portal`
    };
  }

  if (action === 'resolved' && type === 'grievance') {
    const resolvedByName = data.resolvedBy 
      ? (typeof data.resolvedBy === 'object' 
        ? `${data.resolvedBy.firstName || ''} ${data.resolvedBy.lastName || ''}`.trim() 
        : 'Officer')
      : 'Assigned Officer';
    
    const resolvedAtFormatted = data.resolvedAt ? formatDateTime(data.resolvedAt) : 'N/A';
    const createdAtFormatted = data.createdAt ? formatDateTime(data.createdAt) : 'N/A';
    
    // Calculate resolution time
    let resolutionTime = '';
    if (data.createdAt && data.resolvedAt) {
      const created = typeof data.createdAt === 'string' ? new Date(data.createdAt) : data.createdAt;
      const resolved = typeof data.resolvedAt === 'string' ? new Date(data.resolvedAt) : data.resolvedAt;
      const diffMs = resolved.getTime() - created.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      if (diffDays > 0) {
        resolutionTime = `${diffDays} day${diffDays > 1 ? 's' : ''} and ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
      } else {
        resolutionTime = `${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
      }
    }
    
    return {
      subject: `Grievance Resolved - ${data.grievanceId} | ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>${commonStyles}</style>
        </head>
        <body>
          <div class="email-container">
            <div class="header" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%);">
              <h2>✅ Grievance Successfully Resolved</h2>
            </div>
            <div class="content">
              <div class="greeting">
                <strong>Respected ${recipientName},</strong>
              </div>
              <div class="intro-text">
                This is to inform you that the following grievance has been successfully resolved by the assigned officer. The details of the resolution are provided below for your reference.
              </div>
              
              <div class="detail-box">
                <div class="detail-row">
                  <span class="detail-label">🎫 Grievance ID:</span>
                  <span class="detail-value"><strong style="color: #28a745;">${data.grievanceId}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">👤 Citizen Name:</span>
                  <span class="detail-value">${data.citizenName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">📞 Contact Number:</span>
                  <span class="detail-value">${data.citizenPhone}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">🏢 Department:</span>
                  <span class="detail-value"><strong>${data.departmentName || 'N/A'}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">🔄 Status:</span>
                  <span class="detail-value"><strong style="color: #28a745;">RESOLVED</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">👨‍💼 Resolved By:</span>
                  <span class="detail-value"><strong>${resolvedByName}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">📅 Resolved On:</span>
                  <span class="detail-value">${resolvedAtFormatted}</span>
                </div>
                ${resolutionTime ? `
                <div class="detail-row">
                  <span class="detail-label">⏰ Resolution Time:</span>
                  <span class="detail-value"><strong>${resolutionTime}</strong></span>
                </div>
                ` : ''}
                ${data.createdAt ? `
                <div class="detail-row">
                  <span class="detail-label">📅 Received On:</span>
                  <span class="detail-value">${createdAtFormatted}</span>
                </div>
                ` : ''}
              </div>

              ${data.remarks ? `
              <div class="remarks-box">
                <div class="remarks-title">📝 Officer's Resolution Remarks:</div>
                <div class="remarks-text">${data.remarks}</div>
              </div>
              ` : ''}

              ${adminLinkHtml}

              ${generateTimelineHTML(data.timeline, data.resolvedBy, data.resolvedAt, data.createdAt, data.assignedAt, type)}

              <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <strong style="color: #155724;">✓ Resolution Confirmed:</strong>
                <p style="margin: 8px 0 0 0; color: #155724; font-size: 14px;">
                  This grievance has been marked as resolved. The citizen has been notified of the resolution. If you have any concerns or require further information, please contact the assigned officer.
                </p>
              </div>
            </div>
            <div class="footer">
              <div class="footer-text"><strong>${companyName}</strong></div>
              <div class="footer-text">Digital Grievance Redressal System</div>
              <div class="footer-text" style="margin-top: 10px; font-size: 11px;">
                This is an automated notification. Please do not reply to this email.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `GRIEVANCE RESOLVED\n\nRespected ${recipientName},\n\nThe following grievance has been successfully resolved.\n\nGrievance ID: ${data.grievanceId}\nCitizen Name: ${data.citizenName}\nContact: ${data.citizenPhone}\nDepartment: ${data.departmentName || 'N/A'}\nStatus: RESOLVED\nResolved By: ${resolvedByName}\nResolved On: ${resolvedAtFormatted}\n${resolutionTime ? `Resolution Time: ${resolutionTime}\n` : ''}${data.createdAt ? `Received On: ${createdAtFormatted}\n` : ''}\n${data.remarks ? `\nOfficer Remarks:\n${data.remarks}\n` : ''}${adminLinkText}\n\n${companyName} - Digital Portal`
    };
  }

  if (action === 'resolved' && type === 'appointment') {
    const resolvedByName = data.resolvedBy 
      ? (typeof data.resolvedBy === 'object' 
        ? `${data.resolvedBy.firstName || ''} ${data.resolvedBy.lastName || ''}`.trim() 
        : 'Officer')
      : 'Assigned Officer';
    
    const resolvedAtFormatted = data.resolvedAt ? formatDateTime(data.resolvedAt) : 'N/A';
    
    return {
      subject: `Appointment Completed - ${data.appointmentId} | ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>${commonStyles}</style>
        </head>
        <body>
          <div class="email-container">
            <div class="header" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%);">
              <h2>✅ Appointment Successfully Completed</h2>
            </div>
            <div class="content">
              <div class="greeting">
                <strong>Respected ${recipientName},</strong>
              </div>
              <div class="intro-text">
                This is to inform you that the following appointment has been successfully completed. The details of the completion are provided below for your reference.
              </div>
              
              <div class="detail-box">
                <div class="detail-row">
                  <span class="detail-label">🎫 Appointment ID:</span>
                  <span class="detail-value"><strong style="color: #28a745;">${data.appointmentId}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">👤 Citizen Name:</span>
                  <span class="detail-value">${data.citizenName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">📞 Contact Number:</span>
                  <span class="detail-value">${data.citizenPhone}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">🏢 Department:</span>
                  <span class="detail-value"><strong>${data.departmentName || 'N/A'}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">🔄 Status:</span>
                  <span class="detail-value"><strong style="color: #28a745;">COMPLETED</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">👨‍💼 Completed By:</span>
                  <span class="detail-value"><strong>${resolvedByName}</strong></span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">📅 Completed On:</span>
                  <span class="detail-value">${resolvedAtFormatted}</span>
                </div>
                ${data.appointmentDate ? `
                <div class="detail-row">
                  <span class="detail-label">📅 Scheduled Date:</span>
                  <span class="detail-value">${formatDate(data.appointmentDate)}</span>
                </div>
                ` : ''}
                ${data.appointmentTime ? `
                <div class="detail-row">
                  <span class="detail-label">⏰ Scheduled Time:</span>
                  <span class="detail-value">${data.appointmentTime}</span>
                </div>
                ` : ''}
              </div>

              ${data.remarks ? `
              <div class="remarks-box">
                <div class="remarks-title">📝 Officer's Completion Remarks:</div>
                <div class="remarks-text">${data.remarks}</div>
              </div>
              ` : ''}

              ${adminLinkHtml}

              ${generateTimelineHTML(data.timeline, data.resolvedBy, data.resolvedAt, data.createdAt, data.assignedAt, type)}

              <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <strong style="color: #155724;">✓ Completion Confirmed:</strong>
                <p style="margin: 8px 0 0 0; color: #155724; font-size: 14px;">
                  This appointment has been marked as completed. The citizen has been notified. Thank you for your service.
                </p>
              </div>
            </div>
            <div class="footer">
              <div class="footer-text"><strong>${companyName}</strong></div>
              <div class="footer-text">Digital Appointment Booking System</div>
              <div class="footer-text" style="margin-top: 10px; font-size: 11px;">
                This is an automated notification. Please do not reply to this email.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `APPOINTMENT COMPLETED\n\nRespected ${recipientName},\n\nThe following appointment has been successfully completed.\n\nAppointment ID: ${data.appointmentId}\nCitizen Name: ${data.citizenName}\nContact: ${data.citizenPhone}\nDepartment: ${data.departmentName || 'N/A'}\nStatus: COMPLETED\nCompleted By: ${resolvedByName}\nCompleted On: ${resolvedAtFormatted}\n${data.appointmentDate ? `Scheduled Date: ${formatDate(data.appointmentDate)}\n` : ''}${data.appointmentTime ? `Scheduled Time: ${data.appointmentTime}\n` : ''}\n${data.remarks ? `\nOfficer Remarks:\n${data.remarks}\n` : ''}${adminLinkText}\n\n${companyName} - Digital Portal`
    };
  }

  // Default template
  return {
    subject: `Notification from ${companyName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>${commonStyles}</style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h2>Notification</h2>
          </div>
          <div class="content">
            <p>Dear ${recipientName},</p>
            <p>You have received a notification from ${companyName}.</p>
            <pre style="background: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto;">${JSON.stringify(data, null, 2)}</pre>
          </div>
          <div class="footer">
            <div class="footer-text"><strong>${companyName}</strong></div>
            <div class="footer-text">Digital Portal</div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Notification from ${companyName}\n\nDear ${recipientName},\n\nYou have received a notification.\n\n${JSON.stringify(data, null, 2)}\n\n${companyName} - Digital Portal`
  };
}

