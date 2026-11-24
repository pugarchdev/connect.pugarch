"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Calculator,
  Receipt,
  MessageSquare,
  Zap,
  Lock,
  Search,
  Building2,
  Phone,
  BarChart3,
  Calendar,
  X,
  RefreshCw,
  Download,
  Printer,
  SlidersHorizontal,
  Info,
  CheckCircle2,
  Percent,
  TrendingDown,
  Sparkles,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Megaphone,
  ArrowUpDown,
  FileSpreadsheet,
  RotateCcw,
} from "lucide-react";
import {
  CompanyCostStat,
  MetaCostTotals,
  MetaPricingRates,
  MetaCostCalculatorParams,
  analyticsAPI,
} from "@/lib/api/analytics";
import toast from "react-hot-toast";

// Official Meta 2024 / 2025 WhatsApp Business API Rates for India (INR)
const DEFAULT_META_RATES: MetaPricingRates = {
  serviceRate: 0.1150,
  utilityRate: 0.1150,
  authRate: 0.1150,
  marketingRate: 0.8631,
  freeQuota: 1000,
  baseMonthlyQuota: 1000,
  monthsFactor: 1,
  gstPct: 18,
  currency: "INR",
  currencySymbol: "₹",
};

// Helper: Format Date helper
const pad = (n: number) => String(n).padStart(2, "0");
const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

interface MetaCostCalculatorProps {
  onOpenCompanyDashboard?: (companyId: string) => void;
}

export default function MetaCostCalculator({
  onOpenCompanyDashboard,
}: MetaCostCalculatorProps) {
  // 1. Rates State (with localStorage persistence)
  const [rates, setRates] = useState<MetaPricingRates>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("meta_pricing_rates_v1");
        if (saved) return { ...DEFAULT_META_RATES, ...JSON.parse(saved) };
      } catch (e) {
        console.error("Error loading rates from localStorage", e);
      }
    }
    return DEFAULT_META_RATES;
  });

  const [showRateSettings, setShowRateSettings] = useState(false);
  const [tempRates, setTempRates] = useState<MetaPricingRates>(rates);

  // 2. Filter & Timeframe States
  const [selectedPeriod, setSelectedPeriod] = useState<
    "thisMonth" | "lastMonth" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "all"
  >("thisMonth");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [billingStatusFilter, setBillingStatusFilter] = useState<"all" | "billable" | "free" | "active">("all");
  const [sortBy, setSortBy] = useState<"cost" | "volume" | "savings" | "service" | "utility" | "auth" | "name">("cost");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [showDateRange, setShowDateRange] = useState(false);

  // 3. Data Loading & API State
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<CompanyCostStat[]>([]);
  const [totals, setTotals] = useState<MetaCostTotals>({
    utility: 0,
    service: 0,
    authentication: 0,
    marketing: 0,
    total: 0,
    freeServiceUsed: 0,
    billableService: 0,
    serviceCost: 0,
    utilityCost: 0,
    authCost: 0,
    marketingCost: 0,
    subtotalCost: 0,
    gstCost: 0,
    totalCost: 0,
    savings: 0,
  });

  // 4. Modal / Detail State for Company Invoice Receipt
  const [selectedCompanyReceipt, setSelectedCompanyReceipt] = useState<CompanyCostStat | null>(null);

  // 5. Interactive "What-If" Simulator State
  const [showSimulator, setShowSimulator] = useState(false);
  const [simService, setSimService] = useState<number>(5000);
  const [simUtility, setSimUtility] = useState<number>(1500);
  const [simAuth, setSimAuth] = useState<number>(300);
  const [simMarketing, setSimMarketing] = useState<number>(500);

  // Timeframe Date Range Resolver
  const resolveDateParams = useCallback(
    (period: string, customStart?: string, customEnd?: string) => {
      const now = new Date();
      if (customStart || customEnd) {
        return { startDate: customStart, endDate: customEnd, period: undefined };
      }

      if (period === "thisMonth") {
        const start = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        const end = toYMD(now);
        return { startDate: start, endDate: end, period: "monthly" as const };
      }

      if (period === "lastMonth") {
        const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        return {
          startDate: toYMD(firstDayLastMonth),
          endDate: toYMD(lastDayLastMonth),
          period: "monthly" as const,
        };
      }

      return {
        period: period as any,
        startDate: undefined,
        endDate: undefined,
      };
    },
    []
  );

  // Fetch Data from Server
  const fetchCostData = useCallback(async () => {
    try {
      setLoading(true);
      const { period, startDate: sDate, endDate: eDate } = resolveDateParams(
        selectedPeriod,
        startDate,
        endDate
      );

      const params: MetaCostCalculatorParams = {
        period,
        startDate: sDate,
        endDate: eDate,
        companyId: companyFilter !== "all" ? companyFilter : undefined,
        serviceRate: rates.serviceRate,
        utilityRate: rates.utilityRate,
        authRate: rates.authRate,
        marketingRate: rates.marketingRate,
        freeQuota: rates.baseMonthlyQuota,
        gstRate: rates.gstPct,
      };

      const res = await analyticsAPI.getMetaCostCalculator(params);
      if (res.success && res.data) {
        setCompanies(res.data.companies || []);
        setTotals(res.data.totals);
        if (res.data.rates) {
          setRates((prev) => ({
            ...prev,
            monthsFactor: res.data.rates.monthsFactor || 1,
            freeQuota: res.data.rates.freeQuota || prev.freeQuota,
          }));
        }
      }
    } catch (err: any) {
      console.error("Failed to load Meta cost data:", err);
      toast.error(err?.response?.data?.message || "Failed to load Meta cost calculations");
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, startDate, endDate, companyFilter, rates.serviceRate, rates.utilityRate, rates.authRate, rates.marketingRate, rates.baseMonthlyQuota, rates.gstPct, resolveDateParams]);

  useEffect(() => {
    fetchCostData();
  }, [fetchCostData]);

  // Handle Preset Selection
  const applyPreset = (preset: "thisMonth" | "lastMonth" | "daily" | "weekly" | "quarterly" | "yearly" | "all") => {
    setSelectedPeriod(preset);
    setStartDate("");
    setEndDate("");
  };

  // Save Custom Rates
  const handleSaveRates = () => {
    setRates(tempRates);
    if (typeof window !== "undefined") {
      localStorage.setItem("meta_pricing_rates_v1", JSON.stringify(tempRates));
    }
    setShowRateSettings(false);
    toast.success("Pricing rate card updated and applied!");
  };

  // Reset to Meta Defaults
  const handleResetRates = () => {
    setTempRates(DEFAULT_META_RATES);
    setRates(DEFAULT_META_RATES);
    if (typeof window !== "undefined") {
      localStorage.removeItem("meta_pricing_rates_v1");
    }
    toast.success("Reset to Official Meta 2024/2025 India Rates");
  };

  // Formatter helpers
  const formatCurrency = (val: number, decimals = 2) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(val || 0);
  };

  const formatNumber = (val: number) => {
    return new Intl.NumberFormat("en-IN").format(val || 0);
  };

  // Filter & Sort Companies
  const filteredAndSortedCompanies = useMemo(() => {
    return companies
      .filter((comp) => {
        // Search Term (Name, Code, Phone)
        if (searchTerm.trim()) {
          const term = searchTerm.toLowerCase().trim();
          const matchesName = comp.name.toLowerCase().includes(term);
          const matchesCode = (comp.companyId || "").toLowerCase().includes(term);
          const matchesPhone = (comp.phoneNumber || "").toLowerCase().includes(term);
          if (!matchesName && !matchesCode && !matchesPhone) return false;
        }

        // Company filter
        if (companyFilter !== "all" && comp._id !== companyFilter && comp.companyId !== companyFilter) {
          return false;
        }

        // Billing status filter
        if (billingStatusFilter === "billable" && comp.totalCost <= 0) return false;
        if (billingStatusFilter === "free" && (comp.totalCost > 0 || comp.total === 0)) return false;
        if (billingStatusFilter === "active" && !comp.isActive) return false;

        return true;
      })
      .sort((a, b) => {
        let valA: number | string = 0;
        let valB: number | string = 0;

        switch (sortBy) {
          case "cost":
            valA = a.totalCost;
            valB = b.totalCost;
            break;
          case "volume":
            valA = a.total;
            valB = b.total;
            break;
          case "savings":
            valA = a.savings;
            valB = b.savings;
            break;
          case "service":
            valA = a.service;
            valB = b.service;
            break;
          case "utility":
            valA = a.utility;
            valB = b.utility;
            break;
          case "auth":
            valA = a.authentication;
            valB = b.authentication;
            break;
          case "name":
            valA = a.name.toLowerCase();
            valB = b.name.toLowerCase();
            break;
        }

        if (typeof valA === "string" && typeof valB === "string") {
          return sortDirection === "asc"
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }

        return sortDirection === "asc"
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      });
  }, [companies, searchTerm, companyFilter, billingStatusFilter, sortBy, sortDirection]);

  // Export to CSV Function
  const handleExportCSV = () => {
    try {
      const headers = [
        "Organization Name",
        "Company Code",
        "Phone Number",
        "Status",
        "Service Messages Total",
        "Free Service Messages Quota Applied",
        "Billable Service Messages",
        `Service Cost (${rates.currencySymbol})`,
        "Utility Messages",
        `Utility Cost (${rates.currencySymbol})`,
        "Authentication Messages (OTPs)",
        `Authentication Cost (${rates.currencySymbol})`,
        "Marketing Messages",
        `Marketing Cost (${rates.currencySymbol})`,
        "Total Messages Dispatched",
        `Subtotal Net Cost (${rates.currencySymbol})`,
        `GST ${rates.gstPct}% (${rates.currencySymbol})`,
        `Total Cost Payable (${rates.currencySymbol})`,
        `Free Tier Savings (${rates.currencySymbol})`,
        `Effective Cost Per Msg (${rates.currencySymbol})`,
      ];

      const rows = filteredAndSortedCompanies.map((c) => [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.companyId || ""}"`,
        `"${c.phoneNumber || "N/A"}"`,
        c.isActive ? "Active" : "Inactive",
        c.service,
        c.freeServiceUsed,
        c.billableService,
        c.serviceCost.toFixed(2),
        c.utility,
        c.utilityCost.toFixed(2),
        c.authentication,
        c.authCost.toFixed(2),
        c.marketing,
        c.marketingCost.toFixed(2),
        c.total,
        c.subtotalCost.toFixed(2),
        c.gstCost.toFixed(2),
        c.totalCost.toFixed(2),
        c.savings.toFixed(2),
        c.effectiveCostPerMsg.toFixed(4),
      ]);

      const csvContent =
        "data:text/csv;charset=utf-8," +
        [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute(
        "download",
        `Meta_WhatsApp_Cost_Report_${selectedPeriod}_${new Date().toISOString().split("T")[0]}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Cost report exported to CSV successfully!");
    } catch (err) {
      console.error("Export error", err);
      toast.error("Failed to generate CSV export");
    }
  };

  // Printable Billing Summary
  const handlePrintSummary = () => {
    window.print();
  };

  // What-If Simulation Calculation
  const simCalculation = useMemo(() => {
    const freeQuota = rates.baseMonthlyQuota;
    const freeUsed = Math.min(simService, freeQuota);
    const billableService = Math.max(0, simService - freeUsed);

    const serviceCost = billableService * rates.serviceRate;
    const utilityCost = simUtility * rates.utilityRate;
    const authCost = simAuth * rates.authRate;
    const marketingCost = simMarketing * rates.marketingRate;

    const subtotal = serviceCost + utilityCost + authCost + marketingCost;
    const gst = (subtotal * rates.gstPct) / 100;
    const grandTotal = subtotal + gst;
    const savings = freeUsed * rates.serviceRate;
    const totalMsgs = simService + simUtility + simAuth + simMarketing;
    const effectiveCostPerMsg = totalMsgs > 0 ? grandTotal / totalMsgs : 0;

    return {
      totalMsgs,
      freeUsed,
      billableService,
      serviceCost,
      utilityCost,
      authCost,
      marketingCost,
      subtotal,
      gst,
      grandTotal,
      savings,
      effectiveCostPerMsg,
    };
  }, [simService, simUtility, simAuth, simMarketing, rates]);

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Official Meta Rates Quick-Bar */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 border border-sky-900/60 p-6 shadow-xl text-white">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-16 w-60 h-60 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-400/30">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                Official Meta Pricing 2024–2025
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                1,000 Free Service Msgs / Mo / Org
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-3">
              <Calculator className="w-7 h-7 text-sky-400" />
              Meta WhatsApp Billing & Cost Calculator
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm max-w-3xl leading-relaxed">
              Calculate exact platform expenses across all organizations according to Meta&apos;s latest per-message pricing model. Includes dedicated counts for{" "}
              <strong className="text-sky-300">Service</strong>, <strong className="text-emerald-300">Utility</strong>, and{" "}
              <strong className="text-purple-300">Authentication (OTPs)</strong>, with automatic deduction of the monthly{" "}
              <strong className="text-amber-300">1,000 Free Service Messages</strong> allowance per WhatsApp Business number, plus 18% GST.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              onClick={() => {
                setTempRates(rates);
                setShowRateSettings(true);
              }}
              variant="outline"
              size="sm"
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-xl h-10 px-4 text-xs font-bold transition-all shadow-sm flex items-center gap-2"
            >
              <SlidersHorizontal className="w-4 h-4 text-sky-400" />
              <span>Rate Card Config</span>
            </Button>

            <Button
              onClick={() => setShowSimulator(!showSimulator)}
              variant="outline"
              size="sm"
              className={`rounded-xl h-10 px-4 text-xs font-bold transition-all shadow-sm flex items-center gap-2 ${
                showSimulator
                  ? "bg-sky-600 text-white border-sky-400 shadow-sky-900/50"
                  : "bg-white/10 hover:bg-white/20 text-white border-white/20"
              }`}
            >
              <Calculator className="w-4 h-4 text-amber-400" />
              <span>{showSimulator ? "Hide Simulator" : "Cost Simulator"}</span>
            </Button>

            <Button
              onClick={handleExportCSV}
              variant="outline"
              size="sm"
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-xl h-10 px-4 text-xs font-bold transition-all shadow-sm flex items-center gap-2"
              title="Download CSV breakdown"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>Export CSV</span>
            </Button>

            <Button
              onClick={handlePrintSummary}
              variant="outline"
              size="sm"
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-xl h-10 px-4 text-xs font-bold transition-all shadow-sm flex items-center gap-2"
              title="Print Cost Sheet"
            >
              <Printer className="w-4 h-4 text-purple-300" />
              <span>Print</span>
            </Button>
          </div>
        </div>

        {/* Live Active Rate Card Badges Strip */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-sky-400 block">Service Messages</span>
              <span className="text-sm font-bold text-white">₹{rates.serviceRate.toFixed(4)} / msg</span>
            </div>
            <span className="text-[9px] font-black text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase">
              1K Free/Mo
            </span>
          </div>

          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 block">Utility Messages</span>
              <span className="text-sm font-bold text-white">₹{rates.utilityRate.toFixed(4)} / msg</span>
            </div>
            <span className="text-[9px] font-black text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 uppercase">
              Updates
            </span>
          </div>

          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 block">Authentication</span>
              <span className="text-sm font-bold text-white">₹{rates.authRate.toFixed(4)} / msg</span>
            </div>
            <span className="text-[9px] font-black text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20 uppercase">
              OTPs
            </span>
          </div>

          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-pink-400 block">Marketing</span>
              <span className="text-sm font-bold text-white">₹{rates.marketingRate.toFixed(4)} / msg</span>
            </div>
            <span className="text-[9px] font-black text-pink-300 bg-pink-500/10 px-1.5 py-0.5 rounded border border-pink-500/20 uppercase">
              Broadcasts
            </span>
          </div>

          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60 flex items-center justify-between col-span-2 sm:col-span-1">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Taxation</span>
              <span className="text-sm font-bold text-white">+{rates.gstPct}% GST</span>
            </div>
            <span className="text-[9px] font-black text-slate-300 bg-slate-700 px-1.5 py-0.5 rounded uppercase">
              Standard
            </span>
          </div>
        </div>
      </div>

      {/* 2. Interactive Projected Cost Simulator ("What-If" Planning Tool) */}
      {showSimulator && (
        <Card className="rounded-2xl border-2 border-sky-400/40 bg-gradient-to-br from-sky-950/20 via-white to-slate-50 shadow-md p-6 animate-in slide-in-from-top-4 duration-300">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-600">
                  <Calculator className="w-4 h-4" />
                </div>
                <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                  Meta Monthly Cost Simulator & Forecaster
                </h3>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  Interactive What-If Model
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Simulate potential monthly message volume for an organization and preview the exact Meta billing with the 1,000 free tier applied.
              </p>
            </div>
            <Button
              onClick={() => {
                setSimService(5000);
                setSimUtility(1500);
                setSimAuth(300);
                setSimMarketing(500);
              }}
              variant="outline"
              size="sm"
              className="text-xs font-bold rounded-xl h-8"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Reset Inputs
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5">
            <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-sky-200 shadow-sm">
              <label className="text-[11px] font-black text-sky-800 uppercase tracking-wide flex items-center justify-between">
                <span>Service Messages</span>
                <span className="text-amber-600 text-[10px] font-bold">1K Free</span>
              </label>
              <input
                type="number"
                min="0"
                step="100"
                value={simService}
                onChange={(e) => setSimService(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full text-base font-bold text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-sky-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 block">
                Billable: {Math.max(0, simService - 1000).toLocaleString()} @ ₹{rates.serviceRate.toFixed(4)}
              </span>
            </div>

            <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-emerald-200 shadow-sm">
              <label className="text-[11px] font-black text-emerald-800 uppercase tracking-wide">
                Utility Messages
              </label>
              <input
                type="number"
                min="0"
                step="100"
                value={simUtility}
                onChange={(e) => setSimUtility(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full text-base font-bold text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 block">
                {simUtility.toLocaleString()} @ ₹{rates.utilityRate.toFixed(4)}
              </span>
            </div>

            <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-purple-200 shadow-sm">
              <label className="text-[11px] font-black text-purple-800 uppercase tracking-wide">
                Authentication (OTPs)
              </label>
              <input
                type="number"
                min="0"
                step="50"
                value={simAuth}
                onChange={(e) => setSimAuth(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full text-base font-bold text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 block">
                {simAuth.toLocaleString()} @ ₹{rates.authRate.toFixed(4)}
              </span>
            </div>

            <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-pink-200 shadow-sm">
              <label className="text-[11px] font-black text-pink-800 uppercase tracking-wide">
                Marketing Messages
              </label>
              <input
                type="number"
                min="0"
                step="100"
                value={simMarketing}
                onChange={(e) => setSimMarketing(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full text-base font-bold text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-pink-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 block">
                {simMarketing.toLocaleString()} @ ₹{rates.marketingRate.toFixed(4)}
              </span>
            </div>
          </div>

          {/* Simulator Results Strip */}
          <div className="mt-4 p-4 rounded-xl bg-slate-900 text-white flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full md:w-auto">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Total Dispatched</span>
                <span className="text-base font-black text-white">{formatNumber(simCalculation.totalMsgs)}</span>
              </div>
              <div>
                <span className="text-[10px] font-black text-amber-400 uppercase tracking-wider block">Free Tier Savings</span>
                <span className="text-base font-black text-amber-300">{formatCurrency(simCalculation.savings)}</span>
              </div>
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Base Net Cost</span>
                <span className="text-base font-black text-slate-200">{formatCurrency(simCalculation.subtotal)}</span>
              </div>
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">GST ({rates.gstPct}%)</span>
                <span className="text-base font-black text-slate-200">{formatCurrency(simCalculation.gst)}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-slate-800 pt-3 md:pt-0 md:pl-5 shrink-0">
              <div className="text-right">
                <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest block">
                  Est. Total Cost (Incl. GST)
                </span>
                <span className="text-2xl font-black text-emerald-300">
                  {formatCurrency(simCalculation.grandTotal)}
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 3. Platform Grand Total KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* KPI 1: Grand Total Payable */}
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col justify-between">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-slate-500 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                  <Receipt className="w-3.5 h-3.5" />
                </div>
                Total Meta Cost
              </span>
              <span className="text-[9px] font-bold text-slate-400 uppercase">Incl. GST</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              {formatCurrency(totals.totalCost)}
            </div>
            <div className="mt-2 text-[10px] font-semibold text-slate-500 flex items-center justify-between border-t border-slate-100 pt-2">
              <span>Base: {formatCurrency(totals.subtotalCost)}</span>
              <span className="text-slate-400">GST: {formatCurrency(totals.gstCost)}</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: Free Tier Savings */}
        <Card className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/50 to-white shadow-sm overflow-hidden flex flex-col justify-between">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-amber-700 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600">
                  <TrendingDown className="w-3.5 h-3.5" />
                </div>
                Free Tier Savings
              </span>
              <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded uppercase">
                Subsidy
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl sm:text-3xl font-black text-amber-600 tracking-tight leading-none">
              {formatCurrency(totals.savings)}
            </div>
            <div className="mt-2 text-[10px] font-semibold text-amber-800 flex items-center justify-between border-t border-amber-100 pt-2">
              <span>{formatNumber(totals.freeServiceUsed)} Free Msgs</span>
              <span className="font-bold">1K/mo per Org</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 3: Service Messages Cost */}
        <Card className="rounded-2xl border border-sky-100 bg-white shadow-sm overflow-hidden flex flex-col justify-between">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-sky-700 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-600">
                  <MessageSquare className="w-3.5 h-3.5" />
                </div>
                Service Msgs
              </span>
              <span className="text-[9px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">
                ₹{rates.serviceRate.toFixed(4)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              {formatCurrency(totals.serviceCost)}
            </div>
            <div className="mt-2 text-[10px] font-semibold text-slate-500 flex items-center justify-between border-t border-slate-100 pt-2">
              <span>Total: {formatNumber(totals.service)}</span>
              <span className="text-sky-600 font-bold">{formatNumber(totals.billableService)} Billable</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 4: Utility Messages Cost */}
        <Card className="rounded-2xl border border-emerald-100 bg-white shadow-sm overflow-hidden flex flex-col justify-between">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-emerald-700 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                  <Zap className="w-3.5 h-3.5" />
                </div>
                Utility Msgs
              </span>
              <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                ₹{rates.utilityRate.toFixed(4)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              {formatCurrency(totals.utilityCost)}
            </div>
            <div className="mt-2 text-[10px] font-semibold text-slate-500 flex items-center justify-between border-t border-slate-100 pt-2">
              <span>Volume: {formatNumber(totals.utility)}</span>
              <span className="text-emerald-600 font-bold">Alerts</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 5: Authentication (OTP) Cost */}
        <Card className="rounded-2xl border border-purple-100 bg-white shadow-sm overflow-hidden flex flex-col justify-between">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-purple-700 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-600">
                  <Lock className="w-3.5 h-3.5" />
                </div>
                Authentication
              </span>
              <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                ₹{rates.authRate.toFixed(4)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              {formatCurrency(totals.authCost)}
            </div>
            <div className="mt-2 text-[10px] font-semibold text-slate-500 flex items-center justify-between border-t border-slate-100 pt-2">
              <span>Volume: {formatNumber(totals.authentication)}</span>
              <span className="text-purple-600 font-bold">OTPs</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 6: Total Dispatched & Effective Avg Cost */}
        <Card className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-sm overflow-hidden flex flex-col justify-between">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-slate-300 text-[11px] font-black uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-sky-400" />
                Effective Cost
              </span>
              <span className="text-[9px] font-bold text-sky-300 bg-white/10 px-1.5 py-0.5 rounded">
                Avg / Msg
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-none">
              ₹{totals.total > 0 ? (totals.totalCost / totals.total).toFixed(4) : "0.0000"}
            </div>
            <div className="mt-2 text-[10px] font-semibold text-slate-300 flex items-center justify-between border-t border-slate-800 pt-2">
              <span>{formatNumber(totals.total)} Total Msgs</span>
              <span className="text-emerald-400 font-bold">
                {totals.total > 0
                  ? `${Math.round((totals.freeServiceUsed / totals.total) * 100)}% Free`
                  : "0%"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4. Table & Control Card */}
      <Card className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
        {/* Header with Title and Timeframe Filter Pills */}
        <CardHeader className="bg-slate-900 text-white p-5 border-b border-slate-800">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400 shadow-inner">
                <Receipt className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                  Organization Meta Cost Breakdown
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
                    {selectedPeriod.toUpperCase()}
                  </span>
                </CardTitle>
                <CardDescription className="text-slate-400 text-xs mt-0.5 font-medium">
                  Itemized expenses per company with free tier deduction and 18% GST calculation
                </CardDescription>
              </div>
            </div>

            {/* Timeframe Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="bg-slate-800/90 border border-slate-700/80 rounded-xl p-1 flex items-center gap-1">
                {[
                  { id: "thisMonth", label: "This Month" },
                  { id: "lastMonth", label: "Last Month" },
                  { id: "daily", label: "Daily" },
                  { id: "weekly", label: "Weekly" },
                  { id: "quarterly", label: "Quarterly" },
                  { id: "yearly", label: "Yearly" },
                  { id: "all", label: "All Time" },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => applyPreset(t.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      selectedPeriod === t.id && !startDate && !endDate
                        ? "bg-sky-600 text-white shadow-sm"
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
                    ? "bg-sky-600 text-white border-sky-500"
                    : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Custom Dates</span>
              </Button>

              <Button
                onClick={fetchCostData}
                variant="ghost"
                size="sm"
                disabled={loading}
                className="h-9 w-9 p-0 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 shrink-0"
                title="Refresh cost data"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Custom Date Range Picker */}
          {showDateRange && (
            <div className="mt-4 pt-4 border-t border-slate-800 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-bold uppercase">From:</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-1.5 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-bold uppercase">To:</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-1.5 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
                  />
                </div>

                <Button
                  onClick={fetchCostData}
                  disabled={!startDate && !endDate}
                  size="sm"
                  className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl h-8 px-4 shadow-sm"
                >
                  Apply Dates
                </Button>

                {(startDate || endDate) && (
                  <Button
                    onClick={() => {
                      setStartDate("");
                      setEndDate("");
                      setSelectedPeriod("thisMonth");
                    }}
                    variant="ghost"
                    size="sm"
                    className="text-xs text-slate-400 hover:text-white rounded-xl h-8 px-2 flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reset
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardHeader>

        {/* Search, Status, and Sort Control Toolbar */}
        <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-3 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search organization, code or phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-700 placeholder-slate-400 shadow-sm"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Billing Status Filter */}
            <select
              value={billingStatusFilter}
              onChange={(e) => setBillingStatusFilter(e.target.value as any)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
            >
              <option value="all">Status: All Organizations</option>
              <option value="billable">Billable (&gt; ₹0)</option>
              <option value="free">100% Free (Covered by 1K Quota)</option>
              <option value="active">Active Orgs Only</option>
            </select>
          </div>

          {/* Sort By & Summary Pill */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-bold uppercase text-[10px]">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
              >
                <option value="cost">Highest Total Cost</option>
                <option value="volume">Highest Message Volume</option>
                <option value="savings">Highest Free Savings</option>
                <option value="service">Highest Service Messages</option>
                <option value="utility">Highest Utility Messages</option>
                <option value="auth">Highest Authentication (OTPs)</option>
                <option value="name">Organization Name</option>
              </select>

              <button
                onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
                className="p-1.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:text-slate-900 shadow-sm"
                title={`Sort ${sortDirection === "asc" ? "Ascending" : "Descending"}`}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="text-xs font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-sm shrink-0">
              {filteredAndSortedCompanies.length} Entities in View
            </div>
          </div>
        </div>

        {/* Company-Wise Table Breakdown */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-600">
                <th className="py-3.5 px-4">Organization</th>
                <th className="py-3.5 px-3 text-right">
                  <span className="text-sky-700">Service Msgs</span>
                  <span className="block text-[9px] text-slate-400 font-normal lowercase">1k free / mo</span>
                </th>
                <th className="py-3.5 px-3 text-right">
                  <span className="text-emerald-700">Utility</span>
                  <span className="block text-[9px] text-slate-400 font-normal lowercase">₹{rates.utilityRate.toFixed(4)}</span>
                </th>
                <th className="py-3.5 px-3 text-right">
                  <span className="text-purple-700">Auth (OTPs)</span>
                  <span className="block text-[9px] text-slate-400 font-normal lowercase">₹{rates.authRate.toFixed(4)}</span>
                </th>
                <th className="py-3.5 px-3 text-right">Total Msgs</th>
                <th className="py-3.5 px-3 text-right">
                  <span className="text-amber-700">Free Savings</span>
                </th>
                <th className="py-3.5 px-3 text-right">Net Base</th>
                <th className="py-3.5 px-3 text-right">GST ({rates.gstPct}%)</th>
                <th className="py-3.5 px-4 text-right">Total Cost</th>
                <th className="py-3.5 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-sky-500" />
                      <span className="text-xs font-semibold">Calculating Meta message expenses...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredAndSortedCompanies.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Building2 className="w-8 h-8 text-slate-300" />
                      <span className="text-sm font-bold text-slate-600">No organizations found</span>
                      <span className="text-xs text-slate-400">Try adjusting your filters or date range.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAndSortedCompanies.map((comp) => {
                  const isFullyFree = comp.totalCost === 0 && comp.total > 0;
                  const freeQuota = comp.freeQuota || rates.freeQuota;
                  const freePercent =
                    comp.service > 0
                      ? Math.min(100, Math.round((comp.freeServiceUsed / comp.service) * 100))
                      : 100;

                  return (
                    <tr
                      key={comp._id}
                      className="hover:bg-sky-50/40 transition-colors group"
                    >
                      {/* Organization Info */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-black text-slate-700 text-xs shrink-0 group-hover:border-sky-300 group-hover:bg-sky-50 transition-colors">
                            {comp.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{comp.name}</span>
                              {comp.companyId && (
                                <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded">
                                  {comp.companyId}
                                </span>
                              )}
                              {!comp.isActive && (
                                <span className="text-[9px] font-bold text-rose-500 bg-rose-50 px-1 rounded">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                              {comp.phoneNumber ? (
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3 h-3 text-slate-400" />
                                  {comp.phoneNumber}
                                </span>
                              ) : (
                                <span className="text-slate-300">No phone configured</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Service Messages & Free Allowance */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-bold text-slate-900">
                          {formatNumber(comp.service)}
                        </div>
                        <div className="text-[10px] flex items-center justify-end gap-1 mt-0.5">
                          {comp.service <= freeQuota ? (
                            <span className="text-amber-600 bg-amber-50 px-1 py-0.2 rounded font-bold border border-amber-200 text-[9px]">
                              100% Free ({formatNumber(comp.freeServiceUsed)}/1K)
                            </span>
                          ) : (
                            <span className="text-sky-700 font-semibold text-[10px]">
                              {formatNumber(comp.billableService)} billed
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          {formatCurrency(comp.serviceCost)}
                        </div>
                      </td>

                      {/* Utility Messages */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-bold text-slate-900">
                          {formatNumber(comp.utility)}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          {formatCurrency(comp.utilityCost)}
                        </div>
                      </td>

                      {/* Authentication (OTPs) */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-bold text-slate-900">
                          {formatNumber(comp.authentication)}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          {formatCurrency(comp.authCost)}
                        </div>
                      </td>

                      {/* Total Messages Dispatched */}
                      <td className="py-3 px-3 text-right">
                        <span className="font-black text-slate-900 text-sm">
                          {formatNumber(comp.total)}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {comp.effectiveCostPerMsg > 0
                            ? `₹${comp.effectiveCostPerMsg.toFixed(4)}/msg`
                            : "₹0.00/msg"}
                        </span>
                      </td>

                      {/* Free Tier Savings */}
                      <td className="py-3 px-3 text-right">
                        <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200 text-xs">
                          {formatCurrency(comp.savings)}
                        </span>
                      </td>

                      {/* Net Base Cost */}
                      <td className="py-3 px-3 text-right font-mono font-medium text-slate-600">
                        {formatCurrency(comp.subtotalCost)}
                      </td>

                      {/* GST (18%) */}
                      <td className="py-3 px-3 text-right font-mono text-slate-500 text-[11px]">
                        {formatCurrency(comp.gstCost)}
                      </td>

                      {/* Total Cost Payable */}
                      <td className="py-3 px-4 text-right">
                        {isFullyFree ? (
                          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-xs">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            ₹0.00 (Free)
                          </div>
                        ) : (
                          <div className="text-sm font-black text-slate-900">
                            {formatCurrency(comp.totalCost)}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            onClick={() => setSelectedCompanyReceipt(comp)}
                            variant="outline"
                            size="sm"
                            className="h-8 px-2.5 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 border-slate-200 text-slate-700 shadow-sm"
                            title="View Itemized Meta Receipt"
                          >
                            <Receipt className="w-3.5 h-3.5 mr-1 text-sky-600" />
                            Invoice
                          </Button>

                          {onOpenCompanyDashboard && (
                            <Button
                              onClick={() => onOpenCompanyDashboard(comp.companyId || comp._id)}
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 rounded-xl text-slate-400 hover:text-sky-600 hover:bg-sky-50"
                              title="Go to Company Dashboard"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Table Footer Totals Row */}
            {filteredAndSortedCompanies.length > 0 && (
              <tfoot>
                <tr className="bg-slate-900 text-white font-bold text-xs border-t-2 border-slate-800">
                  <td className="py-4 px-4 uppercase tracking-wider font-black">
                    Grand Total ({filteredAndSortedCompanies.length} Entities)
                  </td>
                  <td className="py-4 px-3 text-right">
                    <span className="block font-black text-sm">{formatNumber(totals.service)}</span>
                    <span className="text-[10px] text-sky-300 font-mono font-normal">
                      {formatCurrency(totals.serviceCost)}
                    </span>
                  </td>
                  <td className="py-4 px-3 text-right">
                    <span className="block font-black text-sm">{formatNumber(totals.utility)}</span>
                    <span className="text-[10px] text-emerald-300 font-mono font-normal">
                      {formatCurrency(totals.utilityCost)}
                    </span>
                  </td>
                  <td className="py-4 px-3 text-right">
                    <span className="block font-black text-sm">{formatNumber(totals.authentication)}</span>
                    <span className="text-[10px] text-purple-300 font-mono font-normal">
                      {formatCurrency(totals.authCost)}
                    </span>
                  </td>
                  <td className="py-4 px-3 text-right font-black text-sm">
                    {formatNumber(totals.total)}
                  </td>
                  <td className="py-4 px-3 text-right font-black text-amber-300 text-sm">
                    {formatCurrency(totals.savings)}
                  </td>
                  <td className="py-4 px-3 text-right font-mono font-bold">
                    {formatCurrency(totals.subtotalCost)}
                  </td>
                  <td className="py-4 px-3 text-right font-mono text-slate-300 text-[11px]">
                    {formatCurrency(totals.gstCost)}
                  </td>
                  <td className="py-4 px-4 text-right font-black text-emerald-400 text-base">
                    {formatCurrency(totals.totalCost)}
                  </td>
                  <td className="py-4 px-4 text-center">
                    <span className="text-[9px] font-mono text-slate-400 uppercase tracking-widest">
                      Audit OK
                    </span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* 5. Company Itemized Invoice Receipt Modal */}
      {selectedCompanyReceipt && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Invoice Header */}
            <div className="bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 text-white p-6 relative">
              <button
                onClick={() => setSelectedCompanyReceipt(null)}
                className="absolute top-5 right-5 text-slate-400 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400 shadow-inner">
                  <Receipt className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
                    Official Meta Statement
                  </span>
                  <h3 className="text-xl font-black text-white mt-1">
                    {selectedCompanyReceipt.name}
                  </h3>
                  <div className="text-xs text-slate-300 flex items-center gap-3 mt-0.5">
                    <span>Code: {selectedCompanyReceipt.companyId || "N/A"}</span>
                    <span>•</span>
                    <span>Phone: {selectedCompanyReceipt.phoneNumber || "N/A"}</span>
                    <span>•</span>
                    <span>Period: {selectedPeriod.toUpperCase()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Invoice Line Items */}
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Message Category</th>
                      <th className="py-3 px-3 text-right">Dispatched</th>
                      <th className="py-3 px-3 text-right">Free Quota</th>
                      <th className="py-3 px-3 text-right">Billable</th>
                      <th className="py-3 px-3 text-right">Unit Rate</th>
                      <th className="py-3 px-4 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {/* Service Messages Row */}
                    <tr>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">Service Messages</div>
                        <div className="text-[10px] text-slate-400">Customer care & chatbot replies</div>
                      </td>
                      <td className="py-3 px-3 text-right font-bold">
                        {formatNumber(selectedCompanyReceipt.service)}
                      </td>
                      <td className="py-3 px-3 text-right text-amber-600 font-bold">
                        -{formatNumber(selectedCompanyReceipt.freeServiceUsed)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-sky-700">
                        {formatNumber(selectedCompanyReceipt.billableService)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-500">
                        ₹{rates.serviceRate.toFixed(4)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(selectedCompanyReceipt.serviceCost)}
                      </td>
                    </tr>

                    {/* Utility Messages Row */}
                    <tr>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">Utility Messages</div>
                        <div className="text-[10px] text-slate-400">Alerts, receipts, confirmations</div>
                      </td>
                      <td className="py-3 px-3 text-right font-bold">
                        {formatNumber(selectedCompanyReceipt.utility)}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-400">0</td>
                      <td className="py-3 px-3 text-right font-bold">
                        {formatNumber(selectedCompanyReceipt.utility)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-500">
                        ₹{rates.utilityRate.toFixed(4)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(selectedCompanyReceipt.utilityCost)}
                      </td>
                    </tr>

                    {/* Authentication Row */}
                    <tr>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">Authentication (OTPs)</div>
                        <div className="text-[10px] text-slate-400">One-time codes & verifications</div>
                      </td>
                      <td className="py-3 px-3 text-right font-bold">
                        {formatNumber(selectedCompanyReceipt.authentication)}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-400">0</td>
                      <td className="py-3 px-3 text-right font-bold">
                        {formatNumber(selectedCompanyReceipt.authentication)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-500">
                        ₹{rates.authRate.toFixed(4)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(selectedCompanyReceipt.authCost)}
                      </td>
                    </tr>

                    {/* Marketing Row (if any) */}
                    {selectedCompanyReceipt.marketing > 0 && (
                      <tr>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">Marketing Messages</div>
                          <div className="text-[10px] text-slate-400">Promotions & broadcasts</div>
                        </td>
                        <td className="py-3 px-3 text-right font-bold">
                          {formatNumber(selectedCompanyReceipt.marketing)}
                        </td>
                        <td className="py-3 px-3 text-right text-slate-400">0</td>
                        <td className="py-3 px-3 text-right font-bold">
                          {formatNumber(selectedCompanyReceipt.marketing)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-500">
                          ₹{rates.marketingRate.toFixed(4)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(selectedCompanyReceipt.marketingCost)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Total Calculation Card */}
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Net Base Charge (Subtotal):</span>
                  <span className="font-mono font-bold text-slate-800">
                    {formatCurrency(selectedCompanyReceipt.subtotalCost)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200">
                  <span className="font-bold flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5" />
                    Meta Free Tier Subsidy (1,000 Service Msgs):
                  </span>
                  <span className="font-mono font-black">
                    -{formatCurrency(selectedCompanyReceipt.savings)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Standard GST ({rates.gstPct}%):</span>
                  <span className="font-mono text-slate-800">
                    {formatCurrency(selectedCompanyReceipt.gstCost)}
                  </span>
                </div>

                <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-black text-slate-900 block">
                      Total Payable Amount
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Inclusive of all Meta platform charges & taxes
                    </span>
                  </div>
                  <div className="text-2xl font-black text-emerald-600 font-mono">
                    {formatCurrency(selectedCompanyReceipt.totalCost)}
                  </div>
                </div>
              </div>

              {/* Meta Notice Box */}
              <div className="rounded-xl p-3.5 bg-sky-50 border border-sky-100 text-sky-900 text-xs flex items-start gap-2.5">
                <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Meta Billing Policy Compliance:</strong> Each active WhatsApp Business Account is allocated 1,000 free Service messages every calendar month. Unused free messages do not roll over. Inbound customer messages are 100% free of charge.
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-mono">
                Generated by Platform Master Admin
              </span>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => window.print()}
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs font-bold"
                >
                  <Printer className="w-3.5 h-3.5 mr-1" />
                  Print Receipt
                </Button>
                <Button
                  onClick={() => setSelectedCompanyReceipt(null)}
                  className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Rate Settings Drawer/Modal */}
      {showRateSettings && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-600">
                  <SlidersHorizontal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Meta Rate Card Settings
                  </h3>
                  <p className="text-xs text-slate-400">
                    Customize per-message rates or adjust for future Meta updates
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRateSettings(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Service Message Rate (₹ / msg after free tier)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={tempRates.serviceRate}
                  onChange={(e) =>
                    setTempRates((r) => ({ ...r, serviceRate: parseFloat(e.target.value) || 0 }))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Official Meta India: ₹0.1150</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Utility Message Rate (₹ / msg)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={tempRates.utilityRate}
                  onChange={(e) =>
                    setTempRates((r) => ({ ...r, utilityRate: parseFloat(e.target.value) || 0 }))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Official Meta India: ₹0.1150</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Authentication Message Rate (₹ / msg)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={tempRates.authRate}
                  onChange={(e) =>
                    setTempRates((r) => ({ ...r, authRate: parseFloat(e.target.value) || 0 }))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Official Meta India Domestic OTP: ₹0.1150</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Marketing Message Rate (₹ / msg)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={tempRates.marketingRate}
                  onChange={(e) =>
                    setTempRates((r) => ({ ...r, marketingRate: parseFloat(e.target.value) || 0 }))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Official Meta India: ₹0.8631</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Free Service Quota / Mo
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={tempRates.baseMonthlyQuota}
                    onChange={(e) =>
                      setTempRates((r) => ({
                        ...r,
                        baseMonthlyQuota: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Official: 1,000 msgs</span>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={tempRates.gstPct}
                    onChange={(e) =>
                      setTempRates((r) => ({ ...r, gstPct: parseFloat(e.target.value) || 0 }))
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Standard: 18%</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <Button
                onClick={handleResetRates}
                variant="ghost"
                size="sm"
                className="text-xs text-rose-600 hover:bg-rose-50 rounded-xl font-bold"
              >
                Reset to Meta Defaults
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setShowRateSettings(false)}
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs font-bold"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveRates}
                  size="sm"
                  className="bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold px-4"
                >
                  Save & Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
