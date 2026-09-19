/**
 * Workflow canvas compiler.
 *
 * Accepts ReactFlow nodes/edges and returns either:
 *   - { ok: true,  steps: StepDraft[] }   — DAG was acyclic; steps emitted in topological order
 *   - { ok: false, error }                 — cycle detected (`error.cycle` lists node IDs forming it)
 *
 * Each canvas node's `data` carries the catalogue payload that landed it on
 * the canvas: { kind, refId, techniqueId, displayName, parameters? }.
 */

import type { StepDraft, StepKind, StepParameters } from "@/lib/use-cases/types";

export interface CanvasNode {
  id: string;
  type?: string;
  data: {
    kind: StepKind;
    refId?: string;
    techniqueId?: string;
    displayName?: string;
    expectedSignal?: string;
    notes?: string;
    parameters?: StepParameters;
  };
  // ReactFlow position/measured don't matter for compile
  position?: { x: number; y: number };
}

export interface CanvasEdge {
  id?: string;
  source: string;
  target: string;
  /** Source-handle id ("true" / "false" on condition nodes, undefined otherwise). */
  sourceHandle?: string | null;
  /** Optional label that travels with the edge (e.g. "yes" / "no"). */
  label?: string;
}

export interface CompileOk {
  ok: true;
  steps: StepDraft[];
  isolatedNodes: string[];                          // nodes with no edges → emitted as well, after the connected DAG
}
export interface CompileErr {
  ok: false;
  error: { code: "cycle" | "missing-node"; message: string; cycle?: string[] };
}
export type CompileResult = CompileOk | CompileErr;

export function compileCanvasToSteps(nodes: CanvasNode[], edges: CanvasEdge[]): CompileResult {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Build adjacency + in-degree
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { adj.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of edges) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) {
      return { ok: false, error: { code: "missing-node", message: `Edge ${e.source}→${e.target} references unknown node` } };
    }
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);

  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) || []) {
      const newDeg = (indeg.get(next) || 0) - 1;
      indeg.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (order.length !== nodes.length) {
    // Cycle present — gather the offending nodes for the error
    const remaining = nodes.filter((n) => !order.includes(n.id)).map((n) => n.id);
    return {
      ok: false,
      error: { code: "cycle", message: `Cycle detected involving ${remaining.length} node(s).`, cycle: remaining },
    };
  }

  // Translate to StepDraft. Edges with explicit branch labels (true/false from
  // condition nodes) get serialised into the source-step's `parameters.outgoing`
  // so exporters can wrap downstream steps in shell `if` blocks later.
  const connectedIds = new Set(edges.flatMap((e) => [e.source, e.target]));
  const isolated = nodes.filter((n) => !connectedIds.has(n.id)).map((n) => n.id);

  const outgoingByNode = new Map<string, Array<{ target: string; branch: string }>>();
  for (const e of edges) {
    const branch = (e.sourceHandle && e.sourceHandle !== "source")
      ? e.sourceHandle
      : (e.label || "");
    if (!outgoingByNode.has(e.source)) outgoingByNode.set(e.source, []);
    outgoingByNode.get(e.source)!.push({ target: e.target, branch });
  }

  // Map node id → resulting step index so the outgoing[] can reference steps by 1-based index
  const idToIndex = new Map<string, number>();
  order.forEach((id, i) => idToIndex.set(id, i));

  const steps: StepDraft[] = order.map((id, i) => {
    const n = nodeMap.get(id)!;
    const params = { ...(n.data.parameters || {}) };
    const outs = outgoingByNode.get(id) || [];
    if (outs.length > 0) {
      // Tag every outgoing edge with the target's resulting step index + branch
      (params as any).outgoing = outs.map((o) => ({
        targetStep: (idToIndex.get(o.target) ?? -1) + 1,
        branch: o.branch || "",
      }));
    }
    return {
      orderIndex: i,
      kind: n.data.kind,
      refId: n.data.refId || "",
      techniqueId: n.data.techniqueId || "",
      displayName: n.data.displayName || n.data.techniqueId || `step ${i + 1}`,
      parameters: params,
      expectedSignal: n.data.expectedSignal || "",
      notes: n.data.notes || "",
    };
  });

  return { ok: true, steps, isolatedNodes: isolated };
}
