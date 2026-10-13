/**
 * Rules-first, AI-fallback classifier for the TI → Simulation-Library watcher.
 *
 * Given one observed technique (+ its parent TI report context), decide which
 * Attack-Simulation library it belongs to. Deterministic rules handle the
 * common case with zero API cost and a fully explainable reason; only when the
 * rules are inconclusive AND an LLM provider is configured do we fall back to an
 * AI classifier. Otherwise the technique is left `unrouted` for manual routing.
 *
 * It NEVER invents a library — a non-matching technique stays unrouted.
 */

import { LIBRARY_TARGETS, type LibraryTarget } from "./targets";

export interface ClassifyInput {
  techniqueId: string;        // "T1204.004"
  techniqueName: string;      // may equal the id when the TI report had no name
  tactic?: string;            // tactic slug, often "" / "unknown" from the normalizer
  reportTitle?: string;
  reportSummary?: string;
  reportCategory?: string;
  tags?: string[];
}

export type ClassifyMethod = "rules" | "ai" | "none";

export interface ClassifyResult {
  libraryKey: string | null; // null ⇒ unrouted
  category: string | null;
  confidence: number;        // 0..1
  method: ClassifyMethod;
  reason: string;
}

/** Rules acceptance threshold. Below this, fall back to AI (if available). */
const RULES_ACCEPT = 0.5;

function parentId(techniqueId: string): string {
  return techniqueId.split(".")[0];
}

/** Score a single target against the input using deterministic signals. */
function scoreTarget(target: LibraryTarget, input: ClassifyInput): { score: number; hits: string[] } {
  const hits: string[] = [];
  let score = 0;
  const r = target.routing;
  const id = input.techniqueId.toUpperCase();
  const pid = parentId(id);

  if (r.attackIds?.some((a) => a.toUpperCase() === id)) { score += 0.6; hits.push(`exact ATT&CK ${id}`); }
  else if (r.attackPrefixes?.some((p) => pid === p.toUpperCase())) { score += 0.3; hits.push(`ATT&CK family ${pid}`); }

  if (input.tactic && r.tactics?.includes(input.tactic.toLowerCase())) { score += 0.1; hits.push(`tactic ${input.tactic}`); }

  const hay = [input.techniqueName, input.reportTitle, input.reportSummary, input.reportCategory, ...(input.tags || [])]
    .filter(Boolean).join(" ").toLowerCase();
  const kwHits = (r.keywords || []).filter((k) => hay.includes(k));
  if (kwHits.length) {
    score += Math.min(0.5, kwHits.length * 0.25);
    hits.push(`keyword${kwHits.length > 1 ? "s" : ""}: ${kwHits.slice(0, 3).join(", ")}`);
  }

  return { score: Math.min(1, score), hits };
}

/** Deterministic pass. Returns the best target if it clears the threshold. */
export function classifyByRules(input: ClassifyInput): ClassifyResult {
  let best: { target: LibraryTarget; score: number; hits: string[] } | null = null;
  for (const target of LIBRARY_TARGETS) {
    const { score, hits } = scoreTarget(target, input);
    if (score > 0 && (!best || score > best.score)) best = { target, score, hits };
  }
  if (best && best.score >= RULES_ACCEPT) {
    return {
      libraryKey: best.target.libraryKey,
      category: best.target.categoryFor(input.techniqueId, input.techniqueName),
      confidence: best.score,
      method: "rules",
      reason: `Routed to ${best.target.displayName} by rules — ${best.hits.join("; ")}.`,
    };
  }
  return {
    libraryKey: null, category: null, confidence: best?.score ?? 0, method: "none",
    reason: best ? `Best rule match (${best.target.displayName}) scored ${best.score.toFixed(2)} < ${RULES_ACCEPT}.` : "No rule matched any library.",
  };
}

interface AiClassification { libraryKey: string | null; confidence: number; reason: string }

/** AI fallback. Only called when a provider is configured. */
async function classifyByAi(input: ClassifyInput): Promise<ClassifyResult | null> {
  try {
    const { runTool } = await import("@/lib/llm");
    const catalog = LIBRARY_TARGETS.map((t) => `- key="${t.libraryKey}": ${t.displayName} — ${t.description}`).join("\n");
    const tool = {
      name: "route_technique",
      description: "Route one observed attacker technique to the single best-fitting simulation library, or null if none fit.",
      input_schema: {
        type: "object",
        required: ["libraryKey", "confidence", "reason"],
        properties: {
          libraryKey: { type: ["string", "null"], description: `One of the library keys, or null if NONE is a good fit. Keys: ${LIBRARY_TARGETS.map((t) => t.libraryKey).join(", ")}.` },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", description: "One sentence explaining the routing decision." },
        },
      } as unknown as Record<string, unknown>,
    };
    const system = "You route observed attacker techniques to the correct attack-simulation library. Prefer null over a weak fit — libraries must stay precise. Only answer via the tool.";
    const user = [
      "Available libraries:", catalog, "",
      "Observed technique:",
      `- ATT&CK id: ${input.techniqueId}`,
      `- name: ${input.techniqueName || "(unknown)"}`,
      `- tactic: ${input.tactic || "(unknown)"}`,
      `- from TI report: ${input.reportTitle || "(untitled)"}`,
      input.reportSummary ? `- report summary: ${input.reportSummary.slice(0, 500)}` : "",
      (input.tags && input.tags.length) ? `- tags: ${input.tags.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const res = await runTool<AiClassification>({ system, user, tool, maxTokens: 300 });
    const data = res.data;
    const key = data.libraryKey && LIBRARY_TARGETS.some((t) => t.libraryKey === data.libraryKey) ? data.libraryKey : null;
    if (!key) return { libraryKey: null, category: null, confidence: data.confidence ?? 0, method: "ai", reason: `AI: ${data.reason || "no good library fit"}` };
    const target = LIBRARY_TARGETS.find((t) => t.libraryKey === key)!;
    return {
      libraryKey: key, category: target.categoryFor(input.techniqueId, input.techniqueName),
      confidence: Math.max(0, Math.min(1, data.confidence ?? 0.5)), method: "ai",
      reason: `AI routed to ${target.displayName} — ${data.reason || "(no reason given)"}`,
    };
  } catch {
    return null; // provider error → leave unrouted
  }
}

export interface ClassifyOptions {
  /** false ⇒ never call the LLM for this item (caller's per-scan AI budget is spent). */
  allowAi?: boolean;
}

/**
 * Classify one technique: rules first, AI fallback only when rules are
 * inconclusive, the caller still allows it, and a provider is configured.
 * Never throws.
 */
export async function classifyTechnique(input: ClassifyInput, opts: ClassifyOptions = {}): Promise<ClassifyResult> {
  const byRules = classifyByRules(input);
  if (byRules.libraryKey) return byRules;

  if (opts.allowAi === false) {
    return { ...byRules, reason: `${byRules.reason} AI fallback skipped (per-scan AI budget reached).` };
  }

  let aiAvailable = false;
  try {
    const { anyProviderConfigured } = await import("@/lib/llm");
    aiAvailable = anyProviderConfigured();
    if (!aiAvailable) {
      // env said no — DB-managed keys may still exist
      const { listConfiguredKinds } = await import("@/lib/llm/db-config");
      aiAvailable = (await listConfiguredKinds().catch(() => new Set<string>())).size > 0;
    }
  } catch { aiAvailable = false; }

  if (!aiAvailable) {
    return { ...byRules, reason: `${byRules.reason} AI fallback disabled (no LLM provider configured).` };
  }
  const byAi = await classifyByAi(input);
  return byAi ?? { ...byRules, reason: `${byRules.reason} AI fallback failed.` };
}
