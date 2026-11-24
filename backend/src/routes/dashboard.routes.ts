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

// SuperAdmin Meta WhatsApp Cost Calculator (Official Meta rates effective October 1, 2026, Free 1000 Service msgs/month, Company-wise cost)
router.get('/superadmin/meta-cost-calculator', authenticate, requireSuperAdminDashboard, async (req: Request, res: Response) => {
  try {
    // Meta pricing change effective date: October 1, 2026
    const META_OCTOBER_EFFECTIVE_DATE = new Date('2026-10-01T00:00:00.000Z');

    // 1. Official Meta 2024/2026 default rates (India INR)
    const serviceRate = req.query.serviceRate ? parseFloat(req.query.serviceRate as string) : 0.1150;
    const utilityRate = req.query.utilityRate ? parseFloat(req.query.utilityRate as string) : 0.1150;
    const authRate = req.query.authRate ? parseFloat(req.query.authRate as string) : 0.1150;
    const marketingRate = req.query.marketingRate ? parseFloat(req.query.marketingRate as string) : 0.8631;
    const baseFreeQuota = req.query.freeQuota !== undefined ? parseInt(req.query.freeQuota as string, 10) : 1000;
    const gstPct = req.query.gstRate !== undefined ? parseFloat(req.query.gstRate as string) : 18;
    const applyOnlySinceEffectiveDate = req.query.applyOnlySinceEffectiveDate !== 'false';

    // 2. Fetch companies & whatsapp configs & templates
    const companies = await Company.find({}).select('_id name companyId isActive').sort({ name: 1 }).lean();
    const waConfigs = await CompanyWhatsAppConfig.find({}).select('companyId phoneNumber displayPhoneNumber stats').lean();
    const configByCompany = new Map<string, any>();
    for (const cfg of waConfigs) {
      if (cfg.companyId) {
        configByCompany.set(String(cfg.companyId), cfg);
      }
    }

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
      if (parsedStart) {
        dateFilter.$gte = applyOnlySinceEffectiveDate && parsedStart < META_OCTOBER_EFFECTIVE_DATE
          ? META_OCTOBER_EFFECTIVE_DATE
          : parsedStart;
      } else if (applyOnlySinceEffectiveDate) {
        dateFilter.$gte = META_OCTOBER_EFFECTIVE_DATE;
      }
      if (parsedEnd) dateFilter.$lte = parsedEnd;
    } else if (period && period !== 'all') {
      if (period === 'daily') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        dateFilter.$gte = startOfToday;
      } else if (period === 'weekly') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        dateFilter.$gte = sevenDaysAgo;
      } else if (period === 'thisMonth' || period === 'monthly') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        dateFilter.$gte = startOfMonth;
      } else if (period === 'lastMonth' || period === 'october') {
        dateFilter.$gte = new Date(2026, 9, 1, 0, 0, 0, 0); // Oct 1, 2026
        dateFilter.$lte = new Date(2026, 9, 31, 23, 59, 59, 999); // Oct 31, 2026
      } else if (period === 'sinceOct') {
        dateFilter.$gte = META_OCTOBER_EFFECTIVE_DATE;
      } else if (period === 'quarterly') {
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        ninetyDaysAgo.setHours(0, 0, 0, 0);
        dateFilter.$gte = applyOnlySinceEffectiveDate && ninetyDaysAgo < META_OCTOBER_EFFECTIVE_DATE
          ? META_OCTOBER_EFFECTIVE_DATE
          : ninetyDaysAgo;
      } else if (period === 'yearly') {
        dateFilter.$gte = applyOnlySinceEffectiveDate ? META_OCTOBER_EFFECTIVE_DATE : new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      }
    } else {
      // Default: Strictly since October 1, 2026 when Meta pricing changes took effect
      dateFilter.$gte = META_OCTOBER_EFFECTIVE_DATE;
    }

    if (Object.keys(dateFilter).length > 0) {
      logQuery.timestamp = dateFilter;
    }

    const outgoingLogs = await AuditLog.find(logQuery).select('companyId details timestamp').lean();

    // Group logs per company AND per calendar month (YYYY-MM) for authentic Meta monthly cycle billing
    type MonthBucket = {
      utility: number;
      service: number;
      authentication: number;
      marketing: number;
      total: number;
    };

    type CompanyAgg = {
      utility: number;
      service: number;
      authentication: number;
      marketing: number;
      total: number;
      lastMessageAt?: Date | null;
      monthlyMap: Map<string, MonthBucket>;
    };

    const companyAggMap = new Map<string, CompanyAgg>();
    for (const comp of companies) {
      companyAggMap.set(String(comp._id), {
        utility: 0,
        service: 0,
        authentication: 0,
        marketing: 0,
        total: 0,
        lastMessageAt: null,
        monthlyMap: new Map<string, MonthBucket>()
      });
    }

    for (const log of outgoingLogs) {
      const cId = log.companyId ? String(log.companyId) : 'unknown';
      let compAgg = companyAggMap.get(cId);
      if (!compAgg) {
        compAgg = {
          utility: 0,
          service: 0,
          authentication: 0,
          marketing: 0,
          total: 0,
          lastMessageAt: null,
          monthlyMap: new Map<string, MonthBucket>()
        };
        companyAggMap.set(cId, compAgg);
      }

      const logTime = log.timestamp ? new Date(log.timestamp) : now;
      const monthKey = `${logTime.getFullYear()}-${String(logTime.getMonth() + 1).padStart(2, '0')}`;

      let monthBucket = compAgg.monthlyMap.get(monthKey);
      if (!monthBucket) {
        monthBucket = { utility: 0, service: 0, authentication: 0, marketing: 0, total: 0 };
        compAgg.monthlyMap.set(monthKey, monthBucket);
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
        compAgg.authentication += 1;
        monthBucket.authentication += 1;
      } else if (cat === 'MARKETING') {
        compAgg.marketing += 1;
        monthBucket.marketing += 1;
      } else if (cat === 'UTILITY') {
        compAgg.utility += 1;
        monthBucket.utility += 1;
      } else {
        compAgg.service += 1;
        monthBucket.service += 1;
      }

      compAgg.total += 1;
      monthBucket.total += 1;

      if (log.timestamp && (!compAgg.lastMessageAt || new Date(log.timestamp) > new Date(compAgg.lastMessageAt))) {
        compAgg.lastMessageAt = log.timestamp;
      }
    }

    let targetCompanies = companies;
    if (targetCompanyId && targetCompanyId !== 'all') {
      const filtered = companies.filter(
        (c) => String(c._id) === targetCompanyId || c.companyId === targetCompanyId
      );
      if (filtered.length > 0) targetCompanies = filtered;
    }

    // Determine number of distinct months in the view
    const allMonthsSet = new Set<string>();
    for (const compAgg of companyAggMap.values()) {
      for (const mKey of compAgg.monthlyMap.keys()) {
        allMonthsSet.add(mKey);
      }
    }
    const monthsFactor = Math.max(1, allMonthsSet.size);
    const effectiveFreeQuota = baseFreeQuota * monthsFactor;

    // Compute detailed cost per company applying Meta's 1000 free service messages PER CALENDAR MONTH
    const breakdown = targetCompanies.map((comp) => {
      const cId = String(comp._id);
      const agg = companyAggMap.get(cId) || {
        utility: 0,
        service: 0,
        authentication: 0,
        marketing: 0,
        total: 0,
        lastMessageAt: null,
        monthlyMap: new Map()
      };
      const cfg = configByCompany.get(cId);

      let total = agg.total;
      let service = agg.service;

      // Calculate monthly-accurate free service usage & billable units
      let totalFreeServiceUsed = 0;
      let totalBillableService = 0;
      let totalServiceCost = 0;
      let totalSavings = 0;

      if (agg.monthlyMap.size > 0) {
        for (const [, mb] of agg.monthlyMap.entries()) {
          const mFree = Math.min(mb.service, baseFreeQuota);
          const mBillable = Math.max(0, mb.service - mFree);
          const mCost = mBillable * serviceRate;
          const mSave = mFree * serviceRate;

          totalFreeServiceUsed += mFree;
          totalBillableService += mBillable;
          totalServiceCost += mCost;
          totalSavings += mSave;
        }
      } else {
        // Fallback for 0 volume
        totalFreeServiceUsed = 0;
        totalBillableService = 0;
        totalServiceCost = 0;
        totalSavings = 0;
      }

      const utilityCost = Number((agg.utility * utilityRate).toFixed(4));
      const authCost = Number((agg.authentication * authRate).toFixed(4));
      const marketingCost = Number((agg.marketing * marketingRate).toFixed(4));
      const serviceCost = Number(totalServiceCost.toFixed(4));
      const subtotalCost = Number((serviceCost + utilityCost + authCost + marketingCost).toFixed(2));
      const gstCost = Number(((subtotalCost * gstPct) / 100).toFixed(2));
      const totalCost = Number((subtotalCost + gstCost).toFixed(2));
      const savings = Number(totalSavings.toFixed(2));
      const effectiveCostPerMsg = total > 0 ? Number((totalCost / total).toFixed(4)) : 0;

      return {
        _id: comp._id,
        name: comp.name,
        companyId: comp.companyId,
        isActive: comp.isActive,
        phoneNumber: cfg?.displayPhoneNumber || cfg?.phoneNumber || null,
        utility: agg.utility,
        service: service,
        authentication: agg.authentication,
        marketing: agg.marketing,
        total: total,
        freeQuota: effectiveFreeQuota,
        freeServiceUsed: totalFreeServiceUsed,
        billableService: totalBillableService,
        serviceCost,
        utilityCost,
        authCost,
        marketingCost,
        subtotalCost,
        gstCost,
        totalCost,
        savings,
        effectiveCostPerMsg,
        monthsIncluded: Array.from(agg.monthlyMap.keys()).sort(),
        lastMessageAt: agg.lastMessageAt || null
      };
    });

    const finalTotals = breakdown.reduce(
      (acc, c) => ({
        utility: acc.utility + c.utility,
        service: acc.service + c.service,
        authentication: acc.authentication + c.authentication,
        marketing: acc.marketing + c.marketing,
        total: acc.total + c.total,
        freeServiceUsed: acc.freeServiceUsed + c.freeServiceUsed,
        billableService: acc.billableService + c.billableService,
        serviceCost: Number((acc.serviceCost + c.serviceCost).toFixed(2)),
        utilityCost: Number((acc.utilityCost + c.utilityCost).toFixed(2)),
        authCost: Number((acc.authCost + c.authCost).toFixed(2)),
        marketingCost: Number((acc.marketingCost + c.marketingCost).toFixed(2)),
        subtotalCost: Number((acc.subtotalCost + c.subtotalCost).toFixed(2)),
        gstCost: Number((acc.gstCost + c.gstCost).toFixed(2)),
        totalCost: Number((acc.totalCost + c.totalCost).toFixed(2)),
        savings: Number((acc.savings + c.savings).toFixed(2))
      }),
      {
        utility: 0,
        service: 0,
        authentication: 0,
        marketing: 0,
        total: 0,
        freeServiceUsed: 0,
        billableService: 0,
        serviceCost: 0,
        utilityCost: 0,
        authCost: 0,
        marketingCost: 0,
        subtotalCost: 0,
        gstCost: 0,
        totalCost: 0,
        savings: 0
      }
    );

    return res.json({
      success: true,
      data: {
        rates: {
          serviceRate,
          utilityRate,
          authRate,
          marketingRate,
          freeQuota: effectiveFreeQuota,
          baseMonthlyQuota: baseFreeQuota,
          monthsFactor,
          effectiveSince: '2026-10-01',
          gstPct,
          currency: 'INR',
          currencySymbol: '₹'
        },
        totals: finalTotals,
        companies: breakdown
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate meta message costs',
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
