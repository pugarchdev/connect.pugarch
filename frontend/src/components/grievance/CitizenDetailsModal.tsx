"use client";

import { useState, useEffect, useCallback } from "react";
import { grievanceAPI, Grievance } from "@/lib/api/grievance";
import { appointmentAPI, Appointment } from "@/lib/api/appointment";
import {
  X,
  MapPin,
  Phone,
  Calendar,
  Image as ImageIcon,
  FileText,
  User,
  MessageCircle,
  Tag,
  Clock,
  FileType,
  Loader2,
} from "lucide-react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { formatDate, formatDateTime, formatISTTime } from "@/lib/utils";
import dynamic from "next/dynamic";

const GrievanceMapDialog = dynamic(() => import("./GrievanceMapDialog"), {
  ssr: false,
  loading: () => <div className="h-[400px] w-full bg-slate-900 animate-pulse flex items-center justify-center text-slate-500 font-bold uppercase tracking-widest text-xs">Loading Map...</div>
});

const isImageMedia = (media: { type?: string; url?: string }) =>
  media.type === "image" ||
  /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(media.url || "") ||
  (media.url && media.url.includes("image"));

const getDocumentLabel = (url: string) => {
  if (!url) return "Document";
  const lower = url.toLowerCase();
  if (lower.includes(".pdf") || lower.includes("pdf")) return "PDF";
  if (lower.includes(".doc") || lower.includes("word")) return "Word";
  return "Document";
};

interface CitizenDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  grievance?: Grievance | null;
  appointment?: Appointment | null;
}

export default function CitizenDetailsModal({
  isOpen,
  onClose,
  grievance: initialGrievance,
  appointment: initialAppointment,
}: CitizenDetailsModalProps) {
  const [activeGrievance, setActiveGrievance] = useState<Grievance | null>(initialGrievance || null);
  const [activeAppointment, setActiveAppointment] = useState<Appointment | null>(initialAppointment || null);
  const [loading, setLoading] = useState(false);
  const [fullScreenMedia, setFullScreenMedia] = useState<{
    url: string;
    alt?: string;
  } | null>(null);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const fetchDetails = useCallback(async () => {
    if (initialGrievance?._id) {
      try {
        setLoading(true);
        const res = await grievanceAPI.getById(initialGrievance._id);
        if (res.success) {
          setActiveGrievance(res.data.grievance);
        }
      } catch (error) {
        console.error("Failed to fetch grievance details:", error);
      } finally {
        setLoading(false);
      }
    } else if (initialAppointment?._id) {
      try {
        setLoading(true);
        const res = await appointmentAPI.getById(initialAppointment._id);
        if (res.success) {
          setActiveAppointment(res.data.appointment);
        }
      } catch (error) {
        console.error("Failed to fetch appointment details:", error);
      } finally {
        setLoading(false);
      }
    }
  }, [initialGrievance?._id, initialAppointment?._id]);

  useEffect(() => {
    if (isOpen) {
      setActiveGrievance(initialGrievance || null);
      setActiveAppointment(initialAppointment || null);
      fetchDetails();
    }
  }, [isOpen, initialGrievance, initialAppointment, fetchDetails]);

  if (!isOpen || (!activeGrievance && !activeAppointment)) return null;

  const data = (activeGrievance || activeAppointment) as any;
  const type = activeGrievance ? "Grievance" : "Appointment";
  const createdDate = new Date(data?.createdAt || "");
  const timeAgo = formatDistanceToNow(createdDate, { addSuffix: true });
  const id = activeGrievance?.grievanceId || activeAppointment?.appointmentId;
  
  // Parse coordinates from GeoJSON or address string (fallback)
  const parsedLatLng = (() => {
    const loc = activeGrievance?.location;
    if (!loc) return null;
    
    // Check if coordinates exist and are not [0, 0]
    if (Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
      const lat = loc.coordinates[1];
      const lng = loc.coordinates[0];
      if (lat !== 0 || lng !== 0) {
        return { lat, lng };
      }
    }
    
    // Fallback to parsing from address string if coordinates are missing or [0, 0]
    if (typeof loc.address === "string") {
      const latMatch = loc.address.match(/Lat:\s*([0-9.-]+)/i);
      const lngMatch = loc.address.match(/Long:\s*([0-9.-]+)/i);
      if (latMatch && lngMatch) {
        const lat = parseFloat(latMatch[1]);
        const lng = parseFloat(lngMatch[1]);
        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
      }
    }
    return null;
  })();

  // Get status config for header gradient
  const getStatusConfig = () => {
    const status = data?.status || "PENDING";
    switch (status) {
      case "RESOLVED":
      case "COMPLETED":
        return {
          gradient: "from-emerald-500 to-green-600",
          icon: <FileText className="w-6 h-6 text-white" />,
        };
      case "CONFIRMED":
      case "IN_PROGRESS":
        return {
          gradient: "from-blue-500 to-indigo-600",
          icon: <FileText className="w-6 h-6 text-white" />,
        };
      case "SCHEDULED":
        return {
          gradient: "from-indigo-500 to-purple-600",
          icon: <FileText className="w-6 h-6 text-white" />,
        };
      case "CANCELLED":
        return {
          gradient: "from-red-500 to-rose-600",
          icon: <FileText className="w-6 h-6 text-white" />,
        };
      default:
        return {
          gradient: "from-amber-500 to-orange-600",
          icon: <FileText className="w-6 h-6 text-white" />,
        };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl bg-white animate-in fade-in zoom-in duration-200 flex flex-col">
        {/* Gradient Header */}
        <div
          className={`bg-gradient-to-r ${statusConfig.gradient} p-5 relative overflow-hidden flex-shrink-0`}
        >
          {/* Background pattern */}
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iYSIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVHJhbnNmb3JtPSJyb3RhdGUoNDUpIj48cGF0aCBkPSJNLTEwIDMwaDYwdjJoLTYweiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNhKSIvPjwvc3ZnPg==')] opacity-50"></div>

          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm flex-shrink-0">
                  {statusConfig.icon}
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-white">
                    Citizen Details
                  </h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="px-2 py-0.5 bg-white/20 rounded-full text-[15px] font-bold text-white backdrop-blur-sm">
                      {type} ID: {id}
                    </span>
                    <span className="text-white/80 text-xs">•</span>
                    <span className="text-white/80 text-xs">{timeAgo}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all backdrop-blur-sm flex-shrink-0"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
              <p className="text-slate-500 font-medium animate-pulse">
                Fetching latest details...
              </p>
            </div>
          ) : (
            <>
              {/* Quick Info Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-xs font-bold text-blue-600 uppercase">
                  Citizen
                </span>
              </div>
              <p
                className="text-base font-bold text-gray-900 break-words whitespace-normal"
                title={data?.citizenName}
              >
                {data?.citizenName}
              </p>
            </div>

            {activeGrievance && (
              <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-xl p-4 border border-purple-100 group relative">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Tag className="w-4 h-4 text-purple-600" />
                  </div>
                  <span className="text-xs font-bold text-purple-600 uppercase">
                    Category
                  </span>
                </div>
                <p
                  className="text-base font-bold text-gray-900 break-words whitespace-normal"
                  title={activeGrievance.category || "General"}
                >
                  {activeGrievance.category || "General"}
                </p>
              </div>
            )}

            {activeAppointment && (
              <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-xl p-4 border border-purple-100 group relative">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-4 h-4 text-purple-600" />
                  </div>
                  <span className="text-xs font-bold text-purple-600 uppercase">
                    Date
                  </span>
                </div>
                <p className="text-base font-bold text-gray-900">
                  {formatDate(activeAppointment.appointmentDate)}
                </p>
              </div>
            )}

            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-emerald-600" />
                </div>
                <span className="text-xs font-bold text-emerald-600 uppercase">
                  Created
                </span>
              </div>
              <p className="text-base font-bold text-gray-900">
                {formatDate(createdDate)}
              </p>
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-amber-600" />
                </div>
                <span className="text-xs font-bold text-amber-600 uppercase">
                  Time
                </span>
              </div>
              <p className="text-base font-bold text-gray-900">
                {formatISTTime(createdDate)}
              </p>
            </div>
          </div>

          {/* Citizen Information */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="bg-gradient-to-r from-slate-50 to-blue-50 px-6 py-5 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <User className="w-6 h-6 text-blue-600" />
                Citizen Information
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <User className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                      Full Name
                    </p>
                    <p className="text-base font-bold text-slate-800 break-words whitespace-normal">
                      {data?.citizenName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Phone className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                      Phone Number
                    </p>
                    <p className="text-base font-bold text-slate-800">
                      {data?.citizenPhone}
                    </p>
                  </div>
                </div>

                {data?.citizenWhatsApp && (
                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                    <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <MessageCircle className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                        WhatsApp
                      </p>
                      <p className="text-base font-bold text-slate-800">
                        {data?.citizenWhatsApp}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Grievance/Appointment Details */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="bg-gradient-to-r from-slate-50 to-purple-50 px-6 py-5 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <FileText className="w-6 h-6 text-purple-600" />
                {type} Details
              </h3>
            </div>
            <div className="p-6 space-y-5">
              {activeGrievance && (
                <>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                      Category
                    </p>
                    <span className="inline-block px-4 py-2 rounded-lg text-base font-medium bg-blue-100 text-blue-800 border border-blue-200">
                      {activeGrievance.category || "General"}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                      Description
                    </p>
                    <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl p-5 border border-slate-100">
                      <p className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {activeGrievance.description || "No description provided"}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {activeAppointment && (
                <>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                      Purpose
                    </p>
                    <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl p-5 border border-slate-100">
                      <p className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {activeAppointment.purpose || "No purpose provided"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-5">
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                        Date
                      </p>
                      <p className="text-base font-bold text-slate-800 flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-blue-600" />
                        {formatDate(activeAppointment.appointmentDate)}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                        Time
                      </p>
                      <p className="text-base font-bold text-slate-800">
                        {activeAppointment.appointmentTime}
                      </p>
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-5 pt-2">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                    Created At
                  </p>
                  <p className="text-base font-semibold text-slate-800">
                    {formatDateTime(createdDate)}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                    Last Updated
                  </p>
                  <p className="text-base font-semibold text-slate-800">
                    {formatDateTime(data?.updatedAt || data?.createdAt || "")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Location Information */}
          {activeGrievance?.location && (activeGrievance.location.address || activeGrievance.location.coordinates) && (
            <div className="bg-gradient-to-br from-[#00AEEF] to-[#0096ce] border border-white/20 rounded-2xl p-6 shadow-xl relative overflow-hidden group">
              {/* Background Decoration */}
              <div className="absolute -right-4 -top-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                <MapPin className="w-24 h-24 text-white" />
              </div>

              <div className="flex items-start gap-4 relative z-10">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center border border-white/30 flex-shrink-0 backdrop-blur-sm">
                  <MapPin className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-black text-white/80 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                    Geospatial context
                  </p>
                  <p className="text-sm font-bold text-white mb-4 tracking-tight leading-relaxed">
                    {activeGrievance.location.address || "Coordinate-only location provided by device"}
                  </p>
                  
                  {parsedLatLng && (
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-black/20 rounded-lg border border-white/10 backdrop-blur-sm">
                        <span className="text-[14px] font-bold text-white/90">
                          Lat: {parsedLatLng.lat.toFixed(7)}
                        </span>
                        <span className="w-px h-3 bg-white/20"></span>
                        <span className="text-[14px] font-bold text-white/90">
                          Long: {parsedLatLng.lng.toFixed(7)}
                        </span>
                      </div>
                      
                      <button
                        onClick={() => setIsMapOpen(true)}
                        className="px-4 py-2 bg-white text-[#00AEEF] text-[14px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all shadow-lg active:scale-95 flex items-center gap-2"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        View Map
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Map Dialog */}
              {parsedLatLng && (
                <GrievanceMapDialog
                  isOpen={isMapOpen}
                  onClose={() => setIsMapOpen(false)}
                  lat={parsedLatLng.lat}
                  lng={parsedLatLng.lng}
                  address={activeGrievance.location.address}
                  grievanceId={activeGrievance.grievanceId}
                />
              )}
            </div>
          )}

          {/* Media/Photos */}
          {activeGrievance?.media && activeGrievance.media.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-slate-50 to-pink-50 px-5 py-4 border-b border-slate-100">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-pink-600" />
                  Uploaded Media
                  <span className="ml-2 px-2 py-0.5 bg-pink-100 text-pink-600 rounded-full text-xs font-bold">
                    {activeGrievance.media.length}
                  </span>
                </h3>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {activeGrievance.media.map((media: any, index: number) => {
                    const isImage = isImageMedia(media);
                    return (
                      <div
                        key={index}
                        className="relative group rounded-xl overflow-hidden border border-slate-200 aspect-video"
                      >
                        {isImage ? (
                          <button
                            type="button"
                            onClick={() =>
                              setFullScreenMedia({
                                url: media.url,
                                alt: `Evidence ${index + 1}`,
                              })
                            }
                            className="absolute inset-0 w-full h-full text-left focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-inset rounded-xl"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={media.url}
                              alt={`Evidence ${index + 1}`}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 cursor-pointer"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                              <span className="opacity-0 group-hover:opacity-100 text-white text-sm font-medium bg-black/50 px-3 py-1.5 rounded-lg transition-opacity">
                                Click to view full screen
                              </span>
                            </div>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              media.url &&
                              window.open(
                                media.url,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                            className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center hover:from-slate-200 hover:to-slate-300 transition-colors cursor-pointer border-0"
                          >
                            <FileType className="w-10 h-10 text-slate-500 mb-2" />
                            <span className="text-sm font-medium text-slate-600">
                              {getDocumentLabel(media.url || "")}
                            </span>
                            <span className="text-xs text-slate-400 mt-0.5">
                              Click to open
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Full-screen image overlay */}
          {fullScreenMedia && (
            <div
              className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
              onClick={() => setFullScreenMedia(null)}
              role="dialog"
              aria-modal="true"
              aria-label="Media full screen view"
            >
              <button
                type="button"
                onClick={() => setFullScreenMedia(null)}
                className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                aria-label="Close full screen"
              >
                <X className="w-6 h-6" />
              </button>
              <div
                className="relative w-full h-full min-h-[50vh]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fullScreenMedia.url}
                  alt={fullScreenMedia.alt || "Full size"}
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          )}

          {/* Status History */}
          {activeGrievance?.statusHistory && activeGrievance.statusHistory.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-slate-50 to-indigo-50 px-5 py-4 border-b border-slate-100">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-600" />
                  Status History
                </h3>
              </div>
              <div className="p-5">
                <div className="space-y-3">
                  {activeGrievance.statusHistory.map(
                    (history: any, index: number) => (
                      <div
                        key={index}
                        className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200"
                      >
                        <div
                          className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                            history.status === "RESOLVED"
                              ? "bg-green-500"
                              : history.status === "IN_PROGRESS"
                                ? "bg-blue-500"
                                : "bg-yellow-500"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800">
                            {history.status}
                          </p>
                          <p className="text-xs text-slate-600 mt-1">
                            {history.remarks || "Status updated"}
                          </p>
                          <p className="text-[14px] text-slate-400 mt-1">
                            {formatDateTime(history.changedAt)}
                          </p>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Department & Assignment */}
          {(data?.departmentId || data?.assignedTo) && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-slate-50 to-slate-50 px-5 py-4 border-b border-slate-100">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Tag className="w-5 h-5 text-slate-600" />
                  Assignment Information
                </h3>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data?.departmentId && (
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                      <p className="text-[14px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                        Department
                      </p>
                      <p className="text-base font-bold text-slate-800">
                        {data?.departmentId?.name || data?.category || "General"}
                      </p>
                    </div>
                  )}

                  {data?.assignedTo && (
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                      <p className="text-[14px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                        Assigned To
                      </p>
                      <p className="text-base font-bold text-slate-800">
                        {typeof data.assignedTo === "object" && data.assignedTo
                          ? `${(data.assignedTo as any).firstName || ""} ${(data.assignedTo as any).lastName || ""}`.trim() || "Inactive User"
                          : String(data.assignedTo)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
            </>
          )}
        </div>

        {/* Action Footer */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-white transition-all active:scale-95"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
}
