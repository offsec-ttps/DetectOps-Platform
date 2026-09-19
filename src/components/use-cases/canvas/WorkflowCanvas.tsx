"use client";
/**
 * Workflow Canvas — drag-drop ATT&CK steps across ART / PurpleSharp / Stratus
 * plus free-form Logic blocks (If/else conditions and free-form Manual steps).
 *
 * Architecture:
 *   - Each catalogue node renders a Handle on its left (target) and right
 *     (source). Drag from a right-side handle to another node's left-side
 *     handle to draw an edge.
 *   - Condition nodes have ONE target on the left and TWO sources on the
 *     right (`true` on top, `false` on bottom). Their outgoing edges carry
 *     the branch in `sourceHandle` so the server compiler can preserve
 *     branching semantics.
 *   - Right-side properties panel is per-kind: ART (input args + executor),
 *     PurpleSharp (variation + url + command), Stratus (phases + region),
 *     Manual (executor + binary + command + options), Condition (predicate).
 *   - When an edge is selected (not a node), the panel switches to an
 *     "Edge" inspector that lets you edit the branch label.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow, Background, Controls, MiniMap, addEdge,
  applyNodeChanges, applyEdgeChanges,
  Position, MarkerType, Handle,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
  ReactFlowProvider, useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  FlaskConical, FileCode2, Cloud, Search, Save, Loader2, Trash2,
  Wand2, Download, AlertTriangle, CheckCircle2, Workflow as WorkflowIcon,
  GitBranch, FileQuestion, Terminal, Plus, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

type StepKind = "atomic" | "purplesharp" | "stratus" | "manual" | "condition";

const KIND_COLORS: Record<StepKind, { bg: string; border: string; text: string; accent: string }> = {
  atomic:      { bg: "rgba(59,130,246,0.10)",  border: "rgba(59,130,246,0.55)",  text: "#3b82f6", accent: "ART" },
  purplesharp: { bg: "rgba(168,85,247,0.10)",  border: "rgba(168,85,247,0.55)",  text: "#a855f7", accent: "PS" },
  stratus:     { bg: "rgba(6,182,212,0.10)",   border: "rgba(6,182,212,0.55)",   text: "#06b6d4", accent: "Stratus" },
  manual:      { bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.55)", text: "#94a3b8", accent: "Manual" },
  condition:   { bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.65)",  text: "#f59e0b", accent: "If/Else" },
};

interface PaletteItem {
  kind: StepKind;
  refId: string;
  techniqueId: string;
  displayName: string;
  meta?: Record<string, unknown>;
}

interface CommonNodeData {
  kind: StepKind;
  refId: string;
  techniqueId: string;
  displayName: string;
  notes?: string;
  expectedSignal?: string;
  /** Per-kind parameters object — same shape as StepParameters in src/lib/use-cases/types.ts */
  parameters?: Record<string, any>;
}

type NodeData = CommonNodeData & Record<string, unknown>;

let nodeSeq = 1;
function newNodeId(): string { return `n${Date.now().toString(36)}_${nodeSeq++}`; }

// ─── Node renderers ───────────────────────────────────────────────────────────

function StandardNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const c = KIND_COLORS[d.kind] || KIND_COLORS.manual;
  return (
    <div
      className="relative rounded-lg px-3 py-2 text-[12px] min-w-[220px] max-w-[280px] shadow-sm group"
      style={{
        background: c.bg,
        border: `1px solid ${selected ? c.text : c.border}`,
        boxShadow: selected ? `0 0 0 2px ${c.text}33` : undefined,
      }}
    >
      {/* Target on the left */}
      <Handle
        type="target" position={Position.Left}
        id="target"
        style={{ background: c.text, width: 10, height: 10, border: "2px solid #0a0e1a" }}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: c.text, color: "#0a0e1a" }}>
          {c.accent}
        </span>
        {d.techniqueId && (
          <span className="font-mono text-[10px]" style={{ color: c.text }}>{d.techniqueId}</span>
        )}
      </div>
      <div className="mt-1 font-medium text-foreground truncate" title={d.displayName}>{d.displayName}</div>
      {d.notes && <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{d.notes}</div>}
      {/* Source on the right */}
      <Handle
        type="source" position={Position.Right}
        id="source"
        style={{ background: c.text, width: 10, height: 10, border: "2px solid #0a0e1a" }}
      />
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const predicate = (d.parameters?.condition?.predicate as string | undefined) || d.displayName;
  return (
    <div
      className="relative rounded-lg px-3 py-2.5 text-[12px] min-w-[220px] max-w-[280px] shadow-sm"
      style={{
        background: KIND_COLORS.condition.bg,
        border: `1px solid ${selected ? KIND_COLORS.condition.text : KIND_COLORS.condition.border}`,
        boxShadow: selected ? `0 0 0 2px ${KIND_COLORS.condition.text}33` : undefined,
      }}
    >
      <Handle
        type="target" position={Position.Left} id="target"
        style={{ background: KIND_COLORS.condition.text, width: 10, height: 10, border: "2px solid #0a0e1a" }}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: KIND_COLORS.condition.text, color: "#0a0e1a" }}>
          If/Else
        </span>
      </div>
      <div className="mt-1 font-medium text-foreground text-[12px]" title={predicate}>
        {predicate || "Set a predicate in the panel"}
      </div>
      {d.notes && <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{d.notes}</div>}

      {/* Two source handles on the right with branch labels */}
      <div className="relative" style={{ height: 12 }} />
      <div
        className="absolute right-[-4px] flex items-center gap-1"
        style={{ top: "33%", transform: "translateY(-50%)" }}
      >
        <span className="text-[9px] font-mono text-success bg-success/15 px-1 py-0.5 rounded">true</span>
        <Handle
          type="source" position={Position.Right} id="true"
          style={{ background: "#22c55e", width: 10, height: 10, border: "2px solid #0a0e1a", position: "relative", transform: "none", top: 0 }}
        />
      </div>
      <div
        className="absolute right-[-4px] flex items-center gap-1"
        style={{ top: "75%", transform: "translateY(-50%)" }}
      >
        <span className="text-[9px] font-mono text-danger bg-danger/15 px-1 py-0.5 rounded">false</span>
        <Handle
          type="source" position={Position.Right} id="false"
          style={{ background: "#ef4444", width: 10, height: 10, border: "2px solid #0a0e1a", position: "relative", transform: "none", top: 0 }}
        />
      </div>
    </div>
  );
}

const nodeTypes = { catalogue: StandardNode, condition: ConditionNode };

// ─── Edge styling helpers ─────────────────────────────────────────────────────
function styleEdge(branch?: string): { stroke: string; strokeWidth: number; color: string } {
  if (branch === "true") return { stroke: "#22c55e", strokeWidth: 1.8, color: "#22c55e" };
  if (branch === "false") return { stroke: "#ef4444", strokeWidth: 1.8, color: "#ef4444" };
  return { stroke: "#3b82f6", strokeWidth: 1.5, color: "#3b82f6" };
}

function CanvasInner({ initialName = "", initialDescription = "" }) {
  const router = useRouter();
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState(initialName || "Untitled workflow");
  const [description, setDescription] = useState(initialDescription || "");
  const [nodes, setNodes] = useState<Node<NodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [useCaseId, setUseCaseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [compileResult, setCompileResult] = useState<{ ok: boolean; stepCount?: number; isolatedNodes?: string[]; error?: string } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  // Palette state
  const [activeTab, setActiveTab] = useState<StepKind>("atomic");
  const [paletteSearch, setPaletteSearch] = useState("");
  const [atomicItems, setAtomicItems] = useState<PaletteItem[]>([]);
  const [psItems, setPsItems] = useState<PaletteItem[]>([]);
  const [stratusItems, setStratusItems] = useState<PaletteItem[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/atomic-tests?page_size=200").then((r) => r.json()).catch(() => ({})),
      fetch("/api/purplesharp-variations").then((r) => r.json()).catch(() => ({})),
      fetch("/api/stratus-attacks?pageSize=300").then((r) => r.json()).catch(() => ({})),
    ]).then(([atomic, ps, strat]) => {
      if (!alive) return;
      setAtomicItems((atomic.items || atomic.tests || []).slice(0, 400).map((t: any) => ({
        kind: "atomic" as StepKind,
        refId: t.testGuid || t.id,
        techniqueId: t.techniqueId,
        displayName: t.testName || t.techniqueName,
        // Pull every catalogue field into meta so initialDataForKind can hydrate the inspector
        meta: {
          testGuid:        t.testGuid,
          techniqueName:   t.techniqueName,
          testName:        t.testName,
          testDescription: t.testDescription,
          executorName:    t.executorName,
          platforms:       t.platforms,
          elevationRequired: t.elevationRequired,
          command:         t.command,
          cleanupCommand:  t.cleanupCommand,
          inputArguments:  t.inputArguments,
          tactic:          t.tactic,
        },
      })));
      setPsItems((ps.items || []).map((v: any) => ({
        kind: "purplesharp" as StepKind,
        refId: `${v.techniqueId}-v${v.variation}`,
        techniqueId: v.techniqueId,
        displayName: `${v.techniqueName}${v.variationLabel ? ` · ${v.variationLabel}` : ""} (v${v.variation})`,
        meta: {
          techniqueName:   v.techniqueName,
          variation:       v.variation,
          variationLabel:  v.variationLabel,
          description:     v.description,
          tactic:          v.tactic,
          requiresUrl:     v.requiresUrl,
          requiresCommand: v.requiresCommand,
        },
      })));
      setStratusItems((strat.items || []).map((a: any) => ({
        kind: "stratus" as StepKind,
        refId: a.attackId,
        techniqueId: a.attackId,
        displayName: a.name,
        meta: {
          attackId:      a.attackId,
          name:          a.name,
          description:   a.description,
          platform:      a.platform,
          tactic:        a.tactic,
          prerequisites: a.prerequisites,
          detonateCmd:   a.detonateCmd,
          cleanupCmd:    a.cleanupCmd,
          isIdempotent:  a.isIdempotent,
        },
      })));
      setPaletteLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const items = activeTab === "atomic" ? atomicItems
              : activeTab === "purplesharp" ? psItems
              : activeTab === "stratus" ? stratusItems
              : [];

  // Logic items live in their own tab and aren't fetched.
  const logicItems: PaletteItem[] = useMemo(() => [
    { kind: "condition", refId: "if-else", techniqueId: "",  displayName: "If / Else (branch)", meta: { kind: "condition" } },
    { kind: "manual",    refId: "manual",  techniqueId: "", displayName: "Manual step (free-form)", meta: { kind: "manual" } },
  ], []);
  const showLogic = activeTab === ("logic" as unknown as StepKind);
  const visiblePaletteItems = showLogic ? logicItems : items;

  const filteredItems = useMemo(() => {
    if (!paletteSearch) return visiblePaletteItems.slice(0, 250);
    const q = paletteSearch.toLowerCase();
    return visiblePaletteItems.filter((it) =>
      it.displayName.toLowerCase().includes(q) || it.techniqueId.toLowerCase().includes(q) || it.refId.toLowerCase().includes(q),
    ).slice(0, 250);
  }, [visiblePaletteItems, paletteSearch]);

  // React Flow handlers
  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as Node<NodeData>[]), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) => {
      // If the source handle is "true" or "false" (condition node), colour the edge.
      const branch = conn.sourceHandle && conn.sourceHandle !== "source" ? conn.sourceHandle : "";
      const s = styleEdge(branch);
      return addEdge({
        ...conn,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: s.color },
        style: { stroke: s.stroke, strokeWidth: s.strokeWidth },
        data: { branch },
        label: branch || undefined,
        labelBgPadding: branch ? [4, 2] : undefined,
        labelBgStyle: branch ? { fill: "#0a0e1a", fillOpacity: 0.9 } : undefined,
        labelStyle: branch ? { fill: s.color, fontWeight: 600, fontSize: 10 } : undefined,
      } as Edge, eds);
    });
  }, []);

  // Hydrate a node's initial data from a dropped palette item. We carry every
  // catalogue field through to `parameters` so the inspector's editors can
  // surface (and let the user override) the upstream command, platforms,
  // executor, input arguments — anything the catalogue knows.
  const initialDataForKind = (it: PaletteItem): NodeData => {
    const meta: any = it.meta || {};
    if (it.kind === "atomic") {
      const inputArgsRaw = meta.inputArguments;
      const argSpecs: Record<string, any> = typeof inputArgsRaw === "string"
        ? (() => { try { return JSON.parse(inputArgsRaw); } catch { return {}; } })()
        : (inputArgsRaw || {});
      const inputArguments: Record<string, string> = Object.fromEntries(
        Object.entries(argSpecs).map(([k, v]: [string, any]) => [k, String(v?.default ?? "")])
      );
      return {
        kind: it.kind, refId: it.refId, techniqueId: it.techniqueId, displayName: it.displayName,
        parameters: {
          atomic: {
            testGuid:        it.refId,
            testName:        meta.testName || it.displayName,
            testDescription: meta.testDescription || "",
            techniqueName:   meta.techniqueName || "",
            tactic:          meta.tactic || "",
            executor:        meta.executorName || "powershell",
            platforms:       Array.isArray(meta.platforms) ? meta.platforms : ["windows"],
            elevationRequired: !!meta.elevationRequired,
            command:         meta.command || "",
            cleanupCommand:  meta.cleanupCommand || "",
            inputArguments,
            argSpecs,
          },
        },
      };
    }
    if (it.kind === "purplesharp") {
      return {
        kind: it.kind, refId: it.refId, techniqueId: it.techniqueId, displayName: it.displayName,
        parameters: {
          purplesharp: {
            variation:       meta.variation || 1,
            url:             meta.requiresUrl ? "" : "",
            command:         meta.requiresCommand ? "" : "",
            techniqueName:   meta.techniqueName || "",
            variationLabel:  meta.variationLabel || "",
            description:     meta.description || "",
            tactic:          meta.tactic || "",
            requiresUrl:     !!meta.requiresUrl,
            requiresCommand: !!meta.requiresCommand,
          },
        },
      };
    }
    if (it.kind === "stratus") {
      return {
        kind: it.kind, refId: it.refId, techniqueId: it.techniqueId, displayName: it.displayName,
        parameters: {
          stratus: {
            phases:        ["warmup", "detonate"],
            region:        "",
            attackId:      meta.attackId || it.refId,
            name:          meta.name || it.displayName,
            description:   meta.description || "",
            platform:      meta.platform || "",
            tactic:        meta.tactic || "",
            prerequisites: meta.prerequisites || "",
            detonateCmd:   meta.detonateCmd || "",
            cleanupCmd:    meta.cleanupCmd || "",
            isIdempotent:  meta.isIdempotent !== false,
          },
        },
      };
    }
    if (it.kind === "condition") {
      return {
        kind: it.kind, refId: it.refId, techniqueId: "", displayName: "If / Else",
        parameters: { condition: { predicate: "previous step succeeded", label: "" } },
      };
    }
    // manual
    return {
      kind: "manual", refId: it.refId, techniqueId: "", displayName: it.displayName || "Manual step",
      parameters: { manual: { executor: "bash", binary: "", command: "", cleanup_command: "", options: [] } },
    };
  };

  const onDragStart = (e: React.DragEvent, it: PaletteItem) => {
    e.dataTransfer.setData("application/x-detectops-palette", JSON.stringify(it));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-detectops-palette");
    if (!raw) return;
    const it = JSON.parse(raw) as PaletteItem;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const newNode: Node<NodeData> = {
      id: newNodeId(),
      type: it.kind === "condition" ? "condition" : "catalogue",
      position,
      data: initialDataForKind(it),
    };
    setNodes((nds) => [...nds, newNode]);
  }, [screenToFlowPosition]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) || null;

  const updateSelectedNode = (patch: Partial<NodeData>) => {
    if (!selectedNode) return;
    setNodes((nds) => nds.map((n) => n.id !== selectedNode.id ? n : { ...n, data: { ...n.data, ...patch } }));
  };
  const updateSelectedNodeParams = (kind: StepKind, patch: Record<string, any>) => {
    if (!selectedNode) return;
    setNodes((nds) => nds.map((n) => {
      if (n.id !== selectedNode.id) return n;
      const nextParams = { ...(n.data.parameters || {}), [kind]: { ...(n.data.parameters?.[kind] || {}), ...patch } };
      return { ...n, data: { ...n.data, parameters: nextParams } };
    }));
  };
  const deleteSelectedNode = () => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNodeId(null);
  };
  const updateSelectedEdge = (patch: Partial<Edge> & { branch?: string }) => {
    if (!selectedEdge) return;
    setEdges((eds) => eds.map((e) => {
      if (e.id !== selectedEdge.id) return e;
      const branch = patch.branch ?? (e.data as any)?.branch ?? "";
      const s = styleEdge(branch);
      return {
        ...e,
        label: branch || undefined,
        data: { ...(e.data as object || {}), branch },
        markerEnd: { type: MarkerType.ArrowClosed, color: s.color },
        style: { stroke: s.stroke, strokeWidth: s.strokeWidth },
        labelBgPadding: branch ? [4, 2] : undefined,
        labelBgStyle: branch ? { fill: "#0a0e1a", fillOpacity: 0.9 } : undefined,
        labelStyle: branch ? { fill: s.color, fontWeight: 600, fontSize: 10 } : undefined,
      };
    }));
  };
  const deleteSelectedEdge = () => {
    if (!selectedEdge) return;
    setEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
    setSelectedEdgeId(null);
  };

  // Save & compile
  const ensureUseCase = async (): Promise<string | null> => {
    if (useCaseId) return useCaseId;
    const techs = [...new Set(nodes.map((n) => n.data.techniqueId).filter(Boolean))];
    const res = await fetch("/api/use-cases", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || "Untitled workflow", description,
        authorMode: "canvas", framework: "mixed", source: "manual",
        platforms: [...new Set(nodes.flatMap((n) => (n.data as any)?.meta?.platforms || []))],
        steps: [],
      }),
    });
    const data = await res.json();
    if (!res.ok) { alert(`Save failed: ${data.error || "unknown"}`); return null; }
    setUseCaseId(data.id);
    return data.id;
  };
  const persistCanvas = async (forUseCaseId: string) => {
    await fetch(`/api/use-cases/${forUseCaseId}/canvas`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
        edges: edges.map((e) => ({
          id: e.id, source: e.source, target: e.target,
          sourceHandle: e.sourceHandle,
          label: typeof e.label === "string" ? e.label : undefined,
        })),
      }),
    });
  };
  const saveAndCompile = async () => {
    setSaving(true); setCompileResult(null);
    try {
      const ucId = await ensureUseCase();
      if (!ucId) return;
      await persistCanvas(ucId);
      const res = await fetch(`/api/use-cases/${ucId}/canvas/compile`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setCompileResult({ ok: true, stepCount: data.stepCount, isolatedNodes: data.isolatedNodes });
      else setCompileResult({ ok: false, error: data.error?.message || data.error || "Compile failed" });
    } catch (err: any) { setCompileResult({ ok: false, error: err.message || "Compile failed" }); }
    finally { setSaving(false); }
  };
  const exportFormat = async (fmt: "atomic-yaml" | "purplesharp-json" | "stratus-sh") => {
    if (!useCaseId) { alert("Save + Compile first."); return; }
    setExporting(fmt);
    try {
      const res = await fetch(`/api/use-cases/${useCaseId}/export`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: fmt }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Export failed: ${data.error}`); return; }
      const ext = fmt === "atomic-yaml" ? "yml" : fmt === "purplesharp-json" ? "json" : "sh";
      const blob = new Blob([data.body], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "workflow"}.${ext}`; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(null); }
  };

  return (
    <div className="grid grid-cols-[280px_1fr_340px] gap-3 h-[calc(100vh-200px)]">
      {/* LEFT — palette */}
      <div className="rounded-xl border border-border bg-card flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border">
          <div className="grid grid-cols-4 gap-1 mb-2">
            {[
              { k: "atomic" as const,      Icon: FlaskConical, label: "ART" },
              { k: "purplesharp" as const, Icon: FileCode2,    label: "PS" },
              { k: "stratus" as const,     Icon: Cloud,        label: "Stratus" },
              { k: "logic" as unknown as StepKind, Icon: GitBranch, label: "Logic" },
            ].map(({ k, Icon, label }) => {
              const c = k === ("logic" as unknown as StepKind) ? KIND_COLORS.condition : KIND_COLORS[k as StepKind];
              return (
                <button
                  key={String(k)}
                  onClick={() => setActiveTab(k as StepKind)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 py-1.5 rounded text-[10px] font-medium transition-colors",
                    activeTab === k ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  style={activeTab === k ? { background: c.bg, border: `1px solid ${c.text}55` } : {}}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              type="text"
              value={paletteSearch}
              onChange={(e) => setPaletteSearch(e.target.value)}
              placeholder="Filter…"
              className="w-full pl-6 pr-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {paletteLoading && !showLogic && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1 px-2 py-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading catalogues…
            </div>
          )}
          {!paletteLoading && filteredItems.length === 0 && (
            <div className="text-[11px] text-muted-foreground px-2 py-1">
              No items. {activeTab === "purplesharp" ? "Run PurpleSharp sync first." : activeTab === "stratus" ? "Run Stratus sync first." : ""}
            </div>
          )}
          {filteredItems.map((it) => {
            const c = KIND_COLORS[it.kind];
            return (
              <div
                key={`${it.kind}-${it.refId}`}
                draggable
                onDragStart={(e) => onDragStart(e, it)}
                className="cursor-grab active:cursor-grabbing px-2 py-1.5 rounded text-[11px] hover:bg-card-hover transition-colors border"
                style={{ borderColor: `${c.text}25` }}
              >
                <div className="flex items-center gap-1.5">
                  {it.techniqueId && <span className="font-mono text-[10px]" style={{ color: c.text }}>{it.techniqueId}</span>}
                  {!it.techniqueId && it.kind === "condition" && <GitBranch className="h-3 w-3" style={{ color: c.text }} />}
                  {!it.techniqueId && it.kind === "manual" && <Terminal className="h-3 w-3" style={{ color: c.text }} />}
                </div>
                <div className="text-foreground truncate" title={it.displayName}>{it.displayName}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CENTER — canvas */}
      <div className="rounded-xl border border-border overflow-hidden relative" ref={wrapperRef}>
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 max-w-[60%]">
          <input
            type="text" value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-2 py-1 text-xs rounded-md bg-card/90 border border-border text-foreground focus:outline-none focus:border-accent backdrop-blur-sm"
            placeholder="Workflow name"
          />
          <button
            onClick={saveAndCompile}
            disabled={saving || nodes.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50 backdrop-blur-sm"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            Save & Compile
          </button>
          {useCaseId && (
            <span className="text-[10px] text-muted-foreground bg-card/90 px-2 py-0.5 rounded backdrop-blur-sm font-mono">
              {useCaseId.slice(0, 8)}
            </span>
          )}
        </div>

        {compileResult && (
          <div className="absolute top-3 right-3 z-10 max-w-md">
            <div className={cn(
              "rounded-md px-3 py-2 text-[11px] flex items-start gap-1.5 backdrop-blur-sm",
              compileResult.ok
                ? "bg-success/15 border border-success/40 text-success"
                : "bg-danger/15 border border-danger/40 text-danger",
            )}>
              {compileResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />}
              <div>
                {compileResult.ok
                  ? <>Compiled {compileResult.stepCount} step{compileResult.stepCount !== 1 ? "s" : ""}{compileResult.isolatedNodes?.length ? ` · ${compileResult.isolatedNodes.length} isolated` : ""}</>
                  : <>Compile failed: {compileResult.error}</>}
                {compileResult.ok && (
                  <div className="mt-1 flex gap-1.5">
                    {(["atomic-yaml", "purplesharp-json", "stratus-sh"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => exportFormat(f)}
                        disabled={exporting === f}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-success/20 hover:bg-success/30 text-success disabled:opacity-50"
                      >
                        {exporting === f ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Download className="h-2.5 w-2.5" />}
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="absolute inset-0" onDragOver={onDragOver} onDrop={onDrop} style={{ width: "100%", height: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: selN, edges: selE }) => {
              setSelectedNodeId(selN?.[0]?.id || null);
              setSelectedEdgeId(selE?.[0]?.id || null);
            }}
            nodeTypes={nodeTypes}
            colorMode="dark"
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
              style: { stroke: "#3b82f6", strokeWidth: 1.5 },
            }}
            connectionLineStyle={{ stroke: "#3b82f6", strokeWidth: 1.5, strokeDasharray: "4 4" }}
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background gap={20} color="#1e293b" />
            <Controls position="bottom-right" />
            <MiniMap pannable zoomable position="bottom-left"
              nodeColor={(n) => KIND_COLORS[(n.data as NodeData)?.kind || "manual"].text}
            />
          </ReactFlow>
        </div>

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-muted-foreground">
              <WorkflowIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Drag items from the palette to start composing</p>
              <p className="text-[11px] mt-0.5">Hover a node's right edge to drag a connector to another node</p>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT — properties panel */}
      <div className="rounded-xl border border-border bg-card flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">
            {selectedEdge ? "Connector" : selectedNode ? "Step properties" : "Properties"}
          </h3>
          {selectedNode && (
            <button onClick={deleteSelectedNode} className="inline-flex items-center gap-1 text-[10px] text-danger hover:bg-danger/10 px-1.5 py-0.5 rounded">
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          )}
          {selectedEdge && (
            <button onClick={deleteSelectedEdge} className="inline-flex items-center gap-1 text-[10px] text-danger hover:bg-danger/10 px-1.5 py-0.5 rounded">
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {selectedEdge ? (
            <EdgeInspector edge={selectedEdge} onUpdate={updateSelectedEdge} />
          ) : !selectedNode ? (
            <div className="text-[11px] text-muted-foreground space-y-2">
              <p>Select a node or connector to edit it.</p>
              <p className="text-muted-foreground/70">Tips:</p>
              <ul className="list-disc ml-4 space-y-0.5 text-muted-foreground/70">
                <li>Drag from a node's right edge to another node's left edge to connect them.</li>
                <li>If/Else nodes expose <span className="text-success">true</span> and <span className="text-danger">false</span> outputs.</li>
                <li>Manual step lets you type a free-form binary + command.</li>
                <li>Delete a node or edge with the Backspace key.</li>
              </ul>
            </div>
          ) : (
            <NodeInspector
              node={selectedNode}
              onCommonUpdate={updateSelectedNode}
              onKindUpdate={updateSelectedNodeParams}
            />
          )}
        </div>

        <div className="px-3 py-2 border-t border-border">
          <textarea
            placeholder="Workflow description (optional)"
            value={description} onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Inspector components ─────────────────────────────────────────────────────

function EdgeInspector({ edge, onUpdate }: {
  edge: Edge; onUpdate: (patch: Partial<Edge> & { branch?: string }) => void;
}) {
  const branch = ((edge.data as any)?.branch as string) || "";
  return (
    <div className="space-y-3 text-[11px]">
      <div>
        <Label>From / To</Label>
        <div className="text-muted-foreground font-mono text-[10px] mt-0.5">
          {edge.source} → {edge.target}
        </div>
      </div>
      <div>
        <Label>Branch label</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {["", "true", "false", "yes", "no"].map((b) => (
            <button
              key={b || "none"}
              onClick={() => onUpdate({ branch: b })}
              className={cn(
                "px-2 py-0.5 text-[10px] rounded border transition-colors",
                branch === b
                  ? b === "true" || b === "yes"
                    ? "bg-success/15 text-success border-success/40"
                    : b === "false" || b === "no"
                      ? "bg-danger/15 text-danger border-danger/40"
                      : "bg-accent/15 text-accent border-accent/40"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-card-hover",
              )}
            >
              {b || "none"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Custom label</Label>
        <input
          type="text"
          value={typeof edge.label === "string" ? edge.label : ""}
          onChange={(e) => onUpdate({ branch: e.target.value })}
          placeholder="e.g. on success"
          className="mt-0.5 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
      </div>
    </div>
  );
}

function NodeInspector({ node, onCommonUpdate, onKindUpdate }: {
  node: Node<NodeData>;
  onCommonUpdate: (patch: Partial<NodeData>) => void;
  onKindUpdate: (kind: StepKind, patch: Record<string, any>) => void;
}) {
  const d = node.data;
  const c = KIND_COLORS[d.kind] || KIND_COLORS.manual;
  return (
    <div className="space-y-3 text-[11px]">
      <div>
        <Label>Kind</Label>
        <div className="mt-0.5 inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
          style={{ background: c.bg, color: c.text, border: `1px solid ${c.text}55` }}>
          {c.accent}
        </div>
      </div>
      <div>
        <Label>Display name</Label>
        <input
          type="text" value={d.displayName}
          onChange={(e) => onCommonUpdate({ displayName: e.target.value })}
          className="mt-0.5 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
      </div>
      {d.kind !== "condition" && d.kind !== "manual" && (
        <div>
          <Label>Technique ID</Label>
          <input
            type="text" value={d.techniqueId}
            onChange={(e) => onCommonUpdate({ techniqueId: e.target.value })}
            className="mt-0.5 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground font-mono focus:outline-none focus:border-accent"
          />
        </div>
      )}

      {/* Per-kind blocks */}
      {d.kind === "atomic" && <AtomicInspector params={d.parameters?.atomic || {}} onChange={(p) => onKindUpdate("atomic", p)} />}
      {d.kind === "purplesharp" && <PurpleSharpInspector params={d.parameters?.purplesharp || {}} onChange={(p) => onKindUpdate("purplesharp", p)} />}
      {d.kind === "stratus" && <StratusInspector params={d.parameters?.stratus || {}} onChange={(p) => onKindUpdate("stratus", p)} />}
      {d.kind === "manual" && <ManualInspector params={d.parameters?.manual || {}} onChange={(p) => onKindUpdate("manual", p)} />}
      {d.kind === "condition" && <ConditionInspector params={d.parameters?.condition || {}} onChange={(p) => onKindUpdate("condition", p)} />}

      <div>
        <Label>Expected signal</Label>
        <textarea
          value={d.expectedSignal || ""}
          onChange={(e) => onCommonUpdate({ expectedSignal: e.target.value })}
          rows={2}
          className="mt-0.5 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          placeholder="Sysmon EID 1, CloudTrail event, …"
        />
      </div>
      <div>
        <Label>Notes</Label>
        <textarea
          value={d.notes || ""}
          onChange={(e) => onCommonUpdate({ notes: e.target.value })}
          rows={2}
          className="mt-0.5 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[9px] uppercase text-muted-foreground tracking-wider">{children}</span>;
}

const ART_EXECUTORS = ["powershell", "command_prompt", "bash", "sh", "manual"] as const;
const ART_PLATFORMS = ["windows", "macos", "linux", "office-365", "azure-ad", "google-workspace", "containers"] as const;

function AtomicInspector({ params, onChange }: { params: any; onChange: (patch: any) => void }) {
  const args: Record<string, string> = params.inputArguments || {};
  const specs: Record<string, { description?: string; type?: string; default?: string }> = params.argSpecs || {};
  const platforms: string[] = Array.isArray(params.platforms) ? params.platforms : [];
  const [draftKey, setDraftKey] = useState("");

  return (
    <div className="space-y-2.5 rounded border border-accent/30 bg-accent/5 px-2 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase text-accent">ART parameters</span>
        {params.testGuid && (
          <span className="font-mono text-[9px] text-muted-foreground">
            guid {params.testGuid.slice(0, 8)}…
          </span>
        )}
      </div>

      {/* Catalogue context — read-only */}
      {(params.techniqueName || params.tactic) && (
        <div className="rounded border border-border bg-background/40 px-2 py-1.5 text-[10px] space-y-0.5">
          {params.techniqueName && <div><span className="text-muted-foreground">Technique: </span><span className="text-foreground">{params.techniqueName}</span></div>}
          {params.tactic && <div><span className="text-muted-foreground">Tactic: </span><span className="text-foreground">{params.tactic}</span></div>}
          {params.testDescription && <div className="text-muted-foreground italic mt-1 line-clamp-3">{params.testDescription}</div>}
        </div>
      )}

      {/* Executor + elevation */}
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <Label>Executor</Label>
          <select
            value={params.executor || "powershell"}
            onChange={(e) => onChange({ executor: e.target.value })}
            className="mt-0.5 w-full px-1.5 py-1 text-[11px] rounded border border-border bg-input text-foreground"
          >
            {ART_EXECUTORS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <Label>Elevation</Label>
          <label className="mt-0.5 flex items-center gap-1 px-1.5 py-1 text-[11px] rounded border border-border bg-input text-foreground cursor-pointer">
            <input
              type="checkbox" checked={!!params.elevationRequired}
              onChange={(e) => onChange({ elevationRequired: e.target.checked })}
              className="accent-accent"
            />
            required
          </label>
        </div>
      </div>

      {/* Platforms */}
      <div>
        <Label>Supported platforms</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {ART_PLATFORMS.map((p) => {
            const sel = platforms.includes(p);
            return (
              <button
                key={p}
                onClick={() => onChange({ platforms: sel ? platforms.filter((x) => x !== p) : [...platforms, p] })}
                className={cn(
                  "px-1.5 py-0.5 text-[9.5px] rounded border",
                  sel ? "bg-accent/20 border-accent/50 text-accent" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >{p}</button>
            );
          })}
        </div>
      </div>

      {/* Command */}
      <div>
        <Label>Attack command</Label>
        <textarea
          rows={4} value={params.command || ""}
          onChange={(e) => onChange({ command: e.target.value })}
          className="mt-0.5 w-full px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
          placeholder="powershell -enc #{payload}"
          style={{ resize: "vertical" }}
        />
      </div>

      {/* Cleanup */}
      <div>
        <Label>Cleanup command</Label>
        <textarea
          rows={2} value={params.cleanupCommand || ""}
          onChange={(e) => onChange({ cleanupCommand: e.target.value })}
          className="mt-0.5 w-full px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
          placeholder="optional"
          style={{ resize: "vertical" }}
        />
      </div>

      {/* Input arguments — values editable, description/type from catalogue */}
      <div>
        <Label>Input arguments (interpolated as #{"{name}"})</Label>
        <div className="mt-1 space-y-1">
          {Object.entries(args).map(([k, vv]) => {
            const spec = specs[k] || {};
            return (
              <div key={k} className="rounded border border-border bg-background/40 px-1.5 py-1">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono text-accent flex-shrink-0 w-1/3 truncate" title={k}>{k}</span>
                  <span className="text-[9px] text-muted-foreground flex-shrink-0">{spec.type || "string"}</span>
                  <button
                    onClick={() => { const next = { ...args }; delete next[k]; onChange({ inputArguments: next }); }}
                    className="ml-auto p-0.5 text-danger hover:bg-danger/10 rounded"
                  >
                    <Minus className="h-2.5 w-2.5" />
                  </button>
                </div>
                <input
                  type="text" value={vv}
                  onChange={(e) => onChange({ inputArguments: { ...args, [k]: e.target.value } })}
                  className="mt-0.5 w-full px-1.5 py-0.5 text-[11px] rounded border border-border bg-input text-foreground"
                />
                {spec.description && <div className="mt-0.5 text-[9px] text-muted-foreground line-clamp-2">{spec.description}</div>}
              </div>
            );
          })}
          <div className="flex gap-1">
            <input
              type="text" value={draftKey} onChange={(e) => setDraftKey(e.target.value)}
              placeholder="new arg name"
              className="flex-1 px-1.5 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
            />
            <button
              onClick={() => { if (draftKey.trim()) { onChange({ inputArguments: { ...args, [draftKey.trim()]: "" } }); setDraftKey(""); } }}
              className="px-1.5 text-accent hover:bg-accent/10 rounded"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PurpleSharpInspector({ params, onChange }: { params: any; onChange: (patch: any) => void }) {
  return (
    <div className="space-y-2.5 rounded border border-purple/30 bg-purple/5 px-2 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase text-purple">PurpleSharp parameters</span>
        {params.variationLabel && (
          <span className="text-[10px] text-muted-foreground">v{params.variation || 1} · {params.variationLabel}</span>
        )}
      </div>

      {(params.techniqueName || params.tactic || params.description) && (
        <div className="rounded border border-border bg-background/40 px-2 py-1.5 text-[10px] space-y-0.5">
          {params.techniqueName && <div><span className="text-muted-foreground">Technique: </span><span className="text-foreground">{params.techniqueName}</span></div>}
          {params.tactic && <div><span className="text-muted-foreground">Tactic: </span><span className="text-foreground">{params.tactic}</span></div>}
          {params.description && <div className="text-muted-foreground italic mt-1 line-clamp-3">{params.description}</div>}
        </div>
      )}

      <div>
        <Label>Variation index</Label>
        <input
          type="number" min={1} value={params.variation || 1}
          onChange={(e) => onChange({ variation: Math.max(1, parseInt(e.target.value || "1", 10)) })}
          className="mt-0.5 w-full px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
        />
      </div>

      <div>
        <Label>
          URL
          {params.requiresUrl ? <span className="ml-1 text-danger">*</span> : <span className="ml-1 text-muted-foreground">(optional)</span>}
        </Label>
        <input
          type="text" value={params.url || ""}
          onChange={(e) => onChange({ url: e.target.value })}
          className={cn(
            "mt-0.5 w-full px-2 py-1 text-[11px] rounded border bg-input text-foreground",
            params.requiresUrl && !params.url ? "border-danger/50" : "border-border",
          )}
          placeholder={params.requiresUrl ? "Required for this variation" : "https://… (for T1105 etc.)"}
        />
      </div>
      <div>
        <Label>
          Command
          {params.requiresCommand ? <span className="ml-1 text-danger">*</span> : <span className="ml-1 text-muted-foreground">(optional)</span>}
        </Label>
        <textarea
          rows={2} value={params.command || ""}
          onChange={(e) => onChange({ command: e.target.value })}
          className={cn(
            "mt-0.5 w-full px-2 py-1 text-[11px] font-mono rounded border bg-input text-foreground",
            params.requiresCommand && !params.command ? "border-danger/50" : "border-border",
          )}
          placeholder={params.requiresCommand ? "Required for this variation (e.g. whoami)" : "for T1059.x style techniques"}
          style={{ resize: "vertical" }}
        />
      </div>
    </div>
  );
}

function StratusInspector({ params, onChange }: { params: any; onChange: (patch: any) => void }) {
  const phases: string[] = Array.isArray(params.phases) ? params.phases : [];
  const togglePhase = (p: string) => {
    const next = phases.includes(p) ? phases.filter((x) => x !== p) : [...phases, p];
    onChange({ phases: next });
  };
  const platformBadgeColor = (p: string) =>
    p === "aws"        ? "bg-warning/15 text-warning border-warning/40" :
    p === "azure"      ? "bg-info/15 text-info border-info/40" :
    p === "gcp"        ? "bg-accent/15 text-accent border-accent/40" :
    p === "kubernetes" ? "bg-purple/15 text-purple border-purple/40" :
                         "bg-muted/15 text-muted-foreground border-border";
  return (
    <div className="space-y-2.5 rounded border border-info/30 bg-info/5 px-2 py-2">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <span className="text-[10px] font-bold uppercase text-info">Stratus parameters</span>
        <div className="flex items-center gap-1">
          {params.platform && (
            <span className={cn("px-1.5 py-0.5 text-[9px] font-mono rounded border uppercase", platformBadgeColor(params.platform))}>{params.platform}</span>
          )}
          {params.tactic && (
            <span className="px-1.5 py-0.5 text-[9px] rounded bg-background/60 text-muted-foreground border border-border">{params.tactic}</span>
          )}
          {params.isIdempotent && (
            <span className="px-1.5 py-0.5 text-[9px] rounded bg-success/15 text-success border border-success/40">idempotent</span>
          )}
        </div>
      </div>

      {(params.attackId || params.description) && (
        <div className="rounded border border-border bg-background/40 px-2 py-1.5 text-[10px] space-y-0.5">
          {params.attackId && <div><span className="text-muted-foreground">Attack ID: </span><span className="font-mono text-info">{params.attackId}</span></div>}
          {params.description && <div className="text-muted-foreground italic mt-1 line-clamp-3">{params.description}</div>}
        </div>
      )}

      <div>
        <Label>Phases to run</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {(["warmup", "detonate", "cleanup"] as const).map((p) => (
            <button
              key={p}
              onClick={() => togglePhase(p)}
              className={cn(
                "px-2 py-0.5 text-[10px] rounded border",
                phases.includes(p)
                  ? p === "detonate"
                    ? "bg-danger/15 text-danger border-danger/40"
                    : "bg-info/15 text-info border-info/40"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
              title={p === "detonate" ? "Destructive — gated by confirmDetonate at runtime" : undefined}
            >{p}</button>
          ))}
        </div>
        {phases.includes("detonate") && (
          <p className="mt-1 text-[9px] text-warning leading-tight">
            ⚠ detonate runs against your live cloud account; requires confirmDetonate at runtime
          </p>
        )}
      </div>

      <div>
        <Label>Region / target</Label>
        <input
          type="text" value={params.region || ""}
          onChange={(e) => onChange({ region: e.target.value })}
          className="mt-0.5 w-full px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
          placeholder="us-east-1"
        />
      </div>

      {/* Read-only command previews from the catalogue (no editing — driven by stratus CLI). */}
      {params.detonateCmd && (
        <div>
          <Label>Detonate (read-only)</Label>
          <pre className="mt-0.5 w-full px-2 py-1 text-[10px] font-mono rounded border border-border bg-background/60 text-foreground overflow-x-auto whitespace-pre-wrap break-all">{params.detonateCmd}</pre>
        </div>
      )}
      {params.cleanupCmd && (
        <div>
          <Label>Cleanup (read-only)</Label>
          <pre className="mt-0.5 w-full px-2 py-1 text-[10px] font-mono rounded border border-border bg-background/60 text-foreground overflow-x-auto whitespace-pre-wrap break-all">{params.cleanupCmd}</pre>
        </div>
      )}
      {params.prerequisites && (
        <div>
          <Label>Prerequisites</Label>
          <pre className="mt-0.5 w-full px-2 py-1 text-[10px] font-mono rounded border border-border bg-background/60 text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-24">{params.prerequisites}</pre>
        </div>
      )}
    </div>
  );
}

function ManualInspector({ params, onChange }: { params: any; onChange: (patch: any) => void }) {
  const options: string[] = Array.isArray(params.options) ? params.options : [];
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-2 rounded border border-muted/30 bg-muted/5 px-2 py-2">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">Manual step</span>
      <div>
        <Label>Executor</Label>
        <select
          value={params.executor || "bash"}
          onChange={(e) => onChange({ executor: e.target.value })}
          className="mt-0.5 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground"
        >
          {["powershell", "command_prompt", "bash", "sh", "manual"].map((x) => (<option key={x} value={x}>{x}</option>))}
        </select>
      </div>
      <div>
        <Label>Binary / script</Label>
        <input
          type="text" value={params.binary || ""}
          onChange={(e) => onChange({ binary: e.target.value })}
          className="mt-0.5 w-full px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
          placeholder="e.g. C:\\Tools\\PsExec.exe"
        />
      </div>
      <div>
        <Label>Options / flags</Label>
        <div className="mt-1 space-y-1">
          {options.map((o, i) => (
            <div key={i} className="flex gap-1">
              <input
                type="text" value={o}
                onChange={(e) => { const next = [...options]; next[i] = e.target.value; onChange({ options: next }); }}
                className="flex-1 px-1.5 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
              />
              <button onClick={() => onChange({ options: options.filter((_, j) => j !== i) })} className="px-1.5 text-danger hover:bg-danger/10 rounded">
                <Minus className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="flex gap-1">
            <input
              type="text" value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder="--flag value"
              className="flex-1 px-1.5 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
            />
            <button onClick={() => { if (draft.trim()) { onChange({ options: [...options, draft.trim()] }); setDraft(""); } }} className="px-1.5 text-accent hover:bg-accent/10 rounded">
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      <div>
        <Label>Command (free-form)</Label>
        <textarea
          value={params.command || ""}
          onChange={(e) => onChange({ command: e.target.value })}
          rows={3}
          className="mt-0.5 w-full px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
          placeholder="$BINARY $OPTIONS …"
        />
      </div>
      <div>
        <Label>Cleanup command</Label>
        <textarea
          value={params.cleanup_command || ""}
          onChange={(e) => onChange({ cleanup_command: e.target.value })}
          rows={2}
          className="mt-0.5 w-full px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
        />
      </div>
    </div>
  );
}

function ConditionInspector({ params, onChange }: { params: any; onChange: (patch: any) => void }) {
  return (
    <div className="space-y-2 rounded border border-warning/30 bg-warning/5 px-2 py-2">
      <span className="text-[10px] font-bold uppercase text-warning">If / Else</span>
      <div>
        <Label>Predicate (human-readable)</Label>
        <textarea
          value={params.predicate || ""}
          onChange={(e) => onChange({ predicate: e.target.value })}
          rows={2}
          className="mt-0.5 w-full px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground"
          placeholder='e.g. previous step exited 0, or "T1003.001 telemetry observed"'
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Exporters wrap downstream <span className="text-success">true</span> / <span className="text-danger">false</span> branches in shell <code className="font-mono">if</code> blocks when applicable.
        </p>
      </div>
      <div>
        <Label>Short label (shown on the node)</Label>
        <input
          type="text" value={params.label || ""}
          onChange={(e) => onChange({ label: e.target.value })}
          className="mt-0.5 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground"
          placeholder="e.g. T1003 fired"
        />
      </div>
    </div>
  );
}

export default function WorkflowCanvas(props: { initialName?: string; initialDescription?: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
