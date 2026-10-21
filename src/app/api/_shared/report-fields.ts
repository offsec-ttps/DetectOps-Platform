/**
 * Whitelist of client-editable DetectionReport fields. The create/update routes
 * used to spread the request body straight into Prisma, letting a caller set
 * id / timestamps / GitHub push metadata (githubIssueUrl, githubPushedAt, ...)
 * or pass nested relation writes. Only these plain columns are accepted.
 */
const STRING_FIELDS = [
  "name", "description", "severity", "status", "assignee", "platform", "maturityLevel",
  "criticality", "phase", "procedureCoverage", "deviceGroup", "deviceCoverage", "falsePositive",
  "detectionQuery", "observations", "reasonsForFailure", "recommendations",
] as const;
const BOOL_FIELDS = [
  "definedAndWorking", "needsImprovement", "validateDeviceCov", "validateQuerySyntax",
  "checkNewUcRecommend", "checkFalsePositives", "procedureCovCheck", "observationsCheck",
  "failureReasonCheck", "recommendCheck", "prDetailedAnalysis",
] as const;

const MAX_FIELD = 100_000;
export const MAX_SIMULATIONS = 500;

export function pickReportFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of STRING_FIELDS) {
    if (body[k] !== undefined && body[k] !== null) out[k] = String(body[k]).slice(0, MAX_FIELD);
  }
  for (const k of BOOL_FIELDS) {
    if (body[k] !== undefined) out[k] = body[k] === true || body[k] === "true";
  }
  return out;
}

export function pickSimulations(sims: unknown): Array<{ description: string; output: string; order: number }> {
  if (!Array.isArray(sims)) return [];
  return sims.slice(0, MAX_SIMULATIONS).map((s: any, i: number) => ({
    description: String(s?.description || "").slice(0, MAX_FIELD),
    output: String(s?.output || "").slice(0, MAX_FIELD),
    order: Number.isFinite(Number(s?.order)) ? Number(s.order) : i,
  }));
}

export function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
