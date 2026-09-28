import { apiClient } from './client';

export interface Grievance {
  _id: string;
  grievanceId: string;
  companyId: string | { _id: string; name: string };
  departmentId?: string | { _id: string; name: string };
  subDepartmentId?: string | { _id: string; name: string };
  citizenName: string;
  citizenPhone: string;
  citizenWhatsApp?: string;
  citizenEmail?: string;
  description: string;
  category?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: string;
  statusHistory?: Array<{
    status: string;
    changedBy?: string | { _id: string; firstName: string; lastName: string };
    changedAt: string;
    remarks?: string;
  }>;
  assignedTo?: string | { _id: string; firstName: string; lastName: string };
  assignedAt?: string;
  location?: {
    type: 'Point';
    coordinates: [number, number];
    address?: string;
  };
  media?: Array<{
    url: string;
    type: 'image' | 'document' | 'video';
    uploadedAt: string;
    uploadedBy?: string | { _id: string; firstName: string; lastName: string; role: string };
    isGCS?: boolean;
  }>;
  resolution?: string;
  resolvedAt?: string;
  closedAt?: string;
  slaBreached?: boolean;
  slaDueDate?: string;
  slaHours?: number;
  reminderCount?: number;
  lastReminderAt?: string;
  lastReminderRemarks?: string;
  language?: 'en' | 'hi' | 'mr';
  forest_range?: string;
  forest_beat?: string;
  forest_compartment?: string;
  createdAt: string;
  updatedAt: string;
  timeline?: Array<{
    action: string;
    details?: any;
    performedBy?: string | { _id: string; firstName: string; lastName: string; role: string };
    timestamp: string;
  }>;
}

export interface CreateGrievanceData {
  companyId: string;
  departmentId?: string;
  citizenName: string;
  citizenPhone: string;
  citizenWhatsApp?: string;
  description: string;
  category?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  location?: {
    coordinates: [number, number];
    address?: string;
  };
}

export interface RevertGrievanceData {
  remarks: string;
  suggestedDepartmentId?: string;
  suggestedSubDepartmentId?: string;
  suggestedAssigneeId?: string;
}

export interface GrievancesResponse {
  success: boolean;
  data: {
    grievances: Grievance[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  };
}

export const grievanceAPI = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    companyId?: string;
    departmentId?: string;
    assignedTo?: string;
    priority?: string;
    search?: string;
    slaStatus?: string;
    mainDeptId?: string;
    subDeptId?: string;
  }): Promise<GrievancesResponse> => {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.status) queryParams.append('status', params.status);
    if (params?.companyId) queryParams.append('companyId', params.companyId);
    if (params?.departmentId) queryParams.append('departmentId', params.departmentId);
    if (params?.mainDeptId) queryParams.append('mainDeptId', params.mainDeptId);
    if (params?.subDeptId) queryParams.append('subDeptId', params.subDeptId);
    if (params?.assignedTo) queryParams.append('assignedTo', params.assignedTo);
    if (params?.priority) queryParams.append('priority', params.priority);
    if (params?.search) queryParams.append('search', params.search);
    if (params?.slaStatus) queryParams.append('slaStatus', params.slaStatus);
    
    return apiClient.get(`/grievances?${queryParams.toString()}`);
  },

  getById: async (id: string): Promise<{ success: boolean; data: { grievance: Grievance } }> => {
    return apiClient.get(`/grievances/${id}`);
  },

  create: async (data: CreateGrievanceData): Promise<{ success: boolean; data: { grievance: Grievance } }> => {
    return apiClient.post('/grievances', data);
  },

  updateStatus: async (id: string, status: string, remarks?: string): Promise<{ success: boolean; data: { grievance: Grievance } }> => {
    return apiClient.put(`/grievances/${id}/status`, { status, remarks });
  },

  assign: async (
    id: string,
    assignedTo: string,
    departmentId?: string,
    note?: string,
    additionalDepartmentIds?: string[],
    additionalAssigneeIds?: string[]
  ): Promise<{ success: boolean; data: { grievance: Grievance } }> => {
    return apiClient.put(`/grievances/${id}/assign`, {
      assignedTo,
      departmentId,
      note,
      additionalDepartmentIds,
      additionalAssigneeIds
    });
  },

  update: async (id: string, data: Partial<CreateGrievanceData>): Promise<{ success: boolean; data: { grievance: Grievance } }> => {
    return apiClient.put(`/grievances/${id}`, data);
  },

  delete: async (id: string): Promise<{ success: boolean; message: string }> => {
    return apiClient.delete(`/grievances/${id}`);
  },

  deleteBulk: async (ids: string[]): Promise<{ success: boolean; message: string; data: { deletedCount: number } }> => {
    return apiClient.delete('/grievances/bulk', { ids });
  },

  revert: async (id: string, data: RevertGrievanceData): Promise<{ success: boolean; data: { grievance: Grievance }; message: string }> => {
    return apiClient.put(`/grievances/${id}/revert`, data);
  },

  sendReminder: async (id: string, remarks: string): Promise<{ success: boolean; data: { grievance: Grievance }; message: string }> => {
    return apiClient.post(`/grievances/${id}/reminder`, { remarks });
  },

  updateSla: async (id: string, slaHours: number): Promise<{ success: boolean; data: { grievance: Grievance }; message: string }> => {
    return apiClient.put(`/grievances/${id}/sla`, { slaHours });
  },

  getDefaulters: async (params?: { minReminders?: number; departmentId?: string; search?: string; sortBy?: string }): Promise<{
    success: boolean;
    data: {
      totalDefaulterOfficers: number;
      totalNeglectedGrievances: number;
      criticalOfficersCount?: number;
      criticalGrievancesCount?: number;
      worstDepartment: string;
      minReminders: number;
      defaulters: DefaulterOfficer[];
    };
  }> => {
    return apiClient.get('/grievances/defaulters', { params });
  },

  exportDefaultersCsvUrl: (minReminders: number = 2): string => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    return `${baseUrl}/grievances/defaulters/export?minReminders=${minReminders}${tokenParam}`;
  },

  exportDefaultersCsv: async (minReminders: number = 2): Promise<void> => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

    const response = await fetch(`${baseUrl}/grievances/defaulters/export?minReminders=${minReminders}`, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    });

    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(err?.message || 'Failed to export defaulters report');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `defaulter-officers-report-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
  },

  sendShowCauseNotice: async (officerId: string, remarks?: string): Promise<{ success: boolean; message: string }> => {
    return apiClient.post(`/grievances/defaulters/${officerId}/show-cause`, { remarks });
  },

  triggerSlaCronScan: async (): Promise<{ success: boolean; message: string; stats?: any }> => {
    return apiClient.post('/grievances/cron/trigger-scan');
  }
};

export interface DefaulterOfficer {
  _id: string;
  officerId: string;
  officerName: string;
  firstName?: string;
  lastName?: string;
  designation?: string;
  phone?: string;
  email?: string;
  departmentName: string;
  departmentId?: string;
  totalDefaulterGrievances: number;
  latestReminderAt?: string;
  oldestReminderAt?: string;
  oldestGrievanceCreated?: string;
  grievances: Array<{
    _id: string;
    grievanceId: string;
    citizenName: string;
    citizenPhone: string;
    description: string;
    category?: string;
    createdAt: string;
    reminderCount: number;
    lastReminderAt?: string;
    lastReminderRemarks?: string;
    slaHours: number;
  }>;
}

