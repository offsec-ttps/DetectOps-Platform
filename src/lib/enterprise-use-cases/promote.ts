/**
 * Promote a validated Enterprise Use Case into a Detection Pack row.
 *
 *   Conditions:
 *     - The use case must have at least one run with `validationOutcome="matched"`
 *       and `mode="simulate-and-validate"` (stub-only runs do not count).
 *       Override with `{force: true}` when an operator wants to promote
 *       manually (e.g. they validated externally).
 *
 *   What lands in the DetectionPack:
 *     - One row in `detection_packs` with the same name + severity +
 *       platforms + MITRE + descriptions, status="validate", category
 *       inferred from platforms.
 *     - One `detection_rules` row carrying the SELECTED logic body.
 *     - One `detection_simulations` row per step from the most recent
 *       `simulate-and-validate` run (dedup'd by framework + refId).
 *     - A stub `ir_playbooks` row so the Pack UI's IRP tab opens.
 *
 *   Lifecycle:
 *     - On success, the use case status flips to "promoted" and
 *       `githubIssueUrl` / `githubIssueNumber` are left as-is (they may be
 *       set by the github-push endpoint independently).
 */

import { prisma } from "@/lib/prisma";

export interface PromoteOptions {
  force?: boolean;
  actor?: string;
}

export interface PromoteResult {
  detectionPackId: string;
  slug: string;
  ruleCount: number;
  simulationCount: number;
  reusedExisting: boolean;
}

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function inferCategory(platforms: string[]): string {
  const set = new Set(platforms.map((p) => p.toLowerCase()));
  if (set.has("windows"))    return "os-windows";
  if (set.has("linux"))      return "os-linux";
  if (set.has("macos"))      return "os-macos";
  if (set.has("aws") || set.has("azure") || set.has("gcp") || set.has("iaas:aws") || set.has("iaas:azure") || set.has("iaas:gcp")) return "cloud";
  if (set.has("office-365") || set.has("azure-ad") || set.has("okta")) return "identity";
  if (set.has("network"))    return "network";
  return "other";
}

function inferRiskScore(severity: string): number {
  switch ((severity || "").toLowerCase()) {
    case "critical": return 90;
    case "high":     return 75;
    case "medium":   return 55;
    case "low":      return 35;
    case "info":     return 20;
    default:         return 50;
  }
}

function baseSlug(name: string, ucId: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56);
  const suffix = ucId.replace(/-/g, "").slice(0, 6);
  return `${base || "uc"}-${suffix}`;
}

async function resolveUniqueSlug(name: string, ucId: string): Promise<string> {
  const base = baseSlug(name, ucId);
  const existing = await prisma.detectionPack.findUnique({ where: { slug: base } });
  if (!existing) return base;
  for (let v = 2; v <= 100; v++) {
    const candidate = `${base}-v${v}`;
    if (!(await prisma.detectionPack.findUnique({ where: { slug: candidate } }))) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickSelectedBody(uc: { selectedLogic: string; originalDetectionLogic: string; recommendedDetectionLogic: string; editedDetectionLogic: string }): { body: string; format: string } {
  if (uc.selectedLogic === "edited") return { body: uc.editedDetectionLogic, format: "" };
  if (uc.selectedLogic === "recommended") return { body: uc.recommendedDetectionLogic, format: "sigma" };
  return { body: uc.originalDetectionLogic, format: "" };
}

export async function promoteUseCase(useCaseId: string, opts: PromoteOptions = {}): Promise<PromoteResult> {
  const uc = await prisma.enterpriseUseCase.findUnique({ where: { id: useCaseId } });
  if (!uc) throw Object.assign(new Error("use case not found"), { code: "not_found" });

  // Find most recent matched simulate-and-validate run that wasn't all-stub
  const candidateRuns = await prisma.enterpriseUseCaseRun.findMany({
    where: {
      useCaseId,
      mode: "simulate-and-validate",
      validationOutcome: "matched",
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  let chosenRun = null as null | typeof candidateRuns[number];
  for (const r of candidateRuns) {
    const steps = safeJson<Array<{ status: string }>>(r.stepResults, []);
    const allStubs = steps.length > 0 && steps.every((s) => s.status === "stubbed");
    if (!allStubs) { chosenRun = r; break; }
  }

  if (!chosenRun && !opts.force) {
    throw Object.assign(new Error(
      "No matched simulate-and-validate run (with non-stub steps) found. " +
      "Run a scenario that fires the detection first, or pass force=true to promote anyway.",
    ), { code: "not_validated" });
  }

  const selected = pickSelectedBody(uc);
  const ruleBody = selected.body || uc.originalDetectionLogic;
  const ruleFormat = selected.format || uc.format || "sigma";
  if (!ruleBody) {
    throw Object.assign(new Error("selected detection logic body is empty"), { code: "empty_logic" });
  }

  // De-dup: if we've already promoted this UC, reuse the existing pack
  const existing = uc.status === "promoted"
    ? await prisma.detectionPack.findFirst({
        where: { sourceType: "enterprise-uc", sourceRefId: uc.id },
        orderBy: { updatedAt: "desc" },
      })
    : null;
  if (existing) {
    return {
      detectionPackId: existing.id,
      slug: existing.slug,
      ruleCount: await prisma.detectionRule.count({ where: { packId: existing.id } }),
      simulationCount: await prisma.detectionSimulation.count({ where: { packId: existing.id } }),
      reusedExisting: true,
    };
  }

  const platforms = safeJson<string[]>(uc.platforms, []);
  const dataSources = safeJson<string[]>(uc.dataSources, []);
  const mitreTechniques = safeJson<string[]>(uc.mitreTechniques, []);
  const mitreTactics = safeJson<string[]>(uc.mitreTactics, []);

  // Gather simulation steps from the chosen run (or, if force-promoting, from the first scenario)
  type RunStep = { framework: string; refId?: string; techniqueId?: string; displayName: string };
  let simSteps: RunStep[] = [];
  if (chosenRun) {
    const fromRun = safeJson<Array<{ framework: string; displayName: string }>>(chosenRun.stepResults, []);
    simSteps = fromRun.map((s) => ({ framework: s.framework, displayName: s.displayName }));
    // Run results don't carry refId; re-hydrate from the scenario's persisted steps
    if (chosenRun.scenarioId) {
      const sc = await prisma.enterpriseUseCaseScenario.findUnique({ where: { id: chosenRun.scenarioId } });
      if (sc) {
        const scSteps = safeJson<Array<{ framework: string; refId?: string; techniqueId?: string; displayName: string }>>(sc.steps, []);
        simSteps = simSteps.map((rs, i) => ({ ...rs, refId: scSteps[i]?.refId, techniqueId: scSteps[i]?.techniqueId || mitreTechniques[0] }));
      }
    }
  } else {
    // Force-promote: use scenario 1
    const sc = await prisma.enterpriseUseCaseScenario.findFirst({
      where: { useCaseId },
      orderBy: { ordinal: "asc" },
    });
    if (sc) {
      simSteps = safeJson<Array<{ framework: string; refId?: string; techniqueId?: string; displayName: string }>>(sc.steps, []);
    }
  }

  // Dedup sims by (framework, refId, techniqueId)
  const dedupKey = (s: RunStep) => `${s.framework}|${s.refId || ""}|${s.techniqueId || ""}`;
  const seen = new Set<string>();
  const simulations = simSteps
    .filter((s) => ["atomic", "purplesharp", "stratus"].includes(s.framework))
    .filter((s) => {
      const k = dedupKey(s);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .slice(0, 20);

  const result = await prisma.$transaction(async (tx) => {
    const slug = await resolveUniqueSlug(uc.name, uc.id);

    const pack = await tx.detectionPack.create({
      data: {
        name: uc.name.slice(0, 240),
        slug,
        description: uc.description.slice(0, 4000),
        severity: uc.severity,
        riskScore: inferRiskScore(uc.severity),
        category: inferCategory(platforms),
        platforms: JSON.stringify(platforms),
        dataSources: JSON.stringify(dataSources),
        mitreTechniques: JSON.stringify(mitreTechniques),
        mitreTactics: JSON.stringify(mitreTactics),
        references: "[]",
        status: "validate",                                  // matches DetectionPack.status enum
        sourceType: "enterprise-uc",
        sourceTable: "EnterpriseUseCase",
        sourceRefId: uc.id,
      },
    });

    // The selected detection logic — single row
    await tx.detectionRule.create({
      data: {
        packId: pack.id,
        format: ruleFormat,
        language: ruleFormat,
        title: uc.name.slice(0, 240),
        body: ruleBody,
        validationStatus: chosenRun ? "valid" : "unvalidated",
        validationNotes: chosenRun
          ? `Promoted from EnterpriseUseCase ${uc.id} · run ${chosenRun.id} · ${chosenRun.validationOutcome}`
          : "Promoted without a matched run (force=true)",
        falsePositives: "[]",
      },
    });

    // Simulations
    for (const s of simulations) {
      await tx.detectionSimulation.create({
        data: {
          packId: pack.id,
          framework: s.framework,
          refId: s.refId || "",
          techniqueId: s.techniqueId || mitreTechniques[0] || "T0000",
          displayName: s.displayName.slice(0, 240),
          description: "",
          rationale: `Carried over from Enterprise UC scenario`,
        },
      });
    }

    // IRP scaffold so the Pack UI's IRP tab opens
    await tx.irPlaybook.create({
      data: {
        packId: pack.id,
        summary: `Imported from Enterprise Use Case "${uc.name}". Fill in tiered investigation steps.`,
        l1Steps: JSON.stringify([{
          order: 1,
          title: "Triage initial alert",
          action: `Verify the ${uc.name} detection fired in your SIEM.`,
          expectedFinding: "Event(s) matching the rule body in the affected timeframe.",
          escalateIf: "Multiple distinct sources / known IoC overlap.",
          references: [],
        }]),
        l2Steps: "[]",
        l3Steps: "[]",
        containment: "[]",
        eradication: "[]",
        recovery: "[]",
      },
    });

    // Flip lifecycle to promoted INSIDE the transaction so the status and the
    // pack land atomically. If the status flip lived outside the tx, a crash
    // between commit and flip would leave the UC un-promoted, and a retry —
    // whose dedup guard keys on status==="promoted" — would create a duplicate
    // pack.
    await tx.enterpriseUseCase.update({
      where: { id: uc.id },
      data: { status: "promoted" },
    });

    return { pack };
  });

  return {
    detectionPackId: result.pack.id,
    slug: result.pack.slug,
    ruleCount: 1,
    simulationCount: simulations.length,
    reusedExisting: false,
  };
}
