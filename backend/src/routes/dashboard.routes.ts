import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireDatabaseConnection } from '../middleware/dbConnection';
import { 
  requireSuperAdminDashboard, 
  requireCompanyAdminDashboard, 
  requireDepartmentAdminDashboard,
  canAccessAnyDashboard 
} from '../middleware/dashboardAccess';
import Company from '../models/Company';
import User from '../models/User';
import Department from '../models/Department';
import AuditLog from '../models/AuditLog';
import CompanyWhatsAppConfig from '../models/CompanyWhatsAppConfig';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import { UserRole } from '../config/constants';

const router = express.Router();

// All routes require database connection
router.use(requireDatabaseConnection);

// SuperAdmin Dashboard - Only SuperAdmin can access
router.get('/superadmin', authenticate, requireSuperAdminDashboard, async (req: Request, res: Response) => {
  try {
    const stats = {
      companies: await Company.countDocuments({}),
      users: await User.countDocuments({}),
      departments: await Department.countDocuments({}),
      activeCompanies: await Company.countDocuments({ isActive: true }),
      activeUsers: await User.countDocuments({ isActive: true })
    };

    return res.json({
      success: true,
      data: {
        dashboard: 'superadmin',
        stats,
        user: {
          id: req.user?._id,
          userId: req.user?.userId,
          firstName: req.user?.firstName,
          lastName: req.user?.lastName,
          email: req.user?.email,
          role: req.user?.isSuperAdmin ? UserRole.SUPER_ADMIN : 'CUSTOM'
        }
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load SuperAdmin dashboard',
      error: error.message
    });
  }
});

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

// SuperAdmin Message Analytics (Utility, Service, Authentication breakdown per company)
router.get('/superadmin/message-analytics', authenticate, requireSuperAdminDashboard, async (req: Request, res: Response) => {
  try {
    // 1. Get all companies
    const companies = await Company.find({}).select('_id name companyId isActive').sort({ name: 1 }).lean();
    
    // 2. Get all WhatsApp configs for phone numbers and fallback stats
    const waConfigs = await CompanyWhatsAppConfig.find({}).select('companyId phoneNumber displayPhoneNumber stats').lean();
    const configByCompany = new Map<string, any>();
    for (const cfg of waConfigs) {
      if (cfg.companyId) {
        configByCompany.set(String(cfg.companyId), cfg);
      }
    }

    // 3. Get WhatsApp templates to map template categories
    const templates = await WhatsAppTemplate.find({}).select('name category companyId').lean();
    const templateCategoryMap = new Map<string, string>();
    for (const tmpl of templates) {
      if (tmpl.name) {
        templateCategoryMap.set(tmpl.name.toLowerCase().trim(), tmpl.category || 'UTILITY');
        if (tmpl.companyId) {
          templateCategoryMap.set(`${String(tmpl.companyId)}:${tmpl.name.toLowerCase().trim()}`, tmpl.category || 'UTILITY');
        }
      }
    }

    const { period, startDate, endDate, companyId: targetCompanyId } = req.query as {
      period?: string;
      startDate?: string;
      endDate?: string;
      companyId?: string;
    };

    // Date range filtering
    const logQuery: any = {
      action: 'WHATSAPP_MSG',
      resource: 'OUTGOING'
    };

    if (targetCompanyId && targetCompanyId !== 'all') {
      // Find company match by _id or string ID
      const matchingComp = companies.find(c => String(c._id) === targetCompanyId || c.companyId === targetCompanyId);
      if (matchingComp) {
        logQuery.companyId = matchingComp._id;
      } else {
        logQuery.companyId = targetCompanyId;
      }
    }

    const dateFilter: { $gte?: Date; $lte?: Date } = {};
    const now = new Date();

    if (startDate || endDate) {
      const parsedStart = parseFlexibleDate(startDate, false);
      const parsedEnd = parseFlexibleDate(endDate, true);
      if (parsedStart) dateFilter.$gte = parsedStart;
      if (parsedEnd) dateFilter.$lte = parsedEnd;
    } else if (period && period !== 'all') {
      if (period === 'daily') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        dateFilter.$gte = startOfToday;
      } else if (period === 'weekly') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        dateFilter.$gte = sevenDaysAgo;
      } else if (period === 'monthly') {
        // Start of current month (falls back to last 30 days if current month start is future or fresh)
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        dateFilter.$gte = startOfMonth;
      } else if (period === 'quarterly') {
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        ninetyDaysAgo.setHours(0, 0, 0, 0);
        dateFilter.$gte = ninetyDaysAgo;
      } else if (period === 'yearly') {
        const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        dateFilter.$gte = startOfYear;
      }
    }

    if (Object.keys(dateFilter).length > 0) {
      logQuery.timestamp = dateFilter;
    }

    // 4. Fetch all outgoing WhatsApp audit logs with applied filters
    const outgoingLogs = await AuditLog.find(logQuery)
      .select('companyId details timestamp')
      .lean();

    // 5. Aggregate per company
    type CategoryCounts = {
      utility: number;
      service: number;
      authentication: number;
      marketing: number;
      total: number;
      lastMessageAt?: Date | null;
    };

    const companyStatsMap = new Map<string, CategoryCounts>();

    for (const comp of companies) {
      companyStatsMap.set(String(comp._id), {
        utility: 0,
        service: 0,
        authentication: 0,
        marketing: 0,
        total: 0,
        lastMessageAt: null
      });
    }

    for (const log of outgoingLogs) {
      const cId = log.companyId ? String(log.companyId) : 'unknown';
      let stats = companyStatsMap.get(cId);
      if (!stats) {
        stats = {
          utility: 0,
          service: 0,
          authentication: 0,
          marketing: 0,
          total: 0,
          lastMessageAt: null
        };
        companyStatsMap.set(cId, stats);
      }

      const details = log.details || {};
      let cat = (details.category || '').toUpperCase();

      if (!cat) {
        if (details.type === 'template') {
          const tmplName = (details.templateName || '').toLowerCase().trim();
          const lookupKey = `${cId}:${tmplName}`;
          if (templateCategoryMap.has(lookupKey)) {
            cat = templateCategoryMap.get(lookupKey)!;
          } else if (templateCategoryMap.has(tmplName)) {
            cat = templateCategoryMap.get(tmplName)!;
          } else if (tmplName.includes('otp') || tmplName.includes('auth') || tmplName.includes('verify') || tmplName.includes('password')) {
            cat = 'AUTHENTICATION';
          } else {
            cat = 'UTILITY';
          }
        } else {
          cat = 'SERVICE';
        }
      }

      if (cat === 'AUTHENTICATION') {
        stats.authentication += 1;
      } else if (cat === 'MARKETING') {
        stats.marketing += 1;
      } else if (cat === 'UTILITY') {
        stats.utility += 1;
      } else {
        stats.service += 1;
      }

      stats.total += 1;

      if (log.timestamp && (!stats.lastMessageAt || new Date(log.timestamp) > new Date(stats.lastMessageAt))) {
        stats.lastMessageAt = log.timestamp;
      }
    }

    // Determine target companies list (scoped if companyId filter provided)
    let targetCompanies = companies;
    if (targetCompanyId && targetCompanyId !== 'all') {
      const filtered = companies.filter(
        (c) => String(c._id) === targetCompanyId || c.companyId === targetCompanyId
      );
      if (filtered.length > 0) {
        targetCompanies = filtered;
      }
    }

    // Build company breakdown array
    const breakdown = targetCompanies.map((comp) => {
      const cId = String(comp._id);
      const s = companyStatsMap.get(cId) || {
        utility: 0,
        service: 0,
        authentication: 0,
        marketing: 0,
        total: 0,
        lastMessageAt: null
      };
      const cfg = configByCompany.get(cId);

      let total = s.total;
      let service = s.service;
      const isFiltered = Boolean((period && period !== 'all') || startDate || endDate);
      if (!isFiltered && cfg?.stats?.totalMessagesSent && cfg.stats.totalMessagesSent > total) {
        const diff = cfg.stats.totalMessagesSent - total;
        service += diff;
        total = cfg.stats.totalMessagesSent;
      }

      return {
        _id: comp._id,
        name: comp.name,
        companyId: comp.companyId,
        isActive: comp.isActive,
        phoneNumber: cfg?.displayPhoneNumber || cfg?.phoneNumber || null,
        utility: s.utility,
        service: service,
        authentication: s.authentication,
        marketing: s.marketing,
        total: total,
        lastMessageAt: s.lastMessageAt || cfg?.stats?.lastMessageAt || null
      };
    });

    // Recompute platformTotals directly from the calculated breakdown for flawless consistency
    const finalTotals = breakdown.reduce(
      (acc, c) => ({
        utility: acc.utility + c.utility,
        service: acc.service + c.service,
        authentication: acc.authentication + c.authentication,
        marketing: acc.marketing + c.marketing,
        total: acc.total + c.total
      }),
      { utility: 0, service: 0, authentication: 0, marketing: 0, total: 0 }
    );

    return res.json({
      success: true,
      data: {
        totals: finalTotals,
        companies: breakdown
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load message analytics',
      error: error.message
    });
  }
});

// Company Admin Dashboard - SuperAdmin and CompanyAdmin can access
router.get('/company-admin', authenticate, requireCompanyAdminDashboard, async (req: Request, res: Response) => {
  try {
    let companyFilter = {};
    if (!req.user?.isSuperAdmin) {
      companyFilter = { companyId: req.user?.companyId };
    }

    const stats = {
      users: await User.countDocuments({ ...companyFilter }),
      departments: await Department.countDocuments({ ...companyFilter }),
      activeUsers: await User.countDocuments({ ...companyFilter, isActive: true })
    };

    // Get company info if not SuperAdmin
    let company = null;
    if (!req.user?.isSuperAdmin && req.user?.companyId) {
      company = await Company.findById(req.user.companyId);
    }

    return res.json({
      success: true,
      data: {
        dashboard: 'company-admin',
        stats,
        company,
        user: {
          id: req.user?._id,
          userId: req.user?.userId,
          firstName: req.user?.firstName,
          lastName: req.user?.lastName,
          email: req.user?.email,
          role: req.user?.isSuperAdmin ? UserRole.SUPER_ADMIN : 'CUSTOM',
          companyId: req.user?.companyId
        }
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load CompanyAdmin dashboard',
      error: error.message
    });
  }
});

// Department Admin Dashboard - SuperAdmin, CompanyAdmin, and DepartmentAdmin can access
router.get('/department-admin', authenticate, requireDepartmentAdminDashboard, async (req: Request, res: Response) => {
  try {
    let filter: any = {};
    if (req.user?.isSuperAdmin) {
       // No mandatory filter for SuperAdmin, but can filter by query params if needed
    } else if (req.user?.departmentId || (req.user?.departmentIds && req.user.departmentIds.length > 0)) {
      // Scoped to specific department(s)
      const depts = (req.user.departmentIds && req.user.departmentIds.length > 0)
        ? req.user.departmentIds
        : [req.user.departmentId];
      filter = { departmentId: { $in: depts } };
    } else if (req.user?.companyId) {
      // Scoped to whole company
      filter = { companyId: req.user?.companyId };
    }

    const stats = {
      users: await User.countDocuments({ ...filter }),
      activeUsers: await User.countDocuments({ ...filter, isActive: true })
    };

    // Get department info if restricted to a department
    let department = null;
    if (req.user?.departmentId) {
      department = await Department.findById(req.user.departmentId);
    }

    return res.json({
      success: true,
      data: {
        dashboard: 'department-admin',
        stats,
        department,
        user: {
          id: req.user?._id,
          userId: req.user?.userId,
          firstName: req.user?.firstName,
          lastName: req.user?.lastName,
          email: req.user?.email,
          role: req.user?.isSuperAdmin ? UserRole.SUPER_ADMIN : 'CUSTOM',
          companyId: req.user?.companyId,
          departmentId: req.user?.departmentId
        }
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load DepartmentAdmin dashboard',
      error: error.message
    });
  }
});

// Universal Dashboard Access - SuperAdmin can access any dashboard without auth
router.get('/any/:dashboardType', canAccessAnyDashboard, async (req: Request, res: Response) => {
  try {
    const { dashboardType } = req.params;
    
    // Validate dashboard type
    const validDashboards = ['superadmin', 'company-admin', 'department-admin'];
    if (!validDashboards.includes(dashboardType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dashboard type'
      });
    }

    // Get comprehensive stats for SuperAdmin
    const stats = {
      companies: await Company.countDocuments({}),
      users: await User.countDocuments({}),
      departments: await Department.countDocuments({}),
      activeCompanies: await Company.countDocuments({ isActive: true }),
      activeUsers: await User.countDocuments({ isActive: true })
    };

    return res.json({
      success: true,
      data: {
        dashboard: dashboardType,
        stats,
        user: {
          id: req.user?._id,
          userId: req.user?.userId,
          firstName: req.user?.firstName,
          lastName: req.user?.lastName,
          email: req.user?.email,
          role: req.user?.isSuperAdmin ? UserRole.SUPER_ADMIN : 'CUSTOM'
        },
        accessLevel: req.user?.isSuperAdmin ? 'full' : 'limited'
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load dashboard',
      error: error.message
    });
  }
});

export default router;
