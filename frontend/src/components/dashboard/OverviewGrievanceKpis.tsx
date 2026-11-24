"use client";

import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingDots } from "@/components/dashboard/DashboardPrimitives";

type OverviewGrievanceKpisProps = {
  canReadGrievance: boolean;
  loading: boolean;
  pendingCount: number;
  overdueCount: number;
  revertedCount: number;
  resolvedCount: number;
  rejectedCount: number;
  totalCount: number;
  last7DaysCount: number;
  badgeLabel?: string;
  onPendingClick: () => void;
  onOverdueClick: () => void;
  onRevertedClick: () => void;
  onResolvedClick: () => void;
  onRejectedClick: () => void;
  onTotalClick: () => void;
};

type KpiCardProps = {
  title: string;
  value: number;
  colorClass: string;
  borderClass: string;
  footer: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  loading: boolean;
  tooltip?: string;
};

function KpiCard({
  title,
  value,
  colorClass,
  borderClass,
  footer,
  icon,
  onClick,
  loading,
  tooltip,
}: KpiCardProps) {
  return (
    <Card
      onClick={onClick}
      title={tooltip}
      className="min-h-[6.5rem] sm:min-h-[8.5rem] cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
    >
      <CardHeader
        className={`flex flex-row items-center justify-between space-y-0 border-t-[3px] bg-slate-50/50 px-3 py-2.5 ${borderClass}`}
      >
        <CardTitle className="text-[14px] sm:text-[15px] font-black uppercase tracking-widest text-slate-400">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="px-3 py-2.5">
        <div className={`text-xl sm:text-2xl font-black tabular-nums ${colorClass}`}>
          {loading ? <LoadingDots /> : value}
        </div>
        {footer}
      </CardContent>
    </Card>
  );
}

export function OverviewGrievanceKpis({
  canReadGrievance,
  loading,
  pendingCount,
  overdueCount,
  revertedCount,
  resolvedCount,
  rejectedCount,
  totalCount,
  last7DaysCount,
  badgeLabel = "New",
  onPendingClick,
  onOverdueClick,
  onRevertedClick,
  onResolvedClick,
  onRejectedClick,
  onTotalClick,
}: OverviewGrievanceKpisProps) {
  if (!canReadGrievance) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-4">
      <KpiCard
        title="Pending"
        value={pendingCount}
        colorClass="text-blue-600"
        borderClass="border-blue-500"
        icon={<AlertCircle className="h-3 w-3 text-blue-500" />}
        onClick={onPendingClick}
        loading={loading}
        tooltip="Includes both PENDING and IN PROGRESS grievances"
        footer={
          <p className="mt-1 text-[14px] font-bold uppercase text-slate-400">
            Awaiting/Active
          </p>
        }
      />

      <KpiCard
        title="Overdue"
        value={overdueCount}
        colorClass="text-amber-600"
        borderClass="border-amber-500"
        icon={<Clock className="h-3 w-3 text-amber-500" />}
        onClick={onOverdueClick}
        loading={loading}
        tooltip="Grievances that have exceeded their SLA resolution time"
        footer={
          <p className="mt-1 text-[14px] font-bold uppercase text-slate-400">
            Delayed
          </p>
        }
      />

      <KpiCard
        title="Reverted"
        value={revertedCount}
        colorClass="text-sky-600"
        borderClass="border-sky-500"
        icon={<ArrowLeft className="h-3 w-3 text-sky-500" />}
        onClick={onRevertedClick}
        loading={loading}
        tooltip="Grievances returned for reassignment or clarification"
        footer={
          <p className="mt-1 text-[14px] font-bold uppercase text-slate-400">
            Reassigned
          </p>
        }
      />

      <KpiCard
        title="Resolved"
        value={resolvedCount}
        colorClass="text-emerald-600"
        borderClass="border-emerald-500"
        icon={<CheckCircle2 className="h-3 w-3 text-emerald-500" />}
        onClick={onResolvedClick}
        loading={loading}
        tooltip="Successfully addressed grievances"
        footer={
          <p className="mt-1 text-[14px] font-bold uppercase text-slate-400">
            Completed
          </p>
        }
      />

      <KpiCard
        title="Rejected"
        value={rejectedCount}
        colorClass="text-rose-600"
        borderClass="border-rose-500"
        icon={<XCircle className="h-3 w-3 text-rose-500" />}
        onClick={onRejectedClick}
        loading={loading}
        tooltip="Grievances found invalid or out of scope"
        footer={
          <p className="mt-1 text-[14px] font-bold uppercase text-slate-400">
            Declined
          </p>
        }
      />

      <KpiCard
        title="Total Griev. "
        value={totalCount}
        colorClass="text-slate-800"
        borderClass="border-indigo-500"
        icon={<FileText className="h-3 w-3 text-indigo-500" />}
        onClick={onTotalClick}
        loading={loading}
        tooltip="Absolute total of all grievances registered"
        footer={
          <div className="mt-1 flex items-center gap-1">
            <span className="text-[14px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">
              {last7DaysCount} {badgeLabel}
            </span>
          </div>
        }
      />
    </div>
  );
}
