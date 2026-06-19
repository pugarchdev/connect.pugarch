"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";
import { grievanceAPI, Grievance } from "../../lib/api/grievance";
import { departmentAPI, Department } from "../../lib/api/department";
import {
  FileText,
  MapPin,
  Phone,
  Calendar,
  Filter,
  Search,
  Eye,
  UserPlus,
  CheckCircle,
  ArrowLeft,
  BellRing,
  MousePointerClick,
  X,
} from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import CitizenDetailsModal from "../../components/grievance/CitizenDetailsModal";
import AssignmentDialog from "../../components/assignment/AssignmentDialog";
import LoadingSpinner from "../../components/ui/LoadingSpinner";
import { formatDate, formatDateTime, formatISTTime } from "../../lib/utils";
import { isCompanyAdminOrHigher } from "@/lib/permissions";

export default function GrievancesPage() {
  const JHARSUGUDA_COMPANY_ID =
    process.env.NEXT_PUBLIC_JHARSUGUDA_COMPANY_ID || "69ad4c6eb1ad8e405e6c0858";
  const { user } = useAuth();
  const router = useRouter();
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGrievance, setSelectedGrievance] = useState<Grievance | null>(
    null,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [grievanceToAssign, setGrievanceToAssign] = useState<Grievance | null>(
    null,
  );
  const [filters, setFilters] = useState({
    status: "all",
    department: "all",
    assignment: "all", // all, assigned, unassigned
    dateRange: "all", // all, today, week, month
    overdue: "all", // all, overdue, ontrack
    search: "",
  });
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [grievanceForReminder, setGrievanceForReminder] = useState<Grievance | null>(null);
  const [reminderRemarks, setReminderRemarks] = useState("");
  const [sendingReminder, setSendingReminder] = useState(false);

  // Extract companyId from user
  const companyId =
    typeof user?.companyId === "object"
      ? (user.companyId as any)._id
      : user?.companyId || "";

  const fetchGrievances = useCallback(async () => {
    try {
      setLoading(true);
      const apiParams: any = { 
        limit: 100, // Increase limit for better visibility
        status: filters.status !== 'all' ? filters.status : undefined,
        departmentId: filters.department !== 'all' ? filters.department : undefined,
        search: filters.search || undefined,
        slaStatus: filters.overdue === 'overdue' ? 'OVERDUE' : (filters.overdue === 'ontrack' ? 'ON_TRACK' : undefined),
      };

      const response = await grievanceAPI.getAll(apiParams);
      if (response.success) {
        setGrievances(response.data.grievances);
      }
    } catch (error) {
      toast.error("Failed to load grievances");
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.department, filters.search, filters.overdue]);

  const fetchDepartments = useCallback(async () => {
    try {
      const response = await departmentAPI.getAll({ companyId, limit: 25 });
      if (response.success) {
        setDepartments(response.data.departments);
      }
    } catch (error) {
      console.error("Failed to load departments:", error);
    }
  }, [companyId]);

  useEffect(() => {
    fetchGrievances();
  }, [fetchGrievances, filters.status, filters.department, filters.assignment, filters.dateRange, filters.overdue, filters.search]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleAssignClick = (grievance: Grievance) => {
    setGrievanceToAssign(grievance);
    setAssignDialogOpen(true);
  };

  const handleAssign = async (
    userId: string,
    departmentId?: string,
    note?: string,
    additionalDepartmentIds?: string[],
    additionalAssigneeIds?: string[]
  ) => {
    if (!grievanceToAssign) return;
    await grievanceAPI.assign(
      grievanceToAssign._id,
      userId,
      departmentId,
      note,
      additionalDepartmentIds,
      additionalAssigneeIds
    );
    await fetchGrievances();
  };

  const handleViewDetails = (grievance: Grievance) => {
    setSelectedGrievance(grievance);
    setModalOpen(true);
  };

  const isJharsugudaCompany = companyId === JHARSUGUDA_COMPANY_ID;
  const roleName = (user?.role || "").toString().toLowerCase();
  const explicitLevel =
    typeof (user as any)?.level === "number"
      ? ((user as any).level as number)
      : undefined;
  const resolvedRoleLevel = user?.isSuperAdmin
    ? 0
    : explicitLevel !== undefined
      ? explicitLevel
      : roleName.includes("company")
        ? 1
        : roleName.includes("department") && !roleName.includes("sub")
          ? 2
          : roleName.includes("sub") && roleName.includes("department")
            ? 3
            : roleName.includes("operator")
              ? 4
              : 5;
  const isCompanyAdminUser = resolvedRoleLevel === 1;

  // Helper function to check if grievance is overdue
  const isOverdue = (grievance: Grievance) => {
    const createdDate = new Date(grievance.createdAt);
    const now = new Date();
    const hoursDiff = Math.floor(
      (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60),
    );

    if (grievance.status === "PENDING") {
      return hoursDiff > 120; // Hardened Governance: 120h from creation
    } else if (grievance.status === "ASSIGNED" || grievance.status === "IN_PROGRESS") {
      const assignedDate = grievance.assignedAt
        ? new Date(grievance.assignedAt)
        : createdDate;
      const hoursFromAssigned = Math.floor(
        (now.getTime() - assignedDate.getTime()) / (1000 * 60 * 60),
      );
      return hoursFromAssigned > 120; // ASSIGNED should be resolved within 5 days (120h)
    }
    return false;
  };

  const getOverdueDetails = (grievance: Grievance) => {
    const createdDate = new Date(grievance.createdAt);
    const now = new Date();
    const assignedDate = grievance.assignedAt
      ? new Date(grievance.assignedAt)
      : createdDate;
    const baseDate =
      createdDate; // Hardened Governance: Always creation based
    const daysPassed = Math.max(
      1,
      Math.floor((now.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const assigneeName =
      grievance.assignedTo && typeof grievance.assignedTo === "object"
        ? `${(grievance.assignedTo as any).firstName || ""} ${(grievance.assignedTo as any).lastName || ""}`.trim() || "Inactive User"
        : "Not assigned";
    const departmentName =
      typeof grievance.departmentId === "object"
        ? grievance.departmentId.name
        : "General Department";
    const officeName =
      typeof grievance.subDepartmentId === "object"
        ? grievance.subDepartmentId.name
        : "N/A";
    return { createdDate, daysPassed, assigneeName, departmentName, officeName };
  };

  const getDeptCategoryLabel = (grievance: Grievance) => {
    if (isJharsugudaCompany && grievance.status === "REVERTED" && !grievance.category) {
      return "Collector & DM";
    }

    return grievance.category || "General";
  };

  const openReminderDialog = (grievance: Grievance) => {
    setGrievanceForReminder(grievance);
    setReminderRemarks("");
    setReminderDialogOpen(true);
  };

  const handleSendReminder = async () => {
    if (!grievanceForReminder) return;
    if (!reminderRemarks.trim()) {
      toast.error("Please enter remarks before sending reminder");
      return;
    }
    try {
      setSendingReminder(true);
      await grievanceAPI.sendReminder(grievanceForReminder._id, reminderRemarks.trim());
      toast.success("Reminder sent successfully");
      setReminderDialogOpen(false);
      setGrievanceForReminder(null);
      setReminderRemarks("");
      await fetchGrievances();
    } catch (error: any) {
      toast.error(error?.message || "Failed to send reminder");
    } finally {
      setSendingReminder(false);
    }
  };

  const filteredGrievances = grievances
    .filter((g) => {
      // Status filter
      if (filters.status !== "all" && g.status !== filters.status) return false;

      // Department filter
      if (filters.department !== "all") {
        const deptId =
          typeof g.departmentId === "object"
            ? (g.departmentId as any)._id
            : g.departmentId;
        if (deptId !== filters.department) return false;
      }

      // Assignment filter
      if (filters.assignment === "assigned" && !g.assignedTo) return false;
      if (filters.assignment === "unassigned" && g.assignedTo) return false;

      // Date range filter
      if (filters.dateRange !== "all") {
        const createdDate = new Date(g.createdAt);
        const now = new Date();
        const today = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        if (filters.dateRange === "today" && createdDate < today) return false;
        if (filters.dateRange === "week" && createdDate < weekAgo) return false;
        if (filters.dateRange === "month" && createdDate < monthAgo)
          return false;
      }

      // Overdue filter
      if (filters.overdue === "overdue" && !isOverdue(g)) return false;
      if (filters.overdue === "ontrack" && isOverdue(g)) return false;

      // Search filter
      if (
        filters.search &&
        !g.citizenName?.toLowerCase().includes(filters.search.toLowerCase()) &&
        !g.grievanceId?.toLowerCase().includes(filters.search.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      // Sort by created date (latest first)
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA; // Latest first
    });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PENDING":
        return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "ASSIGNED":
        return "bg-blue-100 text-blue-800 border-blue-300";
      case "IN_PROGRESS":
        return "bg-indigo-100 text-indigo-800 border-indigo-300";
      case "RESOLVED":
        return "bg-green-100 text-green-800 border-green-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 overflow-x-hidden">
      {/* Header with Gradient */}
      <div className="bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 shadow-xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iYSIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVHJhbnNmb3JtPSJyb3RhdGUoNDUpIj48cGF0aCBkPSJNLTEwIDMwaDYwdjJoLTYweiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNhKSIvPjwvc3ZnPg==')] opacity-30"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm shadow-lg shrink-0">
                <FileText className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold text-white tracking-tight leading-tight">
                  Active Grievances
                </h1>
                <p className="text-xs sm:text-sm text-white/80 mt-0.5 leading-relaxed">
                  View and manage pending and in-progress grievances
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 self-start sm:self-auto w-full sm:w-auto">
              <button
                onClick={() => router.back()}
                className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all border border-white/30 backdrop-blur-sm text-sm font-medium flex-1 sm:flex-none"
              >
                <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                Back
              </button>
              <div className="text-right bg-white/10 px-3 sm:px-4 py-2 rounded-xl border border-white/20 backdrop-blur-sm min-w-[88px] sm:min-w-[96px]">
                <p className="text-[15px] sm:text-sm text-white/70">Active</p>
                <p className="text-xl sm:text-2xl font-bold text-white">
                  {grievances.length}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Filters Card */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 shadow-xl p-4 sm:p-6 mb-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                Filters
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Narrow the list by status, assignment, department, date, and SLA state.
              </p>
            </div>
            <div className="shrink-0 inline-flex items-center rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 border border-blue-100">
              {filteredGrievances.length} shown
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
            {/* Search */}
            <div className="relative sm:col-span-2 lg:col-span-2">
              <label className="mb-1.5 block text-[15px] font-semibold uppercase tracking-wide text-slate-500">
                Search
              </label>
              <Search className="absolute left-3 top-[calc(50%+0.8rem)] transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search by name or ID..."
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Status */}
            <label className="sm:hidden -mb-1 text-[15px] font-semibold uppercase tracking-wide text-slate-500">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="PENDING">🟡 Pending</option>
              <option value="IN_PROGRESS">🛠️ In Progress</option>
            </select>

            {/* Department */}
            <label className="sm:hidden -mb-1 text-[15px] font-semibold uppercase tracking-wide text-slate-500">
              Department
            </label>
            <select
              value={filters.department}
              onChange={(e) =>
                setFilters({ ...filters, department: e.target.value })
              }
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Departments</option>
              {departments.map((dept) => (
                <option key={dept._id} value={dept._id}>
                  {dept.name}
                </option>
              ))}
            </select>

            {/* Assignment */}
            <label className="sm:hidden -mb-1 text-[15px] font-semibold uppercase tracking-wide text-slate-500">
              Assignment
            </label>
            <select
              value={filters.assignment}
              onChange={(e) =>
                setFilters({ ...filters, assignment: e.target.value })
              }
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Assignments</option>
              <option value="assigned">✅ Assigned</option>
              <option value="unassigned">⏳ Unassigned</option>
            </select>

            {/* Date Range */}
            <label className="sm:hidden -mb-1 text-[15px] font-semibold uppercase tracking-wide text-slate-500">
              Date Range
            </label>
            <select
              value={filters.dateRange}
              onChange={(e) =>
                setFilters({ ...filters, dateRange: e.target.value })
              }
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Time</option>
              <option value="today">📅 Today</option>
              <option value="week">📆 Last 7 Days</option>
              <option value="month">🗓️ Last 30 Days</option>
            </select>

            {/* Overdue Filter */}
            <label className="sm:hidden -mb-1 text-[15px] font-semibold uppercase tracking-wide text-slate-500">
              SLA Status
            </label>
            <select
              value={filters.overdue}
              onChange={(e) =>
                setFilters({ ...filters, overdue: e.target.value })
              }
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">SLA Status</option>
              <option value="overdue">🔴 Overdue</option>
              <option value="ontrack">🟢 On Track</option>
            </select>

            {/* Reset Button */}
            <button
              onClick={() =>
                setFilters({
                  status: "all",
                  department: "all",
                  assignment: "all",
                  dateRange: "all",
                  overdue: "all",
                  search: "",
                })
              }
              className="w-full sm:w-auto px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center text-sm font-medium"
            >
              <Filter className="w-4 h-4 mr-2" />
              Reset Filters
            </button>
          </div>
        </div>

        {/* Grievances Table */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 shadow-xl overflow-hidden">
          {loading ? (
            <div className="p-16 text-center">
              <LoadingSpinner text="Loading grievances..." />
            </div>
          ) : filteredGrievances.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 text-lg">No grievances found</p>
            </div>
          ) : (
            <>
              <div className="md:hidden divide-y divide-slate-200">
                {filteredGrievances.map((grievance, index) => (
                  <div key={grievance._id} className="p-4 space-y-4">
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                            {index + 1}
                          </span>
                          <button
                            onClick={() => handleViewDetails(grievance)}
                            className="font-bold text-sm text-blue-700 text-left hover:underline break-all"
                          >
                            {grievance.grievanceId}
                          </button>
                        </div>
                        <button
                          onClick={() => handleViewDetails(grievance)}
                          className="text-slate-900 hover:text-blue-700 font-bold text-left text-base leading-tight break-words"
                        >
                          {grievance.citizenName}
                        </button>
                        <div className="flex items-center text-sm text-gray-500 mt-1 break-all">
                          <Phone className="w-3.5 h-3.5 mr-1.5 text-gray-400 shrink-0" />
                          {grievance.citizenPhone}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`max-w-full px-2.5 py-1 rounded-full text-[14px] font-bold border uppercase tracking-wide text-center break-words ${getStatusColor(grievance.status)}`}
                        >
                          {grievance.status === "PENDING" ||
                          grievance.status === "ASSIGNED"
                            ? "Pending"
                            : grievance.status.replace("_", " ")}
                        </span>
                        {grievance.status === "RESOLVED" ||
                        grievance.status === "CLOSED" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[14px] font-bold border border-green-200 text-green-700 bg-green-50">
                            <CheckCircle className="w-3 h-3" />
                            Completed
                          </span>
                        ) : isOverdue(grievance) ? (
                          isJharsugudaCompany && isCompanyAdminUser ? (
                            <button
                              onClick={() => openReminderDialog(grievance)}
                              title="Open overdue reminder dialog"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[14px] font-bold border border-red-300 text-red-800 bg-red-50 hover:bg-red-100 max-w-full"
                            >
                              <BellRing className="w-3 h-3" />
                              Overdue
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[14px] font-bold border border-red-200 text-red-700 bg-red-50">
                              <BellRing className="w-3 h-3" />
                              Overdue
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[14px] font-bold border border-green-200 text-green-700 bg-green-50">
                            <CheckCircle className="w-3 h-3" />
                            On track
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                        <p className="text-[14px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Department
                        </p>
                        <p className="text-sm font-semibold text-slate-900 break-words">
                          {typeof grievance.departmentId === "object"
                            ? (grievance.departmentId as any).name
                            : "General Department"}
                        </p>
                        <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded text-[15px] font-medium bg-blue-50 text-blue-600 border border-blue-100 w-fit">
                          {getDeptCategoryLabel(grievance)}
                        </span>
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                        <p className="text-[14px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Issue Description
                        </p>
                        <p className="text-sm text-slate-700 leading-relaxed break-words">
                          {grievance.description}
                        </p>
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                        <p className="text-[14px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Assignment
                        </p>
                        {grievance.assignedTo ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center">
                              <UserPlus className="w-3.5 h-3.5 mr-1.5 text-green-600 shrink-0" />
                              <span className="text-sm font-semibold text-gray-900 break-words">
                                {typeof grievance.assignedTo === "object" && grievance.assignedTo
                                  ? `${(grievance.assignedTo as any).firstName || ""} ${(grievance.assignedTo as any).lastName || ""}`.trim() || "Inactive User"
                                  : (grievance.assignedTo as any)}
                              </span>
                            </div>
                            {grievance.assignedAt && (
                              <span className="text-[14px] text-gray-500">
                                Assigned on{" "}
                                {new Date(grievance.assignedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                            Pending Assignment
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 rounded-xl bg-slate-50 border border-slate-200 p-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                            Raised On
                          </p>
                          <div className="flex items-center text-sm font-medium text-gray-900">
                            <Calendar className="w-3.5 h-3.5 mr-1.5 text-blue-600 shrink-0" />
                            {formatDate(grievance.createdAt)}
                          </div>
                          <span className="text-[14px] text-gray-500 mt-1 block">
                            {formatISTTime(grievance.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          {isCompanyAdminOrHigher(user) && (
                            <button
                              onClick={() => handleAssignClick(grievance)}
                              title="Assign Officer"
                              className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors border border-transparent hover:border-green-200 bg-white"
                            >
                              <UserPlus className="w-5 h-5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleViewDetails(grievance)}
                            title="View Full Details"
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-200 bg-white"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200 whitespace-nowrap">
                  <tr>
                    <th className="px-4 py-4 text-center text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Sr. No.
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Application No
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Citizen Information
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Department & Sub-Department
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Issue Description
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Assignment
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Raised On
                    </th>
                    <th className="px-6 py-4 text-center text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredGrievances.map((grievance, index) => (
                    <tr
                      key={grievance._id}
                      className="hover:bg-slate-50/50 transition-colors border-b border-slate-100"
                    >
                      <td className="px-4 py-4 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
                          {index + 1}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleViewDetails(grievance)}
                            className="font-bold text-sm text-blue-700 text-left hover:underline break-all"
                          >
                            {grievance.grievanceId}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleViewDetails(grievance)}
                            className="text-blue-600 hover:text-blue-800 font-bold text-left hover:underline break-words whitespace-normal"
                          >
                            {grievance.citizenName}
                          </button>
                          <div className="flex items-center text-sm text-gray-500 mt-1 break-all">
                            <Phone className="w-3.5 h-3.5 mr-1 text-gray-400" />
                            {grievance.citizenPhone}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col space-y-1">
                          <span className="text-sm font-semibold text-gray-900">
                            {typeof grievance.departmentId === "object"
                              ? (grievance.departmentId as any).name
                              : "General Department"}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[15px] font-medium bg-blue-50 text-blue-600 border border-blue-100 w-fit">
                            {getDeptCategoryLabel(grievance)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-600 max-w-xs leading-relaxed break-words whitespace-normal">
                          {grievance.description}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        {grievance.assignedTo ? (
                          <div className="flex flex-col">
                            <div className="flex items-center">
                              <UserPlus className="w-3.5 h-3.5 mr-1.5 text-green-600" />
                              <span className="text-sm font-semibold text-gray-900">
                                {typeof grievance.assignedTo === "object" && grievance.assignedTo
                                  ? `${(grievance.assignedTo as any).firstName || ""} ${(grievance.assignedTo as any).lastName || ""}`.trim() || "Inactive User"
                                  : (grievance.assignedTo as any)}
                              </span>
                            </div>
                            {grievance.assignedAt && (
                              <span className="text-[14px] text-gray-400 mt-1">
                                Assigned on:{" "}
                                {new Date(
                                  grievance.assignedAt,
                                ).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                            Pending Assignment
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-2">
                          <span
                            className={`px-3 py-1 rounded-full text-[15px] font-bold border uppercase tracking-wider w-fit ${getStatusColor(grievance.status)}`}
                          >
                            {grievance.status === "PENDING" || grievance.status === "ASSIGNED" 
                              ? "Pending" 
                              : grievance.status.replace("_", " ")}
                          </span>
                          {grievance.status === "RESOLVED" || grievance.status === "CLOSED" ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[15px] font-bold border border-green-200 text-green-700 bg-green-50 w-fit">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Completed
                            </span>
                          ) : isOverdue(grievance) ? (
                            isJharsugudaCompany && isCompanyAdminUser ? (
                              <button
                                onClick={() => openReminderDialog(grievance)}
                                title="Open overdue reminder dialog"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[15px] font-bold border border-red-300 text-red-800 bg-red-50 hover:bg-red-100 hover:border-red-400 w-fit cursor-pointer"
                              >
                                <BellRing className="w-3.5 h-3.5" />
                                Overdue • Click here
                                <MousePointerClick className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[15px] font-bold border border-red-200 text-red-700 bg-red-50 w-fit">
                                <BellRing className="w-3.5 h-3.5" />
                                Overdue
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[15px] font-bold border border-green-200 text-green-700 bg-green-50 w-fit">
                              <CheckCircle className="w-3.5 h-3.5" />
                              On track
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <div className="flex items-center text-sm font-medium text-gray-900">
                            <Calendar className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                            {formatDate(grievance.createdAt)}
                          </div>
                          <span className="text-[14px] text-gray-400 mt-1">
                            {formatISTTime(grievance.createdAt)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center space-x-2">
                          {isCompanyAdminOrHigher(user) && (
                            <button
                              onClick={() => handleAssignClick(grievance)}
                              title="Assign Officer"
                              className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors border border-transparent hover:border-green-200"
                            >
                              <UserPlus className="w-5 h-5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleViewDetails(grievance)}
                            title="View Full Details"
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-200"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Citizen Details Modal */}
      <CitizenDetailsModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedGrievance(null);
        }}
        grievance={selectedGrievance}
      />

      {/* Assignment Dialog */}
      <AssignmentDialog
        isOpen={assignDialogOpen}
        onClose={() => {
          setAssignDialogOpen(false);
          setGrievanceToAssign(null);
        }}
        onAssign={handleAssign}
        itemType="grievance"
        itemId={grievanceToAssign?._id || ""}
        companyId={companyId}
        allDepartments={departments}
        currentAssignee={grievanceToAssign?.assignedTo}
        currentDepartmentId={
          grievanceToAssign?.departmentId &&
          typeof grievanceToAssign.departmentId === 'object'
            ? (grievanceToAssign.departmentId as any)._id
            : grievanceToAssign?.departmentId
        }
        currentSubDepartmentId={
          grievanceToAssign?.subDepartmentId &&
          typeof grievanceToAssign.subDepartmentId === 'object'
            ? (grievanceToAssign.subDepartmentId as any)._id
            : grievanceToAssign?.subDepartmentId
        }
        userRole={user?.role}
        userDepartmentId={
          user?.departmentId &&
          typeof user.departmentId === 'object'
            ? (user.departmentId as any)._id
            : user?.departmentId
        }
        currentUserId={user?.id}
      />

      {reminderDialogOpen && grievanceForReminder && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 bg-red-50 border-b border-red-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-red-900">
                  Overdue Reminder - {grievanceForReminder.grievanceId}
                </h3>
                <p className="text-xs text-red-700">
                  Template: <span className="font-semibold">reminder_admin_v1</span>
                </p>
              </div>
              <button
                onClick={() => setReminderDialogOpen(false)}
                className="p-2 rounded-lg hover:bg-red-100 text-red-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {(() => {
                const details = getOverdueDetails(grievanceForReminder);
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border p-3 bg-slate-50">
                      <p className="text-slate-500 text-xs">Raised On</p>
                      <p className="font-semibold text-slate-900">
                        {formatDateTime(details.createdDate.toISOString())}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3 bg-slate-50">
                      <p className="text-slate-500 text-xs">Assigned To</p>
                      <p className="font-semibold text-slate-900">{details.assigneeName}</p>
                    </div>
                    <div className="rounded-lg border p-3 bg-slate-50">
                      <p className="text-slate-500 text-xs">Department / Office</p>
                      <p className="font-semibold text-slate-900">
                        {details.departmentName} / {details.officeName}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3 bg-slate-50">
                      <p className="text-slate-500 text-xs">Days Passed / Reminder Count</p>
                      <p className="font-semibold text-slate-900">
                        {details.daysPassed} days / {(grievanceForReminder.reminderCount || 0) + 1}
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  {`Remarks by Collector / ${isJharsugudaCompany ? "Collector & DM" : "Company Admin"}`}
                </label>
                <textarea
                  value={reminderRemarks}
                  onChange={(e) => setReminderRemarks(e.target.value)}
                  rows={4}
                  placeholder="Type reminder remarks to be sent with template..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t flex items-center justify-end gap-3">
              <button
                onClick={() => setReminderDialogOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSendReminder}
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
    </div>
  );
}
