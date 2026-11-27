"use client";

import React, { useEffect, useId, useRef } from "react";
import { CalendarRange, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCustomDateRangeDraft } from "@/lib/utils/dateRange";

interface GrievanceCustomDateBarProps {
  visible: boolean;
  loading?: boolean;
  appliedStartDate?: string;
  appliedEndDate?: string;
  onApply: (range: { startDate: string; endDate: string }) => void;
  onClear: () => void;
}

export const GrievanceCustomDateBar: React.FC<GrievanceCustomDateBarProps> = ({
  visible,
  loading = false,
  appliedStartDate = "",
  appliedEndDate = "",
  onApply,
  onClear,
}) => {
  const startId = useId();
  const endId = useId();
  const actionLockRef = useRef(false);

  const {
    localStart,
    localEnd,
    setLocalEnd,
    handleStartDateChange,
    isRangeValid,
  } = useCustomDateRangeDraft({
    appliedActive: visible,
    appliedStart: appliedStartDate,
    appliedEnd: appliedEndDate,
    initializeDefaultsWhenEmpty: true,
  });

  useEffect(() => {
    if (!loading) {
      actionLockRef.current = false;
    }
  }, [loading]);

  if (!visible) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || actionLockRef.current || !isRangeValid) return;
    actionLockRef.current = true;
    queueMicrotask(() => {
      if (!loading) actionLockRef.current = false;
    });
    onApply({ startDate: localStart, endDate: localEnd });
  };

  const handleCancel = () => {
    if (loading || actionLockRef.current) return;
    actionLockRef.current = true;
    queueMicrotask(() => {
      if (!loading) actionLockRef.current = false;
    });
    onClear();
  };

  const hasAppliedRange = Boolean(appliedStartDate && appliedEndDate);

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2.5 pt-2.5 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-end gap-2.5 min-w-0"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-600 sm:pb-1.5 shrink-0">
        <CalendarRange className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
        <span>Custom Range:</span>
        {hasAppliedRange && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
            {appliedStartDate} → {appliedEndDate}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:flex sm:items-end gap-2 flex-1 min-w-0 w-full sm:max-w-md">
        <div className="flex-1 min-w-0">
          <label
            htmlFor={startId}
            className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5"
          >
            Start Date
          </label>
          <input
            id={startId}
            type="date"
            value={localStart}
            disabled={loading}
            onChange={(e) => handleStartDateChange(e.target.value)}
            className="w-full min-w-0 h-8 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-60"
            required
          />
        </div>
        <span className="hidden sm:inline text-xs text-slate-400 font-bold pb-2">to</span>
        <div className="flex-1 min-w-0">
          <label
            htmlFor={endId}
            className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5"
          >
            End Date
          </label>
          <input
            id={endId}
            type="date"
            value={localEnd}
            min={localStart || undefined}
            disabled={loading}
            onChange={(e) => setLocalEnd(e.target.value)}
            className="w-full min-w-0 h-8 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-60"
            required
          />
        </div>
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto">
        <Button
          type="submit"
          size="sm"
          disabled={!isRangeValid || loading}
          className="flex-1 sm:flex-initial h-8 px-3.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm"
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={handleCancel}
          className="h-8 px-2.5 text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
          title="Clear custom date range"
        >
          <X className="w-3.5 h-3.5 mr-1" />
          Cancel
        </Button>
      </div>
    </form>
  );
};

export default GrievanceCustomDateBar;
