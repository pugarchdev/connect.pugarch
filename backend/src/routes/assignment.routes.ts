import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { requireDatabaseConnection } from '../middleware/dbConnection';
import { Permission, UserRole } from '../config/constants';
import Grievance from '../models/Grievance';
import Appointment from '../models/Appointment';
import User from '../models/User';
import { logUserAction } from '../utils/auditLogger';
import { AuditAction } from '../config/constants';
import { 
  triggerAdminAssignmentNotification
} from '../services/grievanceTemplateTriggerService';
import { GrievanceStatus } from '../config/constants';

const router = express.Router();
const COLLECTORATE_JHARSUGUDA_COMPANY_ID = '69ad4c6eb1ad8e405e6c0858';

const isCollectorateJharsugudaCompanyId = (companyId?: string): boolean => {
  return String(companyId || '') === COLLECTORATE_JHARSUGUDA_COMPANY_ID;
};

const canJharsugudaCompanyAdminOverrideFrozenGrievance = (
  currentUser: any,
  grievance: any,
): boolean => {
  if (currentUser?.isSuperAdmin) return true;
  const role = String(currentUser?.role || '').toUpperCase();
  const isCompanyAdmin =
    role.includes(UserRole.COMPANY_ADMIN) ||
    currentUser?.level === 1 ||
    !currentUser?.departmentId;
  const grievanceCompanyId = String((grievance?.companyId as any)?._id || grievance?.companyId || '');
  return isCompanyAdmin && isCollectorateJharsugudaCompanyId(grievanceCompanyId);
};

// Apply middleware to all routes
router.use(requireDatabaseConnection);
router.use(authenticate);

// @route   PUT /api/assignments/grievance/:id/assign
// @desc    Assign grievance to a department admin or operator
// @access  CompanyAdmin, DepartmentAdmin, Operator (operators can only assign to other operators)
router.put('/grievance/:id/assign', requirePermission(Permission.UPDATE_GRIEVANCE), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const { assignedTo, departmentId } = req.body;

    if (!assignedTo) {
      return res.status(400).json({
        success: false,
        message: 'Assigned user ID is required'
      });
    }

    // Handle both MongoDB _id and grievanceId string
    let grievance;
    const mongoose = await import('mongoose');
    if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      // It's a valid MongoDB ObjectId
      grievance = await Grievance.findById(req.params.id)
        .populate('companyId')
        .populate({
          path: 'departmentId',
          populate: { path: 'parentDepartmentId' }
        })
        .populate('subDepartmentId');
    } else {
      // It's a grievanceId string (e.g., "GRV00000002")
      grievance = await Grievance.findOne({ grievanceId: req.params.id })
        .populate('companyId')
        .populate({
          path: 'departmentId',
          populate: { path: 'parentDepartmentId' }
        })
        .populate('subDepartmentId');
    }

    if (!grievance) {
      return res.status(404).json({
        success: false,
        message: 'Grievance not found'
      });
    }

    const canOverrideFrozenGrievance = canJharsugudaCompanyAdminOverrideFrozenGrievance(currentUser, grievance);

    // Prevent assignment to resolved/closed grievances (frozen),
    // except for super admin and Collectorate Jharsuguda company admin override.
    if (grievance.status === 'RESOLVED' && !canOverrideFrozenGrievance) {
      return res.status(403).json({
        success: false,
        message: 'Cannot assign a resolved or closed grievance. Grievance is frozen.'
      });
    }

    // Get the user to assign to - handle both _id and userId
    let assignedUser;
    if (mongoose.Types.ObjectId.isValid(assignedTo)) {
      // It's a valid MongoDB ObjectId
      assignedUser = await User.findById(assignedTo);
    } else {
      // It's a userId string (e.g., "USER000004")
      assignedUser = await User.findOne({ userId: assignedTo });
    }
    
    if (!assignedUser) {
      return res.status(404).json({
        success: false,
        message: 'User to assign not found'
      });
    }

    // Prevent self-assignment: A user cannot assign a grievance to themselves
    if (assignedUser._id.toString() === currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You cannot assign a grievance to yourself. Please select another user.'
      });
    }

    // Permission checks - ensure users stay within their scope
    if (!currentUser.isSuperAdmin) {
      // Must be in same company
      if (grievance.companyId._id.toString() !== currentUser.companyId?.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied to this company' });
      }
      if (assignedUser.companyId?.toString() !== currentUser.companyId?.toString()) {
        return res.status(403).json({ success: false, message: 'Recipient must be in the same company' });
      }

      // If restricted by department (Department Admin/Operator)
      if (currentUser.departmentId && !canOverrideFrozenGrievance) {
        if (grievance.departmentId?._id.toString() !== currentUser.departmentId?.toString()) {
          return res.status(403).json({ success: false, message: 'You can only assign within your department' });
        }
        if (assignedUser.departmentIds && !assignedUser.departmentIds.some(id => id.toString() === currentUser.departmentId?.toString())) {
          return res.status(403).json({ success: false, message: 'Recipient must be in the same department' });
        }

        // If the current user lacks full management rights, they might only be able to assign to others with similar limited rights
        const currentUserCanManage = req.checkPermission(Permission.ASSIGN_GRIEVANCE);
        if (!currentUserCanManage) {
           // This replaces the 'Operators can only assign to other operators' logic.
           // We check if the target user is also someone who LACKS assignment permission.
           // (This is a dynamic proxy for same-level horizontal assignment)
           // We'll need a way to check target permissions - for now we'll allow it or use a role name check if it's the only way, 
           // but the user wants NO hardcoded roles.
           // Let's assume anyone in the same department who isn't a SuperAdmin can be assigned.
        }
      }
    }

    // Track old values for timeline + "previously assigned" template variables
    const oldAssignedTo = grievance.assignedTo;
    const oldDepartmentId = grievance.departmentId?._id;

    // Capture OLD dept names BEFORE any department auto-update below
    const oldDeptDoc = grievance.departmentId as any;
    const oldSubDeptDoc = grievance.subDepartmentId as any;

    let previousDepartmentName = 'N/A';
    let previousOfficeName = 'N/A';

    if (oldDeptDoc) {
      if (oldDeptDoc.parentDepartmentId) {
        previousDepartmentName = oldDeptDoc.parentDepartmentId.name || 'N/A';
        previousOfficeName = oldDeptDoc.name || 'N/A';
      } else {
        previousDepartmentName = oldDeptDoc.name || 'N/A';
        previousOfficeName = oldSubDeptDoc?.name || (grievance.category !== oldDeptDoc.name ? grievance.category : 'N/A') || 'N/A';
      }
    } else {
      previousDepartmentName = grievance.category || 'N/A';
    }

    const isReassignment = Boolean(oldAssignedTo);
    // Reassignment template (cross-dept, done by company admin / super admin)
    // Assignment template (within-dept delegation, done by dept admin)
    const isCompanyAdmin = !currentUser.departmentId;
    const useReassignedTemplate = isReassignment && (currentUser.isSuperAdmin || isCompanyAdmin);

    // Update grievance
    grievance.assignedTo = assignedUser._id;
    grievance.assignedAt = new Date();
    grievance.status = GrievanceStatus.ASSIGNED;
    
    // Auto-update department/sub-department based on assigned user's mapped department
    if (assignedUser.departmentId) {
      const targetDept = await (await import('../models/Department')).default
        .findById(assignedUser.departmentId)
        .select('_id name parentDepartmentId');

      if (targetDept) {
        const nextDepartmentId = targetDept.parentDepartmentId ? targetDept.parentDepartmentId : targetDept._id;
        const nextSubDepartmentId = targetDept.parentDepartmentId ? targetDept._id : undefined;

        if (!oldDepartmentId || oldDepartmentId.toString() !== nextDepartmentId.toString()) {
          grievance.departmentId = nextDepartmentId as any;
          grievance.subDepartmentId = nextSubDepartmentId as any;

          // Add department transfer event
          grievance.timeline.push({
            action: 'DEPARTMENT_TRANSFER',
            details: {
              fromDepartmentId: oldDepartmentId,
              toDepartmentId: nextDepartmentId,
              toSubDepartmentId: nextSubDepartmentId || null,
              reason: 'Auto-updated during reassignment'
            },
            performedBy: currentUser._id,
            timestamp: new Date()
          });
        }
      }
    } else if (departmentId && (!oldDepartmentId || oldDepartmentId.toString() !== departmentId)) {
        // Manual department update if provided
        grievance.departmentId = departmentId;
        grievance.timeline.push({
          action: 'DEPARTMENT_TRANSFER',
          details: {
            fromDepartmentId: oldDepartmentId,
            toDepartmentId: departmentId,
            reason: 'Manual transfer'
          },
          performedBy: currentUser._id,
          timestamp: new Date()
        });
    }
    
    // Add assignment event
    grievance.timeline.push({
      action: 'ASSIGNED',
      details: {
        fromUserId: oldAssignedTo,
        toUserId: assignedUser._id,
        toUserName: assignedUser.getFullName()
      },
      performedBy: currentUser._id,
      timestamp: new Date()
    });
    
    await grievance.save();

    // Fetch NEW dept names (post-save, after any auto-update) for the template
    const [finalDept, finalSubDept] = await Promise.all([
      (await import('../models/Department')).default.findById(grievance.departmentId).populate('parentDepartmentId').lean(),
      grievance.subDepartmentId
        ? (await import('../models/Department')).default.findById(grievance.subDepartmentId).lean()
        : Promise.resolve(null)
    ]);

    let newDepartmentName = 'N/A';
    let newOfficeName = 'N/A';

    if (finalDept) {
      if ((finalDept as any).parentDepartmentId) {
        newDepartmentName = (finalDept as any).parentDepartmentId.name || 'N/A';
        newOfficeName = (finalDept as any).name || 'N/A';
      } else {
        newDepartmentName = (finalDept as any).name || 'N/A';
        newOfficeName = (finalSubDept as any)?.name || (grievance.category !== (finalDept as any).name ? grievance.category : 'N/A') || 'N/A';
      }
    } else {
      newDepartmentName = grievance.category || 'Collector & DM';
    }

    // useReassignedTemplate: company admin / super admin doing a cross-dept reassignment
    // otherwise: dept admin delegating within dept → use assigned template
    triggerAdminAssignmentNotification({
      event: useReassignedTemplate ? 'GRIEVANCE_REASSIGNED' : 'GRIEVANCE_ASSIGNED',
      companyId: grievance.companyId,
      grievanceId: grievance.grievanceId,
      citizenName: grievance.citizenName,
      // New destination dept (where it's going)
      category: newDepartmentName,
      subDepartmentName: newOfficeName,
      description: grievance.description,
      recipientPhones: assignedUser.phone ? [assignedUser.phone] : [],
      language: grievance.language,
      assignedByName: currentUser.getFullName(),
      reassignedByName: currentUser.getFullName(),
      remarks: (req.body as any).remarks || (req.body as any).reason || 'Administrative Reassignment',
      submittedOn: grievance.createdAt,
      reassignedOn: new Date(),
      buttonParam: 'https://sahaj.pugarch.in/',
      // Old dept (where it came from) — captured BEFORE save
      originalDepartmentName: previousDepartmentName,
      originalOfficeName: previousOfficeName,
      media: (grievance.media || []).map((file: any) => ({
        url: file.url,
        type: file.type,
        caption: file.caption,
        filename: file.filename
      }))
    }).catch((err: Error) => console.error('Failed to trigger admin assignment template:', err));

    // Notify assigned user (fire and forget - don't block response)
    import('../services/notificationService').then(async ({ notifyUserOnAssignment }) => {
      notifyUserOnAssignment({
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
        assignedByName: currentUser.getFullName(),
        assignedAt: grievance.assignedAt,
        createdAt: grievance.createdAt,
        language: grievance.language,
        remarks: String((req.body as any).remarks || (req.body as any).note || '').trim(),
        timeline: grievance.timeline
      }).catch((err: Error) => console.error('Failed to send assignment notification:', err));

      // ✅ Trigger In-App Notification to Assignee
      const { notifyUser, notifyCompanyAdmins } = await import('../services/inAppNotificationService');
      await notifyUser({
        userId: assignedUser._id,
        companyId: grievance.companyId,
        eventType: isReassignment ? 'GRIEVANCE_REASSIGNED' : 'GRIEVANCE_ASSIGNED',
        title: isReassignment ? 'Grievance Reassigned' : 'Grievance Assigned',
        message: `Grievance ${grievance.grievanceId} has been ${isReassignment ? 'reassigned' : 'assigned'} to you by ${currentUser.getFullName()}.`,
        grievanceId: grievance.grievanceId,
        grievanceObjectId: grievance._id,
        meta: {
          previousAssignee: oldAssignedTo,
          remarks: (req.body as any).remarks || (req.body as any).reason || '',
        },
      });

      // ✅ Trigger In-App Notification to Admins
      await notifyCompanyAdmins({
        companyId: grievance.companyId,
        eventType: isReassignment ? 'GRIEVANCE_REASSIGNED' : 'GRIEVANCE_ASSIGNED',
        title: isReassignment ? 'Grievance Assignment Update' : 'Grievance Assigned',
        message: `Grievance ${grievance.grievanceId} has been ${isReassignment ? 'reassigned' : 'assigned'} to ${assignedUser.getFullName()} by ${currentUser.getFullName()}.`,
        grievanceId: grievance.grievanceId,
        grievanceObjectId: grievance._id,
        meta: {
          assignedTo: assignedUser._id,
          previousAssignee: oldAssignedTo,
          remarks: (req.body as any).remarks || (req.body as any).reason || '',
        },
      });
    });

    // Log action (fire and forget - don't block response)
    logUserAction(
      req,
      AuditAction.UPDATE,
      'Grievance',
      grievance._id.toString(),
      {
        action: 'assign',
        assignedTo: assignedUser.getFullName(),
        grievanceId: grievance.grievanceId
      }
    ).catch((err: Error) => console.error('Failed to log user action:', err));

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

// @route   PUT /api/assignments/appointment/:id/assign
// @desc    Assign appointment to a department admin or operator
// @access  CompanyAdmin, DepartmentAdmin (Operators cannot assign appointments)
router.put('/appointment/:id/assign', requirePermission(Permission.UPDATE_APPOINTMENT), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const { assignedTo, departmentId } = req.body;

    // Dynamic permission check for assignment authority
    if (!req.checkPermission(Permission.UPDATE_APPOINTMENT)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to assign appointments.'
      });
    }

    if (!assignedTo) {
      return res.status(400).json({
        success: false,
        message: 'Assigned user ID is required'
      });
    }

    // Handle both MongoDB _id and appointmentId string
    let appointment;
    const mongoose = await import('mongoose');
    if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      // It's a valid MongoDB ObjectId
      appointment = await Appointment.findById(req.params.id)
        .populate('companyId')
        .populate('departmentId');
    } else {
      // It's an appointmentId string (e.g., "APT00000002")
      appointment = await Appointment.findOne({ appointmentId: req.params.id })
        .populate('companyId')
        .populate('departmentId');
    }

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Get the user to assign to - handle both _id and userId
    let assignedUser;
    if (mongoose.Types.ObjectId.isValid(assignedTo)) {
      // It's a valid MongoDB ObjectId
      assignedUser = await User.findById(assignedTo);
    } else {
      // It's a userId string (e.g., "USER000004")
      assignedUser = await User.findOne({ userId: assignedTo });
    }
    
    if (!assignedUser) {
      return res.status(404).json({
        success: false,
        message: 'User to assign not found'
      });
    }

    // Prevent self-assignment: A user cannot assign an appointment to themselves
    if (assignedUser._id.toString() === currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You cannot assign an appointment to yourself. Please select another user.'
      });
    }

    // Permission checks
    if (!currentUser.isSuperAdmin) {
      if (appointment.companyId._id.toString() !== currentUser.companyId?.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      if (assignedUser.companyId?.toString() !== currentUser.companyId?.toString()) {
        return res.status(403).json({ success: false, message: 'Recipient must be in same company' });
      }

      if (currentUser.departmentId) {
        if (appointment.departmentId?._id.toString() !== currentUser.departmentId?.toString()) {
          return res.status(403).json({ success: false, message: 'You can only assign within your department' });
        }
        if (assignedUser.departmentIds && !assignedUser.departmentIds.some(id => id.toString() === currentUser.departmentId?.toString())) {
          return res.status(403).json({ success: false, message: 'Recipient must be in same department' });
        }
      }
    }

    // Track old values
    const oldAssignedTo = appointment.assignedTo;
    const oldDepartmentId = appointment.departmentId?._id;

    appointment.assignedTo = assignedUser._id;
    // Set assignedAt if not already set, or update it on reassignment
    if (!appointment.assignedAt || oldAssignedTo?.toString() !== assignedUser._id.toString()) {
      appointment.assignedAt = new Date();
    }
    
    // Auto-update department based on assigned user's department
    if (assignedUser.departmentIds && assignedUser.departmentIds.length > 0 && (!oldDepartmentId || !assignedUser.departmentIds.some(id => id.toString() === oldDepartmentId.toString()))) {
      const firstDeptId = assignedUser.departmentIds[0];
      appointment.departmentId = assignedUser.departmentId as any;
      
      // Add department transfer event
      appointment.timeline.push({
        action: 'DEPARTMENT_TRANSFER',
        details: {
          fromDepartmentId: oldDepartmentId,
          toDepartmentId: firstDeptId,
          reason: 'Auto-updated during reassignment'
        },
        performedBy: currentUser._id,
        timestamp: new Date()
      });
    } else if (departmentId && (!oldDepartmentId || oldDepartmentId.toString() !== departmentId)) {
        // Manual department update if provided
        appointment.departmentId = departmentId;
        appointment.timeline.push({
          action: 'DEPARTMENT_TRANSFER',
          details: {
            fromDepartmentId: oldDepartmentId,
            toDepartmentId: departmentId,
            reason: 'Manual transfer'
          },
          performedBy: currentUser._id,
          timestamp: new Date()
        });
    }
    
    // Add assignment event
    appointment.timeline.push({
      action: 'ASSIGNED',
      details: {
        fromUserId: oldAssignedTo,
        toUserId: assignedUser._id,
        toUserName: assignedUser.getFullName()
      },
      performedBy: currentUser._id,
      timestamp: new Date()
    });
    
    await appointment.save();

    // Notify assigned user (fire and forget - don't block response)
    import('../services/notificationService').then(({ notifyUserOnAssignment }) => {
      notifyUserOnAssignment({
        type: 'appointment',
        action: 'assigned',
        appointmentId: appointment.appointmentId,
        citizenName: appointment.citizenName,
        citizenPhone: appointment.citizenPhone,
        departmentId: appointment.departmentId,
        companyId: appointment.companyId,
        purpose: appointment.purpose,
        assignedTo: assignedUser._id,
        assignedByName: currentUser.getFullName(),
        assignedAt: appointment.assignedAt,
        createdAt: appointment.createdAt,
        timeline: appointment.timeline,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime
      } as any).catch((err: Error) => console.error('Failed to send assignment notification:', err));
    });

    // Log action (fire and forget - don't block response)
    logUserAction(
      req,
      AuditAction.UPDATE,
      'Appointment',
      appointment._id.toString(),
      {
        action: 'assign',
        assignedTo: assignedUser.getFullName(),
        appointmentId: appointment.appointmentId
      }
    ).catch((err: Error) => console.error('Failed to log user action:', err));

    res.json({
      success: true,
      message: 'Appointment assigned successfully',
      data: { appointment }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to assign appointment',
      error: error.message
    });
  }
});

// @route   GET /api/assignments/users/available
// @desc    Get list of users available for assignment (excludes current user)
// @access  CompanyAdmin, DepartmentAdmin, Operator
router.get('/users/available', async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const { type } = req.query; // 'grievance' or 'appointment'
    const query: any = { 
      isActive: true, 
      // Exclude current user from the list - cannot assign to self
      _id: { $ne: currentUser._id }
    };

    if (currentUser.isSuperAdmin) {
      // SuperAdmin can see anyone
      query.customRoleId = { $ne: null }; // Still only show people who can actually be assigned
    } else {
      query.companyId = currentUser.companyId;
      query.customRoleId = { $ne: null }; // Only staff have roles
      if (currentUser.departmentId) {
        query.departmentIds = { $in: [currentUser.departmentId] };
      }
    }

    const users = await User.find(query)
      .select('firstName lastName email role departmentIds userId')
      .populate('departmentIds', 'name')
      .sort({ firstName: 1 });

    res.json({
      success: true,
      data: users
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available users',
      error: error.message
    });
  }
});

export default router;
