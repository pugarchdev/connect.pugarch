"use client";

import React, { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  Zap,
  Lock,
  Search,
  Building2,
  Phone,
  BarChart3,
  ArrowUpRight,
  Filter,
  RefreshCw,
  Calendar,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { CompanyMessageStat, MessageAnalyticsParams } from "@/lib/api/analytics";

interface CompanyMessageAnalyticsProps {
  companies: CompanyMessageStat[];
  loading?: boolean;
  onRefresh?: () => void;
  onOpenCompanyDashboard?: (companyId: string) => void;
  onFilterChange?: (params: MessageAnalyticsParams) => void;
}

export default function CompanyMessageAnalytics({
  companies,
  loading = false,
  onRefresh,
  onOpenCompanyDashboard,
  onFilterChange,
}: CompanyMessageAnalyticsProps) {
  // Filters State
  const [selectedPeriod, setSelectedPeriod] = useState<"all" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [volumeFilter, setVolumeFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"total" | "service" | "utility" | "auth" | "name">("total");
  const [showDateRange, setShowDateRange] = useState(false);

  // Timeframe change handler
  const handlePeriodChange = (period: "all" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly") => {
    setSelectedPeriod(period);
    setStartDate("");
    setEndDate("");
    onFilterChange?.({
      period,
      companyId: companyFilter !== "all" ? companyFilter : undefined,
    });
  };

  // Quick Preset Helper
  const applyPreset = (preset: "today" | "yesterday" | "last7" | "thisMonth" | "lastMonth" | "thisYear" | "all") => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (preset === "all") {
      handleResetDateRange();
      return;
    }

    let start = "";
    let end = toYMD(now);

    if (preset === "today") {
      start = toYMD(now);
    } else if (preset === "yesterday") {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      start = toYMD(y);
      end = toYMD(y);
    } else if (preset === "last7") {
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      start = toYMD(d7);
    } else if (preset === "thisMonth") {
      start = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    } else if (preset === "lastMonth") {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lme = new Date(now.getFullYear(), now.getMonth(), 0);
      start = toYMD(lm);
      end = toYMD(lme);
    } else if (preset === "thisYear") {
      start = `${now.getFullYear()}-01-01`;
    }

    setStartDate(start);
    setEndDate(end);
    setSelectedPeriod("all");
    setShowDateRange(true);
    onFilterChange?.({
      startDate: start,
      endDate: end,
      companyId: companyFilter !== "all" ? companyFilter : undefined,
    });
  };

  // Date range apply handler
  const handleApplyDateRange = () => {
    if (startDate || endDate) {
      setSelectedPeriod("all");
      onFilterChange?.({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        companyId: companyFilter !== "all" ? companyFilter : undefined,
      });
    }
  };

  // Date range reset handler
  const handleResetDateRange = () => {
    setStartDate("");
    setEndDate("");
    setSelectedPeriod("all");
    onFilterChange?.({
      period: "all",
      companyId: companyFilter !== "all" ? companyFilter : undefined,
    });
  };

  // Company filter handler (syncs backend and frontend)
  const handleCompanyChange = (cId: string) => {
    setCompanyFilter(cId);
    onFilterChange?.({
      period: selectedPeriod,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      companyId: cId !== "all" ? cId : undefined,
    });
  };

  // Reset all filters to default
  const handleResetAllFilters = () => {
    setSelectedPeriod("all");
    setStartDate("");
    setEndDate("");
    setCompanyFilter("all");
    setStatusFilter("all");
    setVolumeFilter("all");
    setSearchTerm("");
    setSortBy("total");
    setShowDateRange(false);
    onFilterChange?.({ period: "all" });
  };

  const hasActiveFilters =
    selectedPeriod !== "all" ||
    Boolean(startDate || endDate) ||
    companyFilter !== "all" ||
    statusFilter !== "all" ||
    volumeFilter !== "all" ||
    Boolean(searchTerm.trim());

  // Client-side filtering & sorting
  const filteredCompanies = useMemo(() => {
    let list = [...companies];

    // Filter by Organization dropdown
    if (companyFilter !== "all") {
      list = list.filter((c) => c._id === companyFilter);
    }

    // Filter by Status dropdown
    if (statusFilter === "active") {
      list = list.filter((c) => c.isActive);
    } else if (statusFilter === "inactive") {
      list = list.filter((c) => !c.isActive);
    }

    // Filter by Volume
    if (volumeFilter === "active") {
      list = list.filter((c) => c.total > 0);
    } else if (volumeFilter === "high") {
      list = list.filter((c) => c.total >= 100);
    } else if (volumeFilter === "zero") {
      list = list.filter((c) => c.total === 0);
    }

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.companyId.toLowerCase().includes(term) ||
          (c.phoneNumber && c.phoneNumber.includes(term))
      );
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === "total") return b.total - a.total;
      if (sortBy === "service") return b.service - a.service;
      if (sortBy === "utility") return b.utility - a.utility;
      if (sortBy === "auth") return b.authentication - a.authentication;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return 0;
    });

    return list;
  }, [companies, companyFilter, statusFilter, volumeFilter, searchTerm, sortBy]);

  // Total summary of current view
  const currentViewTotals = useMemo(() => {
    return filteredCompanies.reduce(
      (acc, c) => ({
        total: acc.total + c.total,
        service: acc.service + c.service,
        utility: acc.utility + c.utility,
        auth: acc.auth + c.authentication,
      }),
      { total: 0, service: 0, utility: 0, auth: 0 }
    );
  }, [filteredCompanies]);

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
      {/* Dark Header with Title and Quick Timeframe Tabs */}
      <CardHeader className="bg-slate-900 text-white p-5 border-b border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 shadow-inner">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                Organization Message Analytics & Insights
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {selectedPeriod.toUpperCase()}
                </span>
              </CardTitle>
              <CardDescription className="text-slate-400 text-xs mt-0.5 font-medium">
                Detailed consumption breakdown of Service, Utility, and Authentication messages per organization
              </CardDescription>
            </div>
          </div>

          {/* Timeframe Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-xl p-1 flex items-center gap-1">
              {[
                { id: "all", label: "All Time" },
                { id: "daily", label: "Daily" },
                { id: "weekly", label: "Weekly" },
                { id: "monthly", label: "Monthly" },
                { id: "quarterly", label: "Quarterly" },
                { id: "yearly", label: "Yearly" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => handlePeriodChange(t.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    selectedPeriod === t.id && !startDate && !endDate
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-white hover:bg-slate-700/50"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <Button
              onClick={() => setShowDateRange(!showDateRange)}
              variant="outline"
              size="sm"
              className={`h-9 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                showDateRange || startDate || endDate
                  ? "bg-blue-600 text-white border-blue-500"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Date Filter</span>
            </Button>

            {onRefresh && (
              <Button
                onClick={onRefresh}
                variant="ghost"
                size="sm"
                disabled={loading}
                className="h-9 w-9 p-0 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 shrink-0"
                title="Refresh analytics"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
        </div>

        {/* Date Range Picker Tray with Quick Presets */}
        {showDateRange && (
          <div className="mt-4 pt-4 border-t border-slate-800 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Quick Preset Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Quick Presets:</span>
              {[
                { id: "today", label: "Today" },
                { id: "yesterday", label: "Yesterday" },
                { id: "last7", label: "Last 7 Days" },
                { id: "thisMonth", label: "This Month" },
                { id: "lastMonth", label: "Last Month" },
                { id: "thisYear", label: "This Year" },
                { id: "all", label: "All Time" },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id as any)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700/60"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom Date Inputs */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-bold uppercase">From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-bold uppercase">To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <Button
                onClick={handleApplyDateRange}
                disabled={!startDate && !endDate}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl h-8 px-4 shadow-sm"
              >
                Apply Filter
              </Button>

              {(startDate || endDate) && (
                <Button
                  onClick={handleResetDateRange}
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-400 hover:text-white rounded-xl h-8 px-2 flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  Clear Dates
                </Button>
              )}
            </div>
          </div>
        )}
      </CardHeader>

      {/* Sub-header Filter Toolbar */}
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Search Input */}
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search company, code or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Company Filter Dropdown (Synced with backend & top KPI cards) */}
          <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-xl px-2 py-1 shadow-sm">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={companyFilter}
              onChange={(e) => handleCompanyChange(e.target.value)}
              className="bg-transparent text-slate-800 text-xs font-semibold focus:outline-none cursor-pointer max-w-[150px] truncate"
            >
              <option value="all">All Organizations</option>
              {companies.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Dropdown */}
          <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-xl px-2 py-1 shadow-sm">
            <span className="text-slate-400 font-bold text-[10px] uppercase">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-slate-800 text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>

          {/* Volume Dropdown */}
          <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-xl px-2 py-1 shadow-sm">
            <span className="text-slate-400 font-bold text-[10px] uppercase">Volume:</span>
            <select
              value={volumeFilter}
              onChange={(e) => setVolumeFilter(e.target.value)}
              className="bg-transparent text-slate-800 text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="all">All Volumes</option>
              <option value="active">With Activity (&gt; 0)</option>
              <option value="high">High Volume (&gt;= 100)</option>
              <option value="zero">Zero Activity (0 msgs)</option>
            </select>
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-xl px-2 py-1 shadow-sm">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-slate-800 text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="total">Sort: Total Messages</option>
              <option value="service">Sort: Service Messages</option>
              <option value="utility">Sort: Utility Messages</option>
              <option value="auth">Sort: Authentication</option>
              <option value="name">Sort: Name (A-Z)</option>
            </select>
          </div>
        </div>

        {/* View Count Badges & Active Filter Reset */}
        <div className="flex items-center gap-2 shrink-0">
          {hasActiveFilters && (
            <Button
              onClick={handleResetAllFilters}
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-[11px] font-bold rounded-lg border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
            >
              <X className="w-3 h-3 mr-1 text-amber-700" />
              Reset All Filters
            </Button>
          )}

          <span className="text-slate-500 font-semibold">
            {filteredCompanies.length} Organizations
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 font-mono font-bold text-xs">
            {currentViewTotals.total.toLocaleString()} Msgs in View
          </span>
        </div>
      </div>

      {/* Zero Activity Notice Banner when filtered */}
      {currentViewTotals.total === 0 && (selectedPeriod !== "all" || Boolean(startDate || endDate)) && (
        <div className="bg-amber-50/90 border-b border-amber-200/80 px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
            <span className="font-medium">
              No WhatsApp messages recorded in this timeframe ({startDate ? `${startDate} to ${endDate}` : selectedPeriod}).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => applyPreset("last7")}
              className="font-bold underline hover:text-amber-950 text-xs text-amber-800"
            >
              View Last 7 Days
            </button>
            <span className="text-amber-300">•</span>
            <button
              onClick={handleResetAllFilters}
              className="font-bold underline hover:text-amber-950 text-xs text-blue-700 hover:text-blue-900"
            >
              View All Time (16,496 Msgs)
            </button>
          </div>
        </div>
      )}

      {/* Analytics Table */}
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                <th className="py-3.5 px-5">Organization</th>
                <th className="py-3.5 px-4 text-center">Service Msgs</th>
                <th className="py-3.5 px-4 text-center">Utility Msgs</th>
                <th className="py-3.5 px-4 text-center">Authentication</th>
                <th className="py-3.5 px-4 text-center">Total Messages</th>
                <th className="py-3.5 px-5 min-w-[200px]">Distribution</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="font-bold text-sm text-slate-500">No organizations match current filters</p>
                    <p className="text-xs text-slate-400 mt-0.5">Try clearing or adjusting your search & filters</p>
                    <Button
                      onClick={handleResetAllFilters}
                      size="sm"
                      className="mt-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl h-8 px-4"
                    >
                      Reset All Filters
                    </Button>
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((comp) => {
                  const totalComp = comp.total || 0;
                  const servicePct = totalComp > 0 ? (comp.service / totalComp) * 100 : 0;
                  const utilityPct = totalComp > 0 ? (comp.utility / totalComp) * 100 : 0;
                  const authPct = totalComp > 0 ? (comp.authentication / totalComp) * 100 : 0;

                  return (
                    <tr
                      key={comp._id}
                      className="hover:bg-slate-50/70 transition-colors group"
                    >
                      {/* Organization Info */}
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-black text-slate-700 text-xs shadow-sm">
                            {comp.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-sm">{comp.name}</span>
                              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-mono text-[10px] font-bold uppercase">
                                {comp.companyId}
                              </span>
                              {!comp.isActive && (
                                <span className="px-1.5 py-0.5 bg-rose-50 text-rose-600 border border-rose-100 rounded text-[9px] font-black uppercase">
                                  Inactive
                                </span>
                              )}
                            </div>
                            {comp.phoneNumber && (
                              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono mt-0.5">
                                <Phone className="w-2.5 h-2.5" />
                                <span>{comp.phoneNumber}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Service Messages Count */}
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 border border-sky-100 font-bold font-mono text-xs">
                          <MessageSquare className="w-3 h-3 text-sky-500" />
                          {comp.service.toLocaleString()}
                        </span>
                      </td>

                      {/* Utility Messages Count */}
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold font-mono text-xs">
                          <Zap className="w-3 h-3 text-emerald-500" />
                          {comp.utility.toLocaleString()}
                        </span>
                      </td>

                      {/* Authentication Messages Count */}
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-100 font-bold font-mono text-xs">
                          <Lock className="w-3 h-3 text-purple-500" />
                          {comp.authentication.toLocaleString()}
                        </span>
                      </td>

                      {/* Total Messages Count */}
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center px-3 py-1 rounded-xl bg-slate-900 text-white font-black font-mono text-xs shadow-sm">
                          {totalComp.toLocaleString()}
                        </span>
                      </td>

                      {/* Distribution Bar */}
                      <td className="py-4 px-5">
                        <div className="space-y-1.5">
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                            {servicePct > 0 && (
                              <div
                                style={{ width: `${servicePct}%` }}
                                className="bg-sky-500 h-full"
                                title={`Service: ${comp.service} (${Math.round(servicePct)}%)`}
                              />
                            )}
                            {utilityPct > 0 && (
                              <div
                                style={{ width: `${utilityPct}%` }}
                                className="bg-emerald-500 h-full"
                                title={`Utility: ${comp.utility} (${Math.round(utilityPct)}%)`}
                              />
                            )}
                            {authPct > 0 && (
                              <div
                                style={{ width: `${authPct}%` }}
                                className="bg-purple-500 h-full"
                                title={`Authentication: ${comp.authentication} (${Math.round(authPct)}%)`}
                              />
                            )}
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                            <span className="flex items-center gap-1 text-sky-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                              {Math.round(servicePct)}% Svc
                            </span>
                            <span className="flex items-center gap-1 text-emerald-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              {Math.round(utilityPct)}% Util
                            </span>
                            <span className="flex items-center gap-1 text-purple-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                              {Math.round(authPct)}% Auth
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-4 px-4 text-right">
                        {onOpenCompanyDashboard && (
                          <Button
                            onClick={() => onOpenCompanyDashboard(comp._id)}
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2.5 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 font-bold rounded-lg"
                          >
                            Dashboard
                            <ArrowUpRight className="w-3 h-3 ml-1" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
