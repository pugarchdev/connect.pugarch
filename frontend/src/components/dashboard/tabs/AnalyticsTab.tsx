"use client";

import { useEffect, useState, useMemo } from "react";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription 
} from "@/components/ui/card";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell,
  AreaChart,
  Area
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/api/client";
import { 
  Activity, 
  TrendingUp, 
  Users, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Zap,
  Shield,
  Layers,
  BarChart2,
  PieChart as PieChartIcon
} from "lucide-react";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

const COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function AnalyticsTab({ companyId }: { companyId?: string | null }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<string>("7d");
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        const rangeMap: Record<string, string> = {
          "24h": "week",
          "7d": "week",
          "30d": "month",
          "1y": "year"
        };
        const periodParam = rangeMap[selectedRange] || "week";
        const queryParams = new URLSearchParams();
        if (companyId) queryParams.append("companyId", companyId);
        queryParams.append("period", periodParam);

        const url = `/analytics/dashboard?${queryParams.toString()}`;
        const response = await apiClient.get(url);
        if (response.success) {
          setStats(response.data);
        }
      } catch (error) {
        console.error("Failed to fetch analytics", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [companyId, selectedRange]);

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <LoadingSpinner text="Harvesting System Data..." />
          <div className="absolute -top-10 -left-10 w-24 h-24 bg-indigo-500/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-emerald-500/10 rounded-full blur-3xl animate-pulse delay-700"></div>
        </div>
      </div>
    );
  }

  const kpis = [
    { title: "Total Incidents", value: stats?.grievances?.total || 0, icon: AlertCircle, color: "text-indigo-600", bg: "bg-indigo-50", trend: "+12%" },
    { title: "Resolution Rate", value: `${stats?.grievances?.resolutionRate || 0}%`, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", trend: "+5.4%" },
    { title: "Active Personnel", value: stats?.users || 0, icon: Users, color: "text-blue-600", bg: "bg-blue-50", trend: "Stable" },
    { title: "System Uptime", value: "99.99%", icon: Activity, color: "text-violet-600", bg: "bg-violet-50", trend: "+0.01%" }
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">
            Operational Intelligence
          </h2>
          <p className="text-slate-500 font-bold text-[14px] uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-500" />
            Real-time Telemetry Processing Active
          </p>
        </div>
        <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
           {["24h", "7d", "30d", "1y"].map(range => (
             <button 
               key={range} 
               onClick={() => setSelectedRange(range)}
               className={`px-4 py-2 rounded-xl text-[14px] font-black uppercase tracking-widest transition-all ${range === selectedRange ? "bg-white text-indigo-600 shadow-lg shadow-indigo-600/10 border border-indigo-100" : "text-slate-400 hover:text-slate-600"}`}
             >
               {range}
             </button>
           ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpis.map((kpi, idx) => (
          <Card key={idx} className="group border-slate-200 shadow-xl shadow-slate-200/50 bg-white/50 backdrop-blur-xl border-t-4 border-t-indigo-500 hover:scale-[1.02] transition-all duration-300 transform perspective-1000">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-2xl ${kpi.bg} shadow-inner transition-transform group-hover:rotate-12 duration-500`}>
                  <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
                <span className={`text-[14px] font-black uppercase tracking-widest px-2 py-1 rounded-lg ${kpi.trend.startsWith('+') ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
                  {kpi.trend}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-3xl font-black text-slate-900 tracking-tighter mb-1">{kpi.value}</span>
                <span className="text-[14px] font-bold text-slate-500 uppercase tracking-widest leading-none">{kpi.title}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 border-slate-200 shadow-xl shadow-slate-200/50 bg-white/50 backdrop-blur-xl border-t-4 border-t-indigo-500">
          <CardHeader className="flex flex-row items-center justify-between pb-8">
            <div className="flex flex-col">
              <CardTitle className="text-sm font-black text-slate-900 uppercase tracking-widest">Incident Propagation</CardTitle>
              <CardDescription className="text-[14px] font-bold uppercase tracking-widest mt-1">Transactional Volume Analytics ({selectedRange})</CardDescription>
            </div>
            <BarChart2 className="w-5 h-5 text-indigo-600 opacity-20" />
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats?.grievances?.trend && stats.grievances.trend.length > 0 ? stats.grievances.trend : (stats?.grievances?.daily || [])}>
                  <defs>
                    <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#94a3b8', fontWeight: 900, fontSize: 14}}
                    tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontWeight: 900, fontSize: 14}} />
                  <Tooltip 
                    contentStyle={{backgroundColor: '#0f172a', border: 'none', borderRadius: '16px', color: '#fff', fontWeight: 900, fontSize: '10px'}}
                    itemStyle={{color: '#818cf8', textTransform: 'uppercase'}}
                  />
                  <Area type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={4} fillOpacity={1} fill="url(#areaGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xl shadow-slate-200/50 bg-white/50 backdrop-blur-xl border-t-4 border-t-emerald-500 overflow-hidden">
          <CardHeader className="pb-8">
            <div className="flex flex-col">
              <CardTitle className="text-sm font-black text-slate-900 uppercase tracking-widest">Distribution Network</CardTitle>
              <CardDescription className="text-[14px] font-bold uppercase tracking-widest mt-1">Status Classification Efficiency</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <div className="h-[280px] w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Pending', value: stats?.grievances?.pending || 0 },
                      { name: 'Resolved', value: stats?.grievances?.resolved || 0 },
                      {
                        name: 'Other',
                        value:
                          ((stats?.grievances?.registeredTotal ??
                            stats?.grievances?.total ??
                            0) -
                            ((stats?.grievances?.pending || 0) +
                              (stats?.grievances?.resolved || 0))) ||
                          0,
                      }
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={110}
                    paddingAngle={8}
                    dataKey="value"
                    cornerRadius={10}
                  >
                    {[0, 1, 2].map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-4xl font-black text-slate-900 tracking-tighter leading-none">
                  {stats?.grievances?.registeredTotal ?? stats?.grievances?.total ?? 0}
                </span>
                <span className="text-[14px] font-black text-slate-400 uppercase tracking-widest mt-2">Packets Trace</span>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 w-full mt-6 px-4">
              {['Pending', 'Resolved'].map((label, idx) => (
                <div key={label} className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-2xl shadow-sm">
                  <div className="w-3 h-3 rounded-full" style={{backgroundColor: COLORS[idx]}}></div>
                  <div className="flex flex-col">
                    <span className="text-[14px] font-black text-slate-900 uppercase tracking-tighter leading-none">{label}</span>
                    <span className="text-[15px] font-bold text-slate-400 mt-1">Classification</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
