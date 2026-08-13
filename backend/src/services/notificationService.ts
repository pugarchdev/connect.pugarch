import mongoose from "mongoose";
import Company from "../models/Company";
import CompanyWhatsAppConfig from "../models/CompanyWhatsAppConfig";
import Department from "../models/Department";
import User from "../models/User";
import CitizenProfile from "../models/CitizenProfile";
import {
  sendEmail,
  getNotificationEmailContent,
  getNotificationWhatsAppMessage,
} from "./emailService";
import {
  sendWhatsAppMessage,
  sendWhatsAppMedia,
  sendWhatsAppTemplate,
} from "./whatsappService";
import {
  triggerAdminTemplate,
  triggerGrievanceEvent,
  triggerGrievanceNotifications,
  triggerCitizenStatusTemplate,
} from "./grievanceTemplateTriggerService";
import { NotificationContextService } from "./notificationContextService";
import { TemplateResolverService } from "./templateResolverService";
import { notifyDepartmentAdmins as triggerInAppNotification } from "./inAppNotificationService";
import {
  buildCitizenMessage,
  getCitizenStatusLabel,
} from "./citizenMessageBuilder";
import { normalizePhoneNumber } from "../utils/phoneUtils";
import { logger } from "../config/logger";
import { UserRole } from "../config/constants";
import { formatTemplateDateTime } from "../utils/templateDateTime";

/**
 * Notification Service
 * Handles email and WhatsApp notifications for grievances and appointments
 */

interface NotificationData {
  type: "grievance" | "appointment";
  action:
    | "created"
    | "assigned"
    | "resolved"
    | "confirmation"
    | "status_change"
    | "status_update"
    | string;
  grievanceId?: string;
  appointmentId?: string;
  recipientName?: string;
  citizenName: string;
  citizenPhone: string;
  citizenWhatsApp?: string;
  citizenEmail?: string;
  departmentId?: any;
  parentDepartmentId?: any;
  subDepartmentId?: any;
  departmentName?: string;
  subDepartmentName?: string;
  evidenceUrls?: string[];
  companyId: any;
  description?: string;
  purpose?: string;
  category?: string;
  location?: string;
  remarks?: string;
  assignedTo?: any;
  assignedByName?: string;
  resolvedByName?: string;
  resolvedBy?: any;
  resolvedAt?: Date | string;
  createdAt?: Date | string;
  assignedAt?: Date | string;
  language?: string;
  appointmentDate?: Date | string;
  appointmentTime?: string;
  resolutionTimeText?: string;
  timeline?: Array<{
    action: string;
    details?: any;
    timestamp: Date | string;
    performedBy?: any;
  }>;
  grievance?: any;
}

/* ------------------------------------------------------------------ */
/* Shared Utility Helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Compute a human-readable resolution time string from two dates.
 * Returns '' if either date is missing.
 */
function computeResolutionTime(
  createdAt: Date | string | undefined,
  resolvedAt: Date | string | undefined,
): string {
  if (!createdAt || !resolvedAt) return "";
  const start = new Date(createdAt);
  const end = new Date(resolvedAt);
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return "";
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(
    (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  if (diffDays > 0)
    return `${diffDays} day${diffDays > 1 ? "s" : ""} and ${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  if (diffHours > 0) return `${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  return `${Math.max(1, diffMinutes)} minute${diffMinutes !== 1 ? "s" : ""}`;
}

const getNotificationLanguage = (
  data: Record<string, any>,
): "en" | "hi" | "or" | "mr" => {
  const lang = String(data.language || data.lang || "en").toLowerCase();
  if (lang === "hi" || lang === "or" || lang === "mr") return lang;
  return "en";
};

const getLocaleForLanguage = (lang: "en" | "hi" | "or" | "mr"): string => {
  if (lang === "hi") return "hi-IN";
  if (lang === "or") return "or-IN";
  if (lang === "mr") return "mr-IN";
  return "en-IN";
};

const GRIEVANCE_CREATED_ADMIN_TEMPLATE_NAME =
  process.env.WHATSAPP_GRIEVANCE_CREATED_ADMIN_TEMPLATE ||
  "grievance_received_admin_v2";

const GRIEVANCE_TEMPLATE_LANGUAGE = (process.env
  .WHATSAPP_GRIEVANCE_TEMPLATE_LANGUAGE || "en") as "en" | "hi" | "or" | "mr";

export const getLocalizedDepartmentName = (
  department: any,
  lang: "en" | "hi" | "or" | "mr",
): string => {
  if (!department) return "";
  if (lang === "hi" && department.nameHi)
    return String(department.nameHi).trim();
  if (lang === "or" && department.nameOr)
    return String(department.nameOr).trim();
  if (lang === "mr" && department.nameMr)
    return String(department.nameMr).trim();
  return String(department.name || "").trim();
};

const UI_TEXT: Record<"en" | "hi" | "or" | "mr", Record<string, string>> = {
  en: {
    collectorOffice: "Collector Office",
    general: "General",
    department: "Department",
    subDepartment: "Sub-Dept",
    description: "Description",
    remarks: "Remarks",
    reason: "Reason",
    resolutionRemarks: "Resolution Remarks",
    purpose: "Purpose",
    category: "Category",
    location: "Location",
    originalDepartment: "Original Dept",
    originalSubDepartment: "Original Sub-Dept",
    noteFromPreviousAdmin: "Note from the previous department admin",
    noteFromPreviousUserPrefix: "Note from",
    originalCitizenDescription: "Original Citizen Description",
    reassignmentLead:
      "This grievance is being reassigned to your department by {assignedBy}. Please investigate and take required action.",
  },
  hi: {
    collectorOffice: "कलेक्टर कार्यालय",
    general: "सामान्य",
    department: "विभाग",
    subDepartment: "उप-विभाग",
    description: "विवरण",
    remarks: "टिप्पणी",
    reason: "कारण",
    resolutionRemarks: "समाधान टिप्पणी",
    purpose: "उद्देश्य",
    category: "श्रेणी",
    location: "स्थान",
    originalDepartment: "मूल विभाग",
    originalSubDepartment: "मूल उप-विभाग",
    noteFromPreviousAdmin: "पिछले विभाग प्रशासक की टिप्पणी",
    noteFromPreviousUserPrefix: "टिप्पणी",
    originalCitizenDescription: "नागरिक द्वारा दिया गया मूल विवरण",
    reassignmentLead:
      "यह शिकायत {assignedBy} द्वारा आपके विभाग को पुनः आवंटित की गई है। कृपया जांच कर आवश्यक कार्रवाई करें।",
  },
  or: {
    collectorOffice: "କଲେକ୍ଟର କାର୍ଯ୍ୟାଳୟ",
    general: "ସାଧାରଣ",
    department: "ବିଭାଗ",
    subDepartment: "ଉପ-ବିଭାଗ",
    description: "ବିବରଣୀ",
    remarks: "ଟୀକା",
    reason: "କାରଣ",
    resolutionRemarks: "ସମାଧାନ ଟୀକା",
    purpose: "ଉଦ୍ଦେଶ୍ୟ",
    category: "ଶ୍ରେଣୀ",
    location: "ସ୍ଥାନ",
    originalDepartment: "ମୂଳ ବିଭାଗ",
    originalSubDepartment: "ମୂଳ ଉପ-ବିଭାଗ",
    noteFromPreviousAdmin: "ପୂର୍ବତନ ବିଭାଗ ପ୍ରଶାସକଙ୍କ ଟୀକା",
    noteFromPreviousUserPrefix: "ଙ୍କ ଟୀକା",
    originalCitizenDescription: "ନାଗରିକଙ୍କ ମୂଳ ବିବରଣୀ",
    reassignmentLead:
      "ଏହି ଅଭିଯୋଗ {assignedBy} ଦ୍ୱାରା ଆପଣଙ୍କ ବିଭାଗକୁ ପୁନଃ ଅବଣ୍ଟନ କରାଯାଇଛି। ଦୟାକରି ଯାଞ୍ଚ କରି ଆବଶ୍ୟକ ପଦକ୍ଷେପ ନିଅନ୍ତୁ।",
  },
  mr: {
    collectorOffice: "कलेक्टर कार्यालय",
    general: "सामान्य",
    department: "विभाग",
    subDepartment: "उप-विभाग",
    description: "वर्णन",
    remarks: "शेरा",
    reason: "कारण",
    resolutionRemarks: "निकाल शेरा",
    purpose: "उद्देश",
    category: "श्रेणी",
    location: "स्थान",
    originalDepartment: "मूळ विभाग",
    originalSubDepartment: "मूळ उप-विभाग",
    noteFromPreviousAdmin: "मागील विभाग प्रशासकाची नोंद",
    noteFromPreviousUserPrefix: "यांच्याकडून नोंद",
    originalCitizenDescription: "नागरिकाचे मूळ वर्णन",
    reassignmentLead:
      "ही तक्रार {assignedBy} यांनी तुमच्या विभागाकडे पुन्हा वर्ग केली आहे. कृपया तपास करून आवश्यक कारवाई करा.",
  },
};

const STATUS_TEXT: Record<"en" | "hi" | "or" | "mr", Record<string, string>> = {
  en: {
    ASSIGNED: "Assigned",
    IN_PROGRESS: "In Progress",
    REASSIGNED: "Reassigned",
    PENDING: "Pending",
    RESOLVED: "Resolved",
    REJECTED: "Rejected",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    CONFIRMED: "Confirmed",
    SCHEDULED: "Scheduled",
    CREATED: "Created",
  },
  hi: {
    ASSIGNED: "आवंटित",
    IN_PROGRESS: "प्रक्रिया में",
    REASSIGNED: "पुनः आवंटित",
    PENDING: "लंबित",
    RESOLVED: "समाधान किया गया",
    REJECTED: "अस्वीकृत",
    COMPLETED: "पूर्ण",
    CANCELLED: "रद्द",
    CONFIRMED: "पुष्ट",
    SCHEDULED: "निर्धारित",
    CREATED: "दर्ज",
  },
  or: {
    ASSIGNED: "ଅବଣ୍ଟନ ହୋଇଛି",
    IN_PROGRESS: "ପ୍ରକ୍ରିୟାରେ",
    REASSIGNED: "ପୁନଃ ଅବଣ୍ଟନ ହୋଇଛି",
    PENDING: "ବିଚାରାଧୀନ",
    RESOLVED: "ସମାଧାନ ହୋଇଛି",
    REJECTED: "ଖାରଜ ହୋଇଛି",
    COMPLETED: "ସମାପ୍ତ",
    CANCELLED: "ବାତିଲ୍",
    CONFIRMED: "ନିଶ୍ଚିତ",
    SCHEDULED: "ନିର୍ଦ୍ଧାରିତ",
    CREATED: "ଦାଖଲ ହୋଇଛି",
  },
  mr: {
    ASSIGNED: "नियुक्त",
    IN_PROGRESS: "प्रक्रियेत",
    REASSIGNED: "पुन्हा नियुक्त",
    PENDING: "प्रलंबित",
    RESOLVED: "निकाली काढले",
    REJECTED: "नाकारले",
    COMPLETED: "पूर्ण",
    CANCELLED: "रद्द",
    CONFIRMED: "निश्चित",
    SCHEDULED: "नियोजित",
    CREATED: "नोंदवले",
  },
};

const localizeStatusValue = (
  value: unknown,
  lang: "en" | "hi" | "or" | "mr",
): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\s+/g, "_").toUpperCase();
  return STATUS_TEXT[lang][normalized] || raw;
};

const computeLocalizedResolutionTime = (
  createdAt: Date | string | undefined,
  resolvedAt: Date | string | undefined,
  lang: "en" | "hi" | "or" | "mr",
): string => {
  if (!createdAt || !resolvedAt) return "";
  const start = new Date(createdAt);
  const end = new Date(resolvedAt);
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return "";

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(
    (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (lang === "hi") {
    if (diffDays > 0) return `${diffDays} दिन ${diffHours} घंटे`;
    if (diffHours > 0) return `${diffHours} घंटे`;
    return `${Math.max(1, diffMinutes)} मिनट`;
  }
  if (lang === "or") {
    if (diffDays > 0) return `${diffDays} ଦିନ ${diffHours} ଘଣ୍ଟା`;
    if (diffHours > 0) return `${diffHours} ଘଣ୍ଟା`;
    return `${Math.max(1, diffMinutes)} ମିନିଟ`;
  }
  if (lang === "mr") {
    if (diffDays > 0) return `${diffDays} दिवस ${diffHours} तास`;
    if (diffHours > 0) return `${diffHours} तास`;
    return `${Math.max(1, diffMinutes)} मिनिटे`;
  }

  return computeResolutionTime(createdAt, resolvedAt);
};

async function populateNotificationData(
  data: NotificationData,
): Promise<Record<string, any>> {
  const company = await findCompanyByIdOrCustomId(data.companyId);
  const lang = getNotificationLanguage(data as any);
  const locale = getLocaleForLanguage(lang);
  const copy = UI_TEXT[lang];

  const deptId = data.departmentId
    ? typeof data.departmentId === "object" && data.departmentId._id
      ? data.departmentId._id
      : data.departmentId
    : null;
  const subDeptId = data.subDepartmentId
    ? typeof data.subDepartmentId === "object" && data.subDepartmentId._id
      ? data.subDepartmentId._id
      : data.subDepartmentId
    : null;

  const department = deptId ? await findDepartmentByIdOrCustomId(deptId) : null;
  const subDept = subDeptId
    ? await findDepartmentByIdOrCustomId(subDeptId)
    : null;

  let finalDept = department;
  let finalSubDept = subDept;

  if (finalDept && finalDept.parentDepartmentId && !finalSubDept) {
    finalSubDept = finalDept;
    finalDept = await findDepartmentByIdOrCustomId(
      finalDept.parentDepartmentId,
    );
  }

  const formatFn = (d: Date) => formatTemplateDateTime(d, locale);

  const createdAt = data.createdAt || new Date();
  const formattedDate = formatFn(new Date(createdAt));
  const formattedSubmittedDate = formattedDate;

  let assignedByName = data.assignedByName || "Administrator";
  if (!data.assignedByName && data.assignedTo) {
    try {
      const aUser = await User.findById(
        data.assignedTo._id || data.assignedTo,
      ).select("firstName lastName");
      if (aUser) assignedByName = aUser.getFullName();
    } catch (e) {}
  }

  let resolvedByName = "Assigned Officer";
  if (data.resolvedBy) {
    try {
      const rUser = await User.findById(
        typeof data.resolvedBy === "object" && data.resolvedBy !== null
          ? data.resolvedBy._id || data.resolvedBy
          : data.resolvedBy,
      ).select("firstName lastName");
      if (rUser) resolvedByName = rUser.getFullName();
    } catch (e) {}
  }

  let formattedAssignedDate = "";
  if (data.assignedAt) {
    try {
      formattedAssignedDate = formatFn(new Date(data.assignedAt));
    } catch (e) {}
  }

  const resolvedAt =
    data.resolvedAt || (data.action === "resolved" ? new Date() : null);
  let formattedResolvedDate = "";
  let resolutionTimeText = data.resolutionTimeText || "";

  if (resolvedAt) {
    formattedResolvedDate = formatFn(new Date(resolvedAt));
    if (!resolutionTimeText) {
      resolutionTimeText = computeLocalizedResolutionTime(
        data.createdAt,
        resolvedAt,
        lang,
      );
    }
  }

  let formattedAppointmentDate = "";
  if (data.appointmentDate) {
    try {
      const d =
        data.appointmentDate instanceof Date
          ? data.appointmentDate
          : new Date(data.appointmentDate);
      if (!isNaN(d.getTime())) {
        formattedAppointmentDate = d.toLocaleDateString(locale, {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        });
      }
    } catch (e) {
      formattedAppointmentDate = String(data.appointmentDate);
    }
  }

  let formattedAppointmentTime = "";
  if (data.appointmentTime) {
    try {
      const parts = String(data.appointmentTime).split(":");
      if (parts.length >= 2) {
        const sampleDate = new Date(
          `2000-01-01T${parts[0].padStart(2, "0")}:${parts[1].substring(0, 2)}:00`,
        );
        formattedAppointmentTime = sampleDate.toLocaleTimeString(locale, {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: "Asia/Kolkata",
        });
      } else {
        formattedAppointmentTime = String(data.appointmentTime);
      }
    } catch (e) {
      formattedAppointmentTime = String(data.appointmentTime);
    }
  }

  let departmentName = (
    finalDept
      ? getLocalizedDepartmentName(finalDept, lang)
      : data.departmentName ||
        (data.type === "appointment" ? copy.collectorOffice : copy.general)
  ).trim();

  if (departmentName.includes(",") && !departmentName.includes("Department")) {
    departmentName = departmentName.split(",")[0].trim();
  }

  let subDepartmentName = finalSubDept
    ? getLocalizedDepartmentName(finalSubDept, lang)
    : data.subDepartmentName || "";
  if (
    subDepartmentName.toLowerCase() === "not provided" ||
    subDepartmentName === departmentName
  ) {
    subDepartmentName = "";
  }

  let description = (data.description || "").trim();
  if (description.toLowerCase() === "not provided") description = "";

  let originalDeptName = "";
  let originalSubDeptName = "";
  let reassignmentRemarks = "";
  let revertedByName = "";
  let formattedRevertedDate = "";
  const reassignedByName = String(
    (data as any).reassignedByName || data.assignedByName || "",
  ).trim();
  let formattedReassignedDate = formattedAssignedDate || formattedDate;

  if (data.timeline && Array.isArray(data.timeline)) {
    const revertEvent = [...data.timeline]
      .reverse()
      .find((t: any) => t.action === "REVERTED_TO_COMPANY_ADMIN");
    if (revertEvent && revertEvent.details) {
      reassignmentRemarks = revertEvent.details.remarks || "";
      if (revertEvent.timestamp) {
        try {
          formattedRevertedDate = formatFn(new Date(revertEvent.timestamp));
        } catch (e) {}
      }

      if (revertEvent.performedBy) {
        try {
          const rUser = await User.findById(revertEvent.performedBy).select(
            "firstName lastName",
          );
          if (rUser) revertedByName = rUser.getFullName();
        } catch (e) {}
      }

      const prevDeptId = revertEvent.details.previousDepartmentId;
      const prevSubDeptId = revertEvent.details.previousSubDepartmentId;

      if (prevDeptId) {
        const pDept = await findDepartmentByIdOrCustomId(prevDeptId);
        if (pDept) originalDeptName = getLocalizedDepartmentName(pDept, lang);
      }
      if (prevSubDeptId) {
        const pSubDept = await findDepartmentByIdOrCustomId(prevSubDeptId);
        if (pSubDept)
          originalSubDeptName = getLocalizedDepartmentName(pSubDept, lang);
      }
    }
  }

  const originalDeptLabel = originalDeptName
    ? `\n🏢 *${copy.originalDepartment}:* ${originalDeptName}`
    : "";
  const originalSubDeptLabel =
    originalSubDeptName && originalSubDeptName !== originalDeptName
      ? `\n🏢 *${copy.originalSubDepartment}:* ${originalSubDeptName}`
      : "";

  const noteFromLabel = revertedByName
    ? lang === "or"
      ? `${revertedByName}${copy.noteFromPreviousUserPrefix}`
      : `${copy.noteFromPreviousUserPrefix} ${revertedByName}`
    : copy.noteFromPreviousAdmin;
  const reassignmentRemarksLabel = reassignmentRemarks
    ? `\n📝 *${noteFromLabel}:* ${reassignmentRemarks}`
    : "";

  if (
    (data.action === "assigned" || data.action === "assigned_admin") &&
    data.timeline
  ) {
    const wasReverted = data.timeline.some(
      (t: any) => t.action === "REVERTED_TO_COMPANY_ADMIN",
    );
    if (wasReverted) {
      const reassignmentNote = copy.reassignmentLead.replace(
        "{assignedBy}",
        assignedByName || "Admin",
      );
      description = `${reassignmentNote}\n${reassignmentRemarksLabel}\n${originalDeptLabel}${originalSubDeptLabel}\n\n*${copy.originalCitizenDescription}:*\n${description}`;
      if (!formattedReassignedDate) {
        formattedReassignedDate =
          formattedAssignedDate || formattedSubmittedDate;
      }
    }
  }

  const deptLabel = departmentName
    ? `\n🏢 *${copy.department}:* ${departmentName}`
    : "";
  const subDeptLabel = subDepartmentName
    ? `\n🏢 *${copy.subDepartment}:* ${subDepartmentName}`
    : "";
  const descriptionLabel = description
    ? `\n📝 *${copy.description}:*\n${description}`
    : "";

  const rawRemarks = String(data.remarks || "").trim();
  const remarksLabel = rawRemarks
    ? `\n📝 *${copy.remarks}:*\n${rawRemarks}`
    : "";
  const reasonLabel = rawRemarks ? `\n❌ *${copy.reason}:* ${rawRemarks}` : "";
  const resolutionLabel = rawRemarks
    ? `\n✅ *${copy.resolutionRemarks}:*\n${rawRemarks}`
    : "";

  const rawPurpose = String(data.purpose || "").trim();
  const purposeLabel = rawPurpose
    ? `\n🎯 *${copy.purpose}:* ${rawPurpose}`
    : "";

  const rawCategory = String(data.category || "").trim();
  const categoryLabel = rawCategory
    ? `\n📁 *${copy.category}:* ${rawCategory}`
    : "";

  const loc = data.location as any;
  const locAddress =
    loc && typeof loc === "object" ? loc.address || loc.name || "" : loc || "";
  const locationLabel = String(locAddress).trim()
    ? `\n📍 *${copy.location}:* ${String(locAddress).trim()}`
    : "";

  return {
    ...data,
    companyName: company?.name || "Portal Admin",
    recipientName:
      data.recipientName && String(data.recipientName).trim()
        ? String(data.recipientName).trim()
        : data.action === "assigned" || data.action === "assigned_admin"
          ? assignedByName || "Admin"
          : data.citizenName || "Citizen",
    departmentName,
    subDepartmentName,
    officeName: subDepartmentName || departmentName,
    subdepartmentName: subDepartmentName,
    description,
    grievanceDetails: description,
    deptLabel,
    subDeptLabel,
    descriptionLabel,
    remarksLabel,
    reasonLabel,
    resolutionLabel,
    purposeLabel,
    categoryLabel,
    locationLabel,
    assignedByName,
    reassignedByName: reassignedByName || assignedByName,
    reassignmentNote: rawRemarks || reassignmentRemarks || "",
    resolvedByName,
    revertedByName,
    formattedDate,
    submittedDate: formattedSubmittedDate,
    assignedDate: formattedAssignedDate || formattedSubmittedDate,
    formattedAssignedDate: formattedAssignedDate || formattedSubmittedDate,
    formattedResolvedDate,
    formattedRevertedDate,
    reassignedDate:
      formattedReassignedDate ||
      formattedAssignedDate ||
      formattedSubmittedDate,
    formattedReassignedDate:
      formattedReassignedDate ||
      formattedAssignedDate ||
      formattedSubmittedDate,
    formattedAppointmentDate,
    formattedAppointmentTime,
    appointmentDate: formattedAppointmentDate || data.appointmentDate || "",
    appointmentTime: formattedAppointmentTime || data.appointmentTime || "",
    resolutionTimeText,
    originalDepartment: originalDeptName || "",
    originalOffice: originalSubDeptName || originalDeptName || "",
    newStatus: localizeStatusValue((data as any).newStatus, lang),
    oldStatus: localizeStatusValue((data as any).oldStatus, lang),
    "Submitted On": formattedDate,
    submittedOn: formattedDate,
    forest_range: (data as any).forest_range || "",
    forest_beat: (data as any).forest_beat || "",
    forest_compartment: (data as any).forest_compartment || "",
    remarks: data.remarks || "",
    "Case ID": data.grievanceId || data.appointmentId || "N/A",
    grievanceId: data.grievanceId || "N/A",
    appointmentId: data.appointmentId || "N/A",
    refNumber: data.grievanceId || data.appointmentId || "N/A",
    createdAt: formattedDate,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Load company and attach WhatsApp config from CompanyWhatsAppConfig so notifications can be sent */
async function getCompanyWithWhatsAppConfig(
  companyId: any,
): Promise<any | null> {
  if (!companyId) return null;

  let id = companyId;
  if (typeof companyId === "object" && companyId !== null) {
    id = companyId._id || id;
  }

  const finalId = id?.toString ? id.toString() : id;

  if (
    !finalId ||
    typeof finalId !== "string" ||
    finalId.length > 30 ||
    finalId.includes("{")
  ) {
    logger.error(
      "❌ Invalid companyId passed to getCompanyWithWhatsAppConfig:",
      {
        type: typeof companyId,
        value: typeof companyId === "object" ? "Object" : companyId,
      },
    );
    return null;
  }

  try {
    let company: any = null;

    if (mongoose.Types.ObjectId.isValid(finalId) && finalId.length === 24) {
      company = await Company.findById(finalId);
    }

    if (!company) {
      company = await Company.findOne({ companyId: finalId });
    }

    if (!company) return null;

    const config = await CompanyWhatsAppConfig.findOne({
      companyId: company._id,
      isActive: true,
    });

    if (config) {
      if (!config.phoneNumberId || !config.accessToken) {
        logger.warn(
          `⚠️ WhatsApp configuration exists but is incomplete for company ${company.name}`,
          {
            hasPhoneId: !!config.phoneNumberId,
            hasToken: !!config.accessToken,
          },
        );
      }
      (company as any).whatsappConfig = {
        phoneNumberId: config.phoneNumberId,
        accessToken: config.accessToken,
      };
      logger.info(`✅ Attached WhatsApp config to company ${company.name}`);
    } else {
      logger.info(
        `ℹ️ No active WhatsApp config found for company ${company.name}`,
      );
    }
    return company;
  } catch (error) {
    logger.error("❌ Error in getCompanyWithWhatsAppConfig:", error);
    return null;
  }
}

function isWhatsAppEnabled(company: any): boolean {
  return Boolean(
    company?.whatsappConfig &&
    company.whatsappConfig.phoneNumberId &&
    company.whatsappConfig.accessToken,
  );
}

/** Robustly find a department by either Mongo _id or custom departmentId string */
async function findDepartmentByIdOrCustomId(id: any): Promise<any | null> {
  if (!id) return null;
  const idStr = id.toString();

  // Try ObjectId first if valid
  if (mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
    const dept = await Department.findById(idStr);
    if (dept) return dept;
  }

  // Fallback to custom departmentId string
  return await Department.findOne({ departmentId: idStr });
}

/** Robustly find a company by either Mongo _id or custom companyId string */
async function findCompanyByIdOrCustomId(id: any): Promise<any | null> {
  if (!id) return null;
  const idStr = id.toString();

  if (mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
    const company = await Company.findById(idStr);
    if (company) return company;
  }

  return await Company.findOne({ companyId: idStr });
}

/**
 * Checks if a notification type (email or whatsapp) is enabled for a specific role in a company.
 * Defaults to true if settings are missing.
 */
function canNotify(
  company: any,
  user: any,
  type: "email" | "whatsapp",
  action?: string,
): boolean {
  // 1. Individual User Setting (Highest Priority)
  if (user?.notificationSettings) {
    const settings = user.notificationSettings;

    // 🚩 Option C: IF EXPLICIT OVERRIDE IS ENABLED → USER SETTINGS WIN
    if (settings.hasOverride) {
      // Check granular first if action is provided
      if (action && settings.actions && settings.actions[action]) {
        if (typeof settings.actions[action][type] === "boolean") {
          return settings.actions[action][type];
        }
      }
      // Fallback to global user setting for this channel
      return !!settings[type];
    }

    // Default Behavior (Kill Switch Only): If user expressly disabled this channel, stop here.
    if (settings[type] === false) return false;

    // Check granular if action is provided (but only if it's explicitly disabled)
    if (action && settings.actions && settings.actions[action]) {
      if (settings.actions[action][type] === false) {
        return false;
      }
    }
  }

  // 2. Role Based Setting
  const populatedRole = user?.customRoleId;
  if (
    populatedRole &&
    typeof populatedRole === "object" &&
    populatedRole.notificationSettings
  ) {
    const rSettings = populatedRole.notificationSettings;

    // Global Kill Switch for Role: If the role itself prohibits this channel, stop here.
    if (rSettings[type] === false) return false;

    // Role-level action overrides (if available in future/extended schemas)
    if (
      action &&
      (rSettings as any).actions &&
      (rSettings as any).actions[action]
    ) {
      if (typeof (rSettings as any).actions[action][type] === "boolean") {
        return (rSettings as any).actions[action][type];
      }
    }
  }

  // 3. Company Default / Legacy Role Map
  const rolesMap = company?.notificationSettings?.roles;
  if (!rolesMap) return true; // Default to true if no company-level restrictions

  // Extract roles identifiers (Key and Name)
  const roleKey = (user?.customRoleId as any)?.key || user?.role || "";
  const roleName = (user?.customRoleId as any)?.name || user?.role || "";
  const isSuper =
    user?.isSuperAdmin ||
    String(roleKey || "").toUpperCase() === "SUPER_ADMIN" ||
    String(roleName || "").toUpperCase() === "SUPER ADMIN";

  if (isSuper) return true; // Platform admins bypass company restrictions

  const roleCandidates = Array.from(
    new Set([
      roleKey,
      roleName,
      roleKey.toUpperCase(),
      roleKey.replace(/[\s-]+/g, "_").toUpperCase(),
      roleName.replace(/[\s-]+/g, "_").toUpperCase(),
    ]),
  ).filter(Boolean);

  let roleSettings: any;

  if (typeof (rolesMap as any).get === "function") {
    for (const candidate of roleCandidates) {
      roleSettings = (rolesMap as Map<string, any>).get(candidate);
      if (roleSettings) break;
    }
  } else {
    for (const candidate of roleCandidates) {
      roleSettings = rolesMap[candidate as any];
      if (roleSettings) break;
    }
  }

  if (!roleSettings) return true;

  // Global Kill Switch for Company Role setting
  if (roleSettings[type] === false) return false;

  // Check granular role settings from company record
  if (action && roleSettings.actions && roleSettings.actions[action]) {
    if (typeof roleSettings.actions[action][type] === "boolean") {
      return roleSettings.actions[action][type];
    }
  }

  return true;
}

function normalizePhone(phone?: string): string | null {
  if (!phone) return null;
  return normalizePhoneNumber(phone);
}

function normalizeId(value: any): any {
  if (!value) return value;
  if (typeof value === "object" && value !== null) {
    return value._id || value.id || value;
  }
  return value;
}

function getUserDisplayName(user: any): string {
  if (!user) return "Admin";
  if (typeof user.getFullName === "function") return user.getFullName();
  const first = user.firstName || "";
  const last = user.lastName || "";
  return `${first} ${last}`.trim() || "Admin";
}

/**
 * Shared helper to send multiple media URLs to a recipient
 */
async function sendMediaIfAvailable(
  company: any,
  to: string,
  urls?: string[],
  caption?: string,
) {
  if (!urls || urls.length === 0) return;

  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) return;

  for (const url of urls) {
    try {
      // Basic type detection based on extension
      const ext = url.split(".").pop()?.toLowerCase() || "";
      const isImage = ["jpg", "jpeg", "png", "webp"].includes(ext);
      const isVideo = ["mp4", "mov", "avi"].includes(ext);
      const isAudio = ["mp3", "wav", "ogg", "m4a"].includes(ext);

      let type: "image" | "document" | "video" | "audio" = "document";
      if (isImage) type = "image";
      else if (isVideo) type = "video";
      else if (isAudio) type = "audio";

      await sendWhatsAppMedia(
        company,
        normalizedTo,
        url,
        type,
        caption || "Attachment",
      );
    } catch (err) {
      logger.error("❌ Error sending media attachment:", err);
    }
  }
}

async function hasCitizenNotificationConsent(
  companyId: any,
  rawPhone: string | undefined,
): Promise<boolean> {
  if (!rawPhone) return false;

  const phone = normalizePhoneNumber(rawPhone);
  const profile = await CitizenProfile.findOne({
    companyId: normalizeId(companyId),
    phone_number: phone,
  })
    .select("notification_consent notificationConsent")
    .lean();

  return Boolean(profile?.notification_consent ?? profile?.notificationConsent);
}

/**
 * Sends multiple media URLs using specialized media templates (image, video, document)
 */
async function sendMediaTemplatesToCitizen(
  company: any,
  to: string | undefined,
  citizenName: string,
  urls: string[],
  language: string,
) {
  if (!to || !urls || urls.length === 0) return;
  const normalizedTo = normalizePhoneNumber(to);

  for (const url of urls) {
    try {
      const ext = url.split(".").pop()?.toLowerCase() || "";
      const isImage = ["jpg", "jpeg", "png", "webp"].includes(ext);
      const isVideo = ["mp4", "mov", "avi"].includes(ext);

      const templateName = isVideo
        ? "media_video_v1"
        : isImage
          ? "media_image_v1"
          : "media_document_v1";

      await sendWhatsAppTemplate(
        company,
        normalizedTo,
        templateName,
        [citizenName.substring(0, 60)],
        language,
        url, // headerParam
      );
    } catch (err) {
      logger.error(`❌ Error sending media template (${url}):`, err);
    }
  }
}

async function safeSendWhatsApp(
  company: any,
  rawPhone: string | undefined,
  message: string,
  ctaButton?: { title: string; url: string },
): Promise<{ success: boolean; error?: string }> {
  if (!rawPhone) {
    logger.warn("⚠️ No phone number provided for WhatsApp notification");
    return { success: false, error: "No phone number provided" };
  }

  if (!isWhatsAppEnabled(company)) {
    logger.warn("⚠️ WhatsApp config invalid or missing for company", {
      company: company?.name,
      hasConfig: !!company?.whatsappConfig,
      hasPhoneId: !!company?.whatsappConfig?.phoneNumberId,
      hasToken: !!company?.whatsappConfig?.accessToken,
    });
    return { success: false, error: "WhatsApp not configured" };
  }

  const phone = normalizePhone(rawPhone);
  if (!phone) {
    logger.warn("⚠️ Invalid WhatsApp phone number format:", rawPhone);
    return { success: false, error: "Invalid phone number format" };
  }

  try {
    let result;
    if (ctaButton) {
      const { sendWhatsAppCTA } = await import("./whatsappService");
      result = await sendWhatsAppCTA(
        company,
        phone,
        message,
        ctaButton.title,
        ctaButton.url,
      );
    } else {
      result = await sendWhatsAppMessage(company, phone, message);
    }

    if (result.success) {
      logger.info(
        `✅ [WhatsApp] Sent successfully to ${phone} (${company.name})`,
        { messageId: result.messageId },
      );
      return { success: true };
    } else {
      logger.error(`❌ [WhatsApp] Send failed to ${phone} (${company.name})`, {
        error: result.error,
      });
      return { success: false, error: result.error };
    }
  } catch (error: any) {
    logger.error(
      `❌ [WhatsApp] Send exception for ${phone} (${company.name})`,
      {
        error: error?.response?.data || error?.message || error,
      },
    );
    return { success: false, error: error?.message || "Unknown error" };
  }
}

async function sendWhatsAppTemplateWithTextFallback(
  company: any,
  to: string | undefined,
  templateName: string,
  parameters: string[] | Record<string, string>,
  fallbackMessage: string,
  options?: {
    language?: "en" | "hi" | "or" | "mr";
    headerParam?: string;
    contextLabel?: string;
    disableTextFallback?: boolean;
    priority?: "text" | "template";
  },
): Promise<{ success: boolean; error?: string }> {
  if (!to) {
    return { success: false, error: "No phone number provided" };
  }

  const language = options?.language || GRIEVANCE_TEMPLATE_LANGUAGE;
  const contextLabel = options?.contextLabel || templateName;
  const safeParams = Array.isArray(parameters)
    ? parameters.map((p) => (p ?? "").toString())
    : Object.fromEntries(
        Object.entries(parameters || {}).map(([key, value]) => [
          key,
          String(value ?? ""),
        ]),
      );
  const allowTextFallback = options?.disableTextFallback !== true;

  // 1. If priority is 'text', try sending regular message first
  if (options?.priority === "text" && allowTextFallback) {
    const textResult = await safeSendWhatsApp(company, to, fallbackMessage);
    if (textResult.success) {
      logger.info(
        `✅ WhatsApp message sent (${contextLabel}) - Text Priority`,
        { to },
      );
      return { success: true };
    }
    logger.warn(
      `⚠️ WhatsApp text priority failed, falling back to template (${contextLabel})`,
      { to, error: textResult.error },
    );
  }

  // 2. Try Template (as default or as backup for text priority)
  const templateResult = await sendWhatsAppTemplate(
    company,
    to,
    templateName,
    safeParams,
    language,
    options?.headerParam,
    undefined,
    {
      recipientType: "CITIZEN",
      fallbackText: allowTextFallback ? fallbackMessage : undefined,
      disableFreeformFallback: !allowTextFallback,
    },
  );

  if (templateResult?.success) {
    logger.info(`✅ WhatsApp template sent (${contextLabel})`, {
      to,
      templateName,
      language,
    });
    return { success: true };
  }

  logger.warn(`⚠️ WhatsApp template send failed (${contextLabel})`, {
    to,
    templateName,
    language,
    error: templateResult?.error,
  });

  return {
    success: false,
    error: templateResult?.error || "Message delivery failed",
  };
}

/* ------------------------------------------------------------------ */
/* Department Admin Lookup                                             */
/* ------------------------------------------------------------------ */

/**
 * 🏢 HIERARCHICAL LOOKUP: Returns ALL department admins in the chain.
 * For a sub-department, we notify:
 *   1. The sub-department's own admin
 *   2. The parent department's admin
 *   3. All relevant roles across the chain (HOD, Chief, etc.)
 */
export async function getHierarchicalDepartmentAdmins(
  departmentId: any,
): Promise<any[]> {
  const admins: any[] = [];
  if (!departmentId) return admins;

  try {
    let currentDeptId = departmentId;
    const processedDeptIds = new Set<string>();

    while (currentDeptId) {
      const dept = await findDepartmentByIdOrCustomId(currentDeptId);
      if (!dept) break;

      const currentIdStr = dept._id.toString();
      if (processedDeptIds.has(currentIdStr)) break;
      processedDeptIds.add(currentIdStr);

      const isSubDept = !!dept.parentDepartmentId;

      // 🔍 2. Build Query for Roles at this level
      const RoleModel = (await import("../models/Role")).default;
      const levelAdminRoles = await RoleModel.find({
        $or: [{ companyId: dept.companyId }, { companyId: null }],
        $and: [
          {
            $or: [
              {
                key: isSubDept
                  ? /SUB[- _]?DEPARTMENT[- _]?ADMIN/i
                  : /DEPARTMENT[- _]?ADMIN/i,
              },
              {
                name: {
                  $regex: isSubDept
                    ? /sub[- _]?department[- _]?admin|sub[- _]?admin/i
                    : /department[- _]?admin|dept[- _]?admin/i,
                },
              },
              {
                permissions: {
                  $elemMatch: {
                    module: {
                      $regex: /grievance|appointment|user_management/i,
                    },
                    actions: {
                      $in: ["all", "manage", "assign", "status_change"],
                    },
                  },
                },
              },
            ],
          },
        ],
      }).select("_id name key");

      const adminRoleIds = levelAdminRoles.map((r) => r._id);
      const adminRoleKeys = levelAdminRoles
        .filter((r) => r.key)
        .map((r) => r.key);
      const adminRoleIdStrings = adminRoleIds.map((id) => id.toString());

      logger.info(
        `🔍 [Hierarchy] Level: ${dept.name} (${isSubDept ? "Sub-Dept" : "Dept"}). Found ${levelAdminRoles.length} matching admin roles.`,
      );

      // Robust User Query to find admins at this department level
      // We look for users who have either:
      // 1. The customRoleId matching an admin role
      // 2. The designation matching known admin patterns
      const roleFilters: any[] = [
        { customRoleId: { $in: adminRoleIds } },
        {
          designations: isSubDept
            ? /SUB[- _]?DEPARTMENT[- _]?ADMIN|SUB[- _]?ADMIN|TAHASILDAR/i
            : /DEPARTMENT[- _]?ADMIN|DEPT[- _]?ADMIN|COLLECTOR|DM/i,
        },
      ];

      const adminQuery: any = {
        companyId: dept.companyId,
        isActive: true,
        $and: [
          {
            departmentIds: {
              $in: [new mongoose.Types.ObjectId(currentIdStr), currentIdStr],
            },
          },
          { $or: roleFilters },
        ],
      };

      const levelAdmins = await User.find(adminQuery).populate("customRoleId");

      if (levelAdmins.length === 0) {
        logger.warn(
          `⚠️ [Hierarchy] No matching admins found at level: ${dept.name}. Check if users have the correct Department ID and Role.`,
        );
      } else {
        logger.info(
          `👥 [Hierarchy] Found ${levelAdmins.length} potential admins at ${dept.name} level.`,
        );
      }

      levelAdmins.forEach((admin) => {
        if (!admins.find((a) => a._id.toString() === admin._id.toString())) {
          logger.info(
            `✅ [Hierarchy] Adding admin recipient: ${getUserDisplayName(admin)} (${admin.email || admin.phone})`,
          );
          admins.push(admin);
        }
      });

      // Move up the hierarchy
      currentDeptId = dept.parentDepartmentId;
      if (currentDeptId) {
        logger.info(
          `🪜 [Hierarchy] Moving up to parent department: ${currentDeptId}`,
        );
      }
    }

    return admins;
  } catch (error) {
    logger.error("❌ Error in getHierarchicalDepartmentAdmins:", error);
    return admins;
  }
}

/* ------------------------------------------------------------------ */
/* Creation Notification                                               */
/* ------------------------------------------------------------------ */

export async function notifyDepartmentAdminOnCreation(
  data: NotificationData,
): Promise<void> {
  try {
    const companyId = normalizeId(data.companyId);
    const company = await getCompanyWithWhatsAppConfig(companyId);
    if (!company) return;

    const adminsToNotify: any[] = [];
    const targetChainId = normalizeId(
      data.subDepartmentId || data.departmentId,
    );

    // 1. Get Hierarchical Admins (Sub-Dept -> Dept -> Parent Dept)
    if (targetChainId) {
      const deptAdmins = await getHierarchicalDepartmentAdmins(targetChainId);
      deptAdmins.forEach((admin) =>
        adminsToNotify.push({ user: admin, type: "DEPT_ADMIN" }),
      );
    }

    // 2. Step 2 (Company Admins) is REMOVED as per request: only notify the "designated admin" of the department.
    // companyAdmins.forEach(admin => adminsToNotify.push({ user: admin, type: 'COMPANY_ADMIN' }));

    // 3. Deduplicate (Prevent multiple notifications if user is both Dept and Company admin)
    const uniqueAdminsStore = new Map<string, any>();
    adminsToNotify.forEach((entry) => {
      if (entry.user && entry.user._id) {
        uniqueAdminsStore.set(entry.user._id.toString(), entry);
      }
    });

    const finalAdminsToNotify = Array.from(uniqueAdminsStore.values());
    logger.info(
      `🔍 [Notification] Found ${finalAdminsToNotify.length} unique admins (Hierarchy + Company) for ${data.type}`,
    );

    if (finalAdminsToNotify.length === 0) {
      logger.warn(
        `⚠️ [Broadcasting] No admins found to notify for company ${company.name} (${data.grievanceId || data.appointmentId})`,
      );
      return;
    }

    // 🔔 In-App: Notify hierarchy (bell icon on portal)
    if (targetChainId) {
      triggerInAppNotification({
        companyId: data.companyId,
        departmentId: targetChainId,
        eventType: "GRIEVANCE_RECEIVED",
        title: "New Grievance Received",
        message: `Grievance ${data.grievanceId} has been filed for your department.`,
        grievanceId: data.grievanceId,
        grievanceObjectId: (data.grievance as any)?._id || data.grievance,
      }).catch((err) => logger.error("❌ In-App Notification failed:", err));
    }

    // ✅ CONCURRENT NOTIFICATIONS (WhatsApp/Email)
    await Promise.allSettled(
      finalAdminsToNotify.map(async ({ user, type }) => {
        try {
          const notificationData: NotificationData = {
            ...data,
            recipientName: getUserDisplayName(user),
          };

          const notificationTasks: Promise<any>[] = [];
          const dashboardUrl = "https://sahaj.pugarch.in/";
          const adminCta = { title: "Access Dashboard", url: dashboardUrl };

          // 📧 Email
          const emailAddress = user.email;
          if (
            emailAddress &&
            canNotify(company, user, "email", `${data.type}_created`)
          ) {
            const emailTask = (async () => {
              const email = await getNotificationEmailContent(
                companyId,
                data.type,
                "created",
                notificationData,
                true,
              );
              if (email) {
                const result = await sendEmail(
                  emailAddress,
                  email.subject,
                  email.html,
                  email.text,
                  { companyId },
                );
                if (result.success) {
                  logger.info(
                    `✅ Email sent to ${type} ${getUserDisplayName(user)} (${emailAddress})`,
                  );
                }
              } else {
                logger.warn(
                  `⚠️ No email content found for admin ${emailAddress} (Action: created)`,
                );
              }
            })();
            notificationTasks.push(emailTask);
          } else {
            logger.info(
              `ℹ️ Skipping email for admin ${user.email}: emailExists=${!!emailAddress}, canNotify=${canNotify(company, user, "email", `${data.type}_created`)}`,
            );
          }

          // 📱 WhatsApp
          if (canNotify(company, user, "whatsapp", `${data.type}_created`)) {
            const whatsappTask = (async () => {
              const fullData = await populateNotificationData(notificationData);
              logger.info(
                `📢 Dispatching WhatsApp to admin: ${user.phone} (${getUserDisplayName(user)})`,
              );

              if (data.type === "grievance") {
                const media = (data.evidenceUrls || []).map((url) => {
                  const cleanUrl = String(url || "")
                    .toLowerCase()
                    .split("?")[0];
                  const ext = cleanUrl.split(".").pop() || "";
                  const type = (
                    ["jpg", "jpeg", "png", "webp", "heic"].includes(ext)
                      ? "image"
                      : ["mp4", "mov", "avi", "3gp", "m4v"].includes(ext)
                        ? "video"
                        : "document"
                  ) as "image" | "video" | "document";
                  return { url, type };
                });

                // 🚀 WhatsApp: Only for direct department admins (Skip hierarchy for WhatsApp as per request)
                const userDeptId =
                  user.departmentId?.toString() ||
                  user.departmentIds?.[0]?.toString();
                const isDirectAdmin = userDeptId === targetChainId?.toString();

                if (isDirectAdmin) {
                  await triggerGrievanceEvent({
                    eventKey: "GRIEVANCE_CREATED",
                    companyId: data.companyId,
                    grievance: data.grievance || {
                      grievanceId: data.grievanceId,
                    },
                    department: fullData.departmentName,
                    subDept: fullData.subDepartmentName,
                    recipientPhones: [user.phone],
                    admin: user,
                    citizenPhone: data.citizenPhone,
                    language: data.language,
                    media: media.length > 0 ? media : undefined,
                    buttonParam: dashboardUrl,
                  });
                } else {
                  logger.info(
                    `🪜 [Hierarchy] Skipping WhatsApp for hierarchy admin ${user.email} (In-App notification only)`,
                  );
                }
                return;
              }

              let sentViaTemplate = false;

              if (!sentViaTemplate) {
                // 🏷️ ALIGNMENT FIX: Use 'created_admin' to match DEFAULT_WA_MESSAGES
                let message = await getNotificationWhatsAppMessage(
                  companyId,
                  data.type,
                  "created_admin",
                  fullData,
                );
                if (!message) {
                  logger.warn(
                    `⚠️ No WhatsApp content found for ${user.email} (Action: created_admin)`,
                  );
                  return;
                }
                const res = await safeSendWhatsApp(
                  company,
                  user.phone,
                  message,
                  adminCta,
                );
                if (res.success) {
                  logger.info(`✅ WhatsApp sent to admin: ${user.phone}`);
                }
              }
              // Send attachments if any
              if (data.evidenceUrls && data.evidenceUrls.length > 0) {
                await sendMediaIfAvailable(
                  company,
                  user.phone,
                  data.evidenceUrls,
                  `Evidence for ${fullData.grievanceId || fullData.appointmentId}`,
                );
              }
            })();
            notificationTasks.push(whatsappTask);
          }

          await Promise.allSettled(notificationTasks);
        } catch (err) {
          logger.error(
            `❌ Error in admin notification block for ${user?.email}:`,
            err,
          );
        }
      }),
    );
  } catch (error) {
    logger.error("❌ notifyDepartmentAdminOnCreation failed:", error);
  }
}

export async function notifyCompanyAdminsOnRevert(
  data: NotificationData,
): Promise<void> {
  try {
    if (data.type === "grievance") {
      return;
    }

    const companyId = normalizeId(data.companyId);
    const company = await getCompanyWithWhatsAppConfig(companyId);
    if (!company) return;

    const companyAdminRoleIds = await (
      await import("../models/Role")
    ).default
      .find({
        companyId,
        key: { $in: ["COMPANY_ADMIN", "ADMIN", "COMPANY_HEAD", "SUPER_ADMIN"] },
      })
      .distinct("_id");

    const companyAdmins = await User.find({
      companyId,
      $or: [
        { isSuperAdmin: true },
        { customRoleId: { $in: companyAdminRoleIds } },
      ],
      isActive: true,
    });

    if (!companyAdmins.length) return;

    const dashboardUrl = "https://sahaj.pugarch.in/";
    const adminCta = { title: "Access Dashboard", url: dashboardUrl };

    await Promise.allSettled(
      companyAdmins.map(async (user) => {
        if (!user.phone) return;
        const fullData = await populateNotificationData({
          ...data,
          recipientName: getUserDisplayName(user),
        });
        const message = await getNotificationWhatsAppMessage(
          companyId,
          data.type,
          "reverted_admin",
          fullData,
        );
        if (!message) return;
        await safeSendWhatsApp(company, user.phone, message, adminCta);
      }),
    );
  } catch (error) {
    logger.error("❌ notifyCompanyAdminsOnRevert failed:", error);
  }
}

/* ------------------------------------------------------------------ */
/* Assignment Notification                                             */
/* ------------------------------------------------------------------ */

export async function notifyUserOnAssignment(
  data: NotificationData,
): Promise<void> {
  try {
    const company = await getCompanyWithWhatsAppConfig(data.companyId);
    if (!company) return;

    const user = await User.findById(data.assignedTo).populate("customRoleId");
    if (!user) return;

    // 📧 Email
    const wasReverted = data.timeline?.some(
      (t: any) => t.action === "REVERTED_TO_COMPANY_ADMIN",
    );
    const assignmentAction =
      data.type === "appointment"
        ? "appointment_scheduled"
        : wasReverted
          ? `${data.type}_reassigned`
          : `${data.type}_assigned`;

    const fullData = await populateNotificationData({
      ...data,
      recipientName: getUserDisplayName(user) || "Admin",
    });

    if (user.email && canNotify(company, user, "email", assignmentAction)) {
      try {
        const email = await getNotificationEmailContent(
          data.companyId,
          data.type,
          "assigned",
          fullData,
          true,
        );
        if (email) {
          await sendEmail(user.email, email.subject, email.html, email.text, {
            companyId: data.companyId,
          });
        }
      } catch (e) {}
    }

    // 📱 WhatsApp — notify hierarchy for grievance reassignment/assignment
    const recipients = new Map<string, any>([[user._id.toString(), user]]);
    if (data.type === "grievance") {
      const hierarchyDeptId = data.subDepartmentId || data.departmentId;
      if (hierarchyDeptId) {
        const hierarchyAdmins =
          await getHierarchicalDepartmentAdmins(hierarchyDeptId);
        hierarchyAdmins.forEach((admin) =>
          recipients.set(admin._id.toString(), admin),
        );
      }
    }

    const actionKey = wasReverted ? "reassigned_admin" : "assigned_admin";
    const dashboardUrl = "https://sahaj.pugarch.in/";
    const adminCta = { title: "Access Dashboard", url: dashboardUrl };
    const citizenPhones = [
      data.citizenWhatsApp?.replace(/\D/g, ""),
      data.citizenPhone?.replace(/\D/g, ""),
      (data as any).phone?.replace(/\D/g, ""),
    ].filter(Boolean);

    if (data.type === "grievance") {
      return;
    }

    await Promise.allSettled(
      Array.from(recipients.values()).map(async (recipient: any) => {
        const isStaff =
          recipient.isSuperAdmin === true || recipient.customRoleId != null;
        if (
          !isStaff ||
          !recipient.phone ||
          !canNotify(company, recipient, "whatsapp", assignmentAction)
        )
          return;

        const userPhoneNormalized = recipient.phone?.replace(/\D/g, "");
        if (userPhoneNormalized && citizenPhones.includes(userPhoneNormalized))
          return;

        const recipientData = await populateNotificationData({
          ...data,
          recipientName: getUserDisplayName(recipient) || "Admin",
        });

        const message = await getNotificationWhatsAppMessage(
          data.companyId,
          data.type,
          actionKey,
          recipientData,
        );
        if (!message) return;
        await safeSendWhatsApp(company, recipient.phone, message, adminCta);
        if (data.type !== "grievance" && data.evidenceUrls?.length) {
          await sendMediaIfAvailable(
            company,
            recipient.phone,
            data.evidenceUrls,
            `Files for Assignment: ${recipientData.grievanceId || recipientData.appointmentId}`,
          );
        }
      }),
    );
  } catch (error) {
    logger.error("❌ notifyUserOnAssignment failed:", error);
  }
}

/* ------------------------------------------------------------------ */
/* Resolution Notification                                             */
/* ------------------------------------------------------------------ */

export async function notifyCitizenOnResolution(
  data: NotificationData,
): Promise<void> {
  try {
    const company = await getCompanyWithWhatsAppConfig(data.companyId);
    if (!company) return;

    // populateNotificationData handles department lookup, resolvedBy lookup,
    // date formatting, and resolution time computation — no duplicates here.
    const fullData = await populateNotificationData(data);

    // 📱 WhatsApp — use triggerCitizenStatusTemplate for grievances, fallback for others
    if (data.type === "grievance") {
      const media = (data.evidenceUrls || []).map((url) => {
        const ext = url.split(".").pop()?.toLowerCase() || "";
        const type: "image" | "video" | "document" = [
          "jpg",
          "jpeg",
          "png",
          "webp",
        ].includes(ext)
          ? "image"
          : ["mp4", "mov", "avi"].includes(ext)
            ? "video"
            : "document";
        return { url, type };
      });

      await triggerCitizenStatusTemplate({
        companyId: data.companyId,
        citizenPhone: data.citizenPhone,
        citizenName: data.citizenName,
        grievanceId: data.grievanceId!,
        departmentName: fullData.departmentName || "N/A",
        subDepartmentName: fullData.subDepartmentName,
        grievanceSummary: data.description,
        status: "RESOLVED",
        resolvedByName: fullData.resolvedByName || data.resolvedByName,
        remarks: data.remarks,
        language: data.language,
        media: media.length > 0 ? media : undefined,
        requireNotificationConsent: true,
      });
    } else {
      let message = await getNotificationWhatsAppMessage(
        data.companyId,
        data.type,
        "resolved",
        fullData,
      );
      if (message) {
        await safeSendWhatsApp(
          company,
          data.citizenWhatsApp || data.citizenPhone,
          message,
        );
      }

      if (data.evidenceUrls && data.evidenceUrls.length > 0) {
        await sendMediaIfAvailable(
          company,
          data.citizenWhatsApp || data.citizenPhone,
          data.evidenceUrls,
          "Resolution Support Documents",
        );
      }
    }
  } catch (error) {
    logger.error("❌ notifyCitizenOnResolution failed:", error);
  }
}

/* ------------------------------------------------------------------ */
/* Citizen Confirmation Notification                                   */
/* ------------------------------------------------------------------ */

export async function notifyCitizenOnCreation(
  data: NotificationData,
): Promise<void> {
  try {
    if (data.type === "grievance") {
      return;
    }
    const company = await getCompanyWithWhatsAppConfig(data.companyId);
    if (!company) return;

    const fullData = await populateNotificationData(data);

    // 📱 WhatsApp
    const actionKey = data.action || "confirmation";
    const phoneToNotify = data.citizenWhatsApp || data.citizenPhone;

    if (
      phoneToNotify &&
      canNotify(company, null, "whatsapp", `${data.type}_${actionKey}`)
    ) {
      // Fallback for appointments or other types (grievances are handled by early return)
      let message = await getNotificationWhatsAppMessage(
        data.companyId,
        data.type,
        actionKey,
        fullData,
      );
      if (message) {
        await safeSendWhatsApp(company, phoneToNotify, message);
      }
    }

    if (data.evidenceUrls && data.evidenceUrls.length > 0) {
      await sendMediaIfAvailable(
        company,
        data.citizenWhatsApp || data.citizenPhone,
        data.evidenceUrls,
        "Submission Evidence",
      );
    }
  } catch (error) {
    logger.error("❌ notifyCitizenOnCreation failed:", error);
  }
}

/* ------------------------------------------------------------------ */
/* Grievance status change notification (ASSIGNED, IN_PROGRESS, REJECTED, PENDING)  */
/* ------------------------------------------------------------------ */

export async function notifyCitizenOnGrievanceStatusChange(data: {
  companyId: any;
  grievanceId: string;
  citizenName: string;
  citizenPhone: string;
  citizenWhatsApp?: string;
  citizenEmail?: string;
  language?: string;
  description?: string;
  departmentId?: any;
  subDepartmentId?: any;
  departmentName?: string;
  subDepartmentName?: string;
  newStatus: string;
  remarks?: string;
  evidenceUrls?: string[];
  createdAt?: Date | string;
  timeline?: any[];
}): Promise<void> {
  try {
    const company = await getCompanyWithWhatsAppConfig(data.companyId);
    if (!company) return;

    // ✅ WhatsApp (Meta Template + Media via logical event key system)
    const media = (data.evidenceUrls || []).map((url) => {
      const ext = url.split(".").pop()?.toLowerCase() || "";
      const type: "image" | "video" | "document" = [
        "jpg",
        "jpeg",
        "png",
        "webp",
      ].includes(ext)
        ? "image"
        : ["mp4", "mov", "avi"].includes(ext)
          ? "video"
          : "document";
      return { url, type };
    });

    await triggerCitizenStatusTemplate({
      companyId: data.companyId,
      citizenPhone: data.citizenPhone,
      citizenName: data.citizenName,
      grievanceId: data.grievanceId,
      departmentName: data.departmentName || "N/A",
      subDepartmentName: data.subDepartmentName,
      grievanceSummary: data.description,
      status: data.newStatus,
      resolvedByName: data.remarks ? "Administrator" : undefined,
      remarks: data.remarks,
      language: data.language,
      media: media.length > 0 ? media : undefined,
      requireNotificationConsent: true,
    });
  } catch (error) {
    logger.error("❌ notifyCitizenOnGrievanceStatusChange failed:", error);
  }
}

/* ------------------------------------------------------------------ */
/* Hierarchy Notification                                              */
/* ------------------------------------------------------------------ */

export async function notifyHierarchyOnStatusChange(
  data: NotificationData,
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  try {
    const companyId = normalizeId(data.companyId);
    const company = await getCompanyWithWhatsAppConfig(companyId);
    if (!company) return;

    // All name lookups, date formatting, and resolution time done centrally
    const fullData = await populateNotificationData(data);

    // Find ALL relevant admins in the hierarchy
    const hierarchyDeptId =
      newStatus === "RESOLVED" && data.type === "grievance"
        ? data.departmentId
        : data.subDepartmentId || data.departmentId;
    const hierarchyAdmins =
      await getHierarchicalDepartmentAdmins(hierarchyDeptId);

    // Find Company Admins (top level)
    const companyAdmins = await User.find({
      companyId,
      $or: [
        { isSuperAdmin: true },
        {
          customRoleId: {
            $in: await (
              await import("../models/Role")
            ).default
              .find({
                companyId,
                key: {
                  $in: [
                    "COMPANY_ADMIN",
                    "ADMIN",
                    "COMPANY_HEAD",
                    "SUPER_ADMIN",
                  ],
                },
              })
              .distinct("_id"),
          },
        },
      ],
      isActive: true,
    }).populate("customRoleId");

    // Combine recipients (Hierarchy + Company Admins + optional explicit assignee)
    const potentialRecipients = [...hierarchyAdmins, ...companyAdmins];

    // For grievance resolution, only Company Admin + Department hierarchy should be notified.
    // Do not add explicit assignee here because it can be a sub-department assignee.
    const shouldIncludeDirectAssignee = !(
      data.type === "grievance" && newStatus === "RESOLVED"
    );
    if (shouldIncludeDirectAssignee && data.assignedTo) {
      const assignee = await User.findById(data.assignedTo).populate(
        "customRoleId",
      );
      if (assignee) potentialRecipients.push(assignee);
    }

    // Deduplicate recipients & EXCLUDE non-staff (citizens)
    const uniqueRecipients = new Map<string, any>();
    potentialRecipients.forEach((u) => {
      if (u && u._id) {
        // Only include if user is SuperAdmin OR has a custom role (staff)
        const isStaff = u.isSuperAdmin === true || u.customRoleId != null;
        if (isStaff) {
          uniqueRecipients.set(u._id.toString(), u);
        }
      }
    });

    const users = Array.from(uniqueRecipients.values());

    logger.info(
      `🔍 Found ${users.length} unique hierarchy recipients for ${data.type} status change to ${newStatus}`,
    );

    const statusAction = newStatus.toLowerCase();
    const statusControlKey =
      statusAction === "resolved" ||
      statusAction === "completed" ||
      statusAction === "cancelled"
        ? `${data.type}_resolved`
        : data.type === "appointment"
          ? "appointment_scheduled"
          : `${data.type}_assigned`;

    // Determine if we should use CTA button
    const dashboardUrl = "https://sahaj.pugarch.in/";
    const adminCta = { title: "Access Dashboard", url: dashboardUrl };

    // ✅ CONCURRENT NOTIFICATIONS
    // Filter out the citizen from hierarchy notifications, but DON'T drop admins with no phone.
    // Admins without a phone will still receive EMAIL notifications.
    const citizenPhoneNormalized =
      data.citizenWhatsApp?.replace(/\D/g, "") ||
      data.citizenPhone?.replace(/\D/g, "");

    // Determine direct assignee ID for specialized messaging
    const directAssigneeId = data.assignedTo?.toString
      ? data.assignedTo.toString()
      : data.assignedTo;

    // 🔔 In-App: Trigger for hierarchy (bell icon on portal)
    if (data.type === "grievance") {
      triggerInAppNotification({
        companyId,
        departmentId: data.subDepartmentId || data.departmentId,
        eventType:
          newStatus === "RESOLVED"
            ? "GRIEVANCE_STATUS_UPGRADED"
            : "GRIEVANCE_ASSIGNED",
        title: `Grievance ${newStatus}`,
        message: `Grievance ${data.grievanceId} status changed to ${newStatus}.`,
        grievanceId: data.grievanceId,
        grievanceObjectId: (data.grievance as any)?._id || data.grievance,
      }).catch((err) => logger.error("❌ In-App Notification failed:", err));
    }

    await Promise.allSettled(
      users.map(async (user) => {
        try {
          const userIdStr = user._id.toString();
          const isDirectAssignee = userIdStr === directAssigneeId;

          // Personalize data for each admin recipient
          const userFullData: Record<string, any> = {
            ...fullData,
            recipientName: getUserDisplayName(user),
          };

          // 📱 WhatsApp — Get message for this specific user
          let hierarchyMessage = null;
          let templateKey = "";

          if (newStatus === "ASSIGNED" && isDirectAssignee) {
            // Direct assignee gets the "Assigned to You" style message
            templateKey = "assigned_admin";

            // Try specialized role-based assignment keys first
            const userRole = user.customRoleId as any;
            const roleKey = userRole?.key || "";

            let specializedKey = "";
            if (
              roleKey === "COMPANY_ADMIN" ||
              roleKey === "ADMIN" ||
              user.isSuperAdmin
            ) {
              specializedKey = "grievance_reassigned_company_admin";
            } else if (roleKey === "DEPARTMENT_ADMIN") {
              specializedKey = "grievance_received_dept_admin";
            } else if (roleKey === "SUB_DEPARTMENT_ADMIN") {
              specializedKey = "grievance_reassigned_subdept_admin";
            }

            if (specializedKey) {
              hierarchyMessage = await getNotificationWhatsAppMessage(
                companyId,
                data.type,
                specializedKey as any,
                userFullData,
              );
            }

            if (!hierarchyMessage) {
              hierarchyMessage = await getNotificationWhatsAppMessage(
                companyId,
                data.type,
                "assigned_admin",
                userFullData,
              );
            }
          } else {
            // Others in the hierarchy (or non-assignment status changes) get a general status update
            // This avoids the "ASSIGNED TO YOU" confusion for non-assignees.
            const updateKey = `status_${statusAction}`;
            hierarchyMessage = await getNotificationWhatsAppMessage(
              companyId,
              data.type,
              updateKey as any,
              userFullData,
            );

            if (!hierarchyMessage) {
              // Fallback to general status_update
              hierarchyMessage = await getNotificationWhatsAppMessage(
                companyId,
                data.type,
                "status_update",
                userFullData,
              );
            }

            // Final fallbacks for resolved/common states
            if (
              !hierarchyMessage &&
              (newStatus === "RESOLVED" || newStatus === "COMPLETED")
            ) {
              hierarchyMessage = await getNotificationWhatsAppMessage(
                companyId,
                data.type,
                "resolved",
                userFullData,
              );
            }
          }

          if (!hierarchyMessage) {
            logger.error(
              `❌ Still no message found for hierarchy status update even with defaults.`,
            );
            return; // Skip this user
          }

          const tasks: Promise<any>[] = [];

          // 📱 WhatsApp — only if user has a phone
          const userPhoneNormalized = user.phone?.replace(/\D/g, "");

          if (!userPhoneNormalized || !user.phone) {
            logger.warn(
              `⚠️ Hierarchy admin ${user.email} (${getUserDisplayName(user)}) has NO phone number — skipping WhatsApp, will try email.`,
            );
          } else if (canNotify(company, user, "whatsapp", statusControlKey)) {
            // 📱 WhatsApp — only if user is a direct assignee or direct admin
            const userDeptId =
              user.departmentId?.toString() ||
              user.departmentIds?.[0]?.toString();
            const isDirectAdmin =
              userDeptId ===
              (data.subDepartmentId || data.departmentId)?.toString();

            if (isDirectAdmin || isDirectAssignee) {
              // Send Template (Text) for Admin hierarchy
              if (data.type === "grievance") {
                const context =
                  await NotificationContextService.buildGrievanceContext(
                    data.grievance || { grievanceId: data.grievanceId },
                    {
                      admin: user,
                      remarks: data.remarks,
                      language: getNotificationLanguage(data),
                    },
                  );
                const { templateName, values } =
                  await TemplateResolverService.resolveTemplate(
                    companyId,
                    "GRIEVANCE_STATUS_UPDATE",
                    context,
                  );
                tasks.push(
                  sendWhatsAppTemplate(
                    company,
                    user.phone,
                    templateName,
                    values,
                    getNotificationLanguage(data),
                    undefined,
                    undefined,
                    { recipientType: "ADMIN" },
                  ),
                );
              } else {
                tasks.push(
                  safeSendWhatsApp(
                    company,
                    user.phone as string,
                    hierarchyMessage,
                    adminCta,
                  ),
                );
              }

              // Send Evidence (Media) if available
              if (data.evidenceUrls && data.evidenceUrls.length > 0) {
                const mediaItems = data.evidenceUrls.map((url) => ({
                  url,
                  type: (url.match(/\.(jpg|jpeg|png|webp|heic)(\?|$)/i)
                    ? "image"
                    : url.match(/\.(mp4|mov|avi)(\?|$)/i)
                      ? "video"
                      : "document") as "image" | "video" | "document",
                }));
                tasks.push(
                  (async () => {
                    await new Promise((resolve) => setTimeout(resolve, 1000)); // Delay after text (updated to 1s)
                    await sendMediaSequentially(
                      company,
                      user.phone,
                      mediaItems,
                      getUserDisplayName(user),
                    );
                  })(),
                );
              }
            } else {
              logger.info(
                `🪜 [Hierarchy] Skipping WhatsApp for status update to ${user.email} (In-App only)`,
              );
            }
          }

          // 📧 Email — always attempt, regardless of phone availability
          const emailAddress = user.email;
          if (
            emailAddress &&
            canNotify(company, user, "email", statusControlKey)
          ) {
            const emailTask = (async () => {
              const emailPayload = {
                ...fullData,
                recipientName: getUserDisplayName(user),
                appointmentDate: (data as any).appointmentDate,
                appointmentTime: (data as any).appointmentTime,
                newStatus,
                oldStatus,
              };

              let email = await getNotificationEmailContent(
                companyId,
                data.type,
                statusAction as any,
                emailPayload,
                true,
              );
              if (
                !email &&
                (newStatus === "RESOLVED" || newStatus === "COMPLETED")
              ) {
                email = await getNotificationEmailContent(
                  companyId,
                  data.type,
                  "resolved",
                  emailPayload,
                  true,
                );
              }

              if (email) {
                const result = await sendEmail(
                  emailAddress,
                  email.subject,
                  email.html,
                  email.text,
                  { companyId },
                );
                if (result.success) {
                  logger.info(
                    `✅ Email sent to hierarchy user: ${emailAddress}`,
                  );
                }
              }
            })();
            tasks.push(emailTask);
          }

          await Promise.allSettled(tasks);
        } catch (err) {
          logger.error(`❌ Error notifying hierarchy user ${user.email}:`, err);
        }
      }),
    );
  } catch (error) {
    logger.error("❌ notifyHierarchyOnStatusChange failed:", error);
  }
}

/* ------------------------------------------------------------------ */
/* Appointment Status Change Notification                             */
/* ------------------------------------------------------------------ */

export async function notifyCitizenOnAppointmentStatusChange(data: {
  appointmentId: string;
  citizenName: string;
  citizenPhone: string;
  citizenWhatsApp?: string;
  citizenEmail?: string;
  companyId: any;
  oldStatus: string;
  newStatus: string;
  remarks?: string;
  appointmentDate: Date;
  appointmentTime: string;
  purpose?: string;
}): Promise<void> {
  try {
    const company = await getCompanyWithWhatsAppConfig(data.companyId);
    if (!company) return;

    // Use centralized data population (includes formattedDate for "Submitted On")
    const fullData = await populateNotificationData({
      ...data,
      type: "appointment",
      action: "confirmation",
    });

    // Check for custom template in DB: appointment_status_{status}
    const statusLower = data.newStatus.toLowerCase();
    const statusKey = `status_${statusLower}`;

    // Fallback order:
    // 1. appointment_status_confirmed (if status is confirmed)
    // 2. appointment_confirmed (standard key)
    // 3. appointment_confirmed_update (alternate match)
    // 4. appointment_status_update (catch-all)
    const attemptActions = [
      statusKey,
      statusLower,
      `${statusLower}_update`,
      "status_update",
    ];

    let message = null;
    for (const act of attemptActions) {
      message = await getNotificationWhatsAppMessage(
        data.companyId,
        "appointment",
        act,
        fullData,
      );
      if (message) break;
    }

    if (!message) {
      logger.error(
        `❌ Still no message found for appointment status update even with defaults.`,
      );
      return;
    }

    await safeSendWhatsApp(
      company,
      data.citizenWhatsApp || data.citizenPhone,
      message,
    );
  } catch (error) {
    logger.error("❌ notifyCitizenOnAppointmentStatusChange failed:", error);
  }
}
/**
 * Sequentially sends media to prevent WhatsApp rate limits or UI ordering issues
 */
async function sendMediaSequentially(
  company: any,
  to: string | undefined,
  media: Array<{ url: string; type: "image" | "video" | "document" }>,
  citizenName: string = "Citizen",
) {
  if (!to || !media || media.length === 0) return;

  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) return;

  for (const item of media) {
    try {
      // ðŸš€ Safety delay between media sends
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (item.type === "document") {
        await sendWhatsAppTemplate(
          company,
          normalizedTo,
          "media_document_v1",
          [citizenName.substring(0, 60)],
          getNotificationLanguage({} as any), // Fallback to default
          item.url, // headerParam
        );
      } else {
        const templateName =
          item.type === "video" ? "media_video_v1" : "media_image_v1";
        await sendWhatsAppTemplate(
          company,
          normalizedTo,
          templateName,
          [citizenName.substring(0, 60)],
          getNotificationLanguage({} as any),
          item.url,
        );
      }
    } catch (err) {
      logger.error(`âŒ Error in sendMediaSequentially for ${item.url}:`, err);
    }
  }
}
