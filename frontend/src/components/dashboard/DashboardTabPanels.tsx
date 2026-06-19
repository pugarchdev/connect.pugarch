// @ts-nocheck
"use client";

import dynamic from "next/dynamic";

import {
  useEffect,
  useState,
  useRef,
  Suspense,
  useCallback,
  useMemo,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { apiClient } from "@/lib/api/client";
import { companyAPI, Company } from "@/lib/api/company";
import { departmentAPI, Department } from "@/lib/api/department";
import { userAPI, User } from "@/lib/api/user";
import { grievanceAPI, Grievance } from "@/lib/api/grievance";
import { appointmentAPI, Appointment } from "@/lib/api/appointment";
import { leadAPI, Lead } from "@/lib/api/lead";
import { roleAPI, Role } from "@/lib/api/role";
import {
  Permission,
  hasPermission,
  Module,
  isDepartmentAdminOrHigher,
  isCompanyAdminOrHigher,
  isSuperAdmin,
} from "@/lib/permissions";
import toast from "react-hot-toast";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { TableSkeleton } from "@/components/ui/GeneralSkeleton";
import { Pagination } from "@/components/ui/Pagination";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { DashboardDepartmentFilters } from "@/components/dashboard/DashboardDepartmentFilters";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation";
import { OverviewAppointmentCards } from "@/components/dashboard/OverviewAppointmentCards";
import { OverviewQuickActions } from "@/components/dashboard/OverviewQuickActions";
import { OverviewCompanyInfoCard } from "@/components/dashboard/OverviewCompanyInfoCard";
import { OverviewDepartmentSummary } from "@/components/dashboard/OverviewDepartmentSummary";
import { OverviewGrievanceKpis } from "@/components/dashboard/OverviewGrievanceKpis";
import { DashboardDialogs } from "@/components/dashboard/DashboardDialogs";
import { LoadingDots, SortIcon } from "@/components/dashboard/DashboardPrimitives";
import { ProfileTab } from "@/components/dashboard/tabs/ProfileTab";
import { CompanySettingsTab } from "@/components/company/CompanySettingsTab";
import { formatTo10Digits, normalizePhoneNumber } from "@/lib/utils/phoneUtils";
import { useGrievances } from "@/lib/query/useGrievances";

import { useDashboardStats } from "@/lib/query/useDashboardStats";
import { useDashboardKpis } from "@/lib/query/useDashboardKpis";
import { useDepartments } from "@/lib/query/useDepartments";
import { useUsers } from "@/lib/query/useUsers";
import { getUserRoleLabel } from "@/lib/utils/userUtils";
import {
  getCompanyIdFromValue,
  getDashboardTenantConfig,
  getScopedCompanyId,
} from "@/lib/tenant-config";

const LazyRoleManagement = dynamic(
  () => import("@/components/roles/RoleManagement"),
  {
    loading: () => <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />,
  },
);

const LazyWhatsAppConfigTab = dynamic(
  () => import("@/components/superadmin/drilldown/tabs/WhatsAppConfigTab"),
  {
    loading: () => <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />,
  },
);

const LazyEmailConfigTab = dynamic(
  () => import("@/components/superadmin/drilldown/tabs/EmailConfigTab"),
  {
    loading: () => <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />,
  },
);

const LazyChatbotFlowsTab = dynamic(
  () => import("@/components/superadmin/drilldown/tabs/ChatbotFlowsTab"),
  {
    loading: () => <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />,
  },
);

const LazyNotificationManagement = dynamic(
  () => import("@/components/superadmin/drilldown/NotificationManagement"),
  {
    loading: () => <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />,
  },
);


import {
  ArrowRight,
  Phone,
  UserPlus,
  UserCog,
  Key,
  UserMinus,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  User as UserIcon,
  Users,
  Mail,
  Shield,
  Building,
  Target,
  CheckCircle,
  MoreVertical,
  Edit2,
  Trash2,
  Lock,
  Unlock,
  Filter,
  X,
  Clock,
  CalendarClock,
  FileDown,
  BarChart2,
  TrendingUp,
  CalendarCheck,
  PieChart as PieChartIcon,
  Power,
  Activity,
  Zap,
  LayoutDashboard,
  Search,
  RefreshCw,
  Download,
  Calendar,
  Bell,
  Undo2,
  ExternalLink,
  Inbox,
  Eye,
  ArrowRightCircle,
  Building2,
  Layers,
  Flame,
  ShieldAlert,
  ShieldCheck,
  LocateFixed,
  ScanSearch,
  MapPin,
  Settings,
  MessageSquare,
  Bot,
  Workflow,
  LayoutGrid,
  Menu,
} from "lucide-react";

interface DashboardStats {
  grievances: {
    total: number;
    registeredTotal?: number;
    pending: number;
    assigned?: number;
    inProgress: number;
    reverted: number;
    rejected: number;
    resolved: number;
    last7Days: number;
    last30Days: number;
    resolutionRate: number;
    slaBreached?: number;
    pendingOverdue?: number;
    slaComplianceRate?: number;
    avgResolutionDays?: number;
    byPriority?: Array<{ priority: string; count: number }>;
    daily: Array<{ date: string; count: number }>;
    monthly?: Array<{ month: string; count: number; resolved: number }>;
    byDepartment?: Array<{
      departmentId: string;
      total: number;
      pending: number;
    }>;
  };
  appointments: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    cancelled?: number;
    last7Days: number;
    last30Days: number;
    completionRate: number;
    byDepartment?: Array<{
      departmentId: string;
      departmentName: string;
      count: number;
      completed: number;
    }>;
    daily: Array<{ date: string; count: number }>;
    monthly?: Array<{ month: string; count: number; completed: number }>;
  };
  departments: number;
  mainDepartments?: number;
  subDepartments?: number;
  users: number;
  activeUsers: number;
  resolvedToday?: number;
  highPriorityPending?: number;
  isHierarchicalEnabled?: boolean;
  usersByRole?: Array<{ name: string; count: number }>;
}




type DashboardTabPanelsProps = any;

export function DashboardTabPanels(props: DashboardTabPanelsProps) {
  const {
    allDepartments,
    appointmentFilters,
    appointmentPage,
    appointmentPagination,
    appointmentSearch,
    appointments,
    setAppointmentPage,
    assignedDepartmentSummaries,
    canAssignGrievance,
    canDeleteGrievance,
    canManageDepartmentPriority,
    canReopenResolvedGrievance,
    canSeeDepartmentsTab,
    canSeeUsersTab,
    canSendOverdueReminder,
    canShowAppointmentsInView,
    canToggleDepartmentPriorityColumn,
    company,
    companyIdParam,
    dashboardTenantConfig,
    departmentData,
    departmentPage,
    departmentPagination,
    departments,
    deptFilters,
    deptSearch,
    deptUserCounts,
    exportToCSV,
    fetchDashboardData,
    fetchDepartments,
    fetchUsers,
    filteredDeptCounts,
    filteredRolesByHierarchy,
    forestBeats,
    getParentDepartmentId,
    getSortedData,
    grievanceFilters,
    grievancePage,
    grievancePagination,
    grievanceSearch,
    grievances,
    handleBulkDeleteAppointments,
    handleBulkDeleteDepartments,
    handleBulkDeleteGrievances,
    handleBulkDeleteUsers,
    handleDeleteGrievance,
    handleRefreshData,
    handleSaveDepartmentPriority,
    handleSort,
    handleToggleDepartmentPriorityColumn,
    handleToggleUserStatus,
    handleUpdatePassword,
    handleUpdateProfile,
    hasModule,
    highGrievanceMainDept,
    highGrievanceSubDept,
    isCompanyAdminRole,
    isCompanyLevel,
    isDeleting,
    isDepartmentAdminRole,
    isDepartmentLevel,
    isLowerHierarchyRole,
    isOperatorRole,
    isRefreshing,
    isSubDepartmentAdminRole,
    isSuperAdminDrilldown,
    isSuperAdminUser,
    isViewingCompany,
    leads,
    loadingDepartments,
    loadingGrievances,
    loadingAppointments,
    loadingKpiTiles,
    loadingLeads,
    loadingStats,
    loadingUsers,
    navigateToGrievances,
    normalizedDesignations,
    openGrievanceDetail,
    openAppointmentDetail,
    openOverdueReminderDialog,
    openUserDetail,
    overdueKpiCount,
    passwordForm,
    pendingKpiCount,
    priorityDrafts,
    profileForm,
    rejectedKpiCount,
    resolvedKpiCount,
    revertedKpiCount,
    savingPriorityIds,
    scopedDepartmentsForFilters,
    selectedAppointments,
    selectedDepartments,
    selectedGrievances,
    selectedUsers,
    setActiveTab,
    setAppointmentFilters,
    setAppointmentPagination,
    setAppointmentSearch,
    setConfirmDialog,
    setDepartmentPage,
    setDepartmentPagination,
    setDepartments,
    setDeptFilters,
    setDeptSearch,
    setEditingDepartment,
    setEditingUser,
    setGrievanceFilters,
    setGrievancePage,
    setGrievancePagination,
    setGrievanceSearch,
    setHighGrievanceMainDept,
    setHighGrievanceSubDept,
    setPasswordForm,
    setPriorityDrafts,
    setProfileForm,
    setSelectedDepartments,
    setSelectedDeptForHierarchy,
    setSelectedDeptForUsers,
    setSelectedGrievanceForAssignment,
    setSelectedGrievanceForRevert,
    setSelectedGrievances,
    setSelectedUsers,
    setShowAppointmentFiltersOnMobile,
    setShowAvailabilityCalendar,
    setShowDepartmentDialog,
    setShowDepartmentFiltersOnMobile,
    setShowDeptUsersDialog,
    setShowEditUserDialog,
    setShowGrievanceAssignment,
    setShowGrievanceFiltersOnMobile,
    setShowGrievanceRevertDialog,
    setShowHierarchyDialog,
    setShowUserDialog,
    setShowUserFiltersOnMobile,
    setUserFilters,
    setUserPage,
    setUserPagination,
    setUserSearch,
    setUsers,
    showAppointmentFiltersOnMobile,
    showDepartmentFiltersOnMobile,
    showDepartmentPriorityColumn,
    showGrievanceFiltersOnMobile,
    showUserFiltersOnMobile,
    sortConfig,
    stats,
    totalGrievancesKpiCount,
    totalRegisteredGrievances,
    updatingGrievanceStatus,
    updatingPassword,
    updatingProfile,
    user,
    userFilters,
    userPage,
    userPagination,
    userSearch,
    users,
  } = props;

  const getDepartmentHeadUserId = (dept: any) => {
    if (dept?.contactUserId) {
      return typeof dept.contactUserId === "object"
        ? dept.contactUserId._id
        : dept.contactUserId;
    }

    const normalizedHeadName = (
      dept.headName ||
      dept.head ||
      dept.contactPerson ||
      ""
    )
      .trim()
      .toLowerCase();
    const normalizedHeadEmail = (dept.headEmail || dept.contactEmail || "")
      .trim()
      .toLowerCase();
    const normalizedHeadPhone = formatTo10Digits(
      dept.headPhone || dept.contactPhone || "",
    );

    const matchedUser = (users || []).find((candidate: any) => {
      const candidateName = `${candidate.firstName || ""} ${candidate.lastName || ""}`
        .trim()
        .toLowerCase();
      const candidateEmail = (candidate.email || "").trim().toLowerCase();
      const candidatePhone = formatTo10Digits(candidate.phone || "");

      return Boolean(
        (normalizedHeadEmail && candidateEmail === normalizedHeadEmail) ||
          (normalizedHeadPhone && candidatePhone === normalizedHeadPhone) ||
          (normalizedHeadName && candidateName === normalizedHeadName),
      );
    });

    return matchedUser?._id || null;
  };

  const handleMobileDepartmentHeadClick = (dept: any) => {
    const headUserId = getDepartmentHeadUserId(dept);
    if (!headUserId) {
      toast.error("Admin head profile is not linked for this department");
      return;
    }

    openUserDetail(headUserId);
  };

  return (
    <div className="flex-1 min-w-0">
              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-4 sm:space-y-6">
                {/* Dashboard Headers & Quick Stats */}
                <OverviewGrievanceKpis
                  canReadGrievance={hasPermission(user, Permission.READ_GRIEVANCE)}
                  loading={loadingKpiTiles}
                  pendingCount={pendingKpiCount}
                  overdueCount={overdueKpiCount}
                  revertedCount={revertedKpiCount}
                  resolvedCount={resolvedKpiCount}
                  rejectedCount={rejectedKpiCount}
                  totalCount={totalGrievancesKpiCount}
                  last7DaysCount={stats?.grievances.last7Days || 0}
                  onPendingClick={() => {
                    setActiveTab("grievances");
                    setGrievancePage(1);
                    setGrievanceSearch("");
                    setGrievanceFilters((prev) => ({ 
                      ...prev, 
                      status: "PENDING,IN_PROGRESS,ASSIGNED",
                      slaStatus: "",
                      dateRange: "",
                      priority: "",
                      assignmentStatus: ""
                    }));
                  }}
                  onOverdueClick={() => {
                    setActiveTab("grievances");
                    setGrievancePage(1);
                    setGrievanceSearch("");
                    setGrievanceFilters((prev) => ({
                      ...prev,
                      status: "", // All active status
                      slaStatus: "OVERDUE",
                      dateRange: "",
                      priority: "",
                      assignmentStatus: ""
                    }));
                  }}
                  onRevertedClick={() => {
                    setActiveTab("grievances");
                    setGrievancePage(1);
                    setGrievanceSearch("");
                    setGrievanceFilters((prev) => ({ 
                      ...prev, 
                      status: "REVERTED",
                      slaStatus: "",
                      dateRange: "",
                      priority: "",
                      assignmentStatus: ""
                    }));
                  }}
                  onResolvedClick={() => {
                    setActiveTab("grievances");
                    setGrievancePage(1);
                    setGrievanceSearch("");
                    setGrievanceFilters((prev) => ({ 
                      ...prev, 
                      status: "RESOLVED",
                      slaStatus: "",
                      dateRange: "",
                      priority: "",
                      assignmentStatus: ""
                    }));
                  }}
                  onRejectedClick={() => {
                    setActiveTab("grievances");
                    setGrievancePage(1);
                    setGrievanceSearch("");
                    setGrievanceFilters((prev) => ({ 
                      ...prev, 
                      status: "REJECTED",
                      slaStatus: "",
                      dateRange: "",
                      priority: "",
                      assignmentStatus: ""
                    }));
                  }}
                  onTotalClick={() => {
                    setActiveTab("grievances");
                    setGrievancePage(1);
                    setGrievanceSearch("");
                    setGrievanceFilters((prev) => ({ 
                      ...prev, 
                      status: "ALL",
                      slaStatus: "",
                      dateRange: "",
                      priority: "",
                      assignmentStatus: ""
                    }));
                  }}
                />

                {/* Company Info (for Company Admin) - Beautified Modern Design */}
                {isViewingCompany && (
                  <OverviewCompanyInfoCard
                    company={company}
                    loadingStats={loadingStats}
                    usersCount={stats?.users ?? users.length}
                    departmentsCount={
                      departmentPagination.total ||
                      stats?.departments ||
                      departments.length
                    }
                    supportEmail={company?.contactEmail}
                  />
                )}

                {/* Department Admin - Profile & Department Info in Overview */}
                <OverviewDepartmentSummary
                  visible={Boolean(isDepartmentLevel)}
                  user={user}
                  normalizedDesignations={normalizedDesignations}
                  assignedDepartmentSummaries={assignedDepartmentSummaries}
                  departmentStats={stats?.grievances?.byDepartment}
                />

                {/* Quick Actions */}

                <OverviewQuickActions
                  isViewingCompany={Boolean(isViewingCompany)}
                  isDepartmentLevel={Boolean(isDepartmentLevel)}
                  onOpenDepartments={() => setActiveTab("departments")}
                  onOpenUsers={() => setActiveTab("users")}
                  onOpenAvailability={() => setShowAvailabilityCalendar(true)}
                  onOpenAnalytics={() => setActiveTab("analytics")}
                  hasAppointmentModule={hasModule(Module.APPOINTMENT)}
                />
              </TabsContent>

              {/* Analytics Page - Role-Aware Real Analytics */}
              {(!isSuperAdminUser || (isSuperAdminUser && companyIdParam)) && (
                <TabsContent value="analytics" className="space-y-4">
                  {/* Header Banner */}

                  

                  {/* KPI Cards */}
                  <OverviewGrievanceKpis
                    canReadGrievance={hasModule(Module.GRIEVANCE)}
                    loading={loadingKpiTiles}
                    pendingCount={pendingKpiCount}
                    overdueCount={overdueKpiCount}
                    revertedCount={revertedKpiCount}
                    resolvedCount={resolvedKpiCount}
                    rejectedCount={rejectedKpiCount}
                    totalCount={totalGrievancesKpiCount}
                    last7DaysCount={stats?.grievances.last7Days || 0}
                    onPendingClick={() => {
                      setActiveTab("grievances");
                      setGrievancePage(1);
                      setGrievanceSearch("");
                      setGrievanceFilters((prev) => ({ 
                        ...prev, 
                        status: "PENDING,IN_PROGRESS,ASSIGNED",
                        slaStatus: "",
                        dateRange: "",
                        priority: "",
                        assignmentStatus: ""
                      }));
                    }}
                    onOverdueClick={() => {
                      setActiveTab("grievances");
                      setGrievancePage(1);
                      setGrievanceSearch("");
                      setGrievanceFilters((prev) => ({
                        ...prev,
                        status: "", // All active status
                        slaStatus: "OVERDUE",
                        dateRange: "",
                        priority: "",
                        assignmentStatus: ""
                      }));
                    }}
                    onRevertedClick={() => {
                      setActiveTab("grievances");
                      setGrievancePage(1);
                      setGrievanceSearch("");
                      setGrievanceFilters((prev) => ({ 
                        ...prev, 
                        status: "REVERTED",
                        slaStatus: "",
                        dateRange: "",
                        priority: "",
                        assignmentStatus: ""
                      }));
                    }}
                    onResolvedClick={() => {
                      setActiveTab("grievances");
                      setGrievancePage(1);
                      setGrievanceSearch("");
                      setGrievanceFilters((prev) => ({ 
                        ...prev, 
                        status: "RESOLVED",
                        slaStatus: "",
                        dateRange: "",
                        priority: "",
                        assignmentStatus: ""
                      }));
                    }}
                    onRejectedClick={() => {
                      setActiveTab("grievances");
                      setGrievancePage(1);
                      setGrievanceSearch("");
                      setGrievanceFilters((prev) => ({ 
                        ...prev, 
                        status: "REJECTED",
                        slaStatus: "",
                        dateRange: "",
                        priority: "",
                        assignmentStatus: ""
                      }));
                    }}
                    onTotalClick={() => {
                      setActiveTab("grievances");
                      setGrievancePage(1);
                      setGrievanceSearch("");
                      setGrievanceFilters((prev) => ({ 
                        ...prev, 
                        status: "ALL",
                        slaStatus: "",
                        dateRange: "",
                        priority: "",
                        assignmentStatus: ""
                      }));
                    }}
                  />

                  <OverviewAppointmentCards
                    visible={Boolean(canShowAppointmentsInView && isViewingCompany)}
                    total={stats?.appointments.total || 0}
                    pending={stats?.appointments.pending || 0}
                    completed={stats?.appointments.completed || 0}
                    onOpenAppointments={() => setActiveTab("appointments")}
                  />

                  {/* Charts Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Grievance Trend */}
                    {hasModule(Module.GRIEVANCE) && (
                      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
                              <TrendingUp className="w-4 h-4 text-indigo-600" />
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-slate-800">
                              Grievance Trend
                              </h3>
                              <p className="text-[14px] text-slate-400">
                                Last 7 days activity
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="p-4 flex-1">
                          {stats?.grievances.daily &&
                          stats.grievances.daily.length > 0 ? (
                            <ResponsiveContainer width="100%" height={140}>
                              <AreaChart
                                data={stats.grievances.daily
                                  .slice(-7)
                                  .map((d) => ({
                                    name: new Date(d.date).toLocaleDateString(
                                      "en-IN",
                                      { weekday: "short" },
                                    ),
                                    count: d.count,
                                  }))}
                              >
                                <defs>
                                  <linearGradient
                                    id="grievanceGrad"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                  >
                                    <stop
                                      offset="5%"
                                      stopColor="#6366f1"
                                      stopOpacity={0.15}
                                    />
                                    <stop
                                      offset="95%"
                                      stopColor="#6366f1"
                                      stopOpacity={0}
                                    />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid
                                  strokeDasharray="3 3"
                                  stroke="#f1f5f9"
                                />
                                <XAxis
                                  dataKey="name"
                                  tick={{ fontSize: 14, fill: "#94a3b8" }}
                                  tickMargin={4}
                                />
                                <YAxis
                                  tick={{ fontSize: 14, fill: "#94a3b8" }}
                                  allowDecimals={false}
                                  width={30}
                                />
                                <Tooltip
                                  contentStyle={{
                                    borderRadius: "12px",
                                    border: "1px solid #e2e8f0",
                                    fontSize: "14px",
                                  }}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="count"
                                  stroke="#6366f1"
                                  strokeWidth={2.5}
                                  fillOpacity={1}
                                  fill="url(#grievanceGrad)"
                                  name="Grievances"
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="h-[140px] flex flex-col items-center justify-center text-slate-400 border border-dashed rounded-lg border-slate-200">
                              <TrendingUp className="w-8 h-8 mb-2 opacity-30" />
                              <p className="text-sm">No trend data</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Grievance Status Donut - Updated Palette */}
                    {hasModule(Module.GRIEVANCE) && (
                      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden flex flex-col">
                        <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center border border-purple-100/50">
                              <PieChartIcon className="w-4 h-4 text-purple-600" />
                            </div>
                            <div>
                              <h3 className="text-[14px] font-black text-slate-800 uppercase tracking-tight leading-none">
                                Grievance Operational Status
                              </h3>
                              <p className="text-[15px] text-slate-400 font-bold uppercase tracking-tighter mt-0.5">
                                Real-time efficiency
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between">
                          {(() => {
                            const chart = [
                              {
                                name: "Pending",
                                value: stats?.grievances.pending || 0,
                                color: "#f59e0b",
                                subText: "Awaiting assignment",
                              },
                              {
                                name: "In Progress",
                                value:
                                  stats?.grievances.assigned ||
                                  stats?.grievances.inProgress ||
                                  0,
                                color: "#6366f1",
                                subText: "Active resolution",
                              },
                              {
                                name: "Resolved",
                                value: stats?.grievances.resolved || 0,
                                color: "#10b981",
                                subText: "Completed cases",
                              },
                              {
                                name: "Rejected",
                                value: stats?.grievances.rejected || 0,
                                color: "#ef4444",
                                subText: "Closed without resolution",
                              },
                              {
                                name: "Reverted",
                                value: stats?.grievances.reverted || 0,
                                color: "#0ea5e9",
                                subText: "Reassigned cases",
                              },
                            ].filter((d) => d.value > 0);
                            return chart.length > 0 ? (
                              <>
                                <div className="relative h-[120px]">
                                  <ResponsiveContainer
                                    width="100%"
                                    height="100%"
                                  >
                                    <PieChart>
                                      <Pie
                                        data={chart}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={40}
                                        outerRadius={55}
                                        paddingAngle={6}
                                        dataKey="value"
                                        strokeWidth={0}
                                      >
                                        {chart.map((entry, i) => (
                                          <Cell
                                            key={i}
                                            fill={entry.color}
                                            className="outline-none hover:opacity-80 transition-opacity"
                                          />
                                        ))}
                                      </Pie>
                                      <Tooltip
                                        contentStyle={{
                                          borderRadius: "16px",
                                          border: "none",
                                          boxShadow:
                                            "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                                          fontSize: "14px",
                                          fontWeight: "bold",
                                        }}
                                      />
                                    </PieChart>
                                  </ResponsiveContainer>
                                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                    <span className="text-xl font-black text-slate-900 tracking-tighter">
                                      {totalRegisteredGrievances}
                                    </span>
                                    <span className="text-[14px] font-black text-slate-400 uppercase tracking-widest mt-0.5">
                                      Total
                                    </span>
                                  </div>
                                </div>
                                <div className="space-y-1.5 mt-3">
                                  {chart.map((d, i) => (
                                    <div
                                      key={i}
                                      className="group flex items-center justify-between p-1.5 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                                      role="button"
                                      tabIndex={0}
                                      aria-label={`Open ${d.name} grievances`}
                                      onClick={() =>
                                        navigateToGrievances({
                                          status: d.name.toUpperCase(),
                                        })
                                      }
                                      onKeyDown={(e) => {
                                        if (
                                          e.key === "Enter" ||
                                          e.key === " "
                                        ) {
                                          e.preventDefault();
                                          navigateToGrievances({
                                            status: d.name.toUpperCase(),
                                          });
                                        }
                                      }}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span
                                          className="w-2 h-2 rounded-full shadow-sm"
                                          style={{ backgroundColor: d.color }}
                                        ></span>
                                        <div>
                                          <p className="text-[14px] font-black text-slate-700 uppercase tracking-tighter leading-none">
                                            {d.name}
                                          </p>
                                          <p className="text-[14px] text-slate-400 group-hover:text-slate-500 transition-colors mt-0.5">
                                            {d.subText}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-[15px] font-black text-slate-900 leading-none">
                                          {d.value}
                                        </p>
                                        <p className="text-[14px] font-bold text-slate-400 mt-0.5">
                                          {(
                                            (d.value /
                                              (stats?.grievances
                                                .registeredTotal ||
                                                stats?.grievances.total ||
                                                1)) *
                                            100
                                          ).toFixed(0)}
                                          %
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <div className="h-[120px] flex items-center justify-center text-slate-400 text-sm border border-dashed rounded-lg border-slate-200">
                                No data
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* High Grievance Departments */}
                    {hasModule(Module.GRIEVANCE) && isViewingCompany && (
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[320px]">
                        <div className="px-4 py-3 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-rose-50 rounded-xl flex items-center justify-center border border-rose-100/50 flex-shrink-0">
                              <Building className="w-4 h-4 text-rose-600" />
                            </div>
                            <div>
                              <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight leading-tight">
                                High Grievance Departments
                              </h3>
                              <p className="text-[14px] text-slate-400 font-bold uppercase tracking-tighter">
                                Grievance Distribution
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
                            <select
                              value={highGrievanceMainDept}
                              onChange={(e) => {
                                setHighGrievanceMainDept(e.target.value);
                                setHighGrievanceSubDept(""); // Reset sub-dept on main-dept change
                              }}
                              className="text-[14px] h-7 px-2 border border-slate-200 rounded-lg focus:ring-1 focus:ring-rose-500 bg-white font-bold text-slate-700 max-w-[120px]"
                            >
                              <option value="">🏢 All Main Depts</option>
                              {allDepartments
                                .filter((d) => !d.parentDepartmentId)
                                .map((d) => (
                                  <option key={d._id} value={d._id}>
                                    {d.name}
                                  </option>
                                ))}
                            </select>
                            {highGrievanceMainDept && (
                              <select
                                value={highGrievanceSubDept}
                                onChange={(e) => setHighGrievanceSubDept(e.target.value)}
                                className="text-[14px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-1 focus:ring-rose-500 bg-white font-bold text-slate-700 max-w-[140px]"
                              >
                                <option value="">🏢 All Sub Depts</option>
                                {allDepartments
                                  .filter((d) => {
                                    const parentId = typeof d.parentDepartmentId === 'object' 
                                      ? (d.parentDepartmentId as any)?._id 
                                      : d.parentDepartmentId;
                                    return parentId === highGrievanceMainDept;
                                  })
                                  .map((d) => (
                                    <option key={d._id} value={d._id}>
                                      {d.name}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </div>
                        </div>
                        <div className="p-4 flex-1 overflow-hidden">
                          {(() => {
                            // Logic for filtering chart data
                            const filteredData = departmentData.filter((d: any) => {
                              const deptId = d.departmentId || d._id || "";
                              const parentId = d.parentDepartmentId || "";
                              
                              // Basic cleanup
                              if (!d.departmentName || d.departmentName.trim() === "" || d.departmentName === "Unnamed Department") {
                                return false;
                              }

                              // If a sub-department is selected, show only that
                              if (highGrievanceSubDept) {
                                return deptId === highGrievanceSubDept;
                              }

                              // If a main department is selected, show only its sub-departments
                              if (highGrievanceMainDept) {
                                return parentId === highGrievanceMainDept;
                              }

                              // By default, show only main departments
                              return !parentId;
                            }).sort((a, b) => b.count - a.count);

                            const chartHeight = Math.max(240, filteredData.length * 45);

                            return (
                              <div className="h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                                <ResponsiveContainer width="100%" height={chartHeight}>
                                  <BarChart
                                    data={filteredData}
                                    layout="vertical"
                                    margin={{
                                      left: 20,
                                      right: 40,
                                      top: 10,
                                      bottom: 10,
                                    }}
                                  >
                                    <CartesianGrid
                                      strokeDasharray="3 3"
                                      stroke="#f1f5f9"
                                      horizontal={false}
                                    />
                                    <XAxis type="number" hide />
                                    <YAxis
                                      dataKey="departmentName"
                                      type="category"
                                      interval={0}
                                      tick={{
                                        fontSize: 9,
                                        fontWeight: "bold",
                                        fill: "#64748b",
                                      }}
                                      width={140}
                                    />
                                    <Tooltip
                                      cursor={{ fill: "#f8fafc" }}
                                      contentStyle={{
                                        borderRadius: "12px",
                                        border: "none",
                                        boxShadow:
                                          "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                                        fontSize: "14px",
                                      }}
                                    />
                                    <Bar
                                      dataKey="count"
                                      fill="#ef4444"
                                      radius={[0, 4, 4, 0]}
                                      barSize={16}
                                      name="Total Grievances"
                                      className="cursor-pointer"
                                      onClick={(data: any) => {
                                        const departmentId = data?.departmentId || data?._id || "";
                                        const parentId = data?.parentDepartmentId || "";
                                        
                                        const filters: Partial<typeof grievanceFilters> = {
                                          status: "",
                                        };

                                        if (departmentId) {
                                          if (parentId) {
                                            // 🏢 Sub-Department: Filter by parent AND self
                                            filters.mainDeptId = parentId;
                                            filters.subDeptId = departmentId;
                                          } else {
                                            // 🏢 Main Department: Filter by self only
                                            filters.mainDeptId = departmentId;
                                            filters.subDeptId = "";
                                          }
                                          filters.department = "";
                                        }

                                        navigateToGrievances(filters);
                                      }}
                                    />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Appointments by Status - Company Admin only */}
                    {canShowAppointmentsInView && isViewingCompany && (
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                          <div className="w-8 h-8 bg-violet-50 rounded-lg flex items-center justify-center">
                            <CalendarCheck className="w-4 h-4 text-violet-600" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-800">
                              Appointment Overview
                            </h3>
                            <p className="text-[14px] text-slate-400">
                              Status distribution
                            </p>
                          </div>
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between">
                          {(() => {
                            const apptData = [
                              {
                                name: "Pending",
                                value: stats?.appointments.pending || 0,
                                color: "#f59e0b",
                              },
                              {
                                name: "Confirmed",
                                value: stats?.appointments.confirmed || 0,
                                color: "#6366f1",
                              },
                              {
                                name: "Completed",
                                value: stats?.appointments.completed || 0,
                                color: "#10b981",
                              },
                              {
                                name: "Cancelled",
                                value: stats?.appointments.cancelled || 0,
                                color: "#f43f5e",
                              },
                            ].filter((d) => d.value > 0);
                            return apptData.length > 0 ? (
                              <>
                                <ResponsiveContainer width="100%" height={120}>
                                  <BarChart
                                    data={apptData}
                                    layout="vertical"
                                    margin={{
                                      left: 0,
                                      right: 0,
                                      top: 0,
                                      bottom: 0,
                                    }}
                                  >
                                    <CartesianGrid
                                      strokeDasharray="3 3"
                                      stroke="#f1f5f9"
                                      horizontal={false}
                                    />
                                    <XAxis
                                      type="number"
                                      tick={{ fontSize: 14, fill: "#94a3b8" }}
                                      allowDecimals={false}
                                    />
                                    <YAxis
                                      type="category"
                                      dataKey="name"
                                      tick={{ fontSize: 14, fill: "#94a3b8" }}
                                      width={60}
                                    />
                                    <Tooltip
                                      contentStyle={{
                                        borderRadius: "12px",
                                        border: "1px solid #e2e8f0",
                                        fontSize: "14px",
                                      }}
                                    />
                                    <Bar
                                      dataKey="value"
                                      radius={[0, 4, 4, 0]}
                                      name="Count"
                                      barSize={16}
                                    >
                                      {apptData.map((entry, i) => (
                                        <Cell key={i} fill={entry.color} />
                                      ))}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
                                  <div className="text-center">
                                    <p className="text-xl font-black text-slate-900 leading-none">
                                      {stats?.appointments.last7Days || 0}
                                    </p>
                                    <p className="text-[15px] text-slate-500 font-semibold uppercase mt-1">
                                      Last 7 days
                                    </p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-xl font-black text-emerald-600 leading-none">
                                      {(
                                        stats?.appointments.completionRate || 0
                                      ).toFixed(0)}
                                      %
                                    </p>
                                    <p className="text-[15px] text-slate-500 font-semibold uppercase mt-1">
                                      Completion Rate
                                    </p>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="h-[120px] flex items-center justify-center text-slate-400 text-sm border border-dashed rounded-lg border-slate-200">
                                No appointment data
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Staff by Role */}
                    {isCompanyAdminRole || isSuperAdminUser ? (
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                          <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                            <Users className="w-4 h-4 text-emerald-600" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-800">
                              Staff by Role
                            </h3>
                            <p className="text-[14px] text-slate-400">
                              {isViewingCompany
                                ? "Across all departments"
                                : "In your department"}
                            </p>
                          </div>
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between">
                          {(() => {
                            const roleDataRaw = stats?.usersByRole || [];
                            const localRoleMap: Record<string, number> = {};

                            if (roleDataRaw.length === 0 || isDepartmentLevel) {
                              // Extract all department IDs the current user is mapped to
                              const myDeptIds = new Set(
                                [
                                  user?.departmentId,
                                  ...(user?.departmentIds || []),
                                ]
                                  .filter(Boolean)
                                  .map((d) =>
                                    String(
                                      typeof d === "object" ? d._id || d : d,
                                    ),
                                  ),
                              );

                              const filteredForStats = isViewingCompany
                                ? users
                                : users.filter((u) => {
                                    const uDeptId = String(
                                      typeof u.departmentId === "object"
                                        ? u.departmentId?._id || u.departmentId
                                        : u.departmentId,
                                    );
                                    const uDeptIds = (
                                      u.departmentIds || []
                                    ).map((d: any) =>
                                      String(
                                        typeof d === "object" ? d?._id || d : d,
                                      ),
                                    );
                                    const uIdMatch =
                                      uDeptId && myDeptIds.has(uDeptId);
                                    const uIdsMatch = uDeptIds.some(
                                      (id: string) => myDeptIds.has(id),
                                    );
                                    return uIdMatch || uIdsMatch;
                                  });

                              filteredForStats.forEach((u) => {
                                let roleName = "";
                                if (
                                  typeof u.customRoleId === "object" &&
                                  u.customRoleId?.name
                                ) {
                                  roleName = u.customRoleId.name;
                                } else {
                                  roleName =
                                    u.role?.replace(/_/g, " ") || "Unknown";
                                }
                                const normalizedRole = roleName.toUpperCase();
                                localRoleMap[normalizedRole] =
                                  (localRoleMap[normalizedRole] || 0) + 1;
                              });
                            }

                            const roleColors = [
                              "#6366f1",
                              "#10b981",
                              "#f59e0b",
                              "#f43f5e",
                              "#8b5cf6",
                            ];

                            const roleData = (
                              roleDataRaw.length > 0
                                ? roleDataRaw.map((r, i) => ({
                                    name: r.name.toUpperCase(),
                                    value: r.count,
                                    color: roleColors[i % roleColors.length],
                                  }))
                                : Object.entries(localRoleMap).map(
                                    ([name, value], i) => ({
                                      name,
                                      value,
                                      color: roleColors[i % roleColors.length],
                                    }),
                                  )
                            ).filter((r) => {
                              const uLevel = user?.level ?? 4;
                              if (uLevel <= 1) return true; // Company Admin+: Full access
                              if (uLevel === 2) {
                                // Dept Admin: Dept Admin + Sub-Dept Admin + Operator
                                return (
                                  !r.name.includes("COMPANY") &&
                                  !r.name.includes("SUPER")
                                );
                              }
                              if (uLevel === 3) {
                                // Sub-Dept Admin: Sub-Dept Admin + Operator
                                return (
                                  (r.name.includes("SUB") ||
                                    r.name.includes("OPERATOR")) &&
                                  !r.name.includes("COMPANY")
                                );
                              }
                              return false;
                            });

                            const totalStaffCount = roleData.reduce(
                              (acc, curr) => acc + curr.value,
                              0,
                            );

                            if (roleData.length === 0) {
                              return (
                                <div className="h-[120px] flex items-center justify-center text-slate-400 text-sm border border-dashed rounded-lg border-slate-200">
                                  No staff data available
                                </div>
                              );
                            }

                            return (
                              <div className="space-y-2 mt-1">
                                {roleData.map((r, i) => (
                                  <div key={i}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[15px] font-black text-slate-500 uppercase tracking-tighter">
                                        {r.name}
                                      </span>
                                      <span className="text-[15px] font-black text-slate-900 leading-none">
                                        {r.value}
                                      </span>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                      <div
                                        className="h-full rounded-full transition-all duration-700"
                                        style={{
                                          width: `${totalStaffCount > 0 ? (r.value / totalStaffCount) * 100 : 0}%`,
                                          backgroundColor: r.color,
                                        }}
                                      ></div>
                                    </div>
                                  </div>
                                ))}
                                <div className="pt-2 mt-3 border-t border-slate-100 flex items-center justify-between">
                                  <span className="text-[15px] font-bold text-slate-400 uppercase">
                                    Total Staff
                                  </span>
                                  <span className="text-[14px] font-black text-slate-900 tabular-nums leading-none">
                                    {totalStaffCount}
                                  </span>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </TabsContent>
              )}

              {/* Departments Tab - For Company Admin & Superadmin Drilldown */}
              {canSeeDepartmentsTab && (
                <TabsContent value="departments" className="space-y-4">
                  <Card className="rounded-xl border border-slate-200 shadow-sm bg-white">
                    <CardContent className="p-0">
                      <div className="relative z-30 px-6 py-4 bg-slate-50/50 border-b border-slate-200 space-y-4 rounded-t-xl">
                        {/* Top Action Bar */}
                        <div className="mb-3 space-y-3">
                          <div className="flex items-stretch gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
                            <div className="relative min-w-0 flex-1 md:max-w-md">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                              <input
                                type="text"
                                placeholder="Quick search..."
                                value={deptSearch}
                                onChange={(e) => setDeptSearch(e.target.value)}
                                className="w-full pl-9 pr-3.5 h-9 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-[15px] font-bold uppercase tracking-tight placeholder:normal-case placeholder:text-slate-400 shadow-sm"
                              />
                            </div>

                            <div className="flex items-center gap-2 md:hidden">
                              {(isSuperAdminUser ||
                                (hasPermission(
                                  user,
                                  Permission.CREATE_DEPARTMENT,
                                ) &&
                                  !isSubDepartmentAdminRole &&
                                  !isOperatorRole)) && (
                                <Button
                                  type="button"
                                  onClick={() => setShowDepartmentDialog(true)}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white border-0 h-9 text-[14px] font-bold uppercase tracking-wide rounded-lg px-3 shadow-md transition-all active:scale-95 whitespace-nowrap"
                                >
                                  <Building className="w-3.5 h-3.5 mr-1.5" />
                                  Add Department
                                </Button>
                              )}
                            </div>

                            <div className="hidden md:flex items-center gap-3 flex-wrap justify-end">
                              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                {isSuperAdminUser &&
                                  selectedDepartments.size > 0 && (
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      onClick={handleBulkDeleteDepartments}
                                      disabled={isDeleting}
                                      className="h-8 text-[14px] font-bold uppercase bg-red-600 hover:bg-red-700 text-white rounded-lg border border-red-700 shadow-sm transition-all px-3"
                                    >
                                      <Trash2 className="w-3 h-3 mr-1.5" />
                                      Delete ({selectedDepartments.size})
                                    </Button>
                                  )}
                                {(isSuperAdminUser ||
                                  (hasPermission(
                                    user,
                                    Permission.CREATE_DEPARTMENT,
                                  ) &&
                                    !isSubDepartmentAdminRole &&
                                    !isOperatorRole)) && (
                                  <Button
                                    type="button"
                                    onClick={() => setShowDepartmentDialog(true)}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white border-0 h-9 text-[15px] font-bold uppercase tracking-wide rounded-lg px-4 shadow-md transition-all active:scale-95 whitespace-nowrap"
                                  >
                                    <Building className="w-3.5 h-3.5 mr-1.5" />
                                    Add Department
                                  </Button>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className="text-[14px] font-bold text-slate-700 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-200 whitespace-nowrap h-8 flex items-center">
                                    Showing{" "}
                                    <span className="text-indigo-600 font-black px-1">
                                      {departments.length}
                                    </span>{" "}
                                    of {departmentPagination.total}
                                  </span>

                                  <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm h-8">
                                    <span className="text-[15px] font-black text-slate-400 uppercase tracking-widest">
                                      Rows:
                                    </span>
                                    <select
                                      value={departmentPagination.limit}
                                      onChange={(e) =>
                                        setDepartmentPagination((prev) => ({
                                          ...prev,
                                          limit: Number(e.target.value),
                                        }))
                                      }
                                      className="text-[14px] font-bold text-slate-900 bg-transparent border-0 focus:ring-0 cursor-pointer p-0 h-auto"
                                    >
                                      {[10, 20, 25, 50, 100, 200, 250].map((l) => (
                                        <option key={l} value={l}>
                                          {l}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 md:hidden overflow-x-auto pb-2 no-scrollbar">
                            {!(
                              isDepartmentAdminRole ||
                              isSubDepartmentAdminRole ||
                              isOperatorRole
                            ) && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setShowDepartmentFiltersOnMobile(
                                    (prev) => !prev,
                                  )
                                }
                                className="shrink-0 border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap h-8 text-[14px] font-bold uppercase tracking-tight"
                                title="Toggle filters"
                              >
                                <Filter className="w-3.5 h-3.5 mr-1" />
                                Filters
                              </Button>
                            )}

                            <span className="shrink-0 text-[14px] font-bold text-slate-700 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-200 whitespace-nowrap h-8 flex items-center">
                              Showing{" "}
                              <span className="text-indigo-600 font-black px-1">
                                {departments.length}
                              </span>{" "}
                              of {departmentPagination.total}
                            </span>

                            <div className="shrink-0 flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm h-8">
                              <span className="text-[15px] font-black text-slate-400 uppercase tracking-widest">
                                Rows:
                              </span>
                              <select
                                value={departmentPagination.limit}
                                onChange={(e) =>
                                  setDepartmentPagination((prev) => ({
                                    ...prev,
                                    limit: Number(e.target.value),
                                  }))
                                }
                                className="text-[14px] font-bold text-slate-900 bg-transparent border-0 focus:ring-0 cursor-pointer p-0 h-auto"
                              >
                                {[10, 20, 25, 50, 100, 200, 250].map((l) => (
                                  <option key={l} value={l}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {isSuperAdminUser && selectedDepartments.size > 0 && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleBulkDeleteDepartments}
                                disabled={isDeleting}
                                className="shrink-0 h-8 text-[14px] font-bold uppercase bg-red-600 hover:bg-red-700 text-white rounded-lg border border-red-700 shadow-sm transition-all px-3"
                              >
                                <Trash2 className="w-3 h-3 mr-1.5" />
                                Delete ({selectedDepartments.size})
                              </Button>
                            )}
                          </div>
                        </div>
                        <div
                          className={cn(
                            "flex-col sm:flex-row items-stretch sm:items-center gap-3",
                            showDepartmentFiltersOnMobile
                              ? "flex"
                              : "hidden md:flex",
                          )}
                        >
                          {!(
                            isDepartmentAdminRole ||
                            isSubDepartmentAdminRole ||
                            isOperatorRole
                          ) && (
                            <>
                              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-200 h-8">
                                <Filter className="w-3.5 h-3.5 text-indigo-500" />
                                <span className="text-[15px] font-bold text-slate-700 uppercase tracking-tight">
                                  Filters
                                </span>
                              </div>

                              <div className="flex items-center gap-2 flex-wrap flex-1">
                                <select
                                  value={deptFilters.type}
                                  onChange={(e) =>
                                    setDeptFilters((prev) => ({
                                      ...prev,
                                      type: e.target.value,
                                    }))
                                  }
                                  className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium w-full sm:max-w-[120px]"
                                  title="Filter by department type"
                                >
                                  <option value="">🏢 All Types</option>
                                  <option value="main">Main Dept</option>
                                  <option value="sub">Sub Dept</option>
                                </select>

                                <select
                                  value={deptFilters.status}
                                  onChange={(e) =>
                                    setDeptFilters((prev) => ({
                                      ...prev,
                                      status: e.target.value,
                                    }))
                                  }
                                  className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium w-full sm:max-w-[120px]"
                                  title="Filter by status"
                                >
                                  <option value="">📊 All Status</option>
                                  <option value="active">Active</option>
                                  <option value="inactive">Inactive</option>
                                </select>

                                {!isSubDepartmentAdminRole && !isOperatorRole && (
                                  <DashboardDepartmentFilters
                                    allDepartments={scopedDepartmentsForFilters}
                                    getParentDepartmentId={getParentDepartmentId}
                                    onFiltersChange={(filters) => {
                                      setDeptFilters((prev) => ({
                                        ...prev,
                                        mainDeptId: filters.mainDeptId,
                                        subDeptId: filters.subDeptId,
                                      }));
                                      setDepartmentPage(1);
                                    }}
                                    currentFilters={deptFilters}
                                    showSubDepartmentSelect={!isDepartmentAdminRole}
                                    showOnlySubDepartmentsInMainSelect={
                                      isDepartmentAdminRole
                                    }
                                    className="w-full md:w-auto"
                                  />
                                )}

                                  {(deptFilters.type ||
                                    deptFilters.status ||
                                    deptFilters.mainDeptId ||
                                    deptFilters.subDeptId ||
                                    deptSearch.trim()) && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setDeptSearch("");
                                        setDeptFilters({
                                          type: "",
                                          status: "",
                                          mainDeptId: "",
                                          subDeptId: "",
                                        });
                                      }}
                                      className="h-8 px-3 text-[15px] text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 font-medium"
                                      title="Clear all filters"
                                    >
                                      <X className="w-3 h-3 mr-1" />
                                      Clear
                                    </Button>
                                  )}
                                {canToggleDepartmentPriorityColumn && (
                                  <div className="flex items-center gap-2 h-8 px-3 rounded-xl border border-slate-200 bg-white shadow-sm">
                                    <Settings className="w-3.5 h-3.5 text-slate-500" />
                                    <span className="text-[14px] font-black uppercase tracking-widest text-slate-600 whitespace-nowrap">
                                      Priority Column
                                    </span>
                                    <Switch
                                      checked={showDepartmentPriorityColumn}
                                      onCheckedChange={
                                        handleToggleDepartmentPriorityColumn
                                      }
                                      aria-label="Toggle priority column visibility for company admin"
                                    />
                                  </div>
                                )}
                              </div>
                            </>
                          )}

                          <div className="ml-auto flex items-center gap-2 text-[14px] font-bold text-slate-400 uppercase tracking-widest">
                            {!isDepartmentAdminRole && (
                              <>
                                <span className="px-2 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-lg whitespace-nowrap">
                                  {filteredDeptCounts.mainCount} Main
                                </span>
                                <span className="px-2 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg whitespace-nowrap">
                                  {filteredDeptCounts.subCount} Sub
                                </span>
                              </>
                            )}
                            {isSuperAdminUser && selectedDepartments.size > 0 && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleBulkDeleteDepartments}
                                disabled={isDeleting}
                                className="text-[15px] font-black h-7 px-3 bg-red-600 hover:bg-red-700 text-white rounded-lg border border-red-700 shadow-sm transition-all animate-in zoom-in duration-200"
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                Delete ({selectedDepartments.size})
                              </Button>
                            )}
                          </div>
                          </div>
                        </div>

                        {loadingDepartments ? (
                          <div className="flex flex-col gap-4 p-4">
                            {[1, 2, 3, 4].map((i) => (
                              <div key={i} className="h-32 bg-slate-50 animate-pulse rounded-xl" />
                            ))}
                          </div>
                        ) : departments.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                              <Building className="w-8 h-8 text-slate-400" />
                            </div>
                            <p className="text-gray-500 text-lg font-medium">
                              No departments found
                            </p>
                            <p className="text-gray-400 text-sm mt-1">
                              Add a department to get started
                            </p>
                          </div>
                        ) : (
                          <>
                            {/* Mobile Card View */}
                            <div className="md:hidden divide-y divide-slate-100">
                              {getSortedData(departments, "departments").map((dept, index) => {
                                const isMain = !dept.parentDepartmentId;
                                const userCount = dept.userCount || deptUserCounts[dept._id] || 0;
                                const departmentSerialNumber =
                                  (departmentPage - 1) * departmentPagination.limit +
                                  index +
                                  1;
                                const headDisplayName =
                                  dept.head || dept.headName || dept.contactPerson || "—";
                                const hasLinkedHeadProfile = Boolean(
                                  getDepartmentHeadUserId(dept),
                                );
                                return (
                                  <div key={dept._id} className="p-3 bg-white active:bg-slate-50/80 transition-colors">
                                    {/* ── TOP ROW: Icon · Name · Badges · Actions ── */}
                                    <div className="flex items-start gap-2">
                                      {/* Icon */}
                                      <div className={cn(
                                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border mt-0.5",
                                        isMain ? "bg-indigo-50 text-indigo-600 border-indigo-100" : "bg-slate-50 text-slate-500 border-slate-200"
                                      )}>
                                        <Building className="w-3.5 h-3.5" />
                                      </div>

                                      {/* Name + badges */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-start gap-2">
                                          <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-slate-100 px-1.5 text-[15px] font-black text-slate-600 shadow-sm">
                                            {departmentSerialNumber}
                                          </span>
                                          <h4 className="pt-0.5 text-sm font-bold text-slate-900 leading-tight break-words">
                                            {dept.name}
                                          </h4>
                                        </div>
                                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                          <span className={cn(
                                            "px-1.5 py-0.5 rounded text-[14px] font-black uppercase tracking-wider border",
                                            isMain ? "bg-indigo-600 text-white border-indigo-700 shadow-sm" : "bg-slate-200 text-slate-700 border-slate-300 shadow-sm"
                                          )}>
                                            {isMain ? "MAIN DEPARTMENT" : "SUB DEPARTMENT"}
                                          </span>
                                          <span className={cn(
                                            "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[14px] font-black uppercase tracking-wider border",
                                            dept.isActive
                                              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                              : "bg-slate-50 text-slate-400 border-slate-100"
                                          )}>
                                            <span className={cn("w-1 h-1 rounded-full", dept.isActive ? "bg-emerald-500" : "bg-slate-400")} />
                                            {dept.isActive ? "Active" : "Inactive"}
                                          </span>
                                          {dept.departmentId && (
                                            <span className="font-mono text-[14px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                              {dept.departmentId}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Action buttons */}
                                      <div className="flex items-center gap-0.5 shrink-0">
                                        {hasPermission(user, Permission.UPDATE_DEPARTMENT) && (
                                          <button
                                            onClick={() => { setEditingDepartment(dept); setShowDepartmentDialog(true); }}
                                            className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                            title="Edit Department"
                                          >
                                            <Edit2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {hasPermission(user, Permission.VIEW_DEPARTMENT) && (
                                          <button
                                            onClick={() => { setSelectedDeptForUsers({ id: dept._id, name: dept.name }); setShowDeptUsersDialog(true); }}
                                            className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                            title="View Users"
                                          >
                                            <Users className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* ── STATS ROW ── */}
                                    <div className="grid grid-cols-2 gap-2 mt-3">
                                      <button 
                                        type="button"
                                        onClick={() => { setSelectedDeptForUsers({ id: dept._id, name: dept.name }); setShowDeptUsersDialog(true); }}
                                        className="bg-emerald-50/50 rounded-lg p-2.5 border border-emerald-100 text-left hover:bg-emerald-100/50 transition-colors group"
                                      >
                                        <div className="flex items-center gap-1 mb-0.5">
                                          <Users className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                          <span className="text-[15px] font-black text-emerald-700 uppercase tracking-wider">Personnel</span>
                                        </div>
                                        <p className="text-xs font-bold text-slate-800">{userCount} Staff Members</p>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleMobileDepartmentHeadClick(dept)}
                                        disabled={!hasLinkedHeadProfile}
                                        className={cn(
                                          "rounded-lg border p-2.5 text-left transition-colors",
                                          hasLinkedHeadProfile
                                            ? "bg-indigo-50/50 border-indigo-100 hover:bg-indigo-100/60"
                                            : "bg-indigo-50/40 border-indigo-100/70 opacity-80",
                                        )}
                                      >
                                        <div className="flex items-center gap-1 mb-0.5">
                                          <UserIcon className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                          <span className="text-[15px] font-black text-indigo-700 uppercase tracking-wider">Admin Head</span>
                                        </div>
                                        <p className="text-xs font-bold text-slate-800 leading-normal break-words">
                                          {headDisplayName}
                                        </p>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Desktop Table View */}
                            <div className="hidden md:block overflow-x-auto">
                              <div className="max-h-[640px] overflow-y-auto">
                                <table className="w-full relative border-collapse">
                                  <thead className="sticky top-0 z-20 bg-[#fcfdfe] border-b border-slate-200">
                                    <tr>
                                      {isSuperAdminUser && (
                                        <th className="px-3 py-3 text-center border-b border-slate-100">
                                          <input
                                            type="checkbox"
                                            checked={
                                              selectedDepartments.size > 0 &&
                                              selectedDepartments.size ===
                                                getSortedData(
                                                  departments,
                                                  "departments",
                                                ).length
                                            }
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setSelectedDepartments(
                                                  new Set(
                                                    getSortedData(
                                                      departments,
                                                      "departments",
                                                    ).map((d) => d._id),
                                                  ),
                                                );
                                              } else {
                                                setSelectedDepartments(new Set());
                                              }
                                            }}
                                            className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                          />
                                        </th>
                                      )}
                                      <th className="px-3 py-3 text-center text-[15px] font-black text-slate-400 border-b border-slate-100 uppercase tracking-widest w-12">
                                        Sr.
                                      </th>
                                      <th className="px-4 py-3 text-left border-b border-slate-100">
                                        <button
                                          onClick={() =>
                                            handleSort("name", "departments")
                                          }
                                      className="group flex items-center space-x-1.5 text-[15px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                    >
                                      <span>Department Name</span>
                                      <SortIcon sortConfig={sortConfig} columnKey="name" />
                                    </button>
                                  </th>
                                  <th className="px-4 py-3 text-center border-b border-slate-100">
                                    <button
                                      onClick={() =>
                                        handleSort("type", "departments")
                                      }
                                      className="group flex items-center justify-center space-x-1.5 text-[15px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors mx-auto"
                                    >
                                      <span>Type</span>
                                      <SortIcon sortConfig={sortConfig} columnKey="type" />
                                    </button>
                                  </th>
                                  <th className="px-4 py-3 text-center border-b border-slate-100">
                                    <button
                                      onClick={() =>
                                        handleSort("userCount", "departments")
                                      }
                                      className="group flex items-center justify-center space-x-1.5 text-[15px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors mx-auto"
                                    >
                                      <span>Users</span>
                                      <SortIcon sortConfig={sortConfig} columnKey="userCount" />
                                    </button>
                                  </th>
                                  {showDepartmentPriorityColumn && (
                                    <th className="px-4 py-3 text-center border-b border-slate-100 text-[15px] font-black text-slate-400 uppercase tracking-widest">
                                      Priority
                                    </th>
                                  )}
                                  <th className="px-4 py-3 text-left border-b border-slate-100 text-[15px] font-black text-slate-400 uppercase tracking-widest">
                                    Head / Contact
                                  </th>
                                  <th className="px-4 py-3 text-center border-b border-slate-100">
                                    <button
                                      onClick={() =>
                                        handleSort("status", "departments")
                                      }
                                      className="group flex items-center justify-center space-x-1.5 text-[15px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors mx-auto"
                                    >
                                      <span>Status</span>
                                      <SortIcon sortConfig={sortConfig} columnKey="status" />
                                    </button>
                                  </th>
                                  <th className="px-4 py-3 text-right border-b border-slate-100 text-[15px] font-black text-slate-400 uppercase tracking-widest">
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 bg-white">
                                {departments.map(
                                  (dept, index) => {
                                    const isMain = !dept.parentDepartmentId;
                                    const userCount =
                                      dept.userCount ||
                                      deptUserCounts[dept._id] ||
                                      0;
                                    const parentName = (() => {
                                      if (
                                        typeof dept.parentDepartmentId ===
                                          "object" &&
                                        dept.parentDepartmentId?.name
                                      ) {
                                        return dept.parentDepartmentId.name;
                                      }
                                      if (
                                        typeof dept.parentDepartmentId ===
                                        "string"
                                      ) {
                                        const parent = allDepartments.find(
                                          (d) =>
                                            d._id === dept.parentDepartmentId,
                                        );
                                        if (parent) return parent.name;
                                      }
                                      return null;
                                    })();
                                    return (
                                      <tr
                                        key={dept._id}
                                        className="hover:bg-indigo-50/30 transition-all duration-150 group/row"
                                      >
                                        {/* Checkbox */}
                                        {isSuperAdminUser && (
                                          <td className="px-3 py-4 text-center">
                                            <input
                                              type="checkbox"
                                              checked={selectedDepartments.has(
                                                dept._id,
                                              )}
                                              onChange={() => {
                                                const next = new Set(
                                                  selectedDepartments,
                                                );
                                                if (next.has(dept._id))
                                                  next.delete(dept._id);
                                                else next.add(dept._id);
                                                setSelectedDepartments(next);
                                              }}
                                              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                            />
                                          </td>
                                        )}

                                        {/* # */}
                                        <td className="px-3 py-4 text-center">
                                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 text-slate-500 text-[14px] font-black group-hover/row:bg-indigo-100 group-hover/row:text-indigo-700 transition-colors">
                                            {(departmentPage - 1) *
                                              departmentPagination.limit +
                                              index +
                                              1}
                                          </span>
                                        </td>

                                        {/* Department Name */}
                                        <td className="px-3 py-3 sm:px-4 sm:py-4">
                                          <div className="flex items-center gap-2.5">
                                            <div
                                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                                isMain
                                                  ? "bg-indigo-50 text-indigo-600 border border-indigo-100"
                                                  : "bg-slate-100 text-slate-500 border border-slate-200"
                                              }`}
                                            >
                                              <Building className="w-3 h-3" />
                                            </div>
                                            <div>
                                              <div className="text-[15px] sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
                                                {dept.name}
                                              </div>
                                              {!isMain && parentName && (
                                                <p className="text-[14px] text-slate-400 mt-0.5">
                                                  ↳ {parentName}
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                        </td>

                                        {/* Type */}
                                        <td className="px-4 py-4 text-center whitespace-normal">
                                          {isMain ? (
                                            <button
                                              onClick={() => {
                                                setSelectedDeptForHierarchy(
                                                  dept,
                                                );
                                                setShowHierarchyDialog(true);
                                              }}
                                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[15px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-300 transition-all cursor-pointer active:scale-95"
                                              title="View Hierarchy Tree"
                                            >
                                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                              Main
                                            </button>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                setSelectedDeptForHierarchy(
                                                  dept,
                                                );
                                                setShowHierarchyDialog(true);
                                              }}
                                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[15px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 hover:border-slate-300 transition-all cursor-pointer active:scale-95"
                                              title="View Hierarchy Tree"
                                            >
                                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                              Sub
                                            </button>
                                          )}
                                        </td>

                                        {/* User Count */}
                                        <td className="px-4 py-4 text-center">
                                          <div className="inline-flex items-center justify-center">
                                            <button
                                              className={`min-w-[32px] h-8 px-2 rounded-xl flex items-center justify-center text-xs font-black transition-all shadow-sm border ${
                                                userCount > 0
                                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:scale-105 active:scale-95"
                                                  : "bg-slate-50 text-slate-400 border-slate-200"
                                              }`}
                                              onClick={() => {
                                                if (userCount > 0) {
                                                  setSelectedDeptForUsers({
                                                    id: dept._id,
                                                    name: dept.name,
                                                  });
                                                  setShowDeptUsersDialog(true);
                                                }
                                              }}
                                              title={
                                                userCount > 0
                                                  ? "Click to view personnel"
                                                  : "No users assigned"
                                              }
                                            >
                                              <Users
                                                className={`w-3 h-3 mr-1.5 ${userCount > 0 ? "text-emerald-500" : "text-slate-400"}`}
                                              />
                                              {userCount}
                                            </button>
                                          </div>
                                        </td>

                                        {/* Priority */}
                                        {showDepartmentPriorityColumn && (
                                          <td className="px-4 py-4 text-center">
                                            {isMain ? (
                                              canManageDepartmentPriority ? (
                                                <div className="flex items-center justify-center gap-1.5">
                                                  <input
                                                    type="number"
                                                    min={0}
                                                    step={1}
                                                    value={
                                                      priorityDrafts[dept._id] ??
                                                      String(
                                                        dept.displayOrder ?? 999,
                                                      )
                                                    }
                                                    onChange={(e) =>
                                                      setPriorityDrafts((prev) => ({
                                                        ...prev,
                                                        [dept._id]: e.target.value,
                                                      }))
                                                    }
                                                    className="w-16 h-8 rounded-lg border border-slate-300 px-2 text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500"
                                                    title="Lower number appears first in chatbot list"
                                                  />
                                                  <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 px-2 text-[14px] font-black text-indigo-600 hover:bg-indigo-50 disabled:opacity-60"
                                                    onClick={() =>
                                                      handleSaveDepartmentPriority(
                                                        dept,
                                                      )
                                                    }
                                                    disabled={savingPriorityIds.has(
                                                      dept._id,
                                                    )}
                                                    title="Save priority"
                                                  >
                                                    {savingPriorityIds.has(
                                                      dept._id,
                                                    )
                                                      ? "Saving..."
                                                      : "Save"}
                                                  </Button>
                                                </div>
                                              ) : (
                                                <span className="inline-flex items-center justify-center min-w-[42px] h-8 rounded-lg border border-amber-200 bg-amber-50 px-2 text-xs font-black text-amber-700">
                                                  {typeof dept.displayOrder ===
                                                  "number"
                                                    ? dept.displayOrder
                                                    : 999}
                                                </span>
                                              )
                                            ) : (
                                              <span className="text-[14px] font-bold text-slate-300">
                                                -
                                              </span>
                                            )}
                                          </td>
                                        )}

                                        {/* Head / Contact */}
                                        <td className="px-4 py-4 whitespace-normal break-words">
                                          <div className="flex flex-col gap-1 min-w-[120px]">
                                            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 uppercase tracking-tight">
                                              <UserIcon className="w-3 h-3 text-slate-400 shrink-0" />
                                              {dept.head ||
                                                dept.headName ||
                                                dept.contactPerson || (
                                                  <span className="text-slate-300 font-medium">
                                                    Not assigned
                                                  </span>
                                                )}
                                            </div>
                                            {(dept.headEmail ||
                                              dept.contactEmail) && (
                                              <div className="text-[14px] text-indigo-500 flex items-center gap-1.5 font-bold hover:underline cursor-pointer transition-colors px-1 break-all">
                                                <Mail className="w-3 h-3 text-indigo-300 shrink-0" />
                                                {dept.headEmail ||
                                                  dept.contactEmail}
                                              </div>
                                            )}
                                          </div>
                                        </td>

                                        {/* Status */}
                                        <td className="px-4 py-4 text-center whitespace-normal">
                                          <div className="flex items-center justify-center gap-2">
                                            <button
                                              onClick={() => {
                                                setConfirmDialog({
                                                  isOpen: true,
                                                  title: dept.isActive
                                                    ? "Deactivate Department"
                                                    : "Activate Department",
                                                  message: dept.isActive
                                                    ? `Are you sure you want to deactivate "${dept.name}"?`
                                                    : `Are you sure you want to activate "${dept.name}"?`,
                                                  onConfirm: async () => {
                                                    try {
                                                      const response =
                                                        await departmentAPI.update(
                                                          dept._id,
                                                          {
                                                            isActive:
                                                              !dept.isActive,
                                                          },
                                                        );
                                                      if (response.success) {
                                                        toast.success(
                                                          `Department ${!dept.isActive ? "activated" : "deactivated"} successfully`,
                                                        );
                                                        fetchDepartments(
                                                          1,
                                                          true,
                                                        );
                                                      }
                                                    } catch (error: any) {
                                                      toast.error(
                                                        error.message ||
                                                          "Failed to update department status",
                                                      );
                                                    } finally {
                                                      setConfirmDialog((p) => ({
                                                        ...p,
                                                        isOpen: false,
                                                      }));
                                                    }
                                                  },
                                                  variant: dept.isActive
                                                    ? "warning"
                                                    : "default",
                                                } as any);
                                              }}
                                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                                                dept.isActive
                                                  ? "bg-emerald-500"
                                                  : "bg-gray-300"
                                              }`}
                                            >
                                              <span
                                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                                                  dept.isActive
                                                    ? "translate-x-[18px]"
                                                    : "translate-x-0.5"
                                                }`}
                                              />
                                            </button>
                                            <span
                                              className={`text-[15px] font-black uppercase tracking-wider ${
                                                dept.isActive
                                                  ? "text-emerald-600"
                                                  : "text-gray-400"
                                              }`}
                                            >
                                              {dept.isActive
                                                ? "Active"
                                                : "Inactive"}
                                            </span>
                                          </div>
                                        </td>

                                        {/* Actions */}
                                        <td className="px-4 py-4 whitespace-normal text-right">
                                          <div className="flex justify-end items-center gap-1">
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-8 w-8 p-0 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                              onClick={() => {
                                                setEditingDepartment(dept);
                                                setShowDepartmentDialog(true);
                                              }}
                                              title="Edit Department"
                                            >
                                              <Edit2 className="w-3.5 h-3.5" />
                                            </Button>

                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-8 w-8 p-0 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                                              onClick={() => {
                                                setSelectedDeptForUsers({
                                                  id: dept._id,
                                                  name: dept.name,
                                                });
                                                setShowDeptUsersDialog(true);
                                              }}
                                              title="Manage Department Personnel"
                                            >
                                              <Users className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
                                              onClick={() => {
                                                setConfirmDialog({
                                                  isOpen: true,
                                                  title: "Delete Department",
                                                  message: `Are you sure you want to delete "${dept.name}"? This action cannot be undone.`,
                                                  onConfirm: async () => {
                                                    try {
                                                      const response =
                                                        await departmentAPI.delete(
                                                          dept._id,
                                                        );
                                                      if (response.success) {
                                                        toast.success(
                                                          "Department deleted successfully",
                                                        );
                                                        setDepartments((prev) =>
                                                          prev.filter(
                                                            (d) =>
                                                              d._id !==
                                                              dept._id,
                                                          ),
                                                        );
                                                        fetchDepartments(
                                                          1,
                                                          false,
                                                        );
                                                      }
                                                    } catch (error: any) {
                                                      toast.error(
                                                        error.message ||
                                                          "Failed to delete department",
                                                      );
                                                    } finally {
                                                      setConfirmDialog((p) => ({
                                                        ...p,
                                                        isOpen: false,
                                                      }));
                                                    }
                                                  },
                                                  variant: "danger",
                                                } as any);
                                              }}
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  },
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Footer info & Pagination */}
                        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/30 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-b-xl">
                          <div className="text-[14px] font-bold text-slate-400 uppercase tracking-widest">
                            Showing{" "}
                            {(departmentPage - 1) *
                              departmentPagination.limit +
                              1}{" "}
                            to{" "}
                            {Math.min(
                              departmentPage * departmentPagination.limit,
                              departmentPagination.total,
                            )}{" "}
                            of {departmentPagination.total} departments
                          </div>
                          {departmentPagination.pages > 1 && (
                            <Pagination
                              currentPage={departmentPage}
                              totalPages={departmentPagination.pages}
                              totalItems={departmentPagination.total}
                              itemsPerPage={departmentPagination.limit}
                              onPageChange={(p) => setDepartmentPage(p)}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
              {/* Leads Tab Content */}
              {hasModule(Module.LEAD_CAPTURE) && isViewingCompany && (
                <TabsContent value="leads" className="space-y-6">
                  <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
                    <CardHeader className="bg-slate-900 px-4 sm:px-6 py-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-indigo-500/20 rounded-xl flex items-center justify-center border border-indigo-500/30">
                            <UserPlus className="w-4 h-4 text-indigo-400" />
                          </div>
                          <div>
                            <CardTitle className="text-base font-bold text-white">
                              Project Leads{" "}
                              {leads.length > 0 && `(${leads.length})`}
                            </CardTitle>
                            <p className="text-[14px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                              Leads captured from chatbot interactions
                            </p>
                          </div>
                        </div>
                        {isViewingCompany && (
                          <button
                            onClick={() =>
                              exportToCSV(leads, "leads", [
                                { key: "leadId", label: "Lead ID" },
                                { key: "name", label: "Name" },
                                { key: "companyName", label: "Company" },
                                { key: "contactInfo", label: "Phone" },
                                { key: "projectType", label: "Project Type" },
                                { key: "budgetRange", label: "Budget" },
                                { key: "status", label: "Status" },
                              ])
                            }
                            className="flex items-center gap-2 px-4 h-8 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all border border-white/20 text-[14px] font-bold uppercase tracking-wider"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Export CSV
                          </button>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="p-0">
                      {loadingLeads ? (
                        <div className="p-8 text-center text-slate-500">
                          Loading leads...
                        </div>
                      ) : leads.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                            <UserPlus className="w-8 h-8 text-slate-400" />
                          </div>
                          <p className="text-lg font-medium text-slate-700">
                            No leads found
                          </p>
                          <p className="text-sm text-slate-500 mt-1">
                            Leads captured from the chatbot will appear here.
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                              <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                                  Lead ID
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                                  Contact Details
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                                  Project Info
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                                  Status
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                                  Date
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {leads.map((lead) => (
                                <tr
                                  key={lead._id}
                                  className="hover:bg-slate-50/50 transition-colors"
                                >
                                  <td className="px-6 py-4">
                                    <span className="font-mono text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded">
                                      {lead.leadId}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-slate-900">
                                        {lead.name}
                                      </span>
                                      {lead.companyName && (
                                        <span className="text-xs text-slate-500">
                                          {lead.companyName}
                                        </span>
                                      )}
                                      <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                                        <Phone className="w-3 h-3" />
                                        {lead.contactInfo}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1">
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 w-fit">
                                        {lead.projectType}
                                      </span>
                                      {lead.budgetRange && (
                                        <span className="text-xs text-slate-500">
                                          Budget: {lead.budgetRange}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <span
                                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                                  ${
                                    lead.status === "NEW"
                                      ? "bg-blue-100 text-blue-800"
                                      : lead.status === "CONTACTED"
                                        ? "bg-yellow-100 text-yellow-800"
                                        : lead.status === "QUALIFIED"
                                          ? "bg-green-100 text-green-800"
                                          : "bg-slate-100 text-slate-800"
                                  }`}
                                    >
                                      {lead.status
                                        ?.toLowerCase()
                                        .replace("_", " ")}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-sm text-slate-500">
                                    {new Date(
                                      lead.createdAt,
                                    ).toLocaleDateString()}
                                    <div className="text-xs text-slate-400">
                                      {new Date(
                                        lead.createdAt,
                                      ).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {/* Users Tab Content */}
              {canSeeUsersTab && (
                <TabsContent value="users" className="space-y-6">
                  <Card className="rounded-xl border border-slate-200 shadow-sm bg-white">
                    <CardContent className="p-0">
                      <>
                        <div className="relative z-30 px-4 py-4 sm:px-6 bg-slate-50/50 border-b border-slate-200 space-y-4 rounded-t-xl">
                          <div className="md:hidden space-y-3">
                            <div className="flex items-stretch gap-2">
                              <div className="relative flex-1 min-w-0">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                <input
                                  type="text"
                                  placeholder="Quick search..."
                                  value={userSearch}
                                  onChange={(e) => {
                                    setUserSearch(e.target.value);
                                    setUserPage(1);
                                  }}
                                  className="w-full pl-9 pr-3.5 h-9 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-[15px] font-bold uppercase tracking-tight placeholder:normal-case placeholder:text-slate-400 shadow-sm"
                                />
                              </div>
                              {(isSuperAdminUser ||
                                hasPermission(user, Permission.CREATE_USER)) && (
                                <Button
                                  type="button"
                                  onClick={() => setShowUserDialog(true)}
                                  className="h-9 shrink-0 whitespace-nowrap rounded-lg border-0 bg-indigo-600 px-3 text-[14px] font-bold uppercase tracking-wide text-white shadow-md transition-all active:scale-95 hover:bg-indigo-700"
                                >
                                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                                  Add User
                                </Button>
                              )}
                            </div>

                            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                              {!(
                                isDepartmentAdminRole ||
                                isSubDepartmentAdminRole ||
                                isOperatorRole
                              ) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setShowUserFiltersOnMobile((prev) => !prev)
                                  }
                                  className="h-8 shrink-0 whitespace-nowrap rounded-lg border-slate-200 text-[14px] font-bold uppercase tracking-tight hover:bg-slate-50"
                                  title="Toggle filters"
                                >
                                  <Filter className="mr-1 h-3.5 w-3.5" />
                                  Filters
                                </Button>
                              )}

                              <span className="flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-[14px] font-bold text-slate-700 shadow-sm">
                                Showing
                                <span className="px-1 font-black text-indigo-600">
                                  {users.length}
                                </span>
                                of {userPagination.total}
                              </span>

                              <div className="flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 shadow-sm">
                                <span className="text-[15px] font-black uppercase tracking-widest text-slate-400">
                                  Rows:
                                </span>
                                <select
                                  value={userPagination.limit}
                                  onChange={(e) =>
                                    setUserPagination((prev) => ({
                                      ...prev,
                                      limit: Number(e.target.value),
                                    }))
                                  }
                                  className="h-auto cursor-pointer border-0 bg-transparent p-0 text-[14px] font-bold text-slate-900 focus:ring-0"
                                >
                                  {[10, 20, 25, 50, 100, 200, 250].map((l) => (
                                    <option key={l} value={l}>
                                      {l}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {isSuperAdminUser && selectedUsers.size > 0 && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={handleBulkDeleteUsers}
                                  disabled={isDeleting}
                                  className="h-8 shrink-0 rounded-lg border border-red-700 bg-red-600 px-3 text-[14px] font-bold uppercase text-white shadow-sm transition-all hover:bg-red-700"
                                >
                                  <Trash2 className="mr-1.5 h-3 w-3" />
                                  Delete ({selectedUsers.size})
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="hidden md:flex md:items-center md:justify-between gap-3">
                            <div className="relative w-full md:max-w-md flex-1">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                              <input
                                type="text"
                                placeholder="Quick search..."
                                value={userSearch}
                                onChange={(e) => {
                                  setUserSearch(e.target.value);
                                  setUserPage(1);
                                }}
                                className="w-full pl-9 pr-3.5 h-9 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-[15px] font-bold uppercase tracking-tight placeholder:normal-case placeholder:text-slate-400 shadow-sm"
                              />
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                {isSuperAdminUser && selectedUsers.size > 0 && (
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={handleBulkDeleteUsers}
                                    disabled={isDeleting}
                                    className="h-8 text-[14px] font-bold uppercase bg-red-600 hover:bg-red-700 text-white rounded-lg border border-red-700 shadow-sm transition-all px-3"
                                  >
                                    <Trash2 className="w-3 h-3 mr-1.5" />
                                    Delete ({selectedUsers.size})
                                  </Button>
                                )}

                                {(isSuperAdminUser ||
                                  hasPermission(user, Permission.CREATE_USER)) && (
                                  <Button
                                    type="button"
                                    onClick={() => setShowUserDialog(true)}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white border-0 h-9 text-[15px] font-bold uppercase tracking-wide rounded-lg px-4 shadow-md transition-all active:scale-95 whitespace-nowrap"
                                  >
                                    <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                                    Add User
                                  </Button>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className="text-[14px] font-bold text-slate-700 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-200 whitespace-nowrap h-8 flex items-center">
                                    Showing{" "}
                                    <span className="text-indigo-600 font-black px-1">
                                      {users.length}
                                    </span>{" "}
                                    of {userPagination.total}
                                  </span>

                                  <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm h-8">
                                    <span className="text-[15px] font-black text-slate-400 uppercase tracking-widest">
                                      Rows:
                                    </span>
                                    <select
                                      value={userPagination.limit}
                                      onChange={(e) =>
                                        setUserPagination((prev) => ({
                                          ...prev,
                                          limit: Number(e.target.value),
                                        }))
                                      }
                                      className="text-[14px] font-bold text-slate-900 bg-transparent border-0 focus:ring-0 cursor-pointer p-0 h-auto"
                                    >
                                      {[10, 20, 25, 50, 100, 200, 250].map((l) => (
                                        <option key={l} value={l}>
                                          {l}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              </div>

                            </div>
                          </div>


                          {!(isSubDepartmentAdminRole || isOperatorRole) && (
                            <div
                              className={cn(
                                "flex-col sm:flex-row items-stretch sm:items-center gap-2",
                                showUserFiltersOnMobile
                                  ? "flex"
                                  : "hidden md:flex",
                              )}
                            >
                              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-200 h-8">
                                <Filter className="w-3.5 h-3.5 text-indigo-500" />
                                <span className="text-[15px] font-bold text-slate-700 uppercase tracking-tight">
                                  Filters
                                </span>
                              </div>

                              <div className="flex items-center gap-2 flex-wrap flex-1">
                                <select
                                  value={userFilters.role}
                                  onChange={(e) => {
                                    setUserFilters((prev) => ({
                                      ...prev,
                                      role: e.target.value,
                                    }));
                                    setUserPage(1);
                                  }}
                                  className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium w-full sm:max-w-[130px]"
                                  title="Filter by role"
                                >
                                  <option value="">👤 All Roles</option>
                                  {filteredRolesByHierarchy.map((role: any) => (
                                    <option
                                      key={role._id}
                                      value={`CUSTOM:${role._id}`}
                                    >
                                      {role.name}
                                    </option>
                                  ))}
                                  {isSuperAdminUser && (
                                    <option value="SUPER_ADMIN">
                                      Super Admin
                                    </option>
                                  )}
                                </select>

                                <select
                                  value={userFilters.status}
                                  onChange={(e) => {
                                    setUserFilters((prev) => ({
                                      ...prev,
                                      status: e.target.value,
                                    }));
                                    setUserPage(1);
                                  }}
                                  className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium min-w-[100px] max-w-[120px]"
                                  title="Filter by status"
                                >
                                  <option value="">📊 All Status</option>
                                  <option value="active">Active</option>
                                  <option value="inactive">Inactive</option>
                                </select>

                                {!isSubDepartmentAdminRole && !isOperatorRole && (
                                  <DashboardDepartmentFilters
                                    allDepartments={scopedDepartmentsForFilters}
                                    getParentDepartmentId={getParentDepartmentId}
                                    onFiltersChange={(filters) => {
                                      setUserFilters((prev) => ({
                                        ...prev,
                                        mainDeptId: filters.mainDeptId,
                                        subDeptId: filters.subDeptId,
                                      }));
                                      setUserPage(1);
                                    }}
                                    currentFilters={userFilters}
                                    showSubDepartmentSelect={!isDepartmentAdminRole}
                                    showOnlySubDepartmentsInMainSelect={
                                      isDepartmentAdminRole
                                    }
                                    className="w-full md:w-auto"
                                  />
                                )}

                                {(userFilters.role ||
                                  userFilters.status ||
                                  userFilters.mainDeptId ||
                                  userFilters.subDeptId ||
                                  userSearch.trim()) && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setUserSearch("");
                                      setUserFilters({
                                        role: "",
                                        status: "",
                                        mainDeptId: "",
                                        subDeptId: "",
                                      });
                                      setUserPage(1);
                                    }}
                                    className="h-8 px-3 text-[15px] text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 font-medium"
                                    title="Clear all filters"
                                  >
                                    <X className="w-3 h-3 mr-1" />
                                    Clear
                                  </Button>
                                )}
                              </div>
                            </div>
                        )}
                        </div>
                        
                        {loadingUsers ? (
                          <div className="flex flex-col gap-4 p-4">
                            {[1, 2, 3, 4].map((i) => (
                              <div key={i} className="h-32 bg-slate-50 animate-pulse rounded-xl" />
                            ))}
                          </div>
                        ) : users.length === 0 ? (
                          <div className="text-center py-16">
                            <div className="w-20 h-20 bg-gradient-to-br from-emerald-100 to-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                              <Users className="w-10 h-10 text-emerald-500" />
                            </div>
                            <p className="text-slate-500 text-lg font-medium">
                              No users found
                            </p>
                            <p className="text-slate-400 text-sm mt-1">
                              Add a user to get started
                            </p>
                          </div>
                        ) : (
                          <div
                            key="users-master-wrapper-final"
                            className="overflow-hidden"
                          >
                            {/* Mobile Card View */}
                            <div className="md:hidden divide-y divide-slate-100">
                              {users.map((u, index) => (
                                <div key={u._id} className="p-3 bg-white active:bg-slate-50/80 transition-colors">
                                  {/* ── TOP ROW: Avatar · Name · Role · Actions ── */}
                                  <div className="flex items-start gap-2">
                                    {/* Avatar with status dot */}
                                    <div className="relative shrink-0">
                                      <div className="h-9 w-9 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-full flex items-center justify-center text-white text-[15px] font-bold border-2 border-white ring-1 ring-slate-200 shadow-sm">
                                        {(u.firstName?.[0] || "")}{(u.lastName?.[0] || "")}
                                      </div>
                                      <div className={cn(
                                        "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border-2 border-white rounded-full",
                                        u.isActive ? "bg-green-500" : "bg-slate-300"
                                      )} />
                                    </div>

                                    {/* Name + role + dept + designation */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-start gap-2">
                                        <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-emerald-100 px-1.5 text-[15px] font-black text-emerald-700 shadow-sm">
                                          {(userPage - 1) * userPagination.limit + index + 1}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => openUserDetail(u._id)}
                                          className="max-w-full flex-1 text-left text-sm font-bold leading-normal text-slate-900 break-words hover:text-blue-700 hover:underline"
                                        >
                                          {u.firstName} {u.lastName}
                                        </button>
                                      </div>
                                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                        <span className="px-1.5 py-0.5 rounded text-[14px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 uppercase tracking-wider break-words max-w-full">
                                          {getUserRoleLabel(u)}
                                        </span>
                                        <span className="font-mono text-[14px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                          {u.userId}
                                        </span>
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-1">
                                        <span className="max-w-full break-words rounded border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[14px] font-bold uppercase tracking-wider text-sky-700">
                                          {typeof u.departmentId === "object" &&
                                          u.departmentId !== null
                                            ? (u.departmentId as any)?.name || "No Department"
                                            : allDepartments.find((d) => d._id === u.departmentId)
                                                  ?.name ||
                                              (u as any).departmentName ||
                                              "No Department"}
                                        </span>
                                        <span className="max-w-full break-words rounded border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-[14px] font-bold uppercase tracking-wider text-amber-700">
                                          {[
                                            ...(u.designation ? [u.designation] : []),
                                            ...(u.designations || []),
                                          ]
                                            .filter(
                                              (value, idx, list) =>
                                                value && list.indexOf(value) === idx,
                                            )
                                            .join(", ") || "No Designation"}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Actions + status toggle */}
                                    <div className="flex items-center gap-0.5 shrink-0">
                                      {/* Active toggle */}
                                      <button
                                        onClick={() => handleToggleUserStatus(u._id, u.isActive)}
                                        disabled={user && u._id === user.id}
                                        className={cn(
                                          "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 mr-1",
                                          u.isActive ? "bg-green-500" : "bg-slate-300",
                                          user && u._id === user.id ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                                        )}
                                        title={u.isActive ? "Deactivate" : "Activate"}
                                      >
                                        <span className={cn(
                                          "pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                                          u.isActive ? "translate-x-4" : "translate-x-0.5"
                                        )} />
                                      </button>
                                      <button
                                        onClick={() => { setEditingUser(u); setShowEditUserDialog(true); }}
                                        className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                        title="Edit User"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* ── CONTACT + DEPT INFO ── */}
                                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                                    <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                                      <div className="flex items-center gap-1 mb-0.5">
                                        <Mail className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                                        <span className="text-[14px] font-black text-slate-400 uppercase tracking-wider">Email</span>
                                      </div>
                                      <p className="text-[15px] font-medium text-slate-700 truncate">{u.email}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                                      <div className="flex items-center gap-1 mb-0.5">
                                        <Phone className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                                        <span className="text-[14px] font-black text-slate-400 uppercase tracking-wider">Phone</span>
                                      </div>
                                      <p className="text-[15px] font-medium text-slate-700">
                                        {u.phone ? formatTo10Digits(u.phone) : "—"}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Desktop Table View */}
                            <div className="hidden md:block overflow-x-auto custom-scrollbar">
                              <table className="w-full relative border-collapse table-auto">
                                <thead className="bg-[#fcfdfe] border-b border-slate-200">
                                  <tr>
                                    {isSuperAdminUser && (
                                      <th className="px-3 py-3 text-center">
                                        <input
                                          type="checkbox"
                                          checked={
                                            selectedUsers.size > 0 &&
                                            selectedUsers.size ===
                                              users.length
                                          }
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedUsers(
                                                new Set(
                                                  users.map((u) => u._id),
                                                ),
                                              );
                                            } else {
                                              setSelectedUsers(new Set());
                                            }
                                          }}
                                          className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                        />
                                      </th>
                                    )}
                                    <th className="px-3 py-3 text-center text-[15px] font-black text-slate-400 uppercase tracking-widest w-[5%]">
                                      Sr.
                                    </th>
                                    <th className="px-6 py-3 text-left w-[25%]">
                                      <button
                                        onClick={() =>
                                          handleSort("firstName", "users")
                                        }
                                        className="group flex items-center space-x-1.5 text-[15px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>User Info</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="firstName" />
                                      </button>
                                    </th>
                                    <th className="px-5 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort("email", "users")
                                        }
                                        className="group flex items-center space-x-1.5 text-[15px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>Contact Information</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="email" />
                                      </button>
                                    </th>
                                    <th className="px-6 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort("role", "users")
                                        }
                                        className="group flex items-center space-x-1.5 text-[15px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>Role &amp; Dept</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="role" />
                                      </button>
                                    </th>
                                    <th className="px-6 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort("isActive", "users")
                                        }
                                        className="group flex items-center space-x-1.5 text-[15px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>Status &amp; Access</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="isActive" />
                                      </button>
                                    </th>
                                    <th className="px-6 py-3 text-right text-[15px] font-black text-slate-400 border-b border-slate-100 uppercase tracking-widest">
                                      Actions
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                  {users.map(
                                    (u: User, index: number) => (
                                      <tr
                                        key={u._id}
                                        className="hover:bg-gradient-to-r hover:from-emerald-50/50 hover:to-green-50/50 transition-all duration-200 group/row"
                                      >
                                        {/* Checkbox */}
                                        {isSuperAdminUser && (
                                          <td className="px-3 py-4 text-center">
                                            <input
                                              type="checkbox"
                                              checked={selectedUsers.has(u._id)}
                                              onChange={() => {
                                                const next = new Set(
                                                  selectedUsers,
                                                );
                                                if (next.has(u._id))
                                                  next.delete(u._id);
                                                else next.add(u._id);
                                                setSelectedUsers(next);
                                              }}
                                              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                            />
                                          </td>
                                        )}

                                        {/* Sr */}
                                        <td className="px-3 py-5 text-center">
                                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-100 to-green-100 text-emerald-700 text-xs font-bold shadow-sm">
                                            {(userPage - 1) *
                                              userPagination.limit +
                                              index +
                                              1}
                                          </span>
                                        </td>
                                        <td className="px-4 py-5">
                                          <div className="flex items-center">
                                            <div className="relative">
                                              <div className="flex-shrink-0 h-12 w-12 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-full flex items-center justify-center text-white text-base font-bold shadow-sm border-2 border-white ring-1 ring-gray-100">
                                                {u.firstName[0]}
                                                {u.lastName[0]}
                                              </div>
                                              <div
                                                className={`absolute bottom-0 right-0 h-3.5 w-3.5 border-2 border-white rounded-full shadow-sm ${u.isActive ? "bg-green-500" : "bg-gray-300"}`}
                                              ></div>
                                            </div>
                                            <div className="ml-3 min-w-0">
                                              <button
                                                onClick={() => openUserDetail(u._id)}
                                                className="text-sm font-bold text-slate-900 leading-snug hover:text-blue-600 hover:underline text-left whitespace-normal block w-full"
                                              >
                                                {u.firstName} {u.lastName}
                                              </button>
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {/* Unified Multi-Designation Badges */}
                                                {(() => {
                                                  const list =
                                                    u.designations || [];
                                                  if (list.length === 0)
                                                    return null;

                                                  return list.map(
                                                    (d: string, i: number) => (
                                                      <span
                                                        key={i}
                                                        className="bg-slate-100 text-slate-700 border-slate-300 text-[8.5px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-tight shadow-sm border transition-all"
                                                      >
                                                        {d}
                                                      </span>
                                                    ),
                                                  );
                                                })()}
                                                <span className="text-[14px] font-black bg-slate-50 text-slate-400 px-1.5 py-0.5 rounded-md border border-slate-100 uppercase tracking-widest w-fit">
                                                  ID: {u.userId}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-4 py-5">
                                          <div className="flex flex-col space-y-1.5">
                                            <div className="flex items-center text-sm text-blue-600 font-medium break-all">
                                              <Mail className="w-3.5 h-3.5 mr-2 text-blue-400 shrink-0" />
                                              {u.email}
                                            </div>
                                            {u.phone && (
                                              <div className="flex items-center text-xs text-gray-500">
                                                <Phone className="w-3.5 h-3.5 mr-2 text-gray-400" />
                                                {formatTo10Digits(u.phone)}
                                              </div>
                                            )}
                                            {isSuperAdminUser &&
                                              u.notificationSettings && (
                                                <div className="flex items-center gap-2 mt-2">
                                                  <div
                                                    title={`Email Notifications: ${u.notificationSettings.email ? "Enabled" : "Disabled"}`}
                                                    className={`px-1.5 py-0.5 rounded text-[14px] font-black uppercase tracking-tighter border flex items-center gap-1 ${
                                                      u.notificationSettings
                                                        .email
                                                        ? "bg-blue-50 text-blue-600 border-blue-100"
                                                        : "bg-slate-50 text-slate-300 border-slate-100"
                                                    }`}
                                                  >
                                                    <Mail
                                                      className={`w-2.5 h-2.5 ${u.notificationSettings.email ? "text-blue-500" : "text-slate-300"}`}
                                                    />
                                                    Email
                                                  </div>
                                                  <div
                                                    title={`WhatsApp Notifications: ${u.notificationSettings.whatsapp ? "Enabled" : "Disabled"}`}
                                                    className={`px-1.5 py-0.5 rounded text-[14px] font-black uppercase tracking-tighter border flex items-center gap-1 ${
                                                      u.notificationSettings
                                                        .whatsapp
                                                        ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                                        : "bg-slate-50 text-slate-300 border-slate-100"
                                                    }`}
                                                  >
                                                    <TrendingUp
                                                      className={`w-2.5 h-2.5 ${u.notificationSettings.whatsapp ? "text-emerald-500" : "text-slate-300"}`}
                                                    />
                                                    WhatsApp
                                                  </div>
                                                </div>
                                              )}
                                          </div>
                                        </td>
                                        <td className="px-4 py-5">
                                          <div className="flex flex-col space-y-2">
                                            <div className="flex">
                                              <span
                                                className={`px-2.5 py-0.5 inline-flex items-center text-[14px] font-bold rounded-full border shadow-sm ${
                                                  u.level === 1
                                                    ? "bg-slate-100 text-slate-700 border-slate-300 ring-1 ring-slate-200 shadow-slate-900/5"
                                                    : typeof u.customRoleId ===
                                                          "object" &&
                                                        u.customRoleId
                                                      ? "bg-slate-50 text-slate-600 border-slate-200 ring-1 ring-slate-100 shadow-slate-900/5"
                                                      : (u.level === 2 &&
                                                            typeof u.departmentId ===
                                                              "object" &&
                                                            (
                                                              u.departmentId as any
                                                            )
                                                              ?.parentDepartmentId) ||
                                                          u.level === 3
                                                        ? "bg-slate-50 text-slate-500 border-slate-200"
                                                        : "bg-slate-50 text-slate-500 border-slate-200"
                                                }`}
                                              >
                                                <Shield className="w-2.5 h-2.5 mr-1 opacity-60" />
                                                {typeof u.customRoleId ===
                                                  "object" && u.customRoleId
                                                  ? (u.customRoleId as any).name
                                                  : (u.level === 2 &&
                                                        typeof u.departmentId ===
                                                          "object" &&
                                                        (u.departmentId as any)
                                                          ?.parentDepartmentId) ||
                                                      u.level === 3
                                                    ? "Sub Department Admin"
                                                    : isSuperAdmin(u)
                                                      ? "Super Admin"
                                                      : u.level === 1
                                                        ? "Company Admin"
                                                        : u.level === 2
                                                          ? "Department Admin"
                                                          : u.level === 4
                                                            ? "Operator"
                                                            : u.level === 5
                                                              ? "Analytics Viewer"
                                                              : (
                                                                  u.role || ""
                                                                ).replace(
                                                                  /_/g,
                                                                  " ",
                                                                )}
                                              </span>
                                            </div>
                                            <div className="flex flex-col gap-1.5 min-w-[150px]">
                                              {(() => {
                                                const deptList = (
                                                  u.departmentIds || []
                                                ).map((d: any) => {
                                                  const id =
                                                    typeof d === "object"
                                                      ? d._id
                                                      : d;
                                                  const name =
                                                    typeof d === "object"
                                                      ? d.name
                                                      : allDepartments.find(
                                                          (dept: any) =>
                                                            dept._id === id,
                                                        )?.name || id;
                                                  return { id, name };
                                                });

                                                if (deptList.length === 0)
                                                  return (
                                                    <div className="flex items-center text-[14px] text-slate-400 font-bold uppercase tracking-widest italic">
                                                      <Building className="w-3.5 h-3.5 mr-1.5 opacity-50" />
                                                      All Company Access
                                                    </div>
                                                  );

                                                return (
                                                  <div className="space-y-1">
                                                    {deptList.map(
                                                      (d: any, i: number) => (
                                                        <div
                                                          key={i}
                                                          className="flex items-start text-[14px] font-black uppercase tracking-tight leading-tight text-indigo-700 transition-colors"
                                                        >
                                                          <Building className="w-2.5 h-2.5 mr-1 mt-0.5 opacity-60" />
                                                          {d.name}
                                                        </div>
                                                      ),
                                                    )}
                                                  </div>
                                                );
                                              })()}
                                            </div>
                                            {/* Show permissions summary for custom roles */}
                                            {typeof u.customRoleId ===
                                              "object" &&
                                              u.customRoleId &&
                                              (u.customRoleId as any)
                                                .permissions?.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-0.5">
                                                  {(
                                                    u.customRoleId as any
                                                  ).permissions
                                                    .slice(0, 3)
                                                    .map(
                                                      (p: any, i: number) => (
                                                        <span
                                                          key={i}
                                                          className="text-[14px] font-black text-indigo-400 bg-indigo-50/50 px-1 py-px rounded uppercase tracking-tighter border border-indigo-100/50"
                                                        >
                                                          {p.module?.replace(
                                                            /_/g,
                                                            " ",
                                                          )}
                                                        </span>
                                                      ),
                                                    )}
                                                  {(u.customRoleId as any)
                                                    .permissions.length > 3 && (
                                                    <span className="text-[14px] font-black text-slate-300">
                                                      +
                                                      {(u.customRoleId as any)
                                                        .permissions.length -
                                                        3}{" "}
                                                      more
                                                    </span>
                                                  )}
                                                </div>
                                              )}
                                          </div>
                                        </td>
                                        <td className="px-4 py-5">
                                          <div className="flex flex-col space-y-2.5">
                                            <div className="flex items-center">
                                              <div
                                                className={`h-2 w-2 rounded-full mr-2 ${u.isActive ? "bg-green-500 animate-pulse" : "bg-gray-300"}`}
                                              ></div>
                                              <span
                                                className={`text-xs font-bold ${u.isActive ? "text-green-700" : "text-gray-500"}`}
                                              >
                                                {u.isActive
                                                  ? "Active"
                                                  : "Inactive"}
                                              </span>
                                            </div>
                                            <div className="flex items-center">
                                              <button
                                                onClick={() =>
                                                  handleToggleUserStatus(
                                                    u._id,
                                                    u.isActive,
                                                  )
                                                }
                                                disabled={
                                                  user && u._id === user.id
                                                }
                                                className={`relative inline-flex h-5 w-10 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                                  user && u._id === user.id
                                                    ? "bg-gray-300 cursor-not-allowed opacity-50"
                                                    : u.isActive
                                                      ? "bg-green-500 cursor-pointer"
                                                      : "bg-red-400 cursor-pointer"
                                                }`}
                                                title={
                                                  user && u._id === user.id
                                                    ? "You cannot deactivate yourself"
                                                    : "Toggle user status"
                                                }
                                              >
                                                <span className="sr-only">
                                                  Toggle user status
                                                </span>
                                                <span
                                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${u.isActive ? "translate-x-5" : "translate-x-1"}`}
                                                />
                                              </button>
                                              {/* Show only one action label - the current status */}
                                              <span
                                                className={`ml-2 text-[14px] font-bold uppercase tracking-wider ${
                                                  u.isActive
                                                    ? "text-green-600"
                                                    : "text-gray-400"
                                               }`}
                                              >
                                                {u.isActive
                                                  ? "Active"
                                                  : "Inactive"}
                                              </span>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-4 py-5 whitespace-normal text-right">
                                          <div className="flex justify-end items-center gap-1.5">
                                            {hasPermission(
                                              user,
                                              Permission.UPDATE_USER,
                                            ) && (
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 p-0 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors flex-shrink-0"
                                                title="Edit User"
                                                onClick={() => {
                                                  setEditingUser(u);
                                                  setShowEditUserDialog(true);
                                                }}
                                              >
                                                <Edit2 className="w-4 h-4" />
                                              </Button>
                                            )}

                                            {hasPermission(
                                              user,
                                              Permission.DELETE_USER,
                                            ) && (
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className={`h-8 w-8 p-0 transition-colors flex-shrink-0 ${
                                                  user && u._id === user.id
                                                    ? "text-slate-300 cursor-not-allowed"
                                                    : "text-slate-400 hover:text-red-600 hover:bg-red-50"
                                                }`}
                                                title={
                                                  user && u._id === user.id
                                                    ? "You cannot delete yourself"
                                                    : "Delete User"
                                                }
                                                disabled={
                                                  user && u._id === user.id
                                                }
                                                onClick={() => {
                                                  // Prevent self-deletion
                                                  if (
                                                    user &&
                                                    u._id === user.id
                                                  ) {
                                                    toast.error(
                                                      "You cannot delete yourself",
                                                    );
                                                    return;
                                                  }

                                                  setConfirmDialog({
                                                    isOpen: true,
                                                    title: "Delete User",
                                                    message: `Are you sure you want to delete ${u.firstName} ${u.lastName}? This action cannot be undone.`,
                                                    onConfirm: async () => {
                                                      try {
                                                        const response =
                                                          await userAPI.delete(
                                                            u._id,
                                                          );
                                                        if (response.success) {
                                                          toast.success(
                                                            "User deleted successfully",
                                                          );
                                                          setUsers((prev) =>
                                                            prev.filter(
                                                              (user) =>
                                                                user._id !==
                                                                u._id,
                                                            ),
                                                          );
                                                          fetchUsers(
                                                            userPage,
                                                            true,
                                                          );
                                                          fetchDashboardData(
                                                            true,
                                                          );
                                                        }
                                                      } catch (error: any) {
                                                        const errorMessage =
                                                          error.response?.data
                                                            ?.message ||
                                                          error.message ||
                                                          "Failed to delete user";
                                                        toast.error(
                                                          errorMessage,
                                                        );
                                                      } finally {
                                                        setConfirmDialog(
                                                          (p) => ({
                                                            ...p,
                                                            isOpen: false,
                                                          }),
                                                        );
                                                      }
                                                    },
                                                  } as any);
                                                }}
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </Button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    ),
                                  )}
                                </tbody>
                              </table>
                            </div>

                            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/30 flex items-center justify-end text-[14px] font-bold text-slate-400 uppercase tracking-widest">
                              {isSuperAdminUser && selectedUsers.size > 0 && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={handleBulkDeleteUsers}
                                  disabled={isDeleting}
                                  className="text-[15px] font-black h-7 px-3 bg-red-600 hover:bg-red-700 text-white rounded-lg border border-red-700 shadow-sm transition-all animate-in zoom-in duration-200"
                                >
                                  <Trash2 className="w-3 h-3 mr-1" />
                                  Delete ({selectedUsers.size})
                                </Button>
                              )}
                            </div>

                            <Pagination
                              currentPage={userPage}
                              totalPages={userPagination.pages}
                              totalItems={userPagination.total}
                              itemsPerPage={userPagination.limit}
                              onPageChange={setUserPage}
                              className="mt-6 shadow-none border-t border-slate-100 rounded-none bg-slate-50/30"
                            />
                            </div>
                        )}
                      </>
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {/* Grievances Tab - Sophisticated Professional Inbox */}
              {hasModule(Module.GRIEVANCE) &&
                (isViewingCompany || isDepartmentLevel) && (
                  <TabsContent value="grievances" className="space-y-4">
                    <Card className="rounded-xl border border-slate-200 shadow-sm bg-white">
                      {/* Grievance Filters */}
                      <div className="relative z-30 px-4 sm:px-6 py-4 bg-slate-50/50 border-b border-slate-200 rounded-t-xl">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-3">
                          <div className="relative w-full lg:max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <input
                              type="text"
                              placeholder="Quick search..."
                              value={grievanceSearch}
                              onChange={(e) => {
                                setGrievanceSearch(e.target.value);
                                setGrievancePage(1);
                              }}
                              className="w-full pl-9 pr-3.5 h-9 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-[15px] font-bold uppercase tracking-tight placeholder:normal-case placeholder:text-slate-400 shadow-sm"
                            />
                          </div>
                          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 sm:gap-3 w-full lg:w-auto">
                            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setShowGrievanceFiltersOnMobile((prev) => !prev)
                                }
                                className="md:hidden border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap h-8 text-[15px] font-bold uppercase tracking-tight"
                                title="Toggle filters"
                              >
                                <Filter className="w-3.5 h-3.5 mr-1" />
                                Filters
                              </Button>

                              {isSuperAdminUser &&
                                selectedGrievances.size > 0 && (
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={handleBulkDeleteGrievances}
                                    disabled={isDeleting}
                                    className="text-xs h-8 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl border border-red-700 shadow-sm"
                                    title={`Delete ${selectedGrievances.size} selected grievance(s)`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                    Delete ({selectedGrievances.size})
                                  </Button>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-bold text-slate-700 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-200 whitespace-nowrap h-8 flex items-center">
                                Showing{" "}
                                <span className="text-indigo-600 font-black px-1">
                                  {getSortedData(grievances, "grievances").length}
                                </span>{" "}
                                of {grievancePagination.total}
                              </span>

                              <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm h-8">
                                <span className="text-[15px] font-black text-slate-400 uppercase tracking-widest">
                                  Rows:
                                </span>
                                <select
                                  value={grievancePagination.limit}
                                  onChange={(e) =>
                                    setGrievancePagination((prev) => ({
                                      ...prev,
                                      limit: Number(e.target.value),
                                    }))
                                  }
                                  className="text-[14px] font-bold text-slate-900 bg-transparent border-0 focus:ring-0 cursor-pointer p-0 h-auto"
                                >
                                  {[10, 20, 25, 50, 100, 200, 250].map((l) => (
                                    <option key={l} value={l}>
                                      {l}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Filters Row */}
                        <div
                          className={cn(
                            "flex-col sm:flex-row items-stretch sm:items-center gap-2",
                            showGrievanceFiltersOnMobile
                              ? "flex"
                              : "hidden md:flex",
                          )}
                        >
                          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-200 h-8">
                            <Filter className="w-3.5 h-3.5 text-indigo-500" />
                            <span className="text-[15px] font-bold text-slate-700 uppercase tracking-tight">
                              Filters
                            </span>
                          </div>

                          {/* Status Filter */}
                          <select
                            value={grievanceFilters.status}
                            onChange={(e) => {
                              setGrievanceFilters((prev) => ({
                                ...prev,
                                status: e.target.value,
                              }));
                              setGrievancePage(1);
                            }}
                            className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium w-full sm:max-w-[140px]"
                            title="Filter by grievance status"
                          >
                            <option value="">📋 All Status</option>
                            <option value="ALL">📑 Total(Inc. Resolved/Rejected)</option>
                            <option value="PENDING,IN_PROGRESS,ASSIGNED">🔸 Pending (Inc. In Progress)</option>
                            <option value="PENDING">🔸 Pending</option>
                            <option value="IN_PROGRESS">🛠️ In Progress</option>
                            <option value="RESOLVED">✅ Resolved</option>
                            <option value="REJECTED">❌ Rejected</option>
                            {isCompanyLevel && (
                              <>
                                <option value="REVERTED">↩️ Reverted</option>
                              </>
                            )}
                          </select>

                          {!isSubDepartmentAdminRole && !isOperatorRole && (
                            <DashboardDepartmentFilters
                              allDepartments={scopedDepartmentsForFilters}
                              getParentDepartmentId={getParentDepartmentId}
                              onFiltersChange={(filters) => {
                                setGrievanceFilters((prev) => ({
                                  ...prev,
                                  mainDeptId: filters.mainDeptId,
                                  subDeptId: filters.subDeptId,
                                  department: "", // reset old filter
                                }));
                                setGrievancePage(1);
                              }}
                              currentFilters={grievanceFilters}
                              showSubDepartmentSelect={!isDepartmentAdminRole}
                              showOnlySubDepartmentsInMainSelect={
                                isDepartmentAdminRole
                              }
                              className="w-full md:w-auto"
                            />
                          )}

                          {/* Assignment Status Filter */}
                          <select
                            value={grievanceFilters.assignmentStatus}
                            onChange={(e) => {
                              setGrievanceFilters((prev) => ({
                                ...prev,
                                assignmentStatus: e.target.value,
                              }));
                              setGrievancePage(1);
                            }}
                            className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium w-full sm:max-w-[130px]"
                            title="Filter by assignment status"
                          >
                            <option value="">👥All Assignments</option>
                            <option value="assigned">✓ Assigned</option>
                            <option value="unassigned">○ Unassigned</option>
                          </select>

                          {/* Overdue Status Filter */}
                          <select
                            value={grievanceFilters.slaStatus}
                            onChange={(e) => {
                              setGrievanceFilters((prev) => ({
                                ...prev,
                                slaStatus: e.target.value,
                              }));
                              setGrievancePage(1);
                            }}
                            className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium w-full sm:max-w-[130px]"
                            title="Filter by overdue status"
                          >
                            <option value="">⏱️ Overdue Status</option>
                            <option value="OVERDUE">🔴 Overdue</option>
                            <option value="ON_TRACK">🟢 On Track</option>
                            <option value="COMPLETED">✅ Completed</option>
                          </select>

                          {/* Date Range Filter */}
                          <select
                            value={grievanceFilters.dateRange}
                            onChange={(e) => {
                              setGrievanceFilters((prev) => ({
                                ...prev,
                                dateRange: e.target.value,
                              }));
                              setGrievancePage(1);
                            }}
                            className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium w-full sm:max-w-[110px]"
                            title="Filter by date range"
                          >
                            <option value="">📅 All Time</option>
                            <option value="today">Today</option>
                            <option value="week">Last 7 Days</option>
                            <option value="month">Last 30 Days</option>
                          </select>

                          {/* Clear Filters */}
                          {(grievanceFilters.status ||
                            grievanceFilters.department ||
                            grievanceFilters.mainDeptId ||
                            grievanceFilters.subDeptId ||
                            grievanceFilters.assignmentStatus ||
                            grievanceFilters.slaStatus ||
                            grievanceFilters.priority ||
                            grievanceFilters.dateRange ||
                            grievanceSearch) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setGrievanceFilters({
                                  status: "",
                                  department: "",
                                  mainDeptId: "",
                                  subDeptId: "",
                                  assignmentStatus: "",
                                  slaStatus: "",
                                  dateRange: "",
                                  priority: "",
                                });
                                setGrievanceSearch("");
                                setGrievancePage(1);
                              }}
                              className="text-[15px] h-8 px-3 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 font-medium"
                              title="Clear all filters"
                            >
                              <X className="w-3 h-3 mr-1" />
                              Clear
                            </Button>
                          )}


                        </div>
                      </div>

                      <CardContent className="p-0">
                        {loadingGrievances ? (
                          <TableSkeleton rows={8} cols={6} />
                        ) : grievances.length === 0 ? (
                          <div className="text-center py-16 bg-gradient-to-b from-slate-50 to-white rounded-2xl border border-slate-200">
                            <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                              <svg
                                className="w-8 h-8 text-indigo-500"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                />
                              </svg>
                            </div>
                            <p className="text-slate-600 font-medium">
                              No grievances found
                            </p>
                            <p className="text-slate-400 text-sm mt-1">
                              New grievances will appear here
                            </p>
                          </div>
                        ) : (
                          <>
                            {/* Mobile Grid View */}
                            <div className="md:hidden divide-y divide-slate-100">
                              {getSortedData(grievances, "grievances").map((grievance, index) => {
                                // --- SLA Calculation (mirrors desktop) ---
                                const createdDate = new Date(grievance.createdAt);
                                const now = new Date();
                                let slaStatus: "on-track" | "overdue" | "completed" = "on-track";
                                if (grievance.status === "RESOLVED" || grievance.status === "CLOSED" || grievance.status === "REJECTED") {
                                  slaStatus = "completed";
                                } else if (grievance.status === "PENDING" || grievance.status === "ASSIGNED" || grievance.status === "IN_PROGRESS" || grievance.status === "REVERTED") {
                                  // Dynamic SLA Governance: Use grievance-specific threshold
                                  const currentSlaHours = grievance.slaHours || 120;
                                  if ((now.getTime() - createdDate.getTime()) > (currentSlaHours * 3600000)) {
                                    slaStatus = "overdue";
                                  }
                                }

                                const assignedName = typeof grievance.assignedTo === 'object' && grievance.assignedTo !== null
                                  ? `${(grievance.assignedTo as any).firstName || ''} ${(grievance.assignedTo as any).lastName || ''}`.trim()
                                  : null;

                                const deptName = typeof grievance.departmentId === 'object'
                                  ? (grievance.departmentId as any)?.name
                                  : null;

                                const subDeptName = typeof (grievance as any).subDepartmentId === 'object'
                                  ? ((grievance as any).subDepartmentId as any)?.name
                                  : null;

                                const grievanceStatus = grievance.status === 'PENDING' || grievance.status === 'ASSIGNED'
                                  ? 'PENDING' : grievance.status;

                                return (
                                  <div
                                    key={grievance._id}
                                    className="p-3 bg-white active:bg-slate-50/80 transition-colors"
                                  >
                                    {/* ── TOP ROW: Number · GRV ID · Status badges ── */}
                                    <div className="flex items-center justify-between mb-2.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[15px] font-black shrink-0">
                                          {(grievancePage - 1) * grievancePagination.limit + index + 1}
                                        </span>
                                        <button
                                          onClick={() => openGrievanceDetail(grievance._id, grievance)}
                                          className="font-mono text-[14px] font-bold text-slate-500 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-1.5 py-0.5 rounded transition-colors border border-slate-200"
                                        >
                                          {grievance.grievanceId}
                                        </button>
                                      </div>

                                      <div className="flex items-center gap-1">
                                        {/* SLA Badge */}
                                        {slaStatus === "completed" ? (
                                          <span className="px-1.5 py-0.5 rounded-md text-[14px] font-black uppercase tracking-tight bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            ✓ Done
                                          </span>
                                        ) : slaStatus === "overdue" ? (
                                          canSendOverdueReminder ? (
                                            <button
                                              onClick={() => openOverdueReminderDialog(grievance)}
                                              className="px-1.5 py-0.5 rounded-md text-[14px] font-black uppercase tracking-tight bg-red-50 text-red-600 border border-red-200 animate-pulse"
                                            >
                                              ⚠ Overdue
                                            </button>
                                          ) : (
                                            <span className="px-1.5 py-0.5 rounded-md text-[14px] font-black uppercase tracking-tight bg-red-50 text-red-600 border border-red-200">
                                              ⚠ Overdue
                                            </span>
                                          )
                                        ) : (
                                          <span className="px-1.5 py-0.5 rounded-md text-[14px] font-black uppercase tracking-tight bg-green-50 text-green-700 border border-green-200">
                                            ✓ On Track
                                          </span>
                                        )}

                                        {/* Status Badge */}
                                        <span className={cn(
                                          "px-1.5 py-0.5 rounded-md text-[14px] font-black uppercase tracking-tight border",
                                          grievance.status === 'PENDING' || grievance.status === 'ASSIGNED' ? "bg-amber-50 text-amber-700 border-amber-200" :
                                          grievance.status === 'RESOLVED' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                          grievance.status === 'IN_PROGRESS' ? "bg-blue-50 text-blue-700 border-blue-200" :
                                          grievance.status === 'REJECTED' ? "bg-red-50 text-red-700 border-red-200" :
                                          grievance.status === 'REVERTED' ? "bg-purple-50 text-purple-700 border-purple-200" :
                                          "bg-slate-50 text-slate-600 border-slate-200"
                                        )}>
                                          {grievanceStatus}
                                        </span>
                                      </div>
                                    </div>

                                    {/* ── CITIZEN NAME + phone + date ── */}
                                    <div className="flex items-start justify-between mb-2">
                                      <div className="flex-1 min-w-0">
                                        <h4 className="text-sm font-bold text-slate-900 leading-tight break-words whitespace-normal">
                                          {grievance.citizenName}
                                        </h4>
                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                          <span className="flex items-center text-[14px] text-slate-500 font-medium gap-0.5">
                                            <Phone className="w-3 h-3 shrink-0" />
                                            {formatTo10Digits(grievance.citizenPhone)}
                                          </span>
                                          <span className="flex items-center text-[14px] text-slate-500 font-medium gap-0.5">
                                            <Calendar className="w-3 h-3 shrink-0" />
                                            {new Date(grievance.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })} • {new Date(grievance.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Action Buttons */}
                                      <div className="flex items-center gap-0.5 ml-2 shrink-0">
                                        <button
                                          onClick={() => openGrievanceDetail(grievance._id, grievance)}
                                          className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                          title="View Details"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                        </button>
                                        {hasPermission(user, Permission.REVERT_GRIEVANCE) &&
                                          isLowerHierarchyRole &&
                                          ["PENDING", "ASSIGNED", "RESOLVED", "IN_PROGRESS"].includes(grievance.status) && (
                                            <button
                                              onClick={() => {
                                                setSelectedGrievanceForRevert(grievance);
                                                setShowGrievanceRevertDialog(true);
                                              }}
                                              className="h-7 w-7 flex items-center justify-center rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 transition-colors"
                                              title="Request Reassignment"
                                            >
                                              <svg
                                                className="w-3.5 h-3.5"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                              >
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M3 10h10a4 4 0 014 4v1m0 0l-3-3m3 3l3-3M7 14H3m0 0l3 3m-3-3l3-3"
                                                />
                                              </svg>
                                            </button>
                                          )}
                                        {(isSuperAdminUser || canAssignGrievance) && (
                                          <button
                                            onClick={() => {
                                              setSelectedGrievanceForAssignment(grievance);
                                              setShowGrievanceAssignment(true);
                                            }}
                                            className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                                            title="Assign"
                                          >
                                            <UserPlus className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {canDeleteGrievance && (
                                          <button
                                            onClick={() => handleDeleteGrievance(grievance)}
                                            className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                            title="Delete"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* ── INFO STRIP: Dept · Assigned ── */}
                                    <div className="grid grid-cols-2 gap-1.5">
                                      {/* Department */}
                                      <div className="bg-indigo-50/60 rounded-lg p-2 border border-indigo-100/60">
                                        <div className="flex items-center gap-1 mb-0.5">
                                          <Building2 className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                                          <span className="text-[14px] font-black text-indigo-400 uppercase tracking-wider">Dept</span>
                                        </div>
                                        <p className="text-[14px] font-bold text-slate-700 leading-tight break-words whitespace-normal">
                                          {deptName || "General"}
                                          {subDeptName && <span className="text-slate-400"> / {subDeptName}</span>}
                                        </p>
                                        {grievance.category && (
                                          <span className="mt-1 inline-block max-w-full break-words whitespace-normal text-[14px] font-bold text-orange-500 uppercase">
                                            {grievance.category}
                                          </span>
                                        )}
                                        
                                        {/* Revert Remarks & Suggested Dept (Consolidated) */}
                                        {grievance.status === 'REVERTED' && (() => {
                                          const latestRevertRemark = grievance.statusHistory
                                            ?.filter((h: any) => h.status === 'REVERTED')
                                            .sort((a: any, b: any) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())[0]?.remarks;

                                          const revertEntry = grievance.timeline
                                            ?.filter((t: any) => t.action === 'REVERTED_TO_COMPANY_ADMIN')
                                            .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

                                          const suggestedDeptId = revertEntry?.details?.suggestedDepartmentId;
                                          const suggestedSubDeptId = revertEntry?.details?.suggestedSubDepartmentId;

                                          if (!latestRevertRemark && !suggestedDeptId && !suggestedSubDeptId) return null;

                                          return (
                                            <div className="mt-2 space-y-2">
                                              {latestRevertRemark && (
                                                <div className="bg-rose-50 border border-rose-100 rounded-lg p-2">
                                                  <p className="text-[14px] font-black text-rose-500 uppercase tracking-tighter mb-0.5 flex items-center gap-1">
                                                    <Undo2 className="w-2.5 h-2.5" /> Revert Remark
                                                  </p>
                                                  <p className="text-[14px] text-rose-700 font-bold leading-tight break-words">
                                                    {latestRevertRemark}
                                                  </p>
                                                </div>
                                              )}
                                              {(suggestedDeptId || suggestedSubDeptId) && (
                                                <div className="bg-rose-50/50 border border-rose-100 rounded-lg p-2">
                                                  <div className="flex items-center gap-1 text-[14px] text-rose-500 font-black uppercase tracking-widest mb-1 opacity-70">
                                                    <ArrowRightCircle className="w-2.5 h-2.5" /> Suggested Dept
                                                  </div>
                                                  <span className="text-[14px] font-bold text-slate-900 leading-tight break-words whitespace-normal">
                                                    {allDepartments?.find(d => d._id === (suggestedSubDeptId || suggestedDeptId))?.name || "Suggested Department"}
                                                  </span>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </div>

                                      {/* Assigned to */}
                                      <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                                        <div className="flex items-center gap-1 mb-0.5">
                                          <UserIcon className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                                          <span className="text-[14px] font-black text-slate-400 uppercase tracking-wider">Assigned</span>
                                        </div>
                                        {assignedName ? (
                                          <button
                                            type="button"
                                            onClick={() => openUserDetail((grievance.assignedTo as any)._id || grievance.assignedTo)}
                                            className="text-[14px] font-bold text-indigo-600 break-words whitespace-normal hover:text-indigo-800 hover:underline text-left w-full"
                                          >
                                            {assignedName}
                                          </button>
                                        ) : (
                                          <p className="text-[14px] text-slate-400 italic">Unassigned</p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Desktop Table View */}
                            <div className="hidden md:block border border-slate-200 rounded-2xl shadow-lg bg-white overflow-hidden">
                              <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                              <table className="w-full relative border-collapse table-fixed">
                                <thead className="sticky top-0 z-20 bg-[#fcfdfe] border-b border-slate-200">
                                  <tr>
                                    {isSuperAdminUser && (
                                      <th className="px-3 py-4 text-center">
                                        <input
                                          type="checkbox"
                                          checked={
                                            selectedGrievances.size > 0 &&
                                            selectedGrievances.size ===
                                              grievances.length
                                          }
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedGrievances(
                                                new Set(
                                                  grievances.map((g) => g._id),
                                                ),
                                              );
                                            } else {
                                              setSelectedGrievances(new Set());
                                            }
                                          }}
                                          className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                          title="Select All"
                                        />
                                      </th>
                                    )}
                                    <th className="px-3 py-3 text-center text-[15px] font-black text-slate-400 uppercase tracking-widest">
                                      Sr.
                                    </th>
                                    <th className="px-4 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort(
                                            "grievanceId",
                                            "grievances",
                                          )
                                        }
                                        className="group flex items-center space-x-1.5 text-[13px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>ID</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="grievanceId" />
                                      </button>
                                    </th>
                                    <th className="px-4 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort(
                                            "citizenName",
                                            "grievances",
                                          )
                                        }
                                        className="group flex items-center space-x-1.5 text-[13px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>Citizen</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="citizenName" />
                                      </button>
                                    </th>
                                    <th className="px-4 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort("category", "grievances")
                                        }
                                        className="group flex items-center space-x-1.5 text-[13px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>Category</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="category" />
                                      </button>
                                    </th>
                                    <th className="px-4 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort("assignedTo", "grievances")
                                        }
                                        className="group flex items-center space-x-1.5 text-[13px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>Assigned</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="assignedTo" />
                                      </button>
                                    </th>
                                    <th className="px-4 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort("status", "grievances")
                                        }
                                        className="group flex items-center space-x-1.5 text-[13px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>Status</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="status" />
                                      </button>
                                    </th>
                                    <th className="px-4 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort("slaStatus", "grievances")
                                        }
                                        className="group flex items-center space-x-1.5 text-[13px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>SLA</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="slaStatus" />
                                      </button>
                                    </th>
                                    <th className="px-4 py-3 text-left">
                                      <button
                                        onClick={() =>
                                          handleSort("createdAt", "grievances")
                                        }
                                        className="group flex items-center space-x-1.5 text-[13px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                                      >
                                        <span>Date</span>
                                        <SortIcon sortConfig={sortConfig} columnKey="createdAt" />
                                      </button>
                                    </th>
                                    <th className="px-4 py-3 text-center text-[13px] font-black text-slate-400 uppercase tracking-widest">
                                      Actions
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                  {getSortedData(grievances, "grievances").map(
                                    (grievance, index) => (
                                      <tr
                                        key={grievance._id}
                                        className="hover:bg-gradient-to-r hover:from-indigo-50/50 hover:to-purple-50/50 transition-all duration-200 group/row"
                                      >
                                        {isSuperAdminUser && (
                                          <td className="px-3 py-4 text-center">
                                            <input
                                              type="checkbox"
                                              checked={selectedGrievances.has(
                                                grievance._id,
                                              )}
                                              onChange={(e) => {
                                                const newSelected = new Set(
                                                  selectedGrievances,
                                                );
                                                if (e.target.checked) {
                                                  newSelected.add(
                                                    grievance._id,
                                                  );
                                                } else {
                                                  newSelected.delete(
                                                    grievance._id,
                                                  );
                                                }
                                                setSelectedGrievances(
                                                  newSelected,
                                                );
                                              }}
                                              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                                            />
                                          </td>
                                        )}
                                        <td className="px-3 py-4 text-center">
                                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                                            {(grievancePage - 1) *
                                              grievancePagination.limit +
                                              index +
                                              1}
                                          </span>
                                        </td>
                                        <td className="px-2 py-4">
                                          <button
                                            onClick={() =>
                                              openGrievanceDetail(grievance._id)
                                            }
                                            className="font-bold text-[13px] sm:text-xs text-blue-700 hover:text-blue-800 hover:underline"
                                          >
                                            <span className="text-[12px] sm:text-xs font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                              {grievance.grievanceId}
                                            </span>
                                          </button>
                                        </td>
                                        <td className="px-2 py-4">
                                          <div className="flex flex-col">
                                            <button
                                              onClick={() =>
                                                openGrievanceDetail(
                                                  grievance._id,
                                                  grievance,
                                                )
                                              }
                                              className="text-gray-900 font-bold text-sm text-left hover:text-blue-600 hover:underline"
                                            >
                                              {grievance.citizenName}
                                            </button>
                                            <div className="flex items-center text-xs text-gray-500 font-medium">
                                              <Phone className="w-3 h-3 mr-1.5" />
                                              {formatTo10Digits(
                                                grievance.citizenPhone,
                                              )}
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-2 py-4">
                                          <div className="flex flex-col">
                                            <span className="text-xs font-semibold text-gray-700">
                                              {typeof grievance.departmentId ===
                                                "object" &&
                                              grievance.departmentId
                                                ? grievance.subDepartmentId &&
                                                  typeof grievance.subDepartmentId ===
                                                    "object"
                                                  ? `${(grievance.departmentId as any).name} - ${(grievance.subDepartmentId as any).name}`
                                                  : (
                                                      grievance.departmentId as any
                                                    ).name
                                                : dashboardTenantConfig.revertAdminLabel}
                                            </span>
                                            <span className="text-[14px] text-orange-400 uppercase">
                                              {grievance.category}
                                            </span>
                                            
                                            {/* Desktop Revert Info */}
                                            {grievance.status === 'REVERTED' && (() => {
                                              const latestRevertRemark = grievance.statusHistory
                                                ?.filter((h: any) => h.status === 'REVERTED')
                                                .sort((a: any, b: any) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())[0]?.remarks;

                                              const revertEntry = grievance.timeline
                                                ?.filter((t: any) => t.action === 'REVERTED_TO_COMPANY_ADMIN')
                                                .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

                                              const suggestedDeptId = revertEntry?.details?.suggestedDepartmentId;
                                              const suggestedSubDeptId = revertEntry?.details?.suggestedSubDepartmentId;

                                              if (!latestRevertRemark && !suggestedDeptId && !suggestedSubDeptId) return null;

                                              return (
                                                <div className="mt-2 space-y-2">
                                                  {latestRevertRemark && (
                                                    <div className="bg-rose-50 border border-rose-100 rounded-lg p-2 max-w-[280px]">
                                                      <p className="text-[15px] font-black text-rose-500 uppercase tracking-tighter mb-0.5 flex items-center gap-1">
                                                        <Undo2 className="w-2.5 h-2.5" /> Revert Remark
                                                      </p>
                                                      <p className="text-[14px] text-rose-700 font-bold leading-tight break-words">
                                                        {latestRevertRemark}
                                                      </p>
                                                    </div>
                                                  )}
                                                  {(suggestedDeptId || suggestedSubDeptId) && (
                                                    <div className="group/suggested max-w-[280px]">
                                                      <div className="flex items-center gap-1 text-[15px] text-rose-500 font-black uppercase tracking-widest mb-1 opacity-70">
                                                        <ArrowRightCircle className="w-2.5 h-2.5" /> Proposed Destination
                                                      </div>
                                                      <div className="flex items-center gap-2 bg-rose-50/50 border border-rose-100 rounded-lg p-2">
                                                        <div className="w-6 h-6 bg-rose-100 rounded-md flex items-center justify-center text-rose-600 shrink-0">
                                                          <Building2 className="w-3.5 h-3.5" />
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                          <span className="text-[14px] font-bold text-slate-900 leading-tight break-words whitespace-normal">
                                                            {allDepartments?.find(d => d._id === (suggestedSubDeptId || suggestedDeptId))?.name || "Target Department"}
                                                          </span>
                                                        </div>
                                                      </div>
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })()}
                                          </div>
                                        </td>
                                        <td className="px-2 py-4">
                                          <div className="flex flex-col">
                                            {grievance.assignedTo ? (
                                              <>
                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                  <button
                                                    onClick={() => {
                                                      const assignedUserId =
                                                        typeof grievance.assignedTo ===
                                                          "object" &&
                                                        grievance.assignedTo !==
                                                          null
                                                          ? (
                                                              grievance.assignedTo as any
                                                            )._id
                                                          : users.find(
                                                              (u) =>
                                                                u._id ===
                                                                  grievance.assignedTo ||
                                                                u.userId ===
                                                                  grievance.assignedTo,
                                                            )?._id ||
                                                            grievance.assignedTo;
                                                      openUserDetail(
                                                        assignedUserId,
                                                      );
                                                    }}
                                                    className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 hover:underline text-left transition-colors"
                                                  >
                                                    {typeof grievance.assignedTo ===
                                                      "object" &&
                                                    grievance.assignedTo !==
                                                      null
                                                      ? `${(grievance.assignedTo as any).firstName} ${(grievance.assignedTo as any).lastName}`
                                                      : users.find(
                                                            (u) =>
                                                              u._id ===
                                                                grievance.assignedTo ||
                                                              u.userId ===
                                                                grievance.assignedTo,
                                                          )?.firstName
                                                        ? (() => {
                                                            const found =
                                                              users.find(
                                                                (u) =>
                                                                  u._id ===
                                                                    grievance.assignedTo ||
                                                                  u.userId ===
                                                                    grievance.assignedTo,
                                                              );
                                                            return `${found?.firstName} ${found?.lastName}`;
                                                          })()
                                                        : grievance.assignedTo}
                                                  </button>
                                                  {typeof grievance.assignedTo ===
                                                    "object" &&
                                                    (
                                                      grievance.assignedTo as any
                                                    ).designation && (
                                                      <span className="text-[14px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium">
                                                        {
                                                          (
                                                            grievance.assignedTo as any
                                                          ).designation
                                                        }
                                                      </span>
                                                    )}
                                                </div>
                                                {grievance.assignedAt && (
                                                  <span className="text-[14px] text-slate-400 font-medium">
                                                    Assigned:{" "}
                                                    {new Date(
                                                      grievance.assignedAt,
                                                    ).toLocaleDateString()}
                                                  </span>
                                                )}
                                              </>
                                            ) : (
                                              <div className="flex items-center gap-1.5 text-slate-400 italic">
                                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                                                <span className="text-[15px]">
                                                  Unassigned
                                                </span>
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                        <td className="px-2 py-4">
                                          <button
                                            /* onClick={() => {
                                              // Status updates now open from the Actions column.
                                            }} */
                                            disabled={
                                              grievance.status === "RESOLVED" ||
                                              grievance.status === "CLOSED" ||
                                              grievance.status === "REJECTED" ||
                                              updatingGrievanceStatus.has(
                                                grievance._id,
                                              )
                                            }
                                            className={`px-3 py-1.5 text-[14px] font-bold border border-gray-200 rounded bg-white uppercase tracking-tight transition-all cursor-default ${
                                              updatingGrievanceStatus.has(
                                                grievance._id,
                                              )
                                                ? "opacity-50 cursor-wait"
                                                : ""
                                            } ${
                                              grievance.status === "RESOLVED" ||
                                              grievance.status === "CLOSED" ||
                                              grievance.status === "REJECTED"
                                                ? "opacity-60"
                                                : ""
                                            }`}
                                          >
                                            {grievance.status === "PENDING" || grievance.status === "ASSIGNED"
                                              ? "Pending"
                                              : grievance.status}
                                          </button>
                                        </td>
                                        <td className="px-2 py-4">
                                          {(() => {
                                            const createdDate = new Date(
                                              grievance.createdAt,
                                            );
                                            const now = new Date();
                                            let isOverdue = false;

                                            const activeStatuses = ["PENDING", "ASSIGNED", "IN_PROGRESS", "REVERTED"];
                                            if (activeStatuses.includes(grievance.status)) {
                                              const currentSlaHours = grievance.slaHours || 120;
                                              isOverdue = (now.getTime() - createdDate.getTime()) > (currentSlaHours * 3600000);
                                            }
                                            if (
                                              grievance.status === "RESOLVED" ||
                                              grievance.status === "CLOSED" ||
                                              grievance.status === "REJECTED"
                                            ) {
                                              return (
                                                <span className="px-2 py-1 text-[14px] font-bold bg-green-100 text-green-700 rounded">
                                                  Completed
                                                </span>
                                              );
                                            }

                                            return isOverdue ? (
                                              canSendOverdueReminder ? (
                                                <button
                                                  onClick={() =>
                                                    openOverdueReminderDialog(
                                                      grievance,
                                                    )
                                                  }
                                                  title="Click to open overdue reminder dialog"
                                                  className="px-2 py-1 text-[14px] font-bold bg-red-100 text-red-700 rounded animate-pulse border border-red-300 hover:bg-red-200 cursor-pointer"
                                                >
                                                  Overdue
                                                </button>
                                              ) : (
                                                <span className="px-2 py-1 text-[14px] font-bold bg-red-100 text-red-700 rounded border border-red-200">
                                                  Overdue
                                                </span>
                                              )
                                            ) : (
                                              <span className="px-2 py-1 text-[14px] font-bold bg-green-100 text-green-700 rounded">
                                                On Track
                                              </span>
                                            );
                                          })()}
                                        </td>
                                        <td className="px-2 py-4 text-xs text-gray-600">
                                          <div className="flex flex-col">
                                            <span className="font-medium">
                                              {new Date(
                                                grievance.createdAt,
                                              ).toLocaleDateString()} • {new Date(grievance.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                            </span>
                                          </div>
                                        </td>
                                        <td className="px-2 py-4">
                                          <div className="flex items-center justify-center space-x-1">
                                            {hasPermission(
                                              user,
                                              Permission.ASSIGN_GRIEVANCE,
                                            ) &&
                                              (canReopenResolvedGrievance ||
                                                (grievance.status !==
                                                  "RESOLVED" &&
                                                  grievance.status !==
                                                    "CLOSED" &&
                                                  grievance.status !==
                                                    "REJECTED")) && (
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => {
                                                    setSelectedGrievanceForAssignment(
                                                      grievance,
                                                    );
                                                    setShowGrievanceAssignment(
                                                      true,
                                                    );
                                                  }}
                                                  title="Assign/Reassign Official"
                                                  className="h-8 w-8 p-0 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
                                                >
                                                  <svg
                                                    className="w-4 h-4"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                  >
                                                    <path
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                      strokeWidth={2}
                                                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                                    />
                                                  </svg>
                                                </Button>
                                              )}
                                            {hasPermission(
                                              user,
                                              Permission.REVERT_GRIEVANCE,
                                            ) &&
                                              isLowerHierarchyRole &&
                                              ["PENDING", "ASSIGNED", "RESOLVED", "IN_PROGRESS"].includes(
                                                grievance.status,
                                              ) && (
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => {
                                                    setSelectedGrievanceForRevert(
                                                      grievance,
                                                    );
                                                    setShowGrievanceRevertDialog(
                                                      true,
                                                    );
                                                  }}
                                                  title="Request Reassignment"
                                                  className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                >
                                                  <svg
                                                    className="w-4 h-4"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                  >
                                                    <path
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                      strokeWidth={2}
                                                      d="M3 10h10a4 4 0 014 4v1m0 0l-3-3m3 3l3-3M7 14H3m0 0l3 3m-3-3l3-3"
                                                    />
                                                  </svg>
                                                </Button>
                                              )}
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() =>
                                                openGrievanceDetail(
                                                  grievance._id,
                                                  grievance,
                                                )
                                              }
                                              title="View"
                                              className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                            >
                                              <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                              >
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                                />
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                                />
                                              </svg>
                                            </Button>
                                            {canDeleteGrievance && (
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                  handleDeleteGrievance(grievance)
                                                }
                                                disabled={isDeleting}
                                                title="Delete grievance"
                                                className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </Button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    ),
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>

                            <Pagination
                              currentPage={grievancePage}
                              totalPages={grievancePagination.pages}
                              totalItems={grievancePagination.total}
                              itemsPerPage={grievancePagination.limit}
                              onPageChange={setGrievancePage}
                              className="mt-6 shadow-none border-t border-slate-100 rounded-none bg-slate-50/30"
                            />
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}

              {/* Appointments Tab - Modern Specialized Calendar Integration */}
              {canShowAppointmentsInView &&
                (isViewingCompany || isDepartmentLevel) && (
                  <TabsContent value="appointments" className="space-y-4">
                    <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
                      {/* Appointment Filters */}
                      <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-purple-50/30 border-b border-slate-200">
                        {/* Search and Actions Bar */}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                          <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <input
                              type="text"
                              placeholder="Quick search..."
                              value={appointmentSearch}
                              onChange={(e) =>
                                setAppointmentSearch(e.target.value)
                              }
                              className="w-full pl-9 pr-3.5 h-9 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-[15px] font-bold uppercase tracking-tight placeholder:normal-case placeholder:text-slate-400 shadow-sm"
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setShowAppointmentFiltersOnMobile(
                                    (prev) => !prev,
                                  )
                                }
                                className="md:hidden border-slate-200 hover:bg-slate-50 rounded-lg h-8 text-[15px] font-bold uppercase tracking-tight"
                                title="Toggle filters"
                              >
                                <Filter className="w-3.5 h-3.5 mr-1" />
                                Filters
                              </Button>
                              <div className="flex items-center gap-2">
                                {(isViewingCompany || isDepartmentLevel) && (
                                  <Button
                                    onClick={() =>
                                      setShowAvailabilityCalendar(true)
                                    }
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white border-0 h-9 text-[14px] font-bold uppercase tracking-widest rounded-lg px-4 shadow-md whitespace-nowrap"
                                    title="Configure when appointments can be scheduled"
                                  >
                                    <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                                    Availability
                                  </Button>
                                )}
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleRefreshData}
                                disabled={isRefreshing}
                                className="border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap h-9 text-[15px] font-bold uppercase tracking-tight"
                                title="Refresh data"
                              >
                                <RefreshCw
                                  className={`w-4 h-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`}
                                />
                                Refresh
                              </Button>

                              {isSuperAdminUser &&
                                selectedAppointments.size > 0 && (
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={handleBulkDeleteAppointments}
                                    disabled={isDeleting}
                                    className="text-[14px] font-bold uppercase bg-red-600 hover:bg-red-700 text-white rounded-lg border border-red-700 shadow-sm transition-all px-3 h-9"
                                    title={`Delete ${selectedAppointments.size} selected appointment(s)`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                    Delete ({selectedAppointments.size})
                                  </Button>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-bold text-slate-700 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-200 whitespace-nowrap h-9 flex items-center">
                                Showing{" "}
                                <span className="text-indigo-600 font-black px-1">
                                  {getSortedData(appointments, "appointments").length}
                                </span>{" "}
                                of {appointmentPagination.total}
                              </span>

                              <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm h-9">
                                <span className="text-[15px] font-black text-slate-400 uppercase tracking-widest">
                                  Rows:
                                </span>
                                <select
                                  value={appointmentPagination.limit}
                                  onChange={(e) =>
                                    setAppointmentPagination((prev) => ({
                                      ...prev,
                                      limit: Number(e.target.value),
                                    }))
                                  }
                                  className="text-[14px] font-bold text-slate-900 bg-transparent border-0 focus:ring-0 cursor-pointer p-0 h-auto"
                                >
                                  {[10, 20, 25, 50, 100, 200, 250].map((l) => (
                                    <option key={l} value={l}>
                                      {l}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Filters Row */}
                        <div
                          className={cn(
                            "gap-3 md:items-center",
                            showAppointmentFiltersOnMobile
                              ? "flex flex-col md:flex-row"
                              : "hidden md:flex md:flex-row",
                          )}
                        >
                          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-200 h-8">
                            <Filter className="w-3.5 h-3.5 text-indigo-500" />
                            <span className="text-[15px] font-bold text-slate-700 uppercase tracking-tight">
                              Filters
                            </span>
                          </div>

                          {/* Status Filter */}
                          <select
                            value={appointmentFilters.status}
                            onChange={(e) =>
                              setAppointmentFilters((prev) => ({
                                ...prev,
                                status: e.target.value,
                              }))
                            }
                            className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium"
                            title="Filter by appointment status"
                          >
                            <option value="">📋 All Status</option>
                            <option value="SCHEDULED">📅 Scheduled</option>
                            <option value="CONFIRMED">✅ Confirmed</option>
                            <option value="COMPLETED">✅ Completed</option>
                            <option value="CANCELLED">❌ Cancelled</option>
                          </select>

                          {/* Date Filter */}
                          <select
                            value={appointmentFilters.dateFilter}
                            onChange={(e) =>
                              setAppointmentFilters((prev) => ({
                                ...prev,
                                dateFilter: e.target.value,
                              }))
                            }
                            className="text-[15px] h-8 px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm hover:border-indigo-300 transition-colors cursor-pointer font-medium"
                            title="Filter by date"
                          >
                            <option value="">📅 All Time</option>
                            <option value="today">Today</option>
                            <option value="week">This Week</option>
                            <option value="month">This Month</option>
                            <option value="upcoming">Upcoming</option>
                          </select>

                          {/* Clear Filters */}
                          {(appointmentFilters.status ||
                            appointmentFilters.dateFilter) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setAppointmentFilters({
                                    status: "",
                                    department: "",
                                    assignmentStatus: "",
                                    dateFilter: "",
                                  })
                                }
                                className="text-[15px] h-8 px-3 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 font-medium"
                                title="Clear all filters"
                              >
                                <X className="w-3 h-3 mr-1" />
                                Clear
                              </Button>
                          )}
                        </div>
                      </div>
                        {/* Appointments Content Area */}
                        <div className="p-0">
                          {loadingAppointments ? (
                            <div className="flex flex-col gap-4 p-4">
                              {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="h-24 bg-slate-50 animate-pulse rounded-xl" />
                              ))}
                            </div>
                          ) : getSortedData(appointments, "appointments").length === 0 ? (
                            <div className="text-center py-20 px-6">
                              <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-white">
                                <CalendarCheck className="w-10 h-10 text-indigo-500" />
                              </div>
                              <h3 className="text-slate-700 text-lg font-bold">No appointments found</h3>
                              <p className="text-slate-400 text-sm mt-1 max-w-xs mx-auto">
                                There are no appointments matching your current filters.
                              </p>
                              {(appointmentFilters.status || appointmentFilters.dateFilter || appointmentSearch) && (
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => {
                                    setAppointmentSearch("");
                                    setAppointmentFilters({ status: "", department: "", assignmentStatus: "", dateFilter: "" });
                                  }}
                                  className="mt-6 border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                                >
                                  Clear all filters
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col">
                              {/* Desktop Table View */}
                              <div className="hidden md:block overflow-x-auto">
                                <table className="w-full border-collapse">
                                  <thead>
                                    <tr className="bg-slate-50/80 border-b border-slate-200">
                                      {isSuperAdminUser && (
                                        <th className="px-4 py-3.5 text-center">
                                          <input
                                            type="checkbox"
                                            checked={selectedAppointments.size === appointments.length && appointments.length > 0}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setSelectedAppointments(new Set(appointments.map(a => a._id)));
                                              } else {
                                                setSelectedAppointments(new Set());
                                              }
                                            }}
                                            className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                                          />
                                        </th>
                                      )}
                                      <th className="px-4 py-3.5 text-left text-[14px] font-black text-slate-400 uppercase tracking-widest">Sr.</th>
                                      <th className="px-4 py-3.5 text-left text-[14px] font-black text-slate-400 uppercase tracking-widest">Appointment ID</th>
                                      <th className="px-4 py-3.5 text-left text-[14px] font-black text-slate-400 uppercase tracking-widest">Citizen</th>
                                      <th className="px-4 py-3.5 text-left text-[14px] font-black text-slate-400 uppercase tracking-widest">Purpose</th>
                                      <th className="px-4 py-3.5 text-left text-[14px] font-black text-slate-400 uppercase tracking-widest">Date & Time</th>
                                      <th className="px-4 py-3.5 text-left text-[14px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                                      <th className="px-4 py-3.5 text-right text-[14px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {getSortedData(appointments, "appointments").map((appointment, idx) => (
                                      <tr key={appointment._id} className="hover:bg-indigo-50/30 transition-colors group">
                                        {isSuperAdminUser && (
                                          <td className="px-4 py-4 text-center">
                                            <input
                                              type="checkbox"
                                              checked={selectedAppointments.has(appointment._id)}
                                              onChange={(e) => {
                                                const next = new Set(selectedAppointments);
                                                if (e.target.checked) next.add(appointment._id);
                                                else next.delete(appointment._id);
                                                setSelectedAppointments(next);
                                              }}
                                              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                                            />
                                          </td>
                                        )}
                                        <td className="px-4 py-4 text-[15px] font-bold text-slate-400">
                                          {(appointmentPage - 1) * appointmentPagination.limit + idx + 1}
                                        </td>
                                        <td className="px-4 py-4">
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[14px] font-mono font-bold text-slate-600">
                                            {appointment.appointmentId}
                                          </span>
                                        </td>
                                        <td className="px-4 py-4">
                                          <div className="flex flex-col">
                                            <span className="text-sm font-bold text-slate-700">{appointment.citizenName}</span>
                                            <span className="text-[14px] text-slate-400 font-medium">{appointment.citizenPhone}</span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-4">
                                          <p className="text-xs text-slate-600 line-clamp-1 max-w-[200px]" title={appointment.purpose}>
                                            {appointment.purpose}
                                          </p>
                                        </td>
                                        <td className="px-4 py-4">
                                          <div className="flex flex-col">
                                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                                              <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                              {new Date(appointment.appointmentDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[14px] text-slate-400 font-bold ml-5">
                                              <Clock className="w-3 h-3" />
                                              {appointment.appointmentTime}
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-4 py-4 text-center">
                                          <span className={cn(
                                            "inline-flex items-center px-2.5 py-1 rounded-full text-[14px] font-black uppercase tracking-wider border",
                                            appointment.status === 'SCHEDULED' && "bg-blue-50 text-blue-600 border-blue-100",
                                            appointment.status === 'CONFIRMED' && "bg-indigo-50 text-indigo-600 border-indigo-100",
                                            appointment.status === 'COMPLETED' && "bg-emerald-50 text-emerald-600 border-emerald-100",
                                            appointment.status === 'CANCELLED' && "bg-rose-50 text-rose-600 border-rose-100"
                                          )}>
                                            {appointment.status}
                                          </span>
                                        </td>
                                        <td className="px-4 py-4 text-right">
                                          <div className="flex items-center justify-end gap-1">
                                            <Button 
                                              variant="ghost" 
                                              size="sm" 
                                              onClick={() => openAppointmentDetail(appointment._id, appointment)}
                                              className="h-8 w-8 p-0 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                                            >
                                              <Eye className="w-4 h-4" />
                                            </Button>
                                            {isSuperAdminUser && (
                                              <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                onClick={async () => {
                                                  if(confirm("Are you sure you want to delete this appointment?")) {
                                                    try {
                                                      const res = await appointmentAPI.delete(appointment._id);
                                                      if(res.success) {
                                                        toast.success("Appointment deleted");
                                                        handleRefreshData();
                                                      }
                                                    } catch(err) {
                                                      toast.error("Failed to delete");
                                                    }
                                                  }
                                                }}
                                                className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </Button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {/* Mobile Card View */}
                              <div className="md:hidden divide-y divide-slate-100">
                                {getSortedData(appointments, "appointments").map((appointment) => (
                                  <div key={appointment._id} className="p-4 bg-white active:bg-slate-50 transition-colors" onClick={() => openAppointmentDetail(appointment._id, appointment)}>
                                    <div className="flex justify-between items-start mb-2">
                                      <div className="flex flex-col">
                                        <span className="text-[14px] font-mono font-bold text-slate-400 mb-1">{appointment.appointmentId}</span>
                                        <h4 className="font-bold text-slate-800">{appointment.citizenName}</h4>
                                      </div>
                                      <span className={cn(
                                        "px-2 py-0.5 rounded-full text-[15px] font-black uppercase tracking-wider border",
                                        appointment.status === 'SCHEDULED' && "bg-blue-50 text-blue-600 border-blue-100",
                                        appointment.status === 'CONFIRMED' && "bg-indigo-50 text-indigo-600 border-indigo-100",
                                        appointment.status === 'COMPLETED' && "bg-emerald-50 text-emerald-600 border-emerald-100",
                                        appointment.status === 'CANCELLED' && "bg-rose-50 text-rose-600 border-rose-100"
                                      )}>
                                        {appointment.status}
                                      </span>
                                    </div>
                                    <p className="text-xs text-slate-500 mb-3 line-clamp-2">{appointment.purpose}</p>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1.5 text-[15px] font-bold text-slate-600">
                                          <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                          {new Date(appointment.appointmentDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[15px] font-bold text-slate-600">
                                          <Clock className="w-3.5 h-3.5 text-indigo-500" />
                                          {appointment.appointmentTime}
                                        </div>
                                      </div>
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                        <ChevronRight className="w-4 h-4 text-slate-300" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Pagination */}
                              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/30">
                                <Pagination
                                  currentPage={appointmentPage}
                                  totalPages={appointmentPagination.pages}
                                  totalItems={appointmentPagination.total}
                                  onPageChange={(page) => setAppointmentPage(page)}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                    </Card>
                  </TabsContent>
                )}

              {(isSuperAdminUser || isCompanyAdminOrHigher(user)) && (
                <CompanyProvider companyId={companyIdParam || user?.companyId}>
                  {isSuperAdminUser && companyIdParam && (
                    <>
                      <TabsContent value="roles" className="space-y-4">
                        <LazyRoleManagement companyId={companyIdParam} />
                      </TabsContent>

                      <TabsContent value="whatsapp" className="space-y-4">
                        <LazyWhatsAppConfigTab companyId={companyIdParam} />
                      </TabsContent>

                      <TabsContent value="flows" className="space-y-4">
                        <LazyChatbotFlowsTab companyId={companyIdParam} />
                      </TabsContent>

                      <TabsContent value="notifications" className="space-y-4">
                        <LazyNotificationManagement companyId={companyIdParam} />
                      </TabsContent>

                      <TabsContent value="email" className="space-y-4">
                        <LazyEmailConfigTab companyId={companyIdParam} />
                      </TabsContent>
                    </>
                  )}
                  {isCompanyAdminOrHigher(user) && (
                    <TabsContent value="settings" className="space-y-4">
                      <CompanySettingsTab company={company} onUpdate={handleRefreshData || fetchDashboardData} />
                    </TabsContent>
                  )}
                </CompanyProvider>
              )}
              <TabsContent value="profile" className="space-y-6">
                <ProfileTab
                  user={user}
                  profileForm={profileForm}
                  passwordForm={passwordForm}
                  updatingProfile={updatingProfile}
                  updatingPassword={updatingPassword}
                  onProfileSubmit={handleUpdateProfile}
                  onPasswordSubmit={handleUpdatePassword}
                  setProfileForm={setProfileForm}
                  setPasswordForm={setPasswordForm}
                />
              </TabsContent>
            </div>
        
  );
}
