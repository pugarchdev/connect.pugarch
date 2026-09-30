"use client";

import { useEffect, useState, useCallback } from "react";
import { apiClient } from "@/lib/api/client";
import {
  Activity,
  UserPlus,
  FileText,
  Clock,
  ArrowRight,
  User,
  Settings,
  RefreshCw,
  Building,
  Key,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Database,
  Copy,
  Check,
  ExternalLink,
  MessageSquare,
  Globe,
  Terminal,
  Send,
  Lock,
  Zap,
  Building2,
  Mail,
  Phone,
  Layers,
  Briefcase,
  Bot,
  UserCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";

interface AuditLog {
  _id: string;
  userId?: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    role?: string;
    designations?: string[];
    departmentIds?: any[];
  } | string | null;
  companyId?: {
    _id?: string;
    name?: string;
    companyId?: string;
  } | string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  changes: any;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  actorDetails?: {
    name: string;
    email?: string | null;
    phone?: string | null;
    role: string;
    designation?: string | null;
    department?: string | null;
    subDepartment?: string | null;
    organization?: string | null;
    isSystem?: boolean;
  };
  recipientDetails?: {
    name: string;
    phone: string;
    designation?: string | null;
    department?: string | null;
    subDepartment?: string | null;
    organization?: string | null;
  };
}

export default function RecentActivityPanel({
  companyId,
  showLogs = true,
}: {
  companyId?: string;
  showLogs?: boolean;
}) {
  const [activities, setActivities] = useState<AuditLog[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(showLogs);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [inspectLog, setInspectLog] = useState<AuditLog | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"formatted" | "raw">("formatted");

  const fetchRecentActivities = useCallback(async () => {
    try {
      if (!loadingActivities) setRefreshing(true);
      const url = companyId
        ? `/audit?limit=25&companyId=${companyId}`
        : "/audit?limit=25";
      const response = await apiClient.get(url);
      if (response.success) {
        const logs = response.data.logs.map((log: any) => ({
          ...log,
          createdAt: log.timestamp,
          resourceType: log.resource,
          changes: log.details,
          actorDetails: log.actorDetails,
          recipientDetails: log.recipientDetails,
        }));
        setActivities(logs || []);
      }
    } catch (error) {
      console.error("Failed to fetch activities:", error);
    } finally {
      setLoadingActivities(false);
      setRefreshing(false);
    }
  }, [companyId, loadingActivities]);

  useEffect(() => {
    if (showLogs) {
      fetchRecentActivities();
    }
  }, [fetchRecentActivities, showLogs]);

  const toggleExpand = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyToClipboard = (text: string, key: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getActivityIcon = (action: string, resourceType: string) => {
    switch (action) {
      case "CREATE":
        if (resourceType === "User")
          return <UserPlus className="w-3.5 h-3.5 text-emerald-600" />;
        if (resourceType === "Company")
          return <Building className="w-3.5 h-3.5 text-blue-600" />;
        if (resourceType === "Department")
          return <Database className="w-3.5 h-3.5 text-purple-600" />;
        return <Activity className="w-3.5 h-3.5 text-slate-600" />;
      case "UPDATE":
      case "CONSENT_CHANGE":
        return <Clock className="w-3.5 h-3.5 text-amber-600" />;
      case "DELETE":
        return <Activity className="w-3.5 h-3.5 text-rose-600" />;
      case "LOGIN":
        return <Key className="w-3.5 h-3.5 text-cyan-600" />;
      case "WHATSAPP_MSG":
        return <Send className="w-3.5 h-3.5 text-sky-600" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-slate-600" />;
    }
  };

  const getScheme = (action: string) => {
    switch (action) {
      case "CREATE":
        return { color: "emerald", bg: "bg-emerald-500" };
      case "UPDATE":
      case "CONSENT_CHANGE":
        return { color: "amber", bg: "bg-amber-500" };
      case "DELETE":
        return { color: "rose", bg: "bg-rose-500" };
      case "LOGIN":
        return { color: "cyan", bg: "bg-cyan-500" };
      case "WHATSAPP_MSG":
        return { color: "sky", bg: "bg-sky-500" };
      default:
        return { color: "slate", bg: "bg-slate-500" };
    }
  };

  const getLogSummary = (log: AuditLog) => {
    const userName =
      typeof log.userId === "object" && log.userId
        ? `${log.userId.firstName || ""} ${log.userId.lastName || ""}`.trim() || log.userId.email || "System"
        : "System";

    const companyName =
      typeof log.companyId === "object" && log.companyId
        ? log.companyId.name || log.companyId.companyId
        : null;

    return {
      user: userName,
      company: companyName,
      action: log.action,
      resource: log.resourceType,
      time: new Date(log.createdAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      }),
      date: new Date(log.createdAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }),
    };
  };

  if (loadingActivities) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 animate-pulse">
        <div className="h-6 bg-slate-100 rounded w-1/4 mb-8"></div>
        <div className="space-y-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-slate-100"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-100 rounded w-3/4"></div>
                <div className="h-3 bg-slate-50 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col h-full overflow-hidden">
        {/* Dark Header */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center border border-indigo-500/30 shadow-sm">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-tight">
                System Audit Log
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[12px] text-slate-400 font-bold uppercase tracking-widest">
                  Live Activity Stream • Click Any Event to View Details
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={fetchRecentActivities}
            disabled={refreshing}
            className="w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-xl transition-all"
            aria-label="Refresh recent activity"
            title="Refresh recent activity"
          >
            <RefreshCw
              className={`w-4 h-4 text-white ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {/* Timeline Content */}
        <div className="flex-1 overflow-y-auto max-h-[700px] p-6 relative scrollbar-thin scrollbar-thumb-slate-200">
          {activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Activity className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-sm font-bold text-slate-400">
                No activity recorded
              </p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical Timeline Track Line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-slate-100"></div>

              <div className="space-y-6">
                {activities.map((log, idx) => {
                  const summary = getLogSummary(log);
                  const scheme = getScheme(log.action);
                  const isExpanded = expandedLogIds.has(log._id);
                  const changes = log.changes || {};

                  return (
                    <div key={log._id} className="relative pl-10 group">
                      {/* Timeline Node */}
                      <div
                        className={`absolute left-0 top-1.5 w-[22px] h-[22px] rounded-full border-4 border-white shadow-sm z-10 ${scheme.bg} flex items-center justify-center transition-transform group-hover:scale-110`}
                      >
                        <div className="w-1 h-1 rounded-full bg-white"></div>
                      </div>

                      {/* Content Card */}
                      <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-slate-900 leading-none">
                              {summary.user}
                            </span>
                            {summary.company && (
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded text-[10px] font-bold">
                                {summary.company}
                              </span>
                            )}
                            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 rounded text-[11px] font-black text-slate-500 uppercase">
                              {idx === 0 ? "Latest" : summary.date}
                            </div>
                          </div>
                          <span className="text-xs font-bold text-slate-400 font-mono tracking-tight">
                            {summary.time}
                          </span>
                        </div>

                        {/* Badges Bar */}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <div
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border shadow-sm ${
                              log.action === "CREATE"
                                ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                                : log.action === "UPDATE" || log.action === "CONSENT_CHANGE"
                                  ? "bg-amber-50 border-amber-100 text-amber-700"
                                  : log.action === "DELETE"
                                    ? "bg-rose-50 border-rose-100 text-rose-700"
                                    : log.action === "WHATSAPP_MSG"
                                      ? "bg-sky-50 border-sky-100 text-sky-700"
                                      : "bg-slate-50 border-slate-100 text-slate-700"
                            }`}
                          >
                            {getActivityIcon(log.action, log.resourceType)}
                            <span className="text-[12px] font-black uppercase tracking-wider">
                              {log.action}
                            </span>
                          </div>

                          <ChevronRight className="w-3 h-3 text-slate-300" />

                          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white border border-slate-200 rounded-lg shadow-sm">
                            <span className="text-[12px] font-bold text-slate-600">
                              {log.resourceType}
                            </span>
                          </div>

                          {changes.category && (
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase border ${
                              changes.category === "UTILITY"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : changes.category === "AUTHENTICATION"
                                  ? "bg-purple-50 text-purple-700 border-purple-200"
                                  : "bg-sky-50 text-sky-700 border-sky-200"
                            }`}>
                              {changes.category}
                            </span>
                          )}
                        </div>

                        {/* Detail Box / Expandable Card */}
                        <div
                          onClick={() => toggleExpand(log._id)}
                          className={`mt-2.5 rounded-2xl p-3.5 border transition-all cursor-pointer ${
                            isExpanded
                              ? "bg-slate-50 border-blue-200 ring-1 ring-blue-100 shadow-md"
                              : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-50 hover:border-slate-300 shadow-sm"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-xs text-slate-700 font-medium leading-relaxed flex-1">
                              {changes.description ||
                                `${summary.action} event in ${log.resourceType} module`}
                            </p>

                            {/* Arrow Clicker */}
                            <button
                              onClick={(e) => toggleExpand(log._id, e)}
                              className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all ${
                                isExpanded
                                  ? "bg-blue-600 text-white rotate-90 shadow-sm"
                                  : "bg-white border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-300 group-hover:border-slate-400"
                              }`}
                              title={isExpanded ? "Collapse Details" : "View Full Details"}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Quick Metadata Bar */}
                          <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between flex-wrap gap-2 text-[11px]">
                            <div className="flex items-center gap-3 text-slate-400 font-mono">
                              {log.resourceId && (
                                <span className="flex items-center gap-1 font-semibold text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                  ID: {log.resourceId.length > 14 ? `${log.resourceId.substring(0, 14)}...` : log.resourceId}
                                </span>
                              )}
                              {log.ipAddress && (
                                <span className="flex items-center gap-1 text-slate-500">
                                  <Globe className="w-3 h-3 text-slate-400" />
                                  {log.ipAddress}
                                </span>
                              )}
                            </div>

                            <span className="text-[11px] font-bold text-blue-600 hover:underline flex items-center gap-1">
                              {isExpanded ? "Click to collapse" : "Click to view full detail"}
                            </span>
                          </div>

                          {/* Expanded Full Details Section */}
                          {isExpanded && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="mt-3.5 pt-3.5 border-t border-slate-200 space-y-3 cursor-default"
                            >
                              {/* Full Message for WhatsApp */}
                              {changes.message && (
                                <div className="bg-white rounded-xl p-3 border border-slate-200">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                      <MessageSquare className="w-3 h-3 text-sky-500" />
                                      Full Message Content
                                    </span>
                                    <button
                                      onClick={(e) => copyToClipboard(changes.message, `msg-${log._id}`, e)}
                                      className="text-[11px] text-slate-500 hover:text-blue-600 flex items-center gap-1 font-bold"
                                    >
                                      {copiedKey === `msg-${log._id}` ? (
                                        <>
                                          <Check className="w-3 h-3 text-emerald-600" />
                                          <span className="text-emerald-600">Copied</span>
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="w-3 h-3" />
                                          <span>Copy Message</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                  <div className="p-2.5 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
                                    {changes.message}
                                  </div>
                                </div>
                              )}

                              {/* Key/Value breakdown */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                {log.resourceId && (
                                  <div className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
                                    <div>
                                      <span className="text-[10px] font-bold uppercase text-slate-400 block">Resource / Recipient ID</span>
                                      <span className="font-mono font-bold text-slate-800 text-xs break-all">{log.resourceId}</span>
                                    </div>
                                    <button
                                      onClick={(e) => copyToClipboard(log.resourceId, `id-${log._id}`, e)}
                                      className="p-1 text-slate-400 hover:text-blue-600 rounded-lg"
                                      title="Copy ID"
                                    >
                                      {copiedKey === `id-${log._id}` ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  </div>
                                )}

                                {changes.templateName && (
                                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Template Name</span>
                                    <span className="font-mono font-bold text-slate-800 text-xs">{changes.templateName}</span>
                                  </div>
                                )}

                                {changes.type && (
                                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Message Type</span>
                                    <span className="font-mono font-bold text-slate-800 text-xs uppercase">{changes.type}</span>
                                  </div>
                                )}

                                {log.ipAddress && (
                                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                                    <span className="text-[10px] font-bold uppercase text-slate-400 block">IP Address</span>
                                    <span className="font-mono font-bold text-slate-800 text-xs">{log.ipAddress}</span>
                                  </div>
                                )}
                              </div>

                              {/* Updates Diff if present */}
                              {changes.updates && (
                                <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
                                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Applied Updates</span>
                                  {Object.entries(changes.updates).map(([key, val]: [string, any]) => (
                                    <div key={key} className="flex items-center gap-2 text-xs">
                                      <span className="font-bold text-slate-500">{key}:</span>
                                      <span className="font-bold text-slate-800 break-all">{String(val)}</span>
                                      <ArrowRight className="w-2.5 h-2.5 text-blue-400 shrink-0" />
                                      <span className="px-1.5 py-0.2 bg-blue-50 text-blue-600 rounded text-[10px] font-black">Applied</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Action Buttons */}
                              <div className="flex items-center justify-end gap-2 pt-1">
                                <Button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInspectLog(log);
                                  }}
                                  variant="outline"
                                  size="sm"
                                  className="h-8 text-xs font-bold rounded-xl border-slate-300 text-slate-700 hover:bg-slate-100"
                                >
                                  <Terminal className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                                  Raw JSON Inspector
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
            Showing {activities.length} Recorded Events
          </span>
          <div className="flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
            <div className="w-2 h-2 rounded-full bg-purple-500"></div>
          </div>
        </div>
      </div>

      {/* Enhanced Audit Log Inspector Modal */}
      {inspectLog && (
        <Dialog open={Boolean(inspectLog)} onOpenChange={(open) => !open && setInspectLog(null)}>
          <DialogContent className="sm:max-w-3xl w-[94vw] bg-white rounded-3xl p-6 border-0 shadow-2xl overflow-hidden flex flex-col max-h-[88vh] min-w-0">
            <DialogHeader className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-sm">
                    <Terminal className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <DialogTitle className="text-base font-bold text-slate-900">
                      Audit Log Event Inspector
                    </DialogTitle>
                    <DialogDescription className="text-xs text-slate-500">
                      Complete event payload, actor context, and system metadata
                    </DialogDescription>
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-3.5 min-w-0 max-w-full overflow-hidden flex-1 mt-1">
              {/* Event ID Header Bar with Tabs and Copy Button */}
              <div className="flex items-center justify-between gap-3 text-xs bg-slate-50 p-3 rounded-2xl border border-slate-200 min-w-0 w-full flex-wrap sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-slate-400 uppercase block text-[10px]">Log Event ID</span>
                  <span className="font-mono font-bold text-slate-800 text-xs truncate block select-all">
                    {inspectLog._id}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex bg-slate-200/80 p-0.5 rounded-xl text-xs">
                    <button
                      onClick={() => setInspectorTab("formatted")}
                      className={`px-3 py-1 rounded-lg font-bold transition-all ${
                        inspectorTab === "formatted"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Structured View
                    </button>
                    <button
                      onClick={() => setInspectorTab("raw")}
                      className={`px-3 py-1 rounded-lg font-bold transition-all ${
                        inspectorTab === "raw"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Raw JSON
                    </button>
                  </div>

                  <Button
                    onClick={() => copyToClipboard(JSON.stringify(inspectLog, null, 2), "modal-json")}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-bold rounded-xl border-slate-300"
                  >
                    {copiedKey === "modal-json" ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1.5" />
                        Copy JSON
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Tab 1: Structured View */}
              {inspectorTab === "formatted" ? (
                <div className="flex-1 overflow-y-auto max-h-[500px] rounded-2xl border border-slate-200 bg-white p-4 space-y-4 min-w-0 max-w-full scrollbar-thin scrollbar-thumb-slate-200">
                  {/* 1. Actor Profile & Department Card */}
                  <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/70 via-sky-50/40 to-slate-50 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2 border-b border-blue-100/70 pb-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                          {inspectLog.actorDetails?.isSystem ? (
                            <Bot className="w-5 h-5 text-white" />
                          ) : (
                            <User className="w-5 h-5 text-white" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-slate-900">
                              {inspectLog.actorDetails?.name ||
                                (typeof inspectLog.userId === "object" && inspectLog.userId
                                  ? `${inspectLog.userId.firstName || ""} ${inspectLog.userId.lastName || ""}`.trim()
                                  : "System / Anonymous")}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-200">
                              {inspectLog.actorDetails?.role || "System"}
                            </span>
                          </div>
                          {inspectLog.actorDetails?.designation && (
                            <span className="text-xs text-slate-600 font-semibold flex items-center gap-1 mt-0.5">
                              <Briefcase className="w-3 h-3 text-slate-400" />
                              {inspectLog.actorDetails.designation}
                            </span>
                          )}
                        </div>
                      </div>

                      {inspectLog.actorDetails?.organization && (
                        <div className="text-right hidden sm:block">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">Organization</span>
                          <span className="text-xs font-bold text-slate-700 flex items-center gap-1 justify-end">
                            <Building2 className="w-3.5 h-3.5 text-blue-500" />
                            {inspectLog.actorDetails.organization}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Department & Contact Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                      {/* Department */}
                      <div className="p-2.5 bg-white/90 rounded-xl border border-slate-200/80 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-0.5">
                          <Building className="w-3 h-3 text-blue-500" />
                          Department
                        </span>
                        <span className="font-bold text-slate-900 text-xs block leading-tight">
                          {inspectLog.actorDetails?.department || "Platform Core / Administration"}
                        </span>
                      </div>

                      {/* Subdepartment */}
                      <div className="p-2.5 bg-white/90 rounded-xl border border-slate-200/80 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-0.5">
                          <Layers className="w-3 h-3 text-indigo-500" />
                          Sub-Department
                        </span>
                        <span className="font-bold text-slate-900 text-xs block leading-tight">
                          {inspectLog.actorDetails?.subDepartment || "Direct / Top-Level Department"}
                        </span>
                      </div>

                      {/* Contact Info */}
                      <div className="p-2.5 bg-white/90 rounded-xl border border-slate-200/80 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-0.5">
                          <Mail className="w-3 h-3 text-emerald-500" />
                          Actor Contact
                        </span>
                        <span className="font-semibold text-slate-700 text-xs block truncate" title={inspectLog.actorDetails?.email || inspectLog.actorDetails?.phone || "N/A"}>
                          {inspectLog.actorDetails?.email || inspectLog.actorDetails?.phone || "System Dispatcher"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 2. Target Recipient Officer Card (If WhatsApp message or notification to an officer) */}
                  {inspectLog.recipientDetails && (
                    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-teal-50/40 p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                          <UserCheck className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 block">
                            Target Recipient Officer
                          </span>
                          <span className="text-xs font-bold text-slate-900">
                            {inspectLog.recipientDetails.name} • {inspectLog.recipientDetails.phone}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <div className="p-2 bg-white rounded-lg border border-emerald-100">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">Designation</span>
                          <span className="font-bold text-slate-800 text-xs">
                            {inspectLog.recipientDetails.designation || "Officer"}
                          </span>
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-emerald-100">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">Department</span>
                          <span className="font-bold text-slate-800 text-xs">
                            {inspectLog.recipientDetails.department || "General"}
                          </span>
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-emerald-100">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">Subdepartment</span>
                          <span className="font-bold text-slate-800 text-xs">
                            {inspectLog.recipientDetails.subDepartment || "Top-Level"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 3. Event Summary Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Action</span>
                      <span className="font-black text-slate-900 text-sm">{inspectLog.action}</span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Resource Module</span>
                      <span className="font-black text-slate-900 text-sm">{inspectLog.resourceType}</span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Timestamp</span>
                      <span className="font-semibold text-slate-700 text-xs">
                        {new Date(inspectLog.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Client IP</span>
                      <span className="font-mono font-semibold text-slate-800 text-xs">{inspectLog.ipAddress || "::1"}</span>
                    </div>

                    {inspectLog.resourceId && (
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 sm:col-span-2 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">Resource / Recipient ID</span>
                          <span className="font-mono font-bold text-slate-900 text-xs break-all">{inspectLog.resourceId}</span>
                        </div>
                        <Button
                          onClick={() => copyToClipboard(inspectLog.resourceId, "res-id")}
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs font-bold"
                        >
                          {copiedKey === "res-id" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    )}

                    {inspectLog.userAgent && (
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 sm:col-span-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block">User Agent</span>
                        <span className="font-mono text-slate-600 text-[11px] truncate block" title={inspectLog.userAgent}>
                          {inspectLog.userAgent}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 4. Message Details if available */}
                  {inspectLog.changes?.message && (
                    <div className="p-3.5 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-sky-400 tracking-wider flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                          Full WhatsApp Message Body
                        </span>
                        <button
                          onClick={() => copyToClipboard(inspectLog.changes.message, "full-msg")}
                          className="text-[10px] font-bold text-slate-400 hover:text-white flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition-colors"
                        >
                          {copiedKey === "full-msg" ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy Body</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto p-2 bg-slate-950/70 rounded-lg border border-slate-800/80 text-sky-200">
                        {inspectLog.changes.message}
                      </div>
                    </div>
                  )}

                  {/* 5. Changes/Updates if available */}
                  {inspectLog.changes?.updates && (
                    <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Applied Modifications</span>
                      {Object.entries(inspectLog.changes.updates).map(([k, v]: [string, any]) => (
                        <div key={k} className="flex items-center gap-2 text-xs">
                          <span className="font-bold text-slate-500">{k}:</span>
                          <span className="font-bold text-slate-800 break-all">{String(v)}</span>
                          <ArrowRight className="w-2.5 h-2.5 text-blue-400 shrink-0" />
                          <span className="px-1.5 py-0.2 bg-blue-50 text-blue-600 rounded text-[10px] font-black">Applied</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Tab 2: Raw Prettified JSON */
                <div className="w-full min-w-0 max-w-full rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden flex flex-col flex-1">
                  <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span>payload.json</span>
                    <span>UTF-8 • {JSON.stringify(inspectLog).length} bytes</span>
                  </div>
                  <pre className="p-4 font-mono text-xs text-emerald-400 overflow-x-auto overflow-y-auto max-h-[380px] w-full max-w-full min-w-0 leading-relaxed whitespace-pre scrollbar-thin scrollbar-thumb-slate-700">
                    {JSON.stringify(inspectLog, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
