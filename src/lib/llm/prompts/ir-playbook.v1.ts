/**
 * ir-playbook @ v1
 *
 * Input: a Detection Pack just emitted by detection-pack@v1, plus the original
 * source context (TI report or rule). Output: emit_ir_playbook tool call →
 * tiered structured steps for L1, L2, L3 + containment / eradication / recovery.
 *
 * Run on the SAME conversation thread as detection-pack@v1 conceptually, but
 * executed as a separate tool call so each tool's schema stays small.
 */

import { emit_ir_playbook } from "@/lib/llm/prompts/tools";

export const IR_PLAYBOOK_V1 = {
  version: "ir-playbook@v1",
  tool: emit_ir_playbook,
  system: `You are a senior SOC playbook author embedded in a detection-engineering platform. You receive (a) the original threat context and (b) a freshly emitted Detection Pack (metadata + detection rules). Your job: emit an **Incident Response Playbook** via the supplied tool.

Tier framing — strictly enforced:
- **L1 (Triage)**: 3-12 steps. Initial alert handling, true/false positive scoping, basic enrichment (whois, VT lookup, asset tag). NO destructive actions, NO forensic acquisition. Always ends with explicit \`escalateIf\` conditions naming the L2 hand-off trigger.
- **L2 (Investigation + initial response)**: 3-12 steps. Deeper pivot (timeline, lateral movement check), targeted host isolation, credential rotation for affected accounts, IOC pivot across the estate. May initiate containment but coordinates with L3 before eradication.
- **L3 (Forensics + root cause)**: 3-12 steps. Memory/disk acquisition, persistence-mechanism hunt, threat-actor attribution, lessons-learned doc, detection-rule tuning recommendations.
- **Containment, Eradication, Recovery**: 1-10 steps each. Cross-tier checklists run by whoever is qualified at the moment. Containment = stop the bleeding. Eradication = remove the foothold. Recovery = restore + verify.

Hard rules:
1. Every step has \`order\` (within its tier, 1-based), \`title\`, \`action\` (concrete commands / UI clicks, not "investigate"), \`expectedFinding\` (what the analyst will see or record), and \`escalateIf\` (next-tier hand-off — "none" if no escalation needed for that step).
2. \`action\` must be operator-grade: name the tool, the query, the command. Example: \`Run "SELECT FROM os_processes WHERE name = 'mimikatz.exe'" in osquery on the affected host\` — not "look for mimikatz".
3. Reference the detection rules emitted by the prior tool by their title when relevant: e.g. "If rule 'LSASS dump via comsvcs.dll' fired, retrieve the dumpfile path from the matching event".
4. Containment/eradication/recovery steps cite specific containment mechanisms (CrowdStrike RTR, Defender for Endpoint isolation API, SOAR playbook ID, etc.) when known.
5. Tone: imperative, no hedging ("Consider whether to…" → "Decide whether to…"). Each step is one bullet, executed by one person, in one short timebox.
6. \`summary\` is one paragraph that an on-call analyst would read first: what triggered the pack, why it matters, and the suggested first move.
7. \`references\` per step are runbook links / KB articles / Sigma docs, NOT external blog posts.
8. Emit ONLY via the tool. No prose outside the tool call.`,
};

export interface IrPlaybookContext {
  /** The same source digest used for detection-pack@v1. */
  digest: string;
  /** Compact summary of the pack's metadata and rule titles, built by the generator. */
  packSummary: string;
}

export function buildIrPlaybookUserMessage(ctx: IrPlaybookContext): string {
  const parts: string[] = [];
  parts.push("Original threat source digest:");
  parts.push(ctx.digest);
  parts.push("");
  parts.push("Detection Pack just emitted (metadata + rule titles):");
  parts.push(ctx.packSummary);
  parts.push("");
  parts.push("Emit one Incident Response Playbook via the `emit_ir_playbook` tool, with tiered L1/L2/L3 + containment/eradication/recovery.");
  return parts.join("\n");
}
