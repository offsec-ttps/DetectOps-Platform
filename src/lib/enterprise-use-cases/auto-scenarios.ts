/**
 * Auto-suggest scenarios from MITRE techniques.
 *
 * Reuses the candidate-finder from src/lib/detection-packs/infer-sims.ts to
 * look up ART / PurpleSharp / Stratus matches per technique. Groups results
 * per framework into one scenario each, then adds a `manual` fallback
 * scenario if nothing matched.
 *
 * Per the schema, scenarios.steps is a JSON array of:
 *   {
 *     framework: "atomic"|"purplesharp"|"stratus"|"manual"|"reverse-shell"|"bind-shell"|"agent",
 *     refId?: string,
 *     techniqueId?: string,
 *     displayName: string,
 *     parameters: Record<string, unknown>,
 *     expectedSignal?: string,
 *     notes?: string,
 *   }
 */

import { inferSimulations, type SimDraft } from "@/lib/detection-packs/infer-sims";

export interface AutoScenarioStep {
  framework: "atomic" | "purplesharp" | "stratus" | "manual" | "reverse-shell" | "bind-shell" | "agent";
  refId?: string;
  techniqueId?: string;
  displayName: string;
  parameters: Record<string, unknown>;
  expectedSignal?: string;
  notes?: string;
}

export interface AutoScenarioDraft {
  ordinal: number;
  name: string;
  description: string;
  steps: AutoScenarioStep[];
  source: "auto";
}

const FRAMEWORK_LABEL: Record<SimDraft["framework"], string> = {
  atomic:      "ART",
  purplesharp: "PurpleSharp",
  stratus:     "Stratus",
};

const FRAMEWORK_DEFAULT_PARAMETERS: Record<SimDraft["framework"], (s: SimDraft) => Record<string, unknown>> = {
  atomic:      (s) => ({ testGuid: s.refId }),
  purplesharp: (s) => ({ variationRowId: s.refId }),
  stratus:     (s) => ({ phases: ["warmup", "detonate"] }),
};

export async function buildAutoScenarios({
  techniques,
  useCaseName,
  relevanceHint,
}: {
  techniques: string[];
  useCaseName: string;
  /**
   * Free-form text that biases simulation ranking — pass the use case's
   * description + extracted body keywords so e.g. a use case about
   * "certutil" surfaces the certutil-specific ART test instead of the
   * alphabetically-first base64-Python test for T1140.
   */
  relevanceHint?: string;
}): Promise<AutoScenarioDraft[]> {
  const sims = await inferSimulations({
    techniques,
    capPerFramework: 8,
    // Always include the use case name in the hint; callers usually also pass
    // description + body excerpt for stronger signal.
    relevanceHint: `${useCaseName} ${relevanceHint || ""}`.slice(0, 4000),
  });

  // Group by framework
  const byFramework = new Map<SimDraft["framework"], SimDraft[]>();
  for (const s of sims) {
    if (!byFramework.has(s.framework)) byFramework.set(s.framework, []);
    byFramework.get(s.framework)!.push(s);
  }

  const drafts: AutoScenarioDraft[] = [];
  let ordinal = 1;

  // Order: atomic → purplesharp → stratus (matches plan's preference)
  for (const fw of ["atomic", "purplesharp", "stratus"] as const) {
    const list = byFramework.get(fw);
    if (!list?.length) continue;
    const steps: AutoScenarioStep[] = list.slice(0, 8).map((s) => ({
      framework: fw,
      refId: s.refId || undefined,
      techniqueId: s.techniqueId,
      displayName: s.displayName,
      parameters: FRAMEWORK_DEFAULT_PARAMETERS[fw](s),
      expectedSignal: "",
      notes: s.rationale,
    }));
    drafts.push({
      ordinal: ordinal++,
      name: `${FRAMEWORK_LABEL[fw]} coverage — ${useCaseName.slice(0, 60)}`,
      description: `Auto-suggested ${FRAMEWORK_LABEL[fw]} chain covering ${list.length} technique${list.length !== 1 ? "s" : ""} mapped from this use case.`,
      steps,
      source: "auto",
    });
  }

  // Manual fallback when nothing matched (or no techniques at all)
  if (drafts.length === 0) {
    drafts.push({
      ordinal: 1,
      name: `Manual chain — ${useCaseName.slice(0, 60)}`,
      description: "No catalogue matches found. Edit the steps below with manual command / script / reverse-shell payloads that reproduce the techniques this rule targets.",
      steps: (techniques.length > 0 ? techniques : ["TXXXX"]).slice(0, 6).map((tid, i) => ({
        framework: "manual",
        techniqueId: tid,
        displayName: `Manual step ${i + 1}: replicate ${tid}`,
        parameters: { command: "", executor: "bash", binary: "", options: [] },
        expectedSignal: "",
        notes: "No ART/PurpleSharp/Stratus catalogue entry was found for this technique — fill the command + executor manually.",
      })),
      source: "auto",
    });
  }

  return drafts;
}
