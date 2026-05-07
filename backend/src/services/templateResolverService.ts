import CompanyWhatsAppConfig from '../models/CompanyWhatsAppConfig';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import { NotificationContextService, INotificationContext } from './notificationContextService';
import { logger } from '../config/logger';
import { META_GRIEVANCE_TEMPLATE_VARIABLE_COUNT } from '../constants/metaGrievanceTemplates';

/**
 * Service to resolve dynamic template names and variable values.
 * Speed: Uses database projections and caching-friendly patterns.
 */
export class TemplateResolverService {
  
  private static LEGACY_FALLBACKS: Record<string, string> = {
    'GRIEVANCE_CREATED': 'grievance_received_admin_v2',
    'GRIEVANCE_ASSIGNED': 'grievance_assigned_admin_v2',
    'GRIEVANCE_REASSIGNED': 'grievance_reassigned_admin_v2',
    'GRIEVANCE_REVERTED': 'grievance_reverted_company_v2',
    'GRIEVANCE_REMINDER': 'grievance_reminder_admin_v2',
    'GRIEVANCE_STATUS_RESOLVED': 'grievance_status_resolved_citizen_v2',
    'GRIEVANCE_STATUS_REJECTED': 'grievance_status_rejected_citizen_v2',
    'GRIEVANCE_STATUS_IN_PROGRESS': 'grievance_status_inprogress_citizen_v2',
    'GRIEVANCE_STATUS_PENDING': 'grievance_status_inprogress_citizen_v2',
    'GRIEVANCE_STATUS_ASSIGNED': 'grievance_status_inprogress_citizen_v2',
    'GRIEVANCE_STATUS_UPDATE': 'grievance_assigned_admin_v2'
  };

  private static LEGACY_VARIABLE_MAPS: Record<string, string[]> = {
    'grievance_received_admin_v2': ['admin_name', 'id', 'citizen_name', 'department', 'office', 'description', 'created_at'],
    'grievance_assigned_admin_v2': ['admin_name', 'id', 'citizen_name', 'department', 'office', 'description', 'assigned_by', 'current_date', 'remarks'],
    'grievance_reassigned_admin_v2': ['admin_name', 'id', 'citizen_name', 'original_department', 'original_office', 'description', 'created_at', 'reassigned_by', 'remarks', 'current_date', 'department', 'office'],
    'grievance_reverted_company_v2': ['admin_name', 'id', 'citizen_name', 'original_department', 'original_office', 'description', 'reverted_by', 'remarks', 'current_date'],
    'grievance_status_resolved_citizen_v2': ['citizen_name', 'id', 'department', 'office', 'description', 'admin_name', 'current_date', 'remarks'],
    'grievance_status_rejected_citizen_v2': ['citizen_name', 'id', 'department', 'office', 'description', 'admin_name', 'current_date', 'remarks'],
    'grievance_status_inprogress_citizen_v2': ['citizen_name', 'id', 'department', 'office', 'description', 'admin_name', 'current_date', 'remarks'],
    'grievance_reminder_admin_v2': ['admin_name', 'id', 'citizen_name', 'department', 'office', 'description', 'remarks', 'created_at'],
    'number_admin_v1_': ['id']
  };

  /**
   * Resolves the actual Meta template name and the ordered array of variable values.
   */
  static async resolveTemplate(
    companyId: any,
    eventKey: string,
    context: INotificationContext,
    fallbackTemplateName?: string
  ): Promise<{ templateName: string; values: string[] }> {
    try {
      const idToUse = (companyId && typeof companyId === 'object' && (companyId as any)._id)
        ? (companyId as any)._id.toString()
        : companyId.toString();

      const upperKey = eventKey.toUpperCase();
      // 1. Fetch Company Config Mappings (Project only what we need for speed)
      const config = await CompanyWhatsAppConfig.findOne(
        { companyId: idToUse },
        { templateMappings: 1 }
      ).lean();

      // 2. Determine Template Name
      let templateName = config?.templateMappings?.[upperKey];
      
      if (!templateName) {
        // Use legacy fallback if mapping is missing
        templateName = this.LEGACY_FALLBACKS[upperKey] || fallbackTemplateName;
      }

      if (!templateName) {
        throw new Error(`No template mapping or fallback found for event: ${eventKey}`);
      }

      // 3. Fetch Template Metadata (variableMap)
      const template = await WhatsAppTemplate.findOne(
        { companyId, name: templateName },
        { 'body.variableMap': 1, 'body.variables': 1 }
      ).lean();

      if (!template) {
        logger.warn(`Template metadata not found for ${templateName}. Checking legacy variable maps.`);
        const legacyMap = this.LEGACY_VARIABLE_MAPS[templateName];
        if (legacyMap) {
          return { templateName, values: legacyMap.map(key => String(context[key] || '')) };
        }
        // Last resort
        return { templateName, values: Object.values(context).slice(0, 10).map(String) };
      }

      // 4. Assemble Values array based on the Map
      let variableMap = template.body?.variableMap || [];
      
      if (variableMap.length === 0) {
        variableMap = this.LEGACY_VARIABLE_MAPS[templateName] || [];
      }

      const values = variableMap.map(key => {
        const value = context[key];
        return (value !== undefined && value !== null && value !== '') ? String(value) : ' ';
      });

      // ✅ VALIDATION: Check if variable count matches Meta's requirements
      const expectedCount = META_GRIEVANCE_TEMPLATE_VARIABLE_COUNT[templateName];
      if (expectedCount !== undefined && values.length !== expectedCount) {
        logger.warn(`⚠️ [TemplateResolver] VARIABLE COUNT MISMATCH for "${templateName}": Expected ${expectedCount}, but mapped ${values.length}. This message will likely be REJECTED by Meta.`);
        console.warn(`\x1b[33m%s\x1b[0m`, `⚠️ [TemplateResolver] VARIABLE COUNT MISMATCH for "${templateName}": Expected ${expectedCount}, but mapped ${values.length}.`);
      } else {
        logger.info(`✅ [TemplateResolver] Resolved "${templateName}" with ${values.length} variables for event: ${eventKey}`);
      }

      return { templateName, values };

    } catch (error: any) {
      logger.error(`Template Resolution Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * High-Performance shortcut for when you already know the template and map.
   */
  static async resolveValuesFromMap(
    variableMap: string[],
    context: INotificationContext
  ): Promise<string[]> {
    return variableMap.map(key => String(context[key] || ''));
  }
}
