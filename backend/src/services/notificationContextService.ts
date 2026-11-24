import { IGrievance } from '../models/Grievance';
import { IUser } from '../models/User';
import { IDepartment } from '../models/Department';
import moment from 'moment-timezone';

/**
 * Standard data dictionary for PugArch Connect Portal.
 * These keys are stable and can be used in any template variableMap.
 */
export interface INotificationContext {
  id: string;
  citizen_name: string;
  citizen_phone: string;
  status: string;
  department: string;
  office: string;
  description: string;
  created_at: string;
  admin_name: string;
  remarks: string;
  company_name: string;
  current_date: string;
  previous_dept?: string;
  previous_office?: string;
  new_dept?: string;
  new_office?: string;
  [key: string]: any;
}

/**
 * Service to build a flat, stable data dictionary from complex models.
 */
export class NotificationContextService {
  private static DEFAULT_PORTAL_NAME = 'PugArch Connect Portal';

  /**
   * Builds a context object for Grievance-related events.
   */
  static async buildGrievanceContext(
    grievance: any, 
    options: {
      admin?: any;
      department?: any;
      subDept?: any;
      remarks?: string;
      companyName?: string;
      language?: string;
      previousDept?: string;
      previousOffice?: string;
      newDept?: string;
      newOffice?: string;
      submittedOn?: Date | string;
      reassignedOn?: Date | string;
    } = {}
  ): Promise<INotificationContext> {
    const lang = options.language || 'en';
    const timezone = 'Asia/Kolkata';

    const formatDate = (date?: Date | string) => {
      if (!date) return null;
      return moment(date).tz(timezone).format('DD MMM YYYY, hh:mm A');
    };

    const createdAt = formatDate(options.submittedOn) || 
                      formatDate(grievance.createdAt) || 
                      formatDate(grievance.timeline?.[0]?.timestamp) || 
                      formatDate(grievance.statusHistory?.[0]?.changedAt) || 
                      moment().tz(timezone).format('DD MMM YYYY, hh:mm A');

    const reassignedOn = formatDate(options.reassignedOn) || moment().tz(timezone).format('DD MMM YYYY, hh:mm A');

    return {
      id: this.cleanWhitespace(grievance.grievanceId || 'N/A'),
      citizen_name: this.cleanWhitespace(grievance.citizenName || 'Citizen'),
      citizen_phone: this.cleanWhitespace(grievance.citizenPhone || 'N/A'),
      status: this.formatStatus(grievance.status, lang),
      department: (() => {
        if (options.department?.name) return this.cleanWhitespace(options.department.name);
        if (typeof options.department === 'string' && options.department !== '') return this.cleanWhitespace(options.department);
        
        // Hierarchical logic: if departmentId has a parent, the parent is the true Department
        const deptObj = grievance.departmentId as any;
        if (deptObj?.parentDepartmentId?.name) return this.cleanWhitespace(deptObj.parentDepartmentId.name);
        
        return this.cleanWhitespace(deptObj?.name || grievance.category || 'N/A');
      })(),
      office: (() => {
        if (options.subDept?.name) return this.cleanWhitespace(options.subDept.name);
        if (typeof options.subDept === 'string' && options.subDept !== '') return this.cleanWhitespace(options.subDept);
        
        if ((grievance.subDepartmentId as any)?.name) return this.cleanWhitespace((grievance.subDepartmentId as any).name);
        
        // If departmentId itself has a parent, then departmentId is actually the Office
        const deptObj = grievance.departmentId as any;
        if (deptObj?.parentDepartmentId) return this.cleanWhitespace(deptObj.name);
        
        return 'N/A';
      })(),
      description: this.sanitizeText(grievance.description || 'N/A', 400),
      created_at: createdAt,
      submitted_on: createdAt,
      reassigned_on: reassignedOn,
      admin_name: (() => {
        const name = options.admin?.fullName || (options.admin?.firstName ? `${options.admin.firstName}${options.admin.lastName ? ' ' + options.admin.lastName : ''}`.trim() : 'Officer');
        const designation = options.admin?.designation || (options.admin?.designations && options.admin.designations.length > 0 ? options.admin.designations[0] : null);
        return this.cleanWhitespace(designation ? `${name} (${designation})` : name);
      })(),
      remarks: this.sanitizeText(options.remarks || grievance.remarks || 'N/A', 1000),
      company_name: options.companyName || this.DEFAULT_PORTAL_NAME,
      current_date: moment().tz(timezone).format('DD MMM YYYY, hh:mm A'),
      previous_dept: options.previousDept || 'N/A',
      previous_office: options.previousOffice || 'N/A',
      new_dept: options.newDept || 'N/A',
      new_office: options.newOffice || 'N/A',
      assigned_by: this.cleanWhitespace(options.admin?.fullName || (options.admin?.firstName ? `${options.admin.firstName}${options.admin.lastName ? ' ' + options.admin.lastName : ''}` : 'Officer')),
      reassigned_by: this.cleanWhitespace(options.admin?.fullName || (options.admin?.firstName ? `${options.admin.firstName}${options.admin.lastName ? ' ' + options.admin.lastName : ''}` : 'Officer')),
      reverted_by: this.cleanWhitespace(options.admin?.fullName || (options.admin?.firstName ? `${options.admin.firstName}${options.admin.lastName ? ' ' + options.admin.lastName : ''}` : 'Officer')),
      original_department: options.previousDept || 'N/A',
      original_office: options.previousOffice || 'N/A'
    };
  }

  /**
   * Helper to format technical status into human-readable labels.
   */
  private static formatStatus(status: string, lang: string): string {
    const statusMap: Record<string, Record<string, string>> = {
      PENDING: { en: 'Pending', hi: 'लंबित' },
      IN_PROGRESS: { en: 'In Progress', hi: 'प्रगति पर है' },
      RESOLVED: { en: 'Resolved', hi: 'समाधान हो गया' },
      REJECTED: { en: 'Rejected', hi: 'अस्वीकार कर दिया' },
      REVERTED: { en: 'Reverted', hi: 'वापस भेज दिया' },
      ASSIGNED: { en: 'Assigned', hi: 'सौंपा गया' }
    };

    return statusMap[status]?.[lang] || statusMap[status]?.['en'] || status;
  }

  /**
   * Sanitizes text for WhatsApp (removes dangerous chars, collapses consecutive spaces, limits length).
   */
  private static sanitizeText(text: string, maxLength: number): string {
    if (!text) return '';
    // Replace pipe chars as they break some template parsing, replace newlines/tabs, and collapse multiple spaces
    const cleaned = text
      .replace(/\|/g, '-')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length > maxLength ? cleaned.substring(0, maxLength - 3) + '...' : cleaned;
  }

  private static cleanWhitespace(text: string): string {
    if (!text) return '';
    return String(text)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
