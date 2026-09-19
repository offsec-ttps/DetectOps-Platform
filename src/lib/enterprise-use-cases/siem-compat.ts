/**
 * SIEM-compat matrix for a use case's selected detection logic.
 *
 * Wraps `convertSigmaRule()` from the existing community-sources sigma-cli
 * helper. Calls each target backend in parallel; results are content-hashed
 * so re-validation is a no-op when the body hasn't changed.
 *
 * Outputs JSON shape:
 *   {
 *     hash: "<sha256 of body>",
 *     generatedAt: ISO,
 *     toolVersion: "...",
 *     installed: bool,
 *     matrix: { splunk: "ok"|"warn"|"fail"|"skip", sentinel: …, esql: …, lucene: … },
 *     details: { splunk: {query, stderr, error}, ... }
 *   }
 *
 * "skip" is used when the input format isn't Sigma — we don't (yet) attempt
 * to convert SPL → Sentinel etc. Phase 2's `recommend-logic.ts` will
 * canonicalise non-Sigma bodies into Sigma so the matrix can fill in.
 */

import { createHash } from "node:crypto";
import { convertSigmaRule, detectSigmaCli } from "@/lib/community-sources/sigma-cli";

export type CompatVerdict = "ok" | "warn" | "fail" | "skip";

export interface SiemCompatBackend {
  backend: string;            // e.g. "splunk" | "kusto" | "esql" | "lucene"
  label: string;              // user-facing
}

export const SIEM_BACKENDS: SiemCompatBackend[] = [
  { backend: "splunk", label: "Splunk SPL" },
  { backend: "kusto",  label: "Microsoft Sentinel KQL" },
  { backend: "esql",   label: "Elastic ES|QL" },
  { backend: "lucene", label: "Elastic Lucene" },
];

export interface SiemCompatResult {
  hash: string;
  generatedAt: string;
  toolVersion: string;
  installed: boolean;
  matrix: Record<string, CompatVerdict>;
  details: Record<string, { query?: string; stderr?: string; error?: string }>;
}

function hashBody(body: string): string {
  return createHash("sha256").update(body || "").digest("hex").slice(0, 16);
}

const EMPTY_MATRIX: Record<string, CompatVerdict> = Object.fromEntries(
  SIEM_BACKENDS.map((b) => [b.backend, "skip"]),
);

/**
 * Compute the SIEM-compat matrix for the given detection logic.
 *
 * `format` selects strategy:
 *   - "sigma" / "yaml": convert each backend; "ok" when conversion succeeds
 *   - anything else:    return an all-"skip" matrix (Phase 2 canonicalises
 *                       these into Sigma first)
 */
export async function computeSiemCompat(
  detectionLogic: string,
  format: string,
): Promise<SiemCompatResult> {
  const hash = hashBody(detectionLogic);
  const generatedAt = new Date().toISOString();
  const cliInfo = await detectSigmaCli().catch(() => ({ found: false, version: "" } as any));
  const installed = !!cliInfo?.found;

  if (!installed) {
    return {
      hash, generatedAt, toolVersion: "",
      installed: false,
      matrix: { ...EMPTY_MATRIX },
      details: { _global: { error: "Sigma CLI not installed — install to populate the SIEM matrix" } },
    };
  }

  const isSigma = format === "sigma" || format === "yaml";
  if (!isSigma || !detectionLogic.trim()) {
    return {
      hash, generatedAt, toolVersion: cliInfo.version || "",
      installed: true,
      matrix: { ...EMPTY_MATRIX },
      details: {},
    };
  }

  // Run conversions in parallel
  const results = await Promise.allSettled(
    SIEM_BACKENDS.map((b) => convertSigmaRule(detectionLogic, b.backend))
  );

  const matrix: Record<string, CompatVerdict> = {};
  const details: Record<string, { query?: string; stderr?: string; error?: string }> = {};
  let toolVersion = "";

  for (let i = 0; i < SIEM_BACKENDS.length; i++) {
    const backend = SIEM_BACKENDS[i].backend;
    const r = results[i];
    if (r.status === "rejected") {
      matrix[backend] = "fail";
      details[backend] = { error: r.reason?.message || String(r.reason) };
      continue;
    }
    const v = r.value;
    toolVersion = toolVersion || v.toolVersion;
    if (v.success) {
      // Even on success the stderr may contain pipeline warnings; treat presence as "warn"
      matrix[backend] = (v.stderr || "").trim() ? "warn" : "ok";
      details[backend] = { query: (v.query || "").slice(0, 4000), stderr: v.stderr?.slice(0, 1000) };
    } else {
      matrix[backend] = "fail";
      details[backend] = { stderr: v.stderr?.slice(0, 1000), error: v.error?.slice(0, 1000) };
    }
  }

  return { hash, generatedAt, toolVersion, installed, matrix, details };
}

/**
 * Decide if a cached compat result is still valid for the current body.
 */
export function isCompatCacheFresh(cached: SiemCompatResult | null, detectionLogic: string): boolean {
  if (!cached || !cached.hash) return false;
  return cached.hash === hashBody(detectionLogic);
}
