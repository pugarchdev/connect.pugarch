"use client";

import { BellRing, X } from "lucide-react";
import CreateDepartmentDialog from "@/components/department/CreateDepartmentDialog";
import DepartmentUsersDialog from "@/components/department/DepartmentUsersDialog";
import DepartmentHierarchyDialog from "@/components/department/DepartmentHierarchyDialog";
import CreateUserDialog from "@/components/user/CreateUserDialog";
import EditUserDialog from "@/components/user/EditUserDialog";
import TransferWorkloadDialog from "@/components/user/TransferWorkloadDialog";
import ChangePermissionsDialog from "@/components/user/ChangePermissionsDialog";
import UserDetailsDialog from "@/components/user/UserDetailsDialog";
import GrievanceDetailDialog from "@/components/grievance/GrievanceDetailDialog";
import AppointmentDetailDialog from "@/components/appointment/AppointmentDetailDialog";
import AssignmentDialog from "@/components/assignment/AssignmentDialog";
import StatusUpdateModal from "@/components/grievance/StatusUpdateModal";
import RevertGrievanceDialog from "@/components/grievance/RevertGrievanceDialog";
import AvailabilityCalendar from "@/components/availability/AvailabilityCalendar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

type DashboardDialogsProps = {
  visible: boolean;
  props: any;
};

export function DashboardDialogs({ visible, props }: DashboardDialogsProps) {
  if (!visible) {
    return null;
  }

  const {
    showDepartmentDialog,
    setShowDepartmentDialog,
    editingDepartment,
    setEditingDepartment,
    isSuperAdminUser,
    companyIdParam,
    fetchDepartmentData,
    fetchDashboardData,
    showUserDialog,
    setShowUserDialog,
    fetchUsers,
    userPage,
    showEditUserDialog,
    setShowEditUserDialog,
    editingUser,
    setEditingUser,
    showTransferWorkloadDialog,
    setShowTransferWorkloadDialog,
    transferWorkloadUser,
    setTransferWorkloadUser,
    showChangePermissionsDialog,
    setShowChangePermissionsDialog,
    showGrievanceDetail,
    setShowGrievanceDetail,
    selectedGrievance,
    setSelectedGrievance,
    fetchGrievances,
    grievancePage,
    showOverdueReminderDialog,
    setShowOverdueReminderDialog,
    selectedGrievanceForReminder,
    dashboardTenantConfig,
    reminderRemarks,
    setReminderRemarks,
    handleSendOverdueReminder,
    sendingReminder,
    showAppointmentDetail,
    setShowAppointmentDetail,
    selectedAppointment,
    setSelectedAppointment,
    showGrievanceRevertDialog,
    setShowGrievanceRevertDialog,
    selectedGrievanceForRevert,
    setSelectedGrievanceForRevert,
    handleRevertSubmit,
    selectedGrievanceForAssignment,
    user,
    showGrievanceAssignment,
    setShowGrievanceAssignment,
    setSelectedGrievanceForAssignment,
    handleAssignGrievance,
    isCompanyAdminRole,
    allDepartments,
    selectedAppointmentForAssignment,
    showAppointmentAssignment,
    setShowAppointmentAssignment,
    setSelectedAppointmentForAssignment,
    handleAssignAppointment,
    fetchAppointments,
    appointmentPage,
    showAvailabilityCalendar,
    setShowAvailabilityCalendar,
    isCompanyAdminOrHigher,
    showAppointmentStatusModal,
    setShowAppointmentStatusModal,
    selectedAppointmentForStatus,
    setSelectedAppointmentForStatus,
    showGrievanceStatusModal,
    setShowGrievanceStatusModal,
    selectedGrievanceForStatus,
    setSelectedGrievanceForStatus,
    isDepartmentAdminOrHigher,
    showDeptUsersDialog,
    setShowDeptUsersDialog,
    selectedDeptForUsers,
    setSelectedDeptForUsers,
    targetCompanyId,
    setSelectedUserForDetails,
    setShowUserDetailsDialog,
    selectedUserForDetails,
    showUserDetailsDialog,
    selectedDeptForHierarchy,
    showHierarchyDialog,
    setShowHierarchyDialog,
    setSelectedDeptForHierarchy,
    grievanceAssignmentSuggestedDepartmentId,
    grievanceAssignmentSuggestedSubDepartmentId,
  } = props;

  return (
    <>
      <div key="dashboard-dialogs-root">
        <CreateDepartmentDialog
          isOpen={showDepartmentDialog}
          onClose={() => {
            setShowDepartmentDialog(false);
            setEditingDepartment(null);
          }}
          onDepartmentCreated={() => {
            fetchDepartmentData();
            fetchDashboardData(true);
          }}
          editingDepartment={editingDepartment}
          defaultCompanyId={isSuperAdminUser ? companyIdParam || undefined : undefined}
          onEditUser={(u) => {
            setEditingUser(u);
            setShowEditUserDialog(true);
            setShowDepartmentDialog(false);
          }}
          showPriorityField={props.showDepartmentPriorityColumn}
        />

        <ConfirmDialog
          isOpen={props.confirmDialog.isOpen}
          title={props.confirmDialog.title}
          message={props.confirmDialog.message}
          onConfirm={props.confirmDialog.onConfirm}
          onCancel={() =>
            props.setConfirmDialog({ ...props.confirmDialog, isOpen: false })
          }
          variant={props.confirmDialog.variant}
        />

        <CreateUserDialog
          isOpen={showUserDialog}
          onClose={() => setShowUserDialog(false)}
          onUserCreated={() => {
            fetchUsers(userPage, true);
            fetchDashboardData(true);
          }}
          defaultCompanyId={isSuperAdminUser ? companyIdParam || undefined : undefined}
        />

        <EditUserDialog
          isOpen={showEditUserDialog}
          onClose={() => {
            setShowEditUserDialog(false);
            setEditingUser(null);
          }}
          onUserUpdated={() => {
            fetchUsers(userPage, true);
            fetchDashboardData(true);
          }}
          user={editingUser}
        />

        <TransferWorkloadDialog
          isOpen={showTransferWorkloadDialog}
          onClose={() => {
            setShowTransferWorkloadDialog(false);
            setTransferWorkloadUser(null);
          }}
          onSuccess={() => {
            fetchUsers(userPage, true);
            fetchDashboardData(true);
          }}
          sourceUser={transferWorkloadUser}
        />
        <ChangePermissionsDialog
          isOpen={showChangePermissionsDialog}
          onClose={() => {
            setShowChangePermissionsDialog(false);
            setEditingUser(null);
          }}
          onPermissionsUpdated={() => {
            fetchUsers(userPage, true);
            fetchDashboardData(true);
          }}
          user={editingUser}
        />
      </div>

      <GrievanceDetailDialog
        isOpen={showGrievanceDetail}
        grievance={selectedGrievance}
        onClose={() => {
          setShowGrievanceDetail(false);
          setSelectedGrievance(null);
        }}
        onSuccess={() => {
          fetchGrievances(grievancePage, true);
          fetchDashboardData(true);
        }}
      />

      {showOverdueReminderDialog && selectedGrievanceForReminder && (
        <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-red-50 border-b border-red-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-red-900">
                  Overdue Reminder - {selectedGrievanceForReminder.grievanceId}
                </h3>
                <p className="text-xs text-red-700">
                  Fill remarks and click send reminder.
                </p>
              </div>
              <button
                onClick={() => setShowOverdueReminderDialog(false)}
                className="h-8 w-8 rounded-lg hover:bg-red-100 text-red-700 inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500 text-xs">Raised On</p>
                  <p className="font-semibold text-slate-900">
                    {new Date(selectedGrievanceForReminder.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500 text-xs">Assigned To</p>
                  <p className="font-semibold text-slate-900">
                    {selectedGrievanceForReminder.assignedTo &&
                    typeof selectedGrievanceForReminder.assignedTo === "object"
                      ? `${(selectedGrievanceForReminder.assignedTo as any).firstName || ""} ${(selectedGrievanceForReminder.assignedTo as any).lastName || ""}`.trim() || "Inactive User"
                      : "Not assigned"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                  <p className="text-slate-500 text-xs">Reminder Count</p>
                  <p className="font-semibold text-slate-900">
                    Sent: {selectedGrievanceForReminder.reminderCount || 0} • Next send:{" "}
                    {(selectedGrievanceForReminder.reminderCount || 0) + 1}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  Remarks by {dashboardTenantConfig.revertAdminLabel}
                </label>
                <textarea
                  value={reminderRemarks}
                  onChange={(e) => setReminderRemarks(e.target.value)}
                  rows={4}
                  placeholder="Type your reminder remarks..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowOverdueReminderDialog(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSendOverdueReminder}
                disabled={sendingReminder}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                <BellRing className="w-4 h-4" />
                {sendingReminder ? "Sending..." : "Send Reminder"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AppointmentDetailDialog
        isOpen={showAppointmentDetail}
        appointment={selectedAppointment}
        onClose={() => {
          setShowAppointmentDetail(false);
          setSelectedAppointment(null);
        }}
      />

      <RevertGrievanceDialog
        isOpen={showGrievanceRevertDialog}
        grievanceId={selectedGrievanceForRevert?.grievanceId}
        adminLabel={dashboardTenantConfig.revertAdminLabel}
        onClose={() => {
          setShowGrievanceRevertDialog(false);
          setSelectedGrievanceForRevert(null);
        }}
        onSubmit={handleRevertSubmit}
      />

      {selectedGrievanceForAssignment && user?.companyId && (
        <AssignmentDialog
          isOpen={showGrievanceAssignment}
          onClose={() => {
            setShowGrievanceAssignment(false);
            setSelectedGrievanceForAssignment(null);
          }}
          onAssign={handleAssignGrievance}
          itemType="grievance"
          itemId={selectedGrievanceForAssignment?._id || ""}
          companyId={
            typeof user.companyId === "object" && user.companyId !== null
              ? user.companyId._id
              : user.companyId || ""
          }
          displayId={selectedGrievanceForAssignment?.grievanceId}
          currentAssignee={selectedGrievanceForAssignment?.assignedTo}
          currentDepartmentId={props.grievanceAssignmentCurrentDepartmentId}
          currentSubDepartmentId={props.grievanceAssignmentCurrentSubDepartmentId}
          userRole={user.role}
          canReassignCurrent={isCompanyAdminRole}
          userDepartmentId={
            typeof user.departmentId === "object" && user.departmentId !== null
              ? user.departmentId._id
              : user.departmentId
          }
          currentUserId={user.id}
          allDepartments={allDepartments}
          suggestedDepartmentId={grievanceAssignmentSuggestedDepartmentId}
          suggestedSubDepartmentId={grievanceAssignmentSuggestedSubDepartmentId}
          onSuccess={() => {
            fetchGrievances(grievancePage, true);
            fetchDashboardData(true);
          }}
        />
      )}

      {selectedAppointmentForAssignment && user?.companyId && (
        <AssignmentDialog
          isOpen={showAppointmentAssignment}
          onClose={() => {
            setShowAppointmentAssignment(false);
            setSelectedAppointmentForAssignment(null);
          }}
          onAssign={handleAssignAppointment}
          itemType="appointment"
          itemId={selectedAppointmentForAssignment._id}
          companyId={
            typeof user.companyId === "object" && user.companyId !== null
              ? user.companyId._id
              : user.companyId || ""
          }
          displayId={selectedAppointmentForAssignment?.appointmentId}
          currentAssignee={selectedAppointmentForAssignment.assignedTo}
          currentDepartmentId={
            selectedAppointmentForAssignment.departmentId &&
            typeof selectedAppointmentForAssignment.departmentId === "object"
              ? selectedAppointmentForAssignment.departmentId._id
              : selectedAppointmentForAssignment.departmentId
          }
          userRole={user.role}
          userDepartmentId={
            typeof user.departmentId === "object" && user.departmentId !== null
              ? user.departmentId._id
              : user.departmentId
          }
          currentUserId={user.id}
          allDepartments={allDepartments}
          onSuccess={() => {
            fetchAppointments(appointmentPage, true);
            fetchDashboardData(true);
          }}
        />
      )}

      <AvailabilityCalendar
        isOpen={showAvailabilityCalendar}
        onClose={() => setShowAvailabilityCalendar(false)}
        departmentId={
          !isCompanyAdminOrHigher(user) && user?.departmentId
            ? typeof user.departmentId === "object"
              ? user.departmentId._id
              : user.departmentId
            : undefined
        }
      />

      <StatusUpdateModal
        isOpen={showAppointmentStatusModal}
        onClose={() => {
          setShowAppointmentStatusModal(false);
          setSelectedAppointmentForStatus(null);
        }}
        itemId={showAppointmentStatusModal ? selectedAppointmentForStatus?._id || "" : ""}
        itemType="appointment"
        currentStatus={selectedAppointmentForStatus?.status || ""}
        initialDate={selectedAppointmentForStatus?.appointmentDate}
        initialTime={selectedAppointmentForStatus?.appointmentTime}
        onSuccess={() => {
          fetchAppointments(appointmentPage, true);
          fetchDashboardData(true);
          setShowAppointmentStatusModal(false);
          setSelectedAppointmentForStatus(null);
        }}
      />

      <StatusUpdateModal
        isOpen={showGrievanceStatusModal}
        onClose={() => {
          setShowGrievanceStatusModal(false);
          setSelectedGrievanceForStatus(null);
        }}
        itemId={showGrievanceStatusModal ? selectedGrievanceForStatus?._id || "" : ""}
        itemType="grievance"
        currentStatus={selectedGrievanceForStatus?.status || ""}
        onSuccess={() => {
          fetchGrievances(grievancePage, true);
          fetchDashboardData(true);
        }}
        grievanceVariant={!isDepartmentAdminOrHigher(user) ? "operator" : "department-admin"}
      />

      <DepartmentUsersDialog
        isOpen={showDeptUsersDialog}
        onClose={() => {
          setShowDeptUsersDialog(false);
          setSelectedDeptForUsers(null);
        }}
        departmentId={selectedDeptForUsers?.id || null}
        departmentName={selectedDeptForUsers?.name || null}
        companyId={targetCompanyId}
        onUserClick={(u) => {
          setSelectedUserForDetails(u);
          setShowUserDetailsDialog(true);
        }}
        onEditUser={(u) => {
          setEditingUser(u);
          setShowEditUserDialog(true);
          setShowDeptUsersDialog(false);
        }}
        onCreateNewUser={() => {
          setShowUserDialog(true);
          setShowDeptUsersDialog(false);
        }}
      />

      <UserDetailsDialog
        isOpen={showUserDetailsDialog}
        onClose={() => {
          setShowUserDetailsDialog(false);
          setSelectedUserForDetails(null);
        }}
        user={selectedUserForDetails}
      />

      <DepartmentHierarchyDialog
        isOpen={showHierarchyDialog}
        onClose={() => {
          setShowHierarchyDialog(false);
          setSelectedDeptForHierarchy(null);
        }}
        department={selectedDeptForHierarchy}
        allDepartments={allDepartments}
      />
    </>
  );
}
