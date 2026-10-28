/**
 * Rule-review & recommendation agent.
 *
 * Reviews a coverage assessment's NON-successful items — ones that did not
 * simulate (failed / n-a) or ran but were not distinctly detected (generic-only
 * / absent) — and returns, per item, the root cause plus a deployable detection
 * recommendation (telemetry source + Sigma + SPL).
 *
 * Token discipline (the point of using a compact cyber model): items are
 * deduplicated by (technique, outcome) so near-identical atomics are reviewed
 * once, then sent in small batches with a tight prompt and a strict tool schema.
 * Model is configurable via RULE_REVIEW_MODEL (set a security-tuned / low-cost
 * model there) and falls back to the dispatcher's default provider/model.
 */
import { prisma } from "@/lib/prisma";
import { runTool } from "@/lib/llm";
import {
  RULE_REVIEW_SYSTEM, EMIT_RULE_REVIEW, buildRuleReviewUser, type GapRecord,
} from "@/lib/llm/prompts/rule-review.v1";

export interface RuleReview {
  id: string; tech: string; name: string; tactic: string;
  outcome: GapRecord["outcome"];
  root_cause: string; recommendation: string; telemetry_source: string;
  sigma: string; spl: string; priority: "high" | "medium" | "low"; confidence: "high" | "medium" | "low";
  applies_to: string[];   // every item id this dedup'd review covers
}
export interface RuleReviewRun {
  assessmentId: string; model: string; siem: string;
  reviewed: number; items: number; batches: number;
  tokensIn: number; tokensOut: number; costUsd: number;
  reviews: RuleReview[];
}

const BATCH = 10;                         // items per LLM call — small = low token/latency
const J = (s: string | null) => { try { return JSON.parse(s || "[]"); } catch { return []; } };

function outcomeOf(status: string, visBucket: string): GapRecord["outcome"] | null {
  if (status === "failed" || status === "n/a") return "not_simulated";
  if (status === "executed" && visBucket === "generic-only") return "generic_only";
  if (status === "executed" && visBucket === "absent") return "absent";
  return null;   // visible / pending → nothing to review
}

export async function reviewAssessmentGaps(opts: {
  assessmentId: string; model?: string; max?: number;
}): Promise<RuleReviewRun> {
  const a = await prisma.coverageAssessment.findUnique({ where: { id: opts.assessmentId } });
  if (!a) throw new Error("assessment not found");
  const siem = (a.siemConnectionId ? (await prisma.siemConnection.findUnique({ where: { id: a.siemConnectionId } }))?.kind : null) || "splunk";
  const model = opts.model || process.env.RULE_REVIEW_MODEL || undefined;   // undefined → provider default

  const items = await prisma.coverageAssessmentItem.findMany({ where: { assessmentId: opts.assessmentId }, orderBy: { order: "asc" } });
  const cmds = new Map(
    (await prisma.atomicTest.findMany({ select: { techniqueId: true, testNumber: true, command: true } }))
      .map((t) => [`${t.techniqueId}#${t.testNumber}`, t.command || ""]),
  );

  // Collect reviewable items, dedup by (tech, outcome) — one representative per
  // group carries the list of all item ids it stands for.
  const groups = new Map<string, { rep: GapRecord; applies: string[] }>();
  for (const it of items) {
    const outcome = outcomeOf(it.status, it.visBucket);
    if (!outcome) continue;
    const key = `${it.tech}|${outcome}`;
    const id = `${it.tech}#${it.num}`;
    if (groups.has(key)) { groups.get(key)!.applies.push(id); continue; }
    groups.set(key, {
      applies: [id],
      rep: {
        id, tech: it.tech, name: it.name, tactic: it.tactic, outcome,
        detail: outcome === "not_simulated" ? (it.tail || "").slice(0, 160) : "",
        command: cmds.get(id) || "",
        observedEventCodes: J(it.obsEventCodes),
        siem,
      },
    });
  }

  let reps = [...groups.values()];
  reps.sort((x, y) => (x.rep.outcome === "not_simulated" ? 0 : 1) - (y.rep.outcome === "not_simulated" ? 0 : 1));
  if (opts.max && reps.length > opts.max) reps = reps.slice(0, opts.max);

  const reviews: RuleReview[] = [];
  let usedModel = model || "";
  let batches = 0, tokensIn = 0, tokensOut = 0, costUsd = 0;
  for (let i = 0; i < reps.length; i += BATCH) {
    const chunk = reps.slice(i, i + BATCH);
    batches++;
    const res = await runTool<{ reviews: Array<Record<string, any>> }>({
      model,
      system: RULE_REVIEW_SYSTEM,
      user: buildRuleReviewUser(chunk.map((c) => c.rep), siem),
      tool: EMIT_RULE_REVIEW,
      maxTokens: 2200,
    });
    usedModel = res.model || usedModel;
    tokensIn += res.inputTokens || 0; tokensOut += res.outputTokens || 0; costUsd += res.costUsd || 0;
    const byId = new Map((res.data?.reviews || []).map((r) => [String(r.id), r]));
    for (const c of chunk) {
      const r = byId.get(c.rep.id) || {};
      reviews.push({
        id: c.rep.id, tech: c.rep.tech, name: c.rep.name, tactic: c.rep.tactic, outcome: c.rep.outcome,
        root_cause: String(r.root_cause || ""), recommendation: String(r.recommendation || ""),
        telemetry_source: String(r.telemetry_source || ""), sigma: String(r.sigma || ""), spl: String(r.spl || ""),
        priority: (["high", "medium", "low"].includes(r.priority) ? r.priority : "medium"),
        confidence: (["high", "medium", "low"].includes(r.confidence) ? r.confidence : "low"),
        applies_to: c.applies,
      });
    }
  }

  return {
    assessmentId: opts.assessmentId, model: usedModel || "(provider default)", siem,
    reviewed: reviews.length, items: items.length, batches,
    tokensIn, tokensOut, costUsd: Math.round(costUsd * 1e6) / 1e6, reviews,
  };
}
