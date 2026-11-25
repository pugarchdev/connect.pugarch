"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Smartphone,
  ShieldCheck,
  Key,
  Settings,
  MessageSquare,
  AlertCircle,
  Eye,
  EyeOff,
  Copy,
  Check,
} from "lucide-react";
import { useWhatsappConfig } from "@/lib/query/useWhatsappConfig";
import { useCachedQuery } from "@/lib/query/cache";
import { templateAPI } from "@/lib/api/template";
import { whatsappAPI } from "@/lib/api/whatsapp";
import toast from "react-hot-toast";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import TemplateFilters from "@/components/templates/TemplateFilters";
import TemplateTable from "@/components/templates/TemplateTable";
import TemplateDrawer from "@/components/templates/TemplateDrawer";
import { WhatsAppTemplate } from "@/types/whatsappTemplate";

interface WhatsAppConfigTabProps {
  companyId: string;
}

const WhatsAppConfigTab: React.FC<WhatsAppConfigTabProps> = ({ companyId }) => {
  const { data: config, isLoading: loadingConfig } = useWhatsappConfig(companyId);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [language, setLanguage] = useState("");
  const [category, setCategory] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);
  const [configForm, setConfigForm] = useState({
    phoneNumber: "",
    displayPhoneNumber: "",
    phoneNumberId: "",
    businessAccountId: "",
    accessToken: "",
    verifyToken: "",
    webhookSecret: "",
  });
  const [creatingNew, setCreatingNew] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showToken, setShowToken] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = useCallback(async (value: string, fieldKey: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldKey);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // fallback for older browsers
      const el = document.createElement("textarea");
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopiedField(fieldKey);
      setTimeout(() => setCopiedField(null), 2000);
    }
  }, []);

  useEffect(() => {
    if (!config) return;
    setConfigForm({
      phoneNumber: config.phoneNumber || "",
      displayPhoneNumber: config.displayPhoneNumber || "",
      phoneNumberId: config.phoneNumberId || "",
      businessAccountId: config.businessAccountId || config.wabaId || "",
      accessToken: config.accessToken || "",
      verifyToken: config.verifyToken || "",
      webhookSecret: config.webhookSecret || "",
    });
  }, [config]);

  const {
    data: templatesResponse,
    isLoading: loadingTemplates,
    error: templatesError,
  } = useCachedQuery({
    queryKey: [
      "whatsapp-templates",
      companyId,
      search,
      status,
      language,
      category,
      refreshTick,
    ],
    queryFn: () =>
      templateAPI.getTemplates({
        companyId,
        search: search || undefined,
        status: status || undefined,
        language: language || undefined,
        category: category || undefined,
      }),
    staleTime: 60 * 1000,
    enabled: Boolean(companyId),
  });

  const templates = useMemo(() => templatesResponse?.data ?? [], [templatesResponse?.data]);
  const languages = useMemo(
    () => Array.from(new Set(templates.map((template) => template.language))),
    [templates],
  );
  const categories = useMemo(() => {
    const fromTemplates = templates.map((template) => template.category);
    // Ensure standard Meta categories are always available for filtering
    return Array.from(new Set([...fromTemplates, "UTILITY", "MARKETING", "AUTHENTICATION"]));
  }, [templates]);

  const triggerRefresh = () => setRefreshTick((prev) => prev + 1);

  const handleSync = async () => {
    try {
      setSyncing(true);
      await templateAPI.syncTemplates(companyId);
      triggerRefresh();
      toast.success("Templates synced from Meta successfully");
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to sync templates");
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveMapping = async (
    templateName: string,
    mappings: Record<string, string>,
  ) => {
    try {
      setSavingMapping(true);
      await templateAPI.saveMapping({ companyId, templateName, mappings });
      triggerRefresh();
      setSelectedTemplate((prev) =>
        prev ? { ...prev, mapping: mappings } : prev,
      );
      toast.success("Template mapping saved");
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to save template mapping");
    } finally {
      setSavingMapping(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!config?._id && !creatingNew) {
      toast.error("Configuration ID missing");
      return;
    }

    try {
      setSavingConfig(true);
      const payload = {
        companyId, // Ensure companyId is included for new configs
        phoneNumber: configForm.phoneNumber.trim(),
        displayPhoneNumber: configForm.displayPhoneNumber.trim(),
        phoneNumberId: configForm.phoneNumberId.trim(),
        businessAccountId: configForm.businessAccountId.trim(),
        wabaId: configForm.businessAccountId.trim(),
        accessToken: configForm.accessToken.trim(),
        verifyToken: configForm.verifyToken.trim(),
        webhookSecret: configForm.webhookSecret.trim(),
      };

      let response;
      if (creatingNew) {
        response = await whatsappAPI.saveConfig(payload);
        setCreatingNew(false);
      } else {
        response = await whatsappAPI.updateConfig(config!._id, payload);
      }
      
      setEditingConfig(false);
      toast.success(response?.message || `WhatsApp configuration ${creatingNew ? "created" : "updated"}`);
      
      // Invalidate the config query to refetch the new data
      import("@/lib/query/cache").then(({ queryCache }) => {
        const cacheKey = JSON.stringify(["whatsapp-config", companyId]);
        queryCache.delete(cacheKey);
      });
    } catch (error: any) {
      toast.error(error?.response?.data?.message || `Failed to ${creatingNew ? "create" : "update"} WhatsApp configuration`);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSendTemplate = async (payload: {
    to: string;
    templateName: string;
    parameters: string[];
    language: string;
  }) => {
    try {
      setSendingTemplate(true);
      await templateAPI.sendTemplate({
        companyId,
        to: payload.to,
        templateName: payload.templateName,
        parameters: payload.parameters,
        language: payload.language,
      });
      toast.success("Template message sent");
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to send template");
    } finally {
      setSendingTemplate(false);
    }
  };

  if (loadingConfig) {
    return (
      <div className="py-20 flex justify-center">
        <LoadingSpinner text="Loading WhatsApp configuration..." />
      </div>
    );
  }

  if (!config && !creatingNew) {
    return (
      <div className="py-20 text-center">
        <div className="flex flex-col items-center gap-4 max-w-md mx-auto">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
            <Smartphone className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">No Configuration Found</h3>
          <p className="text-sm text-slate-500">
            This company does not have an active WhatsApp configuration.
          </p>
          <Button 
            className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 rounded-xl shadow-lg shadow-indigo-200"
            onClick={() => {
              setCreatingNew(true);
              setEditingConfig(true);
            }}
          >
            Configure WhatsApp Now
          </Button>
        </div>
      </div>
    );
  }

  const isActuallyEditing = editingConfig || creatingNew;

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-slate-50 border-b border-slate-100 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
                <Key className="w-4 h-4 text-white" />
              </div>
              <div>
                <CardTitle className="text-sm font-black uppercase tracking-wider text-slate-900">
                  Meta API Credentials
                </CardTitle>
                <CardDescription className="text-[14px] font-bold text-slate-400 uppercase tracking-tight">
                  Manage WhatsApp Business Account access tokens
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              {editingConfig ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingConfig}
                    onClick={() => {
                      setEditingConfig(false);
                      setCreatingNew(false);
                      if (config) {
                        setConfigForm({
                          phoneNumber: config.phoneNumber || "",
                          displayPhoneNumber: config.displayPhoneNumber || "",
                          phoneNumberId: config.phoneNumberId || "",
                          businessAccountId: config.businessAccountId || config.wabaId || "",
                          accessToken: config.accessToken || "",
                          verifyToken: config.verifyToken || "",
                          webhookSecret: config.webhookSecret || "",
                        });
                      }
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" disabled={savingConfig} onClick={handleSaveConfig}>
                    {savingConfig ? "Saving..." : "Save"}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditingConfig(true)}>
                  Edit Configuration
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {/* Phone Number */}
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone Number</label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={isActuallyEditing ? configForm.phoneNumber : (config?.phoneNumber ?? "")}
                  onChange={(e) => setConfigForm({...configForm, phoneNumber: e.target.value})}
                  readOnly={!isActuallyEditing}
                  className={`w-full p-3 pr-10 border rounded-xl text-xs ${
                    isActuallyEditing
                      ? "bg-white border-indigo-200 text-slate-700 focus:ring-2 focus:ring-indigo-100"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                  placeholder="e.g. 9821550841"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(isActuallyEditing ? configForm.phoneNumber : (config?.phoneNumber ?? ""), "phoneNumber")}
                  className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title="Copy Phone Number"
                >
                  {copiedField === "phoneNumber" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Display Phone Number */}
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-400 uppercase tracking-widest ml-1">Display Phone Number</label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={isActuallyEditing ? configForm.displayPhoneNumber : (config?.displayPhoneNumber ?? "")}
                  onChange={(e) => setConfigForm({...configForm, displayPhoneNumber: e.target.value})}
                  readOnly={!isActuallyEditing}
                  className={`w-full p-3 pr-10 border rounded-xl text-xs ${
                    isActuallyEditing
                      ? "bg-white border-indigo-200 text-slate-700 focus:ring-2 focus:ring-indigo-100"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                  placeholder="e.g. +91 98215 50841"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(isActuallyEditing ? configForm.displayPhoneNumber : (config?.displayPhoneNumber ?? ""), "displayPhoneNumber")}
                  className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title="Copy Display Phone Number"
                >
                  {copiedField === "displayPhoneNumber" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Phone Number ID */}
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone Number ID</label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={isActuallyEditing ? configForm.phoneNumberId : (config?.phoneNumberId ?? "")}
                  onChange={(e) => setConfigForm({...configForm, phoneNumberId: e.target.value})}
                  readOnly={!isActuallyEditing}
                  className={`w-full p-3 pr-10 border rounded-xl text-xs ${
                    isActuallyEditing
                      ? "bg-white border-indigo-200 text-slate-700 focus:ring-2 focus:ring-indigo-100"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                  placeholder="Enter Meta Phone Number ID"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(isActuallyEditing ? configForm.phoneNumberId : (config?.phoneNumberId ?? ""), "phoneNumberId")}
                  className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title="Copy Phone Number ID"
                >
                  {copiedField === "phoneNumberId" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Business Account ID */}
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-400 uppercase tracking-widest ml-1">Business Account ID</label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={isActuallyEditing ? configForm.businessAccountId : (config?.businessAccountId ?? "")}
                  onChange={(e) => setConfigForm({...configForm, businessAccountId: e.target.value})}
                  readOnly={!isActuallyEditing}
                  className={`w-full p-3 pr-10 border rounded-xl text-xs ${
                    isActuallyEditing
                      ? "bg-white border-indigo-200 text-slate-700 focus:ring-2 focus:ring-indigo-100"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                  placeholder="Enter WABA ID"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(isActuallyEditing ? configForm.businessAccountId : (config?.businessAccountId ?? ""), "businessAccountId")}
                  className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title="Copy Business Account ID"
                >
                  {copiedField === "businessAccountId" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Permanent Access Token — full width, eye + copy */}
            <div className="space-y-2 sm:col-span-2">
              <label className="text-[15px] font-black text-slate-400 uppercase tracking-widest ml-1">Permanent Access Token</label>
              <div className="relative flex items-center">
                <input
                  type={showToken ? "text" : "password"}
                  value={isActuallyEditing ? configForm.accessToken : (config?.accessToken ?? "")}
                  onChange={(e) => setConfigForm({...configForm, accessToken: e.target.value})}
                  readOnly={!isActuallyEditing}
                  className={`w-full p-3 pr-20 border rounded-xl text-xs ${
                    isActuallyEditing
                      ? "bg-white border-indigo-200 text-slate-700 focus:ring-2 focus:ring-indigo-100"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                  placeholder="Enter Meta System User Token"
                />
                {/* Eye toggle */}
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-10 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title={showToken ? "Hide token" : "Show token"}
                >
                  {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {/* Copy button */}
                <button
                  type="button"
                  onClick={() => copyToClipboard(isActuallyEditing ? configForm.accessToken : (config?.accessToken ?? ""), "accessToken")}
                  className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title="Copy Access Token"
                >
                  {copiedField === "accessToken" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Webhook Verify Token */}
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-400 uppercase tracking-widest ml-1">Webhook Verify Token</label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={isActuallyEditing ? configForm.verifyToken : (config?.verifyToken ?? "")}
                  onChange={(e) => setConfigForm({...configForm, verifyToken: e.target.value})}
                  readOnly={!isActuallyEditing}
                  className={`w-full p-3 pr-10 border rounded-xl text-xs ${
                    isActuallyEditing
                      ? "bg-white border-indigo-200 text-slate-700 focus:ring-2 focus:ring-indigo-100"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                  placeholder="Your custom verify string"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(isActuallyEditing ? configForm.verifyToken : (config?.verifyToken ?? ""), "verifyToken")}
                  className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title="Copy Webhook Verify Token"
                >
                  {copiedField === "verifyToken" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Webhook Secret */}
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-400 uppercase tracking-widest ml-1">Webhook Secret</label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={isActuallyEditing ? configForm.webhookSecret : (config?.webhookSecret ?? "")}
                  onChange={(e) => setConfigForm({...configForm, webhookSecret: e.target.value})}
                  readOnly={!isActuallyEditing}
                  className={`w-full p-3 pr-10 border rounded-xl text-xs ${
                    isActuallyEditing
                      ? "bg-white border-indigo-200 text-slate-700 focus:ring-2 focus:ring-indigo-100"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                  placeholder="Your webhook secret"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(isActuallyEditing ? configForm.webhookSecret : (config?.webhookSecret ?? ""), "webhookSecret")}
                  className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title="Copy Webhook Secret"
                >
                  {copiedField === "webhookSecret" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!creatingNew && config && (
        <>
          <Card className="border-0 shadow-sm bg-white overflow-hidden">
            <CardHeader className="bg-slate-50 border-b border-slate-100 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-slate-900">
                    Template Management Dashboard
                  </CardTitle>
                  <CardDescription>
                    View and sync templates, map variables, validate readiness, and send previews.
                  </CardDescription>
                </div>
                <Button onClick={handleSync} disabled={syncing} className="w-full sm:w-auto">
                  <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing..." : "🔄 Sync Templates"}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-4 sm:p-5 space-y-4">
              <TemplateFilters
                search={search}
                status={status}
                language={language}
                category={category}
                languages={languages}
                categories={categories}
                onSearchChange={setSearch}
                onStatusChange={setStatus}
                onLanguageChange={setLanguage}
                onCategoryChange={setCategory}
              />

              {loadingTemplates ? (
                <div className="py-16 flex justify-center">
                  <LoadingSpinner text="Loading templates..." />
                </div>
              ) : templatesError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  Failed to load templates. Please retry sync or refresh.
                </div>
              ) : (
                <TemplateTable
                  templates={templates}
                  onView={(template) => {
                    setSelectedTemplate(template);
                    setIsDrawerOpen(true);
                  }}
                  onUse={(template) => {
                    setSelectedTemplate(template);
                    setIsDrawerOpen(true);
                  }}
                />
              )}
            </CardContent>
          </Card>

          <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-4">
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h5 className="text-[15px] font-black text-amber-900 uppercase tracking-wider mb-1">
                Production Security Protocol
              </h5>
              <p className="text-[15px] text-amber-700/80 font-medium leading-relaxed">
                Changing credentials affects all active WhatsApp sessions for this organization.
                Verify webhook URL and token in Meta before syncing or sending templates.
              </p>
            </div>
          </div>
        </>
      )}

      <TemplateDrawer
        open={isDrawerOpen}
        template={selectedTemplate}
        companyId={companyId}
        isSavingMapping={savingMapping}
        isSending={sendingTemplate}
        onClose={() => setIsDrawerOpen(false)}
        onSaveMapping={handleSaveMapping}
        onSend={handleSendTemplate}
      />
    </div>
  );
};

export default WhatsAppConfigTab;
