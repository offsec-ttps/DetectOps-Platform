/**
 * Deterministic validator for Enterprise Use Cases.
 *
 * Runs six mandatory checks against a use case (or a freshly-parsed row) and
 * aggregates the per-check results into a single verdict:
 *
 *   green   — every check passed
 *   yellow  — at least one warning (non-blocking)
 *   red     — any mandatory check failed
 *
 * The per-check results are persisted as `validationDetails` JSON so the UI
 * can render the badge with a hover-detail panel.
 */

export type ValidationStatus = "green" | "yellow" | "red" | "pending";

export interface CheckResult {
  ok: boolean;
  severity: "info" | "warn" | "error";          // warn = yellow on its own; error = red
  message: string;
}

export interface ValidationDetails {
  checks: Record<string, CheckResult>;
  verdict: ValidationStatus;
}

export interface ValidationSubject {
  name: string;
  description: string;
  detectionLogic: string;
  severity: string;
  platforms: string[];
  mitreTechniques: string[];
}

const SEVERITY_ENUM = new Set(["info", "low", "medium", "high", "critical"]);

const TECH_RE = /^T\d{4}(?:\.\d{3})?$/;

function check(ok: boolean, severity: "info" | "warn" | "error", message: string): CheckResult {
  return { ok, severity, message };
}

function aggregate(checks: Record<string, CheckResult>): ValidationStatus {
  const vals = Object.values(checks);
  if (vals.some((c) => !c.ok && c.severity === "error")) return "red";
  if (vals.some((c) => !c.ok && c.severity === "warn")) return "yellow";
  return "green";
}

export function validateUseCase(subj: ValidationSubject): ValidationDetails {
  const checks: Record<string, CheckResult> = {};

  // 1. Name (mandatory)
  checks.name = subj.name.trim().length >= 6
    ? check(true, "info", "name OK")
    : check(false, "error", `name must be ≥ 6 chars (got ${subj.name.trim().length})`);

  // 2. Description (mandatory)
  checks.description = subj.description.trim().length >= 40
    ? check(true, "info", "description OK")
    : check(false, "error", `description must be ≥ 40 chars (got ${subj.description.trim().length})`);

  // 3. Detection logic (mandatory)
  const dlLen = subj.detectionLogic.trim().length;
  checks.detectionLogic = dlLen >= 20
    ? check(true, "info", `detection logic OK (${dlLen} chars)`)
    : check(false, "error", `detection logic must be ≥ 20 chars (got ${dlLen})`);

  // 4. MITRE technique extractable (warn — not strictly mandatory)
  const validTids = subj.mitreTechniques.filter((t) => TECH_RE.test(t));
  checks.mitre = validTids.length > 0
    ? check(true, "info", `${validTids.length} ATT&CK technique(s) mapped`)
    : check(false, "warn", "no MITRE technique ID found; map at least one for downstream simulation");

  // 5. Severity in enum (warn — defaults safely if missing)
  const sevLc = (subj.severity || "").toLowerCase();
  checks.severity = SEVERITY_ENUM.has(sevLc)
    ? check(true, "info", `severity=${sevLc}`)
    : check(false, "warn", `severity "${subj.severity}" not in info|low|medium|high|critical — defaulted to medium`);

  // 6. At least one platform (warn)
  checks.platforms = subj.platforms.length > 0
    ? check(true, "info", `${subj.platforms.length} platform(s) declared`)
    : check(false, "warn", "no platforms declared; downstream coverage filtering will treat as 'unknown'");

  return { checks, verdict: aggregate(checks) };
}

export function normaliseSeverity(raw: string): string {
  const v = (raw || "").toLowerCase().trim();
  return SEVERITY_ENUM.has(v) ? v : "medium";
}
