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
import { notificationAPI, InAppNotification } from "@/lib/api/notification";

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
import { cn } from "@/lib/utils";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation";
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

const SuperAdminOverview = dynamic(
  () => import("@/components/superadmin/SuperAdminOverview"),
  {
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <LoadingSpinner text="Loading superadmin dashboard..." />
      </div>
    ),
  },
);


import { DashboardTabPanels } from "@/components/dashboard/DashboardTabPanels";

import { DashboardDialogs } from "@/components/dashboard/DashboardDialogs";


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

const scheduleIdle = (callback: () => void) => {
  if (typeof window === "undefined") {
    return () => {};
  }

  const idleWindow = window as typeof window & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(() => callback(), {
      timeout: 1500,
    });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 250);
  return () => window.clearTimeout(handle);
};


function DashboardPageClientContent() {
  const { user: authUser, loading, logout, refreshUser } = useAuth();
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const user = authUser as any;



  const handleMarkNotificationAsRead = useCallback(async (id: string) => {
    try {
      const response = await notificationAPI.markRead(id);
      if (response.success) {
        setNotifications((prev) =>
          prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  }, []);

  const handleMarkAllNotificationsAsRead = useCallback(async () => {
    try {
      const response = await notificationAPI.markAllRead();
      if (response.success) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
        toast.success("All notifications marked as read");
      }
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error);
    }
  }, []);

  const handleNotificationClick = async (notification: InAppNotification) => {
    if (!notification.isRead) {
      handleMarkNotificationAsRead(notification._id);
    }

    if (notification.grievanceObjectId) {
      try {
        const response = await grievanceAPI.getById(
          notification.grievanceObjectId,
        );
        if (response.success && response.data?.grievance) {
          setSelectedGrievance(response.data.grievance);
          setShowGrievanceDetail(true);
        }
      } catch (e) {
        toast.error("Failed to load grievance details");
      }
    }
  };



  const roleName = (user?.role || "").toString().toLowerCase();
  const explicitLevel =
    typeof user?.level === "number" ? (user.level as number) : undefined;
  const resolvedRoleLevel = useMemo(() => {
    if (user?.isSuperAdmin) return 0;
    if (explicitLevel !== undefined) return explicitLevel;
    if (roleName.includes("company")) return 1;
    if (roleName.includes("department") && !roleName.includes("sub")) return 2;
    if (roleName.includes("sub") && roleName.includes("department")) return 3;
    if (roleName.includes("operator")) return 4;
    return 5;
  }, [user, explicitLevel, roleName]);
  const isCompanyAdminRole = resolvedRoleLevel === 1;
  const isDepartmentAdminRole = resolvedRoleLevel === 2;
  const isSubDepartmentAdminRole = resolvedRoleLevel === 3;
  const isOperatorRole = resolvedRoleLevel >= 4;
  const isLowerHierarchyRole =
    isDepartmentAdminRole || isSubDepartmentAdminRole || isOperatorRole;
  const getRoleHierarchyLevel = useCallback((roleName: string): number => {
    const normalized = (roleName || "").toLowerCase();
    if (normalized.includes("super")) return 0;
    if (normalized.includes("company")) return 1;
    if (normalized.includes("department") && !normalized.includes("sub")) {
      return 2;
    }
    if (normalized.includes("sub") && normalized.includes("department")) {
      return 3;
    }
    if (normalized.includes("operator")) return 4;
    return 5;
  }, []);
  const hasMultiDepartmentMapping =
    Array.isArray(user?.departmentIds) && user.departmentIds.length > 1;
  const isCompanyLevel = user && !user.departmentId && !user.isSuperAdmin;
  const isDepartmentLevel =
    user &&
    (!!user.departmentId ||
      (user?.departmentIds && user.departmentIds.length > 0)) &&
    !user.isSuperAdmin;
  const isSuperAdminUser = useMemo(() => isSuperAdmin(user), [user]);
  const currentUserCompanyId = getCompanyIdFromValue(user?.companyId);
  const canDeleteGrievance = useMemo(
    () => hasPermission(user, Permission.DELETE_GRIEVANCE),
    [user],
  );
  const canAssignGrievance = useMemo(
    () => hasPermission(user, Permission.ASSIGN_GRIEVANCE),
    [user],
  );
  const canReopenResolvedGrievance = useMemo(() => {
    if (!hasPermission(user, Permission.ASSIGN_GRIEVANCE)) return false;
    if (!hasPermission(user, Permission.REVERT_GRIEVANCE)) return false;

    return isCompanyAdminRole || isSuperAdminUser;
  }, [user, isCompanyAdminRole, isSuperAdminUser]);
  const router = useRouter();
  const searchParams = useSearchParams();

  // State to track drilldown ID without keeping it in the URL
  const [drilldownId, setDrilldownId] = useState<string | null>(null);

  // Sync URL/SessionStorage to local state and purge URL
  useEffect(() => {
    // 1. Check URL first (new drilldown)
    const urlId = searchParams.get("companyId");
    // 2. Check Session Storage (persisted drilldown)
    const sessionId = sessionStorage.getItem("drilldownCompanyId");

    if (urlId) {
      // New drilldown from Super Admin panel
      setDrilldownId(urlId);
      sessionStorage.setItem("drilldownCompanyId", urlId);
      
      // Clean URL immediately
      const params = new URLSearchParams(searchParams.toString());
      params.delete("companyId");
      const newQuery = params.toString();
      const newPath = newQuery ? `/dashboard?${newQuery}` : "/dashboard";
      
      // Replace URL without the companyId to hide it from the user
      window.history.replaceState(null, "", newPath);
    } else if (sessionId) {
      // Restore from session
      setDrilldownId(sessionId);
    }
  }, [searchParams]);

  const isSuperAdminDrilldown = isSuperAdminUser && !!drilldownId;
  const targetCompanyId = useMemo(
    () =>
      drilldownId ||
      (user?.companyId && typeof user.companyId === "object"
        ? (user.companyId as any)._id
        : user?.companyId),
    [drilldownId, user],
  );
  const isViewingCompany = useMemo(
    () => isCompanyLevel || (isSuperAdminUser && !!drilldownId),
    [isCompanyLevel, isSuperAdminUser, drilldownId],
  );
  const canSeeDepartmentsTab = useMemo(() => {
    if (isSuperAdminUser && drilldownId) return true;
    if (isCompanyAdminRole || isDepartmentAdminRole) return true;
    if (isSubDepartmentAdminRole) return hasMultiDepartmentMapping;
    return false;
  }, [
    isSuperAdminUser,
    drilldownId,
    isCompanyAdminRole,
    isDepartmentAdminRole,
    isSubDepartmentAdminRole,
    hasMultiDepartmentMapping,
  ]);
  const canSeeUsersTab = useMemo(() => {
    if (isSuperAdminUser && drilldownId) return true;
    return (
      isCompanyAdminRole || isDepartmentAdminRole || isSubDepartmentAdminRole
    );
  }, [
    isSuperAdminUser,
    drilldownId,
    isCompanyAdminRole,
    isDepartmentAdminRole,
    isSubDepartmentAdminRole,
  ]);

  const [mounted, setMounted] = useState(false);
  // Get initial tab from URL search params, default based on role
  const getDefaultTab = () => {
    // Priority 1: Check URL Parameters for state restoration
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl) return tabFromUrl;

    // Priority 2: Company drilldown defaults
    if (drilldownId) return "overview";

    // Priority 3: Role-based defaults
    if (!hasPermission(user, Permission.VIEW_ANALYTICS) && !isSuperAdminUser) {
      if (hasPermission(user, Permission.READ_GRIEVANCE)) return "grievances";
      if (hasPermission(user, Permission.READ_APPOINTMENT))
        return "appointments";
      return "overview";
    }
    return "overview";
  };
  const initialTab = getDefaultTab();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [previousTab, setPreviousTab] = useState<string>("overview");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const allDepartmentsRef = useRef<Department[]>([]);
  useEffect(() => {
    allDepartmentsRef.current = allDepartments;
  }, [allDepartments]);
  const normalizedDesignations = useMemo(() => {
    const values = new Set<string>();
    const pushValue = (value: unknown) => {
      if (typeof value !== "string") return;
      const normalized = value.trim();
      if (normalized) values.add(normalized);
    };

    pushValue((user as any)?.designation);
    ((user as any)?.designations || []).forEach((value: unknown) =>
      pushValue(value),
    );

    return Array.from(values);
  }, [user]);
  const assignedDepartmentSummaries = useMemo(() => {
    const departmentMap = new Map<string, Department>();
    [...allDepartments, ...departments].forEach((dept) => {
      if (!dept?._id) return;
      departmentMap.set(String(dept._id), dept);
    });

    const primaryDepartmentId = user?.departmentId
      ? String(
          typeof user.departmentId === "object"
            ? user.departmentId._id
            : user.departmentId,
        )
      : null;

    const mappedDepartmentIds = (user?.departmentIds || [])
      .map((departmentValue: NonNullable<User["departmentIds"]>[number]) =>
        String(
          typeof departmentValue === "object"
            ? departmentValue?._id
            : departmentValue,
        ),
      )
      .filter(Boolean);

    // Use `departmentIds` as the source of all mapped departments.
    // Keep `departmentId` only as a backward-compatible primary marker/fallback.
    const allMappedDepartmentIds = Array.from(
      new Set(
        [primaryDepartmentId, ...mappedDepartmentIds].filter(
          Boolean,
        ) as string[],
      ),
    );

    return allMappedDepartmentIds.map((departmentId) => {
      const mapped = departmentMap.get(departmentId);
      return {
        id: departmentId,
        name: mapped?.name || "Unknown Unit",
        code: mapped?.departmentId || "UNIT",
        isPrimary: departmentId === primaryDepartmentId,
      };
    });
  }, [user, departments, allDepartments]);
  const [deptUserCounts, setDeptUserCounts] = useState<Record<string, number>>(
    {},
  );
  const [deptSearch, setDeptSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);

  // Profile Form States
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    email: user?.email || "",
    phone: formatTo10Digits(user?.phone) || "",
    designations: normalizedDesignations.join(", "),
  });
  const [passwordForm, setPasswordForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileForm({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: formatTo10Digits(user.phone) || "",
        designations: normalizedDesignations.join(", "),
      });
    }
  }, [user, normalizedDesignations]);
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingProfile(true);

    const updatePromise = (async () => {
      const payload = {
        ...profileForm,
        phone: normalizePhoneNumber(profileForm.phone),
        designations: profileForm.designations
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
      };
      const response = await apiClient.put("/auth/profile", payload);
      if (response && response.success === false) {
        throw new Error(response.message || 'Failed to update profile');
      }
      await refreshUser();
      return response;
    })();

    toast.promise(
      updatePromise,
      {
        loading: 'Updating profile...',
        success: 'Profile Updated Successfully!',
        error: (err: any) => err.response?.data?.message || 'Failed to update profile',
      },
      {
        style: {
          borderRadius: '12px',
          background: '#0f172a',
          color: '#fff',
          fontWeight: 'bold',
          border: '1px solid #334155',
          fontSize: '14px',
          padding: '12px 24px',
        },
        success: {
          duration: 3000,
          iconTheme: {
            primary: '#10b981',
            secondary: '#fff',
          },
        },
      }
    );

    try {
      await updatePromise;
    } catch (error) {
      console.error("Profile update error:", error);
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNewPassword = passwordForm.newPassword.trim();
    const trimmedConfirmPassword = passwordForm.confirmPassword.trim();

    if (!trimmedNewPassword || !trimmedConfirmPassword) {
      toast.error("Please enter and confirm your new password", {
        style: { borderRadius: '12px', fontWeight: 'bold' }
      });
      return;
    }

    if (trimmedNewPassword.length < 6) {
      toast.error("Password must be at least 6 characters", {
        style: { borderRadius: '12px', fontWeight: 'bold' }
      });
      return;
    }

    if (trimmedNewPassword !== trimmedConfirmPassword) {
      toast.error("Passwords do not match", {
        style: { borderRadius: '12px', fontWeight: 'bold' }
      });
      return;
    }
    
    setUpdatingPassword(true);
    
    const updatePromise = (async () => {
      const response = await apiClient.put("/auth/profile", {
        password: trimmedNewPassword,
      });
      if (response && response.success === false) {
        throw new Error(response.message || 'Failed to update security');
      }
      return response;
    })();

    toast.promise(
      updatePromise,
      {
        loading: 'Updating password...',
        success: 'Password Updated Successfully!',
        error: (err: any) => err.response?.data?.message || 'Failed to update security',
      },
      {
        style: {
          borderRadius: '12px',
          background: '#0f172a',
          color: '#fff',
          fontWeight: 'bold',
          border: '1px solid #334155',
          fontSize: '14px',
          padding: '12px 24px',
        },
        success: {
          duration: 3000,
        },
      }
    );

    try {
      const response: any = await updatePromise;
      if (response.success || response) {
        setPasswordForm({ newPassword: "", confirmPassword: "" });
      }
    } catch (error: any) {
      console.error("Password update error:", error);
    } finally {
      setUpdatingPassword(false);
    }
  };

  const [company, setCompany] = useState<Company | null>(null);
  const scopedCompanyId = getScopedCompanyId({
    companyIdParam: drilldownId,
    company,
    userCompanyId: user?.companyId,
  });

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await notificationAPI.getAll({ 
        limit: 10,
        companyId: scopedCompanyId 
      });
      if (response.success) {
        setNotifications(response.data.notifications);
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    }
  }, [scopedCompanyId]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await notificationAPI.getUnreadCount(scopedCompanyId);
      if (response.success) {
        setUnreadCount(response.data.unreadCount);
      }
    } catch (error) {
      console.error("Failed to fetch unread count:", error);
    }
  }, [scopedCompanyId]);

  useEffect(() => {
    if (authUser) {
      const cancelIdleWork = scheduleIdle(() => {
        fetchNotifications();
        fetchUnreadCount();
      });

      const interval = setInterval(() => {
        fetchUnreadCount();
        fetchNotifications();
      }, 30000); // 30 seconds

      return () => {
        cancelIdleWork();
        clearInterval(interval);
      };
    }
  }, [authUser, fetchNotifications, fetchUnreadCount, scopedCompanyId]);
  const dashboardTenantConfig = getDashboardTenantConfig(scopedCompanyId, company?.name);
  const isJharsugudaCompany = dashboardTenantConfig.isCollectorateJharsuguda;
  const canSendOverdueReminder = isJharsugudaCompany && isCompanyAdminRole;
  const dashboardBrandTitle = dashboardTenantConfig.brandTitle;
  const dashboardBrandSubtitle = dashboardTenantConfig.brandSubtitle;
  const showDepartmentPriorityColumn =
    company?.showDepartmentPriorityColumn !== false;
  const canManageDepartmentPriority =
    isSuperAdminDrilldown ||
    (isCompanyAdminRole && company?.showDepartmentPriorityColumn !== false);
  const canToggleDepartmentPriorityColumn = isSuperAdminDrilldown;
  const isHierarchicalCompany = useMemo(() => {
    const fromStats = stats?.isHierarchicalEnabled;
    if (typeof fromStats === "boolean") return fromStats;
    return !!company?.enabledModules?.includes(Module.HIERARCHICAL_DEPARTMENTS);
  }, [stats?.isHierarchicalEnabled, company]);
  const overdueGrievancesCount =
    stats?.grievances?.slaBreached ?? stats?.grievances?.pendingOverdue ?? 0;
  const totalRegisteredGrievances =
    stats?.grievances?.registeredTotal ?? stats?.grievances?.total ?? 0;
  const [roles, setRoles] = useState<Role[]>([]);
  const filteredRolesByHierarchy = useMemo(
    () =>
      (roles || []).filter((role: Role) => {
        const level = getRoleHierarchyLevel(role?.name || "");
        return level > resolvedRoleLevel;
      }),
    [roles, getRoleHierarchyLevel, resolvedRoleLevel],
  );
  const [showDepartmentDialog, setShowDepartmentDialog] = useState(false);
  const [showDeptUsersDialog, setShowDeptUsersDialog] = useState(false);
  const [selectedDeptForUsers, setSelectedDeptForUsers] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showEditUserDialog, setShowEditUserDialog] = useState(false);
  const [showChangePermissionsDialog, setShowChangePermissionsDialog] =
    useState(false);
  const [selectedUserForDetails, setSelectedUserForDetails] =
    useState<User | null>(null);
  const [showUserDetailsDialog, setShowUserDetailsDialog] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(
    null,
  );
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: "danger" | "warning" | "info";
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    variant: "danger",
  });
  const [isMobileTabMenuOpen, setIsMobileTabMenuOpen] = useState(false);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingGrievances, setLoadingGrievances] = useState(false);

  // Sync state with URL manually updated
  // Tab state is handled locally for a pure SPA experience as requested
  // URL parameters like ?tab=... have been removed.
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [updatingGrievanceStatus, setUpdatingGrievanceStatus] = useState<
    Set<string>
  >(new Set());
  const [updatingAppointmentStatus, setUpdatingAppointmentStatus] = useState<
    Set<string>
  >(new Set());
  const [navigatingToDepartment, setNavigatingToDepartment] = useState<
    string | null
  >(null);
  const [performanceData, setPerformanceData] = useState<any>(null);
  const [departmentData, setDepartmentData] = useState<any[]>([]);
  const [selectedGrievance, setSelectedGrievance] = useState<Grievance | null>(
    null,
  );
  const [showGrievanceDetail, setShowGrievanceDetail] = useState(false);
  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);
  const [showAppointmentDetail, setShowAppointmentDetail] = useState(false);
  const [showAppointmentStatusModal, setShowAppointmentStatusModal] =
    useState(false);
  const [selectedAppointmentForStatus, setSelectedAppointmentForStatus] =
    useState<Appointment | null>(null);
  const [showGrievanceStatusModal, setShowGrievanceStatusModal] =
    useState(false);
  const [selectedGrievanceForStatus, setSelectedGrievanceForStatus] =
    useState<Grievance | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<
    string | null
  >(null);

  // Selection state for bulk delete
  const [selectedGrievances, setSelectedGrievances] = useState<Set<string>>(
    new Set(),
  );
  const [selectedAppointments, setSelectedAppointments] = useState<Set<string>>(
    new Set(),
  );
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedDepartments, setSelectedDepartments] = useState<Set<string>>(
    new Set(),
  );
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>(
    {},
  );
  const [savingPriorityIds, setSavingPriorityIds] = useState<Set<string>>(
    new Set(),
  );
  const [showHierarchyDialog, setShowHierarchyDialog] = useState(false);
  const [selectedDeptForHierarchy, setSelectedDeptForHierarchy] =
    useState<Department | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showGrievanceAssignment, setShowGrievanceAssignment] = useState(false);
  const [selectedGrievanceForAssignment, setSelectedGrievanceForAssignment] =
    useState<Grievance | null>(null);
  const [showGrievanceRevertDialog, setShowGrievanceRevertDialog] =
    useState(false);
  const [selectedGrievanceForRevert, setSelectedGrievanceForRevert] =
    useState<Grievance | null>(null);
  const [showOverdueReminderDialog, setShowOverdueReminderDialog] =
    useState(false);
  const [selectedGrievanceForReminder, setSelectedGrievanceForReminder] =
    useState<Grievance | null>(null);
  const [reminderRemarks, setReminderRemarks] = useState("");
  const [sendingReminder, setSendingReminder] = useState(false);
  const [showAppointmentAssignment, setShowAppointmentAssignment] =
    useState(false);
  const [
    selectedAppointmentForAssignment,
    setSelectedAppointmentForAssignment,
  ] = useState<Appointment | null>(null);
  const dashboardStatsCacheRef = useRef<Map<string, DashboardStats>>(new Map());
  const [showAvailabilityCalendar, setShowAvailabilityCalendar] =
    useState(false);
  const shouldMountDialogs =
    showDepartmentDialog ||
    showDeptUsersDialog ||
    showUserDialog ||
    showEditUserDialog ||
    showChangePermissionsDialog ||
    showUserDetailsDialog ||
    showGrievanceDetail ||
    showOverdueReminderDialog ||
    showAppointmentDetail ||
    showGrievanceRevertDialog ||
    showGrievanceAssignment ||
    showAppointmentAssignment ||
    showAvailabilityCalendar ||
    showAppointmentStatusModal ||
    showGrievanceStatusModal ||
    showHierarchyDialog ||
    confirmDialog.isOpen;

  // Pagination State
  const [grievancePage, setGrievancePage] = useState(1);
  const [grievancePagination, setGrievancePagination] = useState({
    total: 0,
    pages: 1,
    limit: 20,
  });

  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentPagination, setAppointmentPagination] = useState({
    total: 0,
    pages: 1,
    limit: 20,
  });

  const [departmentPage, setDepartmentPage] = useState(1);
  const [departmentPagination, setDepartmentPagination] = useState({
    total: 0,
    pages: 1,
    limit: 20,
  });

  const [userPage, setUserPage] = useState(1);
  const [userPagination, setUserPagination] = useState({
    total: 0,
    pages: 1,
    limit: 20,
  });

  // High Grievance Departments Chart Filters
  const [highGrievanceMainDept, setHighGrievanceMainDept] = useState("");
  const [highGrievanceSubDept, setHighGrievanceSubDept] = useState("");

  // Sorting State
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc" | null;
    tab: string;
  }>({
    key: "",
    direction: null,
    tab: "grievances",
  });

  // Filters for other tabs
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set([initialTab]));
  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  useEffect(() => {
    if (mounted && targetCompanyId) {
      setGrievanceFilters({
        status: "",
        priority: "",
        mainDeptId: "",
        subDeptId: "",
        slaStatus: "",
        department: "",
        assignmentStatus: "",
        dateRange: "",
      });
      setOverviewFilters({ mainDeptId: "", subDeptId: "" });
      setAnalyticsFilters({ mainDeptId: "", subDeptId: "" });
      setDeptFilters({ status: "", type: "", mainDeptId: "", subDeptId: "" });
      setUserFilters({ status: "", role: "", mainDeptId: "", subDeptId: "" });
      setGrievanceSearch("");
      setAppointmentSearch("");
      setUserSearch("");
      setDeptSearch("");
      setGrievancePage(1);
      setAppointmentPage(1);
      setDepartmentPage(1);
      setUserPage(1);
      setAppointmentFilters({ status: "", department: "", assignmentStatus: "", dateFilter: "" });
    }
  }, [targetCompanyId, mounted]);

  const [deptFilters, setDeptFilters] = useState({
    type: "",
    status: "",
    mainDeptId: "",
    subDeptId: "",
  });
  const [userFilters, setUserFilters] = useState({
    role: "",
    status: "",
    mainDeptId: "",
    subDeptId: "",
  });
  const [showUserFiltersOnMobile, setShowUserFiltersOnMobile] = useState(false);
  const [showDepartmentFiltersOnMobile, setShowDepartmentFiltersOnMobile] =
    useState(false);
  const [showGrievanceFiltersOnMobile, setShowGrievanceFiltersOnMobile] =
    useState(false);
  const [showAppointmentFiltersOnMobile, setShowAppointmentFiltersOnMobile] =
    useState(false);

  const [overviewFilters, setOverviewFilters] = useState({
    mainDeptId: "",
    subDeptId: "",
  });
  const [analyticsFilters, setAnalyticsFilters] = useState({
    mainDeptId: "",
    subDeptId: "",
  });
  const [grievanceFilters, setGrievanceFilters] = useState({
    status: "",
    department: "",
    mainDeptId: "",
    subDeptId: "",
    assignmentStatus: "",
    slaStatus: "",
    dateRange: "",
    priority: "",
  });

  const getParentDepartmentId = useCallback((dept: any): string | null => {
    if (!dept?.parentDepartmentId) return null;
    const id =
      typeof dept.parentDepartmentId === "object"
        ? dept.parentDepartmentId._id
        : dept.parentDepartmentId;
    return id || null;
  }, []);
  const assignedDepartmentIds = useMemo(() => {
    const ids = new Set<string>();
    const pushId = (value: any) => {
      if (!value) return;
      const normalized =
        typeof value === "object" && value !== null
          ? value._id || value.toString?.()
          : value;
      if (normalized) ids.add(String(normalized));
    };

    pushId(user?.departmentId);
    (user?.departmentIds || []).forEach((value: any) => pushId(value));

    return Array.from(ids);
  }, [user]);
  const assignedMainDepartmentIds = useMemo(
    () =>
      assignedDepartmentIds.filter((id) => {
        const department = allDepartments.find((d) => d._id === id);
        return department ? !getParentDepartmentId(department) : false;
      }),
    [assignedDepartmentIds, allDepartments, getParentDepartmentId],
  );
  const scopedDepartmentsForFilters = useMemo(() => {
    if (!isLowerHierarchyRole) return allDepartments;

    if (isDepartmentAdminRole) {
      return allDepartments.filter((department) => {
        const parentId = getParentDepartmentId(department);
        return parentId ? assignedMainDepartmentIds.includes(parentId) : false;
      });
    }

    return allDepartments.filter((department) =>
      assignedDepartmentIds.includes(department._id),
    );
  }, [
    allDepartments,
    isLowerHierarchyRole,
    isDepartmentAdminRole,
    assignedMainDepartmentIds,
    assignedDepartmentIds,
    getParentDepartmentId,
  ]);

  // Search states
  const [grievanceSearch, setGrievanceSearch] = useState("");

  
  // ⚡ Performance Optimized Data Fetching (Cache-First)
  const { data: cachedGrievanceData, isLoading: isLoadingGrievancesFromHook, refetch: refetchGrievances } = useGrievances({
    page: grievancePage,
    limit: grievancePagination.limit,
    status: grievanceFilters.status,
    companyId: targetCompanyId,
    departmentId: grievanceFilters.subDeptId || grievanceFilters.mainDeptId,
    priority: grievanceFilters.priority,
    search: grievanceSearch,
    slaStatus: grievanceFilters.slaStatus,
    enabled: mounted && (visitedTabs.has("grievances") || activeTab === "grievances"),
  });

  const { data: cachedDashboardStats, isLoading: isLoadingStatsFromHook, refetch: refetchDashboardStats } = useDashboardStats({
    companyId: targetCompanyId,
    departmentId: isSubDepartmentAdminRole || isOperatorRole
            ? assignedDepartmentIds[0] || ""
            : (activeTab === "analytics" ? analyticsFilters : overviewFilters)?.subDeptId || (activeTab === "analytics" ? analyticsFilters : overviewFilters)?.mainDeptId || "",
    enabled: mounted && (visitedTabs.has("overview") || visitedTabs.has("analytics") || activeTab === "overview" || activeTab === "analytics"),
  });
  const { data: cachedDashboardKpis, isLoading: isLoadingKpisFromHook } = useDashboardKpis({
    companyId: targetCompanyId,
    departmentId: isSubDepartmentAdminRole || isOperatorRole
      ? assignedDepartmentIds[0] || ""
      : (activeTab === "analytics" ? analyticsFilters : overviewFilters)?.subDeptId ||
        (activeTab === "analytics" ? analyticsFilters : overviewFilters)?.mainDeptId ||
        "",
    enabled: mounted && (visitedTabs.has("overview") || visitedTabs.has("analytics") || activeTab === "overview" || activeTab === "analytics"),
  });

  const { data: cachedDepartmentData, isLoading: isLoadingDeptsFromHook, refetch: refetchDepartmentsHook } = useDepartments({
    page: departmentPage,
    limit: departmentPagination.limit,
    search: deptSearch,
    companyId: targetCompanyId,
    status: deptFilters.status,
    mainDeptId: deptFilters.mainDeptId,
    subDeptId: deptFilters.subDeptId,
    type: deptFilters.type,
    sortBy: sortConfig.tab === "departments" ? sortConfig.key : undefined,
    sortOrder: sortConfig.tab === "departments" ? (sortConfig.direction || undefined) : undefined,
    enabled: mounted && (visitedTabs.has("departments") || activeTab === "departments"),
  });

  useEffect(() => {
    setDepartmentPage(1);
  }, [deptSearch, deptFilters, setDepartmentPage]);

  const { data: cachedUserData, isLoading: isLoadingUsersFromHook, refetch: refetchUsersHook } = useUsers({
    page: userPage,
    limit: userPagination.limit,
    search: userSearch,
    companyId: targetCompanyId,
    departmentId: userFilters.subDeptId || userFilters.mainDeptId,
    role: userFilters.role,
    status: userFilters.status,
    sortBy: sortConfig.tab === "users" ? sortConfig.key : undefined,
    sortOrder: sortConfig.tab === "users" ? (sortConfig.direction || undefined) : undefined,
    enabled: mounted && (visitedTabs.has("users") || activeTab === "users"),
  });

  // 🔄 Background Synchronization for Cached Data
  useEffect(() => {
    if (cachedGrievanceData) {
      setGrievances(cachedGrievanceData.grievances);
      setGrievancePagination(prev => ({
        ...prev,
        total: cachedGrievanceData.pagination.total,
        pages: cachedGrievanceData.pagination.pages,
      }));
    }
  }, [cachedGrievanceData]);

  useEffect(() => {
    if (cachedDashboardStats) {
      setStats(cachedDashboardStats);
    }
  }, [cachedDashboardStats]);

  useEffect(() => {
    setLoadingStats(isLoadingStatsFromHook && !cachedDashboardStats);
  }, [isLoadingStatsFromHook, cachedDashboardStats]);

  useEffect(() => {
    if (cachedDepartmentData) {
      setDepartments(cachedDepartmentData.departments);
      setDepartmentPagination(prev => ({
        ...prev,
        total: cachedDepartmentData.pagination.total,
        pages: cachedDepartmentData.pagination.pages,
      }));
    }
  }, [cachedDepartmentData]);

  useEffect(() => {
    if (cachedUserData) {
      setUsers(cachedUserData.users);
      setUserPagination(prev => ({
        ...prev,
        total: cachedUserData.pagination.total,
        pages: cachedUserData.pagination.pages,
      }));
    }
  }, [cachedUserData]);

  const kpiSource = cachedDashboardKpis?.grievances ? cachedDashboardKpis : stats;
  const pendingKpiCount = (kpiSource?.grievances?.pending || 0) + (kpiSource?.grievances?.assigned || 0) + (kpiSource?.grievances?.inProgress || 0);
  const revertedKpiCount = kpiSource?.grievances?.reverted || 0;
  const resolvedKpiCount = kpiSource?.grievances?.resolved || 0;
  const rejectedKpiCount = kpiSource?.grievances?.rejected || 0;
  const overdueKpiCount =
    kpiSource?.grievances?.slaBreached ?? kpiSource?.grievances?.pendingOverdue ?? overdueGrievancesCount;
  const totalGrievancesKpiCount =
    kpiSource?.grievances?.registeredTotal ?? kpiSource?.grievances?.total ?? totalRegisteredGrievances;
  const loadingKpiTiles = isLoadingKpisFromHook && !kpiSource;




  // Handle loading state from hook
  useEffect(() => {
    setLoadingGrievances(isLoadingGrievancesFromHook && grievances.length === 0);
  }, [isLoadingGrievancesFromHook, grievances.length]);

  const [appointmentSearch, setAppointmentSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);


  // Helper to check module access - strictly respects company config if viewing a specific company
  const hasModule = useCallback(
    (module: Module) => {
      // If we are viewing a specific company dashboard (either as Company Admin or Super Admin drilldown)
      // we MUST respect the specific company's enabled modules configuration.
      if (isViewingCompany) {
        // If company data is not loaded yet, assume basic modules to prevent layout jumps
        // This ensures the dashboard has a consistent 'Single Structure' as requested.
        if (!company) {
          return [Module.GRIEVANCE, Module.APPOINTMENT].includes(module);
        }

        const enabledModules = (company.enabledModules || []) as string[];
        return enabledModules.includes(module as string);
      }

      // Fallback for regular session view (Global SuperAdmin overview)
      if (isSuperAdminUser) return true;

      const modules = (company?.enabledModules ||
        user?.enabledModules ||
        []) as string[];
      return modules.includes(module as string);
    },
    [user, company, isViewingCompany, isSuperAdminUser],
  );

  const canShowAppointmentsInView = useMemo(() => {
    return (
      hasModule(Module.APPOINTMENT) &&
      hasPermission(user, Permission.READ_APPOINTMENT)
    );
  }, [hasModule, user]);



  // Export functions
  const exportToCSV = (
    data: any[],
    filename: string,
    columns: { key: string; label: string }[],
  ) => {
    const headers = columns.map((col) => col.label).join(",");
    const rows = data.map((item) =>
      columns
        .map((col) => {
          let value = item[col.key];
          if (typeof value === "object" && value !== null) {
            value = value.name || value.firstName || value._id || "";
          }
          if (typeof value === "string" && value.includes(",")) {
            value = `"${value}"`;
          }
          return value || "";
        })
        .join(","),
    );
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success(`Exported ${data.length} records to CSV`);
  };

  const handleRefreshData = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        fetchGrievances(),
        fetchAppointments(),
        fetchDashboardData(),
      ]);
      toast.success("Data refreshed successfully");
    } catch (error) {
      toast.error("Failed to refresh data");
    } finally {
      setIsRefreshing(false);
    }
  };

  const navigateToGrievances = useCallback(
    (filters?: Partial<typeof grievanceFilters>) => {
      setActiveTab("grievances");
      setGrievancePage(1);
      if (filters) {
        setGrievanceFilters((prev) => ({
          ...prev,
          ...filters,
        }));
      }
    },
    [],
  );

  const openGrievanceDetail = async (grievanceId: string, initialData?: Grievance) => {
    if (initialData) {
      setSelectedGrievance(initialData);
      setShowGrievanceDetail(true);
      // Background fetch to ensure timeline and other details are fully loaded
      grievanceAPI.getById(grievanceId).then((response) => {
        if (response.success && response.data?.grievance) {
          setSelectedGrievance(response.data.grievance);
        }
      });
      return;
    }

    try {
      const response = await grievanceAPI.getById(grievanceId);
      if (response.success && response.data?.grievance) {
        setSelectedGrievance(response.data.grievance);
        setShowGrievanceDetail(true);
      }
    } catch (error: any) {
      toast.error("Failed to load grievance details");
    }
  };

  const openAppointmentDetail = async (appointmentId: string, initialData?: Appointment) => {
    if (initialData) {
      setSelectedAppointment(initialData);
      setShowAppointmentDetail(true);
      // Background fetch
      appointmentAPI.getById(appointmentId).then((response) => {
        if (response.success) {
          setSelectedAppointment(response.data.appointment);
        }
      });
      return;
    }

    try {
      const response = await appointmentAPI.getById(appointmentId);
      if (response.success) {
        setSelectedAppointment(response.data.appointment);
        setShowAppointmentDetail(true);
      }
    } catch (error: any) {
      toast.error("Failed to load details");
    }
  };

  const openUserDetail = async (userId: string) => {
    if (!userId) return;
    try {
      const response = await userAPI.getById(userId);
      if (response.success) {
        setSelectedUserForDetails(response.data.user);
        setShowUserDetailsDialog(true);
      }
    } catch (error: any) {
      toast.error("Failed to load user details");
    }
  };

  const openOverdueReminderDialog = (grievance: Grievance) => {
    if (!canSendOverdueReminder) {
      toast.error("Only company admin can send overdue reminders.");
      return;
    }
    setSelectedGrievanceForReminder(grievance);
    setReminderRemarks("");
    setShowOverdueReminderDialog(true);
  };

  const handleSendOverdueReminder = async () => {
    if (!canSendOverdueReminder) {
      toast.error("Only company admin can send overdue reminders.");
      return;
    }
    if (!selectedGrievanceForReminder) return;
    if (!reminderRemarks.trim()) {
      toast.error("Please add remarks before sending reminder");
      return;
    }
    try {
      setSendingReminder(true);
      await grievanceAPI.sendReminder(
        selectedGrievanceForReminder._id,
        reminderRemarks.trim(),
      );
      toast.success("Reminder sent successfully");
      setShowOverdueReminderDialog(false);
      setSelectedGrievanceForReminder(null);
      setReminderRemarks("");
      fetchGrievances(grievancePage, true);
      fetchDashboardData(true);
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to send reminder";
      toast.error(message);
    } finally {
      setSendingReminder(false);
    }
  };

  const handleRevertSubmit = async (payload: any) => {
    if (!selectedGrievanceForRevert) return;
    try {
      const response = await grievanceAPI.revert(
        selectedGrievanceForRevert._id,
        payload,
      );
      if (response.success) {
        toast.success(
          `Grievance reverted to ${dashboardTenantConfig.revertAdminLabelLower} for reassignment`,
        );
        fetchGrievances(grievancePage, true);
        fetchDashboardData(true);
        setShowGrievanceRevertDialog(false);
        setSelectedGrievanceForRevert(null);
      }
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to revert grievance";
      toast.error(errorMessage);
    }
  };

  const handleAssignGrievance = async (
    userId: string,
    departmentId?: string,
    note?: string,
    additionalDepartmentIds?: string[],
    additionalAssigneeIds?: string[],
  ) => {
    if (!selectedGrievanceForAssignment) return;
    await grievanceAPI.assign(
      selectedGrievanceForAssignment._id,
      userId,
      departmentId,
      note,
      additionalDepartmentIds,
      additionalAssigneeIds,
    );
    fetchGrievances(grievancePage, true);
    fetchDashboardData(true);
  };

  const handleAssignAppointment = async (
    userId: string,
    departmentId?: string,
    _note?: string,
  ) => {
    if (!selectedAppointmentForAssignment) return;
    await appointmentAPI.assign(
      selectedAppointmentForAssignment._id,
      userId,
      departmentId,
    );
    fetchAppointments(appointmentPage, true);
    fetchDashboardData(true);
  };

  const grievanceAssignmentCurrentDepartmentId = useMemo(() => {
    if (!selectedGrievanceForAssignment) return null;
    if (selectedGrievanceForAssignment.status === "REVERTED") {
      const revertEntry = selectedGrievanceForAssignment.timeline
        ?.filter((t: any) => t.action === "REVERTED_TO_COMPANY_ADMIN")
        .sort(
          (a: any, b: any) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )[0];
      if (revertEntry?.details?.suggestedDepartmentId) {
        return revertEntry.details.suggestedDepartmentId;
      }
    }
    if (selectedGrievanceForAssignment.status === "RESOLVED") {
      const resolveEntry = selectedGrievanceForAssignment.timeline
        ?.filter(
          (t: any) =>
            t.action === "STATUS_UPDATED" &&
            t.details?.newStatus === "RESOLVED",
        )
        .sort(
          (a: any, b: any) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )[0];
      if (resolveEntry?.details?.departmentId) {
        return resolveEntry.details.departmentId;
      }
    }
    const dept = selectedGrievanceForAssignment.departmentId;
    return dept && typeof dept === "object" ? (dept as any)._id : dept;
  }, [selectedGrievanceForAssignment]);

  const grievanceAssignmentCurrentSubDepartmentId = useMemo(() => {
    if (!selectedGrievanceForAssignment) return null;
    if (selectedGrievanceForAssignment.status === "REVERTED") {
      const revertEntry = selectedGrievanceForAssignment.timeline
        ?.filter((t: any) => t.action === "REVERTED_TO_COMPANY_ADMIN")
        .sort(
          (a: any, b: any) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )[0];
      if (revertEntry?.details?.suggestedSubDepartmentId) {
        return revertEntry.details.suggestedSubDepartmentId;
      }
    }
    if (selectedGrievanceForAssignment.status === "RESOLVED") {
      const resolveEntry = selectedGrievanceForAssignment.timeline
        ?.filter(
          (t: any) =>
            t.action === "STATUS_UPDATED" &&
            t.details?.newStatus === "RESOLVED",
        )
        .sort(
          (a: any, b: any) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )[0];
      if (resolveEntry?.details?.subDepartmentId) {
        return resolveEntry.details.subDepartmentId;
      }
    }
    const subDept = selectedGrievanceForAssignment.subDepartmentId;
    return subDept && typeof subDept === "object"
      ? (subDept as any)._id
      : subDept;
  }, [selectedGrievanceForAssignment]);

  const grievanceAssignmentSuggestedDepartmentId = useMemo(() => {
    if (!selectedGrievanceForAssignment || selectedGrievanceForAssignment.status !== "REVERTED") return null;
    const revertEntry = selectedGrievanceForAssignment.timeline
      ?.filter((t: any) => t.action === "REVERTED_TO_COMPANY_ADMIN")
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    return revertEntry?.details?.suggestedDepartmentId || null;
  }, [selectedGrievanceForAssignment]);

  const grievanceAssignmentSuggestedSubDepartmentId = useMemo(() => {
    if (!selectedGrievanceForAssignment || selectedGrievanceForAssignment.status !== "REVERTED") return null;
    const revertEntry = selectedGrievanceForAssignment.timeline
      ?.filter((t: any) => t.action === "REVERTED_TO_COMPANY_ADMIN")
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    return revertEntry?.details?.suggestedSubDepartmentId || null;
  }, [selectedGrievanceForAssignment]);

  // Bulk delete handlers
  const handleBulkDeleteGrievances = async () => {
    if (selectedGrievances.size === 0) return;

    if (
      !confirm(
        `Are you sure you want to delete ${selectedGrievances.size} grievance(s)? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await grievanceAPI.deleteBulk(
        Array.from(selectedGrievances),
      );
      if (response.success) {
        toast.success(response.message);
        const deletedIds = Array.from(selectedGrievances);
        setGrievances((prev) =>
          prev.filter((g) => !deletedIds.includes(g._id)),
        );
        setSelectedGrievances(new Set());
        fetchGrievances(grievancePage, true);
        fetchDashboardData(true);
      } else {
        toast.error(response.message || "Failed to delete grievances");
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          error?.message ||
          "Failed to delete grievances",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteGrievance = async (grievance: Grievance) => {
    if (!canDeleteGrievance) return;

    if (
      !confirm(
        `Are you sure you want to delete grievance ${grievance.grievanceId}? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await grievanceAPI.delete(grievance._id);
      if (response.success) {
        toast.success(response.message || "Grievance deleted successfully");
        setGrievances((prev) => prev.filter((item) => item._id !== grievance._id));
        setSelectedGrievance((prev) =>
          prev?._id === grievance._id ? null : prev,
        );
        setSelectedGrievances((prev) => {
          const next = new Set(prev);
          next.delete(grievance._id);
          return next;
        });
        fetchGrievances(grievancePage, true);
        fetchDashboardData(true);
      } else {
        toast.error(response.message || "Failed to delete grievance");
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          error?.message ||
          "Failed to delete grievance",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDeleteAppointments = async () => {
    if (selectedAppointments.size === 0) return;

    if (
      !confirm(
        `Are you sure you want to delete ${selectedAppointments.size} appointment(s)? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await appointmentAPI.deleteBulk(
        Array.from(selectedAppointments),
      );
      if (response.success) {
        toast.success(response.message);
        const deletedIds = Array.from(selectedAppointments);
        setAppointments((prev) =>
          prev.filter((a) => !deletedIds.includes(a._id)),
        );
        setSelectedAppointments(new Set());
        fetchAppointments(appointmentPage, true);
        fetchDashboardData(true);
      } else {
        toast.error("Failed to delete appointments");
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          error?.message ||
          "Failed to delete appointments",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDeleteUsers = async () => {
    if (selectedUsers.size === 0) return;

    if (
      !confirm(
        `Are you sure you want to delete ${selectedUsers.size} user(s)? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await userAPI.deleteBulk(Array.from(selectedUsers));
      if (response.success) {
        toast.success(response.message);
        const deletedIds = Array.from(selectedUsers);
        setUsers((prev) => prev.filter((u) => !deletedIds.includes(u._id)));
        setSelectedUsers(new Set());
        fetchUsers(userPage, true);
        fetchDashboardData(true);
      } else {
        toast.error("Failed to delete users");
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          error?.message ||
          "Failed to delete users",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDeleteDepartments = async () => {
    if (selectedDepartments.size === 0) return;

    if (
      !confirm(
        `Are you sure you want to delete ${selectedDepartments.size} department(s)? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await departmentAPI.deleteBulk(
        Array.from(selectedDepartments),
      );
      if (response.success) {
        toast.success(response.message);
        const deletedIds = Array.from(selectedDepartments);
        setDepartments((prev) =>
          prev.filter((d) => !deletedIds.includes(d._id)),
        );
        setSelectedDepartments(new Set());
        fetchDepartments(departmentPage, true);
        fetchDashboardData(true);
      } else {
        toast.error("Failed to delete departments");
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          error?.message ||
          "Failed to delete departments",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // Appointments Filters
  const [appointmentFilters, setAppointmentFilters] = useState({
    status: "",
    department: "",
    assignmentStatus: "",
    dateFilter: "",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [user, loading, router]);

  // Redirect away from overview if no analytics permission
  useEffect(() => {
    if (
      user &&
      !hasPermission(user, Permission.VIEW_ANALYTICS) &&
      !isSuperAdminUser &&
      activeTab === "overview"
    ) {
      const nextTab = hasPermission(user, Permission.READ_GRIEVANCE)
        ? "grievances"
        : hasPermission(user, Permission.READ_APPOINTMENT)
          ? "appointments"
          : "profile";
      setActiveTab(nextTab);
    }
  }, [user, activeTab, isSuperAdminUser]);

  useEffect(() => {
    if (!user || activeTab !== "appointments") return;

    if (!canShowAppointmentsInView) {
      const fallbackTab = hasPermission(user, Permission.READ_GRIEVANCE)
        ? "grievances"
        : hasPermission(user, Permission.VIEW_ANALYTICS) || isSuperAdminUser
          ? "overview"
          : "profile";
      setActiveTab(fallbackTab);
    }
  }, [activeTab, canShowAppointmentsInView, isSuperAdminUser, user]);

  // Handle browser back/forward navigation persistence
  useEffect(() => {
    // Skip if in SuperAdmin overview mode to avoid conflicts with SuperAdminOverview's own state
    if (isSuperAdminUser && !drilldownId) return;

    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isSuperAdminUser, drilldownId]);

  // Sync tab state to URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const currentUrlTab = params.get("tab");

    if (activeTab && activeTab !== "overview" && currentUrlTab !== activeTab) {
      params.set("tab", activeTab);
      router.replace(`${window.location.pathname}?${params.toString()}`, {
        scroll: false,
      });
    } else if (activeTab === "overview" && currentUrlTab) {
      params.delete("tab");
      router.replace(`${window.location.pathname}?${params.toString()}`, {
        scroll: false,
      });
    }
  }, [activeTab, router, searchParams, isSuperAdminUser, drilldownId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Track previous counts for real-time notifications
  const [prevGrievanceCount, setPrevGrievanceCount] = useState<number | null>(
    null,
  );
  const [prevAppointmentCount, setPrevAppointmentCount] = useState<
    number | null
  >(null);

  const fetchPerformanceData = useCallback(async () => {
    if (isSuperAdminUser && !drilldownId) return;
    try {
      const response = await apiClient.get(
        `/analytics/performance${drilldownId ? "?companyId=" + drilldownId : ""}`,
      );
      if (response.success) {
        setPerformanceData(response.data);
      }
    } catch (error: any) {
      if (error?.response?.status !== 403) {
        console.error("Failed to fetch performance data:", error);
      }
    }
  }, [drilldownId, isSuperAdminUser]);

  const filteredDeptCounts = useMemo(() => {
    let filtered = allDepartments;
    if (deptSearch) {
      const s = deptSearch.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.name.toLowerCase().includes(s) ||
          d.departmentId?.toLowerCase().includes(s),
      );
    }
    if (deptFilters.status) {
      const isActive = deptFilters.status === "active";
      filtered = filtered.filter((d) => d.isActive === isActive);
    }
    if (deptFilters.mainDeptId) {
      filtered = filtered.filter(
        (d) =>
          d._id === deptFilters.mainDeptId ||
          getParentDepartmentId(d) === deptFilters.mainDeptId,
      );
    }
    if (deptFilters.subDeptId) {
      filtered = filtered.filter((d) => d._id === deptFilters.subDeptId);
    }
    const mainCount = filtered.filter((d) => !d.parentDepartmentId).length;
    const subCount = filtered.filter((d) => !!d.parentDepartmentId).length;
    return { mainCount, subCount };
  }, [allDepartments, deptSearch, deptFilters, getParentDepartmentId]);

  const fetchDepartmentData = useCallback(async () => {
    if (isSuperAdminUser && !drilldownId) return;
    try {
      // Fetch all departments the user has access to, ignoring global analytics filters 
      // to allow independent filtering within the chart section.
      const deptId =
        isSubDepartmentAdminRole || isOperatorRole
          ? assignedDepartmentIds[0] || ""
          : ""; // Fetch all for company admin/super admin
      
      const params = new URLSearchParams();
      if (drilldownId) params.append("companyId", drilldownId);
      if (deptId) params.append("departmentId", deptId);

      const response = await apiClient.get(
        `/analytics/grievances/by-department?${params.toString()}`,
      );
      if (response.success) {
        setDepartmentData(response.data);
      }
    } catch (error: any) {
      console.error("Failed to fetch department data:", error);
    }
  }, [
    drilldownId,
    isSuperAdminUser,
    assignedDepartmentIds,
    isSubDepartmentAdminRole,
    isOperatorRole,
  ]);

  const fetchRoles = useCallback(async () => {
    const cid = targetCompanyId;
    if (!cid) {
      setRoles([]);
      return;
    }
    try {
      // First try fetching ONLY company-specific roles
      let response = await roleAPI.getRoles(cid, true);
      let roles = response.data.roles || [];

      // If no company roles exist (new company), fallback to all roles including system ones
      if (roles.length === 0) {
        response = await roleAPI.getRoles(cid, false);
        roles = response.data.roles || [];
      }

      if (response.success) {
        setRoles(roles);
      }
    } catch (error) {
      console.error("Failed to fetch roles:", error);
    }
  }, [targetCompanyId]);

  
  const fetchDashboardData = useCallback(
    async (
      refresh = false,
      overrideFilters?: { mainDeptId?: string; subDeptId?: string },
    ) => {
      if (isSuperAdminUser && !drilldownId) return;
      
      // If we are in the relevant tab, use the hook's refetch for consistency
      if (activeTab === "overview" || activeTab === "analytics") {
        await refetchDashboardStats();
        return;
      }

      try {

        const currentFilters =
          overrideFilters ||
          (activeTab === "analytics" ? analyticsFilters : overviewFilters);
        const deptId =
          isSubDepartmentAdminRole || isOperatorRole
            ? assignedDepartmentIds[0] || ""
            : currentFilters?.subDeptId || currentFilters?.mainDeptId || "";

        const params = new URLSearchParams();
        if (drilldownId) params.append("companyId", drilldownId);
        if (deptId) params.append("departmentId", deptId);
        const cacheKey = `${drilldownId || currentUserCompanyId || "self"}::${deptId || "all"}`;

        if (!refresh) {
          const cachedStats = dashboardStatsCacheRef.current.get(cacheKey);
          if (cachedStats) {
            setStats(cachedStats);
            setLoadingStats(false);
            return;
          }
          setLoadingStats(true);
        }

        const response = await apiClient.get<{
          success: boolean;
          data: DashboardStats;
        }>(`/analytics/dashboard?${params.toString()}`);

        if (response.success) {
          dashboardStatsCacheRef.current.set(cacheKey, response.data);
          setStats(response.data);
        }
      } catch (error: any) {
        if (error?.response?.status !== 403) {
          console.error("Failed to fetch dashboard stats:", error);
          toast.error("Failed to load dashboard statistics");
        }
      } finally {
        if (!refresh) setLoadingStats(false);
      }
    },
    [
      drilldownId,
      isSuperAdminUser,
      activeTab,
      analyticsFilters,
      overviewFilters,
      assignedDepartmentIds,
      isSubDepartmentAdminRole,
      isOperatorRole,
      currentUserCompanyId,
      refetchDashboardStats,
    ],
  );

  const fetchCompany = useCallback(async () => {
    if (!user) return;

    if (isSuperAdminUser && drilldownId) {
      try {
        const response = await companyAPI.getById(drilldownId);
        if (response.success) {
          setCompany(response.data.company);
        }
      } catch (error: any) {
        console.log("Company details not available:", error.message);
      }
      return;
    }

    if (user.isSuperAdmin) return;

    try {
      const response = await companyAPI.getMyCompany();
      if (response.success) {
        setCompany(response.data.company);
      }
    } catch (error: any) {
      // CompanyAdmin might not have company associated
      console.log("Company details not available:", error.message);
    }
  }, [user, isSuperAdminUser, drilldownId]);

  const fetchDepartments = useCallback(
    async (page = departmentPage, isSilent = false) => {
      if (isSuperAdminUser && !drilldownId) return;
      if (!isSilent) setLoadingDepartments(true);
      
      if (activeTab === "departments") {
        await refetchDepartmentsHook();
        if (!isSilent) setLoadingDepartments(false);
        return;
      }

      try {
        // For company admin, fetch ALL departments (no pagination limit)
        const fetchLimit =
          isCompanyLevel || (isSuperAdminUser && drilldownId)
            ? 200
            : departmentPagination.limit;
        const response = await departmentAPI.getAll({
          page: page,
          limit: departmentPagination.limit,
          search: (deptSearch || "").trim(),
          type: deptFilters.type || undefined,
          status: deptFilters.status || undefined,
          mainDeptId: deptFilters.mainDeptId || undefined,
          subDeptId: deptFilters.subDeptId || undefined,
          companyId:
            isSuperAdminUser && drilldownId ? drilldownId : undefined,
        });
        if (response.success) {
          let filteredDepartments = response.data.departments;

          // For scoped roles, show only mapped departments and child sub-departments.
          if (
            isDepartmentLevel &&
            (user?.departmentId ||
              (user?.departmentIds && user.departmentIds.length > 0))
          ) {
            const mappedIds = new Set<string>();
            const pushId = (value: any) => {
              if (!value) return;
              const normalized =
                typeof value === "object" && value !== null
                  ? value._id || value.toString?.()
                  : value;
              if (normalized) mappedIds.add(String(normalized));
            };
            pushId(user.departmentId);
            (user.departmentIds || []).forEach((d: any) => pushId(d));

            filteredDepartments = filteredDepartments.filter(
              (dept: Department) => {
                const deptId = String(dept._id);
                const parentId = getParentDepartmentId(dept);
                return (
                  mappedIds.has(deptId) ||
                  (parentId ? mappedIds.has(String(parentId)) : false)
                );
              },
            );
          }

          setDepartments(filteredDepartments);
          setDepartmentPagination((prev) => ({
            ...prev,
            total: response.data.pagination.total,
            pages: response.data.pagination.pages,
          }));

          // Set user counts from enriched data
          const counts: Record<string, number> = {};
          filteredDepartments.forEach((dept: any) => {
            counts[dept._id] = dept.userCount || 0;
          });
          setDeptUserCounts(counts);
        }
      } catch (error: any) {
        console.error("Failed to fetch departments:", error);
        toast.error("Failed to load departments");
      } finally {
        if (!isSilent) setLoadingDepartments(false);
      }
    },
    [
      departmentPage,
      departmentPagination.limit,
      deptSearch,
      deptFilters,
      isSuperAdminUser,
      isCompanyLevel,
      isDepartmentLevel,
      user,
      drilldownId,
      getParentDepartmentId,
      activeTab,
      refetchDepartmentsHook,
    ],
  );

  const fetchAllDepartments = useCallback(async () => {
    if (isSuperAdminUser && !drilldownId) return;
    try {
      const response = await departmentAPI.getAll({
        listAll: true,

        page: 1,
        limit: 200,
        companyId:
          isSuperAdminUser && drilldownId ? drilldownId : undefined,
      });
      if (response.success) {
        setAllDepartments(response.data.departments);
      }
    } catch (error) {
      console.error("Failed to fetch all departments:", error);
    }
  }, [isSuperAdminUser, drilldownId]);

  const handleSaveDepartmentPriority = useCallback(
    async (dept: Department) => {
      if (!canManageDepartmentPriority) {
        toast.error("Only Company Admin can update department priority");
        return;
      }
      if (dept.parentDepartmentId) {
        toast.error("Priority can only be updated for main departments");
        return;
      }
      const rawValue = priorityDrafts[dept._id] ?? String(dept.displayOrder ?? 999);
      const parsed = Number(rawValue);

      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error("Priority must be a non-negative number");
        return;
      }

      const nextValue = Math.floor(parsed);
      const currentValue =
        typeof dept.displayOrder === "number" ? dept.displayOrder : 999;

      if (nextValue === currentValue) {
        toast("Priority already set");
        return;
      }

      setSavingPriorityIds((prev) => new Set(prev).add(dept._id));
      try {
        const response = await departmentAPI.update(dept._id, {
          displayOrder: nextValue,
        });
        if (response.success) {
          toast.success(`Priority updated for ${dept.name}`);
          setPriorityDrafts((prev) => ({
            ...prev,
            [dept._id]: String(nextValue),
          }));
          fetchDepartments(departmentPage, true);
          fetchAllDepartments();
        } else {
          toast.error("Failed to update priority");
        }
      } catch (error: any) {
        toast.error(error?.message || "Failed to update priority");
      } finally {
        setSavingPriorityIds((prev) => {
          const next = new Set(prev);
          next.delete(dept._id);
          return next;
        });
      }
    },
    [
      canManageDepartmentPriority,
      priorityDrafts,
      fetchDepartments,
      departmentPage,
      fetchAllDepartments,
    ],
  );

  const handleToggleDepartmentPriorityColumn = useCallback(
    async (checked: boolean) => {
      if (!isSuperAdminDrilldown || !drilldownId) {
        toast.error("Only superadmin can change priority column visibility");
        return;
      }

      try {
        const response = await companyAPI.update(drilldownId, {
          showDepartmentPriorityColumn: checked,
        });

        if (!response.success) {
          toast.error("Failed to update priority column visibility");
          return;
        }

        setCompany((prev) =>
          prev
            ? {
                ...prev,
                showDepartmentPriorityColumn: checked,
              }
            : prev,
        );
        toast.success(
          checked
            ? "Priority column enabled for company admin"
            : "Priority column hidden from company admin",
        );
      } catch (error: any) {
        toast.error(
          error?.response?.data?.message ||
            error?.message ||
            "Failed to update priority column visibility",
        );
      }
    },
    [drilldownId, isSuperAdminDrilldown],
  );

  const fetchUsers = useCallback(
    async (page = userPage, isSilent = false) => {
      if (isSuperAdminUser && !drilldownId) return;
      if (!isSilent) setLoadingUsers(true);

      if (activeTab === "users") {
        await refetchUsersHook();
        if (!isSilent) setLoadingUsers(false);
        return;
      }

      try {
        const selectedDepartmentId =
          isSubDepartmentAdminRole || isOperatorRole
            ? assignedDepartmentIds.join(",") || undefined
            : userFilters.subDeptId
              ? userFilters.subDeptId
              : userFilters.mainDeptId
                ? [
                    userFilters.mainDeptId,
                    ...allDepartmentsRef.current
                      .filter(
                        (d) =>
                          getParentDepartmentId(d) === userFilters.mainDeptId,
                      )
                      .map((d) => d._id),
                  ].join(",")
                : undefined;

        // If it's a custom role ID, pass the ID directly.
        // Backend now handles both system role strings and customRoleId ObjectIds.
        const serverRoleFilter = userFilters.role.startsWith("CUSTOM:")
          ? userFilters.role.split(":")[1]
          : userFilters.role || undefined;

        const response = await userAPI.getAll({
          page,
          limit: userPagination.limit,
          search: (userSearch || "").trim(),
          role: serverRoleFilter,
          status: (userFilters.status as "active" | "inactive") || undefined,
          departmentId: selectedDepartmentId,
          companyId:
            isSuperAdminUser && drilldownId ? drilldownId : undefined,
          sortBy: sortConfig.tab === "users" ? sortConfig.key : undefined,
          sortOrder: sortConfig.tab === "users" ? (sortConfig.direction || undefined) : undefined,
        });
        if (response.success) {
          setUsers(response.data.users);
          setUserPagination((prev) => ({
            ...prev,
            total: response.data.pagination.total,
            pages: response.data.pagination.pages,
          }));
        }
      } catch (error: any) {
        console.error("Failed to fetch users:", error);
        toast.error("Failed to load users");
      } finally {
        if (!isSilent) setLoadingUsers(false);
      }
    },
    [
      userPage,
      userPagination.limit,
      userSearch,
      userFilters,
      getParentDepartmentId,
      assignedDepartmentIds,
      isSubDepartmentAdminRole,
      isOperatorRole,
      isSuperAdminUser,
      drilldownId,
      activeTab,
      sortConfig.direction,
      sortConfig.key,
      sortConfig.tab,
      refetchUsersHook,
    ],
  );

  const fetchGrievances = useCallback(
    async (page = grievancePage, isSilent = false) => {
      if (isSuperAdminUser && !drilldownId) return;
      if (
        !hasModule(Module.GRIEVANCE) ||
        !hasPermission(user, Permission.READ_GRIEVANCE)
      ) {
        return;
      }

      if (activeTab === "grievances") {
        await refetchGrievances();
        return;
      }
      if (!isSilent) setLoadingGrievances(true);

      try {
        const response = await grievanceAPI.getAll({
          page,
          limit: grievancePagination.limit,
          status: grievanceFilters.status || undefined,
          search: (grievanceSearch || "").trim(),
          departmentId: (isSubDepartmentAdminRole || isOperatorRole) 
            ? (assignedDepartmentIds[0] || undefined) 
            : (grievanceFilters.department || undefined),
          mainDeptId: grievanceFilters.mainDeptId || undefined,
          subDeptId: grievanceFilters.subDeptId || undefined,
          assignedTo:
            grievanceFilters.assignmentStatus === "assigned"
              ? "ANY"
              : grievanceFilters.assignmentStatus === "unassigned"
                ? "NONE"
                : undefined,
          companyId:
            isSuperAdminUser && drilldownId ? drilldownId : undefined,
        });
        if (response.success) {
          setGrievances(response.data.grievances);
          setGrievancePagination((prev) => ({
            ...prev,
            total: response.data.pagination.total,
            pages: response.data.pagination.pages,
          }));

          // If a grievance is currently being viewed, update its state with the fresh data
          if (selectedGrievance) {
            const updated = response.data.grievances.find(
              (g: Grievance) => g._id === selectedGrievance._id
            );
            if (updated) {
              setSelectedGrievance(updated);
            }
          }
        }
      } catch (error: any) {
        if (error.response?.status !== 403) {
          console.error("Failed to fetch grievances:", error);
          toast.error("Failed to load grievances");
        }
      } finally {
        if (!isSilent) setLoadingGrievances(false);
      }
    },
    [
      grievancePage,
      grievancePagination.limit,
      user,
      hasModule,
      grievanceFilters,
      grievanceSearch,
      assignedDepartmentIds,
      isSubDepartmentAdminRole,
      isOperatorRole,
      isSuperAdminUser,
      drilldownId,
      activeTab,
      refetchGrievances,
      selectedGrievance,
    ],
  );

  const fetchAppointments = useCallback(
    async (page = appointmentPage, isSilent = false) => {
      if (isSuperAdminUser && !drilldownId) return;
      if (!canShowAppointmentsInView) {
        return;
      }

      if (!isSilent) setLoadingAppointments(true);
      try {
        const response = await appointmentAPI.getAll({
          page,
          limit: appointmentPagination.limit,
          search: (appointmentSearch || "").trim(),
          companyId:
            isSuperAdminUser && drilldownId ? drilldownId : undefined,
        });
        if (response.success) {
          setAppointments(response.data.appointments);
          setAppointmentPagination((prev) => ({
            ...prev,
            total: response.data.pagination.total,
            pages: response.data.pagination.pages,
          }));
        }
      } catch (error: any) {
        if (error.response?.status !== 403) {
          console.error("Failed to fetch appointments:", error);
          toast.error("Failed to load appointments");
        }
      } finally {
        if (!isSilent) setLoadingAppointments(false);
      }
    },
    [
      appointmentPage,
      appointmentPagination.limit,
      appointmentSearch,
      canShowAppointmentsInView,
      isSuperAdminUser,
      drilldownId,
    ],
  );

  const fetchLeads = useCallback(async () => {
    if (!targetCompanyId) return;
    setLoadingLeads(true);
    try {
      const response = await leadAPI.getAll({ companyId: targetCompanyId });
      if (response.success) {
        setLeads(response.data);
      }
    } catch (error: any) {
      if (error.response?.status !== 403) {
        console.error("Failed to fetch leads:", error);
        toast.error("Failed to load leads");
      }
    } finally {
      setLoadingLeads(false);
    }
  }, [targetCompanyId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (activeTab === "overview") {
        await fetchDashboardData();
      } else if (activeTab === "analytics") {
        await Promise.all([fetchDashboardData()]);
      } else if (activeTab === "grievances") {
        await fetchGrievances(grievancePage);
      } else if (activeTab === "appointments") {
        await fetchAppointments(appointmentPage);
      } else if (activeTab === "departments") {
        await fetchDepartments();
      } else if (activeTab === "users") {
        await fetchUsers(userPage);
      } else if (activeTab === "leads") {
        await fetchLeads();
      }
      toast.success("Data refreshed");
    } catch (error) {
      toast.error("Failed to refresh data");
    } finally {
      setRefreshing(false);
    }
  }, [
    activeTab,
    fetchDashboardData,
    fetchGrievances,
    grievancePage,
    fetchAppointments,
    appointmentPage,
    fetchDepartments,
    fetchUsers,
    userPage,
    fetchLeads,
  ]);

  // 🚀 Performance Optimization: Unified Initial Data Fetch
  useEffect(() => {
    if (!mounted || !user) return;
    if (isSuperAdminUser && !drilldownId) return;

    void Promise.all([fetchCompany(), fetchRoles(), fetchAllDepartments()]);
  }, [
    mounted,
    user,
    drilldownId,
    fetchCompany,
    fetchRoles,
    fetchAllDepartments,
    isSuperAdminUser,
  ]);

  useEffect(() => {
    if (!mounted || !user) return;
    if (isSuperAdminUser && !drilldownId) return;
    if (activeTab !== "overview" && activeTab !== "analytics") return;
    if (stats) return;

    // fetchDashboardData(); // Replaced by useDashboardStats hook
  }, [
    activeTab,
    mounted,
    user,
    stats,
    fetchDashboardData,
    isSuperAdminUser,
    drilldownId,
  ]);

  // 2. Specialized effects for each paginated module (Gated by activeTab for SPA performance)
  useEffect(() => {
    if (isSuperAdminUser && !drilldownId) return;

    if (activeTab === "analytics" && mounted && user) {
      fetchPerformanceData();
      fetchDepartmentData();
    }
  }, [
    activeTab,
    mounted,
    user,
    fetchPerformanceData,
    fetchDepartmentData,
    isSuperAdminUser,
    drilldownId,
    analyticsFilters,
  ]);

  useEffect(() => {
    if (isSuperAdminUser && !drilldownId) return;

    const shouldFetch =
      activeTab === "departments" ||
      (activeTab === "overview" && isDepartmentLevel);
    if (
      shouldFetch &&
      mounted &&
      user &&
      (isSuperAdminUser ||
        hasPermission(user, Permission.READ_DEPARTMENT) ||
        isDepartmentLevel)
    ) {
      // fetchDepartments(departmentPage); // Replaced by useDepartments hook
    }
  }, [
    activeTab,
    mounted,
    user,
    departmentPage,
    departmentPagination.limit,
    fetchDepartments,
    isSuperAdminUser,
    isDepartmentLevel,
    drilldownId,
    deptFilters,
    deptSearch,
  ]);

  useEffect(() => {
    if (isSuperAdminUser && !drilldownId) return;

    if (
      activeTab === "users" &&
      mounted &&
      user &&
      (isSuperAdminUser || hasPermission(user, Permission.READ_USER))
    ) {
      // fetchUsers(userPage); // Replaced by useUsers hook
    }
  }, [
    activeTab,
    mounted,
    user,
    userPage,
    fetchUsers,
    isSuperAdminUser,
    drilldownId,
    userFilters,
    userSearch,
  ]);

  // Redundant now that useGrievances hook handles this automatically with caching
  /*
  useEffect(() => {
    if (isSuperAdminUser && !drilldownId) return;

    if (
      activeTab === "grievances" &&
      mounted &&
      user &&
      (isSuperAdminUser ||
        (hasModule(Module.GRIEVANCE) &&
          hasPermission(user, Permission.READ_GRIEVANCE)))
    ) {
      fetchGrievances(grievancePage);
    }
  }, [
    activeTab,
    mounted,
    user,
    grievancePage,
    fetchGrievances,
    hasModule,
    isSuperAdminUser,
    drilldownId,
    grievanceFilters,
    grievanceSearch,
  ]);
  */

  useEffect(() => {
    if (isSuperAdminUser && !drilldownId) return;

    if (
      activeTab === "appointments" &&
      mounted &&
      user &&
      canShowAppointmentsInView
    ) {
      fetchAppointments(appointmentPage);
    }
  }, [
    activeTab,
    mounted,
    user,
    appointmentPage,
    canShowAppointmentsInView,
    fetchAppointments,
    drilldownId,
    isSuperAdminUser,
  ]);

  useEffect(() => {
    if (isSuperAdminUser && !drilldownId) return;

    if (
      activeTab === "leads" &&
      mounted &&
      user &&
      hasModule(Module.LEAD_CAPTURE)
    ) {
      fetchLeads();
    }
  }, [
    activeTab,
    mounted,
    user,
    fetchLeads,
    hasModule,
    isSuperAdminUser,
    drilldownId,
  ]);

  // 3. Global Synchronization Listener
  useEffect(() => {
    const handleGlobalRefresh = (e?: any) => {
      const scope = e?.detail?.scope;

      const isAll = !scope || scope === "ALL";
      const scopes = Array.isArray(scope) ? scope : [scope];

      if (isAll || scopes.includes("DASHBOARD")) fetchDashboardData(true);
      if (isAll || scopes.includes("GRIEVANCES"))
        fetchGrievances(grievancePage, true);
      if (isAll || scopes.includes("APPOINTMENTS"))
        fetchAppointments(appointmentPage, true);
      if (isAll || scopes.includes("DEPARTMENTS")) {
        fetchDepartments(departmentPage, true);
        fetchAllDepartments(); // Update hierarchy data
      }
      if (isAll || scopes.includes("USERS")) fetchUsers(userPage, true);
      if (isAll || scopes.includes("LEADS")) {
        if (isSuperAdminUser || hasModule(Module.LEAD_CAPTURE)) {
          fetchLeads();
        }
      }
    };

    window.addEventListener("REFRESH_PORTAL_DATA", handleGlobalRefresh);
    return () =>
      window.removeEventListener("REFRESH_PORTAL_DATA", handleGlobalRefresh);
  }, [
    fetchDashboardData,
    fetchGrievances,
    grievancePage,
    fetchAppointments,
    appointmentPage,
    fetchDepartments,
    departmentPage,
    fetchAllDepartments,
    fetchUsers,
    userPage,
    fetchLeads,
    isSuperAdminUser,
    hasModule,
  ]);


  // 3. Polling isolated from initial load triggers
  useEffect(() => {
    // Skip polling if in SuperAdmin overview mode
    if (isSuperAdminUser && !drilldownId) return;

    if (mounted && user) {
      const pollInterval = setInterval(async () => {
        // 🛡️ Guard against execution after unmount
        if (!mounted) return;

        try {
          // Perform silent, background refreshes of the current active views
          if (
            isSuperAdminUser ||
            (hasModule(Module.GRIEVANCE) &&
              hasPermission(user, Permission.READ_GRIEVANCE))
          ) {
            fetchGrievances(grievancePage, true);
          }

          if (canShowAppointmentsInView) {
            fetchAppointments(appointmentPage, true);
          }

          // Also keep KPI stats fresh
          fetchDashboardData(true);
        } catch (error: any) {
          // 🤫 Background polling errors should be silent
          if (
            error.code === "ERR_NETWORK" ||
            error.message === "Network Error"
          ) {
            return;
          }
          console.error("High-sync polling error:", error);
        }
      }, 15000); // 15 seconds for a near-instant feel without overloading the server

      return () => clearInterval(pollInterval);
    }
  }, [
    mounted,
    user,
    grievancePage,
    appointmentPage,
    canShowAppointmentsInView,
    fetchGrievances,
    fetchAppointments,
    fetchDashboardData,
    hasModule,
    drilldownId,
    isSuperAdminUser,
  ]);



  const handleSort = (key: string, tab: string) => {
    let direction: "asc" | "desc" | null = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    } else if (sortConfig.key === key && sortConfig.direction === "desc") {
      direction = null;
    }
    setSortConfig({ key, direction, tab });
    
    // Reset page when sorting changes
    if (tab === "users") setUserPage(1);
    if (tab === "departments") setDepartmentPage(1);
    if (tab === "grievances") setGrievancePage(1);
  };

  const getSortedData = (data: any[], tab: string) => {
    let filteredData = data;

    // ⚡ PERFORMANCE OPTIMIZATION: For Users, Departments, and Grievances, the backend now handles ALL filtering and sorting.
    // Client-side processing is redundant and slow. We bypass it here.
    // For users and departments, the backend handles filtering.
    // For grievances, we allow local filtering to catch any pending state updates or complex logic.
    if (tab === "users" || tab === "departments") {
      return data;
    }

    // For lower level users (Operators, Sub-Department etc.), only show items assigned to them
    if (user && !isDepartmentAdminOrHigher(user) && user.id) {
      if (tab === "grievances" || tab === "appointments") {
        filteredData = data.filter((item) => {
          const assignedToId = item.assignedTo?._id || item.assignedTo;
          return assignedToId === user.id;
        });
      }
    }

    // Apply grievance filters
    if (tab === "grievances") {
      // Status filter
      if (grievanceFilters.status && grievanceFilters.status !== "ALL") {
        if (grievanceFilters.status.includes(",")) {
          const statusList = grievanceFilters.status
            .toUpperCase()
            .split(",")
            .map((s) => s.trim());
          filteredData = filteredData.filter((g: Grievance) =>
            statusList.includes(g.status?.toUpperCase()),
          );
        } else {
          filteredData = filteredData.filter(
            (g: Grievance) =>
              g.status?.toUpperCase() === grievanceFilters.status.toUpperCase(),
          );
        }
      }
      // Department filter
      if (grievanceFilters.department) {
        filteredData = filteredData.filter((g: Grievance) => {
          const deptId =
            typeof g.departmentId === "object" && g.departmentId
              ? (g.departmentId as any)._id
              : g.departmentId;
          return deptId === grievanceFilters.department;
        });
      }
      // Main Department filter
      if (grievanceFilters.mainDeptId) {
        filteredData = filteredData.filter((g: Grievance) => {
          const deptId =
            typeof g.departmentId === "object" && g.departmentId
              ? (g.departmentId as any)._id
              : g.departmentId;
          const subDeptId =
            typeof g.subDepartmentId === "object" && g.subDepartmentId
              ? (g.subDepartmentId as any)._id
              : g.subDepartmentId;

          // Show if main department matches OR if it belongs to a sub-department of the selected main
          const dept = allDepartments.find((d) => d._id === deptId);
          return (
            deptId === grievanceFilters.mainDeptId ||
            getParentDepartmentId(dept) === grievanceFilters.mainDeptId
          );
        });
      }
      // Sub Department filter
      if (grievanceFilters.subDeptId) {
        filteredData = filteredData.filter((g: Grievance) => {
          const subDeptId =
            typeof g.subDepartmentId === "object" && g.subDepartmentId
              ? (g.subDepartmentId as any)._id
              : g.subDepartmentId;
          return subDeptId === grievanceFilters.subDeptId;
        });
      }
      // Assignment status filter
      if (grievanceFilters.assignmentStatus) {
        if (grievanceFilters.assignmentStatus === "assigned") {
          filteredData = filteredData.filter((g: Grievance) => g.assignedTo);
        } else if (grievanceFilters.assignmentStatus === "unassigned") {
          filteredData = filteredData.filter((g: Grievance) => !g.assignedTo);
        }
      }
      // Overdue Status Filter
      if (grievanceFilters.slaStatus) {
        const now = new Date();
        filteredData = filteredData.filter((g: Grievance) => {
          const createdDate = new Date(g.createdAt);
          const slaLimit = g.slaHours || 120;
          let isOverdue = (now.getTime() - createdDate.getTime()) > (slaLimit * 60 * 60 * 1000);

          if (
            g.status === "RESOLVED" ||
            g.status === "CLOSED" ||
            g.status === "REJECTED"
          ) {
            isOverdue = false;
          }

          if (grievanceFilters.slaStatus === "COMPLETED") {
            return g.status === "RESOLVED" || g.status === "REJECTED";
          }
          return grievanceFilters.slaStatus === "OVERDUE"
            ? isOverdue
            : !isOverdue;
        });
      }
      // Date range filter
      if (grievanceFilters.dateRange) {
        const now = new Date();
        filteredData = filteredData.filter((g: Grievance) => {
          const createdAt = new Date(g.createdAt);
          const daysDiff =
            (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
          switch (grievanceFilters.dateRange) {
            case "today":
              return daysDiff < 1;
            case "week":
              return daysDiff <= 7;
            case "month":
              return daysDiff <= 30;
            default:
              return true;
          }
        });
      }
      // Search filter - Instant, case-insensitive, whitespace-resilient
      if (grievanceSearch.trim()) {
        const searchTerms = grievanceSearch
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        filteredData = filteredData.filter((g: Grievance) => {
          const searchContent = [
            g.grievanceId,
            g.citizenName,
            g.citizenPhone,
            g.category,
            g.description,
            typeof g.assignedTo === "object"
              ? `${(g.assignedTo as any).firstName} ${(g.assignedTo as any).lastName}`
              : g.assignedTo,
            typeof g.assignedTo === "object" ? (g.assignedTo as any).email : "",
          ]
            .join(" ")
            .toLowerCase();

          return searchTerms.every((term) => searchContent.includes(term));
        });
      }
    }

    // Apply appointment filters
    if (tab === "appointments") {
      // Status filter
      if (appointmentFilters.status) {
        filteredData = filteredData.filter(
          (a: Appointment) =>
            a.status?.toUpperCase() === appointmentFilters.status.toUpperCase(),
        );
      }
      // Department filter - Removed (Appointments are CEO-only, no departments)
      // Assignment status filter
      if (appointmentFilters.assignmentStatus) {
        if (appointmentFilters.assignmentStatus === "assigned") {
          filteredData = filteredData.filter((a: Appointment) => a.assignedTo);
        } else if (appointmentFilters.assignmentStatus === "unassigned") {
          filteredData = filteredData.filter((a: Appointment) => !a.assignedTo);
        }
      }
      // Date filter
      if (appointmentFilters.dateFilter) {
        const now = new Date();
        const today = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        filteredData = filteredData.filter((a: Appointment) => {
          const appointmentDate = new Date(a.appointmentDate);
          const appointmentDayStart = new Date(
            appointmentDate.getFullYear(),
            appointmentDate.getMonth(),
            appointmentDate.getDate(),
          );
          switch (appointmentFilters.dateFilter) {
            case "today":
              return appointmentDayStart.getTime() === today.getTime();
            case "week":
              const weekStart = new Date(today);
              weekStart.setDate(today.getDate() - today.getDay());
              const weekEnd = new Date(weekStart);
              weekEnd.setDate(weekStart.getDate() + 6);
              return (
                appointmentDayStart >= weekStart &&
                appointmentDayStart <= weekEnd
              );
            case "month":
              return (
                appointmentDate.getMonth() === now.getMonth() &&
                appointmentDate.getFullYear() === now.getFullYear()
              );
            case "upcoming":
              return appointmentDayStart >= today;
            default:
              return true;
          }
        });
      }
      // Search filter - Instant, case-insensitive, whitespace-resilient
      if (appointmentSearch.trim()) {
        const searchTerms = appointmentSearch
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        filteredData = filteredData.filter((a: Appointment) => {
          const searchContent = [
            a.appointmentId,
            a.citizenName,
            a.citizenPhone,
            a.purpose,
            typeof a.assignedTo === "object"
              ? `${(a.assignedTo as any).firstName} ${(a.assignedTo as any).lastName}`
              : a.assignedTo,
            typeof a.assignedTo === "object" ? (a.assignedTo as any).email : "",
          ]
            .join(" ")
            .toLowerCase();

          return searchTerms.every((term) => searchContent.includes(term));
        });
      }
    }

    // Apply department filters
    if (tab === "departments") {
      // Type filter
      if (deptFilters.type) {
        filteredData = filteredData.filter((d: Department) =>
          deptFilters.type === "main"
            ? !d.parentDepartmentId
            : !!d.parentDepartmentId,
        );
      }
      // Status filter
      if (deptFilters.status) {
        filteredData = filteredData.filter((d: Department) =>
          deptFilters.status === "active" ? d.isActive : !d.isActive,
        );
      }
      // Search filter - Instant, case-insensitive, whitespace-resilient
      if (deptSearch.trim()) {
        const searchTerms = deptSearch
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        filteredData = filteredData.filter((d: Department) => {
          const searchContent = [
            d.name,
            d.departmentId,
            d.head,
            d.contactPerson,
            (d as any).headName,
          ]
            .join(" ")
            .toLowerCase();

          return searchTerms.every((term) => searchContent.includes(term));
        });
      }
      // Main Department filter (show main + its subs)
      if (deptFilters.mainDeptId) {
        filteredData = filteredData.filter(
          (d: Department) =>
            String(d._id) === String(deptFilters.mainDeptId) ||
            String(getParentDepartmentId(d)) === String(deptFilters.mainDeptId),
        );
      }
      // Specific Sub Department filter
      if (deptFilters.subDeptId) {
        filteredData = filteredData.filter(
          (d: Department) => String(d._id) === String(deptFilters.subDeptId),
        );
      }
    }

    // Apply user filters
    if (tab === "users") {
      // Role filter
      if (userFilters.role) {
        filteredData = filteredData.filter((u: User) => {
          if (userFilters.role.startsWith("CUSTOM:")) {
            const roleId = userFilters.role.split(":")[1];
            const uRoleId =
              u.customRoleId && typeof u.customRoleId === "object"
                ? (u.customRoleId as any)._id
                : u.customRoleId;
            return uRoleId === roleId;
          }
          return u.role === userFilters.role;
        });
      }
      // Status filter
      if (userFilters.status) {
        filteredData = filteredData.filter((u: User) =>
          userFilters.status === "active" ? u.isActive : !u.isActive,
        );
      }
      // Main Department filter
      if (userFilters.mainDeptId) {
        filteredData = filteredData.filter((u: User) => {
          const userDepts = [
            typeof u.departmentId === "object" && u.departmentId
              ? (u.departmentId as any)._id
              : u.departmentId,
            ...(u.departmentIds || []).map((d) =>
              typeof d === "object" && d ? (d as any)._id : d,
            ),
          ]
            .filter(Boolean)
            .map((id) => String(id));

          return userDepts.some((deptId) => {
            const dept = allDepartments.find(
              (d) => String(d._id) === String(deptId),
            );
            return (
              String(deptId) === String(userFilters.mainDeptId) ||
              String(getParentDepartmentId(dept)) ===
                String(userFilters.mainDeptId)
            );
          });
        });
      }
      // Sub Department filter
      if (userFilters.subDeptId) {
        filteredData = filteredData.filter((u: User) => {
          const userDepts = [
            typeof u.departmentId === "object" && u.departmentId
              ? (u.departmentId as any)._id
              : u.departmentId,
            ...(u.departmentIds || []).map((d) =>
              typeof d === "object" && d ? (d as any)._id : d,
            ),
          ]
            .filter(Boolean)
            .map((id) => String(id));

          return userDepts.includes(String(userFilters.subDeptId));
        });
      }
      // Search filter - Instant, case-insensitive, whitespace-resilient
      if (userSearch.trim()) {
        const searchTerms = userSearch
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        filteredData = filteredData.filter((u: User) => {
          const searchContent = [
            u.firstName,
            u.lastName,
            u.email,
            u.phone,
            u.designation,
            ...((u as any).designations || []),
          ]
            .join(" ")
            .toLowerCase();

          return searchTerms.every((term) => searchContent.includes(term));
        });
      }
    }

    if (sortConfig.tab !== tab || !sortConfig.key || !sortConfig.direction) {
      return filteredData;
    }

    return [...filteredData].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      // Special handling for Users tab
      if (tab === "users") {
        if (sortConfig.key === "firstName") {
          // Sort by Full Name
          aValue = `${a.firstName || ""} ${a.lastName || ""}`.trim().toLowerCase();
          bValue = `${b.firstName || ""} ${b.lastName || ""}`.trim().toLowerCase();
        } else if (sortConfig.key === "role") {
          // Sort by Role Label
          aValue = getUserRoleLabel(a).toLowerCase();
          bValue = getUserRoleLabel(b).toLowerCase();
        } else {
          aValue = a[sortConfig.key];
          bValue = b[sortConfig.key];
        }
      } else if (sortConfig.key === "slaStatus") {
        const getSLAScore = (g: any) => {
          if (g.status === "RESOLVED" || g.status === "CLOSED" || g.status === "REJECTED") return 2;
          const now = new Date();
          const createdDate = new Date(g.createdAt);
          const slaLimit = g.slaHours || 120;
          const isOverdue = (now.getTime() - createdDate.getTime()) > (slaLimit * 60 * 60 * 1000);
          
          return isOverdue ? 0 : 1;
        };
        aValue = getSLAScore(a);
        bValue = getSLAScore(b);
      } else {
        aValue = a[sortConfig.key];
        bValue = b[sortConfig.key];

        // Handle nested objects (like department name)
        if (sortConfig.key.includes(".")) {
          const parts = sortConfig.key.split(".");
          aValue = parts.reduce((obj, key) => obj?.[key], a);
          bValue = parts.reduce((obj, key) => obj?.[key], b);
        }
      }

      // Handle null/undefined values
      if (aValue === null || aValue === undefined) aValue = "";
      if (bValue === null || bValue === undefined) bValue = "";

      // String comparison (Case-insensitive)
      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortConfig.direction === "asc"
          ? aValue.localeCompare(bValue, undefined, { sensitivity: 'base' })
          : bValue.localeCompare(aValue, undefined, { sensitivity: 'base' });
      }

      // Date or number comparison
      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  };

  const handleToggleUserStatus = async (
    userId: string,
    currentStatus: boolean,
  ) => {
    // Prevent self-deactivation
    if (user && userId === user.id) {
      toast.error("You cannot deactivate yourself");
      return;
    }

    // Optimistic Update
    setUsers((prev) =>
      prev.map((u) =>
        u._id === userId ? { ...u, isActive: !currentStatus } : u,
      ),
    );

    try {
      const response = await userAPI.update(userId, {
        isActive: !currentStatus,
      } as any);
      if (response.success) {
        toast.success(
          `User ${!currentStatus ? "activated" : "deactivated"} successfully`,
        );
        // Refresh purely for data integrity, silently
        fetchUsers(userPage, true);
      } else {
        // Rollback on failure
        setUsers((prev) =>
          prev.map((u) =>
            u._id === userId ? { ...u, isActive: currentStatus } : u,
          ),
        );
      }
    } catch (error: any) {
      // Rollback on error
      setUsers((prev) =>
        prev.map((u) =>
          u._id === userId ? { ...u, isActive: currentStatus } : u,
        ),
      );
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to update user status";
      toast.error(errorMessage);
    }
  };

  const allowedTabs = useMemo(() => {
    if (isSuperAdminUser && drilldownId) {
      return new Set([
        "overview",
        "analytics",
        "grievances",
        "appointments",
        "departments",
        "users",
        "roles",
        "leads",
        "whatsapp",
        "flows",
        "notifications",
        "email",
        "settings",
        "profile",
      ]);
    }
    if (isCompanyAdminRole) {
      return new Set([
        "overview",
        "analytics",
        "grievances",
        "appointments",
        "departments",
        "users",
        "settings",
        "profile",
      ]);
    }
    if (isDepartmentAdminRole) {
      return new Set([
        "overview",
        "analytics",
        "grievances",
        "departments",
        "users",
        "profile",
      ]);
    }
    if (isSubDepartmentAdminRole) {
      return new Set(
        hasMultiDepartmentMapping
          ? [
              "overview",
              "analytics",
              "grievances",
              "departments",
              "users",
              "profile",
            ]
          : ["overview", "analytics", "grievances", "users", "profile"],
      );
    }
    if (isOperatorRole) {
      return new Set(["overview", "grievances", "profile"]);
    }
    return new Set(["overview", "profile"]);
  }, [
    isSuperAdminUser,
    drilldownId,
    isCompanyAdminRole,
    isDepartmentAdminRole,
    isSubDepartmentAdminRole,
    hasMultiDepartmentMapping,
    isOperatorRole,
  ]);

  useEffect(() => {
    if (activeTab && !allowedTabs.has(activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, allowedTabs]);

  const handleTabChange = useCallback((value: string) => {
    if (!allowedTabs.has(value)) {
      return;
    }
    if (activeTab !== value) {
      setPreviousTab(activeTab);

      // Handle tab transitions (SPA consistency)
      setGrievancePage(1);
      
      if (activeTab === "overview" && value === "grievances") {
        setGrievanceFilters((prev) => ({ ...prev, status: "" }));
      }

      setActiveTab(value);
    }
    setIsMobileTabMenuOpen(false);
  }, [allowedTabs, activeTab]);

  const handleProfileToggle = useCallback(() => {
    if (activeTab === "profile") {
      const fallbackTab =
        previousTab !== "profile" && allowedTabs.has(previousTab)
          ? previousTab
          : "overview";
      handleTabChange(fallbackTab);
      return;
    }

    handleTabChange("profile");
  }, [activeTab, previousTab, allowedTabs, handleTabChange]);

  const handleOpenMobileMenu = useCallback(() => setIsMobileTabMenuOpen(true), []);
  const handleProfileClick = useCallback(() => handleProfileToggle(), [handleProfileToggle]);
  const handleMarkAsRead = useCallback((id: string) => handleMarkNotificationAsRead(id), [handleMarkNotificationAsRead]);
  const handleMarkAllAsRead = useCallback(() => handleMarkAllNotificationsAsRead(), [handleMarkAllNotificationsAsRead]);


  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <LoadingSpinner text="Initializing Dashboard..." />
      </div>
    );
  }

  if (isSuperAdminUser && !drilldownId) {
    return <SuperAdminOverview />;
  }

  if (!user) {
    return null;
  }

  const activeUserFilterCount = [
    userFilters.role,
    userFilters.status,
    userFilters.mainDeptId,
    userFilters.subDeptId,
  ].filter(Boolean).length;



  return (
    <div key="final-dashboard-root-v4" className="min-h-screen bg-white">
      <DashboardHeader
        user={user}
        companyName={company?.name}
        companyIdParam={drilldownId}
        isSuperAdminUser={isSuperAdminUser}
        isCompanyLevel={Boolean(isCompanyLevel)}
        isDepartmentLevel={Boolean(isDepartmentLevel)}
        isJharsugudaCompany={isJharsugudaCompany}
        canReadGrievance={hasPermission(user, Permission.READ_GRIEVANCE)}
        dashboardBrandTitle={dashboardBrandTitle}
        dashboardBrandSubtitle={dashboardBrandSubtitle}
        onOpenMobileMenu={handleOpenMobileMenu}
        onProfileClick={handleProfileClick}
        onLogout={logout}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAsRead={handleMarkAsRead}
        onMarkAllAsRead={handleMarkAllAsRead}
        onNotificationClick={handleNotificationClick}
        onRefresh={handleRefresh}
        onBackToDashboard={() => setDrilldownId(null)}
        isRefreshing={refreshing}
        logoUrl={company?.theme?.logoUrl}
      />

      {/* Content wrapper */}
      <main className="max-w-[1920px] mx-auto px-4 lg:px-8 xl:px-12 py-4 sm:py-6 lg:py-8">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="space-y-3 sm:space-y-6"
        >
          <div className="flex gap-4">
            <DashboardNavigation
              user={user}
              activeTab={activeTab}
              companyIdParam={drilldownId}
              isMobileTabMenuOpen={isMobileTabMenuOpen}
              isSuperAdminUser={isSuperAdminUser}
              isCompanyAdminRole={isCompanyAdminRole}
              isViewingCompany={Boolean(isViewingCompany)}
              isJharsugudaCompany={isJharsugudaCompany}
              canViewAnalytics={hasPermission(user, Permission.VIEW_ANALYTICS) && hasModule(Module.GRIEVANCE)}
              canReadGrievance={hasPermission(user, Permission.READ_GRIEVANCE) && hasModule(Module.GRIEVANCE)}
              canShowAppointmentsInView={canShowAppointmentsInView}
              canSeeDepartmentsTab={canSeeDepartmentsTab}
              canSeeUsersTab={canSeeUsersTab}
              hasGrievanceModule={hasModule(Module.GRIEVANCE)}
              hasLeadCaptureModule={hasModule(Module.LEAD_CAPTURE)}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              onTabChange={(value) => {
                handleTabChange(value);
                setIsMobileTabMenuOpen(false);
              }}
              onCloseMobileMenu={() => setIsMobileTabMenuOpen(false)}
              onLogout={logout}
              onProfileClick={handleProfileToggle}
            />
            <div className="flex-1 min-w-0">
              <DashboardTabPanels
              {...{
                activeTab,
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
                companyIdParam: drilldownId,
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
              }}
            />
            </div>
          </div>
        </Tabs>

          <DashboardDialogs
            visible={true}
            props={{
              showDepartmentDialog,
              setShowDepartmentDialog,
              editingDepartment,
              setEditingDepartment,
              isSuperAdminUser,
              companyIdParam: drilldownId,
              fetchDepartmentData: () => {
                fetchDepartments(departmentPage, true);
                setEditingDepartment(null);
              },
              fetchDashboardData,
              showUserDialog,
              setShowUserDialog,
              fetchUsers,
              userPage,
              showEditUserDialog,
              setShowEditUserDialog,
              editingUser,
              setEditingUser,
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
              confirmDialog,
              setConfirmDialog,
              showDepartmentPriorityColumn,
              grievanceAssignmentCurrentDepartmentId,
              grievanceAssignmentCurrentSubDepartmentId,
              grievanceAssignmentSuggestedDepartmentId,
              grievanceAssignmentSuggestedSubDepartmentId,
            }}
          />
      </main>
    </div>
  );
}

export default function DashboardPageClient() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <LoadingSpinner />
        </div>
      }
    >
      <DashboardPageClientContent />
    </Suspense>
  );
}
