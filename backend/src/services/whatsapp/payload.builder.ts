import { sanitizeText, sanitizeNote, sanitizeDateTimeText } from '../../utils/sanitize';
import {
  GRIEVANCE_DESCRIPTION_CONTINUATION_TEXT,
  prepareSummaryText,
  truncateText
} from '../../utils/truncateText';
import { TemplateAudience } from './template.service';

type TemplateInputData = Record<string, string | number | null | undefined>;

type ParameterSpec = {
  key: string;
  aliases: string[];
  maxLength?: number;
  mode?: 'summary';
};

type TemplateDefinition = {
  audience: TemplateAudience;
  body: ParameterSpec[];
  header?: { type: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'TEXT' };
};

export interface BuiltTemplatePayload {
  audience: TemplateAudience;
  components: any[];
  expectedKeys: string[];
  consumedKeys: string[];
}

export const TEMPLATE_DEFINITIONS: Record<string, TemplateDefinition> = {
  grievance_received_admin_v2: {
    audience: 'ADMIN',
    body: [
      { key: 'admin_name', aliases: ['admin_name', 'adminName', 'recipient_name', 'recipientName', 'recepientName', 'recipient'], maxLength: 60 },
      { key: 'grievance_id', aliases: ['grievance_id', 'grievanceId', 'reference_id'], maxLength: 30 },
      { key: 'citizen_name', aliases: ['citizen_name', 'citizenName'], maxLength: 60 },
      { key: 'department_name', aliases: ['department_name', 'departmentName', 'category'], maxLength: 60 },
      { key: 'office_name', aliases: ['office_name', 'officeName', 'sub_department_name', 'subDepartmentName'], maxLength: 60 },
      { key: 'description', aliases: ['description', 'grievance_details', 'grievanceDetails'], maxLength: 400, mode: 'summary' },
      { key: 'received_on', aliases: ['received_on', 'receivedOn', 'submitted_on', 'submittedOn', 'formattedDate', 'formatted_date', 'date'], maxLength: 60 }
    ]
  },
  grievance_assigned_admin_v2: {
    audience: 'ADMIN',
    body: [
      { key: 'admin_name', aliases: ['admin_name', 'adminName', 'recipient_name', 'recipientName', 'recepientName', 'recipient'], maxLength: 60 },
      { key: 'grievance_id', aliases: ['grievance_id', 'grievanceId', 'reference_id'], maxLength: 30 },
      { key: 'citizen_name', aliases: ['citizen_name', 'citizenName'], maxLength: 60 },
      { key: 'department_name', aliases: ['department_name', 'departmentName', 'category'], maxLength: 60 },
      { key: 'office_name', aliases: ['office_name', 'officeName', 'sub_department_name', 'subDepartmentName'], maxLength: 60 },
      { key: 'description', aliases: ['description', 'grievance_details', 'grievanceDetails'], maxLength: 400, mode: 'summary' },
      { key: 'assigned_by', aliases: ['assigned_by', 'assignedBy', 'assignedByName', 'reassigned_by', 'reassignedBy', 'reassignedByName'], maxLength: 60 },
      { key: 'assigned_on', aliases: ['assigned_on', 'assignedOn', 'assignedDate', 'formattedDate', 'formatted_date', 'date'], maxLength: 60 },
      { key: 'remarks', aliases: ['remarks', 'note', 'assignment_note', 'assignmentNote', 'reassignment_note', 'reassignmentNote', 'revert_note'], maxLength: 100 }
    ]
  },
  grievance_reassigned_admin_v2: {
    audience: 'ADMIN',
    body: [
      { key: 'admin_name', aliases: ['admin_name', 'adminName', 'recipient_name', 'recipientName', 'recepientName', 'recipient'], maxLength: 60 },
      { key: 'grievance_id', aliases: ['grievance_id', 'grievanceId', 'reference_id'], maxLength: 30 },
      { key: 'citizen_name', aliases: ['citizen_name', 'citizenName'], maxLength: 60 },
      { key: 'department_name', aliases: ['department_name', 'departmentName', 'category'], maxLength: 60 },
      { key: 'office_name', aliases: ['office_name', 'officeName', 'sub_department_name', 'subDepartmentName'], maxLength: 60 },
      { key: 'description', aliases: ['description', 'grievance_details', 'grievanceDetails'], maxLength: 400, mode: 'summary' },
      { key: 'submitted_on', aliases: ['submitted_on', 'submittedOn', 'submittedDate', 'created_on', 'createdOn', 'created_at', 'createdAt'], maxLength: 60 },
      { key: 'reassigned_by', aliases: ['reassigned_by', 'reassignedBy', 'reassignedByName', 'assigned_by', 'assignedBy', 'assignedByName'], maxLength: 60 },
      { key: 'remarks', aliases: ['remarks', 'note', 'assignment_note', 'reassignment_note', 'reassignmentNote', 'revert_note'], maxLength: 100 },
      { key: 'reassigned_on', aliases: ['reassigned_on', 'reassignedOn', 'reassignedDate'], maxLength: 60 },
      { key: 'original_department', aliases: ['original_department', 'originalDepartment'], maxLength: 60 },
      { key: 'original_office', aliases: ['original_office', 'originalOffice'], maxLength: 60 }
    ]
  },
  grievance_reverted_company_v2: {
    audience: 'ADMIN',
    body: [
      { key: 'admin_name', aliases: ['admin_name', 'adminName', 'recipient_name', 'recipientName', 'recepientName', 'recipient'], maxLength: 60 },
      { key: 'grievance_id', aliases: ['grievance_id', 'grievanceId', 'reference_id'], maxLength: 30 },
      { key: 'citizen_name', aliases: ['citizen_name', 'citizenName'], maxLength: 60 },
      { key: 'department_name', aliases: ['department_name', 'departmentName', 'category'], maxLength: 60 },
      { key: 'office_name', aliases: ['office_name', 'officeName', 'sub_department_name', 'subDepartmentName'], maxLength: 60 },
      { key: 'description', aliases: ['description', 'grievance_details', 'grievanceDetails'], maxLength: 400, mode: 'summary' },
      { key: 'reverted_by', aliases: ['reverted_by', 'revertedBy', 'revertedByName'], maxLength: 60 },
      { key: 'reverted_on', aliases: ['reverted_on', 'revertedOn', 'revertedDate', 'formattedDate', 'formatted_date', 'date'], maxLength: 60 },
      { key: 'remarks', aliases: ['remarks', 'note', 'revert_reason', 'revert_note'], maxLength: 100 }
    ]
  },
  number_admin_v1_: {
    audience: 'ADMIN',
    body: [
      { key: 'otp', aliases: ['otp', 'code', 'verification_code', 'verificationCode'], maxLength: 20 }
    ]
  },
  grievance_reminder_admin_v2: {
    audience: 'ADMIN',
    body: [
      { key: 'admin_name', aliases: ['admin_name', 'adminName', 'recipient_name', 'recipientName', 'recepientName', 'recipient'], maxLength: 60 },
      { key: 'grievance_id', aliases: ['grievance_id', 'grievanceId', 'reference_id'], maxLength: 30 },
      { key: 'citizen_name', aliases: ['citizen_name', 'citizenName'], maxLength: 60 },
      { key: 'department_name', aliases: ['department_name', 'departmentName', 'category'], maxLength: 60 },
      { key: 'office_name', aliases: ['office_name', 'officeName', 'sub_department_name', 'subDepartmentName'], maxLength: 60 },
      { key: 'description', aliases: ['description', 'grievance_details', 'grievanceDetails'], maxLength: 400, mode: 'summary' },
      { key: 'reminder_remarks', aliases: ['reminder_remarks', 'remarks', 'note', 'remarks_by_collector'], maxLength: 100 },
      { key: 'submitted_on', aliases: ['submitted_on', 'submittedOn', 'submittedDate', 'submitted_date', 'received_on', 'receivedOn', 'formattedDate', 'formatted_date', 'date'], maxLength: 60 }
    ]
  },
  grievance_status_resolved_citizen_v2: {
    audience: 'CITIZEN',
    body: [
      { key: 'citizen_name', aliases: ['citizen_name', 'citizenName'], maxLength: 60 },
      { key: 'grievance_id', aliases: ['grievance_id', 'grievanceId', 'reference_id'], maxLength: 30 },
      { key: 'department_name', aliases: ['department_name', 'departmentName'], maxLength: 60 },
      { key: 'sub_department_name', aliases: ['sub_department_name', 'subDepartmentName'], maxLength: 60 },
      { key: 'grievance_summary', aliases: ['grievance_summary', 'grievanceSummary', 'description', 'grievance_details', 'grievanceDetails'], maxLength: 200, mode: 'summary' },
      { key: 'action_by', aliases: ['action_by', 'resolved_by', 'resolvedByName', 'admin_name'], maxLength: 60 },
      { key: 'action_on', aliases: ['action_on', 'resolved_on', 'formattedResolvedDate', 'date'], maxLength: 60 },
      { key: 'remarks', aliases: ['remarks', 'note', 'dynamic_message', 'message'], maxLength: 500 }
    ]
  },
  grievance_status_rejected_citizen_v2: {
    audience: 'CITIZEN',
    body: [
      { key: 'citizen_name', aliases: ['citizen_name', 'citizenName'], maxLength: 60 },
      { key: 'grievance_id', aliases: ['grievance_id', 'grievanceId', 'reference_id'], maxLength: 30 },
      { key: 'department_name', aliases: ['department_name', 'departmentName'], maxLength: 60 },
      { key: 'sub_department_name', aliases: ['sub_department_name', 'subDepartmentName'], maxLength: 60 },
      { key: 'grievance_summary', aliases: ['grievance_summary', 'grievanceSummary', 'description', 'grievance_details', 'grievanceDetails'], maxLength: 200, mode: 'summary' },
      { key: 'action_by', aliases: ['action_by', 'rejected_by', 'rejectedByName', 'admin_name'], maxLength: 60 },
      { key: 'action_on', aliases: ['action_on', 'rejected_on', 'formattedResolvedDate', 'date'], maxLength: 60 },
      { key: 'remarks', aliases: ['remarks', 'note', 'dynamic_message', 'message'], maxLength: 500 }
    ]
  },
  grievance_status_inprogress_citizen_v2: {
    audience: 'CITIZEN',
    body: [
      { key: 'citizen_name', aliases: ['citizen_name', 'citizenName'], maxLength: 60 },
      { key: 'grievance_id', aliases: ['grievance_id', 'grievanceId', 'reference_id'], maxLength: 30 },
      { key: 'department_name', aliases: ['department_name', 'departmentName'], maxLength: 60 },
      { key: 'sub_department_name', aliases: ['sub_department_name', 'subDepartmentName'], maxLength: 60 },
      { key: 'grievance_summary', aliases: ['grievance_summary', 'grievanceSummary', 'description', 'grievance_details', 'grievanceDetails'], maxLength: 200, mode: 'summary' },
      { key: 'action_by', aliases: ['action_by', 'inprogress_by', 'inprogressByName', 'admin_name'], maxLength: 60 },
      { key: 'action_on', aliases: ['action_on', 'inprogress_on', 'formattedResolvedDate', 'date', 'action_on'], maxLength: 60 },
      { key: 'remarks', aliases: ['remarks', 'note', 'dynamic_message', 'message'], maxLength: 500 }
    ]
  },
  media_image_v1: {
    audience: 'CITIZEN',
    header: { type: 'IMAGE' },
    body: [
      { key: 'recipient_name', aliases: ['recipient_name', 'admin_name', 'citizen_name', 'adminName', 'citizenName'], maxLength: 60 }
    ]
  },
  media_video_v1: {
    audience: 'CITIZEN',
    header: { type: 'VIDEO' },
    body: [
      { key: 'recipient_name', aliases: ['recipient_name', 'admin_name', 'citizen_name', 'adminName', 'citizenName'], maxLength: 60 }
    ]
  },
  media_document_v1: {
    audience: 'CITIZEN',
    header: { type: 'DOCUMENT' },
    body: [
      { key: 'recipient_name', aliases: ['recipient_name', 'admin_name', 'citizen_name', 'adminName', 'citizenName'], maxLength: 60 }
    ]
  }
};

const BODY_TOTAL_LIMIT = 1024;
const SUMMARY_CONTINUATION_SUFFIX = ` ${GRIEVANCE_DESCRIPTION_CONTINUATION_TEXT}`;

function normalizeTemplateParamText(value: string): string {
  return String(value || '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function removeSummaryContinuationSuffix(value: string): string {
  if (!value.endsWith(SUMMARY_CONTINUATION_SUFFIX)) return value;
  return value.slice(0, -SUMMARY_CONTINUATION_SUFFIX.length).trimEnd();
}

function resolveValue(data: TemplateInputData, spec: ParameterSpec, audience: TemplateAudience): { value: string; alias: string } {
  for (const alias of spec.aliases) {
    const current = data[alias];
    if (current === undefined || current === null) continue;

    const rawValue = String(current);
    const lowerKey = spec.key.toLowerCase();
    const sanitized = lowerKey === 'dynamic_message'
      ? sanitizeNote(rawValue)
      : (lowerKey.endsWith('_on') || lowerKey.includes('date')
        ? sanitizeDateTimeText(rawValue, 2000)
        : sanitizeText(rawValue, 2000));
    if (!sanitized.trim()) continue;

    let normalized = sanitized;
    if (spec.mode === 'summary') {
      normalized = prepareSummaryText(
        sanitized,
        Math.min(spec.maxLength || 400, 400),
        audience === 'ADMIN' ? GRIEVANCE_DESCRIPTION_CONTINUATION_TEXT : '...'
      );
    } else {
      normalized = truncateText(sanitized, spec.maxLength || 100);
    }

    normalized = normalizeTemplateParamText(normalized);

    if (normalized.trim()) {
      return { value: normalized, alias };
    }
  }

  // ⚠️ FALLBACK LOGIC: If a required parameter is missing, use a safe default 
  // instead of throwing to prevent complete notification failure.
  const defaultValue = spec.key.includes('url') ? 'https://sahaj.pugarch.in/' : 'N/A';
  console.warn(`[TemplatePayloadBuilder] ⚠️ Missing parameter: ${spec.key}. Using fallback: ${defaultValue}`);
  
  return { value: defaultValue, alias: spec.key };
}

function enforceBodyCharacterLimit(
  entries: Array<{ spec: ParameterSpec; value: string }>,
  audience: TemplateAudience
): Array<{ spec: ParameterSpec; value: string }> {
  let totalLength = entries.reduce((sum, entry) => sum + entry.value.length, 0);
  if (totalLength <= BODY_TOTAL_LIMIT) return entries;

  let overflow = totalLength - BODY_TOTAL_LIMIT;

  const shrink = (index: number, minLength: number) => {
    if (overflow <= 0) return;
    const currentValue = entries[index].value;
    if (currentValue.length <= minLength) return;

    const reducible = currentValue.length - minLength;
    const reduceBy = Math.min(reducible, overflow);
    const targetLength = currentValue.length - reduceBy;
    if (entries[index].spec.mode === 'summary') {
      const baseSummary = removeSummaryContinuationSuffix(currentValue);
      entries[index].value = prepareSummaryText(
        baseSummary,
        targetLength,
        audience === 'ADMIN' ? GRIEVANCE_DESCRIPTION_CONTINUATION_TEXT : '...'
      );
    } else {
      entries[index].value = truncateText(currentValue, targetLength);
    }
    overflow -= reduceBy;
  };

  entries.forEach((entry, index) => {
    if (entry.spec.mode === 'summary') {
      shrink(index, 80);
    }
  });

  entries.forEach((entry, index) => {
    if (entry.spec.mode === 'summary') {
      shrink(index, SUMMARY_CONTINUATION_SUFFIX.length + 20);
      return;
    }
    shrink(index, 20);
  });

  totalLength = entries.reduce((sum, entry) => sum + entry.value.length, 0);
  if (totalLength > BODY_TOTAL_LIMIT) {
    const finalOverflow = totalLength - BODY_TOTAL_LIMIT;
    const lastIndex = entries.length - 1;
    const lastEntry = entries[lastIndex];
    const targetLength = Math.max(1, lastEntry.value.length - finalOverflow);
    if (lastEntry.spec.mode === 'summary') {
      const baseSummary = removeSummaryContinuationSuffix(lastEntry.value);
      entries[lastIndex].value = prepareSummaryText(
        baseSummary,
        targetLength,
        audience === 'ADMIN' ? GRIEVANCE_DESCRIPTION_CONTINUATION_TEXT : '...'
      );
    } else {
      entries[lastIndex].value = truncateText(lastEntry.value, targetLength);
    }
  }

  return entries;
}

export function buildTemplatePayload(templateName: string, data: TemplateInputData): BuiltTemplatePayload {
  const definition = TEMPLATE_DEFINITIONS[templateName];
  if (!definition) {
    const error: any = new Error(`Template ${templateName} is not supported by the payload builder.`);
    error.code = 'TEMPLATE_INVALID';
    throw error;
  }

  const consumedKeys = new Set<string>();
  const bodyEntries = definition.body.map((spec) => {
    const { value, alias } = resolveValue(data, spec, definition.audience);
    consumedKeys.add(alias);
    return { spec, value };
  });
  const limitedBodyEntries = enforceBodyCharacterLimit(bodyEntries, definition.audience);
  const bodyParameters = limitedBodyEntries.map((entry) => ({
    type: 'text',
    text: normalizeTemplateParamText(entry.value)
  }));

  const components: any[] = [];
  const headerValue = data.header_url ?? data.headerUrl ?? data.header_text ?? data.headerText;
  if (headerValue && definition.header) {
    const hType = definition.header.type.toLowerCase();
    components.push({
      type: 'header',
      parameters: [{ 
        type: hType, 
        [hType]: definition.header.type === 'TEXT' 
          ? normalizeTemplateParamText(sanitizeText(String(headerValue), 60))
          : { link: String(headerValue) }
      }]
    });
  } else if (!definition.header && (data.header_text || data.headerText)) {
    // Backward compatibility for templates that implicitly support text headers
    const textValue = data.header_text ?? data.headerText;
    components.push({
      type: 'header',
      parameters: [{ type: 'text', text: normalizeTemplateParamText(sanitizeText(String(textValue), 60)) }]
    });
  }

  components.push({
    type: 'body',
    parameters: bodyParameters
  });

  const buttonValue = data.button_url ?? data.buttonUrl;
  if (buttonValue) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: normalizeTemplateParamText(sanitizeText(String(buttonValue), 255)) }]
    });
  }

  return {
    audience: definition.audience,
    components,
    expectedKeys: definition.body.map((spec) => spec.key),
    consumedKeys: Array.from(consumedKeys)
  };
}
