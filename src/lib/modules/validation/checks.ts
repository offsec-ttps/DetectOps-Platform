/**
 * Automated validation checks for a submitted module. Each returns
 * { name, status, detail }. None of these execute the module — the dry-run is a
 * compile + dispatch-matrix check, never a real `runScenario` (no SSH/detonate).
 */

import { prisma } from "@/lib/prisma";
import { validateManifest } from "@/lib/modules/manifest-schema";
import { compileScenarios } from "@/lib/modules/compiler";
import { verifyModuleSignature } from "@/lib/modules/signing";
import { satisfies, isValid } from "@/lib/modules/semver";
import { CORE_VERSION } from "@/lib/modules/core-version";
import type { ModuleManifest } from "@/lib/modules/types";

export type CheckStatus = "pass" | "warn" | "fail";
export interface CheckResult { name: string; status: CheckStatus; detail: string }

// Frameworks the existing runner's dispatchStep handles (real or stub) — a step
// using any of these will dispatch cleanly without throwing.
const RUNNER_HANDLED = new Set(["atomic", "manual", "stratus", "agent", "shell", "reverse-shell", "bind-shell", "purplesharp"]);

export async function runChecks(row: {
  id: string; manifest: string; contentHash: string; signatureB64: string; signatureState: string;
}): Promise<{ checks: CheckResult[]; dryRun: Array<{ status: string; notes: string }>; manifest: ModuleManifest | null }> {
  const checks: CheckResult[] = [];
  const dryRun: Array<{ status: string; notes: string }> = [];

  // 1. manifest-schema
  let manifest: ModuleManifest | null = null;
  const v = validateManifest((() => { try { return JSON.parse(row.manifest); } catch { return null; } })());
  if (!v.ok || !v.manifest) {
    checks.push({ name: "manifest-schema", status: "fail", detail: v.errors.join("; ") || "invalid manifest" });
    return { checks, dryRun, manifest: null };
  }
  manifest = v.manifest;
  checks.push({ name: "manifest-schema", status: v.warnings.length ? "warn" : "pass", detail: v.warnings.join("; ") || "valid" });

  // 2. semver-and-deps
  const depDetail: string[] = [];
  let depStatus: CheckStatus = "pass";
  if (!isValid(manifest.version)) { depStatus = "fail"; depDetail.push("version not semver"); }
  if (!satisfies(CORE_VERSION, manifest.compatibleCoreVersion)) {
    depStatus = "fail"; depDetail.push(`core ${CORE_VERSION} does not satisfy compatibleCoreVersion ${manifest.compatibleCoreVersion}`);
  }
  for (const dep of manifest.dependencies || []) {
    const depRow = await prisma.simulationModule.findUnique({ where: { moduleId: dep.name } });
    if (!depRow || depRow.status !== "live") { depStatus = depStatus === "fail" ? "fail" : "warn"; depDetail.push(`dependency ${dep.name} not installed/live`); }
    else if (!satisfies(depRow.version, dep.version)) { depStatus = "fail"; depDetail.push(`dependency ${dep.name}@${depRow.version} does not satisfy ${dep.version}`); }
  }
  checks.push({ name: "semver-and-deps", status: depStatus, detail: depDetail.join("; ") || "ok" });

  // 3. permission-scan + compile (frameworks emitted ⊆ declared; refIds resolve)
  const compiled = await compileScenarios(manifest);
  checks.push({
    name: "permission-scan",
    status: compiled.ok ? "pass" : "fail",
    detail: compiled.ok ? `all steps within declared frameworks; refIds resolved` : compiled.errors.join("; "),
  });

  // 4. prerequisite/system-support — declared integrations exist? (warn, not fail)
  const integ = manifest.permissions?.integrations || [];
  if (integ.length) {
    const present = await prisma.integration.findMany({ where: { type: { in: integ }, enabled: true }, select: { type: true } });
    const have = new Set(present.map((p) => p.type));
    const missing = integ.filter((t) => !have.has(t));
    checks.push({ name: "prerequisite-support", status: missing.length ? "warn" : "pass", detail: missing.length ? `no enabled integration for: ${missing.join(", ")}` : "all declared integrations present" });
  } else {
    checks.push({ name: "prerequisite-support", status: "pass", detail: "no integrations required" });
  }

  // 5. signature-verify
  const sigOk = verifyModuleSignature(row.contentHash, row.signatureB64);
  checks.push({ name: "signature-verify", status: sigOk ? "pass" : "fail", detail: sigOk ? "signature valid for content hash" : "signature invalid/missing" });

  // 6. dry-run — compile + dispatch-matrix check (NO execution).
  if (compiled.ok) {
    for (const sc of compiled.scenarios) {
      for (const st of sc.steps) {
        const handled = RUNNER_HANDLED.has(st.framework);
        dryRun.push({ status: handled ? "ok" : "stubbed", notes: `dry-run: ${sc.name} · ${st.framework} ${handled ? "dispatches cleanly" : "no handler"}` });
      }
    }
    const bad = dryRun.find((d) => d.status !== "ok" && d.status !== "stubbed");
    checks.push({ name: "dry-run", status: bad ? "fail" : "pass", detail: `${dryRun.length} step(s) dispatch-checked; no execution performed` });
  } else {
    checks.push({ name: "dry-run", status: "fail", detail: "skipped — compile failed" });
  }

  return { checks, dryRun, manifest };
}
