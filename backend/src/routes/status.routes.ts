import express, { Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { requireDatabaseConnection } from '../middleware/dbConnection';
import { Permission, UserRole, GrievanceStatus, AppointmentStatus } from '../config/constants';
import Grievance from '../models/Grievance';
import Appointment from '../models/Appointment';
import Company from '../models/Company';
import { logUserAction } from '../utils/auditLogger';
import { AuditAction } from '../config/constants';
import { sendWhatsAppMessage } from '../services/whatsappService';
import { uploadBufferToGCS, getSignedUrl } from '../services/gcsService';
import User from '../models/User';
import { formatTemplateDate } from '../services/grievanceTemplateTriggerService';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

const COLLECTORATE_JHARSUGUDA_COMPANY_ID = '69ad4c6eb1ad8e405e6c0858';

const uploadBufferToGCSWrapper = async (
  file: Express.Multer.File,
  companyId: string,
  grievanceId?: string
): Promise<string | null> => {
  const folder = grievanceId 
    ? `grievances/${grievanceId}/evidence` 
    : `status_documents/${companyId}`;
    
  return await uploadBufferToGCS(
    file.buffer,
    file.originalname,
    file.mimetype,
    folder
  );
};

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

// All routes require database connection and authentication
router.use(requireDatabaseConnection);
router.use(authenticate);

// Status update messages for WhatsApp
const getStatusMessage = (type: 'grievance' | 'appointment', id: string, status: string, remarks?: string) => {
  const emoji = {
    PENDING: '⏳',
    ASSIGNED: '👤',
    IN_PROGRESS: '🛠️',
    RESOLVED: '✅',
    SCHEDULED: '📅',
    COMPLETED: '🎉',
    CANCELLED: '❌'
  }[status] || '📋';

  const typeName = type === 'grievance' ? 'Grievance' : 'Appointment';
  
  let message = `${emoji} *${typeName} Status Update*\n\n`;
  message += `ID: *${id}*\n`;
  message += `Status: *${status.replace('_', ' ')}*\n`;
  
  if (remarks) {
    message += `\nRemarks: ${remarks}\n`;
  }
  
  message += `\nThank you for your patience. We are committed to serving you better.`;
  
  return message;
};

// @route   PUT /api/status/grievance/:id
// @desc    Update grievance status and notify citizen via WhatsApp
// @access  DepartmentAdmin, Operator, CompanyAdmin
router.put('/grievance/:id', requirePermission(Permission.STATUS_CHANGE_GRIEVANCE, Permission.UPDATE_GRIEVANCE), upload.array('documents', 5), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const { status, remarks } = req.body;
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    console.log('[STATUS_LOG] Grievance:', req.params.id, 'Files:', uploadedFiles.length);

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // Validate status
    const validStatuses = Object.values(GrievanceStatus);
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    // Restricted Update: If user has 'change status' but NOT full 'update' permission, limit fields
    if (!req.checkPermission(Permission.UPDATE_GRIEVANCE)) {
      const allowedFields = ['status', 'remarks'];
      const providedFields = Object.keys(req.body);
      const invalidFields = providedFields.filter(field => !allowedFields.includes(field));
      
      if (invalidFields.length > 0) {
        return res.status(403).json({ 
          success: false, 
          message: 'Your role only allows updating status and remarks.' 
        });
      }
    }

    const grievance = await Grievance.findById(req.params.id)
      .populate('companyId')
      .populate('departmentId')
      .populate('subDepartmentId');

    if (!grievance) {
      return res.status(404).json({
        success: false,
        message: 'Grievance not found'
      });
    }

    // Prevent updates to resolved/rejected grievances (frozen)
    const oldStatus = grievance.status;
    const canOverrideFrozenGrievance = canJharsugudaCompanyAdminOverrideFrozenGrievance(currentUser, grievance);
    if ((oldStatus === GrievanceStatus.RESOLVED || oldStatus === GrievanceStatus.REJECTED) && !canOverrideFrozenGrievance) {
      return res.status(403).json({
        success: false,
        message: 'Cannot update a resolved or rejected grievance. Grievance is frozen.'
      });
    }

    // 🔒 Strict Status Transition Logic for non-admins
    const isCompanyAdmin = currentUser.level === 1 || !currentUser.departmentId;
    if (!currentUser.isSuperAdmin && !isCompanyAdmin) {
      const statusPriority: Record<string, number> = {
        [GrievanceStatus.PENDING]: 1,
        [GrievanceStatus.ASSIGNED]: 1,
        [GrievanceStatus.IN_PROGRESS]: 2,
        [GrievanceStatus.RESOLVED]: 3,
        [GrievanceStatus.REJECTED]: 3,
      };

      const currentPrio = statusPriority[oldStatus] || 0;
      const nextPrio = statusPriority[status] || 0;

      if (nextPrio < currentPrio) {
        return res.status(403).json({
          success: false,
          message: `Status regression from ${oldStatus} to ${status} is not allowed. Only Company Admins or higher can reopen or revert grievances.`
        });
      }
    }

    // Permission checks
    if (!currentUser.isSuperAdmin) {
      if (grievance.companyId._id.toString() !== currentUser.companyId?.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied to this company' });
      }

      if (currentUser.departmentId && !canOverrideFrozenGrievance) {
        const grievanceDepartmentId = (grievance.departmentId as any)?._id?.toString() || grievance.departmentId?.toString();
        const grievanceSubDepartmentId = (grievance.subDepartmentId as any)?._id?.toString() || grievance.subDepartmentId?.toString();
        
        // 👮 Check if explicitly assigned to this user (Assignment overrides department scope)
        const isAssignedToMe = grievance.assignedTo?.toString() === currentUser._id.toString();
        const isAdditionalAssignee = grievance.additionalAssigneeIds?.some(id => id.toString() === currentUser._id.toString());

        if (!isAssignedToMe && !isAdditionalAssignee) {
          // If not assigned, check if user is in the correct department scope
          const userDeptIds = currentUser.departmentIds?.map(id => id.toString()) || [];
          const primaryDeptId = currentUser.departmentId?.toString();
          if (primaryDeptId && !userDeptIds.includes(primaryDeptId)) userDeptIds.push(primaryDeptId);

          const isInDepartmentScope = 
            (grievanceDepartmentId && userDeptIds.includes(grievanceDepartmentId)) || 
            (grievanceSubDepartmentId && userDeptIds.includes(grievanceSubDepartmentId));

          if (!isInDepartmentScope) {
            return res.status(403).json({ success: false, message: 'Access denied to this department' });
          }
        }
      }
    }

    grievance.status = status;

    // Reassignment logic for resolved grievances
    if (
      oldStatus === GrievanceStatus.RESOLVED &&
      status !== GrievanceStatus.RESOLVED &&
      canOverrideFrozenGrievance
    ) {
      const lastResolver = [...(grievance.statusHistory || [])]
        .reverse()
        .find((entry: any) => entry.status === GrievanceStatus.RESOLVED && entry.changedBy);

      if (lastResolver?.changedBy) {
        grievance.assignedTo = lastResolver.changedBy;
        grievance.assignedAt = new Date();

        if (!grievance.timeline) grievance.timeline = [];
        grievance.timeline.push({
          action: 'ASSIGNED',
          details: {
            reason: 'Reassigned to resolver after post-resolution status change',
            toUserId: lastResolver.changedBy
          },
          performedBy: currentUser._id,
          timestamp: new Date()
        });
      }
    }

    const uploadedDocumentUrls: string[] = [];
    const uploadedMediaForNotifications: Array<{ url: string; type: 'image' | 'video' | 'document'; filename?: string }> = [];
    if (uploadedFiles.length > 0) {
      if (!Array.isArray(grievance.media)) grievance.media = [] as any;
      const uploadResults = await Promise.all(
        uploadedFiles.map(async (file) => {
          const cloudUrl = await uploadBufferToGCSWrapper(
            file,
            String(grievance.companyId._id || grievance.companyId),
            grievance.grievanceId
          );
          if (!cloudUrl) return null;
          return {
            cloudUrl,
            mediaEntry: {
              url: cloudUrl,
              type: ((): 'image' | 'video' | 'document' => {
                const mimeType = file.mimetype.toLowerCase();
                const fileName = file.originalname.toLowerCase();
                if (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic)$/.test(fileName)) return 'image';
                if (mimeType.startsWith('video/') || /\.(mp4|mov|avi|3gp|m4v|webm|mkv)$/.test(fileName)) return 'video';
                return 'document';
              })(),
              mimeType: file.mimetype,
              originalName: file.originalname,
              uploadedByRole: 'admin',
              uploadedAt: new Date(),
              uploadedBy: currentUser._id,
              isGCS: true
            } as any
          };
        })
      );

      for (const result of uploadResults) {
        if (!result) continue;
        uploadedDocumentUrls.push(result.cloudUrl);
        
        // Ensure result.mediaEntry has all necessary fields
        const mediaEntry = {
          ...result.mediaEntry,
          uploadedByRole: 'admin',
          uploadedBy: currentUser._id,
          uploadedAt: new Date(),
          isGCS: true
        };
        
        grievance.media.push(mediaEntry);
        uploadedMediaForNotifications.push({
          url: result.cloudUrl,
          type: result.mediaEntry.type,
          filename: result.mediaEntry.originalName
        });
      }
      // Explicitly mark as modified for Mixed/Array types
      grievance.markModified('media');
      console.log(`📦 [Status Update] Prepared ${uploadedMediaForNotifications.length} media items for WhatsApp notification.`);
    }

    // Add to status history
    if (!grievance.statusHistory) grievance.statusHistory = [];
    grievance.statusHistory.push({
      status,
      remarks,
      changedBy: currentUser._id,
      changedAt: new Date()
    });

    // Update timestamps
    if (status === GrievanceStatus.RESOLVED && !grievance.resolvedAt) {
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
        media: uploadedMediaForNotifications
      },
      performedBy: currentUser._id,
      timestamp: new Date()
    });

    grievance.markModified('timeline');
grievance.markModified('media');
await grievance.save();

    // 🚀 BACKGROUND NOTIFICATIONS
    (async () => {
      try {
        const { notifyHierarchyOnStatusChange } = await import('../services/notificationService');
        const { triggerCitizenStatusTemplate } = await import('../services/grievanceTemplateTriggerService');

        const resolvedCompanyId = (grievance.companyId as any)?._id || grievance.companyId;
        const resolvedDeptId = (grievance.departmentId as any)?._id || grievance.departmentId;
        const resolvedSubDeptId = (grievance.subDepartmentId as any)?._id || grievance.subDepartmentId;
        const departmentName = (grievance.departmentId as any)?.name || 'Department';

        const notificationTasks: Promise<any>[] = [];

        if (oldStatus !== status || uploadedDocumentUrls.length > 0) {
          notificationTasks.push(notifyHierarchyOnStatusChange({
            type: 'grievance',
            action: (status === GrievanceStatus.RESOLVED ? 'resolved' : 'status_update') as any,
            grievanceId: grievance.grievanceId,
            citizenName: grievance.citizenName,
            citizenPhone: grievance.citizenPhone,
            departmentId: resolvedDeptId,
            subDepartmentId: resolvedSubDeptId,
            companyId: resolvedCompanyId,
            assignedTo: grievance.assignedTo,
            remarks,
            evidenceUrls: uploadedDocumentUrls,
            resolvedBy: currentUser._id,
            resolvedAt: grievance.resolvedAt,
            createdAt: grievance.createdAt,
            assignedAt: grievance.assignedAt,
            timeline: grievance.timeline
          }, oldStatus, status));

          const { getLocalizedDepartmentName } = await import('../services/notificationService');
          const lang = (grievance.language || 'en') as any;
          
          // Get the actual admin who performed the action
          const adminUser = await User.findById(currentUser._id).select('firstName lastName designations').lean();
          const adminName = adminUser 
            ? `${adminUser.firstName || ''} ${adminUser.lastName || ''}${adminUser.designations?.[0] ? ` (${adminUser.designations[0]})` : ''}`.trim() 
            : 'Administrator';

          notificationTasks.push(triggerCitizenStatusTemplate({
            companyId: resolvedCompanyId,
            grievanceId: grievance.grievanceId,
            citizenName: grievance.citizenName,
            citizenPhone: grievance.citizenPhone,
            language: grievance.language,
            departmentName: grievance.departmentId ? getLocalizedDepartmentName(grievance.departmentId, lang) : 'N/A',
            subDepartmentName: grievance.subDepartmentId ? getLocalizedDepartmentName(grievance.subDepartmentId, lang) : 'N/A',
            grievanceSummary: grievance.description,
            status,
            remarks: remarks || undefined,
            resolvedByName: adminName || 'Administrator',
            formattedResolvedDate: formatTemplateDate(),
            media: uploadedMediaForNotifications
          }));
        }

        await Promise.allSettled(notificationTasks);
      } catch (err) {
        console.error(`[StatusUpdate] ❌ Background notification error for grievance ${grievance?.grievanceId}:`, err);
      }
    })();

    // 🚀 BACKGROUND AUDIT LOGGING
    logUserAction(
      req,
      AuditAction.UPDATE,
      'Grievance',
      grievance._id.toString(),
      {
        action: 'status_change',
        oldStatus,
        newStatus: status,
        remarks,
        uploadedDocumentUrls,
        grievanceId: grievance.grievanceId
      }
    ).catch(err => console.error('[StatusUpdate] Audit log failed:', err));

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
                if (typeof mediaItem === 'string') return await getSignedUrl(mediaItem);
                if (mediaItem && typeof mediaItem === 'object' && mediaItem.url) {
                  return { ...mediaItem, url: await getSignedUrl(mediaItem.url) };
                }
                return mediaItem;
              })
            );
            return { ...event, details: { ...event.details, media: signedTimelineMedia } };
          }
          return event;
        })
      );
    }

    res.json({
      success: true,
      message: 'Grievance status updated successfully. Citizen has been notified via WhatsApp.',
      data: { grievance: grievanceObj }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to update grievance status',
      error: error.message
    });
  }
});

// @route   PUT /api/status/appointment/:id
router.put('/appointment/:id', requirePermission(Permission.STATUS_CHANGE_APPOINTMENT, Permission.UPDATE_APPOINTMENT), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const { status, remarks, appointmentDate, appointmentTime, description } = req.body;

    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

    const validStatuses = Object.values(AppointmentStatus);
    if (!validStatuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status value' });

    const appointment = await Appointment.findById(req.params.id).populate('companyId').populate('departmentId');
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });

    if (!currentUser.isSuperAdmin) {
      if (appointment.companyId._id.toString() !== currentUser.companyId?.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied to this company' });
      }
      
      if (currentUser.departmentId) {
        const isAssignedToMe = appointment.assignedTo?.toString() === currentUser._id.toString();
        const userDeptIds = currentUser.departmentIds?.map(id => id.toString()) || [];
        const primaryDeptId = currentUser.departmentId?.toString();
        if (primaryDeptId && !userDeptIds.includes(primaryDeptId)) userDeptIds.push(primaryDeptId);

        const appointmentDeptId = (appointment.departmentId as any)?._id?.toString() || appointment.departmentId?.toString();
        const appointmentSubDeptId = (appointment.subDepartmentId as any)?._id?.toString() || appointment.subDepartmentId?.toString();

        const isInDepartmentScope = 
          (appointmentDeptId && userDeptIds.includes(appointmentDeptId)) || 
          (appointmentSubDeptId && userDeptIds.includes(appointmentSubDeptId));

        if (!isAssignedToMe && !isInDepartmentScope) {
          return res.status(403).json({ success: false, message: 'Access denied to this department' });
        }
      }
    }

    const oldStatus = appointment.status;
    appointment.status = status;

    if (status === AppointmentStatus.CONFIRMED) {
      if (!appointmentDate || !appointmentTime) return res.status(400).json({ success: false, message: 'Appointment date and time are required when confirming appointment' });
      appointment.appointmentDate = new Date(appointmentDate);
      appointment.appointmentTime = appointmentTime;
      if (description) appointment.notes = description;
    }

    if (!appointment.statusHistory) appointment.statusHistory = [];
    appointment.statusHistory.push({ status, remarks, changedBy: currentUser._id, changedAt: new Date() });

    if (status === AppointmentStatus.COMPLETED && !appointment.completedAt) {
      appointment.completedAt = new Date();
    } else if (status === AppointmentStatus.CANCELLED && !appointment.cancelledAt) {
      appointment.cancelledAt = new Date();
    }

    if (!appointment.timeline) appointment.timeline = [];
    appointment.timeline.push({
      action: 'STATUS_UPDATED',
      details: { fromStatus: oldStatus, toStatus: status, remarks },
      performedBy: currentUser._id,
      timestamp: new Date()
    });

    await appointment.save();

    // 🚀 BACKGROUND NOTIFICATIONS
    (async () => {
      try {
        const { notifyCitizenOnAppointmentStatusChange, notifyHierarchyOnStatusChange } = await import('../services/notificationService');
        if (oldStatus !== status) {
          await Promise.allSettled([
            notifyCitizenOnAppointmentStatusChange({
              appointmentId: appointment.appointmentId,
              citizenName: appointment.citizenName,
              citizenPhone: appointment.citizenPhone,
              citizenWhatsApp: appointment.citizenWhatsApp,
              companyId: appointment.companyId,
              oldStatus,
              newStatus: status,
              remarks: remarks || '',
              appointmentDate: appointment.appointmentDate,
              appointmentTime: appointment.appointmentTime,
              purpose: appointment.purpose
            }),
            notifyHierarchyOnStatusChange({
              type: 'appointment',
              action: (status === AppointmentStatus.COMPLETED || status === AppointmentStatus.CANCELLED) ? 'resolved' : 'status_update', 
              appointmentId: appointment.appointmentId,
              citizenName: appointment.citizenName,
              citizenPhone: appointment.citizenPhone,
              departmentId: appointment.departmentId,
              companyId: appointment.companyId,
              remarks: remarks || '',
              resolvedBy: currentUser._id,
              resolvedAt: new Date(),
              createdAt: appointment.createdAt,
              appointmentDate: appointment.appointmentDate,
              appointmentTime: appointment.appointmentTime,
              timeline: appointment.timeline
            }, oldStatus, status)
          ]);
        }
      } catch (err) {
        console.error(`[StatusUpdate] ❌ Background notification error for appointment ${appointment?.appointmentId}:`, err);
      }
    })();

    // 🚀 BACKGROUND AUDIT LOGGING
    logUserAction(
      req,
      AuditAction.UPDATE,
      'Appointment',
      appointment._id.toString(),
      {
        action: 'status_change',
        oldStatus,
        newStatus: status,
        remarks,
        appointmentId: appointment.appointmentId
      }
    ).catch(err => console.error('[AppointmentStatusUpdate] Audit log failed:', err));

    res.json({
      success: true,
      message: 'Appointment status updated successfully. Citizen has been notified via WhatsApp.',
      data: { appointment }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to update appointment status', error: error.message });
  }
});

export default router;
