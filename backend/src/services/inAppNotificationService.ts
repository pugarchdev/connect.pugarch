import mongoose from 'mongoose';
import Notification, { NotificationEventType } from '../models/Notification';
import User from '../models/User';
import RoleModel from '../models/Role'; // Explicitly import to ensure registration

import { logger } from '../config/logger';

const log = (msg: string) => logger.info(`[InAppNotification] ${msg}`);

const toObjectId = (id: any): mongoose.Types.ObjectId | null => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  
  // Handle populated objects
  const finalId = (typeof id === 'object' && id._id) ? id._id : id;
  
  try {
    const strId = String(finalId);
    if (!strId || strId === '[object Object]' || strId.length !== 24) return null;
    return new mongoose.Types.ObjectId(strId);
  } catch {
    return null;
  }
};

export async function notifyCompanyAdmins(options: {
  companyId: string | mongoose.Types.ObjectId;
  eventType: NotificationEventType;
  title: string;
  message: string;
  grievanceId?: string;
  grievanceObjectId?: string | mongoose.Types.ObjectId;
  meta?: Record<string, any>;
}) {
  const companyObjectId = toObjectId(options.companyId);
  log(`notifyCompanyAdmins: Starting discovery for company ${options.companyId}`);
  if (!companyObjectId) {
    log('❌ notifyCompanyAdmins: Invalid companyId');
    return;
  }

  try {
    // Discovery admins via aggregation to handle custom roles and hierarchy levels correctly
    const admins = await User.aggregate([
      {
        $match: {
          isActive: true,
          $or: [
            { isSuperAdmin: true },
            { companyId: companyObjectId }
          ]
        }
      },
      {
        $lookup: {
          from: 'roles',
          localField: 'customRoleId',
          foreignField: '_id',
          as: 'roleInfo'
        }
      },
      {
        $unwind: {
          path: '$roleInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $match: {
          $or: [
            { isSuperAdmin: true },
            { 'roleInfo.level': { $lte: 3 } }, // Level 1 (Company), 2 (Dept), 3 (Sub-Dept)
            { level: { $lte: 3 } },            // Fallback for direct level field
            { role: { $in: ['COMPANY_ADMIN', 'DEPARTMENT_ADMIN', 'SUB_DEPARTMENT_ADMIN'] } }
          ]
        }
      },
      {
        $project: { _id: 1, email: 1, firstName: 1 }
      }
    ]);

    log(`notifyCompanyAdmins: Found ${admins.length} admins to notify: ${admins.map(a => a.firstName || a.email).join(', ')}`);

    if (admins.length === 0) return;

    const notificationDocs = admins.map((admin) => ({
      userId: admin._id,
      companyId: companyObjectId,
      eventType: options.eventType,
      title: options.title,
      message: options.message,
      grievanceId: options.grievanceId,
      grievanceObjectId: toObjectId(options.grievanceObjectId),
      meta: options.meta || {},
      isRead: false,
    }));

    const result = await Notification.insertMany(notificationDocs);
    log(`✅ notifyCompanyAdmins: Inserted ${result.length} notifications`);
  } catch (error: any) {
    log(`❌ notifyCompanyAdmins: Error: ${error.message}`);
    console.error('❌ notifyCompanyAdmins failed:', error);
  }
}

/**
 * Notify admins associated with a specific department (and its upper hierarchy)
 */
export async function notifyDepartmentAdmins(options: {
  companyId: string | mongoose.Types.ObjectId;
  departmentId: string | mongoose.Types.ObjectId;
  eventType: NotificationEventType;
  title: string;
  message: string;
  grievanceId?: string;
  grievanceObjectId?: string | mongoose.Types.ObjectId;
  meta?: Record<string, any>;
}) {
  const companyObjectId = toObjectId(options.companyId);
  const departmentObjectId = toObjectId(options.departmentId);
  log(`notifyDepartmentAdmins: Starting discovery for dept ${options.departmentId}`);

  if (!companyObjectId || !departmentObjectId) {
    log('❌ notifyDepartmentAdmins: Invalid IDs');
    return;
  }

  try {
    // 1. Get hierarchical department IDs (Self + Parents for higher hierarchy notifications)
    const { getDepartmentParentHierarchyIds } = await import('../utils/departmentUtils');
    const deptIds = await getDepartmentParentHierarchyIds([departmentObjectId.toString()]);
    const deptObjectIds = deptIds.map(id => toObjectId(id)).filter(Boolean);

    // 2. Discovery admins (Company Admins + Admins in this Dept chain)
    const admins = await User.aggregate([
      {
        $match: {
          isActive: true,
          $or: [
            { isSuperAdmin: true },
            { companyId: companyObjectId }
          ]
        }
      },
      {
        $lookup: {
          from: 'roles',
          localField: 'customRoleId',
          foreignField: '_id',
          as: 'roleInfo'
        }
      },
      {
        $unwind: {
          path: '$roleInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $match: {
          $or: [
            { isSuperAdmin: true },
            { 'roleInfo.level': 1 }, // Company Admin always gets it
            { level: 1 },
            { role: 'COMPANY_ADMIN' },
            {
              // Department-level users must ALSO have an admin role
              $and: [
                {
                  $or: [
                    { departmentId: { $in: deptObjectIds } },
                    { departmentIds: { $in: deptObjectIds } }
                  ]
                },
                {
                  $or: [
                    { 'roleInfo.key': { $regex: /ADMIN|HEAD|HOD/i } },
                    { 'roleInfo.name': { $regex: /admin|head|hod|tahasildar|officer/i } },
                    { level: { $lte: 3 } },
                    { role: { $in: ['DEPARTMENT_ADMIN', 'SUB_DEPARTMENT_ADMIN'] } }
                  ]
                }
              ]
            }
          ]
        }
      },
      {
        $project: { _id: 1, firstName: 1 }
      }
    ]);

    log(`notifyDepartmentAdmins: Found ${admins.length} admins to notify`);

    if (admins.length === 0) return;

    const notificationDocs = admins.map((admin) => ({
      userId: admin._id,
      companyId: companyObjectId,
      eventType: options.eventType,
      title: options.title,
      message: options.message,
      grievanceId: options.grievanceId,
      grievanceObjectId: toObjectId(options.grievanceObjectId),
      meta: options.meta || {},
      isRead: false,
    }));

    const result = await Notification.insertMany(notificationDocs);
    log(`✅ notifyDepartmentAdmins: Inserted ${result.length} notifications`);
  } catch (error: any) {
    log(`❌ notifyDepartmentAdmins: Error: ${error.message}`);
    console.error('❌ notifyDepartmentAdmins failed:', error);
  }
}

export async function notifyUser(options: {
  userId: string | mongoose.Types.ObjectId;
  companyId: string | mongoose.Types.ObjectId;
  eventType: NotificationEventType;
  title: string;
  message: string;
  grievanceId?: string;
  grievanceObjectId?: string | mongoose.Types.ObjectId;
  meta?: Record<string, any>;
}) {
  const userObjectId = toObjectId(options.userId);
  const companyObjectId = toObjectId(options.companyId);

  if (!userObjectId || !companyObjectId) {
    log(`❌ notifyUser: Invalid IDs (User: ${options.userId}, Company: ${options.companyId})`);
    return;
  }

  try {
    const notification = new Notification({
      userId: userObjectId,
      companyId: companyObjectId,
      eventType: options.eventType,
      title: options.title,
      message: options.message,
      grievanceId: options.grievanceId,
      grievanceObjectId: toObjectId(options.grievanceObjectId),
      meta: options.meta || {},
      isRead: false,
    });

    await notification.save();
    log(`✅ notifyUser: Sent to user ${options.userId} (Event: ${options.eventType})`);
  } catch (error: any) {
    log(`❌ notifyUser: Error: ${error.message}`);
    console.error('❌ notifyUser failed:', error);
  }
}

