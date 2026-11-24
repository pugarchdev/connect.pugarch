"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, Workflow } from "lucide-react";
import FlowCanvas from "@/components/flow-builder/FlowCanvas";
import { FlowNode, FlowEdge, BackendFlow } from "@/types/flowTypes";
import { toast } from "react-hot-toast";
import { chatbotFlowApi } from "@/lib/api/chatbotFlow";
import {
  transformToBackendFormat,
  transformFromBackendFormat,
} from "@/lib/flowTransform";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

export default function CreateFlowPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  const getParamValue = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value ?? "";

  const companyId = getParamValue((params.companyId || params.id) as string | string[] | undefined);
  const editFlowId = searchParams.get("edit");
  const isEditing = !!editFlowId;

  const [flowName, setFlowName] = useState("Untitled Flow");
  const [flowDescription, setFlowDescription] = useState("");
  const [flowIsActive, setFlowIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEditing);
  const [initialNodes, setInitialNodes] = useState<FlowNode[]>([]);
  const [initialEdges, setInitialEdges] = useState<FlowEdge[]>([]);

  // Load existing flow if editing
  const loadFlowData = useCallback(async () => {
    if (!editFlowId) return;

    try {
      setLoading(true);
      const storageKey = `flow_edit_${editFlowId}`;
      let flowData: BackendFlow | null = null;

      // Try sessionStorage first (shared by edit page redirect)
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        flowData = JSON.parse(stored);
      } else {
        // Fallback to API if not in session storage
        const response = await chatbotFlowApi.getFlowById(editFlowId);
        if (response.success) {
          flowData = response.data;
        }
      }

      if (flowData) {
        setFlowName(flowData.flowName ?? flowData.name ?? "");
        setFlowDescription(flowData.flowDescription ?? flowData.description ?? "");
        if (flowData.isActive !== undefined) {
          setFlowIsActive(flowData.isActive);
        }

        const transformed = transformFromBackendFormat(flowData);
        setInitialNodes(transformed.nodes);
        setInitialEdges(transformed.edges);
      } else {
        toast.error("Flow data not found");
        const fromMaster = searchParams.get("fromMaster") === "true";
        const returnUrl = fromMaster 
          ? `/dashboard?companyId=${companyId}&tab=flows`
          : `/dashboard/company/${companyId}?tab=flows`;
        router.push(returnUrl);
      }
    } catch (error) {
      console.error("Failed to load flow data:", error);
      toast.error("Failed to load flow data");
    } finally {
      setLoading(false);
    }
  }, [editFlowId, companyId, router, searchParams]);

  useEffect(() => {
    if (!companyId) {
      toast.error("Invalid company context");
      router.push("/dashboard");
      return;
    }

    if (isEditing) {
      loadFlowData();
    }
  }, [companyId, isEditing, loadFlowData, router]);

  const handleSave = useCallback(
    async (nodes: FlowNode[], edges: FlowEdge[]) => {
      if (!flowName.trim()) {
        toast.error("Please enter a flow name");
        return;
      }

      setSaving(true);
      try {
        const flowPayload = transformToBackendFormat({
          metadata: {
            name: flowName,
            description: flowDescription,
            companyId,
            version: 1,
            isActive: isEditing ? (flowIsActive ?? true) : true,
            createdBy: user?.id || "",
            updatedBy: user?.id || "",
          },
          nodes,
          edges,
        });

        let response;
        if (isEditing) {
          response = await chatbotFlowApi.updateFlow(editFlowId!, flowPayload);
        } else {
          response = await chatbotFlowApi.createFlow(flowPayload);
        }

        if (response.success) {
          toast.success(
            isEditing
              ? "Flow updated successfully"
              : "Flow created successfully",
          );

          // Clear session storage if editing
          if (isEditing) {
            sessionStorage.removeItem(`flow_edit_${editFlowId}`);
          }

          // Redirect back to flows tab
          const fromMaster = searchParams.get("fromMaster") === "true";
          const returnUrl = fromMaster 
            ? `/dashboard?companyId=${companyId}&tab=flows`
            : `/dashboard/company/${companyId}?tab=flows`;
          router.push(returnUrl);
        }
      } catch (error: any) {
        console.error("Failed to save flow:", error);
        toast.error(error.response?.data?.message || "Failed to save flow");
      } finally {
        setSaving(false);
      }
    },
    [flowName, flowDescription, companyId, isEditing, editFlowId, user, router, searchParams],
  );

  const handleSaveClick = () => {
    // Trigger save event that FlowCanvas listens to
    window.dispatchEvent(new CustomEvent("flow:save"));
  };

  // Listen for flow data from canvas
  useEffect(() => {
    const handleFlowData = (event: any) => {
      const { nodes, edges } = event.detail;
      handleSave(nodes, edges);
    };

    window.addEventListener("flow:data", handleFlowData);
    return () => window.removeEventListener("flow:data", handleFlowData);
  }, [flowName, companyId, isEditing, editFlowId, user, handleSave]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <LoadingSpinner text="Loading flow builder..." />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-slate-800">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 shadow-xl z-50">
        <div className="max-w-full mx-auto px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <Button
                variant="ghost"
                onClick={() => {
                  const fromMaster = searchParams.get("fromMaster") === "true";
                  const returnUrl = fromMaster 
                    ? `/dashboard?companyId=${companyId}&tab=flows`
                    : `/dashboard/company/${companyId}?tab=flows`;
                  router.push(returnUrl);
                }}
                className="text-white/80 hover:text-white hover:bg-white/10 transition-all px-2 rounded-xl"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>

              <div className="flex flex-col min-w-0 border-l border-white/10 pl-4 ml-1">
                <input
                  type="text"
                  value={flowName}
                  onChange={(e) => setFlowName(e.target.value)}
                  className="text-base sm:text-lg font-black text-white bg-transparent border-none p-0 focus:outline-none placeholder-white/30 truncate uppercase tracking-tight"
                  placeholder="Neural Flow Identifier..."
                />
                <input
                  type="text"
                  value={flowDescription}
                  onChange={(e) => setFlowDescription(e.target.value)}
                  className="text-[14px] text-indigo-300/70 bg-transparent border-none p-0 focus:outline-none placeholder-white/20 truncate font-bold uppercase tracking-widest"
                  placeholder="Matrix Description Protocol..."
                />
              </div>
            </div>

            <div className="flex w-full md:w-auto items-center justify-end gap-2 sm:gap-3">
              <div className="hidden lg:flex flex-col items-end mr-3 border-r border-white/10 pr-4 text-[14px] font-black uppercase tracking-widest">
                <span className="text-white/60">Architect Access</span>
                <span className="text-indigo-400">
                  Node: {companyId ? companyId.substring(0, 8) : "Unknown"}
                </span>
              </div>
              <Button
                onClick={handleSaveClick}
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-700 text-white transition-all rounded-xl px-4 sm:px-6 h-10 font-black uppercase text-[15px] tracking-wider shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Deploying..." : "Publish Logic"}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Flow Builder Canvas */}
      <div className="flex-1 overflow-hidden">
        <FlowCanvas
          initialNodes={initialNodes}
          initialEdges={initialEdges}
          flowName={flowName}
          showToolbarSave={false}
          showToolbarName={false}
          onToolbarSave={(nodes, edges, name) => {
            if (name) setFlowName(name);
            handleSave(nodes, edges);
          }}
        />
      </div>
    </div>
  );
}
