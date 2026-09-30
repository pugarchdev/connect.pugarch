import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Building,
  Users,
  ChevronRight,
  Send,
  MessageSquare,
  Zap,
  Lock,
} from "lucide-react";
import { PlatformMessageTotals } from "@/lib/api/analytics";

interface DashboardStatsProps {
  stats: {
    companies: number;
    users: number;
    departments: number;
    activeCompanies: number;
    activeUsers: number;
  };
  messageTotals?: PlatformMessageTotals;
  filterLabel?: string;
  setActiveTab: (tab: string) => void;
}

const DashboardStats: React.FC<DashboardStatsProps> = ({
  stats,
  messageTotals = { utility: 0, service: 0, authentication: 0, marketing: 0, total: 0 },
  filterLabel = "ALL",
  setActiveTab,
}) => {
  const servicePct =
    messageTotals.total > 0
      ? Math.round((messageTotals.service / messageTotals.total) * 100)
      : 0;
  const utilityPct =
    messageTotals.total > 0
      ? Math.round((messageTotals.utility / messageTotals.total) * 100)
      : 0;
  const authPct =
    messageTotals.total > 0
      ? Math.round((messageTotals.authentication / messageTotals.total) * 100)
      : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
      {/* 1. Total Organizations */}
      <Card
        className="group relative overflow-hidden bg-white border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer rounded-2xl flex flex-col justify-between min-h-[142px]"
        onClick={() => setActiveTab("companies")}
      >
        <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
          <Building className="w-20 h-20 text-blue-600 -mr-6 -mt-6 rotate-12" />
        </div>
        <CardHeader className="p-3.5 pb-1">
          <CardTitle className="text-slate-500 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-blue-500/10 rounded-lg flex items-center justify-center text-blue-600">
                <Building className="w-3.5 h-3.5" />
              </div>
              Organizations
            </span>
            <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3.5 pt-0">
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              {stats.companies.toLocaleString()}
            </p>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Entities</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{
                  width: `${stats.companies > 0 ? (stats.activeCompanies / stats.companies) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100 uppercase tracking-tighter shrink-0">
              {stats.activeCompanies} Active
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 2. Total Users */}
      <Card
        className="group relative overflow-hidden bg-white border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer rounded-2xl flex flex-col justify-between min-h-[142px]"
        onClick={() => setActiveTab("users")}
      >
        <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
          <Users className="w-20 h-20 text-emerald-600 -mr-6 -mt-6 -rotate-12" />
        </div>
        <CardHeader className="p-3.5 pb-1">
          <CardTitle className="text-slate-500 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-600">
                <Users className="w-3.5 h-3.5" />
              </div>
              Total Users
            </span>
            <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition-all" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3.5 pt-0">
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              {stats.users.toLocaleString()}
            </p>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Total</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{
                  width: `${stats.users > 0 ? (stats.activeUsers / stats.users) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100 uppercase tracking-tighter shrink-0">
              {stats.activeUsers} Live
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 3. Total Messages Volume */}
      <Card className="group relative overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 text-white border border-slate-800 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 rounded-2xl flex flex-col justify-between min-h-[142px]">
        <div className="absolute top-0 right-0 p-3 opacity-10 pointer-events-none">
          <Send className="w-20 h-20 text-white -mr-6 -mt-6 rotate-12" />
        </div>
        <CardHeader className="p-3.5 pb-1">
          <CardTitle className="text-slate-300 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-white/10 rounded-lg flex items-center justify-center text-white">
                <Send className="w-3.5 h-3.5" />
              </div>
              Total Volume
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3.5 pt-0">
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-none">
              {messageTotals.total.toLocaleString()}
            </p>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Msgs</span>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[10px] font-semibold text-slate-300">
            <span>Platform Dispatched</span>
            <span className="px-1.5 py-0.5 rounded bg-white/10 text-white font-mono text-[9px] font-bold uppercase">
              {filterLabel}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 4. Service Messages */}
      <Card className="group relative overflow-hidden bg-white border border-sky-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 rounded-2xl flex flex-col justify-between min-h-[142px]">
        <div className="absolute top-0 right-0 p-3 opacity-5 pointer-events-none">
          <MessageSquare className="w-20 h-20 text-sky-600 -mr-6 -mt-6 rotate-12" />
        </div>
        <CardHeader className="p-3.5 pb-1">
          <CardTitle className="text-sky-700 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-sky-500/10 rounded-lg flex items-center justify-center text-sky-600">
                <MessageSquare className="w-3.5 h-3.5" />
              </div>
              Service Msgs
            </span>
            <span className="text-[10px] font-black text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-md border border-sky-200">
              {servicePct}%
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3.5 pt-0">
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              {messageTotals.service.toLocaleString()}
            </p>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Replies</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full transition-all duration-500"
                style={{ width: `${servicePct}%` }}
              />
            </div>
            <span className="text-[10px] font-semibold text-slate-500 shrink-0">Chatbot 24h</span>
          </div>
        </CardContent>
      </Card>

      {/* 5. Utility Messages */}
      <Card className="group relative overflow-hidden bg-white border border-emerald-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 rounded-2xl flex flex-col justify-between min-h-[142px]">
        <div className="absolute top-0 right-0 p-3 opacity-5 pointer-events-none">
          <Zap className="w-20 h-20 text-emerald-600 -mr-6 -mt-6 rotate-12" />
        </div>
        <CardHeader className="p-3.5 pb-1">
          <CardTitle className="text-emerald-700 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-600">
                <Zap className="w-3.5 h-3.5" />
              </div>
              Utility Msgs
            </span>
            <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">
              {utilityPct}%
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3.5 pt-0">
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              {messageTotals.utility.toLocaleString()}
            </p>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Alerts</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${utilityPct}%` }}
              />
            </div>
            <span className="text-[10px] font-semibold text-slate-500 shrink-0">Updates</span>
          </div>
        </CardContent>
      </Card>

      {/* 6. Authentication */}
      <Card className="group relative overflow-hidden bg-white border border-purple-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 rounded-2xl flex flex-col justify-between min-h-[142px]">
        <div className="absolute top-0 right-0 p-3 opacity-5 pointer-events-none">
          <Lock className="w-20 h-20 text-purple-600 -mr-6 -mt-6 rotate-12" />
        </div>
        <CardHeader className="p-3.5 pb-1">
          <CardTitle className="text-purple-700 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-purple-500/10 rounded-lg flex items-center justify-center text-purple-600">
                <Lock className="w-3.5 h-3.5" />
              </div>
              Authentication
            </span>
            <span className="text-[10px] font-black text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded-md border border-purple-200">
              {authPct}%
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3.5 pt-0">
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              {messageTotals.authentication.toLocaleString()}
            </p>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">OTPs</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${authPct}%` }}
              />
            </div>
            <span className="text-[10px] font-semibold text-slate-500 shrink-0">Verifications</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardStats;
