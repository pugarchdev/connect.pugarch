"use client";

import { useEffect, useRef, useState } from "react";

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDefaultCustomRange(days = 30): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
  };
}

export function parseLocalDateBound(dateStr: string, isEnd = false): Date | null {
  if (!dateStr) return null;
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const date = isEnd
    ? new Date(year, month, day, 23, 59, 59, 999)
    : new Date(year, month, day, 0, 0, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

interface UseCustomDateRangeDraftOptions {
  appliedActive: boolean;
  appliedStart?: string;
  appliedEnd?: string;
  defaultDays?: number;
  initializeDefaultsWhenEmpty?: boolean;
}

/**
 * Maintains draft start/end date inputs independently from parent re-renders
 * (e.g. background polling) and only syncs when applied props actually change.
 */
export function useCustomDateRangeDraft({
  appliedActive,
  appliedStart = "",
  appliedEnd = "",
  defaultDays = 30,
  initializeDefaultsWhenEmpty = false,
}: UseCustomDateRangeDraftOptions) {
  const [localStart, setLocalStart] = useState(() => {
    if (appliedStart) return appliedStart;
    if (appliedActive && initializeDefaultsWhenEmpty) {
      return getDefaultCustomRange(defaultDays).startDate;
    }
    return "";
  });

  const [localEnd, setLocalEnd] = useState(() => {
    if (appliedEnd) return appliedEnd;
    if (appliedActive && initializeDefaultsWhenEmpty) {
      return getDefaultCustomRange(defaultDays).endDate;
    }
    return "";
  });

  const lastAppliedRef = useRef({
    active: appliedActive,
    startDate: appliedStart,
    endDate: appliedEnd,
  });

  useEffect(() => {
    const prev = lastAppliedRef.current;
    if (
      prev.active === appliedActive &&
      prev.startDate === appliedStart &&
      prev.endDate === appliedEnd
    ) {
      return;
    }

    lastAppliedRef.current = {
      active: appliedActive,
      startDate: appliedStart,
      endDate: appliedEnd,
    };

    if (appliedActive) {
      if (appliedStart && (!prev.active || appliedStart !== prev.startDate)) {
        setLocalStart(appliedStart);
      }
      if (appliedEnd && (!prev.active || appliedEnd !== prev.endDate)) {
        setLocalEnd(appliedEnd);
      }
      if (!prev.active && !appliedStart && !appliedEnd && initializeDefaultsWhenEmpty) {
        const defaults = getDefaultCustomRange(defaultDays);
        setLocalStart((cur) => cur || defaults.startDate);
        setLocalEnd((cur) => cur || defaults.endDate);
      }
    } else {
      setLocalStart("");
      setLocalEnd("");
    }
  }, [appliedActive, appliedStart, appliedEnd, defaultDays, initializeDefaultsWhenEmpty]);

  const handleStartDateChange = (nextStart: string) => {
    setLocalStart(nextStart);
    if (nextStart && localEnd && nextStart > localEnd) {
      setLocalEnd(nextStart);
    }
  };

  const isRangeValid = Boolean(localStart && localEnd && localStart <= localEnd);

  return {
    localStart,
    localEnd,
    setLocalStart,
    setLocalEnd,
    handleStartDateChange,
    isRangeValid,
  };
}
