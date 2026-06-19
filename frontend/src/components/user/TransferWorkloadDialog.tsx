"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { User, userAPI } from "@/lib/api/user";
import { Department, departmentAPI } from "@/lib/api/department";
import toast from "react-hot-toast";
import { ArrowRightLeft, Loader2, Search, ChevronDown, X, Building2, Users, Check, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TransferWorkloadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  sourceUser: User | null;
}

// ─── Searchable Dropdown Component ─────────────────────────────────────────────
interface SearchableDropdownProps {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  items: { id: string; label: string; sublabel?: string }[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  icon?: React.ReactNode;
}

function SearchableDropdown({
  label,
  placeholder,
  searchPlaceholder,
  items,
  value,
  onChange,
  loading = false,
  disabled = false,
  emptyMessage = "No items found",
  icon,
}: SearchableDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.sublabel && item.sublabel.toLowerCase().includes(q))
    );
  }, [items, search]);

  const selectedItem = items.find((i) => i.id === value);

  return (
    <div className="space-y-1.5" ref={dropdownRef}>
      <Label className="text-[14px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 leading-none mb-1.5">
        {icon}
        {label}
      </Label>
      <div className="relative">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => {
            setOpen(!open);
            setSearch("");
          }}
          className={`w-full flex items-center gap-2 justify-between px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-[15px] font-bold uppercase tracking-wide shadow-sm transition-all
            ${disabled ? "bg-slate-50 text-slate-300 cursor-not-allowed" : "hover:border-indigo-300 hover:shadow-md focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-700"}
          `}
        >
          <span className={`text-left truncate ${!selectedItem ? "text-slate-400" : ""}`}>
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                Loading...
              </span>
            ) : selectedItem ? (
              selectedItem.label
            ) : (
              placeholder
            )}
          </span>
          <div className="flex items-center gap-1">
            {value && !disabled && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                  setOpen(false);
                }}
                className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </div>
        </button>

        {open && !disabled && (
          <div className="absolute z-[110] w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top">
            {/* Search input */}
            <div className="p-2.5 border-b border-slate-100 bg-slate-50/50">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pl-9 pr-3.5 py-2 text-[15px] bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-bold uppercase tracking-tight placeholder:normal-case"
                />
                {search && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSearch(""); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-100 rounded-full transition-colors"
                  >
                    <X className="w-3 h-3 text-slate-400 hover:text-slate-600" />
                  </button>
                )}
              </div>
            </div>

            {/* Options list */}
            <div className="max-h-[220px] overflow-y-auto p-1.5 custom-scrollbar">
              {filtered.length === 0 ? (
                <div className="py-8 text-center flex flex-col items-center justify-center gap-2">
                  <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center">
                    <Search className="w-5 h-5 text-slate-200" />
                  </div>
                  <span className="text-[14px] font-black text-slate-400 uppercase tracking-widest leading-none">
                    {emptyMessage}
                  </span>
                </div>
              ) : (
                filtered.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      onChange(item.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`w-full flex items-center gap-3 justify-between px-3.5 py-2.5 text-[15px] font-bold uppercase tracking-wide rounded-xl transition-all text-left group
                      ${item.id === value
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200"
                        : "text-slate-600 hover:bg-slate-50 hover:text-indigo-600 hover:translate-x-1"
                      }
                    `}
                  >
                    <div>
                      <div className={`font-bold ${item.id === value ? "text-white" : "text-slate-700"}`}>{item.label}</div>
                      {item.sublabel && (
                        <div className={`text-[12px] font-bold uppercase tracking-widest mt-0.5 ${item.id === value ? "text-indigo-200" : "text-slate-400"}`}>{item.sublabel}</div>
                      )}
                    </div>
                    {item.id === value ? (
                      <Check className="w-3.5 h-3.5 text-white flex-shrink-0" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-indigo-400 flex-shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Dialog Component ─────────────────────────────────────────────────────

export default function TransferWorkloadDialog({
  isOpen,
  onClose,
  onSuccess,
  sourceUser,
}: TransferWorkloadDialogProps) {
  const [loading, setLoading] = useState(false);
  const [fetchingDepts, setFetchingDepts] = useState(false);
  const [fetchingUsers, setFetchingUsers] = useState(false);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [selectedMainDeptId, setSelectedMainDeptId] = useState<string>("");
  const [selectedSubDeptId, setSelectedSubDeptId] = useState<string>("");
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");

  // ── Helper: extract department ID from user's departmentId field ────────────
  const extractDeptInfo = (user: User | null) => {
    if (!user?.departmentId) return { mainDeptId: "", subDeptId: "" };

    if (typeof user.departmentId === "object") {
      const dept = user.departmentId;
      if (dept.parentDepartmentId) {
        // User belongs to a sub-department
        const parentId =
          typeof dept.parentDepartmentId === "object"
            ? dept.parentDepartmentId._id
            : dept.parentDepartmentId;
        return { mainDeptId: parentId, subDeptId: dept._id };
      }
      // User belongs to a main department
      return { mainDeptId: dept._id, subDeptId: "" };
    }

    // departmentId is just a string, we'll try to match it later
    return { mainDeptId: user.departmentId, subDeptId: "" };
  };

  // ── Load departments on open ───────────────────────────────────────────────
  useEffect(() => {
    async function loadDepartments() {
      if (!isOpen || !sourceUser) return;
      setFetchingDepts(true);
      try {
        const response = await departmentAPI.getAll({ listAll: true, limit: 500 });
        if (response.success) {
          const depts = response.data?.departments || [];
          setAllDepartments(depts);

          // Auto-detect main & sub department from source user
          const { mainDeptId, subDeptId } = extractDeptInfo(sourceUser);

          // If the detected mainDeptId is actually a sub-department, resolve its parent
          if (mainDeptId) {
            const matched = depts.find((d) => d._id === mainDeptId);
            if (matched?.parentDepartmentId) {
              // It's a sub-dept — parent is the main dept
              const parentId =
                typeof matched.parentDepartmentId === "object"
                  ? matched.parentDepartmentId._id
                  : matched.parentDepartmentId;
              setSelectedMainDeptId(parentId);
              setSelectedSubDeptId(matched._id);
            } else {
              setSelectedMainDeptId(mainDeptId);
              setSelectedSubDeptId(subDeptId);
            }
          }
        }
      } catch (error: any) {
        console.error("Failed to load departments:", error);
        toast.error("Could not load departments. Please try again.");
      } finally {
        setFetchingDepts(false);
      }
    }
    loadDepartments();
  }, [isOpen, sourceUser]);

  // ── Derive main & sub department lists ──────────────────────────────────────
  const mainDepartments = useMemo(
    () => allDepartments.filter((d) => !d.parentDepartmentId && d.isActive !== false),
    [allDepartments]
  );

  const subDepartments = useMemo(() => {
    if (!selectedMainDeptId) return [];
    return allDepartments.filter((d) => {
      if (!d.parentDepartmentId || d.isActive === false) return false;
      const parentId =
        typeof d.parentDepartmentId === "object"
          ? d.parentDepartmentId._id
          : d.parentDepartmentId;
      return parentId === selectedMainDeptId;
    });
  }, [allDepartments, selectedMainDeptId]);

  // ── Load users when department changes ──────────────────────────────────────
  useEffect(() => {
    async function loadUsers() {
      // Determine which department to query: prefer sub-dept, fallback to main
      const targetDeptId = selectedSubDeptId || selectedMainDeptId;
      if (!targetDeptId || !isOpen) {
        setAvailableUsers([]);
        return;
      }
      setFetchingUsers(true);
      setTargetUserId(""); // reset selection on department change
      try {
        const response = await userAPI.getAll({
          departmentId: targetDeptId,
          status: "active",
          limit: 500,
        });
        if (response.success) {
          const list = response.data?.users || [];
          // Exclude the source user
          const filtered = list.filter((u) => u._id !== sourceUser?._id);
          setAvailableUsers(filtered);
        }
      } catch (error: any) {
        console.error("Failed to load users:", error);
        toast.error("Could not load users for this department. Please try again.");
      } finally {
        setFetchingUsers(false);
      }
    }
    loadUsers();
  }, [selectedMainDeptId, selectedSubDeptId, isOpen, sourceUser]);

  // ── Handle main dept change (reset sub & user) ─────────────────────────────
  const handleMainDeptChange = (id: string) => {
    setSelectedMainDeptId(id);
    setSelectedSubDeptId("");
    setTargetUserId("");
  };

  // ── Handle sub dept change (reset user) ────────────────────────────────────
  const handleSubDeptChange = (id: string) => {
    setSelectedSubDeptId(id);
    setTargetUserId("");
  };

  // ── Reset on close ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setSelectedMainDeptId("");
      setSelectedSubDeptId("");
      setTargetUserId("");
      setRemarks("");
      setAvailableUsers([]);
      setAllDepartments([]);
    }
  }, [isOpen]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceUser) return;
    if (!targetUserId) {
      toast.error("Please select a recipient officer to transfer the workload to.");
      return;
    }
    if (!remarks.trim()) {
      toast.error("Please enter a reason for this transfer.");
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post("/assignments/transfer-workload", {
        sourceUserId: sourceUser._id,
        targetUserId,
        remarks,
      });

      if ((response as any).success) {
        toast.success((response as any).message || "Workload transferred successfully!");
        if (onSuccess) onSuccess();
        onClose();
      } else {
        toast.error(
          (response as any).message ||
            "Transfer failed. Please check both officers are active and try again."
        );
      }
    } catch (error: any) {
      console.error("Failed to transfer workload:", error);
      const errMsg =
        error.response?.data?.message ||
        error.message ||
        "Something went wrong while transferring the workload. Please try again or contact support.";
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  if (!sourceUser) return null;

  // ── Dropdown item lists ────────────────────────────────────────────────────
  const mainDeptItems = mainDepartments.map((d) => ({
    id: d._id,
    label: d.name,
    sublabel: d.userCount ? `${d.userCount} user(s)` : undefined,
  }));

  const subDeptItems = subDepartments.map((d) => ({
    id: d._id,
    label: d.name,
    sublabel: d.userCount ? `${d.userCount} user(s)` : undefined,
  }));

  const userItems = availableUsers.map((u) => ({
    id: u._id,
    label: `${u.firstName} ${u.lastName}`,
    sublabel: [u.userId, u.designation || u.role].filter(Boolean).join(" · "),
  }));

  // Source user display info
  const sourceUserDeptName = (() => {
    if (typeof sourceUser.departmentId === "object" && sourceUser.departmentId?.name) {
      return sourceUser.departmentId.name;
    }
    if (selectedMainDeptId) {
      const dept = allDepartments.find((d) => d._id === selectedMainDeptId);
      return dept?.name || "—";
    }
    return "—";
  })();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent hideClose className="sm:max-w-[580px] max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl bg-white p-0 border-0 flex flex-col">
        <div className="bg-slate-900 px-5 py-3.5 relative overflow-hidden flex-shrink-0 border-b border-slate-800">
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          ></div>
          <div className="relative flex items-center justify-between">
            <DialogHeader className="relative">
              <DialogTitle className="text-[15px] font-bold text-white flex items-center gap-2.5 uppercase tracking-tight">
                <div className="w-9 h-9 bg-indigo-500/30 rounded-xl flex items-center justify-center border border-indigo-500/50 shadow-inner backdrop-blur-sm">
                  <ArrowRightLeft className="w-4.5 h-4.5 text-indigo-50" />
                </div>
                Transfer Workload
              </DialogTitle>
              <DialogDescription className="text-[14px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                Reassign all pending grievances and appointments from this officer
              </DialogDescription>
            </DialogHeader>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all duration-300 border border-white/10 group cursor-pointer"
            >
              <X className="w-4.5 h-4.5 text-slate-400 group-hover:text-white transition-colors" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 custom-scrollbar">
            {/* Source officer card */}
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="text-[11px] font-black uppercase text-indigo-500 tracking-wider block mb-1">
                    Source Officer
                  </span>
                  <span className="font-bold text-slate-700 text-sm">
                    {sourceUser.firstName} {sourceUser.lastName}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                    Current Role
                  </span>
                  <span className="font-bold text-slate-700 text-sm truncate block">
                    {sourceUser.designation || sourceUser.role || "Operator"}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                    Department
                  </span>
                  <span className="font-bold text-slate-700 text-sm truncate block">
                    {sourceUserDeptName}
                  </span>
                </div>
              </div>
            </div>

            {/* Department Selection */}
            <div className="border border-slate-100 rounded-2xl p-4 space-y-4 bg-white shadow-sm">
              <p className="text-[12px] text-slate-400 uppercase font-black tracking-widest flex items-center gap-1.5 mb-1">
                <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                Select Target Department
              </p>

              {/* Main Department */}
              <SearchableDropdown
                label="Main Department *"
                placeholder="Select main department..."
                searchPlaceholder="Search departments..."
                items={mainDeptItems}
                value={selectedMainDeptId}
                onChange={handleMainDeptChange}
                loading={fetchingDepts}
                emptyMessage="No departments found"
                icon={<Building2 className="w-3.5 h-3.5 text-indigo-500" />}
              />

              {/* Sub-Department (only if main is selected and subs exist) */}
              {selectedMainDeptId && (
                <SearchableDropdown
                  label="Sub-Department"
                  placeholder={
                    subDepartments.length === 0
                      ? "No sub-departments available"
                      : "Select sub-department (optional)..."
                  }
                  searchPlaceholder="Search sub-departments..."
                  items={subDeptItems}
                  value={selectedSubDeptId}
                  onChange={handleSubDeptChange}
                  loading={fetchingDepts}
                  disabled={subDepartments.length === 0}
                  emptyMessage="No sub-departments found"
                  icon={<Building2 className="w-3.5 h-3.5 text-amber-500" />}
                />
              )}
            </div>

            {/* Recipient Officer */}
            <div className="border border-slate-100 rounded-2xl p-4 space-y-4 bg-white shadow-sm">
              <p className="text-[12px] text-slate-400 uppercase font-black tracking-widest flex items-center gap-1.5 mb-1">
                <Users className="w-3.5 h-3.5 text-emerald-500" />
                Select Recipient
              </p>

              <SearchableDropdown
                label="Recipient Officer *"
                placeholder={
                  !selectedMainDeptId
                    ? "Select a department first"
                    : availableUsers.length === 0 && !fetchingUsers
                    ? "No officers available in this department"
                    : "Choose recipient officer..."
                }
                searchPlaceholder="Search by name or ID..."
                items={userItems}
                value={targetUserId}
                onChange={setTargetUserId}
                loading={fetchingUsers}
                disabled={!selectedMainDeptId}
                emptyMessage={
                  !selectedMainDeptId
                    ? "Please select a department first"
                    : "No other active officers found in this department"
                }
                icon={<Users className="w-3.5 h-3.5 text-emerald-500" />}
              />

              {selectedMainDeptId &&
                availableUsers.length === 0 &&
                !fetchingUsers && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    No other active officers are available in this department to receive the
                    workload. Try selecting a different department or sub-department.
                  </p>
                )}
            </div>

            {/* Remarks */}
            <div className="space-y-1.5">
              <Label htmlFor="remarks" className="text-[14px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1.5 block">
                Transfer Remarks *
              </Label>
              <textarea
                id="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Officer transferred to another division, reassigning all active work to the new onboarded officer."
                className="flex min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:cursor-not-allowed disabled:opacity-50"
                required
              />
            </div>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex-shrink-0 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={loading}
              className="h-9 px-5 rounded-lg border-slate-200 text-slate-600 hover:bg-slate-100 text-[15px] font-bold uppercase tracking-widest"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || fetchingUsers || !targetUserId || !remarks.trim()}
              className="h-9 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[15px] font-bold uppercase tracking-widest shadow-md shadow-indigo-900/20 transition-all"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Transferring...
                </span>
              ) : (
                "Transfer Workload"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
