import mongoose from "mongoose";
import { logger } from '../config/logger';
import ChatbotFlow, { IFlowStep, IChatbotFlow } from "../models/ChatbotFlow";
import Company from "../models/Company";
import CompanyWhatsAppConfig from "../models/CompanyWhatsAppConfig";
import Grievance from "../models/Grievance";
import Appointment from "../models/Appointment";
import Department from "../models/Department";
import User from "../models/User";
import CitizenProfile from "../models/CitizenProfile";
import CompanyWhatsAppTemplate from "../models/CompanyWhatsAppTemplate";
import {
  sendWhatsAppMessage,
  sendWhatsAppButtons,
  sendWhatsAppList,
} from "./whatsappService";
import {
  UserSession,
  updateSession,
  getSession,
  getSessionFromMongo,
  clearSession,
} from "./sessionService";
import { uploadWhatsAppMediaToGCS } from "./gcsService";
import { ActionService } from "./actionService";
import { checkDailyLimit } from "./grievanceRateLimitService";
import { findDepartmentByCategory } from "./departmentMapper";
import { FlowCacheService } from "./flowCacheService";
import {
  GrievanceStatus,
  AppointmentStatus,
  UserRole,
  AuditAction,
} from "../config/constants";
import { createAuditLog } from "../utils/auditLogger";
import { getChatbotAvailabilityData } from "../routes/availability.routes";
import {
  META_GRIEVANCE_CMD_STOP,
  META_GRIEVANCE_CMD_RESTART,
  META_GRIEVANCE_CMD_MENU,
  META_GRIEVANCE_CMD_BACK,
  META_GRIEVANCE_CMD_RESPONSES
} from "../constants/metaGrievanceTemplates";

// ─── Message Interface ────────────────────────────────────────────────────────

export interface ChatbotMessage {
  companyId: string;
  from: string;
  messageText: string;
  messageType: string;
  messageId: string;
  mediaUrl?: string;
  metadata?: any;
  buttonId?: string;
  locationData?: {
    lat: number;
    long: number;
    address?: string;
  };
  messageTimestamp?: number;
}

/**
 * Pick the best-fit message text for the current session language.
 * Priority: step.messageTextTranslations[lang] → step.messageTextTranslations['en'] → step.messageText
 */
function getLocalText(step: IFlowStep, lang: string): string {
  const translations = (step as any).messageTextTranslations as
    | Record<string, string>
    | undefined;
  if (translations) {
    if (translations[lang]) return translations[lang];
    if (translations["en"]) return translations["en"];
  }
  return step.messageText || "";
}

function resolveValidationText(
  value: unknown,
  lang: string,
  fallback: string,
): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const map = value as Record<string, string>;
    if (typeof map[lang] === "string" && map[lang].trim()) return map[lang];
    if (typeof map.en === "string" && map.en.trim()) return map.en;
  }
  return fallback;
}

/**
 * Routing constants — greetings trigger a clean restart of the flow.
 * NOTE: 'menu', 'restart', 'stop', 'back' are NOT here anymore — they are
 * handled dynamically by handleFlowCommand() reading from the flow JSON,
 * so different companies can configure different keywords.
 */
const STALE_MESSAGE_THRESHOLD_SECONDS = 10 * 60; // 10 minutes

function isStaleInboundMessage(messageTimestamp?: number): boolean {
  if (!messageTimestamp || !Number.isFinite(messageTimestamp)) return false;
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return nowInSeconds - messageTimestamp > STALE_MESSAGE_THRESHOLD_SECONDS;
}

const GREETINGS = new Set([
  'hi', 'hii', 'hello', 'start', 'namaste', 'नमस्ते',
  'ନମସ୍କାର', 'helo', 'hey', 'begin', 'restart', 'restrt', 'menu', 'main menu'
]);

function isGreetingTrigger(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return false;
  if (GREETINGS.has(normalized)) return true;
  if (/^h+i+(e+)?$/i.test(normalized)) return true;
  if (/^h{2,}$/i.test(normalized)) return true;
  return false;
}

/**
 * ─── Flow Command Handler ────────────────────────────────────────────────────
 * Reads special control keywords (stop/restart/menu/back) from DB templates (CompanyWhatsAppTemplate)
 * or falls back to `settings.commands` from the active flow JSON.
 * Returns true if the input was handled as a command (caller should return).
 */
async function handleFlowCommand(
  input: string,
  session: UserSession,
  flow: IChatbotFlow,
  company: any,
  from: string,
  companyId: string,
): Promise<boolean> {
  const normalizedInput = input.trim().toLowerCase();
  const lang = session.language || "en";

  // 1. Fetch ALL command templates for this company from DB
  // These are keys starting with 'cmd_' (cmd_stop, cmd_restart, cmd_menu, cmd_back)
  const dbTemplates = await CompanyWhatsAppTemplate.find({
    companyId: company._id,
    templateKey: { $regex: /^cmd_/ },
    isActive: true
  }).lean();

  // 2. Build a prioritized list of commands
  // DB templates take priority, then flow-level settings
  const commandConfigs: Record<string, { keywords: string[], responses: any, action: string }> = {};

  // Standard Action Map
  const ACTION_MAP: Record<string, string> = {
    [META_GRIEVANCE_CMD_STOP]: 'STOP',
    [META_GRIEVANCE_CMD_RESTART]: 'RESTART',
    [META_GRIEVANCE_CMD_MENU]: 'MENU',
    [META_GRIEVANCE_CMD_BACK]: 'BACK'
  };

  // Add DB templates to map
  dbTemplates.forEach(t => {
    const action = ACTION_MAP[t.templateKey];
    if (action && t.keywords?.length) {
      commandConfigs[t.templateKey] = {
        keywords: t.keywords.map(k => k.toLowerCase()),
        responses: { [lang]: t.message },
        action
      };
    }
  });

  // Merge with flow settings (json) if not already defined in DB OR if DB has no keywords
  const flowCommands = (flow as any).settings?.commands || {};
  
  // Define absolute defaults to merge with flow settings
  const DEFAULTS: Record<string, string[]> = {
    stop: ["stop", "end", "exit", "quit", "bye", "terminate", "बंद करें", "रोको"],
    restart: ["restart", "restrt", "reset", "start again", "फिर से शुरू", "पुनः शुरू"],
    menu: ["menu", "main menu", "home", "नमस्ते", "मेन्यू", "hi", "hiii"],
    back: ["back", "previous", "prev", "go back", "पीछे", "वापस", "pichhe"]
  };

  Object.entries(flowCommands).forEach(([name, config]: [string, any]) => {
    const internalKey = name.startsWith('cmd_') ? name : `cmd_${name}`;
    const cleanName = name.toLowerCase().replace('cmd_', '');
    const keywords = new Set([
      ...(config.keywords || []).map((k: string) => k.toLowerCase()),
      ...(DEFAULTS[cleanName] || [])
    ]);

    if (!commandConfigs[internalKey] || !commandConfigs[internalKey].keywords?.length) {
      const defaultMsg = META_GRIEVANCE_CMD_RESPONSES[internalKey] || "";
      commandConfigs[internalKey] = {
        keywords: Array.from(keywords),
        responses: config.responses && Object.keys(config.responses).length > 0 ? config.responses : { [lang]: defaultMsg, en: defaultMsg },
        action: name.toUpperCase() // e.g. "stop" -> "STOP"
      };
    }
  });

  // 3. Check for keyword match
  for (const [key, config] of Object.entries(commandConfigs)) {
    const match = config.keywords.some(
      (kw) => normalizedInput === kw || normalizedInput.startsWith(kw + " "),
    );

    if (!match) continue;

    console.log(`🎮 Command detected: "${key}" (Action: ${config.action}) via input "${normalizedInput}"`);

    // Send response
    const msg = config.responses?.[lang] || config.responses?.["en"] || "";
    if (msg) await sendWhatsAppMessage(company, from, msg);

    // Execute Action
    switch (config.action) {
      case 'STOP':
        session.hasConsent = false;
        await updateSession(session);
        
        // Log the opt-out
        await createAuditLog({
          action: AuditAction.CONSENT_CHANGE,
          resource: 'WhatsAppUser',
          resourceId: from,
          companyId: company._id.toString(),
          details: {
            phoneNumber: from,
            action: 'UNSUBSCRIBE',
            message: 'User sent STOP command'
          }
        });
        await clearSession(from, companyId);
        console.log(`🛑 Session cleared via STOP command`);
        return true;

      case 'RESTART':
        await clearSession(from, companyId);
        const restartSession = await getSession(from, companyId);
        restartSession.data = { flowId: flow.flowId };
        await updateSession(restartSession);
        const restartEngine = new DynamicFlowEngine(flow, restartSession, company, from);
        await restartEngine.executeStep(flow.startStepId);
        return true;

      case 'MENU':
        // Reset navigation state but keep language
        const menuTarget = (flow as any).settings?.commands?.menu?.navigateTo || flow.startStepId;
        session.data.currentStepId = undefined;
        session.data.awaitingInput = undefined;
        session.data.awaitingMedia = undefined;
        delete session.data.stepHistory;
        delete session.data.isNavigatingBack;
        session.data.buttonMapping = {};
        session.data.listMapping = {};
        session.data.fallbackAttempts = 0;
        await updateSession(session);
        const menuEngine = new DynamicFlowEngine(flow, session, company, from);
        await menuEngine.executeStep(menuTarget);
        return true;

      case 'BACK':
        const currentId = session.data.currentStepId;
        const history = Array.isArray(session.data.stepHistory)
          ? [...session.data.stepHistory]
          : [];

        let targetId = flow.startStepId;
        while (history.length > 0) {
          const candidate = history.pop();
          if (candidate && candidate !== currentId) {
            targetId = candidate;
            break;
          }
        }

        console.log(
          `🔙 Back command: current=${currentId}, target=${targetId}, remainingHistory=${history.length}`,
        );
        
        session.data.awaitingInput = undefined;
        session.data.awaitingMedia = undefined;
        session.data.buttonMapping = {};
        session.data.listMapping = {};
        session.data.fallbackAttempts = 0;
        session.data.stepHistory = history;
        session.data.isNavigatingBack = true;
        
        // Important: clear currentStepId so executeStep doesn't think it's a repeat
        session.data.currentStepId = undefined;
        
        await updateSession(session);
        const backEngine = new DynamicFlowEngine(flow, session, company, from);
        await backEngine.executeStep(targetId);
        return true;

      default:
        // For custom commands defined in JSON that use navigateTo
        if ((flowCommands[key] || flowCommands[key.replace('cmd_', '')])?.navigateTo) {
          const target = (flowCommands[key] || flowCommands[key.replace('cmd_', '')]).navigateTo;
          session.data.currentStepId = undefined;
          await updateSession(session);
          const engine = new DynamicFlowEngine(flow, session, company, from);
          await engine.executeStep(target);
          return true;
        }
    }
    return true;
  }

  return false;
}

/**
 * Localization helper for UI strings
 * All user-facing chatbot messages live in src/config/uiStrings.json.
 * Edit that file to change any message — no code changes needed.
 * Priorities:
 * 1. flow.translations[lang][key]
 * 2. flow.settings.errorFallbackMessage (for 'error_fallback' key)
 * 3. global UI_STRINGS fallback (from uiStrings.json)
 */
// Import UI strings instead of require to ensure they are included in the dist folder by tsc
import UI_STRINGS_IMPORT from "../config/uiStrings.json";
const UI_STRINGS: Record<
  string,
  Record<string, string>
> = UI_STRINGS_IMPORT as any;

function ui(key: string, lang: string, flow?: IChatbotFlow | null): string {
  // 1. Flow-wide settings fallback
  if (
    key === "error_fallback" &&
    (flow as any)?.settings?.errorFallbackMessage
  ) {
    return (flow as any).settings.errorFallbackMessage;
  }

  // 2. Flow-specific translation map
  if (flow?.translations?.[lang]?.[key]) {
    return flow.translations[lang][key];
  }

  // 3. Global defaults
  const translations = UI_STRINGS[key];
  if (!translations) return key;
  return translations[lang] || translations["en"] || key;
}

function getSubmissionLimitReachedMessage(): string {
  return [
    "⚠️ *Submission Limit Reached*",
    "",
    "Citizen can submit up to 3 grievances per day (IST). You have reached the daily submission limit. Please try again tomorrow.",
    "",
    "⚠️ *सबमिशन सीमा पूरी हो गई*",
    "",
    "नागरिक प्रतिदिन (IST) अधिकतम 3 शिकायतें दर्ज कर सकते हैं। आपने आज की दैनिक सीमा पूरी कर ली है। कृपया कल फिर प्रयास करें।",
    "",
    "⚠️ *ଦାଖଲ ସୀମା ପୂର୍ଣ୍ଣ ହୋଇଛି*",
    "",
    "ନାଗରିକ ପ୍ରତିଦିନ (IST) ସର୍ବାଧିକ 3ଟି ଅଭିଯୋଗ ଦାଖଲ କରିପାରିବେ। ଆପଣ ଆଜିର ଦୈନିକ ସୀମାକୁ ପହଞ୍ଚିଛନ୍ତି। ଦୟାକରି ଆସନ୍ତାକାଲି ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।",
  ].join("\n");
}

/**
 * Dynamic Flow Execution Engine
 *
 * Executes customizable chatbot flows defined in the database
 * Supports multi-step conversations with branching logic
 */

export class DynamicFlowEngine {
  private flow: IChatbotFlow;
  private session: UserSession;
  private company: any;
  private userPhone: string;
  private executionDepth: number = 0;

  constructor(
    flow: IChatbotFlow,
    session: UserSession,
    company: any,
    userPhone: string,
  ) {
    this.flow = flow;
    this.session = session;
    this.company = company;
    this.userPhone = userPhone;
  }

  /**
   * Internal UI localization helper.
   * Uses flow-defined translations first, then falls back to global defaults.
   */
  private ui(key: string): string {
    return ui(key, this.session.language || "en", this.flow);
  }

  private async persistConsentSelection(stepId: string, buttonId: string): Promise<void> {
    if (!stepId || !buttonId) return;

    const normalizedButtonId = String(buttonId).toLowerCase();
    const consentTimestamp = new Date();
    let shouldUpdateSession = false;

    if (stepId.startsWith("grv_consent_data_")) {
      const consentAccepted = normalizedButtonId.includes("consent_data_yes");
      const consentDeclined = normalizedButtonId.includes("consent_data_no");

      if (consentAccepted || consentDeclined) {
        this.session.data.citizenConsent = consentAccepted;
        shouldUpdateSession = true;

        await CitizenProfile.updateOne(
          { companyId: this.company._id, phone_number: this.userPhone },
          {
            $set: consentAccepted
              ? {
                  phoneNumber: this.userPhone,
                  citizen_consent: true,
                  consentGiven: true,
                  citizen_consent_timestamp: consentTimestamp,
                  consentTimestamp: consentTimestamp,
                  consent_source: "whatsapp_button",
                  opt_out: false,
                  isSubscribed: true
                }
              : {
                  phoneNumber: this.userPhone,
                  citizen_consent: false,
                  consentGiven: false
                }
          },
          { upsert: true }
        );
      }
    }

    if (stepId.startsWith("grv_consent_updates_")) {
      const consentAccepted = normalizedButtonId.includes("consent_updates_yes");
      const consentDeclined = normalizedButtonId.includes("consent_updates_no");

      if (consentAccepted || consentDeclined) {
        this.session.data.notificationConsent = consentAccepted;
        shouldUpdateSession = true;

        await CitizenProfile.updateOne(
          { companyId: this.company._id, phone_number: this.userPhone },
          {
            $set: {
              phoneNumber: this.userPhone,
              notification_consent: consentAccepted,
              notificationConsent: consentAccepted,
              notification_consent_timestamp: consentTimestamp
            }
          },
          { upsert: true }
        );
      }
    }

    if (shouldUpdateSession) {
      await updateSession(this.session);
    }
  }

  /**
   * Run the next step by nextStepId if it is set and different from current (avoids loops / same step repeat).
   */
  private async runNextStepIfDifferent(
    nextStepId: string | undefined,
    fromStepId: string,
  ): Promise<void> {
    const id = nextStepId && String(nextStepId).trim();
    if (!id) return;
    if (id === fromStepId) {
      console.warn(
        `⚠️ Skipping same step "${fromStepId}" to avoid repeat (nextStepId === current step)`,
      );
      return;
    }
    await this.executeStep(id);
  }

  /**
   * Execute a specific step in the flow.
   * Auto-advances to nextStepId when the step does not require user input; same step is never repeated.
   */
  async executeStep(
    stepId: string,
    userInput?: string,
    locationData?: { lat: number; long: number; address?: string },
  ): Promise<void> {
    // Prevent automated loops/chains from sending too many messages at once
    if (this.executionDepth > 10) {
      console.error(`🛑 Max execution depth (10) reached for ${this.userPhone}. Aborting to prevent loop.`);
      return;
    }
    this.executionDepth++;

    let step = this.flow.steps.find((s) => s.stepId === stepId);
    // If not found, try base step ID (e.g. grievance_category_en -> grievance_category) so flows with single department step work
    if (!step && stepId && /_.+$/.test(stepId)) {
      const baseId = stepId.replace(/_[a-z]{2}$/i, ""); // e.g. grievance_category_en -> grievance_category
      step = this.flow.steps.find((s) => s.stepId === baseId);
      if (step) {
        console.log(
          `   Using step "${baseId}" (requested "${stepId}" not found)`,
        );
      }
    }
    if (!step) {
      console.error(`❌ Step ${stepId} not found in flow ${this.flow.flowId}`);
      await this.sendErrorMessage();
      return;
    }

    // SESSION TRACKING: keep interactive step history for multi-level "back" command
    const oldStepId = this.session.data.currentStepId;
    const oldStep = oldStepId ? this.flow.steps.find(s => s.stepId === oldStepId) : null;
    const isOldStepInteractive = oldStep && ["buttons", "list", "input", "media"].includes(oldStep.stepType);
    const isNavigatingBack = this.session.data.isNavigatingBack === true;
    const existingHistory = Array.isArray(this.session.data.stepHistory)
      ? this.session.data.stepHistory
      : [];

    if (oldStepId && oldStepId !== stepId && isOldStepInteractive && !isNavigatingBack) {
      const trimmedHistory = existingHistory.slice(-24);
      const lastHistoryStep = trimmedHistory[trimmedHistory.length - 1];
      if (lastHistoryStep !== oldStepId) {
        trimmedHistory.push(oldStepId);
      }
      this.session.data.stepHistory = trimmedHistory;
    } else if (!Array.isArray(this.session.data.stepHistory)) {
      this.session.data.stepHistory = existingHistory;
    }

    if (isNavigatingBack) {
      delete this.session.data.isNavigatingBack;
    }

    // FIX: Force stepType for misconfigured nodes (e.g. start nodes saved as message by old builder versions)
    if (
      step &&
      step.stepId &&
      (step.stepId.startsWith("start_") || step.stepId === "start") &&
      step.stepType !== "start"
    ) {
      console.log(
        `🔧 Forcing stepType "start" for node ${step.stepId} (was ${step.stepType})`,
      );
      step.stepType = "start" as any;
    }

    // Avoid re-sending the same interactive step only when we have already sent it (e.g. buttonMapping/listMapping set for this step)
    const currentStepId = this.session.data?.currentStepId;
    const isInteractive = ["buttons", "list", "input"].includes(step.stepType);
    const alreadySentThisStep =
      currentStepId === stepId &&
      isInteractive &&
      userInput === undefined &&
      (step.stepType === "buttons"
        ? this.session.data?.buttonMapping &&
          Object.keys(this.session.data.buttonMapping).length > 0
        : step.stepType === "list"
          ? this.session.data?.listMapping &&
            Object.keys(this.session.data.listMapping).length > 0
          : step.stepType === "input"
            ? !!this.session.data?.awaitingInput
            : false);
    if (alreadySentThisStep) {
      console.warn(
        `⚠️ Same step "${stepId}" (${step.stepType}) already sent; not repeating`,
      );
      return;
    }

    console.log(`🔄 Executing step: ${step.stepName} (${step.stepType})`);

    try {
      // Normalize step type (handle camelCase variants from React Flow imports)
      let type = (step.stepType || (step as any).type || "").toLowerCase();
      if (type === "textmessage") type = "message";
      if (type === "buttonmessage") type = "buttons";
      if (type === "listmessage") type = "list";
      if (type === "userinput") type = "input";
      if (type === "apicall") type = "api_call";

      switch (type) {
        case "start":
          // Start node should not send any message, just advance to next step
          console.log(`⏭️ Start node detected, skipping to next step`);
          this.session.data.currentStepId = step.stepId;
          await updateSession(this.session);
          await this.runNextStepIfDifferent(step.nextStepId, step.stepId);
          break;

        case "message":
          await this.executeMessageStep(step);
          break;

        case "buttons":
          await this.executeButtonsStep(step);
          break;

        case "list":
          // Check for specific dynamic sources
          const isDynamicSubDepts =
            (step.listConfig as any)?.dynamicSource === "sub-departments" ||
            ((step.listConfig as any)?.isDynamic === true &&
              (step.stepId?.includes("subdept") ||
                step.stepId?.includes("sub_dept")));

          const isDynamicDepts =
            !isDynamicSubDepts &&
            (step.listConfig?.listSource === "departments" ||
              (step.listConfig as any)?.dynamicSource === "departments" ||
              (step.listConfig as any)?.isDynamic === true);

          if (isDynamicSubDepts) {
            const parentId =
              this.session.data.departmentId ||
              this.session.data.lastParentDeptId;
            const prefix =
              step.stepId &&
              (step.stepId.startsWith("apt") ||
                step.stepId.includes("appointment"))
                ? "apt"
                : "grv";
            if (parentId) {
              await this.loadSubDepartmentsForListStep(step, parentId, prefix);
            } else {
              console.warn(
                `⚠️ Attempted to load sub-departments but no departmentId in session. Falling back to departments.`,
              );
              await this.loadDepartmentsForListStep(step);
            }
          } else if (isDynamicDepts) {
            await this.loadDepartmentsForListStep(step);
          } else {
            await this.executeListStep(step);
          }
          break;

        case "input":
          await this.executeInputStep(step, userInput, locationData);
          break;

        case "media":
          await this.executeMediaStep(step);
          break;

        case "condition":
          await this.executeConditionStep(step);
          break;

        case "api_call":
          await this.executeApiCallStep(step);
          break;

        case "assign_department":
          await this.executeAssignDepartmentStep(step);
          break;

        case "end":
          await this.executeEndStep(step);
          break;

        default:
          console.error(`❌ Unknown step type: ${step.stepType}`);
          await this.sendErrorMessage();
      }
    } catch (error: any) {
      console.error(`❌ Error executing step ${stepId}:`, error);
      console.error(`   Error details:`, {
        message: error.message,
        stack: error.stack,
        stepId,
        stepType: step?.stepType,
        flowId: this.flow.flowId,
      });

      // Try to send error message
      try {
        await this.sendErrorMessage();
      } catch (sendError: any) {
        console.error(`❌ Failed to send error message:`, sendError);
        // Last resort: try to send a simple text message
        try {
          const { sendWhatsAppMessage } = await import("./whatsappService");
          await sendWhatsAppMessage(
            this.company,
            this.userPhone,
            "⚠️ We encountered an error. Please try again later or contact support.",
          );
        } catch (finalError: any) {
          console.error(`❌ Complete failure to send any message:`, finalError);
        }
      }
    }
  }

  /**
   * Resolve next step ID from edges or step config
   */
  private resolveNextStepId(
    stepId: string,
    sourceHandle?: string,
  ): string | null {
    const step = this.flow.steps.find((s) => s.stepId === stepId);
    if (!step) return null;

    if (sourceHandle) {
      const edge = this.flow.edges?.find(
        (e) => e.source === stepId && e.sourceHandle === sourceHandle,
      );
      if (edge) return edge.target;
    }

    // Default edge (no sourceHandle)
    const edge = this.flow.edges?.find(
      (e) => e.source === stepId && !e.sourceHandle,
    );
    if (edge) return edge.target;

    return step.nextStepId || null;
  }

  /**
   * Execute message step - Send a simple text message
   * Special handling: grievance_category (or grievance_category_en etc.) loads departments; steps with buttons send buttons
   */
  private async executeMessageStep(step: IFlowStep): Promise<void> {
    const stepId = step.stepId || "";
    const messageText = step.messageText || "";

    // Simple message step - no special ID fallbacks for departments anymore to avoid duplicates
    // Rely exclusively on step.stepType === 'list' with isDynamic: true in the flow.

    // Special handling for track_result: fetch grievance or appointment by refNumber and set session.data for placeholders (status, assignedTo, remarks)
    if (
      step.stepId?.includes("track_result") ||
      step.stepId?.includes("trk_result")
    ) {
      await this.loadTrackResultIntoSession();
      const lang = this.session.language || "en";
      const isNotFound =
        this.session.data.status === "Not Found" ||
        this.session.data.status === "Invalid" ||
        this.session.data.status === "Error";

      const messageTemplate = isNotFound
        ? this.ui("track_not_found")
        : this.ui("track_found");
      const message = this.replacePlaceholders(messageTemplate);

      const buttons = [
        {
          id: `trk_${lang}`,
          title: this.ui("track_another") || "🔍 Track Another",
        },
        {
          id: `main_menu_${lang}`,
          title: this.ui("main_menu_btn") || "↩️ Main Menu",
        },
      ];

      await sendWhatsAppButtons(this.company, this.userPhone, message, buttons);

      this.session.data.currentStepId = step.stepId;
      this.session.data.buttonMapping = {
        [`trk_${lang}`]: `trk_start_${lang}`,
        [`main_menu_${lang}`]: `main_menu_${lang}`,
      };
      await updateSession(this.session);
      return;
    }

    // If step has buttons (e.g. language_selection saved as "message" from dashboard), send as buttons
    if (step.buttons && step.buttons.length > 0) {
      const lang = this.session.language || "en";
      const message = this.replacePlaceholders(getLocalText(step, lang));
      const buttons = step.buttons.map((btn) => ({
        id: btn.id,
        title: (btn as any).titleTranslations?.[lang] || btn.title,
      }));
      await sendWhatsAppButtons(this.company, this.userPhone, message, buttons);
      this.session.data.currentStepId = step.stepId;
      this.session.data.buttonMapping = {};
      step.buttons.forEach((btn) => {
        const nextId = btn.nextStepId || this.resolveNextStepId(step.stepId, btn.id);
        if (nextId) {
          this.session.data.buttonMapping[btn.id] = nextId;
        }
      });
      await updateSession(this.session);
      return;
    }

    const message = this.replacePlaceholders(
      getLocalText(step, this.session.language || "en"),
    );

    // FIX: Avoid sending empty messages (would cause WhatsApp error #100)
    if (!message || message.trim() === "") {
      console.warn(`⚠️ Skipping empty message for step ${step.stepId}`);
      this.session.data.currentStepId = step.stepId;
      await updateSession(this.session);
      await this.runNextStepIfDifferent(step.nextStepId, step.stepId);
      return;
    }

    const msgLower = (step.messageText || "").toLowerCase();

    // Photo/media upload prompt: wait for user to send photo or skip (do NOT auto-advance)
    const isPhotoUploadPrompt =
      (step.stepId &&
        /photo_upload|photo_upload_wait|grievance_photo_upload/i.test(
          step.stepId,
        )) ||
      msgLower.includes("send a photo") ||
      msgLower.includes("send a document") ||
      (msgLower.includes("upload") && msgLower.includes("photo"));
    if (isPhotoUploadPrompt && step.nextStepId) {
      await sendWhatsAppMessage(this.company, this.userPhone, message);
      this.session.data.currentStepId = step.stepId;
      this.session.data.awaitingMedia = {
        mediaType: "image",
        optional: true,
        saveToField: "media",
        nextStepId: step.nextStepId,
      };
      await updateSession(this.session);
      return;
    }

    await sendWhatsAppMessage(this.company, this.userPhone, message);
    this.session.data.currentStepId = step.stepId;
    await updateSession(this.session);
    await this.runNextStepIfDifferent(step.nextStepId, step.stepId);
  }

  /**
   * Load and display sub-departments for a selected parent department
   * Works for both grievance and appointment flows (uses prefix from parent)
   */
  private async loadSubDepartmentsForListStep(
    step: IFlowStep,
    parentId: string,
    rowIdPrefix: string = "grv",
  ): Promise<void> {
    try {
      const Department = (await import("../models/Department")).default;
      const lang = this.session.language || "en";

      console.log(
        `🏢 Loading sub-departments for parent: ${parentId} (Prefix: ${rowIdPrefix})`,
      );

      const subDepartments = await Department.find({
        parentDepartmentId: parentId,
        _id: { $ne: parentId }, // Ensure we don't return the parent itself if data is inconsistent
        isActive: true,
      }).sort({ name: 1, createdAt: 1 });

      // Special check: If the next flow node after the dept step explicitly handles sub-departments,
      // skip injecting our own dynamic sub-dept menu to avoid showing it twice.
      const stepForSubDeptCheck = this.flow.steps.find(
        (s) => s.stepId === this.session.data.currentStepId,
      );
      if (stepForSubDeptCheck && stepForSubDeptCheck.nextStepId) {
        const nextStep = this.flow.steps.find(
          (s) => s.stepId === stepForSubDeptCheck.nextStepId,
        );
        const isNextStepSubDept =
          nextStep &&
          ((nextStep.listConfig as any)?.dynamicSource === "sub-departments" ||
            (nextStep.listConfig as any)?.isDynamic === true);

        if (isNextStepSubDept) {
          console.log(
            `⏩ Next flow node is already a sub-dept node. Advancing directly to it instead of injecting menu.`,
          );
          this.session.data.departmentId = parentId; // Ensure parent is saved
          await updateSession(this.session);
          await this.executeStep(stepForSubDeptCheck.nextStepId);
          return;
        }
      }

      if (subDepartments.length === 0) {
        console.warn(
          `⚠️ No sub-departments found for parent ${parentId}. Proceeding to next step.`,
        );
        const nextId = this.resolveNextStepId(step.stepId);
        if (nextId) {
          await this.executeStep(nextId);
        } else {
          // Fallback if no edge found
          await this.executeStep(
            rowIdPrefix === "apt"
              ? "appointment_date"
              : "grievance_description",
          );
        }
        return;
      }

      const rows = subDepartments.map((dept: any) => {
        let displayName: string;
        if (lang === "hi" && dept.nameHi && dept.nameHi.trim()) {
          displayName = dept.nameHi.trim();
        } else if (lang === "or" && dept.nameOr && dept.nameOr.trim()) {
          displayName = dept.nameOr.trim();
        } else if (lang === "mr" && dept.nameMr && dept.nameMr.trim()) {
          displayName = dept.nameMr.trim();
        } else {
          displayName = dept.name;
        }

        let displayDesc: string;
        if (lang === "hi" && dept.descriptionHi && dept.descriptionHi.trim()) {
          displayDesc = dept.descriptionHi.trim();
        } else if (
          lang === "or" &&
          dept.descriptionOr &&
          dept.descriptionOr.trim()
        ) {
          displayDesc = dept.descriptionOr.trim();
        } else if (
          lang === "mr" &&
          dept.descriptionMr &&
          dept.descriptionMr.trim()
        ) {
          displayDesc = dept.descriptionMr.trim();
        } else {
          displayDesc = (dept.description || "").substring(0, 72);
        }

        return {
          id: `${rowIdPrefix}_sub_dept_${dept._id}`,
          title:
            displayName.length > 24
              ? displayName.substring(0, 21) + "..."
              : displayName,
          description: displayName.length > 24 ? displayName.substring(0, 72) : displayDesc,
        };
      });

      const sections = [
        {
          title: this.ui("select_dept"),
          rows: rows,
        },
      ];

      // Update list mapping for sub-departments — reuse stepForSubDeptCheck
      const subDeptMappingStepId = step.stepId;
      const nextStepFromFlow = this.resolveNextStepId(subDeptMappingStepId);

      this.session.data.currentStepId = step.stepId;
      this.session.data.buttonMapping = {};
      this.session.data.listMapping = {};
      rows.forEach((row: any) => {
        this.session.data.listMapping[row.id] =
          nextStepFromFlow ||
          (rowIdPrefix === "apt"
            ? "appointment_date"
            : "grievance_description");
      });
      await updateSession(this.session);

      try {
        const message = this.replacePlaceholders(
          getLocalText(step, lang) || this.ui("sub_dept_title"),
        );
        await sendWhatsAppList(
          this.company,
          this.userPhone,
          message,
          this.ui("sub_dept_btn"),
          sections,
        );
      } catch (error) {
        console.error("❌ Failed to send sub-dept list:", error);
      }
    } catch (error: any) {
      console.error("❌ Error loading sub-departments:", error);
    }
  }

  /**
   * Execute buttons step - Send message with buttons
   */
  private async executeButtonsStep(step: IFlowStep): Promise<void> {
    if (!step.buttons || step.buttons.length === 0) {
      console.error("❌ Buttons step has no buttons defined");
      return;
    }

    const lang = this.session.language || "en";
    const message = this.replacePlaceholders(getLocalText(step, lang));
    const buttons = step.buttons.map((btn) => ({
      id: btn.id,
      title: (btn as any).titleTranslations?.[lang] || btn.title,
    }));

    await sendWhatsAppButtons(this.company, this.userPhone, message, buttons);

    // Save button step info to session for handling response
    this.session.data.currentStepId = step.stepId;
    this.session.data.buttonMapping = {};
    step.buttons.forEach((btn) => {
      const nextId = btn.nextStepId || this.resolveNextStepId(step.stepId, btn.id);
      if (nextId) {
        this.session.data.buttonMapping[btn.id] = nextId;
      }
    });

    // ✅ CRITICAL: Save session after creating button mapping
    await updateSession(this.session);
  }

  /**
   * Execute list step - Send WhatsApp list (manual sections or dynamic departments)
   */
  private async executeListStep(step: IFlowStep): Promise<void> {
    if (!step.listConfig) {
      console.error("❌ List step has no list configuration");
      return;
    }

    // Dynamic flows are now handled by the switch in executeStep.
    // If we reach here, it's a manual list step.

    const lang = this.session.language || "en";
    const message = this.replacePlaceholders(getLocalText(step, lang));

    // Map sections and rows to their translated versions
    const translatedSections = (step.listConfig.sections || []).map(
      (section) => ({
        title: section.title, // Section titles don't have translations in schema yet, adding if needed or just using default
        rows: section.rows.map((row) => ({
          id: row.id,
          title: (row as any).titleTranslations?.[lang] || row.title,
          description:
            (row as any).descriptionTranslations?.[lang] || row.description,
          nextStepId: row.nextStepId,
        })),
      }),
    );

    await sendWhatsAppList(
      this.company,
      this.userPhone,
      message,
      step.listConfig.buttonText,
      translatedSections,
    );

    this.session.data.currentStepId = step.stepId;
    this.session.data.listMapping = {};
    translatedSections.forEach((section) => {
      section.rows.forEach((row) => {
        const nextId = row.nextStepId || this.resolveNextStepId(step.stepId, row.id);
        if (nextId) {
          this.session.data.listMapping[row.id] = nextId;
        }
      });
    });
    await updateSession(this.session);
  }

  /**
   * Load departments from DB and send as list (for list steps with listSource: 'departments')
   */
  private async loadDepartmentsForListStep(step: IFlowStep): Promise<void> {
    const lang = this.session.language || "en";
    try {
      const Department = (await import("../models/Department")).default;

      // Get ALL departments for this company first
      let allDepts = await Department.find({
        companyId: this.company._id,
        isActive: true,
      }).sort({ displayOrder: 1, name: 1, createdAt: 1 });

      if (allDepts.length === 0) {
        console.warn(
          `⚠️ No departments found for ObjectId companyId: ${this.company._id}. Trying string comparison...`,
        );
        allDepts = await Department.find({
          companyId: this.company._id.toString(),
          isActive: true,
        }).sort({ displayOrder: 1, name: 1, createdAt: 1 });
      }

      // Check if hierarchical departments module is enabled
      const hierarchicalEnabled = this.company.enabledModules?.includes(
        "HIERARCHICAL_DEPARTMENTS",
      );

      let departments = allDepts;

      if (hierarchicalEnabled) {
        // Filter for top-level departments (no parent) only if module is enabled
        departments = allDepts.filter((d: any) => !d.parentDepartmentId);

        // Fallback: if no hierarchy is defined, show all
        if (departments.length === 0 && allDepts.length > 0) {
          console.warn(
            `⚠️ Hierarchical Departments enabled but no top-level departments found for company ${this.company._id}. Falling back to all departments.`,
          );
          departments = allDepts;
        }
      }

      departments = departments.sort((a: any, b: any) => {
        const rankA = typeof a.displayOrder === "number" ? a.displayOrder : 999;
        const rankB = typeof b.displayOrder === "number" ? b.displayOrder : 999;
        if (rankA !== rankB) return rankA - rankB;
        return (a.name || "").localeCompare(b.name || "");
      });

      if (departments.length === 0) {
        await sendWhatsAppMessage(
          this.company,
          this.userPhone,
          this.ui("no_dept"),
        );
        await this.runNextStepIfDifferent(step.nextStepId, step.stepId);
        return;
      }

      const offset = this.session.data.deptOffset || 0;
      const visibleDepts = departments.slice(offset, offset + 9);
      const remainingDepts = departments.slice(offset + 9);

      const deptRows = visibleDepts.map((dept: any) => {
        let displayName: string;
        if (lang === "hi" && dept.nameHi && dept.nameHi.trim()) {
          displayName = dept.nameHi.trim();
        } else if (lang === "or" && dept.nameOr && dept.nameOr.trim()) {
          displayName = dept.nameOr.trim();
        } else if (lang === "mr" && dept.nameMr && dept.nameMr.trim()) {
          displayName = dept.nameMr.trim();
        } else {
          displayName = dept.name;
        }

        let displayDesc: string;
        if (lang === "hi" && dept.descriptionHi && dept.descriptionHi.trim()) {
          displayDesc = dept.descriptionHi.trim();
        } else if (
          lang === "or" &&
          dept.descriptionOr &&
          dept.descriptionOr.trim()
        ) {
          displayDesc = dept.descriptionOr.trim();
        } else if (
          lang === "mr" &&
          dept.descriptionMr &&
          dept.descriptionMr.trim()
        ) {
          displayDesc = dept.descriptionMr.trim();
        } else {
          displayDesc = (dept.description || "").substring(0, 72);
        }

        const prefix =
          step.stepId &&
          (step.stepId.startsWith("apt") || step.stepId.includes("appointment"))
            ? "apt"
            : "grv";

        return {
          id: `${prefix}_dept_${dept._id}`,
          title:
            displayName.length > 24
              ? displayName.substring(0, 21) + "..."
              : displayName,
          description:
            displayName.length > 24
              ? displayName.substring(0, 72)
              : displayDesc,
          nextStepId: step.nextStepId,
        };
      });

      if (remainingDepts.length > 0) {
        deptRows.push({
          id: "grv_load_more",
          title: this.ui("load_more"),
          description:
            lang === "hi"
              ? "और विभाग देखें"
              : lang === "or"
                ? "ଅଧିକ ବିଭାଗ ଦେଖନ୍ତୁ"
                : "See more departments...",
          nextStepId: step.stepId,
        });
      }

      const listConfig = step.listConfig!;
      const sections = [
        {
          title: listConfig.buttonText || this.ui("select_dept"),
          rows: deptRows,
        },
      ];

      const message = this.replacePlaceholders(
        getLocalText(step, lang) || this.ui("view_dept"),
      );
      await sendWhatsAppList(
        this.company,
        this.userPhone,
        message,
        listConfig.buttonText || this.ui("view_dept"),
        sections,
      );

      this.session.data.currentStepId = step.stepId;
      this.session.data.listMapping = {};
      deptRows.forEach((row: any) => {
        this.session.data.listMapping[row.id] =
          row.nextStepId || step.nextStepId;
      });
      await updateSession(this.session);
    } catch (error: any) {
      console.error("❌ Error loading departments for list step:", error);
      await sendWhatsAppMessage(
        this.company,
        this.userPhone,
        this.ui("no_dept"),
      );
    }
  }

  /**
   * Execute input step - Request user input
   * For image/document/video we wait for actual media (or skip keyword); text does not advance.
   */
  private async executeInputStep(
    step: IFlowStep,
    userInput?: string,
    locationData?: { lat: number; long: number; address?: string },
  ): Promise<void> {
    if (!step.inputConfig) {
      console.error("❌ Input step has no input configuration");
      return;
    }

    // Handle incoming Location
    if (locationData) {
      console.log(`📍 Storing location: ${locationData.lat}, ${locationData.long}`);
      this.session.data.latitude = locationData.lat;
      this.session.data.longitude = locationData.long;
      if (locationData.address) this.session.data.locationAddress = locationData.address;
      
      // If we are currently in a generic location field step, save a human-readable value
      // without overriding the canonical address field.
      if (step.inputConfig.saveToField) {
        if (step.inputConfig.saveToField === "locationAddress") {
          this.session.data[step.inputConfig.saveToField] =
            locationData.address ||
            `Lat: ${locationData.lat}, Long: ${locationData.long}`;
        } else {
          this.session.data[step.inputConfig.saveToField] =
            `Lat: ${locationData.lat}, Long: ${locationData.long}`;
        }
      }

      delete this.session.data.awaitingInput;
      await updateSession(this.session);
      const nextId = step.inputConfig.nextStepId || step.nextStepId;
      if (nextId) await this.runNextStepIfDifferent(nextId, step.stepId);
      return;
    }

    const isMediaInput = ["image", "document", "video", "file"].includes(
      step.inputConfig.inputType,
    );

    // If no user input yet, send the prompt
    if (!userInput) {
      const lang = this.session.language || "en";
      const rawMessage = getLocalText(step, lang);

      // Detect ugly auto-generated messages like "Please provide your attachmentUrl:"
      const isAutoGenerated =
        rawMessage &&
        /^Please provide your [a-zA-Z]+:/i.test(rawMessage.trim());

      // For media/file inputs, use a friendly upload prompt if no proper message is configured
      let message: string;
      if (isMediaInput && (!rawMessage || isAutoGenerated)) {
        message = this.replacePlaceholders(this.ui("upload_photo"));
      } else {
        message = this.replacePlaceholders(
          rawMessage || "📝 Please provide your input:",
        );
      }

      await sendWhatsAppMessage(this.company, this.userPhone, message);

      this.session.data.currentStepId = step.stepId;
      if (isMediaInput) {
        // Wait for actual media (or skip); do not advance on text
        // 'file' type maps to 'document' for WhatsApp media handling
        const mediaType = (
          step.inputConfig.inputType === "file"
            ? "document"
            : step.inputConfig.inputType
        ) as "image" | "document" | "video";
        this.session.data.awaitingMedia = {
          mediaType,
          optional: !step.inputConfig.validation?.required,
          saveToField: step.inputConfig.saveToField || "media",
          nextStepId: step.inputConfig.nextStepId || step.nextStepId,
        };
        delete this.session.data.awaitingInput;
      } else {
        this.session.data.awaitingInput = {
          type: step.inputConfig.inputType,
          saveToField: step.inputConfig.saveToField,
          validation: step.inputConfig.validation,
          nextStepId: step.inputConfig.nextStepId,
        };
      }
      await updateSession(this.session);
      return;
    }

    // For media input types, text is not valid input – only media or skip advances (handled in chatbotEngine)
    if (isMediaInput) {
      const skipKeywords = [
        "back",
        "skip",
        "cancel",
        "no",
        "no thanks",
        "continue without",
        "without photo",
        "na",
        "n/a",
      ];
      const textLower = (userInput || "").trim().toLowerCase();
      const isSkip = skipKeywords.some(
        (k) => textLower === k || textLower.includes(k),
      );
      if (isSkip) {
        const nextStepId = step.inputConfig.nextStepId || step.nextStepId;
        delete this.session.data.awaitingMedia;
        delete this.session.data.awaitingInput;
        await updateSession(this.session);
        if (nextStepId)
          await this.runNextStepIfDifferent(nextStepId, step.stepId);
      } else {
        await sendWhatsAppMessage(
          this.company,
          this.userPhone,
          this.ui("upload_photo"),
        );
      }
      return;
    }

    // Validate user input (text/number/email etc.)
    const validation = step.inputConfig.validation;
    if (validation) {
      if (validation.required && !userInput) {
        await sendWhatsAppMessage(
          this.company,
          this.userPhone,
          validation.errorMessage || "This field is required.",
        );
        return;
      }

      if (validation.minLength && userInput.length < validation.minLength) {
        const lang = this.session.language || "en";
        await sendWhatsAppMessage(
          this.company,
          this.userPhone,
          resolveValidationText(
            (validation as any).minLengthMessage,
            lang,
            `Input must be at least ${validation.minLength} characters.`,
          ),
        );
        return;
      }

      if (validation.maxLength && userInput.length > validation.maxLength) {
        const lang = this.session.language || "en";
        await sendWhatsAppMessage(
          this.company,
          this.userPhone,
          resolveValidationText(
            (validation as any).maxLengthMessage,
            lang,
            `Input must not exceed ${validation.maxLength} characters.`,
          ),
        );
        return;
      }

      if (validation.pattern) {
        const regex = new RegExp(validation.pattern);
        if (!regex.test(userInput)) {
          await sendWhatsAppMessage(
            this.company,
            this.userPhone,
            validation.errorMessage || "Invalid input format.",
          );
          return;
        }
      }
    }

    // Save user input to session
    if (step.inputConfig.saveToField) {
      this.session.data[step.inputConfig.saveToField] = userInput;
    }
    // Clear awaitingInput so next message is not treated as input for this step
    this.session.data.fallbackAttempts = 0;
    delete this.session.data.awaitingInput;
    await updateSession(this.session);

    // Auto-advance: use inputConfig.nextStepId, or fallback to step's default nextStepId (flow builder "Default Next Step")
    let nextStepId = step.inputConfig?.nextStepId || step.nextStepId;
    if (!nextStepId) {
      // Fallback: infer next step for known grievance/input patterns (handles old flows or missing config)
      const lang = (this.session.language || "en") as string;
      const suffix =
        lang === "en"
          ? "_en"
          : lang === "hi"
            ? "_hi"
            : lang === "or"
              ? "_or"
              : lang === "mr"
                ? "_mr"
                : "_en";
      const candidates =
        step.stepId === "grievance_name" ||
        step.inputConfig?.saveToField === "citizenName"
          ? [`grievance_category${suffix}`, "grievance_category"]
          : step.stepId === "grievance_start"
            ? ["grievance_name"]
            : [];
      for (const candidate of candidates) {
        if (this.flow.steps.some((s) => s.stepId === candidate)) {
          nextStepId = candidate;
          console.log(
            `📤 Input step "${step.stepId}" fallback nextStepId: ${nextStepId}`,
          );
          break;
        }
      }
    }
    console.log(
      `📤 Input step "${step.stepId}" done. nextStepId: ${nextStepId || "(none)"}`,
    );
    if (!nextStepId) {
      console.warn(
        `⚠️ Input step "${step.stepId}" has no next step configured. Set "Default Next Step" or "Next Step ID (when this response is received)" in the flow builder (e.g. grievance_category_en).`,
      );
    }
    await this.runNextStepIfDifferent(nextStepId, step.stepId);
  }

  /**
   * Execute media step - Handle media upload/download
   */
  private async executeMediaStep(step: IFlowStep): Promise<void> {
    if (!step.mediaConfig) {
      console.error("❌ Media step has no media configuration");
      return;
    }

    const lang = this.session.language || "en";
    const message = this.replacePlaceholders(
      getLocalText(step, lang) || "Please upload media:",
    );
    await sendWhatsAppMessage(this.company, this.userPhone, message);

    // Save media step info to session
    this.session.data.currentStepId = step.stepId;
    this.session.data.awaitingMedia = {
      mediaType: step.mediaConfig.mediaType,
      optional: step.mediaConfig.optional,
      saveToField: step.mediaConfig.saveToField,
      nextStepId: step.mediaConfig.nextStepId,
    };
    await updateSession(this.session);
  }

  /**
   * Execute condition step - Branching logic
   */
  private async executeConditionStep(step: IFlowStep): Promise<void> {
    if (!step.conditionConfig) {
      console.error("❌ Condition step has no condition configuration");
      return;
    }

    const { field, operator, value, trueStepId, falseStepId } =
      step.conditionConfig;
    const fieldValue = this.session.data[field];

    let conditionMet = false;

    switch (operator) {
      case "equals":
        conditionMet = fieldValue === value;
        break;
      case "contains":
        conditionMet = String(fieldValue).includes(String(value));
        break;
      case "greater_than":
        conditionMet = Number(fieldValue) > Number(value);
        break;
      case "less_than":
        conditionMet = Number(fieldValue) < Number(value);
        break;
      case "exists":
        conditionMet = fieldValue !== undefined && fieldValue !== null;
        break;
    }

    const nextStepId = conditionMet ? trueStepId : falseStepId;
    await this.runNextStepIfDifferent(nextStepId, step.stepId);
  }

  /**
   * Execute API call step - Make external API calls
   * Special handling for availability API to generate dynamic buttons
   */
  private async executeApiCallStep(step: IFlowStep): Promise<void> {
    if (!step.apiConfig) {
      console.error("❌ API call step has no API configuration");
      return;
    }
    let url = "";
    try {
      const { method, endpoint, headers, body, saveResponseTo, nextStepId } =
        step.apiConfig;

      // Build URL with query parameters for GET requests (replace placeholders in body values e.g. {appointmentDate})
      url = this.replacePlaceholders(endpoint, false);
      console.log(`🔗 Resolved API URL: ${url}`);
      if (method === "GET" && body) {
        const queryParams = new URLSearchParams();
        Object.keys(body).forEach((key) => {
          if (body[key] !== null && body[key] !== undefined) {
            const value =
              typeof body[key] === "string"
                ? this.replacePlaceholders(body[key], false)
                : body[key].toString();
            queryParams.append(key, value);
          }
        });
        if (queryParams.toString()) {
          url += (url.includes("?") ? "&" : "?") + queryParams.toString();
        }
      }

      // Make API call using built-in fetch (Node.js 18+) or axios
      let fetchFn: any;
      try {
        if (typeof fetch !== "undefined") {
          fetchFn = fetch;
        } else {
          const axios = (await import("axios")).default;
          fetchFn = async (u: string, opt: any) => {
            try {
              const res = await axios({
                url: u,
                method: opt.method || "GET",
                headers: opt.headers || {},
                data: opt.body ? JSON.parse(opt.body) : undefined,
                validateStatus: () => true, // Don't throw on error status
              });
              return {
                json: async () => res.data,
                status: res.status,
                ok: res.status >= 200 && res.status < 300,
              };
            } catch (err: any) {
              console.error(
                `❌ Axios API call error for ${u}:`,
                err.message,
                err.response?.data,
              );
              return {
                json: async () => ({ success: false, message: err.message }),
                status: err.response?.status || 500,
                ok: false,
              };
            }
          };
        }
      } catch (error) {
        console.error("❌ Failed to load fetch or axios:", error);
        throw new Error("API call functionality not available");
      }

      const options: any = {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      };

      if (body && method !== "GET") {
        const bodyStr = JSON.stringify(body);
        options.body = this.replacePlaceholders(bodyStr, false);
      }

      // Replace placeholders in URL (e.g., {companyId})
      url = this.replacePlaceholders(url, false);

      // Node fetch needs absolute URL for same-server API calls
      if (url.startsWith("/")) {
        const port = process.env.PORT || 5001;
        const apiBase = process.env.API_BASE_URL || `http://127.0.0.1:${port}`;
        url = apiBase.replace(/\/$/, "") + url;
      }

      console.log(`🌐 Making API call: ${method} ${url}`);

      let data: any;

      // OPTIMIZATION: If it's an internal call to availability chatbot, call the logic directly
      // This avoids "fetch failed" issues on Vercel/localhost loops
      const optimizedUrlPattern = "/api/availability/chatbot";
      if (url.toLowerCase().includes(optimizedUrlPattern)) {
        console.log(
          "⚡ Internal optimization: calling availability logic directly",
        );
        try {
          // Parse companyId and query params from URL correctly using built-in URL
          // If relative URL, prefix it for URL constructor
          const checkUrl = url.startsWith("/") ? `http://localhost${url}` : url;
          const urlObj = new URL(checkUrl);
          const pathName = urlObj.pathname; // e.g. /api/availability/chatbot/CMP000006

          // Robustly find any segment after /chatbot/
          const match = pathName.match(/\/chatbot\/([^/]+)/i);
          const companyId = match ? match[1] : pathName.split("/").pop() || "";

          const queryParams = Object.fromEntries(urlObj.searchParams.entries());

          console.log(
            `📡 Calling availability logic directly for company: ${companyId}`,
          );
          data = await getChatbotAvailabilityData({
            companyId,
            departmentId: queryParams.departmentId,
            selectedDate: queryParams.selectedDate,
            daysAhead: queryParams.daysAhead,
          });

          // Wrap in object expected by flow engine
          data =
            (data as any).availableDates || (data as any).formattedTimeSlots
              ? { success: true, data }
              : data;
          console.log("✅ Direct availability call successful");
        } catch (dirErr: any) {
          console.error("❌ Direct availability call failed:", dirErr.message);
          // Don't throw if it was a fallback, try actual fetch if it fails but we're already optimized
          if (!fetchFn)
            throw new Error(
              `Direct availability call failed: ${dirErr.message}`,
            );
          console.warn(
            "⚠️ Direct call failed; falling back to actual network fetch",
          );
        }
      }

      // If data is still missing, proceed with real network call
      if (data === undefined) {
        const response = await fetchFn(url, options);

        if (!response.ok) {
          console.error(
            `❌ API call failed with status ${response.status} to ${url}`,
          );
          throw new Error(`API call failed with status ${response.status}`);
        }

        data = await response.json();
      }

      console.log(
        `✅ API call response received from ${url.substring(0, 50)}...`,
      );

      // Save response to session if needed
      if (saveResponseTo) {
        this.session.data[saveResponseTo] = data;
        await updateSession(this.session);
      }

      // Special handling for availability API - generate buttons dynamically
      // Match either the direct data or the fetched data structure
      const availabilityData = data?.data || data;

      if (
        availabilityData &&
        (availabilityData.availableDates || availabilityData.formattedTimeSlots)
      ) {
        // Resolve next step properly from edges if not explicitly set in config
        const effectiveNextStepId =
          nextStepId || this.resolveNextStepId(step.stepId) || step.nextStepId;

        // If it's a date selection (availableDates array)
        if (
          availabilityData.availableDates &&
          Array.isArray(availabilityData.availableDates)
        ) {
          const dates = availabilityData.availableDates;
          const sent = await this.sendAvailableDateList(
            step,
            dates,
            effectiveNextStepId,
          );
          if (sent) {
            return;
          }
        }

        // If it's a time slot selection (formattedTimeSlots array)
        if (
          availabilityData.formattedTimeSlots &&
          Array.isArray(availabilityData.formattedTimeSlots)
        ) {
          const timeSlots = availabilityData.formattedTimeSlots;
          const sent = await this.sendAvailableTimeList(
            step,
            timeSlots,
            effectiveNextStepId,
          );
          if (sent) return;
        }
      }

      // Auto-advance to next step if no early return (e.g. no buttons sent)
      const nextId =
        nextStepId || this.resolveNextStepId(step.stepId) || step.nextStepId;
      await this.runNextStepIfDifferent(nextId, step.stepId);
    } catch (error: any) {
      console.error(`❌ API call execution failed to [${url}]:`, error.message);
      if (error.response) {
        console.error("📦 Response status:", error.response.status);
        console.error("📦 Response data:", JSON.stringify(error.response.data));
      }
      await this.sendErrorMessage();
    }
  }

  /**
   * Execute assign department step - Forcibly set department in session
   */
  private async executeAssignDepartmentStep(step: IFlowStep): Promise<void> {
    const config = (step as any).assignDepartmentConfig;
    if (!config) {
      console.warn("⚠️ Assign department step has no config; skipping");
      await this.runNextStepIfDifferent(step.nextStepId, step.stepId);
      return;
    }

    let departmentId = config.departmentId;
    if (config.isDynamic && config.conditionField) {
      departmentId = this.session.data[config.conditionField];
    }

    if (departmentId) {
      try {
        const Department = (await import("../models/Department")).default;
        const dept = await Department.findById(departmentId);
        if (dept) {
          const lang = this.session.language || "en";
          let localizedName = dept.name;
          if (lang === "hi" && dept.nameHi) localizedName = dept.nameHi;
          else if (lang === "or" && dept.nameOr) localizedName = dept.nameOr;
          else if (lang === "mr" && dept.nameMr) localizedName = dept.nameMr;

          this.session.data.departmentId = departmentId;
          this.session.data.lastParentDeptId = departmentId;
          this.session.data.departmentName = localizedName;
          this.session.data.category = dept.name; // Use original name for category mapping if needed
          await updateSession(this.session);
          console.log(
            `✅ Assigned department: ${localizedName} (${departmentId})`,
          );
        }
      } catch (err) {
        console.error("❌ Error in executeAssignDepartmentStep:", err);
      }
    }

    await this.runNextStepIfDifferent(step.nextStepId, step.stepId);
  }

  /**
   * Execute end step - Send final message and optionally clear session
   */
  private async executeEndStep(step: IFlowStep): Promise<void> {
    const lang = this.session.language || "en";
    const message = this.replacePlaceholders(getLocalText(step, lang));
    const normalizedMessage = (message || "").trim().toLowerCase();
    const isGenericThankYouOnly =
      normalizedMessage === "thank you!" ||
      normalizedMessage === "thank you" ||
      normalizedMessage === "thanks!" ||
      normalizedMessage === "thanks";

    const isGrievanceCreated = !!(this.session.data as any).grievanceId;

    if (message && message.trim() && !isGenericThankYouOnly && !isGrievanceCreated) {
      await sendWhatsAppMessage(this.company, this.userPhone, message);
    }

    const clearSessionFlag =
      (step as any).endConfig?.clearSession || (step as any).clearSession;
    if (clearSessionFlag) {
      console.log(`🧹 Clearing session for user ${this.userPhone}`);
      this.session.data = { currentStepId: "start" };
      // Explicitly remove flow context to prevent auto-restart loop
      if (this.session.data) {
        delete (this.session.data as any).flowId;
      }
      await updateSession(this.session);
    }
  }

  /**
   * Load grievance or appointment by refNumber into session.data for track_result step placeholders (status, assignedTo, remarks, recordType)
   */
  private async loadTrackResultIntoSession(): Promise<void> {
    // Strip all spaces from the reference number for strict matching
    const ref = (this.session.data.refNumber || "").replace(/\s+/g, "").toUpperCase();
    if (!ref) return;

    console.log(`🔍 Tracking request for Ref: "${ref}" (Current Company: ${this.company._id})`);

    try {
      const lang = this.session.language || "en";
      const noRemarksMap: any = {
        en: "No remarks provided",
        hi: "कोई विवरण नहीं दिया गया",
        or: "କୌଣସି ବିବରଣୀ ପ୍ରଦାନ କରାଯାଇ ନାହିଁ",
        mr: "कोणतेही तपशील प्रदान केलेले नाहीत",
      };

      if (ref.startsWith("GRV")) {
        // Strict company-level search only
        const query = {
          $or: [
            { companyId: this.company._id },
            { companyId: this.company._id.toString() }
          ],
          grievanceId: ref,
        };
        
        console.log(`🔍 Querying Grievance with: ${JSON.stringify(query)}`);
        
        const grievance = await Grievance.findOne(query)
          .populate("assignedTo", "firstName lastName designations")
          .populate({
            path: "departmentId",
            select: "name nameHi nameOr nameMr parentDepartmentId",
            populate: { path: "parentDepartmentId", select: "name nameHi nameOr nameMr" }
          })
          .populate("subDepartmentId", "name nameHi nameOr nameMr");

        if (grievance) {
          console.log(`✅ Found Grievance: ${grievance.grievanceId} (Status: ${grievance.status})`);
          this.session.data.recordType = "Grievance";
          this.session.data.status = grievance.status;
          
          const lastHistory =
            grievance.statusHistory && grievance.statusHistory.length > 0
              ? grievance.statusHistory[grievance.statusHistory.length - 1]
              : null;
          
          const rawRemarks = (lastHistory as any)?.remarks ?? (grievance as any).remarks;
          this.session.data.remarks =
            rawRemarks && rawRemarks.trim() !== "" ? rawRemarks : noRemarksMap[lang] || noRemarksMap.en;
          
          let assignedToName = "Under Review";
          const assignee = (grievance as any).assignedTo;
          
          if (assignee) {
            const name = `${assignee.firstName || ''} ${assignee.lastName || ''}`.trim();
            const designation = (assignee.designations && assignee.designations.length > 0) 
              ? ` (${assignee.designations[0]})` 
              : '';
            assignedToName = `${name}${designation}`.trim() || "Under Review";
          } else if (grievance.status === 'ASSIGNED' || grievance.status === 'IN_PROGRESS') {
            // Fallback: Try to find the latest assignee from timeline if object is not populated/found
            const assignmentEvent = [...(grievance.timeline || [])]
              .reverse()
              .find(e => e.action === 'ASSIGNED' && e.details?.toUserName);
            if (assignmentEvent) {
              assignedToName = assignmentEvent.details.toUserName;
            }
          }
          this.session.data.assignedTo = assignedToName;

          this.session.data.date = new Date(
            grievance.createdAt,
          ).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

          const dept = (grievance as any).departmentId;
          const subDept = (grievance as any).subDepartmentId;
          
          let displayDept = "General";
          let displayOffice = (grievance as any).category || "General";

          const getLocaleName = (obj: any, language: string) => {
            if (!obj) return null;
            if (language === "hi" && obj.nameHi) return obj.nameHi;
            if (language === "or" && obj.nameOr) return obj.nameOr;
            if (language === "mr" && obj.nameMr) return obj.nameMr;
            return obj.name;
          };

          if (dept) {
            // Case 1: Hierarchical Department (Current dept is a sub-unit of a larger parent)
            if (dept.parentDepartmentId) {
              displayDept = getLocaleName(dept.parentDepartmentId, lang) || "General";
              displayOffice = getLocaleName(dept, lang) || "General";
            } else {
              // Case 2: Standard Department
              displayDept = getLocaleName(dept, lang) || "General";
              
              // Resolve Office (Sub-Department)
              if (subDept) {
                displayOffice = getLocaleName(subDept, lang) || "General";
              } else {
                // Fallback to category string, but avoid duplicating the department name
                const rawCategory = (grievance as any).category;
                if (!rawCategory || rawCategory.trim() === "" || rawCategory === dept.name) {
                  displayOffice = "General";
                } else {
                  displayOffice = rawCategory;
                }
              }
            }
          }
          
          this.session.data.departmentName = displayDept;
          this.session.data.category = displayOffice;
          this.session.data.serviceType = "Grievance";
          this.session.data.updatedAt = new Date(
            grievance.updatedAt || grievance.createdAt,
          ).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

          await updateSession(this.session);
        } else {
          console.warn(`❌ Grievance "${ref}" not found for company ${this.company._id}.`);
          this.session.data.status = "Not Found";
          this.session.data.assignedTo = "—";
          this.session.data.remarks = "No record found for this reference number.";
          this.session.data.recordType = "—";
        }
      } else if (ref.startsWith("APT")) {
        // Strict company-level search only
        const query = {
          $or: [
            { companyId: this.company._id },
            { companyId: this.company._id.toString() }
          ],
          appointmentId: ref,
        };
        
        console.log(`🔍 Querying Appointment with: ${JSON.stringify(query)}`);

        const appointment = await Appointment.findOne(query).populate("assignedTo", "firstName lastName designations");

        if (appointment) {
          console.log(`✅ Found Appointment: ${appointment.appointmentId} (Status: ${appointment.status})`);
          this.session.data.recordType = "Appointment";
          this.session.data.status = appointment.status;
          
          const lastHistory =
            appointment.statusHistory && appointment.statusHistory.length > 0
              ? appointment.statusHistory[appointment.statusHistory.length - 1]
              : null;
          
          const rawRemarks = (lastHistory as any)?.remarks ?? (appointment as any).remarks;
          this.session.data.remarks =
            rawRemarks && rawRemarks.trim() !== "" ? rawRemarks : noRemarksMap[lang] || noRemarksMap.en;
          
          const assignee = (appointment as any).assignedTo;
          if (assignee) {
            const name = `${assignee.firstName || ''} ${assignee.lastName || ''}`.trim();
            const designation = (assignee.designations && assignee.designations.length > 0) 
              ? ` (${assignee.designations[0]})` 
              : '';
            this.session.data.assignedTo = `${name}${designation}` || "Scheduled";
          } else {
            this.session.data.assignedTo = "Scheduled";
          }

          this.session.data.date = new Date(
            appointment.createdAt,
          ).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
          
          this.session.data.departmentName = "Administration";
          this.session.data.category = (appointment as any).purpose || "General";
          this.session.data.serviceType = "Appointment";
          this.session.data.updatedAt = new Date(
            appointment.updatedAt || appointment.createdAt,
          ).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

          await updateSession(this.session);
        } else {
          console.warn(`❌ Appointment "${ref}" not found for company ${this.company._id}.`);
          this.session.data.status = "Not Found";
          this.session.data.assignedTo = "—";
          this.session.data.remarks = "No record found for this reference number.";
          this.session.data.recordType = "—";
        }
      } else {
        this.session.data.status = "Invalid";
        this.session.data.assignedTo = "—";
        this.session.data.remarks = "Reference number should start with GRV (grievance) or APT (appointment).";
        this.session.data.recordType = "—";
      }
    } catch (err: any) {
      console.error("❌ Error loading track result:", err);
      this.session.data.status = "Error";
      this.session.data.assignedTo = "—";
      this.session.data.remarks = "Could not fetch status. Please try again.";
      this.session.data.recordType = "—";
    }
    await updateSession(this.session);
  }


  private formatListDate(dateValue: string): string {
    const parsed = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return dateValue;

    const formattedDate = parsed.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
    const weekday = parsed.toLocaleDateString("en-GB", {
      weekday: "short",
      timeZone: "Asia/Kolkata",
    });

    return `${formattedDate}, ${weekday}`;
  }

  public async sendAvailableDateList(
    step: IFlowStep,
    dates: any[],
    effectiveNextStepId?: string,
  ): Promise<boolean> {
    if (!dates?.length) return false;

    const lang = this.session.language || "en";
    const maxVisibleItems = 9;
    const visibleDates = dates.slice(0, maxVisibleItems);
    const remainingDates = dates.slice(maxVisibleItems);

    const rows = visibleDates.map((date: any) => ({
      id: `date_${date.date}`,
      title: this.formatListDate(date.date),
      description: date.formattedDate || date.date,
    }));

    if (remainingDates.length > 0) {
      rows.push({
        id: "date_load_more",
        title:
          lang === "hi"
            ? "और तारीख लोड करें"
            : lang === "or"
              ? "ଅଧିକ ତାରିଖ ଲୋଡ୍ କରନ୍ତୁ"
              : "Load More Dates",
        description:
          lang === "hi"
            ? "अगली उपलब्ध तारीखें देखें"
            : lang === "or"
              ? "ପରବର୍ତ୍ତୀ ଉପଲବ୍ଧ ତାରିଖ ଦେଖନ୍ତୁ"
              : "View next available dates",
      });
    }

    const message = this.replacePlaceholders(
      getLocalText(step, lang) ||
        (lang === "hi"
          ? "🗓️ कृपया एक तारीख चुनें:"
          : lang === "or"
            ? "🗓️ ଦୟାକରି ଏକ ତାରିଖ ବାଛନ୍ତୁ:"
            : "📅 Please select a date:"),
    );
    await sendWhatsAppList(
      this.company,
      this.userPhone,
      message,
      lang === "hi" ? "तारीख चुनें" : lang === "or" ? "ତାରିଖ ବାଛନ୍ତୁ" : "Select Date",
      [{ title: lang === "hi" ? "उपलब्ध तारीखें" : lang === "or" ? "ଉପଲବ୍ଧ ତାରିଖ" : "Available Dates", rows }],
    );

    this.session.data.currentStepId = step.stepId;
    this.session.data.availabilityNextStepId = effectiveNextStepId;
    this.session.data.dateMapping = this.session.data.dateMapping || {};
    visibleDates.forEach((date: any) => {
      this.session.data.dateMapping[`date_${date.date}`] = date.date;
    });
    this.session.data.availableDateRemainder = remainingDates;
    await updateSession(this.session);
    return true;
  }

  public async sendAvailableTimeList(
    step: IFlowStep,
    timeSlots: any[],
    effectiveNextStepId?: string,
  ): Promise<boolean> {
    if (!timeSlots?.length) return false;

    const lang = this.session.language || "en";
    const maxVisibleItems = 9;
    const visibleSlots = timeSlots.slice(0, maxVisibleItems);
    const remainingSlots = timeSlots.slice(maxVisibleItems);

    const rows = visibleSlots.map((slot: any) => ({
      id: `time_${slot.time}`,
      title: slot.label || slot.time,
      description:
        lang === "hi"
          ? "अपॉइंटमेंट समय चुनें"
          : lang === "or"
            ? "ଆପଏଣ୍ଟମେଣ୍ଟ ସମୟ ବାଛନ୍ତୁ"
            : "Select appointment time",
    }));

    if (remainingSlots.length > 0) {
      rows.push({
        id: "time_load_more",
        title:
          lang === "hi"
            ? "और समय लोड करें"
            : lang === "or"
              ? "ଅଧିକ ସମୟ ଲୋଡ୍ କରନ୍ତୁ"
              : "Load More Slots",
        description:
          lang === "hi"
            ? "अगले उपलब्ध समय देखें"
            : lang === "or"
              ? "ପରବର୍ତ୍ତୀ ଉପଲବ୍ଧ ସମୟ ଦେଖନ୍ତୁ"
              : "View next available time slots",
      });
    }

    const message = this.replacePlaceholders(
      getLocalText(step, lang) ||
        (lang === "hi"
          ? "⏰ कृपया एक समय चुनें:"
          : lang === "or"
            ? "⏰ ଦୟାକରି ଏକ ସମୟ ବାଛନ୍ତୁ:"
            : "⏰ Please select a time:"),
    );
    await sendWhatsAppList(
      this.company,
      this.userPhone,
      message,
      lang === "hi" ? "समय चुनें" : lang === "or" ? "ସମୟ ବାଛନ୍ତୁ" : "Select Time",
      [{ title: lang === "hi" ? "उपलब्ध समय" : lang === "or" ? "ଉପଲବ୍ଧ ସମୟ" : "Available Slots", rows }],
    );

    this.session.data.currentStepId = step.stepId;
    this.session.data.availabilityNextStepId = effectiveNextStepId;
    this.session.data.timeMapping = this.session.data.timeMapping || {};
    visibleSlots.forEach((slot: any) => {
      this.session.data.timeMapping[`time_${slot.time}`] = slot.time;
    });
    this.session.data.availableTimeRemainder = remainingSlots;
    await updateSession(this.session);
    return true;
  }

  /**
   * Replace placeholders in message templates
   * Example: "Hello {citizenName}, your ticket is {ticketId}"
   * Dynamic values come from session.data (set by backend when creating grievance/appointment or from API step for track).
   */
  private replacePlaceholders(template: string, isMessage: boolean = true): string {
    const sessionData = this.session.data;
    const cidFromObj = this.company.companyId || (this.company._id ? this.company._id.toString() : "");
    const deptDisplay = sessionData.departmentName || sessionData.category || "";
    const subDeptDisplay = sessionData.subDepartmentName || "";
    const subDepartmentLineEn = subDeptDisplay ? `🏢 *Office:* ${subDeptDisplay}` : "";
    const subDepartmentLineHi = subDeptDisplay ? `🏢 *कार्यालय:* ${subDeptDisplay}` : "";
    const subDepartmentLineOr = subDeptDisplay ? `🏢 *କାର୍ଯ୍ୟାଳୟ:* ${subDeptDisplay}` : "";

    const getReplacement = (key: string): string | null => {
      if (key === 'companyId') return cidFromObj;
      if (key === 'department') return deptDisplay;
      if (key === 'subDepartment' || key === 'subDepartmentName') return subDeptDisplay;
      if (key === "subDepartmentLineEn") return subDepartmentLineEn;
      if (key === "subDepartmentLineHi") return subDepartmentLineHi;
      if (key === "subDepartmentLineOr") return subDepartmentLineOr;
      if (key === 'companyName') return this.company.name || "";
      if (key === 'websiteUrl') return this.company.website || "Digital Portal";
      if (key === 'companyAddress') return this.company.address || "Office Headquarters";
      if (key === 'helplineNumber') return this.company.helplineNumber || "For support, reply Help";

      if (key === 'id') {
        const id = sessionData.id || sessionData.grievanceId || sessionData.appointmentId || sessionData.leadId;
        return id ? String(id) : null;
      }

      const now = new Date();
      if (key === 'date') return sessionData.date ?? now.toLocaleDateString("en-IN", { timeZone: 'Asia/Kolkata' });
      if (key === 'time') return sessionData.time ?? now.toLocaleTimeString("en-IN", { timeZone: 'Asia/Kolkata' });

      const val = sessionData[key];
      return val != null && val !== "" ? String(val) : null;
    };

    let processedTemplate = template;

    if (isMessage) {
      // If a line contains a placeholder that evaluates to empty/null, remove the line entirely
      const lines = template.split('\n');
      const processedLines = lines.filter(line => {
        const placeholderRegex = /\{([a-zA-Z_0-9]+)\}/g;
        let match;
        while ((match = placeholderRegex.exec(line)) !== null) {
          const key = match[1];
          const val = getReplacement(key);
          if (!val) { // null, undefined, or ""
            return false;
          }
        }
        return true;
      });
      processedTemplate = processedLines.join('\n');
    }

    let message = processedTemplate.replace(/\{([a-zA-Z_0-9]+)\}/g, (match, key) => {
      const val = getReplacement(key);
      if (val != null) return val;
      return isMessage ? "" : match;
    });

    // Remove any remaining unresolved placeholders (legacy behavior)
    message = message.replace(/\{[a-zA-Z_0-9]+\}/g, "");

    return message;
  }

  /**
   * Send error message
   */
  private async sendErrorMessage(): Promise<void> {
    const errorMessage =
      this.flow.settings.errorFallbackMessage ||
      "We encountered an error. Please try again.";

    await sendWhatsAppMessage(this.company, this.userPhone, errorMessage);
  }

  /**
   * Handle button click
   */
  async handleButtonClick(buttonId: string): Promise<void> {
    console.log(
      `🔘 Handling button click: ${buttonId} in step: ${this.session.data.currentStepId}`,
    );
    console.log(
      `   Flow ID: ${this.flow.flowId}, Flow Name: ${this.flow.flowName}`,
    );

    // ✅ 0. Check for CANCEL button click
    const isCancelClick = buttonId && String(buttonId).toLowerCase().startsWith('cancel');
    if (isCancelClick) {
      console.log(`🚫 Cancel button clicked: ${buttonId}. Resetting session...`);
      const lang = this.session.language || 'en';
      const cancelMsgs: Record<string, string> = {
        en: "❌ *Request Cancelled.*\n\nYour current action has been cancelled. Returning to the main menu.",
        hi: "❌ *अनुरोध रद्द कर दिया गया।*\n\nआपकी वर्तमान कार्रवाई रद्द कर दी गई है। मुख्य मेनू पर वापस जा रहे हैं।",
        or: "❌ *ଅନୁରୋଧ ବାତିଲ ହେଲା।*\n\nଆପଣଙ୍କର ବର୍ତ୍ତମାନର କାର୍ଯ୍ୟ ବାତିଲ କରାଯାଇଛି | ମୁଖ୍ୟ ମେନୁକୁ ଫେରୁଛି |",
        mr: "❌ *विनंती रद्द केली.*\n\nतुमची सध्याची कृती रद्द करण्यात आली आहे. मुख्य मेनूवर परत जात आहे."
      };
      await sendWhatsAppMessage(this.company, this.userPhone, cancelMsgs[lang] || cancelMsgs['en']);
      
      // Clear session data but keep language and flowId
      const flowId = this.session.data.flowId;
      this.session.data = { flowId, language: lang };
      await updateSession(this.session);
      
      // Navigate to Menu
      const menuTarget = (this.flow as any).settings?.commands?.menu?.navigateTo || this.flow.startStepId;
      await this.executeStep(menuTarget);
      return;
    }

    // Get current step
    const currentStep = this.flow.steps.find(
      (s) => s.stepId === this.session.data.currentStepId,
    );
    if (!currentStep) {
      console.error(
        `❌ Current step ${this.session.data.currentStepId} not found`,
      );
      console.error(
        `   Available steps: ${this.flow.steps.map((s) => s.stepId).join(", ")}`,
      );
      await this.sendErrorMessage();
      return;
    }

    console.log(
      `   Current step: ${currentStep.stepId} (${currentStep.stepType})`,
    );
    console.log(
      `   Expected responses: ${JSON.stringify(currentStep.expectedResponses)}`,
    );

    await this.persistConsentSelection(currentStep.stepId, buttonId);
    console.log(
      `   Button mapping: ${JSON.stringify(this.session.data.buttonMapping)}`,
    );
    if (currentStep.nextStepId) {
      console.log(`   Default nextStepId: ${currentStep.nextStepId}`);
    }

    const normalizedButtonId = String(buttonId || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");

    // Capture dynamic department selections from button clicks as well.
    // Some flows encode department choices as quick-reply buttons (grv_dept_<id>)
    // instead of interactive list rows; without this, createGrievance can fail
    // due to a missing session.data.departmentId at submit time.
    const deptMatch = String(buttonId || "").match(/^([a-z]+)_dept_(.+)$/);
    if (deptMatch && !String(buttonId || "").includes("_sub_dept_")) {
      const deptId = deptMatch[2];
      if (mongoose.Types.ObjectId.isValid(deptId)) {
        const dept = await Department.findById(deptId)
          .select("name nameHi nameOr nameMr")
          .lean();
        if (dept) {
          const lang = this.session.language || "en";
          const localizedName =
            lang === "hi" && (dept as any).nameHi
              ? (dept as any).nameHi
              : lang === "or" && (dept as any).nameOr
                ? (dept as any).nameOr
                : lang === "mr" && (dept as any).nameMr
                  ? (dept as any).nameMr
                  : (dept as any).name;
          this.session.data.departmentId = deptId;
          this.session.data.lastParentDeptId = deptId;
          this.session.data.departmentName = localizedName;
          this.session.data.category =
            (dept as any).name || this.session.data.category;
          delete this.session.data.subDepartmentId;
          delete this.session.data.subDepartmentName;
          await updateSession(this.session);
          console.log(
            `✅ Department saved from button click: ${localizedName} (${deptId})`,
          );
        }
      }
    }

    const subDeptMatch = String(buttonId || "").match(/^([a-z]+)_sub_dept_(.+)$/);
    if (subDeptMatch) {
      const subDeptId = subDeptMatch[2];
      if (mongoose.Types.ObjectId.isValid(subDeptId)) {
        const subDept = await Department.findById(subDeptId)
          .select("name nameHi nameOr nameMr")
          .lean();
        if (subDept) {
          const lang = this.session.language || "en";
          const localizedSubName =
            lang === "hi" && (subDept as any).nameHi
              ? (subDept as any).nameHi
              : lang === "or" && (subDept as any).nameOr
                ? (subDept as any).nameOr
                : lang === "mr" && (subDept as any).nameMr
                  ? (subDept as any).nameMr
                  : (subDept as any).name;
          this.session.data.subDepartmentId = subDeptId;
          this.session.data.subDepartmentName = localizedSubName;
          this.session.data.category =
            (subDept as any).name || this.session.data.category;
          await updateSession(this.session);
          console.log(
            `✅ Sub-department saved from button click: ${localizedSubName} (${subDeptId})`,
          );
        }
      }
    }

    // ✅ FIRST: Check expectedResponses for button_click type
    if (
      currentStep.expectedResponses &&
      currentStep.expectedResponses.length > 0
    ) {
      const matchingResponse = currentStep.expectedResponses.find(
        (resp) => resp.type === "button_click" && resp.value === buttonId,
      );

      if (matchingResponse) {
        console.log(
          `✅ [Step Transition] ${currentStep.stepId} --(${buttonId})--> ${matchingResponse.nextStepId || "NO NEXT STEP (will use fallback)"}`,
        );

        // Handle language buttons specially - set language in session
        if (
          buttonId === "lang_en" ||
          buttonId === "lang_hi" ||
          buttonId === "lang_mr" ||
          buttonId === "lang_or"
        ) {
          if (buttonId === "lang_en") {
            this.session.language = "en";
          } else if (buttonId === "lang_hi") {
            this.session.language = "hi";
          } else if (buttonId === "lang_mr") {
            this.session.language = "mr";
          } else if (buttonId === "lang_or") {
            this.session.language = "or";
          }
          console.log(`   Language set to: ${this.session.language}`);
          await updateSession(this.session);
        }

        // Use nextStepId from expectedResponse, or fallback to step's default; auto-advance without repeating same step
        const nextStepId =
          matchingResponse.nextStepId || currentStep.nextStepId;
        if (!nextStepId) {
          console.error(
            `❌ No nextStepId found for button ${buttonId}. Expected response has no nextStepId and step has no default nextStepId.`,
          );
          await this.sendErrorMessage();
          return;
        }
        console.log(`   Executing next step: ${nextStepId}`);

        // ---- Detect which action to trigger ----
        // Grievance confirm step: any step whose ID contains 'confirm' and maps to a 'grv_success' or 'grievance_success' step
        const isGrievanceConfirm =
          currentStep.stepId === "grievance_confirm" ||
          currentStep.stepId?.startsWith("grievance_confirm_") ||
          currentStep.stepId?.startsWith("grv_conf_") ||
          currentStep.stepId?.startsWith("grv_confirm_");
        const isGrievanceSuccess =
          nextStepId === "grievance_success" ||
          nextStepId?.startsWith("grievance_success") ||
          nextStepId?.startsWith("grv_success_");
        // Appointment confirm step
        const isAppointmentConfirm =
          currentStep.stepId === "appointment_confirm" ||
          currentStep.stepId?.startsWith("appointment_confirm_") ||
          currentStep.stepId?.startsWith("apt_conf_") ||
          currentStep.stepId?.startsWith("apt_confirm_");
        const isAppointmentSubmitted =
          nextStepId === "appointment_submitted" ||
          nextStepId?.startsWith("appointment_submitted") ||
          nextStepId?.startsWith("apt_success_");
        // Lead confirm
        const isLeadConfirm =
          currentStep.stepId === "lead_confirm" ||
          currentStep.stepId?.startsWith("lead_confirm_") ||
          currentStep.stepId?.startsWith("lead_conf_");
        const isLeadSuccess =
          nextStepId === "lead_success" ||
          nextStepId?.startsWith("lead_success");

        // Detect SUBMIT button click (any submit/confirm-yes variant)
        const isSubmitClick =
          buttonId === "confirm_yes" ||
          String(buttonId).startsWith("confirm_yes") ||
          String(buttonId).startsWith("submit_grv") ||
          String(buttonId).startsWith("submit_grievance") ||
          buttonId === "grv_confirm_yes" ||
          normalizedButtonId === "confirm_submit" ||
          normalizedButtonId.startsWith("confirm_submit_");
        const isApptSubmitClick =
          buttonId === "appt_confirm_yes" ||
          String(buttonId).startsWith("appt_confirm_yes") ||
          String(buttonId).startsWith("submit_apt") ||
          String(buttonId).startsWith("confirm_apt") ||
          normalizedButtonId === "confirm_request" ||
          normalizedButtonId.startsWith("confirm_request_");
        const isLeadSubmitClick =
          buttonId === "lead_confirm_yes" ||
          String(buttonId).startsWith("lead_confirm_yes") ||
          String(buttonId).startsWith("submit_lead");

        // Case 1: Grievance
        if (isGrievanceConfirm && isSubmitClick) {
          console.log(`🎯 Triggering createGrievance for button: ${buttonId}`);
          try {
            await ActionService.createGrievance(this.session, this.company, this.userPhone);
            // If the flow has a success node, move to it. Otherwise, end session here.
            if (isGrievanceSuccess) {
              await this.runNextStepIfDifferent(nextStepId, currentStep.stepId);
            } else {
              this.session.data.stepQueue = [];
              this.session.data.lastStepId = "end";
              await updateSession(this.session);
            }
          } catch (error: any) {
            if (error.code === "LIMIT_EXCEEDED") {
              console.warn(`⚠️ Grievance submission limit reached for ${this.userPhone}: ${error.message}`);
              await sendWhatsAppMessage(this.company, this.userPhone, getSubmissionLimitReachedMessage());
              return;
            }
            console.error(`❌ Error creating grievance:`, error);
            throw error;
          }
          return;
        }

        // Case 2: Appointment
        if (isAppointmentConfirm && isApptSubmitClick) {
          console.log(`🎯 Triggering createAppointment for button: ${buttonId}`);
          try {
            await ActionService.createAppointment(this.session, this.company, this.userPhone);
            // Move to success node or end session
            if (isAppointmentSubmitted) {
              await this.runNextStepIfDifferent(nextStepId, currentStep.stepId);
            } else {
              this.session.data.stepQueue = [];
              this.session.data.lastStepId = "end";
              await updateSession(this.session);
            }
          } catch (error: any) {
            console.error(`❌ Error creating appointment:`, error);
            if (error.code === "LIMIT_EXCEEDED") {
              await sendWhatsAppMessage(this.company, this.userPhone, getSubmissionLimitReachedMessage());
              return;
            }
            throw error;
          }
          return;
        }

        // Case 3: Lead
        if (isLeadConfirm && isLeadSubmitClick) {
          console.log(`🎯 Triggering createLead for button: ${buttonId}`);
          await ActionService.createLead(this.session, this.company, this.userPhone);
          if (isLeadSuccess) {
            await this.runNextStepIfDifferent(nextStepId, currentStep.stepId);
          } else {
            this.session.data.stepQueue = [];
            this.session.data.lastStepId = "end";
            await updateSession(this.session);
          }
          return;
        }

        // Default: If no action triggered but we have a next step, go there
        if (nextStepId) {
          await this.runNextStepIfDifferent(nextStepId, currentStep.stepId);
        }
        return;
      } else {
        console.log(
          `   No matching expected response found for button ${buttonId}`,
        );
      }
    }

    // ✅ SECOND: Check buttonMapping (from button.nextStepId or edges)
    const buttonMapping = this.session.data.buttonMapping || {};
    let nextStepIdFromMapping = buttonMapping[buttonId];

    // FALLBACK: If not in mapping, try to resolve from edges directly
    if (!nextStepIdFromMapping) {
      nextStepIdFromMapping = this.resolveNextStepId(currentStep.stepId, buttonId);
    }

    if (nextStepIdFromMapping) {
      console.log(
        `✅ Found button mapping: ${buttonId} → ${nextStepIdFromMapping}`,
      );

      // Handle language buttons specially
      if (
        buttonId === "lang_en" ||
        buttonId === "lang_hi" ||
        buttonId === "lang_mr" ||
        buttonId === "lang_or"
      ) {
        if (buttonId === "lang_en") {
          this.session.language = "en";
        } else if (buttonId === "lang_hi") {
          this.session.language = "hi";
        } else if (buttonId === "lang_mr") {
          this.session.language = "mr";
        } else if (buttonId === "lang_or") {
          this.session.language = "or";
        }
        console.log(`   Language set to: ${this.session.language}`);
        await updateSession(this.session);
      }

      console.log(
        `✅ [Button Mapping Transition] ${currentStep.stepId} --(${buttonId})--> ${nextStepIdFromMapping}`,
      );
      // Also trigger grievance/appointment/lead creation if this is a submit button
      const bmIsGrievanceConfirm =
        currentStep.stepId?.startsWith("grv_confirm_") ||
        currentStep.stepId?.startsWith("grievance_confirm");
      const bmIsGrievanceSuccess =
        nextStepIdFromMapping?.toLowerCase().includes("success") ||
        nextStepIdFromMapping?.toLowerCase().includes("submitted") ||
        nextStepIdFromMapping?.toLowerCase().includes("finish") ||
        nextStepIdFromMapping?.toLowerCase().includes("grv_success") ||
        nextStepIdFromMapping?.toLowerCase().startsWith("grv_") && 
          nextStepIdFromMapping?.toLowerCase().includes("done");

      const bmIsAptConfirm =
        currentStep.stepId?.startsWith("apt_confirm_") ||
        currentStep.stepId?.startsWith("appointment_confirm");

      const bmIsAptSuccess =
        nextStepIdFromMapping?.toLowerCase().includes("success") ||
        nextStepIdFromMapping?.toLowerCase().includes("submitted") ||
        nextStepIdFromMapping?.toLowerCase().includes("finish") ||
        nextStepIdFromMapping?.toLowerCase().includes("apt_success") ||
        nextStepIdFromMapping?.toLowerCase().startsWith("apt_") && 
          nextStepIdFromMapping?.toLowerCase().includes("done");
      const bmIsSubmit =
        String(buttonId).startsWith("submit_grv") ||
        String(buttonId).startsWith("submit_apt") ||
        buttonId === "confirm_yes" ||
        String(buttonId).startsWith("confirm_yes") ||
        String(buttonId).startsWith("confirm_apt") ||
        buttonId === "grv_confirm_yes" ||
        buttonId === "appt_confirm_yes" ||
        String(buttonId).startsWith("appt_confirm_yes") ||
        buttonId === "lead_confirm_yes" ||
        String(buttonId).startsWith("lead_confirm_yes") ||
        normalizedButtonId === "confirm_submit" ||
        normalizedButtonId.startsWith("confirm_submit_") ||
        normalizedButtonId === "confirm_request" ||
        normalizedButtonId.startsWith("confirm_request_");

      if (bmIsGrievanceConfirm && bmIsGrievanceSuccess && bmIsSubmit) {
        console.log(
          `🎯 [Grievance Trigger] Matched 'success/submit' path. Executing createGrievance...`,
        );
        try {
          await ActionService.createGrievance(
            this.session,
            this.company,
            this.userPhone,
            { sendCitizenConfirmation: false }
          );
        } catch (error: any) {
          if (error.code === "LIMIT_EXCEEDED") {
            console.warn(`⚠️ Grievance submission limit reached for ${this.userPhone}: ${error.message}`);
            await sendWhatsAppMessage(this.company, this.userPhone, getSubmissionLimitReachedMessage());
            return;
          }
          console.error(`❌ Error creating grievance (mapped):`, error);
          throw error;
        }
      } else if (bmIsAptConfirm && bmIsAptSuccess && bmIsSubmit) {
        console.log(
          `🎯 [buttonMapping path] Triggering createAppointment for button: ${buttonId}`,
        );
        try {
          await ActionService.createAppointment(
            this.session,
            this.company,
            this.userPhone,
            { sendCitizenConfirmation: false }
          );
        } catch (error: any) {
          console.error(`❌ Error creating appointment (mapped):`, error);
          if (error.code === "LIMIT_EXCEEDED") {
            await sendWhatsAppMessage(this.company, this.userPhone, getSubmissionLimitReachedMessage());
            return;
          }
          throw error;
        }
      }
      await this.runNextStepIfDifferent(
        nextStepIdFromMapping,
        currentStep.stepId,
      );
      return;
    } else {
      console.log(`   No button mapping found for ${buttonId}`);
    }

    // ✅ THIRD: Check step's default nextStepId
    if (currentStep.nextStepId) {
      console.log(
        `✅ Using step's default nextStepId: ${currentStep.nextStepId}`,
      );

      // Handle language buttons specially
      if (
        buttonId === "lang_en" ||
        buttonId === "lang_hi" ||
        buttonId === "lang_mr" ||
        buttonId === "lang_or"
      ) {
        if (buttonId === "lang_en") {
          this.session.language = "en";
        } else if (buttonId === "lang_hi") {
          this.session.language = "hi";
        } else if (buttonId === "lang_mr") {
          this.session.language = "mr";
        } else if (buttonId === "lang_or") {
          this.session.language = "or";
        }
        console.log(`   Language set to: ${this.session.language}`);
        await updateSession(this.session);
      }

      // ✅ CRITICAL: Trigger business actions on confirm/submit steps
      // This path is hit when buttons don't have nextStepId set (e.g. Jharsuguda JSON flow)
      // — routing comes purely from step.nextStepId set by the flow transformer via edges.
      const defNextStepId = currentStep.nextStepId;
      const dfIsGrievanceConfirmStep =
        currentStep.stepId === "grievance_confirm" ||
        currentStep.stepId?.startsWith("grievance_confirm_") ||
        currentStep.stepId?.startsWith("grv_conf_") ||
        currentStep.stepId?.startsWith("grv_confirm_");
      const dfIsGrievanceSuccessStep =
        defNextStepId === "grievance_success" ||
        defNextStepId?.startsWith("grievance_success") ||
        defNextStepId?.startsWith("grv_success_");
      // For this path, ANY button click from a grv_confirm step to grv_success should trigger
      // (because cancel buttons route to menu — NOT to grv_success — so this is safe)
      const dfIsNotCancel =
        !String(buttonId).startsWith("cancel") &&
        !String(buttonId).startsWith("cancel_grv");

      if (
        dfIsGrievanceConfirmStep &&
        dfIsGrievanceSuccessStep &&
        dfIsNotCancel
      ) {
        console.log(
          `🎯 [Path3/default] Triggering createGrievance. StepId: ${currentStep.stepId}, NextStep: ${defNextStepId}, ButtonId: ${buttonId}`,
        );
        try {
          await ActionService.createGrievance(
            this.session,
            this.company,
            this.userPhone,
            { sendCitizenConfirmation: false }
          );
        } catch (error: any) {
          if (error.code === "LIMIT_EXCEEDED") {
            console.warn(`⚠️ Grievance submission limit reached for ${this.userPhone}: ${error.message}`);
            await sendWhatsAppMessage(this.company, this.userPhone, getSubmissionLimitReachedMessage());
            return;
          }
          console.error(`❌ Error creating grievance (default path):`, error);
          throw error;
        }
      } else {
        const dfIsAptConfirmStep =
          currentStep.stepId === "appointment_confirm" ||
          currentStep.stepId?.startsWith("appointment_confirm_") ||
          currentStep.stepId?.startsWith("apt_conf_") ||
          currentStep.stepId?.startsWith("apt_confirm_");
        const dfIsAptSuccessStep =
          defNextStepId === "appointment_submitted" ||
          defNextStepId?.startsWith("appointment_submitted") ||
          defNextStepId?.startsWith("apt_success_");
        if (dfIsAptConfirmStep && dfIsAptSuccessStep && dfIsNotCancel) {
          console.log(
            `🎯 [Path3/default] Triggering createAppointment. StepId: ${currentStep.stepId}, NextStep: ${defNextStepId}, ButtonId: ${buttonId}`,
          );
          try {
            await ActionService.createAppointment(
              this.session,
              this.company,
              this.userPhone,
              { sendCitizenConfirmation: false }
            );
          } catch (error: any) {
            console.error(`❌ Error creating appointment (default path):`, error);
            if (error.code === "LIMIT_EXCEEDED") {
              await sendWhatsAppMessage(this.company, this.userPhone, getSubmissionLimitReachedMessage());
              return;
            }
            throw error;
          }
        }
      }

      console.log(
        `   Executing next step from default: ${currentStep.nextStepId}`,
      );
      await this.runNextStepIfDifferent(
        currentStep.nextStepId,
        currentStep.stepId,
      );
      return;
    }

    // ✅ FALLBACK: Language selection step – match common button id/title variants
    const isLanguageStep =
      currentStep.stepId === "language_selection" ||
      (currentStep.stepName || "").toLowerCase().includes("language");
    if (isLanguageStep) {
      const normalized = (buttonId || "").trim().toLowerCase();
      const langMap: Array<{
        keys: string[];
        lang: "en" | "hi" | "mr" | "or";
        nextStepId: string;
      }> = [
        {
          keys: ["lang_en", "en", "english", "gb english", "🇬🇧 english"],
          lang: "en",
          nextStepId: "main_menu_en",
        },
        {
          keys: ["lang_hi", "hi", "hindi", "हिंदी", "in हिंदी", "hindi"],
          lang: "hi",
          nextStepId: "main_menu_hi",
        },
        {
          keys: ["lang_mr", "mr", "marathi", "मराठी"],
          lang: "mr",
          nextStepId: "main_menu",
        },
        {
          keys: ["lang_or", "or", "odia", "ଓଡ଼ିଆ", "in ଓଡ଼ିଆ"],
          lang: "or",
          nextStepId: "main_menu_or",
        },
      ];
      for (const entry of langMap) {
        if (
          entry.keys.some(
            (k) =>
              normalized === k.toLowerCase() ||
              normalized.includes(k.toLowerCase()),
          )
        ) {
          const nextStep = this.flow.steps.find(
            (s) => s.stepId === entry.nextStepId,
          );
          const stepIdToUse = nextStep
            ? entry.nextStepId
            : this.flow.steps.find((s) => s.stepId?.startsWith("main_menu"))
                ?.stepId || currentStep.nextStepId;
          if (stepIdToUse) {
            this.session.language = entry.lang;
            console.log(
              `   Language fallback: button "${buttonId}" → ${entry.lang}, nextStep: ${stepIdToUse}`,
            );
            await updateSession(this.session);
            await this.runNextStepIfDifferent(stepIdToUse, currentStep.stepId);
            return;
          }
        }
      }
    }

    // ✅ Handle dynamic date selection from API call buttons
    if (
      this.session.data.dateMapping &&
      this.session.data.dateMapping[buttonId]
    ) {
      const selectedDate = this.session.data.dateMapping[buttonId];
      this.session.data.appointmentDate = selectedDate;
      const nextStepId = this.session.data.availabilityNextStepId;
      console.log(
        `📅 Date selected: ${selectedDate}, nextStepId: ${nextStepId}`,
      );
      await updateSession(this.session);
      if (nextStepId) {
        await this.runNextStepIfDifferent(nextStepId, currentStep.stepId);
        return;
      }
    }

    // ✅ Handle dynamic time selection from API call buttons
    if (
      this.session.data.timeMapping &&
      this.session.data.timeMapping[buttonId]
    ) {
      const selectedTime = this.session.data.timeMapping[buttonId];
      this.session.data.appointmentTime = selectedTime;
      const nextStepId = this.session.data.availabilityNextStepId;
      console.log(
        `⏰ Time selected: ${selectedTime}, nextStepId: ${nextStepId}`,
      );
      await updateSession(this.session);
      if (nextStepId) {
        await this.runNextStepIfDifferent(nextStepId, currentStep.stepId);
        return;
      }
    }

    // ❌ No routing found
    console.error(
      `❌ No routing found for button ${buttonId} in step ${this.session.data.currentStepId}`,
    );
    console.error(`   Flow: ${this.flow.flowId}, Step: ${currentStep.stepId}`);
    console.error(
      `   Expected responses: ${JSON.stringify(currentStep.expectedResponses)}`,
    );
    console.error(
      `   Button mapping: ${JSON.stringify(this.session.data.buttonMapping)}`,
    );
    console.error(`   Default nextStepId: ${currentStep.nextStepId}`);
    // Send a user-friendly fallback message instead of generic error
    await sendWhatsAppMessage(
      this.company,
      this.userPhone,
      this.ui("button_fallback"),
    );
    // Re-send the current step to show the buttons again
    if (currentStep.stepType === "buttons") {
      await this.executeButtonsStep(currentStep);
    }
  }

  /**
   * Handle list selection
   * Special handling for department selection in grievance flow
   */
  async handleListSelection(rowId: string): Promise<void> {
    const listMapping = this.session.data.listMapping || {};
    const Department = (await import("../models/Department")).default;
    const lang = this.session.language || "en";

    // Handle "Load More" for dates
    if (rowId === "date_load_more") {
      const remainingDates = this.session.data.availableDateRemainder;
      const currentStep = this.flow.steps.find(
        (s) => s.stepId === this.session.data.currentStepId,
      );
      if (currentStep && Array.isArray(remainingDates) && remainingDates.length) {
        await this.sendAvailableDateList(
          currentStep,
          remainingDates,
          this.session.data.availabilityNextStepId,
        );
      }
      return;
    }

    // Handle "Load More" for time slots
    if (rowId === "time_load_more") {
      const remainingSlots = this.session.data.availableTimeRemainder;
      const currentStep = this.flow.steps.find(
        (s) => s.stepId === this.session.data.currentStepId,
      );
      if (currentStep && Array.isArray(remainingSlots) && remainingSlots.length) {
        await this.sendAvailableTimeList(
          currentStep,
          remainingSlots,
          this.session.data.availabilityNextStepId,
        );
      }
      return;
    }

    // Handle Date selection
    if (rowId.startsWith("date_") && this.session.data.dateMapping?.[rowId]) {
      const date = this.session.data.dateMapping[rowId];
      this.session.data.selectedDate = date;
      this.session.data.appointmentDate = date;
      await updateSession(this.session);
      console.log(`📅 Date selected via list: ${date}`);
      const nextStepId =
        this.session.data.availabilityNextStepId || this.session.data.currentStepId;
      if (nextStepId) {
        await this.runNextStepIfDifferent(nextStepId, this.session.data.currentStepId);
      }
      return;
    }

    // Handle Time selection
    if (rowId.startsWith("time_") && this.session.data.timeMapping?.[rowId]) {
      const time = this.session.data.timeMapping[rowId];
      this.session.data.selectedTime = time;
      this.session.data.appointmentTime = time;
      await updateSession(this.session);
      console.log(`⏰ Time selected via list: ${time}`);
      const nextStepId =
        this.session.data.availabilityNextStepId || this.session.data.currentStepId;
      if (nextStepId) {
        await this.runNextStepIfDifferent(nextStepId, this.session.data.currentStepId);
      }
      return;
    }

    // Special handling for "Load More" button in department list (grv or apt)
    if (rowId === "grv_load_more" || rowId === "apt_load_more") {
      this.session.data.deptOffset = (this.session.data.deptOffset || 0) + 9;
      await updateSession(this.session);
      const currentStep = this.flow.steps.find(
        (s) => s.stepId === this.session.data.currentStepId,
      );
      if (currentStep) {
        await this.loadDepartmentsForListStep(currentStep);
      }
      return;
    }

    // Special handling for "Load More" button in sub-department list
    if (rowId === "sub_load_more") {
      this.session.data.subDeptOffset = (this.session.data.subDeptOffset || 0) + 9;
      await updateSession(this.session);
      await this.injectSubDepartmentList(rowId);
      return;
    }

    // Department selection (grv_dept_* or apt_dept_*)
    if (rowId.includes("_dept_") && !rowId.includes("_sub_dept_")) {
      const match = rowId.match(/^([a-z]+)_dept_(.+)$/);
      if (match) {
        const prefix = match[1];
        const departmentId = match[2];
        console.log(
          `🏬 Department selected: ${departmentId} (Prefix: ${prefix})`,
        );

        const department = await Department.findById(departmentId);
        if (department) {
          const lang = this.session.language || "en";
          let localizedName = department.name;
          if (lang === "hi" && department.nameHi)
            localizedName = department.nameHi;
          else if (lang === "or" && department.nameOr)
            localizedName = department.nameOr;
          else if (lang === "mr" && department.nameMr)
            localizedName = department.nameMr;

          this.session.data.departmentId = departmentId;
          this.session.data.lastParentDeptId = departmentId;
          this.session.data.departmentName = localizedName;
          this.session.data.category = department.name;
          delete this.session.data.subDepartmentId;
          delete this.session.data.subDepartmentName;
          await updateSession(this.session);
          console.log(
            `✅ Department saved to session: ${localizedName}. Checking for sub-departments...`,
          );

          // --- Auto-inject sub-department list ONLY IF the flow doesn't handle it explicitly ---
          const currentStep = this.flow.steps.find(
            (s) => s.stepId === this.session.data.currentStepId,
          );
          const nextFlowStepId = this.resolveNextStepId(
            this.session.data.currentStepId,
          );
          const nextStep = nextFlowStepId
            ? this.flow.steps.find((s) => s.stepId === nextFlowStepId)
            : null;

          const isNextStepDynamicSubDept =
            nextStep &&
            ((nextStep.listConfig as any)?.dynamicSource ===
              "sub-departments" ||
              (nextStep.listConfig as any)?.isDynamic === true ||
              nextStep.stepId?.includes("subdept"));
          const isNextStepMainVsSubPrompt =
            nextStep &&
            nextStep.stepType === "buttons" &&
            Array.isArray(nextStep.buttons) &&
            nextStep.buttons.some((btn: any) =>
              String(btn.id || "").startsWith("main_dept_"),
            );

          if (isNextStepDynamicSubDept || isNextStepMainVsSubPrompt) {
            console.log(
              `⏩ Flow already has explicit department routing step (${nextFlowStepId}). Skipping auto-injection.`,
            );
            // Just advance normally to the next step which will handle the sub-depts
            const targetId = listMapping[rowId] || nextFlowStepId;
            if (targetId) {
              await this.runNextStepIfDifferent(
                targetId,
                this.session.data.currentStepId,
              );
              return;
            }
          }

          // Check if hierarchical departments module is enabled
          const hierarchicalEnabled = this.company.enabledModules?.includes(
            "HIERARCHICAL_DEPARTMENTS",
          );

          const subDepartments = hierarchicalEnabled
            ? await Department.find({
                parentDepartmentId: departmentId,
                _id: { $ne: departmentId },
                isActive: true,
              })
            : [];

          if (subDepartments.length > 0) {
            console.log(
              `🏢 Found ${subDepartments.length} sub-departments. Injecting sub-dept list...`,
            );
            await this.injectSubDepartmentList(rowId, subDepartments, prefix, departmentId);
            return;
          } else {
            console.log(
              `ℹ️ No sub-departments for department ${departmentId}. Advancing normally.`,
            );
          }
        }
      }
    }

    // Sub-department selection (grv_sub_dept_* or apt_sub_dept_*)
    // NOTE: We intentionally do NOT recurse deeper than 1 level of sub-department.
    // If more nesting is needed, the flow builder should handle it explicitly.
    if (rowId.includes("_sub_dept_")) {
      const match = rowId.match(/^([a-z]+)_sub_dept_(.+)$/);
      if (match) {
        const subDeptId = match[2];
        const subDept = await Department.findById(subDeptId);

        if (subDept) {
          const lang = this.session.language || "en";
          let localizedSubName = subDept.name;
          if (lang === "hi" && subDept.nameHi)
            localizedSubName = subDept.nameHi;
          else if (lang === "or" && subDept.nameOr)
            localizedSubName = subDept.nameOr;
          else if (lang === "mr" && subDept.nameMr)
            localizedSubName = subDept.nameMr;

          // Save sub-department separately (for placeholder resolution and confirmation messages)
          this.session.data.subDepartmentId = subDeptId;
          this.session.data.subDepartmentName = localizedSubName;
          this.session.data.category = subDept.name;
          // Keep parent departmentName intact; add sub-dept name separately
          // Do NOT overwrite departmentName to avoid confusion in confirmation steps
          await updateSession(this.session);
          console.log(
            `✅ Sub-department saved to session: ${localizedSubName} (parent dept: ${this.session.data.departmentName})`,
          );
        }
      }
    }

    let nextStepId = listMapping[rowId];
    if (!nextStepId && this.session.data.currentStepId) {
      nextStepId = this.resolveNextStepId(this.session.data.currentStepId, rowId);
    }

    if (nextStepId) {
      await this.runNextStepIfDifferent(
        nextStepId,
        this.session.data.currentStepId,
      );
    } else {
      console.error(`❌ No mapping found for list row ${rowId}`);
      // User may have typed text when a list was expected — send a friendly fallback
      const lang = this.session.language || "en";
      const fallbackMsgs: Record<string, string> = {
        en: '⚠️ *Please use the list menu above.*\n\nTap *"Select"* or *"View"* button to open the options and make your selection.',
        hi: '⚠️ *कृपया ऊपर दी गई सूची मेनू का उपयोग करें।*\n\nविकल्प खोलने के लिए *"चुनें"* या *"देखें"* बटन पर टैप करें।',
        or: '⚠️ *ଦୟାକରି ଉପରୋକ୍ତ ତାଲିକା ମେନୁ ବ୍ୟବହାର କରନ୍ତୁ।*\n\nବିକଳ୍ପ ଖୋଲିବାକୁ *"ବାଛନ୍ତୁ"* ବଟନ୍ ଟ୍ୟାପ୍ କରନ୍ତୁ।',
        mr: '⚠️ *कृपया वरील याद्या मेनू वापरा।*\n\nपर्याय उघडण्यासाठी *"निवडा"* बटणावर टॅप करा।',
      };
      await sendWhatsAppMessage(
        this.company,
        this.userPhone,
        fallbackMsgs[lang] || fallbackMsgs["en"],
      );
    }
  }

  /**
   * Helper to inject sub-department list with pagination
   */
  private async injectSubDepartmentList(
    rowId: string,
    subDepts?: any[],
    prefix?: string,
    parentId?: string,
  ): Promise<void> {
    const Department = (await import("../models/Department")).default;
    const lang = this.session.language || "en";

    // Recover data from session if this is a "Load More" call
    let allSubDepts = subDepts;
    let currentPrefix = prefix;
    let departmentId = parentId;

    if (!allSubDepts) {
      departmentId = this.session.data.lastParentDeptId;
      currentPrefix = this.session.data.lastPrefix;
      if (!departmentId) return;

      const hierarchicalEnabled = this.company.enabledModules?.includes(
        "HIERARCHICAL_DEPARTMENTS",
      );

      allSubDepts = hierarchicalEnabled
        ? await Department.find({
            parentDepartmentId: departmentId,
            isActive: true,
          }).sort({ name: 1, createdAt: 1 })
        : [];
    } else {
      // Save for "Load More" recovery
      this.session.data.lastParentDeptId = departmentId;
      this.session.data.lastPrefix = currentPrefix;
      this.session.data.subDeptOffset = 0;
    }

    const offset = this.session.data.subDeptOffset || 0;
    const visibleSubDepts = allSubDepts.slice(offset, offset + 9);
    const remainingSubDepts = allSubDepts.slice(offset + 9);

    if (visibleSubDepts.length === 0 && offset > 0) {
      // No more to show, ignore load more
      return;
    }

    // Determine target ID for next step
    const currentStep = this.flow.steps.find(
      (s) => s.stepId === this.session.data.currentStepId,
    );
    const nextFlowStepId = this.resolveNextStepId(
      this.session.data.currentStepId,
    );
    const afterSubDeptStepId =
      this.session.data.listMapping?.[rowId] ||
      currentStep?.nextStepId ||
      nextFlowStepId;

    const rows = visibleSubDepts.map((dept: any) => {
      let displayName = dept.name;
      if (lang === "hi" && dept.nameHi?.trim())
        displayName = dept.nameHi.trim();
      else if (lang === "or" && dept.nameOr?.trim())
        displayName = dept.nameOr.trim();
      else if (lang === "mr" && dept.nameMr?.trim())
        displayName = dept.nameMr.trim();

      let displayDesc = (dept.description || "").substring(0, 72);
      if (lang === "hi" && dept.descriptionHi?.trim())
        displayDesc = dept.descriptionHi.trim().substring(0, 72);
      else if (lang === "or" && dept.descriptionOr?.trim())
        displayDesc = dept.descriptionOr.trim().substring(0, 72);
      else if (lang === "mr" && dept.descriptionMr?.trim())
        displayDesc = dept.descriptionMr.trim().substring(0, 72);

      return {
        id: `${currentPrefix}_sub_dept_${dept._id}`,
        title:
          displayName.length > 24
            ? displayName.substring(0, 21) + "..."
            : displayName,
        description:
          displayName.length > 24 ? displayName.substring(0, 72) : displayDesc,
      };
    });

    // Keep main department as first option in office list
    if (offset === 0 && departmentId) {
      const parentDept = await Department.findById(departmentId);
      if (parentDept) {
        let parentDisplayName = parentDept.name;
        if (lang === "hi" && parentDept.nameHi?.trim()) {
          parentDisplayName = parentDept.nameHi.trim();
        } else if (lang === "or" && parentDept.nameOr?.trim()) {
          parentDisplayName = parentDept.nameOr.trim();
        } else if (lang === "mr" && parentDept.nameMr?.trim()) {
          parentDisplayName = parentDept.nameMr.trim();
        }

        rows.unshift({
          id: `${currentPrefix}_main_dept_${parentDept._id}`,
          title:
            parentDisplayName.length > 24
              ? parentDisplayName.substring(0, 21) + "..."
              : parentDisplayName,
          description:
            lang === "hi"
              ? "मुख्य विभाग"
              : lang === "or"
                ? "ମୁଖ୍ୟ ବିଭାଗ"
                : "Main Department",
        });
      }
    }

    if (remainingSubDepts.length > 0) {
      rows.push({
        id: "sub_load_more",
        title: this.ui("load_more"),
        description:
          lang === "hi"
            ? "और अनुभाग देखें"
            : lang === "or"
              ? "ଅଧିକ ଅନୁଭାଗ"
              : "View more sections",
      });
    }

    // Save mapping
    this.session.data.listMapping = this.session.data.listMapping || {};
    rows.forEach((row: any) => {
      this.session.data.listMapping[row.id] = afterSubDeptStepId;
    });
    await updateSession(this.session);

    // Send list
    await sendWhatsAppList(
      this.company,
      this.userPhone,
      this.ui("sub_dept_title"),
      this.ui("sub_dept_btn"),
      [{ title: this.ui("select_dept"), rows }],
    );
  }
}

/**
 * Find and load flow for a company based on trigger
 */
export async function loadFlowForTrigger(
  companyId: string | mongoose.Types.ObjectId,
  trigger: string,
  flowType?: string,
): Promise<IChatbotFlow | null> {
  try {
    let companyObjectId: mongoose.Types.ObjectId;

    // Convert to ObjectId if it's a string
    if (typeof companyId === "string") {
      if (
        mongoose.Types.ObjectId.isValid(companyId) &&
        companyId.length === 24
      ) {
        companyObjectId = new mongoose.Types.ObjectId(companyId);
      } else {
        // It's likely a custom companyId string like 'CMP000006'
        const Company = (await import("../models/Company")).default;
        const companyDoc = await Company.findOne({ companyId }).lean();
        if (companyDoc) {
          companyObjectId = companyDoc._id as mongoose.Types.ObjectId;
        } else {
          console.error(
            `❌ Could not resolve companyId string "${companyId}" to an ObjectId`,
          );
          return null;
        }
      }
    } else {
      companyObjectId = companyId;
    }

    console.log(
      `🔍 Searching for flow with trigger "${trigger}" for company: ${companyObjectId}`,
    );

    // First, check if there's an active WhatsApp config with assigned flows
    const CompanyWhatsAppConfig = (
      await import("../models/CompanyWhatsAppConfig")
    ).default;
    const whatsappConfig = await CompanyWhatsAppConfig.findOne({
      companyId: companyObjectId,
      isActive: true,
    });

    let assignedFlowIds: mongoose.Types.ObjectId[] = [];
    if (
      whatsappConfig &&
      whatsappConfig.activeFlows &&
      whatsappConfig.activeFlows.length > 0
    ) {
      assignedFlowIds = whatsappConfig.activeFlows
        .filter((af: any) => af?.isActive !== false && af?.flowId) // ✅ avoid null flowId
        .map((af: any) => af.flowId)
        .filter((id: any) => !!id);
      console.log(
        `📋 Found ${assignedFlowIds.length} assigned flow(s) in WhatsApp config`,
      );
    }

    const query: any = {
      companyId: companyObjectId,
      isActive: true,
      "triggers.triggerValue": { $regex: new RegExp(`^${trigger}$`, "i") }, // Case-insensitive match
    };

    if (flowType) {
      query.flowType = flowType;
    }

    // If there are assigned flows, prioritize them
    if (assignedFlowIds.length > 0) {
      query._id = { $in: assignedFlowIds };
      console.log(
        `🎯 Prioritizing assigned flows: ${assignedFlowIds.length} flow(s)`,
      );
    }

    console.log(`🔍 Flow query:`, JSON.stringify(query, null, 2));

    // --- 1. Check Redis Cache First ---
    const cachedFlow = await FlowCacheService.getCachedFlow(companyObjectId.toString(), trigger);
    if (cachedFlow) {
      console.log(`🚀 Using cached flow for trigger "${trigger}"`);
      return cachedFlow;
    }

    let flow = await ChatbotFlow.findOne(query).sort({
      "triggers.priority": -1,
    });

    // 🔄 FALLBACK: If no flow found for specific trigger, but there are assigned flows and it's a greeting
    if (!flow && assignedFlowIds.length > 0) {
      const greetings = [
        "hi",
        "hello",
        "start",
        "restart",
        "menu",
        "namaste",
        "नमस्ते",
        "test",
      ];
      if (greetings.includes(trigger.toLowerCase().trim())) {
        console.log(
          `🔄 No specific flow found for trigger "${trigger}", but found ${assignedFlowIds.length} assigned flow(s). Using the first one as default.`,
        );
        flow = await ChatbotFlow.findById(assignedFlowIds[0]);
      }
    }

    if (flow) {
      const isAssigned = assignedFlowIds.some(
        (id: any) => id && id.toString && id.toString() === (flow as any)._id.toString(),
      );
      console.log(`✅ Found flow: ${flow.flowName} for trigger: ${trigger}`);

      // --- 2. Cache the resolved flow for future messages ---
      await FlowCacheService.cacheFlow(companyObjectId.toString(), trigger, flow);
      
      return flow;
    } else {
      console.log(`⚠️ No flow found for trigger "${trigger}"`);
      return null;
    }


    return flow;
  } catch (error) {
    console.error("❌ Error loading flow:", error);
    return null;
  }
}

/**
 * Get start step ID for a trigger
 */
export function getStartStepForTrigger(
  flow: IChatbotFlow,
  trigger: string,
): string | null {
  const triggerConfig = flow.triggers.find((t) => t.triggerValue === trigger);
  return triggerConfig?.startStepId || flow.startStepId;
}

/**
 * ─── Main Chatbot Router (Merged from chatbotEngine.ts) ───────────────────────
 *
 * This is the entry point for all incoming WhatsApp messages.
 * It manages sessions, resolves companies, and routes to DynamicFlowEngine.
 */
export async function processWhatsAppMessage(
  message: ChatbotMessage,
): Promise<any> {
  const { from, messageType, messageId } = message;
  const mediaUrl = message.mediaUrl;
  const companyId = message.companyId;
  const buttonId = message.buttonId?.trim();
  const incomingMessageTimestamp = message.messageTimestamp;
  const userInput = (message.messageText || "").trim().toLowerCase();
  const rawInput = (message.messageText || "").trim();
  const locationData = message.locationData;

  console.log(
    `\n📨 Incoming [${messageType}] from ${from} | Company: ${companyId}`,
  );
  if (buttonId) console.log(`   ButtonId: ${buttonId}`);
  if (userInput) console.log(`   Text: "${rawInput.substring(0, 80)}"`);

  // ── 1. Find Company & Load Session in Parallel ───────────────────────────
  const [company, session] = await Promise.all([
    findCompany(companyId),
    getSession(from, companyId)
  ]);

  if (!company) {
    console.error(`❌ Company not found: ${companyId}`);
    return;
  }


  // ✅ Log User Consent (Incoming message = Implicit Opt-in)
  if (session.hasConsent !== true) {
    session.hasConsent = true;
    await updateSession(session);
    
    void createAuditLog({
      action: AuditAction.CONSENT_CHANGE,
      resource: 'WhatsAppUser',
      resourceId: from,
      companyId: company._id.toString(),
      details: {
        phoneNumber: from,
        action: 'SUBSCRIBE',
        message: 'Implicit consent via message initiation'
      }
    }).catch((error: any) => {
      console.error(`⚠️ Failed to write consent audit log for ${from}:`, error?.message || error);
    });
    console.log(`✅ User ${from} opted-in/resubscribed via message initiation`);
  }

  // ── 3. Handle greeting → always restart the flow ─────────────────────────
  // Also treat 'menu' and 'restart' as greetings when there's NO active session
  // (if session is active, handleFlowCommand inside continueFlow handles them dynamically)
  const isGreeting = isGreetingTrigger(userInput);
  const isNoSessionCommand = !session.data?.flowId && (userInput === 'menu' || userInput === 'restart' || userInput === 'start again');
  const isStaleMessage = isStaleInboundMessage(incomingMessageTimestamp);

  if (isStaleMessage && !session.data?.flowId) {
    console.log(`⏭️ Ignoring stale inbound message from ${from} (timestamp=${incomingMessageTimestamp}) to avoid delayed auto-restart`);
    return;
  }

  if (!buttonId && (isGreeting || isNoSessionCommand)) {
    if (isStaleMessage) {
      console.log(`⏭️ Ignoring stale greeting from ${from} to prevent unintended flow restart`);
      return;
    }
    await handleGreeting(from, companyId, 'hi', company, message, session);
    return;
  }

  // ── 4. Session recovery: if Redis lost the session, recover from Mongo ────
  if (
    session.step === "start" &&
    !session.data?.flowId &&
    !buttonId &&
    rawInput &&
    !isGreetingTrigger(userInput)
  ) {
    const mongoSession = await getSessionFromMongo(from, companyId);
    if (
      mongoSession?.data?.flowId &&
      (mongoSession.data.currentStepId || mongoSession.data.awaitingInput)
    ) {
      console.log("🔄 Session recovered from MongoDB");
      session.data = mongoSession.data;
      session.step = mongoSession.step;
      session.language = mongoSession.language;
    }
  }

  // ── 5. Do not auto-start a fresh flow implicitly ─────────────────────────
  // Only the explicit greeting branch above is allowed to start/restart the flow.
  if (session.step === "start" && !session.data?.flowId) {
    console.log(`ℹ️ Sessionless message from ${from}: "${rawInput.substring(0, 80)}"`);
    const hasUserInteraction = Boolean(
      buttonId ||
      rawInput ||
      ["image", "video", "audio", "voice", "document", "location", "contacts", "sticker", "interactive", "button"].includes(messageType)
    );

    if (hasUserInteraction && !isGreeting) {
      await sendWhatsAppMessage(company, from, ui("session_expired", session.language || "en", null));
    }
    return;
  }

  // ── 6. Continue an active flow ────────────────────────────────────────────
  if (session.data?.flowId) {
    await continueFlow(
      session,
      company,
      from,
      companyId,
      buttonId,
      userInput,
      rawInput,
      messageType,
      mediaUrl,
      message,
      locationData,
    );
    return;
  }

  // ── 7. Fallback: no flow context at all ───────────────────────────────────
  console.log(`ℹ️ No active flow and no greeting trigger for ${from}; skipping auto-response.`);
  return;
}

/**
 * Helper: Find Company
 */
async function findCompany(companyId: string): Promise<any | null> {
  try {
    let company: any = null;

    // 1. Try finding by _id if it's a valid ObjectId
    if (mongoose.Types.ObjectId.isValid(companyId) && companyId.length === 24) {
      company = await Company.findById(companyId).lean();
    }

    // 2. Fallback: try finding by custom companyId string field
    if (!company) {
      company = await Company.findOne({ companyId }).lean();
    }

    if (!company) return null;

    // 3. Load WhatsApp config
    const waConfig = await CompanyWhatsAppConfig.findOne({
      companyId: company._id,
      isActive: true,
    }).lean();

    if (waConfig) (company as any).whatsappConfig = waConfig;

    return company;
  } catch (err) {
    console.error("❌ Error finding company:", err);
    return null;
  }
}

/**
 * Helper: Handle Greeting (restart)
 */
async function handleGreeting(
  from: string,
  companyId: string,
  trigger: string,
  company: any,
  message: ChatbotMessage,
  session: UserSession,
): Promise<void> {
  console.log(`🔄 Greeting received: "${trigger}" → restarting flow`);
  // Parallelize daily limit check and flow lookup
  const [dailyLimit, flow] = await Promise.all([
    checkDailyLimit({
      companyId: company._id,
      phone_number: from,
    }),
    loadFlowForTrigger(companyId, trigger)
  ]);

  if (!dailyLimit.allowed) {
    console.warn(`⚠️ Blocking flow start due to daily grievance limit for ${from}`);
    await sendWhatsAppMessage(company, from, getSubmissionLimitReachedMessage());
    return;
  }

  if (!flow || !flow.isActive) {
    // Try the generic "hi" trigger as fallback
    const fallback = await loadFlowForTrigger(companyId, "hi");
    if (!fallback || !fallback.isActive) {
      await sendWhatsAppMessage(
        company,
        from,
        ui("no_flow", session.language || "en", fallback),
      );
      return;
    }
    return executeFlowFromStart(from, companyId, fallback, company, "hi");
  }
  return executeFlowFromStart(from, companyId, flow, company, trigger);
}

/**
 * Helper: Auto-start on first message
 */
async function handleAutoStart(
  from: string,
  companyId: string,
  buttonId: string | undefined,
  company: any,
  session: UserSession,
  message: ChatbotMessage,
): Promise<void> {
  const flow = await loadFlowForTrigger(companyId, "hi");
  if (!flow || !flow.isActive) {
    await sendWhatsAppMessage(
      company,
      from,
      ui("no_flow", session.language || "en", flow),
    );
    return;
  }

  let startStepId = getStartStepForTrigger(flow, "hi") || flow.startStepId;
  const startStep = flow.steps.find((s) => s.stepId === startStepId);
  if (!startStep) startStepId = flow.startStepId;

  // Handle reconstructed button click if session lost
  if (buttonId) {
    session.data = {
      flowId: flow.flowId,
      currentStepId: startStepId,
      buttonMapping: {},
      listMapping: {},
    };
    flow.steps.forEach((s: any) => {
      (s.buttons || []).forEach((btn: any) => {
        if (btn.nextStepId)
          (session.data as any).buttonMapping[btn.id] = btn.nextStepId;
      });
      (s.listConfig?.sections || []).forEach((sec: any) => {
        (sec.rows || []).forEach((row: any) => {
          if (row.nextStepId)
            (session.data as any).listMapping[row.id] = row.nextStepId;
        });
      });
    });
    await updateSession(session);

    const engine = new DynamicFlowEngine(flow, session, company, from);
    if ((session.data as any).listMapping?.[buttonId]) {
      await engine.handleListSelection(buttonId);
    } else {
      await engine.handleButtonClick(buttonId);
    }
    return;
  }

  // Normal auto-start
  session.data = { flowId: flow.flowId };
  await updateSession(session);
  const engine = new DynamicFlowEngine(flow, session, company, from);
  await engine.executeStep(startStepId);
}

/**
 * Helper: Continue an active flow
 */
async function continueFlow(
  session: UserSession,
  company: any,
  from: string,
  companyId: string,
  buttonId: string | undefined,
  userInput: string,
  rawInput: string,
  messageType: string,
  mediaUrl: string | undefined,
  message: ChatbotMessage,
  locationData?: { lat: number; long: number; address?: string },
): Promise<void> {
  let flow = await ChatbotFlow.findOne({
    companyId: company._id,
    flowId: session.data.flowId,
    isActive: true,
  });

  if (!flow && mongoose.Types.ObjectId.isValid(String(session.data.flowId))) {
    flow = await ChatbotFlow.findOne({
      _id: session.data.flowId,
      isActive: true,
    });
    if (flow) {
      session.data.flowId = (flow as any).flowId;
      await updateSession(session);
    }
  }

  if (!flow) {
    console.warn("⚠️ Active flow not found or deactivated, clearing session");
    await clearSession(from, companyId);
    await sendWhatsAppMessage(
      company,
      from,
      ui("service_unavailable", session.language || "en"),
    );
    return;
  }

  const engine = new DynamicFlowEngine(flow, session, company, from);
  const lang = session.language || "en";
  const flowSettings = (flow as any).settings;
  const fallbackConfig = flowSettings?.fallback;

  // ── 0. HIGHEST PRIORITY: Check flow-defined commands (stop/restart/menu/back)
  // This runs before ANY other logic so commands always work regardless of state.
  // Only applies to plain text messages (not button clicks or media)
  if (!buttonId && rawInput && messageType === "text") {
    const wasCommand = await handleFlowCommand(
      rawInput,
      session,
      flow,
      company,
      from,
      companyId,
    );
    if (wasCommand) return;
  }

  // ── 1. Track previous step for 'back' command navigation
  // Handled inside executeStep now for more accuracy



  if (buttonId?.startsWith("date_") && session.data.dateMapping) {
    const date = session.data.dateMapping[buttonId];
    if (date) {
      session.data.selectedDate = date;
      session.data.appointmentDate = date;
      session.data.fallbackAttempts = 0;
      await updateSession(session);
      const nextStepId =
        session.data.availabilityNextStepId || session.data.currentStepId;
      if (nextStepId) await engine.executeStep(nextStepId);
    }
    return;
  }

  if (buttonId?.startsWith("time_") && session.data.timeMapping) {
    const time = session.data.timeMapping[buttonId];
    if (time) {
      session.data.selectedTime = time;
      session.data.appointmentTime = time;
      session.data.fallbackAttempts = 0;
      await updateSession(session);
      const nextStepId =
        session.data.availabilityNextStepId || session.data.currentStepId;
      if (nextStepId) await engine.executeStep(nextStepId);
    }
    return;
  }

  // ── 3. List selection (valid)
  if (buttonId && session.data.listMapping?.[buttonId] !== undefined) {
    session.data.fallbackAttempts = 0;
    await updateSession(session);
    await engine.handleListSelection(buttonId);
    return;
  }

  // ── 4. Button click (valid)
  if (buttonId) {
    session.data.fallbackAttempts = 0;
    await updateSession(session);
    await engine.handleButtonClick(buttonId);
    return;
  }

  // ── 5. Media upload
  if (
    session.data.awaitingMedia &&
    (messageType === "image" ||
      messageType === "document" ||
      messageType === "video") &&
    mediaUrl
  ) {
    session.data.fallbackAttempts = 0;
    await handleMediaUpload(
      session,
      company,
      from,
      messageType,
      mediaUrl,
      engine,
    );
    return;
  }

  // ── 5.5 Location upload
  if (messageType === "location" && locationData) {
    session.data.fallbackAttempts = 0;
    await updateSession(session);
    await engine.executeStep(session.data.currentStepId, rawInput, locationData);
    return;
  }

  // ── 6. Media skip
  if (session.data.awaitingMedia) {
    const skipKeywords = ["skip", "cancel", "no", "na", "n/a"];
    if (skipKeywords.some((k) => userInput === k || userInput.includes(k))) {
      const nextStepId = session.data.awaitingMedia.nextStepId;
      delete session.data.awaitingMedia;
      session.data.fallbackAttempts = 0;
      await updateSession(session);
      if (nextStepId) await engine.executeStep(nextStepId);
    } else {
      // Fallback: re-prompt for media upload
      await sendWhatsAppMessage(company, from, ui("upload_photo", lang, flow));
    }
    return;
  }

  // ── 7. Media input step skip
  const isMediaInputStep = ["image", "document", "video"].includes(
    session.data.awaitingInput?.type,
  );
  if (isMediaInputStep && session.data.awaitingInput) {
    const skipKeywords = ["skip", "cancel", "no", "na"];
    if (skipKeywords.some((k) => userInput === k || userInput.includes(k))) {
      const nextStepId = session.data.awaitingInput.nextStepId;
      delete session.data.awaitingInput;
      session.data.fallbackAttempts = 0;
      await updateSession(session);
      if (nextStepId) await engine.executeStep(nextStepId);
    } else {
      await sendWhatsAppMessage(company, from, ui("upload_photo", lang, flow));
    }
    return;
  }

  // ── 8. Text input for input steps
  if (session.data.awaitingInput) {
    // Check if this input step should have fallback protection
    const attempts = (session.data.fallbackAttempts || 0) + 1;
    session.data.fallbackAttempts = attempts;
    await updateSession(session);

    const inputFallback = fallbackConfig?.input;
    const maxAttempts = inputFallback?.maxAttempts ?? 7; // Default to 7 (6 invalid + 1 final)

    if (attempts >= maxAttempts) {
      const maxMsg = inputFallback?.maxAttemptsMessage?.[lang] || 
                    inputFallback?.maxAttemptsMessage?.["en"] || 
                    "Too many invalid attempts. Returning to menu.";
      await sendWhatsAppMessage(company, from, maxMsg);
      
      session.data.fallbackAttempts = 0;
      delete session.data.awaitingInput;
      await updateSession(session);
      
      const menuTarget = (flow as any).settings?.commands?.menu?.navigateTo || flow.startStepId;
      await engine.executeStep(menuTarget);
    } else {
      await engine.executeStep(session.data.currentStepId, rawInput, locationData);
    }
    return;
  }

  // ── 9. FALLBACK HANDLING — user typed text when a button/list was expected
  // Uses flow JSON settings.fallback config. Tracks attempts and re-sends the step.

  // Fallback for list steps
  if (
    session.data.listMapping &&
    Object.keys(session.data.listMapping).length > 0
  ) {
    const listFallback = fallbackConfig?.list;
    const maxAttempts = listFallback?.maxAttempts ?? 7; // Default to 7 (6 invalid + 1 final)
    const attempts = (session.data.fallbackAttempts || 0) + 1;
    session.data.fallbackAttempts = attempts;
    await updateSession(session);

    if (attempts >= maxAttempts) {
      // Max attempts reached — nav to menu/start and reset
      const maxMsg =
        listFallback?.maxAttemptsMessage?.[lang] ||
        listFallback?.maxAttemptsMessage?.["en"] ||
        "Too many invalid attempts. Returning to menu.";
      await sendWhatsAppMessage(company, from, maxMsg);
      session.data.fallbackAttempts = 0;
      session.data.listMapping = {};
      session.data.buttonMapping = {};
      await updateSession(session);
      // Navigate to language selection (menu command navigateTo target)
      const menuTarget =
        (flow as any).settings?.commands?.menu?.navigateTo || flow.startStepId;
      await engine.executeStep(menuTarget);
    } else {
      // Send fallback message from flow JSON
      const fallbackMsg =
        listFallback?.messages?.[lang] ||
        listFallback?.messages?.["en"] ||
        ui("menu_fallback", lang, flow);
      await sendWhatsAppMessage(company, from, fallbackMsg);
      // Re-send the current step (list) so the user can interact again
      if (listFallback?.resendStepOnFallback) {
        const currentStep = flow.steps.find(
          (s) => s.stepId === session.data.currentStepId,
        );
        if (currentStep) await engine.executeStep(currentStep.stepId);
      }
    }
    return;
  }

  // Fallback for button steps
  if (
    session.data.buttonMapping &&
    Object.keys(session.data.buttonMapping).length > 0
  ) {
    const btnFallback = fallbackConfig?.button;
    const maxAttempts = btnFallback?.maxAttempts ?? 7; // Default to 7 (6 invalid + 1 final)
    const attempts = (session.data.fallbackAttempts || 0) + 1;
    session.data.fallbackAttempts = attempts;
    await updateSession(session);

    if (attempts >= maxAttempts) {
      // Max attempts reached — nav to menu/start and reset
      const maxMsg =
        btnFallback?.maxAttemptsMessage?.[lang] ||
        btnFallback?.maxAttemptsMessage?.["en"] ||
        "Too many invalid attempts. Returning to menu.";
      await sendWhatsAppMessage(company, from, maxMsg);
      session.data.fallbackAttempts = 0;
      session.data.listMapping = {};
      session.data.buttonMapping = {};
      await updateSession(session);
      const menuTarget =
        (flow as any).settings?.commands?.menu?.navigateTo || flow.startStepId;
      await engine.executeStep(menuTarget);
    } else {
      // Send fallback message from flow JSON
      const fallbackMsg =
        btnFallback?.messages?.[lang] ||
        btnFallback?.messages?.["en"] ||
        ui("button_fallback", lang, flow);
      await sendWhatsAppMessage(company, from, fallbackMsg);
      // Re-send the current step (buttons) so the user can interact again
      if (btnFallback?.resendStepOnFallback) {
        const currentStep = flow.steps.find(
          (s) => s.stepId === session.data.currentStepId,
        );
        if (currentStep) await engine.executeStep(currentStep.stepId);
      }
    }
    return;
  }

  // ── 10. Final fallback: Re-run current step
  const stepId = session.data.currentStepId || flow.startStepId;
  await engine.executeStep(stepId, rawInput);
}

/**
 * Helper: Start flow from beginning
 */
async function executeFlowFromStart(
  from: string,
  companyId: string,
  flow: any,
  company: any,
  trigger: string,
): Promise<void> {
  let startStepId = getStartStepForTrigger(flow, trigger) || flow.startStepId;
  const startStep = flow.steps.find((s: any) => s.stepId === startStepId);
  if (!startStep) startStepId = flow.startStepId;

  await clearSession(from, companyId);
  const session = await getSession(from, companyId);
  session.data = { flowId: flow.flowId };
  await updateSession(session);

  const engine = new DynamicFlowEngine(flow, session, company, from);
  await engine.executeStep(startStepId);
}

/**
 * Helper: Process media upload
 */
async function handleMediaUpload(
  session: UserSession,
  company: any,
  from: string,
  messageType: string,
  mediaUrl: string,
  engine: DynamicFlowEngine,
): Promise<void> {
  const { nextStepId, saveToField = "media" } = session.data.awaitingMedia;

  try {
    const whatsappConfig = (company as any)?.whatsappConfig;
    const accessToken = whatsappConfig?.accessToken;

    if (!accessToken) {
      logger.error(`❌ CRITICAL CONFIG FAILURE: Cannot process media upload for company "${company?.name || 'Unknown'}" (${company?._id}). Missing WhatsApp Access Token in CompanyWhatsAppConfig.`, {
        companyId: company?._id,
        hasConfig: !!whatsappConfig,
        field: saveToField
      });
      
      // We still store the raw ID as a absolute last resort fallback, but we mark it clearly as non-GCS
      storeMedia(session.data, saveToField, mediaUrl, messageType, false);
    } else {
      // ✅ STRICT GCP STORAGE RULES: /grievances/{grievanceId}/evidence/{timestamp}_{filename}
      let folder = (
        company?.name ||
        company?._id?.toString() ||
        "chatbot"
      ).replace(/\s+/g, "_");

      const flowIdStr = String(session.data.flowId || '');
      const isGrievanceFlow = flowIdStr.toLowerCase().includes('grievance') || 
                             session.data.awaitingMedia?.saveToField === 'media' ||
                             !!session.data.grievanceId;
      
      if (isGrievanceFlow) {
        if (!session.data.grievanceId) {
          try {
            const { getNextGrievanceId } = await import('../utils/idGenerator');
            session.data.grievanceId = await getNextGrievanceId(company._id);
          } catch (idErr) {
            logger.warn('⚠️ Could not generate grievanceId for media folder, using timestamp');
            session.data.grievanceId = `GRV${Date.now()}`;
          }
        }
        folder = `grievances/${session.data.grievanceId}/evidence`;
      }

      const timestamp = Date.now();
      logger.info(`📸 Processing media: type=${messageType}, field=${saveToField}, folder=${folder}`);
      
      const uploadResult = await uploadWhatsAppMediaToGCS(
        mediaUrl,
        accessToken,
        `${timestamp}_${mediaUrl}`,
        folder,
      );
      
      if (!uploadResult) {
        logger.error(`❌ Media upload to GCS failed for ${mediaUrl}. Falling back to raw ID.`);
      }

      storeMedia(
        session.data,
        saveToField,
        uploadResult?.url || mediaUrl,
        messageType,
        !!uploadResult,
        uploadResult?.mimeType,
        uploadResult?.originalName
      );
    }
  } catch (err: any) {
    logger.error("❌ Media upload process failed:", { message: err.message, stack: err.stack });
    storeMedia(session.data, saveToField, mediaUrl, messageType, false);
  }

  delete session.data.awaitingMedia;
  await updateSession(session);
  if (nextStepId) await engine.executeStep(nextStepId);
}

/**
 * Helper: Store media in session
 */
function storeMedia(
  data: any,
  field: string,
  url: string,
  type: string,
  isGCS: boolean,
  mimeType?: string,
  originalName?: string
): void {
  const mediaEntry = { 
    url, 
    type: (type.startsWith('image') || (mimeType && mimeType.startsWith('image'))) ? 'image' : 
          (type.startsWith('video') || (mimeType && mimeType.startsWith('video'))) ? 'video' : 'document', 
    mimeType,
    originalName,
    uploadedByRole: 'citizen' as const,
    uploadedAt: new Date(), 
    isGCS: !!isGCS 
  };

  if (field === "media") {
    data.media = data.media || [];
    data.media.push(mediaEntry);
  } else {
    data[field] = url;
    const attachmentFields = [
      "attachmentUrl",
      "attachment",
      "fileUrl",
      "documentUrl",
      "mediaUrl",
    ];
    if (attachmentFields.includes(field)) {
      data.media = data.media || [];
      const alreadyStored = data.media.some((m: any) => m.url === url);
      if (!alreadyStored) data.media.push(mediaEntry);
    }
  }
}
