"use client";

import React, { memo } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Power, User as UserIcon, Bell, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DashboardHeaderProps = {
  user: any;
  companyName?: string | null;
  companyIdParam?: string | null;
  isSuperAdminUser: boolean;
  isCompanyLevel: boolean;
  isDepartmentLevel: boolean;
  isJharsugudaCompany: boolean;
  canReadGrievance: boolean;
  dashboardBrandTitle: string;
  dashboardBrandSubtitle: string;
  onOpenMobileMenu: () => void;
  onProfileClick: () => void;
  notifications?: any[];
  unreadCount?: number;
  onMarkAsRead?: (id: string) => void;
  onMarkAllAsRead?: () => void;
  onNotificationClick?: (notification: any) => void;
  onLogout: () => void;
  onRefresh?: () => void;
  onBackToDashboard?: () => void;
  isRefreshing?: boolean;
  logoUrl?: string | null;
};

import { NotificationPopover } from "./NotificationPopover";


export const DashboardHeader = memo(function DashboardHeader({
  user,
  companyName,
  companyIdParam,
  isSuperAdminUser,
  isCompanyLevel,
  isDepartmentLevel,
  isJharsugudaCompany,
  canReadGrievance,
  dashboardBrandTitle,
  dashboardBrandSubtitle,
  onOpenMobileMenu,
  onProfileClick,
  notifications = [],
  unreadCount = 0,
  onMarkAsRead = () => {},
  onMarkAllAsRead = () => {},
  onNotificationClick = () => {},
  onLogout,
  onRefresh,
  onBackToDashboard,
  isRefreshing = false,
  logoUrl,
}: DashboardHeaderProps) {
  return (
    <header className="bg-slate-900 backdrop-blur-md border-b border-slate-800 sticky top-0 z-50 transition-all duration-300 shadow-xl overflow-hidden">
      {/* Background Accent Gradients */}
      <div className="absolute top-0 right-0 w-1/3 h-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-1/4 h-full bg-blue-500/10 blur-[100px] pointer-events-none" />
      
      {/* Content wrapper */}
      <div className="max-w-[1920px] mx-auto px-4 lg:px-6 relative z-10">
        <div className="flex items-center justify-between min-h-[3.25rem] py-1 sm:min-h-[4.5rem] lg:h-20 sm:py-2">
          <div className="flex items-center gap-3 sm:gap-8 min-w-0 flex-1">
            <div className="flex items-center gap-2 sm:gap-6 group">
              <button
                type="button"
                onClick={onOpenMobileMenu}
                className="w-12 h-10 bg-white/50 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-lg border border-white/10 active:scale-95 transition-transform duration-300 md:hidden overflow-hidden"
                title="Open sidebar"
                aria-label="Open sidebar navigation"
              >
                <Image
                  src={logoUrl || "/assets/sahaj.png"}
                  alt={companyName || "Company Logo"}
                  width={50}
                  height={50}
                  className="object-contain"
                  unoptimized
                />
              </button>
              <div className="hidden md:flex w-10 h-10 bg-white/5 backdrop-blur-sm rounded-xl items-center justify-center shadow-lg border border-white/10 group-hover:scale-105 transition-transform duration-300 overflow-hidden">
                <Image
                  src={logoUrl || "/assets/sahaj.png"}
                  alt={companyName || "Company Logo"}
                  width={50}
                  height={50}
                  className="object-contain"
                  unoptimized
                />
              </div>
              <div className="flex flex-col justify-center min-w-0">
                <h1 className="text-sm sm:text-lg lg:text-xl pt-1.5 sm:pt-0 font-black text-white tracking-tighter leading-none uppercase max-w-[45vw] sm:max-w-none whitespace-normal break-words drop-shadow-sm">
                  {isSuperAdminUser && companyIdParam ? (
                    <span className="text-white/60 text-[10px] sm:text-sm block mb-0.5">Viewing:</span>
                  ) : null}
                  {isSuperAdminUser && companyIdParam ? (
                    companyName || "..."
                  ) : (
                    <>
                      {isCompanyLevel &&
                        (isJharsugudaCompany
                          ? dashboardBrandTitle
                          : companyName || "...")}
                      {isDepartmentLevel &&
                        (isJharsugudaCompany
                          ? dashboardBrandTitle
                          : "Department")}
                      {!canReadGrievance &&
                        !isSuperAdminUser &&
                        "Operations Center"}
                      {canReadGrievance &&
                        !isCompanyLevel &&
                        !isSuperAdminUser &&
                        ""}
                    </>
                  )}
                </h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[9px] sm:text-[11px] lg:text-[14px] text-white/80 font-bold uppercase tracking-[0.1em] sm:tracking-[0.14em] max-w-[40vw] sm:max-w-none whitespace-normal break-words">
                    {isJharsugudaCompany
                      ? dashboardBrandSubtitle
                      : "Control Panel"}
                  </p>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                </div>
              </div>
            </div>

            <div className="h-7 w-px bg-slate-800 hidden lg:block" />
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">


            <div className="hidden sm:flex flex-col items-end mr-2 sm:mr-3 lg:mr-0">
              <span className="hidden sm:block text-[14px] font-black text-white leading-none uppercase tracking-tight">
                {user.firstName} {user.lastName}
              </span>
              {isJharsugudaCompany ? (
                <span className="text-[14px] sm:text-[15px] font-black text-white uppercase tracking-wide mt-0.5 max-w-[220px] break-words text-right">
                  {(user.role || "CUSTOM").replace(/_/g, " ")}
                </span>
              ) : (
                <span className="text-[15px] font-black text-white/90 uppercase mt-0.5 bg-white/10 px-1.5 py-0.5 rounded border border-white/20 shadow-sm">
                  {(user.role || "CUSTOM").replace("_", " ")}
                  {user?.companyId?.name && ` (${user.companyId.name})`}
                </span>
              )}
            </div>

            <div className="w-px h-5 bg-slate-800 hidden lg:block mr-1" />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            {isSuperAdminUser && companyIdParam && (
              <button
                onClick={() => {
                  sessionStorage.removeItem("drilldownCompanyId");
                  if (onBackToDashboard) onBackToDashboard();
                }}
                className="h-7 px-2 sm:h-9 sm:px-4 text-white bg-white/10 backdrop-blur-sm hover:bg-white/20 rounded-lg sm:rounded-xl transition-all duration-300 border border-white/20 text-[10px] sm:text-[14px] font-black uppercase tracking-widest flex items-center shrink-0 shadow-lg active:scale-95"
              >
                <ArrowLeft className="w-3 h-3 sm:mr-1.5" />
                <span className="ml-1 sm:ml-0">Back</span>
              </button>
            )}

            <div className="flex items-center gap-1.5 sm:gap-3">
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="flex h-8 w-8 sm:h-9 sm:w-9 bg-white/10 backdrop-blur-sm rounded-lg sm:rounded-xl items-center justify-center border border-white/20 shadow-lg group hover:bg-white/20 transition-all duration-300 active:scale-95 disabled:opacity-50"
                  title="Refresh Data"
                  disabled={isRefreshing}
                >
                  <RefreshCw className={cn("w-3.5 h-3.5 sm:w-4.5 sm:h-4.5 text-white group-hover:scale-110 transition-all duration-300", isRefreshing && "animate-spin")} />
                </button>
              )}

              <NotificationPopover
                notifications={notifications}
                unreadCount={unreadCount}
                onMarkAsRead={onMarkAsRead}
                onMarkAllAsRead={onMarkAllAsRead}
                onNotificationClick={onNotificationClick}
              />
              <button
                onClick={onLogout}
                className="flex h-9 w-9 bg-rose-500/10 backdrop-blur-sm rounded-xl items-center justify-center border border-rose-500/20 shadow-lg group hover:bg-rose-500/20 transition-all duration-300 active:scale-95"
                title="Logout"
                aria-label="Logout account"
              >
                <Power className="w-4.5 h-4.5 text-rose-500 group-hover:scale-110 transition-transform duration-300" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
});
