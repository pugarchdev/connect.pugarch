'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  ShieldAlert, 
  AlertTriangle, 
  Search, 
  Download, 
  RefreshCw, 
  Phone, 
  ChevronDown, 
  ChevronUp, 
  Send, 
  Clock, 
  CheckCircle,
  Building,
  User,
  ArrowUpDown,
  ExternalLink,
  MessageSquareWarning,
  Filter,
  X,
  Layers,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { grievanceAPI, DefaulterOfficer } from '@/lib/api/grievance';
import { departmentAPI, Department } from '@/lib/api/department';
import { Pagination } from '@/components/ui/Pagination';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingDots } from '@/components/dashboard/DashboardPrimitives';
import toast from 'react-hot-toast';

interface DefaultersLedgerViewProps {
  onOpenGrievanceDetail?: (grievanceId: string) => void;
  onOpenTransferWorkload?: (user: any) => void;
}

type SortColumn = 'sr' | 'name' | 'department' | 'phone' | 'grievances' | 'lastReminder';
type SortDirection = 'asc' | 'desc';

export default function DefaultersLedgerView({
  onOpenGrievanceDetail,
  onOpenTransferWorkload
}: DefaultersLedgerViewProps) {
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rawDefaulters, setRawDefaulters] = useState<DefaulterOfficer[]>([]);
  const [departmentsList, setDepartmentsList] = useState<Department[]>([]);
  
  // Executive KPIs
  const [totalDefaulters, setTotalDefaulters] = useState(0);
  const [totalNeglected, setTotalNeglected] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const [worstDepartment, setWorstDepartment] = useState('None');

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('all');
  const [minReminders, setMinReminders] = useState(1); // default fetch all with >= 1 reminder so client can filter 1+, 2+, 3+
  const [filterReminderLevel, setFilterReminderLevel] = useState<'all' | '2plus' | '3plus'>('2plus');
  const [filterCaseVolume, setFilterCaseVolume] = useState<'all' | '3plus' | '5plus' | '10plus'>('all');
  const [filterOverdueDays, setFilterOverdueDays] = useState<'all' | '3plus' | '7plus' | '14plus' | '30plus'>('all');
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>('grievances');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Expandable row state
  const [expandedOfficerId, setExpandedOfficerId] = useState<string | null>(null);

  // Show-Cause Notice Dialog
  const [noticeOfficer, setNoticeOfficer] = useState<DefaulterOfficer | null>(null);
  const [noticeRemarks, setNoticeRemarks] = useState('');
  const [sendingNotice, setSendingNotice] = useState(false);

  // Load department list for filter dropdown
  useEffect(() => {
    departmentAPI.getAll({ listAll: true })
      .then(res => {
        if (res.success && res.data) {
          const depts = (res.data.departments || res.data) as Department[];
          if (Array.isArray(depts)) setDepartmentsList(depts);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch defaulters data
  const fetchDefaulters = useCallback(async () => {
    try {
      setLoading(true);
      const res = await grievanceAPI.getDefaulters({
        minReminders: 1, // Fetch all from 1+ reminders so Collector can switch between 1+, 2+, 3+ instantly
        sortBy: 'count'
      });
      if (res.success && res.data) {
        const list = res.data.defaulters || [];
        setRawDefaulters(list);
        setTotalDefaulters(res.data.totalDefaulterOfficers || list.filter(d => (d.totalDefaulterGrievances || 0) > 0).length);
        setTotalNeglected(res.data.totalNeglectedGrievances || list.reduce((sum, d) => sum + (d.totalDefaulterGrievances || 0), 0));
        setWorstDepartment(res.data.worstDepartment || 'None');
        
        // Critical count (officers with tickets having >= 3 reminders)
        const crit = res.data.criticalOfficersCount ?? list.filter(d => 
          (d.grievances || []).some(g => (g.reminderCount || 0) >= 3)
        ).length;
        setCriticalCount(crit);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load defaulters');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDefaulters();
  }, [fetchDefaulters]);

  // SLA Scan Action
  const handleTriggerScan = async () => {
    try {
      setScanning(true);
      const res = await grievanceAPI.triggerSlaCronScan();
      if (res.success) {
        toast.success(res.message || 'SLA Escalation Scan complete');
        fetchDefaulters();
      }
    } catch (err: any) {
      toast.error('Failed to trigger scan: ' + (err.message || 'Unknown error'));
    } finally {
      setScanning(false);
    }
  };

  // CSV Export with authentication & direct download
  const handleExportCsv = async () => {
    try {
      setExporting(true);
      const minR = filterReminderLevel === '3plus' ? 3 : filterReminderLevel === '2plus' ? 2 : 1;
      await grievanceAPI.exportDefaultersCsv(minR);
      toast.success('Defaulter officers report downloaded successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to download report');
    } finally {
      setExporting(false);
    }
  };

  // Show-Cause Notice Handler
  const openNoticeDialog = (officer: DefaulterOfficer) => {
    setNoticeOfficer(officer);
    setNoticeRemarks(
      `Collectorate Directive: You have ${officer.totalDefaulterGrievances} public grievance(s) pending resolution despite multiple reminders. Immediate resolution or written explanation required within 24 hours.`
    );
  };

  const handleSendNotice = async () => {
    if (!noticeOfficer) return;
    try {
      setSendingNotice(true);
      const res = await grievanceAPI.sendShowCauseNotice(noticeOfficer.officerId, noticeRemarks);
      if (res.success) {
        toast.success(res.message || 'Show-cause notice dispatched');
        setNoticeOfficer(null);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to send notice');
    } finally {
      setSendingNotice(false);
    }
  };

  const toggleExpand = (officerId: string) => {
    setExpandedOfficerId(prev => (prev === officerId ? null : officerId));
  };

  // Unique Department options compiled from raw data + api
  const uniqueDepartments = useMemo(() => {
    const fromData = rawDefaulters.map(d => d.departmentName).filter(Boolean);
    const fromApi = departmentsList.map(d => d.name).filter(Boolean);
    const combined = Array.from(new Set([...fromData, ...fromApi])).sort((a, b) => a.localeCompare(b));
    return combined;
  }, [rawDefaulters, departmentsList]);

  // Filter Pipeline
  const filteredDefaulters = useMemo(() => {
    let result = [...rawDefaulters];

    // Reminder Level Filter
    if (filterReminderLevel === '2plus') {
      result = result.filter(d => (d.grievances || []).some(g => (g.reminderCount || 0) >= 2) || (d.totalDefaulterGrievances || 0) >= 1);
    } else if (filterReminderLevel === '3plus') {
      result = result.filter(d => (d.grievances || []).some(g => (g.reminderCount || 0) >= 3));
    }

    // Department Filter
    if (selectedDept !== 'all') {
      result = result.filter(d => d.departmentName === selectedDept || d.departmentId === selectedDept);
    }

    // Case Volume Filter
    if (filterCaseVolume === '3plus') {
      result = result.filter(d => (d.totalDefaulterGrievances || 0) >= 3);
    } else if (filterCaseVolume === '5plus') {
      result = result.filter(d => (d.totalDefaulterGrievances || 0) >= 5);
    } else if (filterCaseVolume === '10plus') {
      result = result.filter(d => (d.totalDefaulterGrievances || 0) >= 10);
    }

    // Days Overdue Filter
    if (filterOverdueDays !== 'all') {
      const now = Date.now();
      const minDays = filterOverdueDays === '3plus' ? 3 : filterOverdueDays === '7plus' ? 7 : filterOverdueDays === '14plus' ? 14 : 30;
      const minMs = minDays * 24 * 60 * 60 * 1000;
      result = result.filter(d => {
        if (!d.latestReminderAt && !d.oldestReminderAt) return false;
        const time = new Date(d.latestReminderAt || d.oldestReminderAt!).getTime();
        return (now - time) >= minMs;
      });
    }

    // Search Query (Officer name, designation, department, phone)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(d => 
        (d.officerName && d.officerName.toLowerCase().includes(q)) ||
        (d.designation && d.designation.toLowerCase().includes(q)) ||
        (d.departmentName && d.departmentName.toLowerCase().includes(q)) ||
        (d.phone && d.phone.includes(q))
      );
    }

    return result;
  }, [rawDefaulters, filterReminderLevel, selectedDept, filterCaseVolume, filterOverdueDays, searchQuery]);

  // Sorting Pipeline
  const sortedDefaulters = useMemo(() => {
    const list = [...filteredDefaulters];
    list.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'name':
          comparison = (a.officerName || '').localeCompare(b.officerName || '');
          break;
        case 'department':
          comparison = (a.departmentName || '').localeCompare(b.departmentName || '');
          break;
        case 'phone':
          comparison = (a.phone || '').localeCompare(b.phone || '');
          break;
        case 'grievances':
          comparison = (a.totalDefaulterGrievances || 0) - (b.totalDefaulterGrievances || 0);
          break;
        case 'lastReminder': {
          const tA = a.latestReminderAt ? new Date(a.latestReminderAt).getTime() : 0;
          const tB = b.latestReminderAt ? new Date(b.latestReminderAt).getTime() : 0;
          comparison = tA - tB;
          break;
        }
        case 'sr':
        default:
          comparison = 0;
          break;
      }
      return sortDirection === 'desc' ? -comparison : comparison;
    });
    return list;
  }, [filteredDefaulters, sortColumn, sortDirection]);

  // Pagination Slice
  const totalPages = Math.max(1, Math.ceil(sortedDefaulters.length / itemsPerPage));
  const totalFilteredCount = sortedDefaulters.length;
  const startItem = totalFilteredCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalFilteredCount);
  const paginatedDefaulters = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedDefaulters.slice(start, start + itemsPerPage);
  }, [sortedDefaulters, currentPage, itemsPerPage]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDept, filterReminderLevel, filterCaseVolume, filterOverdueDays, itemsPerPage]);

  // Header click sort handler
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const isFiltered = Boolean(
    searchQuery.trim() || 
    selectedDept !== 'all' || 
    filterReminderLevel !== '2plus' || 
    filterCaseVolume !== 'all' || 
    filterOverdueDays !== 'all'
  );

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedDept('all');
    setFilterReminderLevel('2plus');
    setFilterCaseVolume('all');
    setFilterOverdueDays('all');
    setCurrentPage(1);
  };

  const renderSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors ml-1" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-sky-600 font-bold ml-1" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-sky-600 font-bold ml-1" />
    );
  };

  return (
    <div className="space-y-5">
      {/* 🏛️ Top Header Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
        
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
              Defaulter Officers & Non-Compliance Tracker
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
              Official audit of assigned officers ignoring public grievances after 2+ official reminders from the Collector&apos;s Office.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
            <button
              onClick={handleTriggerScan}
              disabled={scanning}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold uppercase tracking-wider shadow-sm transition-all disabled:opacity-50 hover:border-slate-300 whitespace-nowrap"
              title="Run background SLA scan immediately"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-sky-600 shrink-0 ${scanning ? 'animate-spin' : ''}`} />
              <span className="shrink-0">{scanning ? 'Scanning...' : 'Run SLA Scan'}</span>
            </button>

            <button
              onClick={handleExportCsv}
              disabled={exporting}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold uppercase tracking-wider shadow-sm transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
              title="Download CSV report for District Review Meeting"
            >
              <Download className={`w-3.5 h-3.5 shrink-0 ${exporting ? 'animate-bounce' : ''}`} />
              <span className="shrink-0">{exporting ? 'Exporting...' : 'Export'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 📊 4 KPI Cards Grid - Matching Overview Page (2 per row on mobile, 4 on desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* KPI 1: Defaulting Officers */}
        <Card
          onClick={() => setFilterReminderLevel(filterReminderLevel === '2plus' ? 'all' : '2plus')}
          title="Filter officers with 2 or more reminders"
          className={`min-h-[6.5rem] sm:min-h-[8rem] cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${
            filterReminderLevel === '2plus'
              ? 'ring-2 ring-rose-400/50 border-rose-300'
              : 'hover:border-rose-200'
          }`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-t-[3px] border-rose-500 bg-slate-50/50 px-3 py-2.5">
            <CardTitle className="text-[12px] sm:text-[14px] font-black uppercase tracking-wider text-slate-500">
              Defaulters
            </CardTitle>
            <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
          </CardHeader>
          <CardContent className="px-3 py-2.5">
            <div className="text-xl sm:text-2xl font-black tabular-nums text-rose-600">
              {loading ? <LoadingDots /> : totalDefaulters}
            </div>
            <p className="mt-1 text-xs font-bold uppercase text-slate-400 tracking-tight">
              2+ Reminders
            </p>
          </CardContent>
        </Card>

        {/* KPI 2: Neglected Grievances */}
        <Card
          title="Total overdue grievances with defaulting officers"
          className="min-h-[6.5rem] sm:min-h-[8rem] cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-amber-200"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-t-[3px] border-amber-500 bg-slate-50/50 px-3 py-2.5">
            <CardTitle className="text-[12px] sm:text-[14px] font-black uppercase tracking-wider text-slate-500">
              Neglected
            </CardTitle>
            <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          </CardHeader>
          <CardContent className="px-3 py-2.5">
            <div className="text-xl sm:text-2xl font-black tabular-nums text-amber-600">
              {loading ? <LoadingDots /> : totalNeglected}
            </div>
            <p className="mt-1 text-xs font-bold uppercase text-slate-400 tracking-tight">
              Overdue Tickets
            </p>
          </CardContent>
        </Card>

        {/* KPI 3: Critical Collector Escalations */}
        <Card
          onClick={() => setFilterReminderLevel(filterReminderLevel === '3plus' ? 'all' : '3plus')}
          title="Filter critical non-compliance: 3 or more reminders"
          className={`min-h-[6.5rem] sm:min-h-[8rem] cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${
            filterReminderLevel === '3plus'
              ? 'ring-2 ring-purple-400/50 border-purple-300'
              : 'hover:border-purple-200'
          }`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-t-[3px] border-purple-500 bg-slate-50/50 px-3 py-2.5">
            <CardTitle className="text-[12px] sm:text-[14px] font-black uppercase tracking-wider text-slate-500">
              Critical
            </CardTitle>
            <ShieldAlert className="h-3.5 w-3.5 text-purple-500 shrink-0" />
          </CardHeader>
          <CardContent className="px-3 py-2.5">
            <div className="text-xl sm:text-2xl font-black tabular-nums text-purple-600">
              {loading ? <LoadingDots /> : criticalCount}
            </div>
            <p className="mt-1 text-xs font-bold uppercase text-slate-400 tracking-tight">
              3+ Reminders
            </p>
          </CardContent>
        </Card>

        {/* KPI 4: Worst Hit Department */}
        <Card
          title="Department with highest count of defaulted grievances"
          className="min-h-[6.5rem] sm:min-h-[8rem] cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-sky-200"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-t-[3px] border-sky-500 bg-slate-50/50 px-3 py-2.5">
            <CardTitle className="text-[12px] sm:text-[14px] font-black uppercase tracking-wider text-slate-500">
              Worst Hit
            </CardTitle>
            <Building className="h-3.5 w-3.5 text-sky-500 shrink-0" />
          </CardHeader>
          <CardContent className="px-3 py-2.5">
            <div className="text-sm sm:text-base font-black text-slate-900 leading-snug line-clamp-1" title={worstDepartment}>
              {loading ? <LoadingDots /> : worstDepartment}
            </div>
            <p className="mt-1 text-xs font-bold uppercase text-slate-400 tracking-tight">
              Backlog Density
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 🔍 Search & Controls Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        {/* Top Row: Search Input + Rows Selector + Total Showing */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 min-w-0 md:max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Quick search officers, designation, phone, department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 h-9 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all text-xs font-semibold text-slate-800 placeholder:text-slate-400 shadow-sm"
            />
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap">
            <button
              onClick={() => setShowMobileFilters(prev => !prev)}
              className="md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-sm h-8"
              title="Toggle filter controls"
            >
              <Filter className="w-3.5 h-3.5 text-sky-600" />
              <span>Filters</span>
              {isFiltered && <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>}
            </button>

            <span className="text-xs font-bold text-slate-700 bg-white px-2.5 py-1.5 rounded-lg shadow-sm border border-slate-200 whitespace-nowrap h-8 flex items-center">
              Showing <span className="text-sky-600 font-black px-1">{totalFilteredCount === 0 ? '0' : `${startItem} - ${endItem}`}</span> of {totalFilteredCount}
            </span>

            <div className="flex items-center gap-2 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-sm h-8">
              <span className="text-xs font-black text-slate-400 uppercase tracking-wider">
                Rows:
              </span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="text-xs font-bold text-slate-900 bg-transparent border-0 focus:ring-0 cursor-pointer p-0 h-auto"
              >
                {[10, 20, 25, 50, 100].map((limit) => (
                  <option key={limit} value={limit}>
                    {limit}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Bottom Row: Additional Filters (Collapsible on mobile) */}
        <div className={`flex-col md:flex-row flex-wrap items-stretch md:items-center gap-2 pt-2 border-t border-slate-100 ${showMobileFilters ? 'flex' : 'hidden md:flex'}`}>
          <div className="hidden md:flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 h-8 shrink-0">
            <Filter className="w-3.5 h-3.5 text-sky-600" />
            <span className="text-xs font-black text-slate-600 uppercase tracking-wide">Filters</span>
          </div>

          {/* Department Filter */}
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="text-xs h-9 md:h-8 px-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white font-medium text-slate-700 hover:border-slate-300 transition-colors cursor-pointer w-full md:w-auto md:min-w-[140px] md:max-w-[200px]"
            title="Filter by department"
          >
            <option value="all">🏢 All Departments</option>
            {uniqueDepartments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>

          {/* Reminder Level Filter */}
          <select
            value={filterReminderLevel}
            onChange={(e) => setFilterReminderLevel(e.target.value as any)}
            className="text-xs h-9 md:h-8 px-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white font-medium text-slate-700 hover:border-slate-300 transition-colors cursor-pointer w-full md:w-auto"
            title="Filter by reminder escalation tier"
          >
            <option value="all">All Reminders (1+)</option>
            <option value="2plus">Defaulters Only (2+ Reminders)</option>
            <option value="3plus">Critical Escalations (3+ Reminders)</option>
          </select>

          {/* Case Volume Filter */}
          <select
            value={filterCaseVolume}
            onChange={(e) => setFilterCaseVolume(e.target.value as any)}
            className="text-xs h-9 md:h-8 px-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white font-medium text-slate-700 hover:border-slate-300 transition-colors cursor-pointer w-full md:w-auto"
            title="Filter by volume of neglected grievances"
          >
            <option value="all">All Case Volumes</option>
            <option value="3plus">3+ Neglected Tickets</option>
            <option value="5plus">5+ Heavy Backlog</option>
            <option value="10plus">10+ Extreme Neglect</option>
          </select>

          {/* Days Overdue Filter */}
          <select
            value={filterOverdueDays}
            onChange={(e) => setFilterOverdueDays(e.target.value as any)}
            className="text-xs h-9 md:h-8 px-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white font-medium text-slate-700 hover:border-slate-300 transition-colors cursor-pointer w-full md:w-auto"
            title="Filter by days since last reminder"
          >
            <option value="all">All Overdue Days</option>
            <option value="3plus">Overdue &gt; 3 Days</option>
            <option value="7plus">Overdue &gt; 7 Days</option>
            <option value="14plus">Overdue &gt; 14 Days</option>
            <option value="30plus">Overdue &gt; 30 Days</option>
          </select>

          {/* Clear Filters Button */}
          {isFiltered && (
            <button
              onClick={handleClearFilters}
              className="h-9 md:h-8 px-3 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg border border-rose-200 font-bold transition-all flex items-center justify-center gap-1 cursor-pointer w-full md:w-auto shrink-0"
              title="Reset all search and filter conditions"
            >
              <X className="w-3 h-3" />
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* 📋 Defaulters Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-slate-500 flex flex-col items-center gap-3">
            <RefreshCw className="w-8 h-8 text-sky-600 animate-spin" />
            <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Analyzing Officer Performance...</p>
          </div>
        ) : sortedDefaulters.length === 0 ? (
          <div className="p-16 text-center text-slate-500 flex flex-col items-center gap-3">
            <CheckCircle className="w-12 h-12 text-emerald-500" />
            <h3 className="text-base font-bold text-slate-800">No Defaulting Officers Matching Filters</h3>
            <p className="text-xs text-slate-500 max-w-md">
              {isFiltered 
                ? 'Try adjusting or clearing your search and filter criteria to view more records.' 
                : 'All assigned officers are currently within compliance thresholds.'}
            </p>
            {isFiltered && (
              <button
                onClick={handleClearFilters}
                className="mt-2 px-3.5 py-1.5 text-xs font-bold text-sky-600 hover:text-sky-700 border border-sky-200 rounded-lg hover:bg-sky-50"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 📱 Mobile Card List View (Visible on Mobile & Tablet < md) */}
            <div className="md:hidden divide-y divide-slate-100">
              {paginatedDefaulters.map((officer, index) => {
                const isExpanded = expandedOfficerId === officer.officerId;
                const daysSinceReminder = officer.latestReminderAt
                  ? Math.floor((Date.now() - new Date(officer.latestReminderAt).getTime()) / (1000 * 60 * 60 * 24))
                  : 0;
                const rowNumber = (currentPage - 1) * itemsPerPage + index + 1;
                const hasCritical = (officer.grievances || []).some(g => (g.reminderCount || 0) >= 3);

                return (
                  <div key={officer.officerId} className="p-3.5 sm:p-4 space-y-3 bg-white">
                    {/* ── TOP BAR: Row # and Ignored Cases Badge ── */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-black flex items-center justify-center shrink-0 border border-slate-200">
                          {rowNumber}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          Officer #{rowNumber}
                        </span>
                      </div>

                      {/* Ignored Tickets Pill */}
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black shrink-0 border ${
                        hasCritical 
                          ? 'bg-rose-50 text-rose-700 border-rose-200 ring-1 ring-rose-400/20' 
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                        {officer.totalDefaulterGrievances} Tickets
                      </span>
                    </div>

                    {/* ── OFFICER IDENTITY: Full Name & Designation (No Truncation) ── */}
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-xs shrink-0 border mt-0.5 ${
                        hasCritical 
                          ? 'bg-rose-100 text-rose-700 border-rose-200' 
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}>
                        {officer.officerName.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm sm:text-base text-slate-900 leading-snug break-words whitespace-normal">
                          {officer.officerName}
                        </h4>
                        <div className="mt-1">
                          <span className="inline-block text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded leading-normal break-words whitespace-normal border border-slate-200/60">
                            {officer.designation || 'Officer'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ── DETAILS STRIP: Full Department, Contact & Last Reminder ── */}
                    <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100 space-y-2 text-xs">
                      {/* Department (Full Width so it never truncates) */}
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-0.5">
                          Department
                        </span>
                        <p className="font-bold text-slate-800 leading-tight break-words whitespace-normal">
                          {officer.departmentName}
                        </p>
                      </div>

                      {/* Phone & Last Reminder */}
                      <div className="pt-2 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-0.5">
                            Contact
                          </span>
                          {officer.phone ? (
                            <a
                              href={`tel:${officer.phone}`}
                              className="inline-flex items-center gap-1 font-bold text-slate-700 hover:text-sky-600"
                            >
                              <Phone className="w-3 h-3 text-sky-600 shrink-0" />
                              {officer.phone}
                            </a>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">No phone</span>
                          )}
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-0.5">
                            Last Reminder
                          </span>
                          {officer.latestReminderAt ? (
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <span className="font-medium text-slate-700 text-xs">
                                {new Date(officer.latestReminderAt).toLocaleDateString()} • {new Date(officer.latestReminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
                              {daysSinceReminder > 0 && (
                                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">
                                  {daysSinceReminder}d ago
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">N/A</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons: View Cases & Show-Cause */}
                    <div className="flex items-center justify-end gap-2 pt-0.5">
                      <button
                        onClick={() => toggleExpand(officer.officerId)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold transition-all cursor-pointer"
                      >
                        {isExpanded ? (
                          <>Hide Cases <ChevronUp className="w-3.5 h-3.5" /></>
                        ) : (
                          <>View Cases <ChevronDown className="w-3.5 h-3.5" /></>
                        )}
                      </button>

                      <button
                        onClick={() => openNoticeDialog(officer)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
                      >
                        <MessageSquareWarning className="w-3.5 h-3.5" />
                        Show-Cause
                      </button>
                    </div>

                    {/* Expanded Cases on Mobile */}
                    {isExpanded && (
                      <div className="pt-2 space-y-2 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                          <h5 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                            Neglected Cases ({officer.grievances.length})
                          </h5>
                          {onOpenTransferWorkload && (
                            <button
                              onClick={() => onOpenTransferWorkload({ _id: officer.officerId, firstName: officer.firstName, lastName: officer.lastName })}
                              className="text-[11px] font-bold text-sky-600 hover:underline"
                            >
                              Reassign &rarr;
                            </button>
                          )}
                        </div>
                        <div className="space-y-2">
                          {officer.grievances.map((g) => (
                            <div
                              key={g._id}
                              className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-bold text-xs text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
                                  {g.grievanceId}
                                </span>
                                <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${
                                  (g.reminderCount || 0) >= 3 
                                    ? 'bg-rose-100 text-rose-800 border border-rose-200' 
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}>
                                  {g.reminderCount} Reminders
                                </span>
                              </div>
                              <p className="text-xs font-bold text-slate-800">{g.citizenName} ({g.citizenPhone})</p>
                              <p className="text-xs text-slate-600 italic line-clamp-2">&ldquo;{g.description}&rdquo;</p>
                              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1.5 border-t border-slate-200/60">
                                <span>
                                  Raised: {new Date(g.createdAt).toLocaleDateString()} • {new Date(g.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                </span>
                                {onOpenGrievanceDetail && (
                                  <button
                                    onClick={() => onOpenGrievanceDetail(g._id)}
                                    className="font-bold text-sky-600 flex items-center gap-1"
                                  >
                                    Details <ExternalLink className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 🖥️ Desktop Table View (Hidden on mobile < md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-xs font-black uppercase text-slate-500 tracking-wider">
                  <th className="py-3 px-3.5 text-center w-12">
                    <button 
                      onClick={() => handleSort('sr')} 
                      className="group inline-flex items-center justify-center font-black hover:text-slate-900 transition-colors"
                    >
                      <span>#</span>
                      {renderSortIndicator('sr')}
                    </button>
                  </th>

                  <th className="py-3 px-5">
                    <button 
                      onClick={() => handleSort('name')} 
                      className="group inline-flex items-center font-black hover:text-slate-900 transition-colors"
                    >
                      <span>Officer &amp; Designation</span>
                      {renderSortIndicator('name')}
                    </button>
                  </th>

                  <th className="py-3 px-5">
                    <button 
                      onClick={() => handleSort('department')} 
                      className="group inline-flex items-center font-black hover:text-slate-900 transition-colors"
                    >
                      <span>Department</span>
                      {renderSortIndicator('department')}
                    </button>
                  </th>

                  <th className="py-3 px-5">
                    <button 
                      onClick={() => handleSort('phone')} 
                      className="group inline-flex items-center font-black hover:text-slate-900 transition-colors"
                    >
                      <span>Contact</span>
                      {renderSortIndicator('phone')}
                    </button>
                  </th>

                  <th className="py-3 px-5 text-center">
                    <button 
                      onClick={() => handleSort('grievances')} 
                      className="group inline-flex items-center justify-center font-black hover:text-slate-900 transition-colors mx-auto"
                    >
                      <span>Ignored Grievances</span>
                      {renderSortIndicator('grievances')}
                    </button>
                  </th>

                  <th className="py-3 px-5 text-center">
                    <button 
                      onClick={() => handleSort('lastReminder')} 
                      className="group inline-flex items-center justify-center font-black hover:text-slate-900 transition-colors mx-auto"
                    >
                      <span>Last Reminder</span>
                      {renderSortIndicator('lastReminder')}
                    </button>
                  </th>

                  <th className="py-3 px-5 text-right font-black">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {paginatedDefaulters.map((officer, index) => {
                  const isExpanded = expandedOfficerId === officer.officerId;
                  const daysSinceReminder = officer.latestReminderAt
                    ? Math.floor((Date.now() - new Date(officer.latestReminderAt).getTime()) / (1000 * 60 * 60 * 24))
                    : 0;
                  const rowNumber = (currentPage - 1) * itemsPerPage + index + 1;
                  const hasCritical = (officer.grievances || []).some(g => (g.reminderCount || 0) >= 3);

                  return (
                    <React.Fragment key={officer.officerId}>
                      <tr className={`transition-colors ${isExpanded ? 'bg-slate-50/70' : 'hover:bg-slate-50/60'}`}>
                        <td className="py-3.5 px-3.5 text-center font-bold text-slate-400">
                          {rowNumber}
                        </td>

                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-xs shrink-0 border ${
                              hasCritical 
                                ? 'bg-rose-100 text-rose-700 border-rose-200' 
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}>
                              {officer.officerName.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 truncate">{officer.officerName}</p>
                              <span className="inline-block text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded mt-0.5 max-w-[220px] truncate">
                                {officer.designation || 'Officer'}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-5">
                          <p className="font-semibold text-slate-800 line-clamp-1">{officer.departmentName}</p>
                        </td>

                        <td className="py-3.5 px-5">
                          {officer.phone ? (
                            <a
                              href={`tel:${officer.phone}`}
                              className="inline-flex items-center gap-1.5 font-bold text-slate-700 hover:text-sky-600 transition-colors"
                              title="Call officer"
                            >
                              <Phone className="w-3.5 h-3.5 text-slate-400" />
                              {officer.phone}
                            </a>
                          ) : (
                            <span className="text-slate-400 italic">No phone</span>
                          )}
                        </td>

                        <td className="py-3.5 px-5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black border ${
                            hasCritical 
                              ? 'bg-rose-100 text-rose-800 border-rose-200 ring-1 ring-rose-400/20' 
                              : 'bg-amber-100 text-amber-800 border-amber-200'
                          }`}>
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            {officer.totalDefaulterGrievances} Tickets
                          </span>
                        </td>

                        <td className="py-3.5 px-5 text-center">
                          {officer.latestReminderAt ? (
                            <div className="flex flex-col items-center">
                              <span className="font-medium text-slate-700 whitespace-nowrap">
                                {new Date(officer.latestReminderAt).toLocaleDateString()} • {new Date(officer.latestReminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
                              {daysSinceReminder > 0 && (
                                <span className="text-[11px] font-bold text-rose-600 block mt-0.5">
                                  {daysSinceReminder}d ago
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">N/A</span>
                          )}
                        </td>

                        <td className="py-3.5 px-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => toggleExpand(officer.officerId)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-bold transition-all cursor-pointer"
                              title="Inspect specific ignored grievances"
                            >
                              {isExpanded ? (
                                <>Hide <ChevronUp className="w-3.5 h-3.5" /></>
                              ) : (
                                <>View Cases <ChevronDown className="w-3.5 h-3.5" /></>
                              )}
                            </button>

                            <button
                              onClick={() => openNoticeDialog(officer)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
                              title="Issue formal Collector Directive / Show-Cause notice"
                            >
                              <MessageSquareWarning className="w-3.5 h-3.5" />
                              Show-Cause
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* 📂 Expanded Row: List of Neglected Tickets */}
                      {isExpanded && (
                        <tr className="bg-slate-50/90 border-y border-slate-200">
                          <td colSpan={7} className="p-4 sm:p-5">
                            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3.5">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
                                  <AlertTriangle className="w-4 h-4 text-rose-500" />
                                  Neglected Grievances Under {officer.officerName}
                                </h4>
                                {onOpenTransferWorkload && (
                                  <button
                                    onClick={() => onOpenTransferWorkload({ _id: officer.officerId, firstName: officer.firstName, lastName: officer.lastName })}
                                    className="text-xs font-bold text-sky-600 hover:text-sky-800 underline flex items-center gap-1 cursor-pointer"
                                  >
                                    Reassign Workload to Another Officer &rarr;
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {officer.grievances.map((g) => (
                                  <div
                                    key={g._id}
                                    className="border border-slate-200 rounded-lg p-3 hover:border-sky-300 transition-all bg-slate-50/50 flex flex-col justify-between gap-2"
                                  >
                                    <div>
                                      <div className="flex items-center justify-between gap-2 mb-1.5">
                                        <span className="font-mono font-bold text-xs text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
                                          {g.grievanceId}
                                        </span>
                                        <span className={`inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full ${
                                          (g.reminderCount || 0) >= 3 
                                            ? 'bg-rose-100 text-rose-800 border border-rose-200' 
                                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                                        }`}>
                                          {g.reminderCount} Reminders
                                        </span>
                                      </div>

                                      <p className="text-xs font-bold text-slate-800 line-clamp-1">{g.citizenName} ({g.citizenPhone})</p>
                                      <p className="text-xs text-slate-600 line-clamp-2 mt-1 italic">&ldquo;{g.description}&rdquo;</p>
                                    </div>

                                    <div className="border-t border-slate-200/60 pt-2 text-[11px] text-slate-500 flex items-center justify-between">
                                      <span>
                                        Raised: {new Date(g.createdAt).toLocaleDateString()} • {new Date(g.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                      </span>
                                      {onOpenGrievanceDetail && (
                                        <button
                                          onClick={() => onOpenGrievanceDetail(g._id)}
                                          className="font-bold text-sky-600 hover:underline flex items-center gap-1 cursor-pointer"
                                        >
                                          Details <ExternalLink className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

        {/* 📄 Pagination Footer matching other pages */}
        {sortedDefaulters.length > 0 && (
          <div className="p-4 border-t border-slate-100 bg-slate-50/50">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={sortedDefaulters.length}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>

      {/* 🛑 Collector Show-Cause Notice Dialog Modal */}
      {noticeOfficer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full p-4 sm:p-6 shadow-2xl border border-rose-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Issue Collectorate Directive</h3>
                <p className="text-xs font-bold text-slate-500">To: {noticeOfficer.officerName} ({noticeOfficer.designation || 'Officer'})</p>
              </div>
            </div>

            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-800 leading-relaxed">
              <strong>Official Notice:</strong> This will dispatch an official Show-Cause directive to the officer&apos;s registered WhatsApp phone number (<strong>{noticeOfficer.phone}</strong>) and in-app dashboard.
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Notice Text / Collector Remarks
              </label>
              <textarea
                value={noticeRemarks}
                onChange={(e) => setNoticeRemarks(e.target.value)}
                rows={4}
                className="w-full border border-slate-300 rounded-xl p-3 text-xs focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setNoticeOfficer(null)}
                disabled={sendingNotice}
                className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSendNotice}
                disabled={sendingNotice || !noticeRemarks.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-rose-900/20 disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                {sendingNotice ? 'Issuing Notice...' : 'Issue Official Directive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
