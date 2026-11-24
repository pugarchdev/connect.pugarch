import express, { Request, Response } from 'express';
import { requireDatabaseConnection } from '../middleware/dbConnection';
import { processWhatsAppMessage } from '../services/dynamicFlowEngine';
import { getRedisClient, isRedisConnected } from '../config/redis';
import Company from '../models/Company';
import CompanyWhatsAppConfig from '../models/CompanyWhatsAppConfig';
import WhatsAppSession from '../models/WhatsAppSession';
import CitizenProfile from '../models/CitizenProfile';
import { logger } from '../config/logger';
import { sendWhatsAppMessage, sendWhatsAppTemplate } from '../services/whatsappService';
import { verifyWebhookSignature as verifyWebhookSignatureDigest } from '../utils/verifyWebhookSignature';
import { authenticate } from '../middleware/auth';
import ProcessedWhatsAppMessage from '../models/ProcessedWhatsAppMessage';

const router = express.Router();
type WebhookRequest = Request & { rawBody?: Buffer };
type VerifiedWebhookContext = {
  phoneNumberId: string;
  webhookSecret: string;
  config: {
    companyId: any;
    phoneNumberId: string;
    businessAccountId?: string;
    accessToken?: string;
    verifyToken?: string;
    rateLimits?: any;
  };
};


router.post('/send-template', requireDatabaseConnection, authenticate, async (req: Request, res: Response) => {
  try {
    const { companyId, to, templateName, parameters = [], language = 'en' } = req.body as {
      companyId?: string;
      to?: string;
      templateName?: string;
      parameters?: string[];
      language?: string;
    };

    if (!companyId || !to || !templateName) {
      return res.status(400).json({
        success: false,
        message: 'companyId, to and templateName are required'
      });
    }

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const config = await CompanyWhatsAppConfig.findOne({ companyId, isActive: true });
    if (!config) {
      return res.status(404).json({ success: false, message: 'Active WhatsApp config not found for company' });
    }

    (company as any).whatsappConfig = {
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      accessToken: config.accessToken,
      verifyToken: config.verifyToken,
      rateLimits: config.rateLimits
    };

    const result = await sendWhatsAppTemplate(company, to, templateName, parameters, language);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'Failed to send template message'
      });
    }

    return res.json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * ============================================================
 * WEBHOOK VERIFICATION (GET)
 * ============================================================
 */
router.get('/', requireDatabaseConnection, async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  try {
    if (mode === 'subscribe' && typeof token === 'string') {
      // ✅ Verify token from DB (no env fallback)
      const config = await CompanyWhatsAppConfig.findOne({
        verifyToken: token,
        isActive: true
      }).select('_id companyId phoneNumberId');

      if (config) {
        console.log('✅ WhatsApp webhook verified (DB token match)', {
          companyId: config.companyId,
          phoneNumberId: config.phoneNumberId
        });
        return res.status(200).send(challenge);
      }
    }

    return res.sendStatus(403);
  } catch (err) {
    console.error('❌ Webhook verification failed:', err);
    return res.sendStatus(403);
  }
});

/**
 * ============================================================
 * WEBHOOK RECEIVER (POST)
 * ============================================================
 */
router.post('/', requireDatabaseConnection, async (req: Request, res: Response) => {
  const signedRequest = req as WebhookRequest;
  const body = req.body;
  logger.info(`📥 Webhook POST received`);

  const verifiedWebhookContext = await verifyWebhookRequest(signedRequest);
  if (!verifiedWebhookContext) {
    logger.error('❌ Invalid webhook signature');
    return res.status(403).send('INVALID_SIGNATURE');
  }
  logger.info('✅ Webhook verified successfully', {
    phoneNumberId: verifiedWebhookContext.phoneNumberId,
    companyId: verifiedWebhookContext.config.companyId
  });

  // ✅ CRITICAL: On Vercel, we MUST await the processing before responding.
  // Using setImmediate or non-awaited promises will result in the process being killed
  // as soon as res.send() is called.
  try {
    if (body.object !== 'whatsapp_business_account') {
      logger.warn(`⚠️ Unknown webhook object: ${body.object}`);
      return res.status(200).send('EVENT_RECEIVED');
    }

    // Iterate through entries and changes to find messages
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const metadata = value?.metadata;

        // Process message delivery statuses (sent, delivered, read, failed)
        if (value?.statuses && Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            if (status.status === 'failed') {
              logger.error(`❌ [WhatsApp Webhook] Message delivery failed for ${status.recipient_id}`, {
                messageId: status.id,
                status: status.status,
                errors: status.errors,
                timestamp: status.timestamp
              });
            } else {
              logger.info(`📊 [WhatsApp Webhook] Message status '${status.status}' for ${status.recipient_id} (${status.id})`);
            }
          }
        }

        if (!value?.messages) {
          continue;
        }

        // Resolve company early
        const company = await getCompanyFromMetadata(metadata, verifiedWebhookContext.config);
        if (!company) {
          logger.error(`❌ Could not resolve company for phoneNumberId: ${metadata?.phone_number_id}.`);
          continue;
        }

        for (const message of value.messages) {
          try {
            if (!shouldProcessInboundMessage(message)) {
              logger.info('ℹ️ Ignoring non-interaction WhatsApp webhook message.', {
                type: message?.type,
                messageId: message?.id,
                from: message?.from
              });
              continue;
            }

            const messageId = message.id;

            // IDEMPOTENCY CHECK
            if (await isMessageProcessed(messageId)) {
              logger.info(`⏭️ Message ${messageId} already processed, skipping...`);
              continue;
            }

            // Mark message as processed
            await markMessageAsProcessed(messageId);

            if (message.type === 'interactive') {
              logger.info(`🔘 Interactive message received from ${message.from}`);
              await handleInteractiveMessage(message, metadata, company);
            } else {
              logger.info(`📝 ${message.type} message received from ${message.from}`);
              await handleIncomingMessage(message, metadata, company);
            }
          } catch (msgErr: any) {
            logger.error(`❌ Error processing message loop: ${msgErr.message}`, { stack: msgErr.stack });
          }
        }
      }
    }
  } catch (error: any) {
    logger.error('❌ Webhook processing failed:', error);
  }

  // Respond to WhatsApp AFTER processing is complete to ensure reliability on Vercel.
  return res.status(200).send('EVENT_RECEIVED');
});



/**
 * ============================================================
 * DYNAMIC COMPANY RESOLUTION (MULTI-TENANT)
 * ============================================================
 * Finds the company based on phone number ID from metadata.
 * ✅ Source of truth: CompanyWhatsAppConfig (DB). No env fallback.
 */
async function getCompanyFromMetadata(metadata: any, verifiedConfig?: VerifiedWebhookContext['config']): Promise<any | null> {
  const phoneNumberId = metadata?.phone_number_id;
  
  if (!phoneNumberId) {
    console.warn('⚠️ No phone number ID in metadata. Cannot resolve company.');
    return null;
  }
  
  console.log(`🔍 Looking up company by phone number ID: ${phoneNumberId}`);
  
  const config = verifiedConfig && verifiedConfig.phoneNumberId === phoneNumberId
    ? verifiedConfig
    : await CompanyWhatsAppConfig.findOne({
      phoneNumberId,
      isActive: true
    });

  if (!config) {
    console.error(`❌ WhatsApp config not found for phoneNumberId=${phoneNumberId}.`);
    return null;
  }

  const company = await Company.findById(config.companyId).lean();
  if (!company) {
    console.error(`❌ Company not found for config.companyId=${config.companyId}`);
    return null;
  }

  // Attach WA config to company for downstream services (sending / media download)
  (company as any).whatsappConfig = {
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    accessToken: config.accessToken,
    verifyToken: config.verifyToken,
    rateLimits: config.rateLimits
  };

  console.log(`✅ Company resolved by phone number ID: ${company.name} (${company.companyId})`);
  return company;
}

/**
 * ============================================================
 * HANDLE NORMAL MESSAGES
 * ============================================================
 */
async function handleIncomingMessage(message: any, metadata: any, resolvedCompany?: any) {
  try {
    // Use resolved company if provided, otherwise resolve from metadata
    const company = resolvedCompany || await getCompanyFromMetadata(metadata);
    
    if (!company) {
      console.error('❌ Could not resolve company for message');
      return;
    }

    const from = message.from;
    const messageId = message.id;
    const messageType = message.type;

    let messageText = '';
    let mediaUrl = '';
    let buttonId = '';

    if (messageType === 'text') {
      messageText = message.text?.body || '';
    } else if (messageType === 'button') {
      // Template quick-reply buttons are delivered as message.type = "button"
      // (not interactive.button_reply). Capture payload as buttonId so flow routing works.
      buttonId = message.button?.payload || '';
      messageText = message.button?.text || '';
    } else if (messageType === 'image') {
      messageText = message.image?.caption || '';
      mediaUrl = message.image?.id || '';
    } else if (messageType === 'document') {
      messageText = message.document?.caption || '';
      mediaUrl = message.document?.id || '';
    } else if (messageType === 'audio' || messageType === 'voice') {
      mediaUrl = message.audio?.id || message.voice?.id || '';
    } else if (messageType === 'video') {
      messageText = message.video?.caption || '';
      mediaUrl = message.video?.id || '';
    } else if (messageType === 'location') {
      // Capture WhatsApp location (Live or Static)
      const lat = message.location?.latitude;
      const long = message.location?.longitude;
      const address = message.location?.address || message.location?.name || '';
      messageText = `Lat: ${lat}, Long: ${long}${address ? `, Address: ${address}` : ''}`;
      // Pack location data into metadata for the engine
      (message as any).locationData = { lat, long, address };
    }

    console.log(
      `📨 Message from ${from} → Company: ${company.name} (ID: ${company.companyId})`
    );

    // 1. Update interaction timestamp immediately to open the 24h window
    await CitizenProfile.updateOne(
      { companyId: company._id, phone_number: from },
      { $set: { lastUserInteractionAt: new Date(), phoneNumber: from } },
      { upsert: true }
    );

    // 2. Update session lastMessageAt to sync window check
    const WhatsAppSession = (await import('../models/WhatsAppSession')).default;
    await WhatsAppSession.updateOne(
      { phoneNumber: from, companyId: company._id },
      { $set: { lastMessageAt: new Date() } },
      { upsert: false }
    );

    await handleConsentCommand({
      companyObjectId: company._id,
      from,
      messageText,
      company
    });

    const citizenProfile = await CitizenProfile.findOne({ companyId: company._id, phone_number: from }).select('opt_out').lean();
    const normalizedText = (messageText || '').trim().toLowerCase();
    const isOptInCommand =
      ['start', 'resume', 'hi', 'hii', 'hello', 'hie', 'hey', 'menu', 'main menu'].includes(normalizedText) ||
      /^h+i+(e+)?$/i.test(normalizedText) ||
      /^h{2,}$/i.test(normalizedText);
    if (citizenProfile?.opt_out && !isOptInCommand) {
      logger.info(`⛔ Message ignored for opted-out user ${from}`);
      return;
    }

    const response = await processWhatsAppMessage({
      companyId: company._id.toString(),
      from,
      messageText,
      messageType,
      messageId,
      mediaUrl,
      metadata,
      buttonId,
      messageTimestamp: Number(message.timestamp)
    });

    return response;
  } catch (error) {
    console.error('❌ Error in handleIncomingMessage:', error);
    throw error;
  }
}

type ConsentCommandInput = {
  companyObjectId: any;
  from: string;
  messageText: string;
  company?: any;
};

async function handleConsentCommand({
  companyObjectId,
  from,
  messageText,
  company
}: ConsentCommandInput): Promise<void> {
  const normalized = (messageText || '').trim().toLowerCase();
  if (!normalized) {
    return;
  }

  const isStopCommand = normalized === 'stop' || normalized === 'unsubscribe';
  const isStartCommand =
    ['start', 'resume', 'hi', 'hii', 'hello', 'hie', 'hey', 'menu', 'main menu'].includes(normalized) ||
    /^h+i+(e+)?$/i.test(normalized) ||
    /^h{2,}$/i.test(normalized);
  const isConsentAffirmed = normalized === 'yes' || normalized === 'i agree';

  if (!isStopCommand && !isStartCommand && !isConsentAffirmed) {
    return;
  }

  if (isStopCommand) {
    // Clear chatbot session on STOP
    try {
      const { clearSession } = await import('../services/sessionService');
      const Company = (await import('../models/Company')).default;
      const comp = await Company.findById(companyObjectId).lean();
      if (comp) {
        await clearSession(from, comp.companyId);
        console.log(`🧹 Session cleared for user ${from} due to STOP command`);
      }
    } catch (err) {
      console.error(`❌ Error clearing session on STOP: ${err}`);
    }
  }

  const consentPatch = isStopCommand
    ? {
      'sessionData.optedOut': true,
      'sessionData.consentStatus': 'opted_out',
      'sessionData.lastConsentAction': 'STOP',
      'sessionData.lastConsentAt': new Date()
    }
    : isConsentAffirmed
      ? {
        'sessionData.consentStatus': 'consent_given',
        'sessionData.lastConsentAction': 'YES',
        'sessionData.lastConsentAt': new Date()
      }
    : {
      'sessionData.optedOut': false,
      'sessionData.consentStatus': 'subscribed',
      'sessionData.lastConsentAction': 'START',
      'sessionData.lastConsentAt': new Date()
    };

  await WhatsAppSession.updateOne(
    { phoneNumber: from, companyId: companyObjectId },
    {
      $set: consentPatch
    },
    { upsert: false }
  );

  await CitizenProfile.updateOne(
    { companyId: companyObjectId, phone_number: from },
    {
      $set: isStopCommand
        ? {
            opt_out: true,
            isSubscribed: false,
            notification_consent: false,
            notificationConsent: false
          }
        : isConsentAffirmed
          ? {
              citizen_consent: true,
              consentGiven: true,
              citizen_consent_timestamp: new Date(),
              consentTimestamp: new Date(),
              consent_source: 'whatsapp_text',
              isSubscribed: true,
              opt_out: false
            }
        : {
            opt_out: false,
            isSubscribed: true
          }
    },
    { upsert: true }
  );

  if (company && isStopCommand) {
    await sendWhatsAppMessage(
      company,
      from,
      'You have been unsubscribed from grievance updates. Reply START to subscribe again.',
      { requireConsent: false, allowUnsubscribed: true, includeComplianceFooter: true }
    );
  }

  if (company && isConsentAffirmed) {
    await sendWhatsAppMessage(
      company,
      from,
      'Thank you. Your consent has been recorded. You can now continue grievance submission.',
      { requireConsent: false, includeComplianceFooter: true }
    );
  }

  logger.info(`✅ Consent command processed for ${from}: ${isStopCommand ? 'STOP' : isConsentAffirmed ? 'YES' : 'START'}`);
}

/**
 * ============================================================
 * HANDLE INTERACTIVE MESSAGES
 * ============================================================
 */
async function handleInteractiveMessage(message: any, metadata: any, resolvedCompany?: any) {
  try {
    // Use resolved company if provided, otherwise resolve from metadata
    const company = resolvedCompany || await getCompanyFromMetadata(metadata);
    
    if (!company) {
      console.error('❌ Could not resolve company for interactive message');
      return;
    }

    const from = message.from;
    const messageId = message.id;
    const interactive = message.interactive;

    let buttonId = '';
    let messageText = '';

    if (interactive?.type === 'button_reply') {
      buttonId = interactive.button_reply?.id || '';
      messageText = interactive.button_reply?.title || '';
    }

    if (interactive?.type === 'list_reply') {
      buttonId = interactive.list_reply?.id || '';
      messageText = interactive.list_reply?.title || '';
    }

    if (!buttonId) return;

    console.log(`🔘 Button "${buttonId}" clicked by ${from}`);

    await CitizenProfile.updateOne(
      { companyId: company._id, phone_number: from },
      { $set: { lastUserInteractionAt: new Date(), phoneNumber: from } },
      { upsert: true }
    );

    const response = await processWhatsAppMessage({
      companyId: company._id.toString(),
      from,
      messageText,
      messageType: 'interactive',
      messageId,
      metadata,
      buttonId,
      messageTimestamp: Number(message.timestamp)
    });

    return response;
  } catch (error) {
    console.error('❌ Error in handleInteractiveMessage:', error);
    throw error;
  }
}

function shouldProcessInboundMessage(message: any): boolean {
  if (!message || typeof message !== 'object') return false;

  const type = String(message.type || '').trim().toLowerCase();
  const from = String(message.from || '').trim();
  const messageId = String(message.id || '').trim();

  if (!type || !from || !messageId) return false;

  // Meta can emit technical/automation message types that are not explicit user interactions.
  if (['request_welcome', 'system', 'unknown', 'unsupported'].includes(type)) return false;

  if (type === 'text') {
    return Boolean(String(message.text?.body || '').trim());
  }

  if (type === 'button') {
    return Boolean(
      String(message.button?.payload || '').trim() ||
      String(message.button?.text || '').trim()
    );
  }

  if (type === 'interactive') {
    const interactiveType = String(message.interactive?.type || '').trim();
    if (interactiveType === 'button_reply') {
      return Boolean(
        String(message.interactive?.button_reply?.id || '').trim() ||
        String(message.interactive?.button_reply?.title || '').trim()
      );
    }
    if (interactiveType === 'list_reply') {
      return Boolean(
        String(message.interactive?.list_reply?.id || '').trim() ||
        String(message.interactive?.list_reply?.title || '').trim()
      );
    }
    return false;
  }

  // Treat media/location/contact as valid user interactions.
  return ['image', 'video', 'audio', 'voice', 'document', 'location', 'contacts', 'sticker'].includes(type);
}

/**
 * ============================================================
 * IDEMPOTENCY PROTECTION
 * ============================================================
 * Prevents duplicate processing of the same WhatsApp message
 */
const MESSAGE_TTL = 48 * 60 * 60; // 48 hours in seconds
const MESSAGE_TTL_MS = MESSAGE_TTL * 1000;

async function isMessageProcessed(messageId: string): Promise<boolean> {
  const redis = getRedisClient();
  if (redis && isRedisConnected()) {
    try {
      const key = `processed_message:${messageId}`;
      const exists = await redis.exists(key);
      if (exists === 1) return true;
    } catch (error) {
      console.error('❌ Error checking Redis message idempotency:', error);
    }
  }

  try {
    const existing = await ProcessedWhatsAppMessage.findOne({ messageId }).select('_id').lean();
    return Boolean(existing);
  } catch (error) {
    console.error('❌ Error checking Mongo message idempotency:', error);
    return false; // Allow processing if check fails
  }
}

async function markMessageAsProcessed(messageId: string): Promise<void> {
  const redis = getRedisClient();
  if (redis && isRedisConnected()) {
    try {
      const key = `processed_message:${messageId}`;
      await redis.setex(key, MESSAGE_TTL, '1');
    } catch (error) {
      console.error('❌ Error marking Redis message idempotency:', error);
    }
  }

  try {
    const expireAt = new Date(Date.now() + MESSAGE_TTL_MS);
    await ProcessedWhatsAppMessage.updateOne(
      { messageId },
      {
        $setOnInsert: {
          messageId,
          processedAt: new Date(),
          expireAt
        }
      },
      { upsert: true }
    );
  } catch (error: any) {
    if (error?.code !== 11000) {
      console.error('❌ Error marking Mongo message idempotency:', error);
    }
  }
}

export default router;

async function verifyWebhookRequest(req: WebhookRequest): Promise<VerifiedWebhookContext | null> {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || typeof signature !== 'string') {
    logger.warn('⚠️ Missing x-hub-signature-256 header on webhook request.');
    return null;
  }

  const body = req.body;
  const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  if (!phoneNumberId) {
    logger.warn('⚠️ Webhook payload missing phone_number_id. Signature verification skipped.');
    return null;
  }

  if (!req.rawBody) {
    logger.warn('⚠️ rawBody not available for signature verification. Ensure server.ts captures rawBody.');
    return null;
  }

  if (!signature.startsWith('sha256=')) {
    logger.warn('⚠️ Invalid webhook signature format (must start with sha256=).');
    return null;
  }

  const config = await CompanyWhatsAppConfig.findOne({
    phoneNumberId,
    isActive: true
  }).select('appSecret webhookSecret companyId phoneNumberId businessAccountId accessToken verifyToken rateLimits');

  if (!config) {
    logger.error(`❌ Active WhatsApp config not found for phoneNumberId=${phoneNumberId}.`);
    return null;
  }

  // 🛡️ MULTI-SECRET FALLBACK (Robustness for Multi-tenant)
  // Meta signs payloads using the "App Secret". However, admins might save it in:
  // 1. appSecret (Proper place)
  // 2. webhookSecret (Commonly confused)
  // 3. verifyToken (Sometimes used as fallback)
  
  const candidateSecrets = [
    config.appSecret,
    config.webhookSecret,
    config.verifyToken
  ].filter((s): s is string => Boolean(s && s.trim()));

  if (candidateSecrets.length === 0) {
    logger.error(`❌ No potential secrets available for phoneNumberId=${phoneNumberId}. Fix: Set App Secret in dashboard.`);
    return null;
  }

  let validSecret: string | null = null;
  for (const secret of candidateSecrets) {
    const isValid = verifyWebhookSignatureDigest(req.rawBody, signature, secret);
    if (isValid) {
      validSecret = secret;
      break;
    }
  }

  if (!validSecret) {
    logger.error(
      `❌ Webhook signature mismatch for phoneNumberId=${phoneNumberId}. Tried ${candidateSecrets.length} candidate secrets. ` +
      `Ensure the "App Secret" from Meta Developer Dashboard is saved in the WhatsApp Config.`
    );
    return null;
  }

  return {
    phoneNumberId,
    webhookSecret: validSecret,
    config: {
      companyId: config.companyId,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      accessToken: config.accessToken,
      verifyToken: config.verifyToken,
      rateLimits: config.rateLimits
    }
  };
}
