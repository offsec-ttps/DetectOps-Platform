/**
 * Rule-review & recommendation agent (v1).
 *
 * Given coverage-assessment items that did NOT simulate (failed / n-a) or ran
 * but were NOT detected (generic-only / absent), ask a detection-engineering
 * model to explain the root cause and recommend a concrete fix: the telemetry
 * source to enable and a deployable Sigma + SPL rule. Prompts are deliberately
 * compact (low token I/O) and the output is a strict tool schema (no prose), so
 * a small/efficient cyber model can be used without quality loss.
 */
import type { AnthropicTool } from "@/lib/llm/anthropic";

export const RULE_REVIEW_SYSTEM =
  "You are a senior detection engineer and purple-team lead. You receive adversary-" +
  "simulation results (MITRE ATT&CK techniques run with Atomic Red Team against a " +
  "Windows lab shipping Sysmon + Windows Security + PowerShell logs to Splunk). For " +
  "each item decide, precisely and without filler:\n" +
  "- If it did NOT execute (not_simulated): the single most likely root cause " +
  "(missing prerequisite/binary, needs elevation, needs AD/domain, interactive/GUI, " +
  "timeout/long-running, test absent from host, non-Windows) and the exact remedy.\n" +
  "- If it executed but was NOT distinctly detected (generic_only/absent): the " +
  "telemetry gap — which specific log source / Event ID should carry the distinctive " +
  "indicator (e.g. Sysmon EID1 CommandLine, EID11 FileCreate, EID12/13 Registry, " +
  "Security 4688 w/ cmdline, PowerShell 4104 ScriptBlock, 4698 schtask, 7045 service) " +
  "— and give a minimal, deployable detection.\n" +
  "Rules: be specific to the command shown; never invent Event IDs; prefer the " +
  "least-noisy distinctive selector; Sigma must be valid YAML; SPL must be runnable " +
  "Splunk search. Keep every string tight.";

/** Strict output schema — one entry per input item, same order. */
export const EMIT_RULE_REVIEW: AnthropicTool = {
  name: "emit_rule_review",
  description: "Return one review per input item (preserve id).",
  input_schema: {
    type: "object",
    required: ["reviews"],
    properties: {
      reviews: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "root_cause", "recommendation", "telemetry_source", "priority", "confidence"],
          properties: {
            id: { type: "string", description: "echo the item id" },
            root_cause: { type: "string", description: "why it didn't simulate OR why detection missed it (one tight sentence)" },
            recommendation: { type: "string", description: "the concrete fix (one-two sentences)" },
            telemetry_source: { type: "string", description: "log source / Event ID to enable or query; empty if a sim-only fix" },
            sigma: { type: "string", description: "minimal valid Sigma YAML, or empty if not a detection item" },
            spl: { type: "string", description: "runnable Splunk SPL, or empty if not a detection item" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
        },
      },
    },
  },
};

export interface GapRecord {
  id: string;            // tech#num
  tech: string;
  name: string;
  tactic: string;
  outcome: "not_simulated" | "generic_only" | "absent";
  detail: string;        // failure tail / reason (trimmed)
  command: string;       // trimmed atomic command
  observedEventCodes: string[];
  siem: string;
}

/** Compact user payload — one line per item keeps input tokens minimal. */
export function buildRuleReviewUser(records: GapRecord[], siem: string): string {
  const lines = records.map((r) => {
    const cmd = (r.command || "").replace(/\s+/g, " ").slice(0, 320);
    const obs = r.observedEventCodes.length ? ` observedEID=${r.observedEventCodes.slice(0, 6).join(",")}` : "";
    const det = r.detail ? ` detail="${r.detail.replace(/\s+/g, " ").slice(0, 120)}"` : "";
    return `- id=${r.id} tech=${r.tech} tactic=${r.tactic} outcome=${r.outcome}${det}${obs} name="${(r.name || "").slice(0, 80)}" cmd="${cmd}"`;
  });
  return `SIEM=${siem}. Review these ${records.length} items and return one review each (echo id):\n${lines.join("\n")}`;
}
