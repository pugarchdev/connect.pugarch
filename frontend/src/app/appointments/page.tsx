"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { appointmentAPI, Appointment } from "@/lib/api/appointment";
import { departmentAPI, Department } from "@/lib/api/department";
import {
  Calendar,
  MapPin,
  Phone,
  Filter,
  Search,
  Eye,
  Clock,
  UserPlus,
  ArrowLeft,
  CheckCircle,
  CalendarClock,
} from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import CitizenDetailsModal from "@/components/grievance/CitizenDetailsModal";
import AssignmentDialog from "@/components/assignment/AssignmentDialog";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { formatDate, formatDateTime, formatISTTime } from "@/lib/utils";

import { isCompanyAdminOrHigher, Permission } from "@/lib/permissions";

export default function AppointmentsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [appointmentToAssign, setAppointmentToAssign] =
    useState<Appointment | null>(null);
  const [filters, setFilters] = useState({
    status: "all",
    department: "all",
    assignment: "all", // all, assigned, unassigned
    dateFilter: "all", // all, today, thisWeek, thisMonth, upcoming, past
    search: "",
  });

  // Extract companyId from user
  const companyId =
    typeof user?.companyId === "object"
      ? (user.companyId as any)._id
      : user?.companyId || "";

  // Restrict access to Company Admin only
  useEffect(() => {
    if (!authLoading && user && !isCompanyAdminOrHigher(user)) {
      toast.error(
        "Access denied. Appointments are only available for Company Admins.",
      );
      router.push("/dashboard");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    // Only fetch data if user is Company Admin or Higher
    if (user && isCompanyAdminOrHigher(user)) {
      fetchAppointments();
      fetchDepartments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const response = await appointmentAPI.getAll({ limit: 25 });
      if (response.success) {
        setAppointments(response.data.appointments);
      }
    } catch (error) {
      toast.error("Failed to load appointments");
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await departmentAPI.getAll({ companyId, limit: 25 });
      if (response.success) {
        setDepartments(response.data.departments);
      }
    } catch (error) {
      console.error("Failed to load departments:", error);
    }
  };

  const handleAssignClick = (appointment: Appointment) => {
    setAppointmentToAssign(appointment);
    setAssignDialogOpen(true);
  };

  const handleAssign = async (
    userId: string,
    departmentId?: string,
    _note?: string,
  ) => {
    if (!appointmentToAssign) return;
    await appointmentAPI.assign(appointmentToAssign._id, userId, departmentId);
    await fetchAppointments();
  };

  const handleViewDetails = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setModalOpen(true);
  };

  const filteredAppointments = appointments
    .filter((a) => {
      // Status filter
      if (filters.status !== "all" && a.status !== filters.status) return false;

      // Department filter
      if (filters.department !== "all") {
        const deptId =
          typeof a.departmentId === "object"
            ? (a.departmentId as any)._id
            : a.departmentId;
        if (deptId !== filters.department) return false;
      }

      // Assignment filter
      if (filters.assignment === "assigned" && !a.assignedTo) return false;
      if (filters.assignment === "unassigned" && a.assignedTo) return false;

      // Date filter
      if (filters.dateFilter !== "all") {
        const appointmentDate = new Date(a.appointmentDate);
        const now = new Date();
        const today = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        const monthEnd = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

        if (filters.dateFilter === "today") {
          if (appointmentDate < today || appointmentDate >= tomorrow)
            return false;
        }
        if (filters.dateFilter === "thisWeek") {
          if (appointmentDate < today || appointmentDate >= weekEnd)
            return false;
        }
        if (filters.dateFilter === "thisMonth") {
          if (appointmentDate < today || appointmentDate >= monthEnd)
            return false;
        }
        if (filters.dateFilter === "upcoming") {
          if (appointmentDate < today) return false;
        }
        if (filters.dateFilter === "past") {
          if (appointmentDate >= today) return false;
        }
      }

      // Search filter
      if (
        filters.search &&
        !a.citizenName?.toLowerCase().includes(filters.search.toLowerCase()) &&
        !a.appointmentId?.toLowerCase().includes(filters.search.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      // Sort by appointment date and time (upcoming first for future, latest first for past)
      const dateA = new Date(
        `${a.appointmentDate}T${a.appointmentTime || "00:00"}`,
      ).getTime();
      const dateB = new Date(
        `${b.appointmentDate}T${b.appointmentTime || "00:00"}`,
      ).getTime();
      const now = Date.now();

      // If viewing past appointments, show most recent first
      if (filters.dateFilter === "past") {
        return dateB - dateA;
      }
      // For upcoming and all, show earliest first
      return dateA - dateB;
    });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "SCHEDULED":
        return "bg-blue-100 text-blue-800 border-blue-300";
      case "COMPLETED":
        return "bg-green-100 text-green-800 border-green-300";
      case "CANCELLED":
        return "bg-red-100 text-red-800 border-red-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  // Show loading spinner while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-purple-50/30">
        <LoadingSpinner text="Loading..." />
      </div>
    );
  }

  // Restrict access to Company Admin or Higher
  if (!user || !isCompanyAdminOrHigher(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-purple-50/30">
        <div className="text-center max-w-md mx-auto p-8 bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 shadow-xl">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">
            Access Denied
          </h2>
          <p className="text-slate-600 mb-6">
            Appointments are only available for Company Admins.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all font-semibold shadow-lg"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-purple-50/30">
      {/* Header with Gradient */}
      <div className="bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 shadow-xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iYSIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVHJhbnNmb3JtPSJyb3RhdGUoNDUpIj48cGF0aCBkPSJNLTEwIDMwaDYwdjJoLTYweiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNhKSIvPjwvc3ZnPg==')] opacity-30"></div>
        <div className="relative max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm shadow-lg">
                <Calendar className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Appointment Management
                </h1>
                <p className="text-white/80 mt-0.5">
                  View and manage citizen appointments
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">

              <button
                onClick={() => router.back()}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all border border-white/30 backdrop-blur-sm"
              >
                <ArrowLeft className="w-5 h-5" />
                Back
              </button>
              <div className="text-right bg-white/10 px-4 py-2 rounded-xl border border-white/20 backdrop-blur-sm">
                <p className="text-sm text-white/70">Total</p>
                <p className="text-2xl font-bold text-white">
                  {appointments.length}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Filters Card */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 shadow-xl p-6 mb-6">
          {/* Filters */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Search */}
            <div className="relative col-span-2 md:col-span-1 lg:col-span-2">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search by name or ID..."
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            {/* Status */}
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="SCHEDULED">🔵 Scheduled</option>
              <option value="CONFIRMED">✅ Confirmed</option>
              <option value="COMPLETED">✅ Completed</option>
              <option value="CANCELLED">❌ Cancelled</option>
            </select>

            {/* Department */}
            <select
              value={filters.department}
              onChange={(e) =>
                setFilters({ ...filters, department: e.target.value })
              }
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Departments</option>
              {departments.map((dept) => (
                <option key={dept._id} value={dept._id}>
                  {dept.name}
                </option>
              ))}
            </select>

            {/* Date Filter */}
            <select
              value={filters.dateFilter}
              onChange={(e) =>
                setFilters({ ...filters, dateFilter: e.target.value })
              }
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Dates</option>
              <option value="today">📅 Today</option>
              <option value="thisWeek">📆 This Week</option>
              <option value="thisMonth">🗓️ This Month</option>
              <option value="upcoming">⏳ Upcoming</option>
              <option value="past">📋 Past</option>
            </select>

            {/* Assignment Filter */}
            <select
              value={filters.assignment}
              onChange={(e) =>
                setFilters({ ...filters, assignment: e.target.value })
              }
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Assignments</option>
              <option value="assigned">✅ Assigned</option>
              <option value="unassigned">⏳ Unassigned</option>
            </select>

            {/* Reset Button */}
            <button
              onClick={() =>
                setFilters({
                  status: "all",
                  department: "all",
                  assignment: "all",
                  dateFilter: "all",
                  search: "",
                })
              }
              className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center"
            >
              <Filter className="w-4 h-4 mr-2" />
              Reset
            </button>
          </div>
        </div>

        {/* Appointments Table */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 shadow-xl overflow-hidden">
          {loading ? (
            <div className="p-16 text-center">
              <LoadingSpinner text="Loading appointments..." />
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 text-lg">No appointments found</p>
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[1400px]">
                <thead className="sticky top-0 z-10 bg-gradient-to-r from-purple-50 via-fuchsia-50 to-pink-50 border-b border-purple-100">
                  <tr>
                    <th className="px-4 py-4 text-center text-[15px] font-bold text-purple-700 uppercase tracking-wide">
                      Sr. No.
                    </th>
                    <th className="px-6 py-4 text-left text-[15px] font-bold text-purple-700 uppercase tracking-wide">
                      Appointment ID
                    </th>
                    <th className="px-6 py-4 text-left text-[15px] font-bold text-purple-700 uppercase tracking-wide">
                      Citizen Information
                    </th>
                    <th className="px-6 py-4 text-left text-[15px] font-bold text-purple-700 uppercase tracking-wide">
                      Department & Purpose
                    </th>
                    <th className="px-6 py-4 text-left text-[15px] font-bold text-purple-700 uppercase tracking-wide">
                      Scheduled At
                    </th>
                    <th className="px-6 py-4 text-left text-[15px] font-bold text-purple-700 uppercase tracking-wide">
                      Assigned To
                    </th>
                    <th className="px-6 py-4 text-left text-[15px] font-bold text-purple-700 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-6 py-4 text-left text-[15px] font-bold text-purple-700 uppercase tracking-wide">
                      Created
                    </th>
                    <th className="px-6 py-4 text-center text-[15px] font-bold text-purple-700 uppercase tracking-wide">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredAppointments.map((appointment, index) => (
                    <tr
                      key={appointment._id}
                      className="hover:bg-gradient-to-r hover:from-purple-50/50 hover:to-pink-50/50 transition-all duration-200 group/row"
                    >
                      <td className="px-4 py-4 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-purple-100 to-fuchsia-100 text-purple-700 text-sm font-bold shadow-sm">
                          {index + 1}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleViewDetails(appointment)}
                            className="font-bold text-sm text-purple-700 text-left hover:underline break-all"
                          >
                            {appointment.appointmentId}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleViewDetails(appointment)}
                            className="text-purple-600 hover:text-purple-800 font-bold text-left hover:underline break-words whitespace-normal"
                          >
                            {appointment.citizenName}
                          </button>
                          <div className="flex items-center text-sm text-gray-500 mt-1 break-all">
                            <Phone className="w-3.5 h-3.5 mr-1 text-gray-400" />
                            {appointment.citizenPhone}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col space-y-1">
                          <span className="text-sm font-semibold text-gray-900 break-words whitespace-normal">
                            {appointment.departmentId &&
                            typeof appointment.departmentId === "object"
                              ? (appointment.departmentId as any).name
                              : "General Department"}
                          </span>
                          <p className="text-[15px] text-gray-600 italic break-words whitespace-normal">
                            {appointment.purpose}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center justify-center w-14 h-14 bg-gradient-to-br from-purple-100 to-fuchsia-100 rounded-xl border border-purple-200/50 shadow-sm">
                            <span className="text-[14px] font-bold text-purple-600 uppercase">
                              {formatDate(appointment.appointmentDate, {
                                month: "short",
                              })}
                            </span>
                            <span className="text-xl font-black text-purple-700 leading-tight">
                              {new Date(appointment.appointmentDate).getDate()}
                            </span>
                          </div>
                          <div className="flex flex-col justify-center">
                            <span className="text-xs font-semibold text-gray-800">
                              {formatDate(appointment.appointmentDate, {
                                weekday: "long",
                              })}
                            </span>
                            <span className="text-[15px] text-gray-500">
                              {formatDate(appointment.appointmentDate, {
                                year: "numeric",
                              })}
                            </span>
                            {appointment.appointmentTime && (
                              <div className="flex items-center gap-1 mt-1">
                                <Clock className="w-3.5 h-3.5 text-amber-500" />
                                <span className="text-xs font-bold text-amber-600">
                                  {(() => {
                                    const time = appointment.appointmentTime;
                                    const [hours, minutes] = time.split(":");
                                    const hour = parseInt(hours, 10);
                                    const minute = minutes || "00";
                                    const period = hour >= 12 ? "PM" : "AM";
                                    const displayHour =
                                      hour > 12
                                        ? hour - 12
                                        : hour === 0
                                          ? 12
                                          : hour;
                                    return `${displayHour}:${minute} ${period}`;
                                  })()}
                                </span>
                                <span className="text-[14px] text-gray-400">
                                  (
                                  {(() => {
                                    const time = appointment.appointmentTime;
                                    const [hours] = time.split(":");
                                    const hour = parseInt(hours, 10);
                                    if (hour >= 6 && hour < 12)
                                      return "Morning";
                                    if (hour >= 12 && hour < 17)
                                      return "Afternoon";
                                    if (hour >= 17 && hour < 21)
                                      return "Evening";
                                    return "Night";
                                  })()}
                                  )
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {appointment.assignedTo ? (
                          <div className="flex flex-col">
                            <div className="flex items-center">
                              <UserPlus className="w-3.5 h-3.5 mr-1.5 text-green-600" />
                              <span className="text-sm font-semibold text-gray-900">
                                {typeof appointment.assignedTo === "object" && appointment.assignedTo
                                  ? `${(appointment.assignedTo as any).firstName || ""} ${(appointment.assignedTo as any).lastName || ""}`.trim() || "Inactive User"
                                  : (appointment.assignedTo as any)}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-100 whitespace-nowrap">
                            Pending Assignment
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-[15px] font-bold border uppercase tracking-wider ${getStatusColor(appointment.status)}`}
                        >
                          {appointment.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <div className="flex flex-col text-[15px]">
                          <span className="font-semibold">
                            {formatDate(appointment.createdAt)}
                          </span>
                          <span className="text-gray-400">
                            {formatISTTime(appointment.createdAt)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-1">
                          {isCompanyAdminOrHigher(user) &&
                            appointment.status !== "COMPLETED" &&
                            appointment.status !== "CANCELLED" && (
                              <button
                                onClick={() => handleAssignClick(appointment)}
                                title="Assign Officer"
                                className="p-2 rounded-lg text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition-all duration-200"
                              >
                                <UserPlus className="w-4 h-4" />
                              </button>
                            )}
                          <button
                            onClick={() => handleViewDetails(appointment)}
                            title="View Full Details"
                            className="p-2 rounded-lg text-purple-600 hover:text-purple-700 hover:bg-purple-50 border border-transparent hover:border-purple-200 transition-all duration-200"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Citizen Details Modal */}
      <CitizenDetailsModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedAppointment(null);
        }}
        appointment={selectedAppointment}
      />

      {/* Assignment Dialog */}
      <AssignmentDialog
        isOpen={assignDialogOpen}
        onClose={() => {
          setAssignDialogOpen(false);
          setAppointmentToAssign(null);
        }}
        onAssign={handleAssign}
        itemType="appointment"
        itemId={appointmentToAssign?._id || ""}
        companyId={companyId}
        allDepartments={departments}
        currentAssignee={appointmentToAssign?.assignedTo}
        currentDepartmentId={
          appointmentToAssign?.departmentId &&
          typeof appointmentToAssign.departmentId === "object"
            ? (appointmentToAssign.departmentId as any)._id
            : appointmentToAssign?.departmentId
        }
        currentSubDepartmentId={
          appointmentToAssign?.subDepartmentId &&
          typeof appointmentToAssign.subDepartmentId === "object"
            ? (appointmentToAssign.subDepartmentId as any)._id
            : appointmentToAssign?.subDepartmentId
        }
        userRole={user?.role}
        userDepartmentId={
          user?.departmentId && typeof user.departmentId === "object"
            ? (user.departmentId as any)._id
            : user?.departmentId
        }
        currentUserId={user?.id}
      />
    </div>
  );
}
