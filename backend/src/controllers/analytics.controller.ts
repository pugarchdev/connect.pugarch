import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Grievance from '../models/Grievance';
import Appointment from '../models/Appointment';
import Department from '../models/Department';
import User from '../models/User';
import { getDepartmentHierarchyIds } from '../utils/departmentUtils';

import { Permission, UserRole, GrievanceStatus, AppointmentStatus, Module, SLA_CONFIG } from '../config/constants';

type DashboardCacheEntry = {
  expiresAt: number;
  payload: any;
};

const DASHBOARD_CACHE_TTL_MS = 30 * 1000; // 30s hot cache for landing-page KPIs
const DASHBOARD_KPI_CACHE_TTL_MS = 15 * 1000;
const ANALYTICS_MAX_TIME_MS = 12000;
const dashboardResponseCache = new Map<string, DashboardCacheEntry>();
const dashboardInFlight = new Map<string, Promise<any>>();
const dashboardKpiResponseCache = new Map<string, DashboardCacheEntry>();
const dashboardKpiInFlight = new Map<string, Promise<any>>();

const buildDashboardCacheKey = (req: Request, companyId?: any, departmentId?: any, period?: any, startDate?: any, endDate?: any) => {
  const user = req.user as any;
  const userId = user?._id?.toString?.() || 'anonymous';
  const companyScope = companyId?.toString?.() || user?.companyId?.toString?.() || 'self';
  const departmentScope = departmentId?.toString?.() || 'all';
  const roleScope = user?.isSuperAdmin ? 'superadmin' : (resolveUserHierarchyLevel(user) || 0).toString();
  const periodScope = period?.toString?.() || 'week';
  const startScope = startDate?.toString?.() || '';
  const endScope = endDate?.toString?.() || '';
  return `${userId}::${roleScope}::${companyScope}::${departmentScope}::${periodScope}::${startScope}::${endScope}`;
};

function parseFlexibleDate(str: any, isEnd = false): Date | null {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;

  // DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    return isEnd ? new Date(year, month, day, 23, 59, 59, 999) : new Date(year, month, day, 0, 0, 0, 0);
  }

  // YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    return isEnd ? new Date(year, month, day, 23, 59, 59, 999) : new Date(year, month, day, 0, 0, 0, 0);
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    if (isEnd) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
  }
  return null;
}

const getCachedDashboardPayload = (key: string) => {
  const cached = dashboardResponseCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardResponseCache.delete(key);
    return null;
  }
  return cached.payload;
};

const setCachedDashboardPayload = (key: string, payload: any) => {
  dashboardResponseCache.set(key, {
    payload,
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
  });
};

const resolveUserHierarchyLevel = (user: any): number => {
  if (user?.isSuperAdmin) return 0;
  if (typeof user?.level === 'number') return user.level;

  const role = (user?.role || user?.roleName || '').toString().toLowerCase();
  if (role.includes('company')) return 1;
  if (role.includes('department') && !role.includes('sub')) return 2;
  if (role.includes('sub') && role.includes('department')) return 3;
  if (role.includes('operator')) return 4;
  return 4;
};

const getAnalyticsBaseQuery = async (req: any, companyId?: any, departmentId?: any) => {
  const query: any = {};
  const currentUser = req.user;

  if (currentUser.isSuperAdmin) {
    if (companyId) {
      query.companyId = new mongoose.Types.ObjectId(companyId.toString());
    } else {
      // 🛡️ SECURITY: Super Admin without companyId should see nothing
      // We force a query that will return no results to prevent global leakage.
      query._id = { $in: [] };
      return query;
    }
    
    if (departmentId) {
      const deptId = new mongoose.Types.ObjectId(departmentId.toString());
      // 🏢 HIERARCHICAL: Check if this is a parent department to include sub-departments
      const subDeptIds = await Department.find({ 
        parentDepartmentId: deptId 
      }).distinct('_id');
      
      query.$or = [
        { departmentId: deptId },
        { subDepartmentId: deptId },
        { subDepartmentId: { $in: subDeptIds } }
      ];
    }
  } else {
    query.companyId = currentUser.companyId;

    const userLevel = resolveUserHierarchyLevel(currentUser);
    const assignedDeptIds = (currentUser.departmentIds && currentUser.departmentIds.length > 0)
      ? currentUser.departmentIds.map((id: string | mongoose.Types.ObjectId) => id.toString())
      : (currentUser.departmentId ? [currentUser.departmentId.toString()] : []);

    // Determine unauthorized request early
    if (userLevel === 1) { // Company Admin
      if (departmentId) {
        const deptId = new mongoose.Types.ObjectId(departmentId.toString());
        const allDeptIds = await getDepartmentHierarchyIds(deptId.toString());
        const mongoIds = allDeptIds.map(id => new mongoose.Types.ObjectId(id));
        query.$or = [
          { departmentId: { $in: mongoIds } },
          { subDepartmentId: { $in: mongoIds } }
        ];
      }
      // Otherwise, no department filter (sees all company data)
    } else {
      // 🛡️ HIERARCHICAL SCOPING for Level 2 & 3
      let authorizedDeptIds: string[] = [];
      if (userLevel === 2) {
        // Dept Admin sees their departments AND all descendants
        authorizedDeptIds = await getDepartmentHierarchyIds(assignedDeptIds);
      } else if (userLevel === 3) {
        // Sub-Dept Admin sees ONLY their assigned departments
        authorizedDeptIds = [...assignedDeptIds];
      } else {
        // Operator sees only assigned records (handled by assignedTo filter)
        query.assignedTo = currentUser._id;
        return query; 
      }

      // 🔍 FILTER VALIDATION: If a specific departmentId is requested, verify it's in authorized scope
      if (departmentId) {
        const requestedIdStr = departmentId.toString();
        if (authorizedDeptIds.includes(requestedIdStr)) {
          // Valid request: filter by this specific department (including its children if level 2)
          const nestedIds = userLevel === 2 ? await getDepartmentHierarchyIds(requestedIdStr) : [requestedIdStr];
          const mongoIds = nestedIds.map(id => new mongoose.Types.ObjectId(id));
          query.$or = [
            { departmentId: { $in: mongoIds } },
            { subDepartmentId: { $in: mongoIds } },
            { assignedTo: currentUser._id }
          ];
        } else {
          // ⚠️ SECURITY: Requested an unauthorized department. Force filter to empty or authorized scope.
          query._id = { $in: [] }; 
        }
      } else {
        // No filter requested: show full authorized scope
        const mongoIds = authorizedDeptIds.map(id => new mongoose.Types.ObjectId(id));
        query.$or = [
          { departmentId: { $in: mongoIds } },
          { subDepartmentId: { $in: mongoIds } },
          { assignedTo: currentUser._id }
        ];
      }
    }
  }
  return query;
};

export const dashboard = async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const currentUserLevel = resolveUserHierarchyLevel(currentUser);
    const { companyId, departmentId, period, startDate, endDate } = req.query as {
      companyId?: string;
      departmentId?: string;
      period?: string;
      startDate?: string;
      endDate?: string;
    };
    const cacheKey = buildDashboardCacheKey(req, companyId, departmentId, period, startDate, endDate);

    const cachedPayload = getCachedDashboardPayload(cacheKey);
    if (cachedPayload) {
      return res.json({
        success: true,
        data: cachedPayload,
        meta: { cache: 'HIT', ttlMs: DASHBOARD_CACHE_TTL_MS }
      });
    }

    const existingInFlight = dashboardInFlight.get(cacheKey);
    if (existingInFlight) {
      const payload = await existingInFlight;
      return res.json({
        success: true,
        data: payload,
        meta: { cache: 'HIT_INFLIGHT', ttlMs: DASHBOARD_CACHE_TTL_MS }
      });
    }

    const payloadPromise = (async () => {

    const baseQuery = await getAnalyticsBaseQuery(req, companyId, departmentId);

    // 🔍 Extract authorized department IDs from user context for proper scoping of counts
    let authorizedMongoDeptIds: mongoose.Types.ObjectId[] = [];
    let forceEmptyScope = false;
    const currentAssignedDeptIds = (currentUser.departmentIds && currentUser.departmentIds.length > 0)
      ? currentUser.departmentIds
      : (currentUser.departmentId ? [currentUser.departmentId] : []);
    const currentAssignedDeptIdStrings = currentAssignedDeptIds.map((id: string | mongoose.Types.ObjectId) => id.toString());
    
    if (currentUser.isSuperAdmin) {
      if (departmentId) {
        const scopedIds = await getDepartmentHierarchyIds(departmentId.toString());
        authorizedMongoDeptIds = scopedIds.map(id => new mongoose.Types.ObjectId(id));
      }
    } else if (currentUserLevel === 1) { // Company Admin
      if (departmentId) {
        const scopedIds = await getDepartmentHierarchyIds(departmentId.toString());
        authorizedMongoDeptIds = scopedIds.map(id => new mongoose.Types.ObjectId(id));
      }
      // no departmentId => full company visibility
    } else if (currentUserLevel === 2) { // Department Admin
      const fullAuthorizedIds = await getDepartmentHierarchyIds(currentAssignedDeptIdStrings);
      if (departmentId) {
        const requestedId = departmentId.toString();
        if (fullAuthorizedIds.includes(requestedId)) {
          const scopedIds = await getDepartmentHierarchyIds(requestedId);
          authorizedMongoDeptIds = scopedIds.map(id => new mongoose.Types.ObjectId(id));
        } else {
          forceEmptyScope = true;
        }
      } else {
        authorizedMongoDeptIds = fullAuthorizedIds.map(id => new mongoose.Types.ObjectId(id));
      }
    } else if (currentUserLevel === 3) { // Sub-Department Admin
      const fullAuthorizedIds = [...currentAssignedDeptIdStrings];
      if (departmentId) {
        const requestedId = departmentId.toString();
        if (fullAuthorizedIds.includes(requestedId)) {
          authorizedMongoDeptIds = [new mongoose.Types.ObjectId(requestedId)];
        } else {
          forceEmptyScope = true;
        }
      } else {
        authorizedMongoDeptIds = fullAuthorizedIds.map(id => new mongoose.Types.ObjectId(id));
      }
    } else if (currentUserLevel >= 4) { // Operator
      authorizedMongoDeptIds = currentAssignedDeptIdStrings.map(id => new mongoose.Types.ObjectId(id));
    }

    const scopeFilter = forceEmptyScope
      ? { _id: { $in: [] as mongoose.Types.ObjectId[] } }
      : authorizedMongoDeptIds.length > 0 
      ? { $or: [{ _id: { $in: authorizedMongoDeptIds } }, { parentDepartmentId: { $in: authorizedMongoDeptIds } }] }
      : {};

    const userScopeFilter = forceEmptyScope
      ? { _id: { $in: [] as mongoose.Types.ObjectId[] } }
      : currentUserLevel >= 4
      ? { _id: currentUser._id } // Operators only see themselves
      : authorizedMongoDeptIds.length > 0
        ? { $or: [{ departmentId: { $in: authorizedMongoDeptIds } }, { departmentIds: { $in: authorizedMongoDeptIds } }] }
        : {};

    // Fetch company to check for modules
    const targetCompanyId = currentUser.companyId || companyId;
    const company = targetCompanyId ? await mongoose.model('Company').findById(targetCompanyId) as any : null;
    const isHierarchicalEnabled = company?.enabledModules?.includes(Module.HIERARCHICAL_DEPARTMENTS);

    // Get time-based statistics (last 7 days, 30 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Monthly trends (last 6 months) logic moved up for baseQuery reuse
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const normalizedCompanyId = targetCompanyId ? new mongoose.Types.ObjectId(targetCompanyId.toString()) : null;

    // 🗓️ Calculate Graph Filter Date Range
    const now = new Date();
    let graphStartDate: Date | null = null;
    let graphEndDate: Date | null = new Date();
    let groupFormat = '%Y-%m-%d';
    let groupType: 'daily' | 'weekly' | 'monthly' = 'daily';

    const normalizedPeriod = (period || 'week').toLowerCase();

    if (normalizedPeriod === 'custom') {
      if (startDate) graphStartDate = parseFlexibleDate(startDate, false);
      if (endDate) graphEndDate = parseFlexibleDate(endDate, true) || new Date();
      if (graphStartDate && graphEndDate) {
        const diffMs = graphEndDate.getTime() - graphStartDate.getTime();
        const diffDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        if (diffDays <= 45) {
          groupFormat = '%Y-%m-%d';
          groupType = 'daily';
        } else if (diffDays <= 180) {
          groupFormat = '%Y-%m-%d';
          groupType = 'daily';
        } else {
          groupFormat = '%Y-%m';
          groupType = 'monthly';
        }
      }
    } else if (normalizedPeriod === 'month') {
      graphStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      graphEndDate = now;
      groupFormat = '%Y-%m-%d';
      groupType = 'daily';
    } else if (normalizedPeriod === 'quarter' || normalizedPeriod === 'quarterly') {
      graphStartDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      graphEndDate = now;
      groupFormat = '%Y-%m-%d';
      groupType = 'daily';
    } else if (normalizedPeriod === 'year' || normalizedPeriod === 'yearly') {
      graphStartDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      graphEndDate = now;
      groupFormat = '%Y-%m';
      groupType = 'monthly';
    } else if (normalizedPeriod === 'all') {
      graphStartDate = null;
      graphEndDate = null;
      groupFormat = '%Y-%m';
      groupType = 'monthly';
    } else {
      // default: 'week'
      graphStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      graphEndDate = now;
      groupFormat = '%Y-%m-%d';
      groupType = 'daily';
    }

    const graphDateMatch: any = {};
    if (graphStartDate || graphEndDate) {
      graphDateMatch.createdAt = {};
      if (graphStartDate) graphDateMatch.createdAt.$gte = graphStartDate;
      if (graphEndDate) graphDateMatch.createdAt.$lte = graphEndDate;
    }

    // 🚀 Performance Optimization: Consolidate 35+ queries into 4 main parallel aggregation blocks
    const [
      grievanceStats,
      appointmentStats,
      generalStats,
      deptCountsArr,
      departmentCount,
      mainDepartmentCount,
      subDepartmentCount
    ] = await Promise.all([
      // 1. Comprehensive Grievance Analytics
      Grievance.aggregate([
        { $match: baseQuery },
        {
          $facet: {
            counts: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  open: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.PENDING, GrievanceStatus.ASSIGNED, GrievanceStatus.IN_PROGRESS, GrievanceStatus.REVERTED, 'OPEN']] }, 1, 0] } },
                  pending: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.PENDING, 'OPEN']] }, 1, 0] } },
                  resolved: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.RESOLVED, 'CLOSED']] }, 1, 0] } },
                  inProgress: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.IN_PROGRESS] }, 1, 0] } },
                  reverted: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.REVERTED] }, 1, 0] } },
                  rejected: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.REJECTED] }, 1, 0] } },
                  assigned: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.ASSIGNED] }, 1, 0] } },
                  last7Days: { $sum: { $cond: [{ $gte: ['$createdAt', sevenDaysAgo] }, 1, 0] } },
                  last30Days: { $sum: { $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, 1, 0] } },
                  resolvedToday: { $sum: { $cond: [{ $and: [{ $in: ['$status', [GrievanceStatus.RESOLVED, 'CLOSED']] }, { $gte: ['$resolvedAt', new Date(new Date().setHours(0,0,0,0))] }] }, 1, 0] } },
                  slaBreached: { 
                    $sum: { 
                      $cond: [
                        { 
                          $and: [
                            { $in: ['$status', [GrievanceStatus.PENDING, GrievanceStatus.ASSIGNED, GrievanceStatus.IN_PROGRESS, GrievanceStatus.REVERTED, 'OPEN']] }, 
                            { 
                              $gt: [
                                { $subtract: [new Date(), "$createdAt"] },
                                { $multiply: [{ $ifNull: ["$slaHours", 120] }, 3600000] }
                              ]
                            }
                          ] 
                        }, 
                        1, 
                        0
                      ] 
                    } 
                  },
                  pendingOverdue: { 
                    $sum: { 
                      $cond: [
                        { 
                          $and: [
                            { $in: ['$status', [GrievanceStatus.PENDING, GrievanceStatus.ASSIGNED, GrievanceStatus.IN_PROGRESS, GrievanceStatus.REVERTED, 'OPEN']] }, 
                            { 
                              $gt: [
                                { $subtract: [new Date(), "$createdAt"] },
                                { $multiply: [{ $ifNull: ["$slaHours", 120] }, 3600000] }
                              ]
                            }
                          ] 
                        }, 
                        1, 
                        0
                      ] 
                    } 
                  }
                }
              }
            ],
            daily: [
              { $match: { createdAt: { $gte: sevenDaysAgo } } },
              { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
              { $sort: { _id: 1 } }
            ],
            monthly: [
              { $match: { createdAt: { $gte: sixMonthsAgo } } },
              { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 }, resolved: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.RESOLVED, 'CLOSED']] }, 1, 0] } } } },
              { $sort: { _id: 1 } }
            ],
            // 📈 Filtered trend based on selected period
            trend: [
              ...(Object.keys(graphDateMatch).length > 0 ? [{ $match: graphDateMatch }] : []),
              {
                $group: {
                  _id: { $dateToString: { format: groupFormat, date: '$createdAt' } },
                  count: { $sum: 1 },
                  resolved: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.RESOLVED, 'CLOSED']] }, 1, 0] } }
                }
              },
              { $sort: { _id: 1 } }
            ],
            // 🎯 Filtered status breakdown for selected period
            filteredCounts: [
              ...(Object.keys(graphDateMatch).length > 0 ? [{ $match: graphDateMatch }] : []),
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  pending: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.PENDING, 'OPEN']] }, 1, 0] } },
                  inProgress: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.IN_PROGRESS, GrievanceStatus.ASSIGNED]] }, 1, 0] } },
                  resolved: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.RESOLVED, 'CLOSED']] }, 1, 0] } },
                  rejected: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.REJECTED] }, 1, 0] } },
                  reverted: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.REVERTED] }, 1, 0] } },
                  pendingOverdue: { 
                    $sum: { 
                      $cond: [
                        { 
                          $and: [
                            { $in: ['$status', [GrievanceStatus.PENDING, GrievanceStatus.ASSIGNED, GrievanceStatus.IN_PROGRESS, GrievanceStatus.REVERTED, 'OPEN']] }, 
                            { 
                              $gt: [
                                { $subtract: [new Date(), "$createdAt"] },
                                { $multiply: [{ $ifNull: ["$slaHours", 120] }, 3600000] }
                              ]
                            }
                          ] 
                        }, 
                        1, 
                        0
                      ] 
                    } 
                  }
                }
              }
            ],
            // 🏢 Filtered department distribution for selected period
            filteredDepartments: [
              ...(Object.keys(graphDateMatch).length > 0 ? [{ $match: graphDateMatch }] : []),
              {
                $project: {
                  deptIds: {
                    $filter: {
                      input: ["$departmentId", "$subDepartmentId"],
                      as: "id",
                      cond: { $ne: ["$$id", null] }
                    }
                  },
                  status: 1
                }
              },
              { $unwind: "$deptIds" },
              { $group: { _id: "$deptIds", total: { $sum: 1 }, pending: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.PENDING, GrievanceStatus.ASSIGNED, GrievanceStatus.IN_PROGRESS, 'OPEN']] }, 1, 0] } } } },
              { $match: { _id: { $ne: null } } },
              { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
              { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
              { $project: { departmentId: '$_id', departmentName: { $ifNull: ['$dept.name', 'Unknown'] }, parentDepartmentId: '$dept.parentDepartmentId', total: 1, pending: 1 } },
              { $sort: { total: -1 } },
              { $limit: 25 }
            ],
            byDepartment: [
              {
                $project: {
                  deptIds: {
                    $filter: {
                      input: ["$departmentId", "$subDepartmentId"],
                      as: "id",
                      cond: { $ne: ["$$id", null] }
                    }
                  },
                  status: 1
                }
              },
              { $unwind: "$deptIds" },
              { $group: { _id: "$deptIds", total: { $sum: 1 }, pending: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.PENDING, GrievanceStatus.ASSIGNED, GrievanceStatus.IN_PROGRESS, 'OPEN']] }, 1, 0] } } } },
              { $match: { _id: { $ne: null } } },
              { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
              { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
              { $project: { departmentId: '$_id', departmentName: { $ifNull: ['$dept.name', 'Unknown'] }, total: 1, pending: 1 } }
            ],
            avgResolution: [
              { $match: { status: GrievanceStatus.RESOLVED, resolvedAt: { $exists: true } } },
              { $project: { resolutionTime: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 86400000] } } },
              { $group: { _id: null, avgDays: { $avg: '$resolutionTime' } } }
            ]
          }
        }
      ]).option({ maxTimeMS: ANALYTICS_MAX_TIME_MS }),

      // 2. Comprehensive Appointment Analytics
      Appointment.aggregate([
        { $match: baseQuery },
        {
          $facet: {
            counts: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  requested: { $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.REQUESTED] }, 1, 0] } },
                  scheduled: { $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.SCHEDULED] }, 1, 0] } },
                  confirmed: { $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.CONFIRMED] }, 1, 0] } },
                  completed: { $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.COMPLETED] }, 1, 0] } },
                  cancelled: { $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.CANCELLED] }, 1, 0] } },
                  last7Days: { $sum: { $cond: [{ $gte: ['$createdAt', sevenDaysAgo] }, 1, 0] } },
                  last30Days: { $sum: { $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, 1, 0] } }
                }
              }
            ],
            daily: [
              { $match: { createdAt: { $gte: sevenDaysAgo } } },
              { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
              { $sort: { _id: 1 } }
            ],
            monthly: [
              { $match: { createdAt: { $gte: sixMonthsAgo } } },
              { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.COMPLETED] }, 1, 0] } } } },
              { $sort: { _id: 1 } }
            ],
            byDepartment: [
              {
                $project: {
                  deptIds: {
                    $filter: {
                      input: ["$departmentId", "$subDepartmentId"],
                      as: "id",
                      cond: { $ne: ["$$id", null] }
                    }
                  },
                  status: 1
                }
              },
              { $unwind: "$deptIds" },
              { $group: { _id: "$deptIds", count: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.COMPLETED] }, 1, 0] } } } },
              { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
              { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
              { $project: { departmentId: '$_id', departmentName: '$dept.name', count: 1, completed: 1 } },
              { $sort: { count: -1 } }
            ]
          }
        }
      ]).option({ maxTimeMS: ANALYTICS_MAX_TIME_MS }),

      // 3. User & Role Distribution
      normalizedCompanyId ? User.aggregate([
        { $match: { companyId: normalizedCompanyId, ...userScopeFilter } },
        {
          $facet: {
            byRole: [
              { $lookup: { from: 'roles', localField: 'customRoleId', foreignField: '_id', as: 'role' } },
              { $unwind: { path: '$role', preserveNullAndEmptyArrays: true } },
              { $group: { _id: { $ifNull: ['$role.name', 'Staff'] }, count: { $sum: 1 } } },
              { $sort: { count: -1 } }
            ],
            total: [{ $count: 'count' }],
            active: [{ $match: { isActive: true } }, { $count: 'count' }]
          }
        }
      ]).option({ maxTimeMS: ANALYTICS_MAX_TIME_MS }) : Promise.resolve([{ byRole: [], total: [{count:0}], active: [{count:0}] }]),

      // 4. Existing scoping counts & Hierarchical counts
      targetCompanyId ? User.aggregate([{ $match: { companyId: new mongoose.Types.ObjectId(targetCompanyId.toString()), ...userScopeFilter } }, { $unwind: { path: "$departmentIds", preserveNullAndEmptyArrays: true } }, { $group: { _id: { $ifNull: ["$departmentIds", "$departmentId"] }, count: { $sum: 1 } } }]).option({ maxTimeMS: ANALYTICS_MAX_TIME_MS }) : Promise.resolve([]),
      Department.countDocuments({ companyId: targetCompanyId, ...scopeFilter }).maxTimeMS(ANALYTICS_MAX_TIME_MS),
      isHierarchicalEnabled ? Department.countDocuments({
        companyId: targetCompanyId,
        ...(scopeFilter.$or
          ? { $and: [scopeFilter, { $or: [{ parentDepartmentId: null }, { parentDepartmentId: { $exists: false } }] }] }
          : { ...scopeFilter, $or: [{ parentDepartmentId: null }, { parentDepartmentId: { $exists: false } }] }),
      }).maxTimeMS(ANALYTICS_MAX_TIME_MS) : Promise.resolve(0),
      isHierarchicalEnabled ? Department.countDocuments({ companyId: targetCompanyId, ...scopeFilter, parentDepartmentId: { $ne: null } }).maxTimeMS(ANALYTICS_MAX_TIME_MS) : Promise.resolve(0),
    ]);

    // Parse Aggregation Results
    const g = grievanceStats[0] || { counts: [{}], byPriority: [], daily: [], monthly: [], trend: [], filteredCounts: [], filteredDepartments: [], byDepartment: [], avgResolution: [] };
    const gCounts = g.counts[0] || {};
    const a = appointmentStats[0] || { counts: [{}], daily: [], monthly: [], byDepartment: [] };
    const aCounts = a.counts[0] || {};
    const u = generalStats[0] || { byRole: [], total: [{count:0}], active: [{count:0}] };

    const totalGrievances = gCounts.total || 0;
    const openGrievances = gCounts.open || 0;
    const pendingGrievances = gCounts.pending || 0;
    const resolvedGrievances = gCounts.resolved || 0;
    const inProgressGrievancesCount = gCounts.inProgress || 0;
    const revertedGrievances = gCounts.reverted || 0;
    const rejectedGrievances = gCounts.rejected || 0;
    const assignedGrievances = gCounts.assigned || 0;
    const grievancesLast7Days = gCounts.last7Days || 0;
    const grievancesLast30Days = gCounts.last30Days || 0;
    const resolvedToday = gCounts.resolvedToday || 0;
    const slaBreachedGrievancesCount = gCounts.slaBreached || 0;

    const totalAppointments = aCounts.total || 0;
    const requestedAppointments = aCounts.requested || 0;
    const scheduledAppointments = aCounts.scheduled || 0;
    const confirmedAppointments = aCounts.confirmed || 0;
    const completedAppointments = aCounts.completed || 0;
    const cancelledAppointments = aCounts.cancelled || 0;
    const appointmentsLast7Days = aCounts.last7Days || 0;
    const appointmentsLast30Days = aCounts.last30Days || 0;

    const userCount = u.total?.[0]?.count || 0;
    const activeUsersCount = u.active?.[0]?.count || 0;

    // Calculate rates
    const resolutionRate = totalGrievances > 0 ? ((resolvedGrievances / totalGrievances) * 100).toFixed(1) : '0';
    const completionRate = totalAppointments > 0 ? ((completedAppointments / totalAppointments) * 100).toFixed(1) : '0';
    const slaComplianceRate = totalGrievances > 0 ? (((totalGrievances - slaBreachedGrievancesCount) / totalGrievances) * 100).toFixed(1) : '100';

    // 🔒 SECURITY: Restrict appointments to Company Admin+
    const canSeeAppointments = currentUser.isSuperAdmin || currentUserLevel === 1;

    const payload = {
        grievances: {
          total: openGrievances,
          registeredTotal: totalGrievances,
          pending: pendingGrievances,
          assigned: assignedGrievances,
          reverted: revertedGrievances,
          rejected: rejectedGrievances,
          inProgress: inProgressGrievancesCount,
          resolved: resolvedGrievances,
          last7Days: grievancesLast7Days,
          last30Days: grievancesLast30Days,
          resolutionRate: parseFloat(resolutionRate),
          slaBreached: slaBreachedGrievancesCount,
          pendingOverdue: gCounts.pendingOverdue || 0,
          slaComplianceRate: parseFloat(slaComplianceRate),
          avgResolutionDays: g.avgResolution?.[0] ? parseFloat(g.avgResolution[0].avgDays.toFixed(1)) : 0,
          daily: g.daily.map((d: any) => ({ date: d._id, count: d.count })),
          monthly: g.monthly.map((m: any) => ({ month: m._id, count: m.count, resolved: m.resolved })),
          trend: (g.trend || []).map((t: any) => ({ date: t._id, count: t.count, resolved: t.resolved || 0 })),
          filteredStatus: g.filteredCounts?.[0] || {
            total: totalGrievances,
            pending: pendingGrievances,
            inProgress: (gCounts.assigned || 0) + (gCounts.inProgress || 0),
            resolved: resolvedGrievances,
            rejected: rejectedGrievances,
            reverted: revertedGrievances,
            pendingOverdue: gCounts.pendingOverdue || 0
          },
          filteredDepartments: (g.filteredDepartments || []).map((d: any) => ({
            departmentId: d.departmentId,
            departmentName: d.departmentName || 'Unknown',
            parentDepartmentId: d.parentDepartmentId,
            total: d.total,
            count: d.total,
            pending: d.pending
          })),
          periodInfo: {
            period: normalizedPeriod,
            startDate: graphStartDate ? graphStartDate.toISOString() : null,
            endDate: graphEndDate ? graphEndDate.toISOString() : null,
            groupType
          },
          byDepartment: g.byDepartment.map((d: any) => ({
            departmentId: d.departmentId,
            departmentName: d.departmentName || 'Unknown',
            total: d.total,
            pending: d.pending
          }))
        },
        appointments: canSeeAppointments ? {
          total: totalAppointments,
          pending: requestedAppointments + scheduledAppointments,
          requested: requestedAppointments,
          scheduled: scheduledAppointments,
          confirmed: confirmedAppointments,
          completed: completedAppointments,
          cancelled: cancelledAppointments,
          last7Days: appointmentsLast7Days,
          last30Days: appointmentsLast30Days,
          completionRate: parseFloat(completionRate),
          byDepartment: a.byDepartment,
          daily: a.daily.map((d: any) => ({ date: d._id, count: d.count })),
          monthly: a.monthly.map((m: any) => ({ month: m._id, count: m.count, completed: m.completed }))
        } : {
          total: 0,
          pending: 0,
          requested: 0,
          scheduled: 0,
          confirmed: 0,
          completed: 0,
          cancelled: 0,
          last7Days: 0,
          last30Days: 0,
          completionRate: 0,
          byDepartment: [],
          daily: [],
          monthly: []
        },
        departments: departmentCount,
        mainDepartments: mainDepartmentCount,
        subDepartments: subDepartmentCount,
        users: userCount,
        activeUsers: activeUsersCount,
        resolvedToday,
        isHierarchicalEnabled: !!isHierarchicalEnabled,
        deptCounts: deptCountsArr,
        usersByRole: u.byRole.reduce((acc: any[], current: any) => {
          const rawName = current._id || 'Unknown';
          const name = rawName.toString().replace(/_/g, ' ').toUpperCase();
          const existing = acc.find(a => a.name === name);
          if (existing) { existing.count += current.count; } else { acc.push({ name, count: current.count }); }
          return acc;
        }, []).sort((a: any, b: any) => b.count - a.count)
      };
    setCachedDashboardPayload(cacheKey, payload);
    return payload;
    })();

    dashboardInFlight.set(cacheKey, payloadPromise);
    const payload = await payloadPromise;

    res.json({
      success: true,
      data: payload,
      meta: { cache: 'MISS', ttlMs: DASHBOARD_CACHE_TTL_MS }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics', error: error.message });
  } finally {
    const { companyId, departmentId, period, startDate, endDate } = req.query as any;
    const cacheKey = buildDashboardCacheKey(req, companyId, departmentId, period, startDate, endDate);
    dashboardInFlight.delete(cacheKey);
  }
};

export const dashboardKpis = async (req: Request, res: Response) => {
  try {
    const { companyId, departmentId } = req.query;
    const cacheKey = buildDashboardCacheKey(req, companyId, departmentId);

    const cachedEntry = dashboardKpiResponseCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return res.json({
        success: true,
        data: cachedEntry.payload,
        meta: { cache: 'HIT', ttlMs: DASHBOARD_KPI_CACHE_TTL_MS }
      });
    }

    const existingInFlight = dashboardKpiInFlight.get(cacheKey);
    if (existingInFlight) {
      const payload = await existingInFlight;
      return res.json({
        success: true,
        data: payload,
        meta: { cache: 'HIT_INFLIGHT', ttlMs: DASHBOARD_KPI_CACHE_TTL_MS }
      });
    }

    const payloadPromise = (async () => {
      const baseQuery = await getAnalyticsBaseQuery(req, companyId, departmentId);

      const [counts] = await Grievance.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            open: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.PENDING, GrievanceStatus.ASSIGNED, GrievanceStatus.IN_PROGRESS, GrievanceStatus.REVERTED, 'OPEN']] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.PENDING, 'OPEN']] }, 1, 0] } },
            assigned: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.ASSIGNED] }, 1, 0] } },
            inProgress: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.IN_PROGRESS] }, 1, 0] } },
            reverted: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.REVERTED] }, 1, 0] } },
            resolved: { $sum: { $cond: [{ $in: ['$status', [GrievanceStatus.RESOLVED, 'CLOSED']] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.REJECTED] }, 1, 0] } },
            slaBreached: {
              $sum: {
                $cond: [
                  { 
                    $and: [
                      { $in: ['$status', [GrievanceStatus.PENDING, GrievanceStatus.ASSIGNED, GrievanceStatus.IN_PROGRESS, GrievanceStatus.REVERTED, 'OPEN']] }, 
                      { 
                        $gt: [
                          { $subtract: [new Date(), "$createdAt"] },
                          { $multiply: [{ $ifNull: ["$slaHours", 120] }, 3600000] }
                        ]
                      }
                    ] 
                  },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]).option({ maxTimeMS: ANALYTICS_MAX_TIME_MS });

      const g = counts || {};
      const payload = {
        grievances: {
          total: g.open || 0,
          registeredTotal: g.total || 0,
          pending: g.pending || 0,
          assigned: g.assigned || 0,
          inProgress: g.inProgress || 0,
          reverted: g.reverted || 0,
          resolved: g.resolved || 0,
          rejected: g.rejected || 0,
          pendingOverdue: g.slaBreached || 0,
          slaBreached: g.slaBreached || 0,
        }
      };

      dashboardKpiResponseCache.set(cacheKey, {
        payload,
        expiresAt: Date.now() + DASHBOARD_KPI_CACHE_TTL_MS,
      });
      return payload;
    })();

    dashboardKpiInFlight.set(cacheKey, payloadPromise);
    const payload = await payloadPromise;

    res.json({ success: true, data: payload, meta: { cache: 'MISS', ttlMs: DASHBOARD_KPI_CACHE_TTL_MS } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard KPI statistics', error: error.message });
  } finally {
    const { companyId, departmentId } = req.query;
    const cacheKey = buildDashboardCacheKey(req, companyId, departmentId);
    dashboardKpiInFlight.delete(cacheKey);
  }
};

export const grievancesByDepartment = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.query;
    const matchQuery = await getAnalyticsBaseQuery(req, companyId);
    const distribution = await Grievance.aggregate([
      { $match: matchQuery },
      {
        $project: {
          deptIds: {
            $filter: {
              input: ["$departmentId", "$subDepartmentId"],
              as: "id",
              cond: { $ne: ["$$id", null] }
            }
          },
          status: 1
        }
      },
      { $unwind: "$deptIds" },
      { $group: { _id: "$deptIds", count: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.PENDING] }, 1, 0] } }, resolved: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.RESOLVED] }, 1, 0] } } } },
      { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'department' } },
      { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
      { $project: { departmentId: '$_id', departmentName: '$department.name', parentDepartmentId: '$department.parentDepartmentId', count: 1, pending: 1, resolved: 1 } },
      { $sort: { count: -1 } }
    ]);
    res.json({ success: true, data: distribution });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch department distribution', error: error.message });
  }
};

export const grievancesByStatus = async (req: Request, res: Response) => {
  try {
    const { companyId, departmentId } = req.query;
    const matchQuery = await getAnalyticsBaseQuery(req, companyId, departmentId);
    const distribution = await Grievance.aggregate([
      { $match: matchQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    res.json({ success: true, data: distribution });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch status distribution', error: error.message });
  }
};

export const grievancesTrends = async (req: Request, res: Response) => {
  try {
    const { companyId, departmentId, days = 30 } = req.query;
    const matchQuery = await getAnalyticsBaseQuery(req, companyId, departmentId);
    matchQuery.createdAt = { $gte: new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000) };
    const trends = await Grievance.aggregate([
      { $match: matchQuery },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    res.json({ success: true, data: trends });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch grievance trends', error: error.message });
  }
};

export const appointmentsByDate = async (req: Request, res: Response) => {
  try {
    const { companyId, departmentId, days = 30 } = req.query;
    const baseQuery = await getAnalyticsBaseQuery(req, companyId, departmentId);
    const matchQuery: any = { ...baseQuery, appointmentDate: { $gte: new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000) } };
    const distribution = await Appointment.aggregate([
      { $match: matchQuery },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$appointmentDate' } }, count: { $sum: 1 }, scheduled: { $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.SCHEDULED] }, 1, 0] } }, completed: { $sum: { $cond: [{ $eq: ['$status', AppointmentStatus.COMPLETED] }, 1, 0] } } } },
      { $sort: { _id: 1 } }
    ]);
    res.json({ success: true, data: distribution });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch appointment distribution', error: error.message });
  }
};

export const performance = async (req: Request, res: Response) => {
  try {
    const { companyId, departmentId } = req.query;
    const baseQuery = await getAnalyticsBaseQuery(req, companyId, departmentId);
    const [topDepartments, topOperators] = await Promise.all([
      Grievance.aggregate([
        { $match: { ...baseQuery, departmentId: { $exists: true } } },
        { $group: { _id: '$departmentId', total: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ['$status', GrievanceStatus.RESOLVED] }, 1, 0] } } } },
        { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'department' } },
        { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
        { $project: { departmentId: '$_id', departmentName: '$department.name', total: 1, resolved: 1, resolutionRate: { $cond: [{ $gt: ['$total', 0] }, { $multiply: [{ $divide: ['$resolved', '$total'] }, 100] }, 0] } } },
        { $sort: { resolutionRate: -1 } },
        { $limit: 10 }
      ]),
      Grievance.aggregate([
        { $match: { ...baseQuery, assignedTo: { $exists: true }, status: GrievanceStatus.RESOLVED } },
        { $group: { _id: '$assignedTo', resolved: { $sum: 1 }, avgResolutionDays: { $avg: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 86400000] } } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { operatorName: '$user.name', resolved: 1, avgResolutionDays: { $round: ['$avgResolutionDays', 1] } } },
        { $sort: { resolved: -1 } },
        { $limit: 10 }
      ])
    ]);
    res.json({ success: true, data: { topDepartments, topOperators } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch performance statistics', error: error.message });
  }
};

export const hourly = async (req: Request, res: Response) => {
  try {
    const { companyId, departmentId, days = 1 } = req.query;
    const matchQuery = await getAnalyticsBaseQuery(req, companyId, departmentId);
    const lookbackDays = Math.max(Number(days) || 1, 1);

    matchQuery.createdAt = {
      $gte: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    };

    const distribution = await Grievance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 },
          pending: {
            $sum: {
              $cond: [{ $eq: ['$status', GrievanceStatus.PENDING] }, 1, 0]
            }
          },
          resolved: {
            $sum: {
              $cond: [{ $eq: ['$status', GrievanceStatus.RESOLVED] }, 1, 0]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: distribution.map((entry) => ({
        hour: entry._id,
        count: entry.count,
        pending: entry.pending,
        resolved: entry.resolved
      }))
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch hourly analytics', error: error.message });
  }
};

export const category = async (req: Request, res: Response) => {
  try {
    const { companyId, departmentId } = req.query;
    const matchQuery = await getAnalyticsBaseQuery(req, companyId, departmentId);

    const distribution = await Grievance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $ifNull: ['$category', 'Uncategorized'] },
          count: { $sum: 1 },
          pending: {
            $sum: {
              $cond: [{ $eq: ['$status', GrievanceStatus.PENDING] }, 1, 0]
            }
          },
          resolved: {
            $sum: {
              $cond: [{ $eq: ['$status', GrievanceStatus.RESOLVED] }, 1, 0]
            }
          }
        }
      },
      { $sort: { count: -1, _id: 1 } }
    ]);

    res.json({
      success: true,
      data: distribution.map((entry) => ({
        category: entry._id,
        count: entry.count,
        pending: entry.pending,
        resolved: entry.resolved
      }))
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch category analytics', error: error.message });
  }
};
