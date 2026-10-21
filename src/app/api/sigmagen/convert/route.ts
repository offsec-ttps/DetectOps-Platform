/**
 * POST /api/sigmagen/convert — convert a Sigma rule to a target SIEM dialect.
 *
 * Body: { sigma: string, target: string }
 * Returns: { success, target, backend, query, error?, installHint? }
 *
 * Reuses the platform's pySigma wrapper (convertSigmaRule). Backends not
 * installed degrade gracefully with an install hint instead of crashing.
 */

import { NextRequest, NextResponse } from "next/server";
import { convertSigmaRule } from "@/lib/community-sources/sigma-cli";

// Map UI target → { pySigma backend plugin, optional output format }.
const TARGET_MAP: Record<string, { backend: string; format?: string; label: string }> = {
  splunk:     { backend: "splunk",        label: "Splunk SPL" },
  "elastic-dsl":   { backend: "elasticsearch", format: "dsl_lucene", label: "Elastic Query DSL" },
  "elastic-eql":   { backend: "elasticsearch", format: "eql",        label: "Elastic EQL" },
  kql:        { backend: "kusto",         label: "KQL (Azure Data Explorer)" },
  sentinel:   { backend: "kusto",         format: "default",         label: "Microsoft Sentinel (KQL)" },
  qradar:     { backend: "qradar",        label: "QRadar AQL" },
  chronicle:  { backend: "chronicle",     format: "yara_l",          label: "Chronicle YARA-L" },
  carbonblack:{ backend: "carbonblack",   label: "Carbon Black" },
  loki:       { backend: "loki",          label: "Grafana Loki / LogQL" },
  insightidr: { backend: "insightidr",    label: "Rapid7 InsightIDR" },
};

// Not exported: App Router route files may only export route handlers.
const SUPPORTED_TARGETS = Object.entries(TARGET_MAP).map(([id, v]) => ({ id, label: v.label }));

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sigma = String(body.sigma || "").trim();
  const target = String(body.target || "").trim();

  if (!sigma) return NextResponse.json({ error: "sigma rule body is required" }, { status: 400 });
  if (sigma.length > 256 * 1024) return NextResponse.json({ error: "sigma rule too large (max 256 KB)" }, { status: 413 });
  const mapping = TARGET_MAP[target];
  if (!mapping) {
    return NextResponse.json({ error: `unsupported target. Use one of: ${Object.keys(TARGET_MAP).join(", ")}` }, { status: 400 });
  }

  const res = await convertSigmaRule(sigma, mapping.backend, mapping.format);
  return NextResponse.json({
    success: res.success,
    target,
    label: mapping.label,
    backend: mapping.backend,
    query: res.query,
    toolVersion: res.toolVersion,
    error: res.error || (res.stderr ? res.stderr.slice(0, 1500) : undefined),
    installHint: res.installHint
      ? `${res.installHint} For this target also install: pip install pysigma-backend-${mapping.backend}.`
      : undefined,
  });
}

export async function GET() {
  return NextResponse.json({ targets: SUPPORTED_TARGETS });
}
