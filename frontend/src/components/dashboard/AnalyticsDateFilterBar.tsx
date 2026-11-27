"use client";

import React, { useState, useEffect, useId, useRef } from "react";
import { 
  RotateCcw, 
  Check, 
  CalendarRange, 
  Filter,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getDefaultCustomRange,
  useCustomDateRangeDraft,
} from "@/lib/utils/dateRange";

export type PeriodType = "week" | "month" | "quarter" | "year" | "all" | "custom";

export interface AnalyticsDateFilterState {
  period: PeriodType;
  startDate?: string;
  endDate?: string;
}

interface AnalyticsDateFilterBarProps {
  currentFilters: AnalyticsDateFilterState;
  onFilterChange: (filters: AnalyticsDateFilterState) => void;
  loading?: boolean;
  className?: string;
}

const PERIOD_OPTIONS: Array<{ key: PeriodType; label: string; badge: string; description: string }> = [
  { key: "week", label: "Week", badge: "7D", description: "Past 7 days" },
  { key: "month", label: "Month", badge: "1M", description: "Past 30 days" },
  { key: "quarter", label: "Quarter", badge: "1Q", description: "Past 90 days" },
  { key: "year", label: "Year", badge: "1Y", description: "Past 365 days" },
  { key: "all", label: "All Time", badge: "All", description: "Cumulative history" },
  { key: "custom", label: "Custom", badge: "📅", description: "Date range" },
];

export const AnalyticsDateFilterBar: React.FC<AnalyticsDateFilterBarProps> = ({
  currentFilters,
  onFilterChange,
  loading = false,
  className = "",
}) => {
  const appliedPeriod = currentFilters.period;
  const appliedStart = currentFilters.startDate || "";
  const appliedEnd = currentFilters.endDate || "";
  const isCustomPeriod = appliedPeriod === "custom";

  const startInputId = useId();
  const endInputId = useId();

  const [showCustomPicker, setShowCustomPicker] = useState(isCustomPeriod);
  const actionLockRef = useRef(false);
  const {
    localStart,
    localEnd,
    setLocalStart,
    setLocalEnd,
    handleStartDateChange,
    isRangeValid,
  } = useCustomDateRangeDraft({
    appliedActive: isCustomPeriod,
    appliedStart,
    appliedEnd,
  });

  useEffect(() => {
    setShowCustomPicker(isCustomPeriod);
  }, [isCustomPeriod]);

  useEffect(() => {
    if (!loading) {
      actionLockRef.current = false;
    }
  }, [loading]);

  const handlePeriodSelect = (period: PeriodType) => {
    if (loading || actionLockRef.current) return;

    if (period === "custom") {
      setShowCustomPicker(true);
      if (isCustomPeriod) {
        return;
      }

      const defaults = getDefaultCustomRange();
      const nextStart = localStart || defaults.startDate;
      const nextEnd = localEnd || defaults.endDate;
      setLocalStart(nextStart);
      setLocalEnd(nextEnd);

      actionLockRef.current = true;
      queueMicrotask(() => {
        if (!loading) actionLockRef.current = false;
      });
      onFilterChange({
        period: "custom",
        startDate: nextStart,
        endDate: nextEnd,
      });
    } else {
      if (period === appliedPeriod) return;
      setShowCustomPicker(false);
      setLocalStart("");
      setLocalEnd("");
      actionLockRef.current = true;
      queueMicrotask(() => {
        if (!loading) actionLockRef.current = false;
      });
      onFilterChange({
        period,
        startDate: "",
        endDate: "",
      });
    }
  };

  const handleCustomApply = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading || actionLockRef.current || !isRangeValid) return;

    actionLockRef.current = true;
    queueMicrotask(() => {
      if (!loading) actionLockRef.current = false;
    });
    onFilterChange({
      period: "custom",
      startDate: localStart,
      endDate: localEnd,
    });
  };

  const handleReset = () => {
    if (loading || actionLockRef.current) return;
    actionLockRef.current = true;
    queueMicrotask(() => {
      if (!loading) actionLockRef.current = false;
    });
    setLocalStart("");
    setLocalEnd("");
    setShowCustomPicker(false);
    onFilterChange({
      period: "week",
      startDate: "",
      endDate: "",
    });
  };

  // Human readable label for active filter
  const getActiveFilterLabel = () => {
    switch (currentFilters.period) {
      case "week":
        return "Last 7 Days (Daily Activity)";
      case "month":
        return "Last 30 Days (Monthly Run)";
      case "quarter":
        return "Quarterly (Last 90 Days)";
      case "year":
        return "Yearly (Last 12 Months)";
      case "all":
        return "All-Time Recorded Data";
      case "custom":
        if (currentFilters.startDate && currentFilters.endDate) {
          return `${currentFilters.startDate} → ${currentFilters.endDate}`;
        }
        return "Custom Range";
      default:
        return "Last 7 Days";
    }
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3.5 space-y-3 transition-all ${className}`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left: Title & Filter Label */}
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100/60 flex items-center justify-center text-indigo-600 shadow-sm shrink-0">
            <Filter className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                Analytics Timeline Filter
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-extrabold uppercase bg-indigo-50 text-indigo-700 border border-indigo-100 inline-flex items-center gap-1.5 max-w-full">
                {loading && <Loader2 className="w-3 h-3 animate-spin text-indigo-600 shrink-0" />}
                <span className="truncate">{loading ? "Updating..." : getActiveFilterLabel()}</span>
              </span>
            </div>
            <p className="text-[11px] sm:text-[12px] text-slate-400 font-medium mt-0.5">
              Filters KPI counters, grievance trends, operational status & department distribution
            </p>
          </div>
        </div>

        {/* Right: Pill Segmented Options */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 w-full md:w-auto">
          <div className="grid grid-cols-3 sm:flex sm:items-center gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 shadow-inner w-full sm:w-auto">
            {PERIOD_OPTIONS.map((opt) => {
              const isActive = currentFilters.period === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={loading}
                  onClick={() => handlePeriodSelect(opt.key)}
                  className={`px-2 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5 whitespace-nowrap disabled:pointer-events-none ${
                    isActive
                      ? "bg-white text-indigo-700 shadow-sm font-black border border-indigo-100"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
                  } ${loading ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
                  title={opt.description}
                >
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          {currentFilters.period !== "week" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={handleReset}
              className="h-8 px-2 text-xs font-bold text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl disabled:opacity-50 self-start sm:self-auto"
              title="Reset to 7 Days"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Expandable Custom Date Range Selector */}
      {showCustomPicker && (
        <form 
          onSubmit={handleCustomApply}
          className="pt-2.5 mt-2 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5 sm:gap-3 animate-in fade-in slide-in-from-top-1 duration-200 min-w-0"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600 sm:pb-1.5 shrink-0">
            <CalendarRange className="w-4 h-4 text-indigo-500" />
            <span>Select Range:</span>
          </div>

          <div className="grid grid-cols-1 sm:flex sm:items-end gap-2 flex-1 min-w-0 w-full sm:max-w-lg">
            <div className="flex-1 min-w-0">
              <label htmlFor={startInputId} className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">Start Date</label>
              <input
                id={startInputId}
                type="date"
                value={localStart}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="w-full min-w-0 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>
            <span className="hidden sm:inline text-slate-400 font-bold pb-1.5">to</span>
            <div className="flex-1 min-w-0">
              <label htmlFor={endInputId} className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">End Date</label>
              <input
                id={endInputId}
                type="date"
                value={localEnd}
                min={localStart || undefined}
                onChange={(e) => setLocalEnd(e.target.value)}
                className="w-full min-w-0 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="submit"
              size="sm"
              disabled={!localStart || !localEnd || localStart > localEnd || loading}
              className="w-full sm:w-auto h-8 px-4 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 mr-1" />
                  Apply Filter
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};

export default AnalyticsDateFilterBar;
