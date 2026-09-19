/**
 * Attack-detection coverage check.
 *
 * After a run completes, the runner asks the user's configured SIEM whether
 * the selected detection logic fired during the run window. The result is
 * persisted on `EnterpriseUseCaseRun.detectionResults` as JSON entries:
 *
 *   { ruleTitle, siemBackend, query, fired:boolean, evidence, queriedAt }
 *
 * Strategy:
 *   1. Locate the first enabled `Integration` row with type="siem".
 *   2. Pick the matching backend (Splunk → "splunk"; Sentinel → "kusto"; …).
 *   3. Convert the rule body (must be Sigma) via `convertSigmaRule()`.
 *   4. Execute the converted query against the SIEM REST API.
 *   5. Set `fired=true` if any results returned within (startedAt..completedAt).
 *
 * Backend coverage in Phase 3:
 *   - splunk → real (synchronous `services/search/jobs/export`)
 *   - kusto / esql / lucene → stubbed with a clear "not implemented" entry
 *
 * Returns { results: DetectionCoverageResult[], outcome }.
 */

import { prisma } from "@/lib/prisma";
import { convertSigmaRule } from "@/lib/community-sources/sigma-cli";

export type CoverageOutcome = "matched" | "partial" | "missed" | "error" | "n/a";

export interface DetectionCoverageResult {
  ruleTitle: string;
  siemBackend: string;
  integrationName: string;
  query: string;
  fired: boolean;
  evidence: string;
  queriedAt: string;
  error?: string;
}

export interface ValidateCoverageInput {
  detectionLogic: string;
  format: string;                                // sigma | spl | kql | …
  ruleTitle: string;
  windowStart: Date;
  windowEnd: Date;
}

function inferRuleTitle(body: string, fallback: string): string {
  const m = body.match(/^title\s*:\s*(.+)$/im);
  return (m?.[1].trim() || fallback).slice(0, 240);
}

const VENDOR_TO_BACKEND: Record<string, "splunk" | "kusto" | "esql" | "lucene"> = {
  splunk: "splunk",
  sentinel: "kusto",
  "microsoft-sentinel": "kusto",
  defender: "kusto",
  "defender-xdr": "kusto",
  elastic: "esql",
  elasticsearch: "esql",
  opensearch: "lucene",
};

function detectBackend(integ: { name: string; type: string }): "splunk" | "kusto" | "esql" | "lucene" | null {
  const n = (integ.name || "").toLowerCase();
  if (n.includes("splunk")) return "splunk";
  if (n.includes("sentinel") || n.includes("defender")) return "kusto";
  if (n.includes("elastic") || n.includes("kibana")) return "esql";
  if (n.includes("opensearch")) return "lucene";
  return VENDOR_TO_BACKEND[n] || null;
}

export async function validateCoverage(input: ValidateCoverageInput): Promise<{
  results: DetectionCoverageResult[];
  outcome: CoverageOutcome;
}> {
  const integration = await prisma.integration.findFirst({
    where: { type: "siem", enabled: true },
  });
  if (!integration) {
    return {
      results: [],
      outcome: "n/a",
    };
  }
  const backend = detectBackend(integration);
  if (!backend) {
    return {
      results: [{
        ruleTitle: inferRuleTitle(input.detectionLogic, input.ruleTitle),
        siemBackend: integration.type,
        integrationName: integration.name,
        query: "",
        fired: false,
        evidence: "",
        queriedAt: new Date().toISOString(),
        error: `Cannot infer SIEM backend from integration name "${integration.name}".`,
      }],
      outcome: "error",
    };
  }

  const isSigma = input.format === "sigma" || input.format === "yaml";
  if (!isSigma) {
    return {
      results: [{
        ruleTitle: inferRuleTitle(input.detectionLogic, input.ruleTitle),
        siemBackend: backend,
        integrationName: integration.name,
        query: "",
        fired: false,
        evidence: "",
        queriedAt: new Date().toISOString(),
        error: `Selected logic is format="${input.format}"; only Sigma can be converted to SIEM dialects. Switch the selected logic to Recommended (Sigma) or paste a Sigma body in Edited.`,
      }],
      outcome: "error",
    };
  }

  const conv = await convertSigmaRule(input.detectionLogic, backend).catch((e) => ({
    success: false, query: "", stderr: "", toolVersion: "",
    error: e?.message || String(e),
  }));
  if (!conv.success || !conv.query) {
    return {
      results: [{
        ruleTitle: inferRuleTitle(input.detectionLogic, input.ruleTitle),
        siemBackend: backend,
        integrationName: integration.name,
        query: "",
        fired: false,
        evidence: "",
        queriedAt: new Date().toISOString(),
        error: `Sigma → ${backend} conversion failed: ${conv.error || conv.stderr || "unknown"}`,
      }],
      outcome: "error",
    };
  }

  // Backend-specific search execution
  if (backend === "splunk") {
    const r = await runSplunkSearch(integration, conv.query, input.windowStart, input.windowEnd);
    const result: DetectionCoverageResult = {
      ruleTitle: inferRuleTitle(input.detectionLogic, input.ruleTitle),
      siemBackend: "splunk",
      integrationName: integration.name,
      query: conv.query,
      fired: r.eventCount > 0,
      evidence: r.eventCount > 0 ? `${r.eventCount} event(s) returned by Splunk` : "0 events in the run window",
      queriedAt: new Date().toISOString(),
      error: r.error,
    };
    return {
      results: [result],
      outcome: r.error ? "error" : r.eventCount > 0 ? "matched" : "missed",
    };
  }

  // Stub other backends with a clear note
  return {
    results: [{
      ruleTitle: inferRuleTitle(input.detectionLogic, input.ruleTitle),
      siemBackend: backend,
      integrationName: integration.name,
      query: conv.query,
      fired: false,
      evidence: "",
      queriedAt: new Date().toISOString(),
      error: `Backend "${backend}" coverage query not implemented in Phase 3. Sigma → ${backend} conversion succeeded; wire the REST call to your ${integration.name} integration to enable.`,
    }],
    outcome: "error",
  };
}

// ─── Splunk runner ──────────────────────────────────────────────────────────

async function runSplunkSearch(
  integ: { apiUrl: string; apiKey: string; name: string },
  spl: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<{ eventCount: number; error?: string }> {
  if (!integ.apiUrl) return { eventCount: 0, error: "Splunk integration apiUrl empty" };
  if (!integ.apiKey) return { eventCount: 0, error: "Splunk integration apiKey empty" };
  const earliest = Math.floor(windowStart.getTime() / 1000);
  const latest = Math.floor(windowEnd.getTime() / 1000) + 1;
  const search = spl.trim().startsWith("search ") ? spl : `search ${spl}`;
  const url = `${integ.apiUrl.replace(/\/$/, "")}/services/search/jobs/export`;

  try {
    const body = new URLSearchParams({
      search,
      output_mode: "json",
      earliest_time: String(earliest),
      latest_time: String(latest),
      preview: "false",
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${integ.apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { eventCount: 0, error: `Splunk HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const text = await res.text();
    // Each line in export is one JSON object — count them
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    return { eventCount: lines.length };
  } catch (err: any) {
    return { eventCount: 0, error: `Splunk request failed: ${err?.message || err}` };
  }
}
