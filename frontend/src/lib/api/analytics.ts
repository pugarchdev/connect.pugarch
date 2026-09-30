import { apiClient } from "./client";

export interface DashboardAnalyticsResponse {
  success: boolean;
  data: {
    grievances: {
      total: number;
      pending: number;
      resolved: number;
    };
    appointments: {
      total: number;
    };
    departments: number;
    users: number;
    activeUsers: number;
    deptCounts?: Array<{ _id: string | null; count: number }>;
    [key: string]: any;
  };
}

export interface CompanyMessageStat {
  _id: string;
  name: string;
  companyId: string;
  isActive: boolean;
  phoneNumber?: string | null;
  utility: number;
  service: number;
  authentication: number;
  marketing: number;
  total: number;
  lastMessageAt?: string | null;
}

export interface PlatformMessageTotals {
  utility: number;
  service: number;
  authentication: number;
  marketing: number;
  total: number;
}

export interface MessageAnalyticsResponse {
  success: boolean;
  data: {
    totals: PlatformMessageTotals;
    companies: CompanyMessageStat[];
  };
}

export interface MessageAnalyticsParams {
  period?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'all';
  startDate?: string;
  endDate?: string;
  companyId?: string;
}

export const analyticsAPI = {
  dashboard: async (companyId: string): Promise<DashboardAnalyticsResponse> =>
    apiClient.get(`/analytics/dashboard?companyId=${companyId}`),
  getMessageAnalytics: async (params?: MessageAnalyticsParams): Promise<MessageAnalyticsResponse> => {
    const query = new URLSearchParams();
    if (params?.period) query.set('period', params.period);
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.companyId) query.set('companyId', params.companyId);
    const qStr = query.toString();
    return apiClient.get(`/dashboard/superadmin/message-analytics${qStr ? `?${qStr}` : ''}`);
  },
};

