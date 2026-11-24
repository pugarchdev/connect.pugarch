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

export interface MetaPricingRates {
  serviceRate: number;
  utilityRate: number;
  authRate: number;
  marketingRate: number;
  freeQuota: number;
  baseMonthlyQuota: number;
  monthsFactor: number;
  gstPct: number;
  currency: string;
  currencySymbol: string;
}

export interface CompanyCostStat extends CompanyMessageStat {
  freeQuota: number;
  freeServiceUsed: number;
  billableService: number;
  serviceCost: number;
  utilityCost: number;
  authCost: number;
  marketingCost: number;
  subtotalCost: number;
  gstCost: number;
  totalCost: number;
  savings: number;
  effectiveCostPerMsg: number;
}

export interface MetaCostTotals extends PlatformMessageTotals {
  freeServiceUsed: number;
  billableService: number;
  serviceCost: number;
  utilityCost: number;
  authCost: number;
  marketingCost: number;
  subtotalCost: number;
  gstCost: number;
  totalCost: number;
  savings: number;
}

export interface MetaCostCalculatorResponse {
  success: boolean;
  data: {
    rates: MetaPricingRates;
    totals: MetaCostTotals;
    companies: CompanyCostStat[];
  };
}

export interface MetaCostCalculatorParams extends MessageAnalyticsParams {
  serviceRate?: number;
  utilityRate?: number;
  authRate?: number;
  marketingRate?: number;
  freeQuota?: number;
  gstRate?: number;
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
  getMetaCostCalculator: async (params?: MetaCostCalculatorParams): Promise<MetaCostCalculatorResponse> => {
    const query = new URLSearchParams();
    if (params?.period) query.set('period', params.period);
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.companyId) query.set('companyId', params.companyId);
    if (params?.serviceRate !== undefined) query.set('serviceRate', String(params.serviceRate));
    if (params?.utilityRate !== undefined) query.set('utilityRate', String(params.utilityRate));
    if (params?.authRate !== undefined) query.set('authRate', String(params.authRate));
    if (params?.marketingRate !== undefined) query.set('marketingRate', String(params.marketingRate));
    if (params?.freeQuota !== undefined) query.set('freeQuota', String(params.freeQuota));
    if (params?.gstRate !== undefined) query.set('gstRate', String(params.gstRate));
    const qStr = query.toString();
    return apiClient.get(`/dashboard/superadmin/meta-cost-calculator${qStr ? `?${qStr}` : ''}`);
  },
};

