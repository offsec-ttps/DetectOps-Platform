/**
 * POST /api/use-cases/ai/from-rule
 *
 * Body: { sourceTable, ruleId, frameworks?, model? }
 *   sourceTable: "CommunityRule" | "CommunitySigmaRule" | "CommunityElasticRule" | "SplunkDetection" | "CustomDetection"
 *
 * Returns: { useCaseId, atomicGenerationId?, purplesharpGenerationId?,
 *            totalCostUsd, totalTokens }
 */

import { NextRequest, NextResponse } from "next/server";
import { generateFromRule } from "@/lib/llm/generators/rule-to-playbook";
import { getSessionUser } from "@/lib/auth";
import { SUPPORTED_RULE_SOURCES, type RuleSourceTable } from "@/lib/use-cases/parsers";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sourceTable = String(body.sourceTable || "") as RuleSourceTable;
  const ruleId = String(body.ruleId || "");

  if (!sourceTable || !SUPPORTED_RULE_SOURCES.includes(sourceTable)) {
    return NextResponse.json({
      error: `sourceTable must be one of ${SUPPORTED_RULE_SOURCES.join(", ")}`,
    }, { status: 400 });
  }
  if (!ruleId) {
    return NextResponse.json({ error: "ruleId is required" }, { status: 400 });
  }

  const frameworks = Array.isArray(body.frameworks)
    ? body.frameworks.filter((f: unknown): f is "atomic" | "purplesharp" =>
        f === "atomic" || f === "purplesharp")
    : undefined;
  const model = typeof body.model === "string" ? body.model : undefined;

  const sessionUser = await getSessionUser().catch(() => null);

  try {
    const result = await generateFromRule({
      actor: sessionUser?.email || "anonymous",
      sourceTable,
      ruleId,
      frameworks,
      model,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err?.status || (err?.code === "missing_api_key" ? 503 : 500);
    return NextResponse.json({ error: err?.message || String(err), code: err?.code || null }, { status });
  }
}
