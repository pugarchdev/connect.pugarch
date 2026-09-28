import mongoose from 'mongoose';
import Grievance from '../models/Grievance';
import Company from '../models/Company';
import User from '../models/User';
import Department from '../models/Department';
import { GrievanceStatus } from '../config/constants';
import { logger } from '../config/logger';
import { normalizePhoneNumber } from '../utils/phoneUtils';
import { triggerGrievanceEvent } from './grievanceTemplateTriggerService';
import { getHierarchicalDepartmentAdmins } from './notificationService';
import { notifyCompanyAdmins, notifyDepartmentAdmins, notifyUser } from './inAppNotificationService';

let cronHandle: NodeJS.Timeout | null = null;
let isJobRunning = false;

// 48 hours threshold between Reminder 1 and Reminder 2
const LEVEL_2_HOURS = 48;
// 24 hours threshold after Reminder 2 to escalate to Collector
const LEVEL_3_HOURS = 24;

/**
 * Execute a single cycle of the SLA Escalation Scanner
 */
export async function runSlaEscalationScan(): Promise<{
  scanned: number;
  level1Sent: number;
  level2Sent: number;
  level3Escalated: number;
}> {
  if (isJobRunning) {
    logger.warn('⚠️ SLA Escalation scan already in progress. Skipping this cycle.');
    return { scanned: 0, level1Sent: 0, level2Sent: 0, level3Escalated: 0 };
  }

  isJobRunning = true;
  const stats = { scanned: 0, level1Sent: 0, level2Sent: 0, level3Escalated: 0 };

  try {
    const now = new Date();

    // 1. Fetch active companies
    const activeCompanies = await Company.find({ isActive: true }).select('_id name slaSettings').lean();
    if (!activeCompanies.length) {
      return stats;
    }

    const activeStatuses = [
      GrievanceStatus.PENDING,
      GrievanceStatus.ASSIGNED,
      GrievanceStatus.IN_PROGRESS,
      GrievanceStatus.REVERTED,
      'OPEN'
    ];

    for (const company of activeCompanies) {
      const companyId = company._id;

      // 2. Find all active grievances assigned to an officer
      const grievances = await Grievance.find({
        companyId,
        assignedTo: { $ne: null },
        status: { $in: activeStatuses }
      })
        .populate('departmentId', 'name')
        .populate('subDepartmentId', 'name')
        .populate('assignedTo', 'firstName lastName phone notificationSettings')
        .lean();

      stats.scanned += grievances.length;

      for (const rawGrievance of grievances) {
        try {
          const grievance = rawGrievance as any;
          const createdDate = new Date(grievance.createdAt);
          const hoursSinceCreated = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60);
          const slaHours = grievance.slaHours || company.slaSettings?.defaultSlaHours || 120;
          const isOverdue = hoursSinceCreated >= slaHours;

          if (!isOverdue) continue;

          const reminderCount = Number(grievance.reminderCount || 0);
          const lastReminderAt = grievance.lastReminderAt ? new Date(grievance.lastReminderAt) : null;
          const hoursSinceLastReminder = lastReminderAt
            ? (now.getTime() - lastReminderAt.getTime()) / (1000 * 60 * 60)
            : Infinity;

          const assignedUser = grievance.assignedTo;
          if (!assignedUser || !assignedUser.phone) continue;

          const departmentName = grievance.departmentId?.name || grievance.category || 'Collectorate';
          const officeName = grievance.subDepartmentId?.name || 'N/A';
          const officerName = `${assignedUser.firstName || ''} ${assignedUser.lastName || ''}`.trim() || 'Officer';

          // ==========================================================
          // 🚨 ESCALATION LEVEL 1: SLA Breached, 0 Reminders Sent
          // ==========================================================
          if (reminderCount === 0) {
            const nextCount = 1;
            const remarks = `Automated SLA Breach Notice: Grievance has exceeded the ${slaHours}h resolution SLA. Kindly investigate and resolve urgently.`;

            // Update DB
            await Grievance.updateOne(
              { _id: grievance._id },
              {
                $set: {
                  reminderCount: nextCount,
                  lastReminderAt: now,
                  lastReminderRemarks: remarks
                },
                $push: {
                  timeline: {
                    action: 'REMINDER_SENT',
                    details: { remarks, reminderCount: nextCount, triggerType: 'AUTO_CRON', level: 1 },
                    timestamp: now
                  },
                  reminderHistory: {
                    reminderNumber: nextCount,
                    sentAt: now,
                    sentBy: null,
                    triggerType: 'AUTO_CRON',
                    remarks,
                    channel: 'WHATSAPP'
                  }
                }
              }
            );

            // In-app notification to officer
            await notifyUser({
              userId: assignedUser._id,
              companyId,
              eventType: 'GRIEVANCE_REMINDER',
              title: 'SLA Overdue Reminder #1',
              message: `Grievance ${grievance.grievanceId} is overdue. Please review and resolve.`,
              grievanceId: grievance.grievanceId,
              grievanceObjectId: grievance._id,
              meta: { reminderCount: nextCount, remarks }
            });

            // WhatsApp template to officer
            await triggerGrievanceEvent({
              eventKey: 'GRIEVANCE_REMINDER',
              companyId,
              language: grievance.language || 'en',
              grievance,
              recipientPhones: [assignedUser.phone],
              citizenPhone: grievance.citizenPhone,
              admin: { fullName: officerName },
              remarks,
              department: { name: departmentName },
              subDept: { name: officeName },
              submittedOn: grievance.createdAt
            }).catch(err => {
              logger.error(`❌ [SLA Cron] WhatsApp delivery failed for Grievance ${grievance.grievanceId} (Level 1): ${err.message}`);
            });

            stats.level1Sent++;
            logger.info(`📢 [SLA Cron] Level 1 Reminder sent for ${grievance.grievanceId} to ${officerName}`);
          }

          // ==========================================================
          // 🚨 ESCALATION LEVEL 2: 48h after Reminder 1, Still Unresolved
          // ==========================================================
          else if (reminderCount === 1 && hoursSinceLastReminder >= LEVEL_2_HOURS) {
            const nextCount = 2;
            const remarks = `2nd Overdue Warning: Grievance remains unresolved 48h after initial reminder. Direct intervention required.`;

            // Mark as potential defaulter
            await Grievance.updateOne(
              { _id: grievance._id },
              {
                $set: {
                  reminderCount: nextCount,
                  lastReminderAt: now,
                  lastReminderRemarks: remarks,
                  isDefaulterIgnored: true
                },
                $push: {
                  timeline: {
                    action: 'REMINDER_SENT',
                    details: { remarks, reminderCount: nextCount, triggerType: 'AUTO_CRON', level: 2 },
                    timestamp: now
                  },
                  reminderHistory: {
                    reminderNumber: nextCount,
                    sentAt: now,
                    sentBy: null,
                    triggerType: 'AUTO_CRON',
                    remarks,
                    channel: 'WHATSAPP'
                  }
                }
              }
            );

            // Fetch Hierarchical Department Admins
            const targetDeptId = grievance.subDepartmentId?._id || grievance.subDepartmentId || grievance.departmentId?._id || grievance.departmentId;
            const hierarchyAdmins = await getHierarchicalDepartmentAdmins(targetDeptId);

            const recipientPhones = Array.from(
              new Set([
                normalizePhoneNumber(assignedUser.phone),
                ...hierarchyAdmins.map((admin: any) => normalizePhoneNumber(admin?.phone))
              ].filter(Boolean) as string[])
            );

            // In-app notifications: Officer & Dept Head
            await notifyUser({
              userId: assignedUser._id,
              companyId,
              eventType: 'GRIEVANCE_REMINDER',
              title: 'Critical Overdue Reminder #2',
              message: `Grievance ${grievance.grievanceId} remains unresolved after 2 reminders. Escalated to Department Head.`,
              grievanceId: grievance.grievanceId,
              grievanceObjectId: grievance._id,
              meta: { reminderCount: nextCount, remarks }
            });

            if (targetDeptId) {
              await notifyDepartmentAdmins({
                companyId,
                departmentId: targetDeptId,
                eventType: 'GRIEVANCE_REMINDER',
                title: 'Staff Overdue Escalation (Reminder #2)',
                message: `Officer ${officerName} has not resolved grievance ${grievance.grievanceId} after 2 reminders.`,
                grievanceId: grievance.grievanceId,
                grievanceObjectId: grievance._id,
                meta: { reminderCount: nextCount, officerName, remarks }
              });
            }

            // WhatsApp notifications to officer & department admins
            await Promise.allSettled(
              recipientPhones.map(phone =>
                triggerGrievanceEvent({
                  eventKey: 'GRIEVANCE_REMINDER',
                  companyId,
                  language: grievance.language || 'en',
                  grievance,
                  recipientPhones: [phone],
                  citizenPhone: grievance.citizenPhone,
                  admin: { fullName: officerName },
                  remarks,
                  department: { name: departmentName },
                  subDept: { name: officeName },
                  submittedOn: grievance.createdAt
                })
              )
            );

            stats.level2Sent++;
            logger.info(`🚨 [SLA Cron] Level 2 Reminder sent for ${grievance.grievanceId} to ${officerName} & Dept Head`);
          }

          // ==========================================================
          // 🚨 ESCALATION LEVEL 3: 24h after Reminder 2, Flag to Collector
          // ==========================================================
          else if (reminderCount >= 2 && hoursSinceLastReminder >= LEVEL_3_HOURS) {
            // Check if already logged as escalated to Collector in timeline
            const alreadyEscalated = grievance.timeline?.some(
              (t: any) => t.action === 'ESCALATED_TO_COLLECTOR'
            );

            if (!alreadyEscalated) {
              await Grievance.updateOne(
                { _id: grievance._id },
                {
                  $set: { isDefaulterIgnored: true },
                  $push: {
                    timeline: {
                      action: 'ESCALATED_TO_COLLECTOR',
                      details: {
                        officerName,
                        reminderCount,
                        daysUnresolved: Math.floor(hoursSinceCreated / 24),
                        reason: 'Non-responsive after 2+ reminders'
                      },
                      timestamp: now
                    }
                  }
                }
              );

              // Notify District Collector / Company Admins
              await notifyCompanyAdmins({
                companyId,
                eventType: 'GRIEVANCE_REMINDER',
                title: 'Defaulter Alert: Unresolved after 2+ Reminders',
                message: `Officer ${officerName} (${departmentName}) is non-responsive on grievance ${grievance.grievanceId} after ${reminderCount} reminders. Added to Defaulters Ledger.`,
                grievanceId: grievance.grievanceId,
                grievanceObjectId: grievance._id,
                meta: { officerName, reminderCount, daysUnresolved: Math.floor(hoursSinceCreated / 24) }
              });

              stats.level3Escalated++;
              logger.warn(`⚖️ [SLA Cron] Grievance ${grievance.grievanceId} escalated to Collector (Defaulter: ${officerName})`);
            }
          }
        } catch (ticketErr: any) {
          logger.error(`❌ [SLA Cron] Error processing ticket ${rawGrievance?._id}: ${ticketErr.message}`);
        }
      }
    }
  } catch (err: any) {
    logger.error(`❌ [SLA Cron] Error running SLA escalation cycle: ${err.message}`);
  } finally {
    isJobRunning = false;
  }

  return stats;
}

/**
 * Start the recurring SLA Escalation Cron (default: every 1 hour)
 */
export function startSlaEscalationCron(intervalMs = 60 * 60 * 1000) {
  if (cronHandle) {
    logger.warn('⚠️ SLA Escalation Cron is already running.');
    return;
  }

  // Initial trigger after 30 seconds to let database connections establish
  setTimeout(() => {
    logger.info('🚀 Triggering initial SLA Escalation Scan...');
    runSlaEscalationScan().catch(err => {
      logger.error('❌ Initial SLA Escalation Scan failed:', err);
    });
  }, 30000);

  cronHandle = setInterval(async () => {
    try {
      logger.info('🕒 Running scheduled SLA Escalation Scan...');
      const stats = await runSlaEscalationScan();
      logger.info(`✅ SLA Escalation Scan complete: ${JSON.stringify(stats)}`);
    } catch (error: any) {
      logger.error('❌ SLA Escalation Cron cycle error:', error);
    }
  }, intervalMs);

  logger.info(`🕒 SLA Escalation Cron started (interval: ${intervalMs / (60 * 1000)} mins)`);
}

/**
 * Stop the recurring SLA Escalation Cron
 */
export function stopSlaEscalationCron() {
  if (cronHandle) {
    clearInterval(cronHandle);
    cronHandle = null;
    logger.info('🛑 SLA Escalation Cron stopped.');
  }
}
