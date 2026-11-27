"use client";

import { grievanceAPI, Grievance } from "@/lib/api/grievance";
import { useCachedQuery } from "./cache";

interface UseGrievancesParams {
  page: number;
  limit: number;
  status?: string;
  companyId?: string;
  departmentId?: string;
  assignedTo?: string;
  priority?: string;
  search?: string;
  slaStatus?: string;
  dateRange?: string;
  startDate?: string;
  endDate?: string;
  tzOffset?: number;
  enabled?: boolean;
}

export function useGrievances(params: UseGrievancesParams) {
  const { enabled = true, ...queryParam } = params;
  
  return useCachedQuery({
    queryKey: [
      "grievances",
      params.page,
      params.limit,
      params.status,
      params.companyId,
      params.departmentId,
      params.priority,
      params.search,
      params.slaStatus,
      params.dateRange,
      params.startDate,
      params.endDate,
    ],
    queryFn: async () => {
      const response = await grievanceAPI.getAll(queryParam);
      if (response?.success && response.data) {
        return response.data;
      }
      return { grievances: [], pagination: { total: 0, pages: 0, page: 1, limit: 20 } };
    },
    staleTime: 300 * 1000, // 5 minutes stale time
    enabled,
  });
}
