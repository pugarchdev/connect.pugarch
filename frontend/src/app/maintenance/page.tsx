"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { 
  RefreshCw, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Server, 
  Clock, 
  ShieldCheck,
  Radio
} from 'lucide-react';
import toast from 'react-hot-toast';

type CheckStatus = 'idle' | 'checking' | 'healthy' | 'maintenance' | 'offline';

export default function MaintenancePage() {
  const [status, setStatus] = useState<CheckStatus>('idle');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [statusDetail, setStatusDetail] = useState<string>('');
  const [checkCount, setCheckCount] = useState<number>(0);

  const checkHealthStatus = useCallback(async (isManual: boolean = false) => {
    if (isManual) {
      setStatus('checking');
    }

    const startTime = Date.now();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
    const healthUrl = `${apiUrl}/health?t=${Date.now()}`;

    try {
      const response = await fetch(healthUrl, {
        cache: 'no-store',
      });

      // Maintain a slight delay for manual check so the user can see feedback
      if (isManual) {
        const elapsed = Date.now() - startTime;
        if (elapsed < 600) {
          await new Promise((resolve) => setTimeout(resolve, 600 - elapsed));
        }
      }

      if (response.ok) {
        const data = await response.json();
        const isHealthy = data.status === 'OK' && data.maintenance !== true;

        setLastChecked(new Date());
        setCheckCount((prev) => prev + 1);

        if (isHealthy) {
          setStatus('healthy');
          setStatusDetail('All systems are operational! Restoring access...');
          if (isManual) {
            toast.success('System restored! Redirecting to portal...');
          }
          setTimeout(() => {
            window.location.href = '/';
          }, 1200);
          return;
        } else {
          setStatus('maintenance');
          const reason = data.maintenanceReason || data.message || 'System update in progress';
          setStatusDetail(reason);
          if (isManual) {
            toast('System is still undergoing maintenance. Services will resume shortly.', {
              icon: '⏳',
              duration: 3500,
            });
          }
        }
      } else {
        setLastChecked(new Date());
        setStatus('maintenance');
        setStatusDetail('Scheduled maintenance in progress (HTTP ' + response.status + ')');
        if (isManual) {
          toast('System update still active. Please try again in a few moments.', {
            icon: '⏳',
            duration: 3500,
          });
        }
      }
    } catch (error) {
      setLastChecked(new Date());
      setStatus('offline');
      setStatusDetail('Server unreachable. Retrying automatically in background...');
      if (isManual) {
        toast.error('Could not reach the server. Retrying shortly...');
      }
    } finally {
      if (isManual && status !== 'healthy') {
        setTimeout(() => {
          setStatus((prev) => (prev === 'healthy' ? 'healthy' : 'idle'));
        }, 800);
      }
    }
  }, [status]);

  // Initial check on mount
  useEffect(() => {
    checkHealthStatus(false);
  }, []);

  // Periodic auto-check every 8 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      checkHealthStatus(false);
    }, 8000);

    return () => clearInterval(timer);
  }, [checkHealthStatus]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8fafc] via-[#fcfcfd] to-[#f1f5f9] flex flex-col justify-between items-center px-4 py-6 sm:px-8 sm:py-8 font-sans antialiased text-[#1a1c21] relative overflow-hidden selection:bg-blue-100">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-blue-100/40 via-blue-50/20 to-transparent blur-3xl -z-10" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-64 bg-slate-100/60 blur-2xl -z-10" />

      {/* Top Header / Branding */}
      <header className="w-full max-w-4xl flex items-center justify-between z-10 pt-2 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#2563eb] rounded-xl flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20 text-lg tracking-tight">
            P
          </div>
          <span className="font-bold text-xl tracking-tight text-[#0f172a]">
            PugArch <span className="text-[#64748b] font-medium">Connect</span>
          </span>
        </div>

        {/* Live Status Badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200/80 text-amber-800 text-xs font-semibold shadow-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          Maintenance Mode Active
        </div>
      </header>

      {/* Main Content Area */}
      <main className="w-full max-w-xl flex-1 flex flex-col items-center justify-center py-6 sm:py-8 z-10 text-center">
        {/* Animated Icon Container */}
        <div className="relative mb-8">
          <div className="absolute inset-0 bg-blue-400/20 blur-2xl rounded-full scale-125 animate-pulse" />
          <div className="relative z-10 flex justify-center">
            <div className="w-24 h-24 sm:w-28 sm:h-28 bg-white rounded-3xl shadow-xl shadow-slate-200/60 flex items-center justify-center border border-slate-100/80 group">
              <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-blue-50 flex items-center justify-center text-[#2563eb] transition-transform duration-300 group-hover:scale-105">
                <Server className="w-8 h-8 sm:w-10 sm:h-10 text-[#2563eb]" />
              </div>
            </div>
          </div>
        </div>

        {/* Headings */}
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#0f172a] mb-3">
          Under Maintenance
        </h1>
        <p className="text-base sm:text-lg text-[#64748b] max-w-md mx-auto mb-8 leading-relaxed">
          The <span className="font-semibold text-[#0f172a]">Grievance Portal</span> is currently undergoing a scheduled update to enhance performance and system reliability.
        </p>

        {/* Current Status Box */}
        <div className="w-full bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-sm mb-6 text-left transition-all">
          <div className="flex items-start gap-3.5">
            <div className="mt-1 flex-shrink-0">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#2563eb]" />
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-[#94a3b8]">
                  Current Status
                </h3>
                {lastChecked && (
                  <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    Last checked: {formatTime(lastChecked)}
                  </span>
                )}
              </div>
              <p className="text-[#334155] text-sm sm:text-[15px] font-medium leading-relaxed">
                The portal is undergoing a scheduled system upgrade. All data and user accounts are secure. We expect full operations to resume shortly.
              </p>
              
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
                <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                  Estimated time: <strong className="text-slate-800">15–20 minutes</strong>
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Radio className="w-3 h-3 text-emerald-500 animate-pulse" />
                  Auto-checking every 8s
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button & Live Feedback */}
        <div className="w-full flex flex-col items-center gap-3">
          <button
            onClick={() => checkHealthStatus(true)}
            disabled={status === 'checking' || status === 'healthy'}
            className={`
              group w-full sm:w-auto px-8 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 
              flex items-center justify-center gap-2.5 shadow-lg active:scale-[0.98] min-w-[220px]
              ${
                status === 'healthy'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/25 cursor-default'
                  : status === 'checking'
                  ? 'bg-[#0f172a]/90 text-white shadow-slate-900/10 cursor-wait opacity-90'
                  : 'bg-[#0f172a] hover:bg-black text-white shadow-slate-900/15 hover:shadow-slate-900/25'
              }
            `}
          >
            {status === 'checking' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                <span>Checking Status...</span>
              </>
            ) : status === 'healthy' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                <span>Online! Redirecting...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 text-slate-400 group-hover:rotate-180 transition-transform duration-500" />
                <span>Check Status</span>
              </>
            )}
          </button>

          {/* Feedback details */}
          {statusDetail && status !== 'healthy' && (
            <p className="text-xs text-slate-500 flex items-center gap-1.5 animate-in fade-in duration-300">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span>{statusDetail}</span>
            </p>
          )}

          {status === 'healthy' && (
            <p className="text-xs text-emerald-600 font-medium flex items-center gap-1.5 animate-in fade-in duration-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
              <span>System is fully operational. Taking you to the portal...</span>
            </p>
          )}
        </div>
      </main>

      {/* Structured Footer (Cleanly separated in document flow, never overlapping) */}
      <footer className="w-full max-w-4xl pt-6 pb-2 border-t border-slate-200/60 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 font-medium gap-2 z-10">
        <div>
          © 2026 PugArch Technologies. All Rights Reserved.
        </div>
        <div className="flex items-center gap-3 text-slate-400 text-[11px]">
          <span>Secure Enterprise Grievance Platform</span>
        </div>
      </footer>
    </div>
  );
}