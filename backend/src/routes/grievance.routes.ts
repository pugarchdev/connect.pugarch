import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import Grievance from '../models/Grievance';
import Department from '../models/Department';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { requireDatabaseConnection } from '../middleware/dbConnection';
import { logUserAction } from '../utils/auditLogger';
import { findOptimalAdmin } from '../utils/userUtils';
import { buildNameSearchQuery, escapeRegExp } from '../utils/searchUtils';
import { AuditAction, Permission, UserRole, GrievanceStatus } from '../config/constants';
import { logger } from '../config/logger';
import { enforceWhatsAppGrievanceCompliance } from '../middleware/whatsappGrievanceCompliance';
import CitizenProfile from '../models/CitizenProfile';
import Company from '../models/Company';
import CompanyWhatsAppConfig from '../models/CompanyWhatsAppConfig';
import { 
  triggerGrievanceEvent,
  triggerAdminAssignmentNotification,
  triggerGrievanceNotifications,
  formatTemplateDate,
  getAdminRecipients
} from '../services/grievanceTemplateTriggerService';
import { sendMediaSequentially } from '../services/whatsappService';
import { getSignedUrl } from '../services/gcsService';
import { normalizePhoneNumber } from '../utils/phoneUtils';
import { sanitizeGrievanceDetails } from '../utils/sanitize';
import { getHierarchicalDepartmentAdmins } from '../services/notificationService';
import { notifyCompanyAdmins } from '../services/inAppNotificationService';

const router = express.Router();
const JHARSUGUDA_COMPANY_ID = process.env.JHARSUGUDA_COMPANY_ID || '69ad4c6eb1ad8e405e6c0858';

// All routes require database connection and authentication
router.use(requireDatabaseConnection);
router.use(authenticate);

// @route   GET /api/grievances
// @desc    Get all grievances (scoped by role)
// @access  Private
router.get('/', requirePermission(Permission.READ_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, status, companyId, departmentId, assignedTo, search, slaStatus } = req.query;
    const currentUser = req.user!;
    const targetCompanyId = currentUser.isSuperAdmin ? companyId : currentUser.companyId;

    if (!targetCompanyId && !currentUser.isSuperAdmin) {
       return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const query: any = {};
    if (targetCompanyId) {
      query.companyId = targetCompanyId;
      if (currentUser.isSuperAdmin) {
        if (departmentId) query.departmentId = departmentId;
      } else if (currentUser.departmentId || (currentUser.departmentIds && currentUser.departmentIds.length > 0)) {
        const canAssign = req.checkPermission(Permission.ASSIGN_GRIEVANCE);
        if (!canAssign) {
          query.assignedTo = currentUser._id;
        } else {
          // Hierarchical scoping: include all sub-departments
          const { getDepartmentHierarchyIds } = await import('../utils/departmentUtils');
          const rootDeptIds = currentUser.departmentIds && currentUser.departmentIds.length > 0 
            ? currentUser.departmentIds.map(id => id.toString())
            : currentUser.departmentId ? [currentUser.departmentId.toString()] : [];
          const deptIds = await getDepartmentHierarchyIds(rootDeptIds);
          query.$or = [
            { departmentId: { $in: deptIds } },
            { subDepartmentId: { $in: deptIds } },
            { assignedTo: currentUser._id }
          ];
        }

      } else if (!currentUser.departmentId && status === GrievanceStatus.REVERTED) {
          query.status = GrievanceStatus.REVERTED;
          query.departmentId = null;
      }
    } else if (currentUser.isSuperAdmin) {
      // 🛡️ SECURITY: Super Admin without companyId should see nothing in grievance list
      return res.json({ 
        success: true, 
        data: { 
          grievances: [], 
          pagination: { page: 1, limit: Number(limit), total: 0, pages: 0 } 
        } 
      });
    } else {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // 🛠️ Status Filtering & Default Scoping
    if (status && status !== 'ALL') {
      // Support comma-separated status lists (e.g. status=PENDING,ASSIGNED)
      if (typeof status === 'string' && status.includes(',')) {
        query.status = { $in: status.split(',').map(s => s.trim()) };
      } else if (status === GrievanceStatus.PENDING) {
        // 🔄 Strictly filter by PENDING to match dashboard counts
        query.status = GrievanceStatus.PENDING;
      } else {
        query.status = status;
      }
    } else if (!status && !search && !departmentId && !assignedTo) {
      // 🛡️ DEFAULT VIEW: If no status, search, or metadata filters are applied,
      // exclude RESOLVED and REJECTED to keep the main list actionable.
      query.status = { $nin: [GrievanceStatus.RESOLVED, GrievanceStatus.REJECTED] };
    }
    // Note: If status === 'ALL', we skip both blocks and don't add status to query,
    // which effectively shows everything.
    if (departmentId) {
      const { getDepartmentHierarchyIds } = await import('../utils/departmentUtils');
      const deptIds = await getDepartmentHierarchyIds(departmentId as string);
      const deptFilter = [
        { departmentId: { $in: deptIds } },
        { subDepartmentId: { $in: deptIds } }
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: deptFilter }];
        delete query.$or;
      } else {
        query.$or = deptFilter;
      }
    }
    if (assignedTo) {
      if (assignedTo === 'NONE') query.assignedTo = null;
      else if (assignedTo === 'ANY') query.assignedTo = { $ne: null };
      else query.assignedTo = assignedTo;
    }

    if (slaStatus) {
      const activeStatuses = [
        GrievanceStatus.PENDING,
        GrievanceStatus.ASSIGNED,
        GrievanceStatus.IN_PROGRESS,
        GrievanceStatus.REVERTED,
        'OPEN'
      ];
      const completedStatuses = [
        GrievanceStatus.RESOLVED,
        GrievanceStatus.REJECTED,
        'CLOSED'
      ];

      if (slaStatus === "COMPLETED") {
        // Filter for completed items
        if (query.status) {
          if (typeof query.status === 'string') {
            if (!completedStatuses.includes(query.status as any)) {
              query.status = '__NONE__';
            }
          } else if (query.status.$in) {
            query.status.$in = query.status.$in.filter((s: any) => completedStatuses.includes(s));
            if (query.status.$in.length === 0) query.status = '__NONE__';
          }
        } else {
          query.status = { $in: completedStatuses };
        }
      } else {
        // Filter for active items (OVERDUE or ON_TRACK)
        if (query.status) {
          if (typeof query.status === 'string') {
            if (!activeStatuses.includes(query.status as any)) {
              query.status = '__NONE__';
            }
          } else if (query.status.$in) {
            query.status.$in = query.status.$in.filter((s: any) => activeStatuses.includes(s));
            if (query.status.$in.length === 0) query.status = '__NONE__';
          }
        } else {
          query.status = { $in: activeStatuses };
        }

        // ⏱️ Dynamic SLA calculation using $expr
        const slaExpr = {
          $gt: [
            { $subtract: [new Date(), "$createdAt"] },
            { $multiply: [{ $ifNull: ["$slaHours", 120] }, 60, 60, 1000] }
          ]
        };

        if (slaStatus === "OVERDUE") {
          query.$expr = slaExpr;
        } else if (slaStatus === "ON_TRACK") {
          query.$expr = { $not: slaExpr };
        }
      }
    }

    // 🔍 SEARCH LOGIC
    if (search) {
      const escapedSearch = escapeRegExp(search as string);
      const searchCriteria: any[] = [
        { grievanceId: { $regex: escapedSearch, $options: 'i' } },
        { citizenPhone: { $regex: escapedSearch, $options: 'i' } },
        { citizenWhatsApp: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } },
        { category: { $regex: escapedSearch, $options: 'i' } },
        ...buildNameSearchQuery(search as string, 'citizenName', 'citizenName')
      ];

      // Relational Search: Department Name
      const matchingDepts = await Department.find({
        companyId: targetCompanyId || { $exists: true },
        name: { $regex: escapedSearch, $options: 'i' }
      }).select('_id');
      if (matchingDepts.length > 0) {
        const deptIds = matchingDepts.map(d => d._id);
        searchCriteria.push({ departmentId: { $in: deptIds } });
        searchCriteria.push({ subDepartmentId: { $in: deptIds } });
      }

      // Relational Search: Assigned Officer Name
      const matchingUsers = await User.find({
        companyId: targetCompanyId || { $exists: true },
        $or: buildNameSearchQuery(search as string, 'firstName', 'lastName')
      }).select('_id');
      if (matchingUsers.length > 0) {
        searchCriteria.push({ assignedTo: { $in: matchingUsers.map(u => u._id) } });
      }

      if (query.$or) {
          const existingOr = query.$or;
          delete query.$or;
          query.$and = (query.$and || []).concat([{ $or: existingOr }, { $or: searchCriteria }]);
      } else if (query.$and) {
          query.$and.push({ $or: searchCriteria });
      } else {
          query.$or = searchCriteria;
      }
    }

    const grievances = await Grievance.find(query)
      .select('-statusHistory -media')
      .populate('companyId', 'name companyId')
      .populate('departmentId', 'name departmentId')
      .populate('subDepartmentId', 'name departmentId')
      .populate('assignedTo', 'firstName lastName email designation')
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .sort({ createdAt: -1 });

    const total = await Grievance.countDocuments(query);

    res.json({
      success: true,
      data: {
        grievances,
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
      message: 'Failed to fetch grievances',
      error: error.message
    });
  }
});

// @route   POST /api/grievances
// @desc    Create new grievance (usually from WhatsApp webhook)
// @access  Private
router.post('/', enforceWhatsAppGrievanceCompliance, async (req: Request, res: Response) => {
  try {
    const {
      companyId,
      departmentId,
      subDepartmentId,
      citizenName,
      citizenPhone,
      citizenWhatsApp,
      description,
      category,
      location,
      media
    } = req.body;

    // Validation
    if (!companyId || !citizenName || !citizenPhone || !description) {
      res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
      return;
    }

    const safeDescription = sanitizeGrievanceDetails(description);

    // 🏥 Resolve real-time department names for accurate categorization
    let resolvedCategory = category;
    if (departmentId && mongoose.Types.ObjectId.isValid(departmentId)) {
      const dept = await Department.findById(departmentId).select('name');
      if (dept) resolvedCategory = dept.name;
    }

    let resolvedSubDeptName = 'N/A';
    if (subDepartmentId && mongoose.Types.ObjectId.isValid(subDepartmentId)) {
      const subDept = await Department.findById(subDepartmentId).select('name');
      if (subDept) resolvedSubDeptName = subDept.name;
    }

    // 🕒 Capture Company Default SLA at creation
    const company = await Company.findById(companyId);
    const slaHours = company?.slaSettings?.defaultSlaHours || 120;

    const grievance = await Grievance.create({
      companyId,
      departmentId,
      subDepartmentId,
      citizenName,
      citizenPhone,
      phone_number: citizenPhone,
      citizenWhatsApp: citizenWhatsApp || citizenPhone,
      description: safeDescription,
      message: safeDescription,
      category: resolvedCategory || 'N/A',
      location,
      media: media || [],
      status: GrievanceStatus.PENDING,
      slaHours, // Store the captured default
      admin_consent: false
    });

    await CitizenProfile.updateOne(
      { companyId, phone_number: citizenPhone },
      {
        $set: {
          lastGrievanceDate: new Date(),
          phoneNumber: citizenPhone,
          name: citizenName
        }
      },
      { upsert: true }
    );

    // ✅ AUTO-ASSIGNMENT (Designated Officer / Dept Admin)
    const { getHierarchicalDepartmentAdmins, notifyUserOnAssignment, notifyDepartmentAdminOnCreation } = await import('../services/notificationService');
    const targetDeptId = (grievance as any).subDepartmentId || departmentId;
    
    let targetAdmin = null;

    // 1. First priority: Check if the department has a designated head/contact person
    if (targetDeptId) {
      const dept = await Department.findById(targetDeptId).select('contactUserId');
      if (dept && dept.contactUserId) {
        targetAdmin = await User.findById(dept.contactUserId).populate('customRoleId');
      }
    }

    // 2. Second priority: Hierarchical lookup if no designated head was found
    if (!targetAdmin) {
      const potentialAdmins = await getHierarchicalDepartmentAdmins(targetDeptId);
      targetAdmin = findOptimalAdmin(potentialAdmins);
    }
    
    // 3. Fallback: Assign to Company Admin (Collector/DM) if no department admin found
    if (!targetAdmin) {
      const companyAdmins = await User.find({ 
        companyId, 
        $or: [
          { role: UserRole.COMPANY_ADMIN },
          { level: 1 }
        ]
      }).sort({ createdAt: 1 }).limit(1);
      
      if (companyAdmins.length > 0) {
        targetAdmin = companyAdmins[0];
      }
    }
    
    if (targetAdmin) {
      grievance.assignedTo = targetAdmin._id;
      grievance.status = GrievanceStatus.PENDING;
      
      // ✅ SLA handling is now encapsulated in the model's pre-save hook 
      // ensuring it uses the company's default settings.
      await grievance.save();
      console.log(`🎯 Auto-assigned portal grievance ${grievance.grievanceId} to admin: ${targetAdmin.email || targetAdmin._id}`);
    } else {
      // Emergency fallback: If absolutely no admin found (should not happen in valid company)
      // we still need an owner. For now, log error.
      console.error(`❌ Critical: No admin found for company ${companyId} to assign grievance ${grievance.grievanceId}`);
    }

    const sanitizedMedia = Array.isArray(media)
      ? media
          .filter((item: any) => item?.url)
          .map((item: any) => ({
            url: String(item.url),
            type: item.type === 'video' || item.type === 'document' ? item.type : 'image',
            caption: item.caption ? String(item.caption) : undefined,
            filename: item.filename ? String(item.filename) : undefined
          }))
      : [];




    // ✅ Notify Admins and Citizen about the new grievance creation
    const notificationPayload = {
      type: 'grievance' as const,
      action: 'created' as const,
      grievance: grievance,
      grievanceId: grievance.grievanceId,
      citizenName: grievance.citizenName,
      citizenPhone: grievance.citizenPhone,
      citizenWhatsApp: grievance.citizenWhatsApp,
      citizenEmail: (req.body as any).citizenEmail,
      departmentId: departmentId as any,
      subDepartmentId: (grievance as any).subDepartmentId,
      companyId: companyId as any,
      description: grievance.description,
      category: grievance.category,
      createdAt: grievance.createdAt,
      timeline: grievance.timeline
    };

    // ✅ EXECUTE NOTIFICATIONS IN PARALLEL
    await notifyCompanyAdmins({
      companyId,
      eventType: 'GRIEVANCE_RECEIVED',
      title: 'New Grievance Received',
      message: `Grievance ${grievance.grievanceId} received from ${grievance.citizenName || 'Citizen'}.`,
      grievanceId: grievance.grievanceId,
      grievanceObjectId: grievance._id,
      meta: {
        citizenName: grievance.citizenName,
        category: grievance.category,
      },
    });

    if (targetAdmin) {
      const { notifyUser } = await import('../services/inAppNotificationService');
      await notifyUser({
        userId: targetAdmin._id,
        companyId,
        eventType: 'GRIEVANCE_ASSIGNED',
        title: 'New Grievance Assigned',
        message: `Grievance ${grievance.grievanceId} has been auto-assigned to you.`,
        grievanceId: grievance.grievanceId,
        grievanceObjectId: grievance._id,
        meta: {
          citizenName: grievance.citizenName,
          category: grievance.category,
        },
      });
    }

    Promise.allSettled([
      triggerGrievanceNotifications({
        companyId,
        grievanceId: grievance.grievanceId,
        citizenName: grievance.citizenName,
        citizenPhone: grievance.citizenPhone,
        category: (await Department.findById(departmentId).select('name'))?.name || category || 'N/A',
        description: grievance.description,
        status: grievance.status,
        subDepartmentName: (grievance as any).subDepartmentId
          ? (await Department.findById((grievance as any).subDepartmentId).select('name'))?.name || 'N/A'
          : 'N/A',
        language: grievance.language,
        assignedAdmins: targetAdmin ? [targetAdmin] : [],
        media: sanitizedMedia,
        buttonParam: 'https://sahaj.pugarch.in/'
      }).catch(err => console.error('Grievance template flow failed:', err)),
      notifyDepartmentAdminOnCreation(notificationPayload).catch(err => console.error('❌ Admin Notification failed:', err)),
    ]);

    res.status(201).json({
      success: true,
      message: 'Grievance registered successfully',
      data: { grievance }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to create grievance',
      error: error.message
    });
  }
});

router.post('/consent/citizen', async (req: Request, res: Response) => {
  try {
    const { companyId, phone_number, consent, source } = req.body;
    if (!companyId || !phone_number || typeof consent !== 'boolean') {
      return res.status(400).json({ success: false, message: 'companyId, phone_number and consent(boolean) are required.' });
    }
    if (source !== 'whatsapp_button') {
      return res.status(400).json({ success: false, message: 'Citizen consent must be captured using whatsapp_button source.' });
    }

    const profile = await CitizenProfile.findOneAndUpdate(
      { companyId, phone_number },
      {
        $set: {
          citizen_consent: consent,
          consentGiven: consent,
          citizen_consent_timestamp: new Date(),
          consentTimestamp: new Date(),
          consent_source: 'whatsapp_button',
          opt_out: false,
          isSubscribed: true,
          phoneNumber: phone_number
        }
      },
      { upsert: true, new: true }
    );

    return res.json({ success: true, data: profile });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/consent/admin', async (req: Request, res: Response) => {
  try {
    const { companyId, phone_number, consent } = req.body;
    if (!companyId || !phone_number || typeof consent !== 'boolean') {
      return res.status(400).json({ success: false, message: 'companyId, phone_number and consent(boolean) are required.' });
    }

    const profile = await CitizenProfile.findOneAndUpdate(
      { companyId, phone_number },
      {
        $set: {
          admin_consent: consent,
          admin_consent_timestamp: new Date()
        }
      },
      { upsert: true, new: true }
    );

    return res.json({ success: true, data: profile });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});


// @route   PUT /api/grievances/:id/revert
// @desc    Revert a wrongly assigned grievance back to company admin for reassignment
// @access  Department/Sub-department admins and operators
router.put('/:id/revert', requirePermission(Permission.REVERT_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const isCompanyAdmin = currentUser.level === 1 || currentUser.role === 'COMPANY_ADMIN';
    const { remarks, suggestedDepartmentId, suggestedSubDepartmentId, suggestedAssigneeId } = req.body;

    if (!remarks || !remarks.trim()) {
      return res.status(400).json({ success: false, message: 'Remarks are required for reverting a grievance' });
    }

    const grievance = await Grievance.findById(req.params.id)
      .populate('companyId')
      .populate('departmentId')
      .populate('subDepartmentId');

    if (!grievance) {
      return res.status(404).json({ success: false, message: 'Grievance not found' });
    }

    if (!currentUser.isSuperAdmin) {
      const grievanceCompanyId = (grievance.companyId as any)?._id?.toString() || grievance.companyId?.toString();
      if (grievanceCompanyId !== currentUser.companyId?.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied to this company' });
      }

      // Enforce department scope only if the user is assigned to a department
      // Company Admins (who have no departmentId) can revert any grievance in their company
      // 🏢 Multi-Department & Hierarchical Scoping
      if (!isCompanyAdmin && (currentUser.departmentId || (currentUser.departmentIds && currentUser.departmentIds.length > 0))) {
        const userDepts: string[] = [];
        if (currentUser.departmentId) userDepts.push(currentUser.departmentId.toString());
        if (currentUser.departmentIds && Array.isArray(currentUser.departmentIds)) {
          currentUser.departmentIds.forEach(id => userDepts.push(id.toString()));
        }

        const { getDepartmentHierarchyIds } = await import('../utils/departmentUtils');
        const authorizedDeptIds = await getDepartmentHierarchyIds(userDepts);

        const grievanceDeptId = (grievance.departmentId as any)?._id?.toString() || grievance.departmentId?.toString();
        const grievanceSubDeptId = (grievance.subDepartmentId as any)?._id?.toString() || grievance.subDepartmentId?.toString();
        
        const assignedToId = (grievance.assignedTo as any)?._id?.toString() || grievance.assignedTo?.toString();
        const isAssignee = assignedToId === currentUser._id.toString();
        
        const hasAccess = (grievanceDeptId && authorizedDeptIds.includes(grievanceDeptId)) || 
                          (grievanceSubDeptId && authorizedDeptIds.includes(grievanceSubDeptId)) ||
                          isAssignee;

        if (!hasAccess) {
          return res.status(403).json({ success: false, message: 'Access denied: You can only revert grievances within your authorized department scope' });
        }
      }
    }

    const previousDepartmentId = grievance.departmentId;
    const previousSubDepartmentId = grievance.subDepartmentId;
    const previousAssignedTo = grievance.assignedTo;
    const oldStatus = grievance.status;
    const previousDepartmentName = (grievance.departmentId as any)?.name || grievance.category || 'Collector & DM';
    const previousSubDepartmentName = (grievance.subDepartmentId as any)?.name || 'N/A';

    grievance.status = GrievanceStatus.REVERTED;
    grievance.departmentId = undefined;
    grievance.subDepartmentId = undefined;
    
    // ✅ Always-Owned: Reassign to Company Admin instead of clearing
    const companyAdmins = await User.find({ 
      companyId: grievance.companyId, 
      $or: [
        { role: UserRole.COMPANY_ADMIN },
        { level: 1 }
      ]
    }).sort({ createdAt: 1 }).limit(1);

    if (companyAdmins.length > 0) {
      grievance.assignedTo = companyAdmins[0]._id;
      grievance.assignedAt = new Date();
    } else {
      grievance.assignedTo = undefined;
      grievance.assignedAt = undefined;
    }

    grievance.statusHistory.push({
      status: GrievanceStatus.REVERTED,
      changedBy: currentUser._id,
      changedAt: new Date(),
      remarks: remarks.trim()
    } as any);

    grievance.timeline.push({
      action: 'REVERTED_TO_COMPANY_ADMIN',
      details: {
        remarks: remarks.trim(),
        previousDepartmentId,
        previousSubDepartmentId,
        previousAssignedTo,
        suggestedDepartmentId: suggestedDepartmentId || null,
        suggestedSubDepartmentId: suggestedSubDepartmentId || null,
        suggestedAssigneeId: suggestedAssigneeId || null,
        fromStatus: oldStatus
      },
      performedBy: currentUser._id,
      timestamp: new Date()
    });

    await grievance.save();

    // 🚀 Background Notifications: Move slow WhatsApp/In-App triggers to a background process
    // This prevents the frontend from timing out while waiting for multiple Meta API calls.
    (async () => {
      try {
        const targetDeptIdForNotification = previousSubDepartmentId || previousDepartmentId;
        if (targetDeptIdForNotification) {
          const { notifyDepartmentAdmins } = await import('../services/inAppNotificationService');
          await notifyDepartmentAdmins({
            companyId: grievance.companyId,
            departmentId: targetDeptIdForNotification,
            eventType: 'GRIEVANCE_REVERTED',
            title: 'Grievance Reverted',
            message: `Grievance ${grievance.grievanceId} was reverted for reassignment by ${currentUser.getFullName()}.`,
            grievanceId: grievance.grievanceId,
            grievanceObjectId: grievance._id,
            meta: { remarks: remarks.trim() },
          });
        }

        const revertRecipients = await getAdminRecipients(grievance.companyId);
        // Fetch names for Revert notification
        const [prevDept, prevSubDept] = await Promise.all([
          Department.findById(previousDepartmentId).select('name'),
          previousSubDepartmentId ? Department.findById(previousSubDepartmentId).select('name') : Promise.resolve(null)
        ]);

        await triggerAdminAssignmentNotification({
          event: 'GRIEVANCE_REVERTED',
          companyId: grievance.companyId,
          grievanceId: grievance.grievanceId,
          citizenName: grievance.citizenName,
          category: prevDept?.name || previousDepartmentName,
          subDepartmentName: prevSubDept?.name || 'N/A',
          description: grievance.description,
          recipientPhones: revertRecipients,
          language: grievance.language,
          revertedByName: currentUser.getFullName(),
          remarks: remarks.trim(),
          submittedOn: grievance.createdAt,
          buttonParam: 'https://sahaj.pugarch.in/',
          originalDepartmentName: prevDept?.name || previousDepartmentName,
          originalOfficeName: prevSubDept?.name || 'N/A',
          media: (grievance.media || []).map((file: any) => ({
            url: file.url,
            type: file.type,
            caption: file.caption,
            filename: file.filename
          }))
        });
      } catch (bgErr: any) {
        logger.error(`❌ [Background Notification] Revert flow failed: ${bgErr.message}`);
      }
    })();

    await logUserAction(req, AuditAction.UPDATE, 'Grievance', grievance._id.toString(), {
      action: 'revert_to_company_admin',
      grievanceId: grievance.grievanceId,
      remarks: remarks.trim(),
      suggestedDepartmentId: suggestedDepartmentId || null
    });

    return res.json({ success: true, message: 'Grievance reverted to company admin successfully', data: { grievance } });
  } catch (error: any) {
    logger.error(`❌ Failed to send email:`, { 
      error: error.message, 
      stack: error.stack,
      code: error.code,
      command: error.command,
      address: error.address,
      port: error.port,
      details: error 
    });
    return res.status(500).json({ success: false, message: 'Failed to revert grievance', error: error.message });
  }
});

// @route   GET /api/grievances/:id
// @desc    Get grievance by ID
// @access  Private
router.get('/:id', requirePermission(Permission.READ_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const grievance = await Grievance.findById(req.params.id)
      .populate('companyId', 'name companyId')
      .populate('departmentId', 'name departmentId')
      .populate('subDepartmentId', 'name departmentId')
      .populate('assignedTo', 'firstName lastName email designation')
      .populate('statusHistory.changedBy', 'firstName lastName')
      .populate('timeline.performedBy', 'firstName lastName role')
      .populate('media.uploadedBy', 'firstName lastName role');

    if (!grievance) {
      res.status(404).json({
        success: false,
        message: 'Grievance not found'
      });
      return;
    }

    // Check access - enforce company isolation for all non-superadmin roles
    if (!currentUser.isSuperAdmin) {
      // Always enforce company scope first
      const grievanceCompanyId = (grievance.companyId as any)?._id?.toString() || grievance.companyId?.toString();
      if (grievanceCompanyId && currentUser.companyId && grievanceCompanyId !== currentUser.companyId.toString()) {
        res.status(403).json({ success: false, message: 'Access denied - cross-company access prohibited' });
        return;
      }

      // 🎯 Company Admin Bypass: Company-level admins see all grievances in their company
      const isCompanyAdmin = currentUser.level === 1 || currentUser.role === 'COMPANY_ADMIN';
      
      // 🎯 Direct Assignee Bypass: If the grievance is assigned to the current user (primary or additional), they ALWAYS have access
      const assignedToId = (grievance.assignedTo as any)?._id?.toString() || grievance.assignedTo?.toString();
      const additionalAssigneeIds = (grievance.additionalAssigneeIds || []).map((id: any) => id.toString());
      const isAssignee = assignedToId === currentUser._id.toString() || additionalAssigneeIds.includes(currentUser._id.toString());

      if (!isCompanyAdmin && !isAssignee && (currentUser.departmentId || (currentUser.departmentIds && currentUser.departmentIds.length > 0))) {
        // Dynamic check: Users with assignment permission (Admins) see hierarchy. Others only see their own.
        const canAssign = req.checkPermission(Permission.ASSIGN_GRIEVANCE);
        if (!canAssign) {
          // If not assigned to them and they aren't an admin, deny access
          res.status(403).json({ success: false, message: 'Access denied - not assigned to you' });
          return;
        } else {
          // 🏢 Multi-Department & Hierarchical Scoping
          const userDepts: string[] = [];
          if (currentUser.departmentId) userDepts.push(currentUser.departmentId.toString());
          if (currentUser.departmentIds && Array.isArray(currentUser.departmentIds)) {
            currentUser.departmentIds.forEach(id => userDepts.push(id.toString()));
          }

          const { getDepartmentHierarchyIds } = await import('../utils/departmentUtils');
          const authorizedDeptIds = await getDepartmentHierarchyIds(userDepts);

          const grievanceDeptId = (grievance.departmentId as any)?._id?.toString() || grievance.departmentId?.toString();
          const grievanceSubDeptId = (grievance.subDepartmentId as any)?._id?.toString() || grievance.subDepartmentId?.toString();
          
          const hasHierarchyAccess = (grievanceDeptId && authorizedDeptIds.includes(grievanceDeptId)) || 
                                    (grievanceSubDeptId && authorizedDeptIds.includes(grievanceSubDeptId));

          if (!hasHierarchyAccess) {
            res.status(403).json({ success: false, message: 'Access denied - grievance not in your authorized department scope' });
            return;
          }
        }
      }
    }

    // 🛡️ Sign GCS URLs for media and timeline before sending to frontend
    const grievanceObj = grievance.toObject();

    if (grievanceObj.media && grievanceObj.media.length > 0) {
      grievanceObj.media = await Promise.all(
        grievanceObj.media.map(async (m: any) => ({
          ...m,
          url: await getSignedUrl(m.url)
        }))
      );
    }

    if (grievanceObj.timeline && grievanceObj.timeline.length > 0) {
      grievanceObj.timeline = await Promise.all(
        grievanceObj.timeline.map(async (event: any) => {
          if (event.details?.media && Array.isArray(event.details.media)) {
            const signedTimelineMedia = await Promise.all(
              event.details.media.map(async (mediaItem: any) => {
                if (typeof mediaItem === 'string') {
                  return await getSignedUrl(mediaItem);
                }
                if (mediaItem && typeof mediaItem === 'object' && mediaItem.url) {
                  return {
                    ...mediaItem,
                    url: await getSignedUrl(mediaItem.url)
                  };
                }
                return mediaItem;
              })
            );
            return {
              ...event,
              details: {
                ...event.details,
                media: signedTimelineMedia
              }
            };
          }
          return event;
        })
      );
    }

    res.json({
      success: true,
      data: { grievance: grievanceObj }
    });
  } catch (err: any) {
    logger.error('❌ testEmailConfiguration failed:', {
      message: err.message,
      code: err.code,
      command: err.command,
      stack: err.stack
    });
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      details: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || '465',
        user: process.env.SMTP_USER,
        error: err,
        code: err.code,
        command: err.command
      }
    });
  }
});

// @route   PUT /api/grievances/:id/status
// @desc    Update grievance status
// @access  Private
router.put('/:id/status', requirePermission(Permission.STATUS_CHANGE_GRIEVANCE, Permission.UPDATE_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const { status, remarks } = req.body;

    if (!status) {
      res.status(400).json({
        success: false,
        message: 'Status is required'
      });
      return;
    }

    // Restricted Update: If user lacks full update rights, they can only change status/remarks
    if (!req.checkPermission(Permission.UPDATE_GRIEVANCE)) {
      const allowedFields = ['status', 'remarks'];
      const providedFields = Object.keys(req.body);
      const invalidFields = providedFields.filter(field => !allowedFields.includes(field));
      
      if (invalidFields.length > 0) {
        return res.status(403).json({
          success: false,
          message: `Your role only allows updating status and remarks.`
        });
      }
    }

    const grievance = await Grievance.findById(req.params.id);
    if (!grievance) {
      res.status(404).json({ success: false, message: 'Grievance not found' });
      return;
    }

    // ✅ Multi-Tenant Scoping Check
    if (!currentUser.isSuperAdmin) {
      if (grievance.companyId?.toString() !== currentUser.companyId?.toString()) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      if (currentUser.departmentId || (currentUser.departmentIds && currentUser.departmentIds.length > 0)) {
        // Dynamic check for restricted users
        const canManage = req.checkPermission(Permission.ASSIGN_GRIEVANCE);
        if (!canManage) {
          if (grievance.assignedTo?.toString() !== currentUser._id.toString()) {
            res.status(403).json({ success: false, message: 'Access denied - not assigned to you' });
            return;
          }
        } else {
          // 🏢 Multi-Department & Hierarchical Scoping
          const userDepts: string[] = [];
          if (currentUser.departmentId) userDepts.push(currentUser.departmentId.toString());
          if (currentUser.departmentIds && Array.isArray(currentUser.departmentIds)) {
            currentUser.departmentIds.forEach(id => userDepts.push(id.toString()));
          }

          const { getDepartmentHierarchyIds } = await import('../utils/departmentUtils');
          const authorizedDeptIds = await getDepartmentHierarchyIds(userDepts);

          const grievanceDeptId = grievance.departmentId?.toString();
          const grievanceSubDeptId = grievance.subDepartmentId?.toString();
          
          const assignedToId = (grievance.assignedTo as any)?._id?.toString() || grievance.assignedTo?.toString();
          const additionalAssigneeIds = (grievance.additionalAssigneeIds || []).map((id: any) => id.toString());
          const isAssignee = assignedToId === currentUser._id.toString() || additionalAssigneeIds.includes(currentUser._id.toString());
          
          const hasAccess = (grievanceDeptId && authorizedDeptIds.includes(grievanceDeptId)) || 
                            (grievanceSubDeptId && authorizedDeptIds.includes(grievanceSubDeptId)) ||
                            isAssignee;

          if (!hasAccess) {
            res.status(403).json({ success: false, message: 'Access denied - grievance not in your authorized department scope' });
            return;
          }
        }
      }
    }

    const oldStatus = grievance.status;
    const isCompanyAdmin = currentUser.level === 1 || currentUser.role === 'COMPANY_ADMIN';
    
    // 🛡️ STATUS PROGRESSION ENFORCEMENT
    const statusOrder: Record<string, number> = {
      [GrievanceStatus.PENDING]: 1,
      [GrievanceStatus.ASSIGNED]: 1, // Treat ASSIGNED same as PENDING for progression
      [GrievanceStatus.IN_PROGRESS]: 2,
      [GrievanceStatus.REVERTED]: 0,
      [GrievanceStatus.RESOLVED]: 3,
      [GrievanceStatus.REJECTED]: 3
    };

    const isBackwardTransition = statusOrder[status] < statusOrder[oldStatus];
    const isFinalState = [GrievanceStatus.RESOLVED, GrievanceStatus.REJECTED].includes(oldStatus);

    if (!isCompanyAdmin && !currentUser.isSuperAdmin) {
      if (isFinalState) {
        return res.status(403).json({ success: false, message: 'Grievance is in a final state and cannot be modified.' });
      }
      if (isBackwardTransition) {
        return res.status(403).json({ success: false, message: 'Backward status transitions (e.g. from In-Progress to Pending) are restricted to Company Admins only.' });
      }
    }

    if (isBackwardTransition && !remarks?.trim()) {
      return res.status(400).json({ success: false, message: 'Mandatory reason logging required for status reversal.' });
    }

    const newMedia = req.body.media || [];
    
    // Update status
    grievance.status = status;
    grievance.statusHistory.push({
      status,
      changedBy: currentUser._id,
      changedAt: new Date(),
      remarks
    });

    // Handle new media attachments (proof/evidence)
    if (Array.isArray(newMedia) && newMedia.length > 0) {
      if (!grievance.media) grievance.media = [];
      const formattedMedia = newMedia.map((m: any) => ({
        url: m.url,
        type: m.type || 'image',
        uploadedAt: new Date(),
        uploadedBy: currentUser._id
      }));
      grievance.media.push(...formattedMedia);
    }

    // Update timestamps based on status
    if (status === GrievanceStatus.RESOLVED) {
      grievance.resolvedAt = new Date();
    }

    // Add to timeline
    if (!grievance.timeline) grievance.timeline = [];
    grievance.timeline.push({
      action: 'STATUS_UPDATED',
      details: {
        fromStatus: oldStatus,
        toStatus: status,
        remarks,
        attachmentsCount: newMedia.length
      },
      performedBy: currentUser._id,
      timestamp: new Date()
    });

    await grievance.save();

    if (oldStatus !== status) {
      const {
        triggerCitizenStatusTemplate
      } = await import('../services/grievanceTemplateTriggerService');

      // Fetch live names for citizen notification
      const [currDept, currSubDept] = await Promise.all([
        Department.findById(grievance.departmentId).select('name'),
        grievance.subDepartmentId ? Department.findById(grievance.subDepartmentId).select('name') : Promise.resolve(null)
      ]);

      await triggerCitizenStatusTemplate({
        companyId: grievance.companyId,
        citizenPhone: grievance.citizenPhone,
        citizenName: grievance.citizenName,
        grievanceId: grievance.grievanceId,
        departmentName: currDept?.name || grievance.category || 'Collector & DM',
        subDepartmentName: currSubDept?.name || 'N/A',
        grievanceSummary: grievance.description,
        status,
        remarks,
        resolvedByName: currentUser.getFullName(),
        formattedResolvedDate: formatTemplateDate(),
        language: grievance.language,
        media: newMedia // Pass only the new media to the citizen as proof
      });

      // Notify Hierarchy (Internal Admins)
      const hierarchyPayload = {
        type: 'grievance' as const,
        action: 'status_change' as any,
        grievanceId: grievance.grievanceId,
        citizenName: grievance.citizenName,
        citizenPhone: grievance.citizenPhone,
        citizenWhatsApp: grievance.citizenWhatsApp,
        language: grievance.language,
        departmentId: grievance.departmentId,
        subDepartmentId: grievance.subDepartmentId,
        companyId: grievance.companyId,
        assignedTo: grievance.assignedTo,
        resolvedAt: grievance.resolvedAt,
        createdAt: grievance.createdAt,
        assignedAt: grievance.assignedAt,
        timeline: grievance.timeline,
        remarks: remarks || ''
      };

      const { notifyHierarchyOnStatusChange } = await import('../services/notificationService');
      await notifyHierarchyOnStatusChange(hierarchyPayload, oldStatus, status).catch(e => console.error('Admin hierarchy notification failed:', e));

      // ✅ Trigger In-App Notification for Status Change (Upper Hierarchy / Admins)
      try {
        const targetDeptId = grievance.subDepartmentId || grievance.departmentId;
        if (targetDeptId) {
          const { notifyDepartmentAdmins } = await import('../services/inAppNotificationService');
          await notifyDepartmentAdmins({
            companyId: grievance.companyId,
            departmentId: targetDeptId,
            eventType: 'GRIEVANCE_STATUS_UPGRADED',
            title: 'Grievance Status Updated',
            message: `Grievance ${grievance.grievanceId} status changed from ${oldStatus} to ${status} by ${currentUser.getFullName()}.`,
            grievanceId: grievance.grievanceId,
            grievanceObjectId: grievance._id,
            meta: { fromStatus: oldStatus, toStatus: status, remarks }
          });
        }
      } catch (inAppErr) {
        logger.error('⚠️ In-App Status Notification failed:', inAppErr);
      }
    }

    await logUserAction(
      req,
      AuditAction.STATUS_CHANGE,
      'Grievance',
      grievance._id.toString(),
      { oldStatus: grievance.status, newStatus: status, remarks }
    );

    res.json({
      success: true,
      message: 'Grievance status updated successfully',
      data: { grievance }
    });
  } catch (error: any) {
    console.error('❌ Status update failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/grievances/:id/assign
// @desc    Assign grievance to user
// @access  Private
router.put('/:id/assign', requirePermission(Permission.ASSIGN_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const {
      assignedTo,
      departmentId,
      note,
      description,
      additionalDepartmentIds,
      additionalAssigneeIds
    } = req.body;

    if (!assignedTo) {
      res.status(400).json({
        success: false,
        message: 'Assigned user ID is required'
      });
      return;
    }

    const grievance = await Grievance.findById(req.params.id);
    if (!grievance) {
      res.status(404).json({ success: false, message: 'Grievance not found' });
      return;
    }

    const currentUser = req.user!;
    const isCompanyAdmin = currentUser.level === 1 || currentUser.role === 'COMPANY_ADMIN';

    // ✅ Multi-Tenant Scoping Check
    if (!currentUser.isSuperAdmin) {
      if (grievance.companyId?.toString() !== currentUser.companyId?.toString()) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      // Company Admin can assign/reassign across all departments in their company.
      // Support both legacy `level` and role-based authorization to avoid blocking
      // company admins when level is missing from token/user payload.
      if (currentUser.departmentId && !isCompanyAdmin) {
        const grievanceDeptId = grievance.departmentId?.toString();
        const grievanceSubDeptId = grievance.subDepartmentId?.toString();
        const adminDeptId = currentUser.departmentId?.toString();
        const assignedToId = (grievance.assignedTo as any)?._id?.toString() || grievance.assignedTo?.toString();
        const isAssignee = assignedToId === currentUser._id.toString();

        if (grievanceDeptId !== adminDeptId && grievanceSubDeptId !== adminDeptId && !isAssignee) {
          res.status(403).json({ success: false, message: 'Access denied - grievance not in your department and not assigned to you' });
          return;
        }
      }
    }

    const assignedToValue = String(assignedTo).trim();
    const assignedUser = await User.findOne({
      ...(currentUser.isSuperAdmin ? {} : { companyId: currentUser.companyId }),
      $or: [
        { userId: assignedToValue },
        ...(assignedToValue.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: assignedToValue }] : [])
      ]
    });
    if (!assignedUser) {
      res.status(404).json({
        success: false,
        message: 'Assigned user not found'
      });
      return;
    }

    const transferNote = String(note || description || '').trim();
    const normalizedAdditionalDepartmentIds = Array.isArray(additionalDepartmentIds)
      ? Array.from(new Set(additionalDepartmentIds.map((id: any) => String(id)).filter(Boolean)))
      : [];
    const normalizedAdditionalAssigneeIds = Array.isArray(additionalAssigneeIds)
      ? Array.from(
          new Set(
            additionalAssigneeIds
              .map((id: any) => String(id).trim())
              .filter((id: string) => id && id !== assignedToValue)
          )
        )
      : [];

    if (
      (normalizedAdditionalDepartmentIds.length > 0 || normalizedAdditionalAssigneeIds.length > 0) &&
      !(isCompanyAdmin || currentUser.isSuperAdmin)
    ) {
      res.status(403).json({
        success: false,
        message: 'Only company admin can assign grievance to multiple departments'
      });
      return;
    }

    if (normalizedAdditionalDepartmentIds.length > 0) {
      const additionalDepartments = await Department.find({
        _id: { $in: normalizedAdditionalDepartmentIds },
        ...(currentUser.isSuperAdmin ? {} : { companyId: currentUser.companyId })
      }).select('_id');

      if (additionalDepartments.length !== normalizedAdditionalDepartmentIds.length) {
        res.status(400).json({
          success: false,
          message: 'One or more additional departments are invalid for this company'
        });
        return;
      }

      grievance.additionalDepartmentIds = additionalDepartments.map((department) => department._id) as any;
    } else {
      grievance.additionalDepartmentIds = [];
    }

    let additionalAssigneeUsers: any[] = [];
    if (normalizedAdditionalAssigneeIds.length > 0) {
      additionalAssigneeUsers = await User.find({
        _id: { $in: normalizedAdditionalAssigneeIds },
        ...(currentUser.isSuperAdmin ? {} : { companyId: currentUser.companyId })
      }).select('_id firstName lastName phone departmentIds');

      if (additionalAssigneeUsers.length !== normalizedAdditionalAssigneeIds.length) {
        res.status(400).json({
          success: false,
          message: 'One or more selected users are invalid for this company'
        });
        return;
      }

      grievance.additionalAssigneeIds = additionalAssigneeUsers.map((user) => user._id) as any;
    } else {
      grievance.additionalAssigneeIds = [];
    }
    const oldAssignedTo = grievance.assignedTo;
    const oldStatus = grievance.status;
    const oldDepartmentId = grievance.departmentId;
    const oldSubDepartmentId = grievance.subDepartmentId;
    const [oldDepartmentDoc, oldSubDepartmentDoc] = await Promise.all([
      oldDepartmentId ? Department.findById(oldDepartmentId).select('_id name') : Promise.resolve(null),
      oldSubDepartmentId ? Department.findById(oldSubDepartmentId).select('_id name') : Promise.resolve(null)
    ]);
    let currentDepartmentName = oldDepartmentDoc?.name || grievance.category || 'N/A';
    let currentOfficeName = oldSubDepartmentDoc?.name || 'N/A';
    const originalDepartmentName = oldDepartmentDoc?.name || grievance.category || 'Collector & DM';
    const originalOfficeName = oldSubDepartmentDoc?.name || 'N/A';

    // Update assignment details
    grievance.assignedTo = assignedUser._id;
    grievance.assignedAt = new Date();
    const shouldMoveToAssignedStatus =
      grievance.status !== GrievanceStatus.REJECTED &&
      (
        grievance.status !== GrievanceStatus.RESOLVED ||
        isCompanyAdmin ||
        currentUser.isSuperAdmin
      );
    if (shouldMoveToAssignedStatus) {
      grievance.status = GrievanceStatus.PENDING;
    }

    // Auto-update department/sub-department based on assigned user's mapped department
    if (assignedUser.departmentId) {
      const targetDept = await Department.findById(assignedUser.departmentId).select('_id name parentDepartmentId');
      if (targetDept) {
        const parentDepartment = targetDept.parentDepartmentId
          ? await Department.findById(targetDept.parentDepartmentId).select('_id name')
          : null;
        const nextDepartmentId = parentDepartment?._id || targetDept._id;
        const nextSubDepartmentId = targetDept.parentDepartmentId ? targetDept._id : undefined;
        const toDepartmentName = parentDepartment?.name || targetDept.name || 'Department';
        const toSubDepartmentName = targetDept.parentDepartmentId ? targetDept.name : '';

        const departmentChanged =
          !oldDepartmentId ||
          oldDepartmentId.toString() !== nextDepartmentId.toString() ||
          oldSubDepartmentId?.toString() !== nextSubDepartmentId?.toString();
        currentDepartmentName = toDepartmentName || currentDepartmentName;
        currentOfficeName = toSubDepartmentName || 'N/A';

        if (departmentChanged) {
          grievance.departmentId = nextDepartmentId as any;
          grievance.subDepartmentId = nextSubDepartmentId as any;

          // Add department transfer event to timeline
          grievance.timeline.push({
            action: 'DEPARTMENT_TRANSFER',
            details: {
              grievanceId: grievance.grievanceId,
              fromDepartmentId: oldDepartmentId || null,
              fromSubDepartmentId: oldSubDepartmentId || null,
              toDepartmentId: nextDepartmentId,
              toSubDepartmentId: nextSubDepartmentId || null,
              toDepartmentName,
              toSubDepartmentName: toSubDepartmentName || null,
              toUserName: assignedUser.getFullName(),
              note: transferNote || null,
              reason: transferNote || 'Auto-updated during reassignment'
            },
            performedBy: req.user!._id,
            timestamp: new Date()
          });
        }
      } else {
        currentOfficeName = currentDepartmentName;
      }
    }

    // Add to status history
    const statusRemarks = transferNote
      ? `Assigned to user. Note: ${transferNote}`
      : departmentId
        ? `Assigned to user and transferred to new department`
        : `Assigned to user`;
    
    grievance.statusHistory.push({
      status: shouldMoveToAssignedStatus ? GrievanceStatus.PENDING : grievance.status,
      changedBy: req.user!._id,
      changedAt: new Date(),
      remarks: shouldMoveToAssignedStatus
        ? statusRemarks
        : `${statusRemarks}. Assignment updated without changing grievance status (${oldStatus}).`
    });

    // Add assignment event to timeline
    grievance.timeline.push({
      action: 'ASSIGNED',
      details: {
        grievanceId: grievance.grievanceId,
        fromUserId: oldAssignedTo,
        toUserId: assignedUser._id,
        toUserName: assignedUser.getFullName(),
        note: transferNote || null
      },
      performedBy: req.user!._id,
      timestamp: new Date()
    });

    await grievance.save();

    if (normalizedAdditionalDepartmentIds.length > 0) {
      grievance.timeline.push({
        action: 'MULTI_DEPARTMENT_ASSIGNMENT',
        details: {
          grievanceId: grievance.grievanceId,
          departmentIds: normalizedAdditionalDepartmentIds
        },
        performedBy: req.user!._id,
        timestamp: new Date()
      });
    }

    if (normalizedAdditionalAssigneeIds.length > 0) {
      grievance.timeline.push({
        action: 'MULTI_USER_ASSIGNMENT',
        details: {
          grievanceId: grievance.grievanceId,
          primaryAssigneeId: assignedUser._id,
          additionalAssigneeIds: normalizedAdditionalAssigneeIds
        },
        performedBy: req.user!._id,
        timestamp: new Date()
      });
    }

    if (normalizedAdditionalDepartmentIds.length > 0 || normalizedAdditionalAssigneeIds.length > 0) {
      await grievance.save();
    }

    const isReassignment = Boolean(
      oldAssignedTo ||
      grievance.timeline?.some((entry: any) => entry.action === 'REVERTED_TO_COMPANY_ADMIN')
    );
    // Use reassigned template only when company admin / super admin is acting (cross-dept)
    // Dept admin assigning to sub-dept → use assigned template
    const useReassignedTemplate = isReassignment && (currentUser.isSuperAdmin || isCompanyAdmin);

    // 🚀 BACKGROUND NOTIFICATIONS: Fire and forget to keep UI responsive
    (async () => {
      try {
        const allRecipientUsers = [assignedUser, ...additionalAssigneeUsers].filter(
          (user, index, users) =>
            user?.phone &&
            users.findIndex((candidate) => candidate?._id?.toString() === user?._id?.toString()) === index
        );

        if (allRecipientUsers.length > 0) {
          await triggerAdminAssignmentNotification({
            // useReassignedTemplate: company admin / super admin cross-dept reassignment
            // grievance_assigned_admin_v2: dept admin delegating within dept
            event: useReassignedTemplate ? 'GRIEVANCE_REASSIGNED' : 'GRIEVANCE_ASSIGNED',
            companyId: grievance.companyId,
            grievanceId: grievance.grievanceId,
            citizenName: grievance.citizenName,
            // New destination dept (where it's going NOW)
            category: currentDepartmentName,
            subDepartmentName: currentOfficeName,
            description: grievance.description,
            recipientPhones: allRecipientUsers.map((user) => user.phone).filter(Boolean),
            language: grievance.language,
            assignedByName: req.user!.getFullName(),
            reassignedByName: req.user!.getFullName(),
            remarks: transferNote || 'Assigned for resolution.',
            submittedOn: grievance.createdAt,
            reassignedOn: new Date(),
            // Previously assigned dept (where it was BEFORE this action)
            originalDepartmentName: originalDepartmentName,
            originalOfficeName: originalOfficeName,
            media: (grievance.media || []).map((file: any) => ({
              url: file.url,
              type: file.type,
              caption: file.caption,
              filename: file.filename
            }))
          });
        }

        const { notifyUserOnAssignment } = await import('../services/notificationService');
          await notifyUserOnAssignment({
            type: 'grievance',
            action: 'assigned',
            grievanceId: grievance.grievanceId,
            citizenName: grievance.citizenName,
            citizenPhone: grievance.citizenPhone,
            citizenWhatsApp: grievance.citizenWhatsApp,
            departmentId: grievance.departmentId,
            subDepartmentId: grievance.subDepartmentId,
            companyId: grievance.companyId,
            description: grievance.description,
            category: grievance.category,
            assignedTo: assignedUser._id,
            assignedByName: req.user!.getFullName(),
            assignedAt: grievance.assignedAt,
            createdAt: grievance.createdAt,
            language: grievance.language,
            remarks: transferNote,
            timeline: grievance.timeline
          });

          // ✅ IN-APP NOTIFICATION (InAppNotificationService)
          const { notifyCompanyAdmins, notifyUser } = await import('../services/inAppNotificationService');
          
          // 1. Notify the specific assignee
          await notifyUser({
            userId: assignedUser._id,
            companyId: grievance.companyId,
            eventType: isReassignment ? 'GRIEVANCE_REASSIGNED' : 'GRIEVANCE_ASSIGNED',
            title: isReassignment ? 'Grievance Reassigned' : 'Grievance Assigned',
            message: isReassignment 
              ? `Grievance ${grievance.grievanceId} has been reassigned to you by ${req.user!.getFullName()}.`
              : `Grievance ${grievance.grievanceId} has been assigned to you.`,
            grievanceId: grievance.grievanceId,
            grievanceObjectId: grievance._id,
            meta: { remarks: transferNote }
          });

          if (additionalAssigneeUsers.length > 0) {
            await Promise.all(
              additionalAssigneeUsers.map((user) =>
                notifyUser({
                  userId: user._id,
                  companyId: grievance.companyId,
                  eventType: isReassignment ? 'GRIEVANCE_REASSIGNED' : 'GRIEVANCE_ASSIGNED',
                  title: isReassignment ? 'Grievance Reassigned' : 'Grievance Assigned',
                  message: isReassignment
                    ? `Grievance ${grievance.grievanceId} has also been assigned to you by ${req.user!.getFullName()}.`
                    : `Grievance ${grievance.grievanceId} has also been assigned to you for action.`,
                  grievanceId: grievance.grievanceId,
                  grievanceObjectId: grievance._id,
                  meta: {
                    remarks: transferNote,
                    primaryAssignee: assignedUser.getFullName(),
                    isAdditionalAssignee: true
                  }
                })
              )
            );
          }

          // 2. Notify Company/Dept admins about the assignment change (Hierarchy: Sub-Dept -> Dept -> Company)
          const targetDeptId = grievance.subDepartmentId || grievance.departmentId;
          if (targetDeptId) {
            const { notifyDepartmentAdmins } = await import('../services/inAppNotificationService');
            await notifyDepartmentAdmins({
              companyId: grievance.companyId,
              departmentId: targetDeptId,
              eventType: isReassignment ? 'GRIEVANCE_REASSIGNED' : 'GRIEVANCE_ASSIGNED',
              title: isReassignment ? 'Grievance Reassigned' : 'Grievance Assigned',
              message: isReassignment 
                ? `Grievance ${grievance.grievanceId} reassigned to ${assignedUser.getFullName()} by ${req.user!.getFullName()}.`
                : `Grievance ${grievance.grievanceId} assigned to ${assignedUser.getFullName()}.`,
              grievanceId: grievance.grievanceId,
              grievanceObjectId: grievance._id,
              meta: { assignedTo: assignedUser.getFullName(), remarks: transferNote }
            });
          }
      } catch (err: any) {
        logger.error('[GrievanceAssignment] Background notification error:', err?.message || err);
      }
    })();

    logUserAction(
      req,
      AuditAction.ASSIGN,
      'Grievance',
      grievance._id.toString(),
      {
        assignedTo,
        departmentId,
        additionalDepartmentIds: normalizedAdditionalDepartmentIds,
        additionalAssigneeIds: normalizedAdditionalAssigneeIds
      }
    ).catch(err => logger.error('[Assignment] Audit log failed:', err));

    res.json({
      success: true,
      message: 'Grievance assigned successfully',
      data: { grievance }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to assign grievance',
      error: error.message
    });
  }
});

// @route   PUT /api/grievances/:id/sla
// @desc    Update SLA hours for a grievance (Company Admin only)
// @access  Private
router.put('/:id/sla', requirePermission(Permission.UPDATE_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const { slaHours } = req.body as { slaHours: number };
    const currentUser = req.user!;

    if (!slaHours || typeof slaHours !== 'number') {
      return res.status(400).json({ success: false, message: 'Valid SLA hours are required' });
    }

    const grievance = await Grievance.findById(req.params.id);
    if (!grievance) {
      return res.status(404).json({ success: false, message: 'Grievance not found' });
    }

    // Security: Only company admin of the same company
    const isCompanyAdmin = currentUser.level === 1 || currentUser.roleName?.toLowerCase().includes('company');
    if (!isCompanyAdmin || grievance.companyId.toString() !== currentUser.companyId?.toString()) {
      return res.status(403).json({ success: false, message: 'Only company admin can update SLA' });
    }

    const oldSla = grievance.slaHours || 120;
    grievance.slaHours = slaHours;
    grievance.timeline.push({
      action: 'SLA_UPDATED',
      details: { oldSla, newSla: slaHours },
      performedBy: currentUser._id,
      timestamp: new Date()
    });

    await grievance.save();

    res.json({ success: true, data: { grievance }, message: `SLA updated to ${slaHours} hours` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to update SLA', error: error.message });
  }
});

// @route   POST /api/grievances/:id/reminder
// @desc    Send overdue reminder to assigned/designated admin (Jharsuguda company admin only)
// @access  Private
router.post('/:id/reminder', requirePermission(Permission.UPDATE_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const { remarks } = req.body as { remarks?: string };
    const trimmedRemarks = String(remarks || '').trim();

    if (!trimmedRemarks) {
      return res.status(400).json({ success: false, message: 'Remarks are required' });
    }

    if (!currentUser.companyId || currentUser.companyId.toString() !== JHARSUGUDA_COMPANY_ID) {
      return res.status(403).json({ success: false, message: 'Reminder is enabled only for Collectorate Jharsuguda' });
    }

    const roleName = String((currentUser as any).roleName || '').toLowerCase();
    const designation = String(currentUser.designation || '').toLowerCase();
    const isCompanyAdmin =
      !currentUser.departmentId &&
      (currentUser.level === 1 ||
        roleName.includes('company') ||
        roleName.includes('collector') ||
        designation.includes('collector') ||
        designation.includes('company admin'));

    if (!isCompanyAdmin) {
      return res.status(403).json({ success: false, message: 'Only company admin can send reminders' });
    }

    const grievance = await Grievance.findById(req.params.id)
      .populate('departmentId', 'name')
      .populate('subDepartmentId', 'name')
      .populate('assignedTo', 'firstName lastName phone');

    if (!grievance) {
      return res.status(404).json({ success: false, message: 'Grievance not found' });
    }

    if (grievance.companyId?.toString() !== currentUser.companyId.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const now = new Date();
    const createdDate = new Date(grievance.createdAt);
    const assignedDate = grievance.assignedAt ? new Date(grievance.assignedAt) : createdDate;
    const hoursSinceCreated = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60);
    const hoursSinceAssigned = (now.getTime() - assignedDate.getTime()) / (1000 * 60 * 60);
    const slaHours = grievance.slaHours || 120;
    const overdue = (grievance.status === GrievanceStatus.PENDING || 
                    grievance.status === GrievanceStatus.ASSIGNED || 
                    grievance.status === GrievanceStatus.IN_PROGRESS || 
                    grievance.status === GrievanceStatus.REVERTED)
      ? hoursSinceCreated >= slaHours
      : false;

    if (!overdue) {
      return res.status(400).json({ success: false, message: 'Reminder can only be sent for overdue grievances' });
    }

    const reminderCount = Number((grievance as any).reminderCount || 0) + 1;
    (grievance as any).reminderCount = reminderCount;
    (grievance as any).lastReminderAt = now;
    (grievance as any).lastReminderRemarks = trimmedRemarks;
    grievance.timeline.push({
      action: 'REMINDER_SENT',
      details: { remarks: trimmedRemarks, reminderCount },
      performedBy: currentUser._id,
      timestamp: now
    });
    await grievance.save();

    await notifyCompanyAdmins({
      companyId: grievance.companyId,
      eventType: 'GRIEVANCE_REMINDER',
      title: 'Overdue Reminder Sent',
      message: `Reminder #${reminderCount} sent for grievance ${grievance.grievanceId}.`,
      grievanceId: grievance.grievanceId,
      grievanceObjectId: grievance._id,
      meta: { reminderCount, remarks: trimmedRemarks },
    });

    // ✅ Trigger In-App Notification for Hierarchy (Sub-Dept, Dept, and Company Admins)
    const targetDeptId = grievance.subDepartmentId || grievance.departmentId;
    if (targetDeptId) {
      const { notifyDepartmentAdmins } = await import('../services/inAppNotificationService');
      await notifyDepartmentAdmins({
        companyId: grievance.companyId,
        departmentId: targetDeptId,
        eventType: 'GRIEVANCE_REMINDER',
        title: 'Overdue Reminder Notification',
        message: `An overdue reminder was sent for grievance ${grievance.grievanceId} to the assigned officer. Remarks: ${trimmedRemarks}`,
        grievanceId: grievance.grievanceId,
        grievanceObjectId: grievance._id,
        meta: { reminderCount, remarks: trimmedRemarks },
      });
    }

    // ✅ Trigger In-App Notification for Reminder (to Assigned User)
    if (grievance.assignedTo) {
      const { notifyUser } = await import('../services/inAppNotificationService');
      await notifyUser({
        userId: (typeof grievance.assignedTo === 'object' ? (grievance.assignedTo as any)._id : grievance.assignedTo) as any,
        companyId: grievance.companyId,
        eventType: 'GRIEVANCE_REMINDER',
        title: 'Overdue Reminder',
        message: `Grievance ${grievance.grievanceId} has an overdue reminder from company admin. Remarks: ${trimmedRemarks}`,
        grievanceId: grievance.grievanceId,
        grievanceObjectId: grievance._id,
        meta: { reminderCount, remarks: trimmedRemarks },
      });
    }

    const assignedUser = grievance.assignedTo && typeof grievance.assignedTo === 'object'
      ? grievance.assignedTo as any
      : null;
    const hierarchyAdmins = await getHierarchicalDepartmentAdmins(grievance.subDepartmentId || grievance.departmentId);
    const recipientPhones = Array.from(new Set([
      normalizePhoneNumber(assignedUser?.phone),
      ...hierarchyAdmins.map((admin: any) => normalizePhoneNumber(admin?.phone))
    ].filter(Boolean) as string[]));

    const departmentName = (grievance.departmentId as any)?.name || grievance.category || 'Collector & DM';
    const officeName = (grievance.subDepartmentId as any)?.name || 'N/A';
    
    if (recipientPhones.length > 0) {
      const recipientProfiles = await User.find({
        companyId: grievance.companyId,
        phone: { $in: recipientPhones }
      }).select('phone firstName lastName').lean();

      const nameByPhone = new Map<string, string>();
      for (const profile of recipientProfiles as any[]) {
        const normalized = normalizePhoneNumber(profile.phone);
        if (normalized) {
          const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
          if (fullName) nameByPhone.set(normalized, fullName);
        }
      }

      await Promise.allSettled(
        recipientPhones.map(async (phone) => {
          const normalizedTo = normalizePhoneNumber(phone);
          const recipientName = (normalizedTo && nameByPhone.get(normalizedTo)) || 'Administrator';

          await triggerGrievanceEvent({
            eventKey: 'GRIEVANCE_REMINDER',
            companyId: grievance.companyId,
            language: grievance.language,
            grievance: grievance,
            recipientPhones: [phone],
            citizenPhone: grievance.citizenPhone,
            admin: { fullName: recipientName },
            remarks: trimmedRemarks,
            department: { name: departmentName },
            subDept: { name: officeName },
            submittedOn: grievance.createdAt
          });

          // ✅ Send Media for each recipient with their personalized name
          const grievanceMedia = (grievance.media || []).map((file: any) => ({
            url: file.url,
            type: file.type,
            caption: `Evidence for grievance ${grievance.grievanceId}`
          }));

          if (grievanceMedia.length > 0) {
            const config = await CompanyWhatsAppConfig.findOne({ companyId: grievance.companyId, isActive: true }).lean();
            const company = await Company.findById(grievance.companyId).lean();
            if (config && company) {
              const companyPayload = {
                ...company,
                _id: grievance.companyId,
                whatsappConfig: {
                  phoneNumberId: config.phoneNumberId,
                  accessToken: config.accessToken,
                  businessAccountId: config.businessAccountId,
                  rateLimits: config.rateLimits
                }
              };
              await sendMediaSequentially(companyPayload, phone, grievanceMedia as any, recipientName);
            }
          }
          return;
        })
      );
    }

    await logUserAction(
      req,
      AuditAction.UPDATE,
      'Grievance',
      grievance._id.toString(),
      { action: 'REMINDER_SENT', reminderCount, remarks: trimmedRemarks }
    );

    return res.json({
      success: true,
      message: 'Reminder sent successfully',
      data: { grievance }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to send reminder',
      error: error.message
    });
  }
});

// @route   PUT /api/grievances/:id
// @desc    Update grievance details (Operators cannot use this - use /status endpoint instead)
// @access  Private (CompanyAdmin, DepartmentAdmin only - Operators restricted)
router.put('/:id', requirePermission(Permission.UPDATE_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;

    // Users without full update permission must use the /status endpoint instead
    if (!req.checkPermission(Permission.UPDATE_GRIEVANCE)) {
      return res.status(403).json({
        success: false,
        message: 'Your role only allows updating status and remarks.'
      });
    }

    // Check department/company access
    const grievance = await Grievance.findById(req.params.id);
    if (!grievance) {
      return res.status(404).json({
        success: false,
        message: 'Grievance not found'
      });
    }

    // ✅ Multi-Tenant Scoping Check
    if (!currentUser.isSuperAdmin) {
      if (grievance.companyId?.toString() !== currentUser.companyId?.toString()) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      if (currentUser.departmentId) {
        const grievanceDeptId = grievance.departmentId?.toString();
        const grievanceSubDeptId = grievance.subDepartmentId?.toString();
        const adminDeptId = currentUser.departmentId?.toString();
        if (grievanceDeptId !== adminDeptId && grievanceSubDeptId !== adminDeptId) {
          res.status(403).json({ success: false, message: 'Access denied - grievance not in your department' });
          return;
        }
      }
    }

    // Update grievance
    const updatedGrievance = await Grievance.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    logUserAction(
      req,
      AuditAction.UPDATE,
      'Grievance',
      updatedGrievance!._id.toString(),
      { updates: req.body }
    ).catch(err => logger.error('[Update] Audit log failed:', err));

    res.json({
      success: true,
      message: 'Grievance updated successfully',
      data: { grievance: updatedGrievance }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to update grievance',
      error: error.message
    });
  }
});

// @route   DELETE /api/grievances/bulk
// @desc    Bulk delete grievances (Super Admin only)
// @access  Private (Super Admin only)
router.delete('/bulk', requirePermission(Permission.DELETE_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    const currentUser = req.user!;

    if (!currentUser.isSuperAdmin) {
      res.status(403).json({
        success: false,
        message: 'Bulk grievance deletion is allowed for superadmin only'
      });
      return;
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Please provide an array of grievance IDs to delete'
      });
      return;
    }

    const grievances = await Grievance.find({ _id: { $in: ids } })
      .select('_id companyId departmentId subDepartmentId')
      .lean();

    if (grievances.length === 0) {
      res.status(404).json({
        success: false,
        message: 'No grievances found for the provided IDs'
      });
      return;
    }

    for (const grievance of grievances) {
      await Grievance.findByIdAndDelete(grievance._id);
      await logUserAction(
        req,
        AuditAction.DELETE,
        'Grievance',
        grievance._id.toString()
      );
    }

    res.json({
      success: true,
      message: `${grievances.length} grievance(s) deleted successfully`,
      data: { deletedCount: grievances.length }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete grievances',
      error: error.message
    });
  }
});

// @route   PUT /api/grievances/:id/reopen
// @desc    Reopen a resolved/rejected grievance (Company Admin only)
// @access  Private
router.put('/:id/reopen', requirePermission(Permission.UPDATE_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const { remarks } = req.body;

    const isCompanyAdmin = currentUser.level === 1 || currentUser.role === 'COMPANY_ADMIN';
    if (!isCompanyAdmin && !currentUser.isSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Only Company Admin can reopen a grievance.' });
    }

    if (!remarks || !remarks.trim()) {
      return res.status(400).json({ success: false, message: 'Remarks are required for reopening a grievance.' });
    }

    const grievance = await Grievance.findById(req.params.id);
    if (!grievance) {
      return res.status(404).json({ success: false, message: 'Grievance not found' });
    }

    const oldStatus = grievance.status;
    grievance.status = GrievanceStatus.PENDING;
    grievance.assignedTo = currentUser._id;
    grievance.assignedAt = new Date();
    (grievance as any).reopenedCount = ((grievance as any).reopenedCount || 0) + 1;
    
    grievance.statusHistory.push({
      status: GrievanceStatus.PENDING,
      changedBy: currentUser._id,
      changedAt: new Date(),
      remarks: `REOPENED: ${remarks.trim()}`
    });

    grievance.timeline.push({
      action: 'REOPENED',
      details: { fromStatus: oldStatus, remarks: remarks.trim() },
      performedBy: currentUser._id,
      timestamp: new Date()
    });

    await grievance.save();

    // Notify Hierarchy about Reopen
    const { notifyDepartmentAdmins } = await import('../services/inAppNotificationService');
    const targetDeptId = grievance.subDepartmentId || grievance.departmentId;
    if (targetDeptId) {
      await notifyDepartmentAdmins({
        companyId: grievance.companyId,
        departmentId: targetDeptId,
        eventType: 'GRIEVANCE_REOPENED',
        title: 'Grievance Reopened',
        message: `Grievance ${grievance.grievanceId} has been reopened by Company Admin. Remarks: ${remarks.trim()}`,
        grievanceId: grievance.grievanceId,
        grievanceObjectId: grievance._id,
        meta: { remarks: remarks.trim() }
      });
    }

    res.json({ success: true, message: 'Grievance reopened successfully', data: { grievance } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to reopen grievance', error: error.message });
  }
});


// @route   DELETE /api/grievances/:id
// @desc    Delete a grievance within the caller's permitted scope
// @access  Private
router.delete('/:id', requirePermission(Permission.DELETE_GRIEVANCE), async (req: Request, res: Response) => {
  const currentUser = req.user!;

  try {
    const grievance = await Grievance.findById(req.params.id);

    if (!grievance) {
      res.status(404).json({
        success: false,
        message: 'Grievance not found'
      });
      return;
    }

    // ✅ Multi-Tenant Scoping Check
    if (!currentUser.isSuperAdmin) {
      if (grievance.companyId?.toString() !== currentUser.companyId?.toString()) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      if (currentUser.departmentId || (currentUser.departmentIds && currentUser.departmentIds.length > 0)) {
        // 🏢 Multi-Department & Hierarchical Scoping
        const userDepts: string[] = [];
        if (currentUser.departmentId) userDepts.push(currentUser.departmentId.toString());
        if (currentUser.departmentIds && Array.isArray(currentUser.departmentIds)) {
          currentUser.departmentIds.forEach(id => userDepts.push(id.toString()));
        }

        const { getDepartmentHierarchyIds } = await import('../utils/departmentUtils');
        const authorizedDeptIds = await getDepartmentHierarchyIds(userDepts);

        const grievanceDeptId = grievance.departmentId?.toString();
        const grievanceSubDeptId = grievance.subDepartmentId?.toString();
        
        const hasAccess = (grievanceDeptId && authorizedDeptIds.includes(grievanceDeptId)) || 
                          (grievanceSubDeptId && authorizedDeptIds.includes(grievanceSubDeptId));

        if (!hasAccess) {
          res.status(403).json({ success: false, message: 'Access denied - grievance not in your authorized department scope' });
          return;
        }
      }
    }

    await Grievance.findByIdAndDelete(req.params.id);

    await logUserAction(
      req,
      AuditAction.DELETE,
      'Grievance',
      grievance._id.toString()
    );

    res.json({
      success: true,
      message: 'Grievance deleted successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete grievance',
      error: error.message
    });
  }
});

export default router;
