import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import User from '../models/User';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { requireDatabaseConnection } from '../middleware/dbConnection';
import { Permission, UserRole } from '../config/constants';


const router = express.Router();

// All routes require database connection and authentication
router.use(requireDatabaseConnection);
router.use(authenticate);

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

// @route   GET /api/audit
// @desc    Get audit logs (scoped by role with rich actor, department & subdepartment metadata)
// @access  Private
router.get('/', requirePermission(Permission.VIEW_AUDIT_LOGS), async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 50, action, resource, userId, companyId, startDate, endDate } = req.query;
    const currentUser = req.user!;

    const query: any = {};

    // Scope based on user role
    if (!currentUser.isSuperAdmin) {
      // Non-SuperAdmin users can only see logs for their company
      query.companyId = currentUser.companyId;
    } else if (companyId) {
      // SuperAdmin can filter by company
      query.companyId = companyId;
    }

    // Apply filters
    if (action) query.action = action;
    if (resource) query.resource = resource;
    if (userId) query.userId = userId;

    // Date range filter
    if (startDate || endDate) {
      const parsedStart = parseFlexibleDate(startDate, false);
      const parsedEnd = parseFlexibleDate(endDate, true);
      const dateFilter: any = {};
      if (parsedStart) dateFilter.$gte = parsedStart;
      if (parsedEnd) dateFilter.$lte = parsedEnd;
      if (Object.keys(dateFilter).length > 0) {
        query.timestamp = dateFilter;
      }
    }

    const logs = await AuditLog.find(query)
      .populate({
        path: 'userId',
        select: 'firstName lastName email phone designations role level isSuperAdmin departmentIds customRoleId',
        populate: [
          {
            path: 'departmentIds',
            select: 'name departmentId parentDepartmentId',
            populate: {
              path: 'parentDepartmentId',
              select: 'name departmentId'
            }
          },
          {
            path: 'customRoleId',
            select: 'name'
          }
        ]
      })
      .populate({
        path: 'departmentId',
        select: 'name departmentId parentDepartmentId',
        populate: {
          path: 'parentDepartmentId',
          select: 'name departmentId'
        }
      })
      .populate('companyId', 'name companyId')
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .sort({ timestamp: -1 })
      .lean();

    // Collect recipient phone numbers for WhatsApp messages to resolve recipient officer
    const phonesToFind = new Set<string>();
    for (const log of logs) {
      if (log.action === 'WHATSAPP_MSG' && log.resourceId) {
        const clean = String(log.resourceId).replace(/\D/g, '');
        if (clean) {
          phonesToFind.add(clean);
          if (clean.startsWith('91') && clean.length === 12) {
            phonesToFind.add(clean.slice(2));
          }
        }
      }
    }

    const officerByPhone = new Map<string, any>();
    if (phonesToFind.size > 0) {
      const officers = await User.find({ phone: { $in: Array.from(phonesToFind) } })
        .populate({
          path: 'departmentIds',
          select: 'name departmentId parentDepartmentId',
          populate: {
            path: 'parentDepartmentId',
            select: 'name departmentId'
          }
        })
        .populate('companyId', 'name companyId')
        .select('firstName lastName email phone designations role departmentIds companyId')
        .lean();

      for (const off of officers) {
        const raw = String(off.phone || '').replace(/\D/g, '');
        officerByPhone.set(raw, off);
        if (raw.startsWith('91') && raw.length === 12) {
          officerByPhone.set(raw.slice(2), off);
        }
      }
    }

    // Enrich logs with computed actorDetails and recipientDetails
    const enrichedLogs = logs.map((log: any) => {
      let actorDetails: any = null;
      let recipientDetails: any = null;

      // 1. Resolve Actor Details
      if (log.userId && typeof log.userId === 'object') {
        const u = log.userId;
        let deptName: string | null = null;
        let subDeptName: string | null = null;

        // Check user's assigned departments
        if (Array.isArray(u.departmentIds) && u.departmentIds.length > 0) {
          const d = u.departmentIds[0];
          if (d && typeof d === 'object') {
            if (d.parentDepartmentId && typeof d.parentDepartmentId === 'object') {
              deptName = d.parentDepartmentId.name;
              subDeptName = d.name;
            } else {
              deptName = d.name;
            }
          }
        }

        // Fallback to log's direct departmentId if user has no department assigned
        if (!deptName && log.departmentId && typeof log.departmentId === 'object') {
          const d = log.departmentId;
          if (d.parentDepartmentId && typeof d.parentDepartmentId === 'object') {
            deptName = d.parentDepartmentId.name;
            subDeptName = d.name;
          } else {
            deptName = d.name;
          }
        }

        const roleDisplay =
          u.customRoleId?.name ||
          (u.isSuperAdmin ? 'Platform MasterAdmin' : u.role ? String(u.role).replace(/_/g, ' ') : 'Admin');

        actorDetails = {
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'System User',
          email: u.email || null,
          phone: u.phone || null,
          role: roleDisplay,
          designation: (Array.isArray(u.designations) && u.designations[0]) || u.designation || null,
          department: deptName || (u.isSuperAdmin ? 'Platform Administration' : 'General Administration'),
          subDepartment: subDeptName || null,
          organization: log.companyId?.name || (u.isSuperAdmin ? 'Platform Global' : null),
          isSystem: false
        };
      } else {
        // System / Automated action
        actorDetails = {
          name: log.action === 'WHATSAPP_MSG' ? 'Platform Bot / Auto Dispatcher' : 'System Automated Service',
          email: null,
          phone: null,
          role: 'Automated Bot',
          designation: 'System Engine',
          department: 'Platform Core',
          subDepartment: null,
          organization: log.companyId?.name || 'Platform System',
          isSystem: true
        };
      }

      // 2. Resolve Recipient Details (for WhatsApp messages / Outgoing events)
      if (log.action === 'WHATSAPP_MSG' && log.resourceId) {
        const clean = String(log.resourceId).replace(/\D/g, '');
        const off = officerByPhone.get(clean) || (clean.startsWith('91') ? officerByPhone.get(clean.slice(2)) : officerByPhone.get(`91${clean}`));
        if (off) {
          let offDept: string | null = null;
          let offSubDept: string | null = null;
          if (Array.isArray(off.departmentIds) && off.departmentIds.length > 0) {
            const d = off.departmentIds[0];
            if (d && typeof d === 'object') {
              if (d.parentDepartmentId && typeof d.parentDepartmentId === 'object') {
                offDept = d.parentDepartmentId.name;
                offSubDept = d.name;
              } else {
                offDept = d.name;
              }
            }
          }
          recipientDetails = {
            name: `${off.firstName || ''} ${off.lastName || ''}`.trim(),
            phone: off.phone,
            designation: (Array.isArray(off.designations) && off.designations[0]) || 'Department Officer',
            department: offDept || 'Department Officer',
            subDepartment: offSubDept || null,
            organization: off.companyId?.name || log.companyId?.name || null
          };
        }
      }

      return {
        ...log,
        actorDetails,
        recipientDetails
      };
    });

    const total = await AuditLog.countDocuments(query);

    res.json({
      success: true,
      data: {
        logs: enrichedLogs,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs',
      error: error.message
    });
  }
});

// @route   GET /api/audit/stats
// @desc    Get audit log statistics
// @access  Private (SuperAdmin only)
router.get('/stats', requirePermission(Permission.VIEW_AUDIT_LOGS), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const { companyId, startDate, endDate } = req.query;

    const matchQuery: any = {};

    // Enforce company-level isolation for all non-superadmin users.
    // They can only access statistics for their own company regardless of query params.
    if (!currentUser.isSuperAdmin) {
      matchQuery.companyId = currentUser.companyId;
    } else if (companyId) {
      matchQuery.companyId = new mongoose.Types.ObjectId(companyId as string);
    }

    if (startDate || endDate) {
      matchQuery.timestamp = {};
      if (startDate) matchQuery.timestamp.$gte = new Date(startDate as string);
      if (endDate) matchQuery.timestamp.$lte = new Date(endDate as string);
    }

    const stats = await AuditLog.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const resourceStats = await AuditLog.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$resource',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        actionStats: stats,
        resourceStats
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit statistics',
      error: error.message
    });
  }
});

export default router;
