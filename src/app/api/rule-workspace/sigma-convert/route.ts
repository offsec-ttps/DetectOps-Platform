/**
 * GET  /api/rule-workspace/sigma-convert     — get available backends + Sigma CLI info
 * POST /api/rule-workspace/sigma-convert     — convert a Sigma YAML to a target backend
 *   body: { yaml: string, target: string, format?: string, sourceRuleId?: string, sourceTable?: string }
 *
 * Every conversion attempt is persisted to SigmaConversion for audit/history.
 * Original Sigma rules are never mutated.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { detectSigmaCli, listBackends, convertSigmaRule } from "@/lib/community-sources/sigma-cli";
import { flags } from "@/lib/community-sources/flags";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  if (!flags.sigmaConversion) {
    return NextResponse.json({ enabled: false });
  }
  const info = await detectSigmaCli();
  const backends = info.found ? await listBackends() : { found: false, backends: [], raw: "" };
  return NextResponse.json({
    enabled: true,
    sigmaCli: {
      found: info.found,
      version: info.version,
      binary: info.binary || null,
      installHint: info.found ? null : info.installHint,
      searchedPaths: info.searchedPaths,
    },
    backends: backends.backends,
    backendsRaw: info.found ? backends.raw : null,
  });
}

export async function POST(req: NextRequest) {
  if (!flags.sigmaConversion) {
    return NextResponse.json({ error: "Sigma conversion is disabled" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { yaml, target, format, pipeline, sourceRuleId, sourceTable } = body as {
    yaml?: string; target?: string; format?: string; pipeline?: string;
    sourceRuleId?: string; sourceTable?: string;
  };

  if (!yaml || typeof yaml !== "string" || yaml.trim().length === 0) {
    return NextResponse.json({ error: "yaml is required" }, { status: 400 });
  }
  if (!target || typeof target !== "string") {
    return NextResponse.json({ error: "target backend is required" }, { status: 400 });
  }

  const t0 = Date.now();
  const result = await convertSigmaRule(yaml, target, format, pipeline);
  const durationMs = Date.now() - t0;

  const user = await getSessionUser().catch(() => null);
  void logEvent({
    category: "sigma",
    action: "sigma.convert",
    actor: user?.email || "anonymous",
    status: result.success ? "ok" : "error",
    targetType: "backend",
    targetId: target,
    durationMs,
    message: result.success
      ? `${target} ← ${yaml.length}B → ${result.query.length}B query`
      : `${target} failed`,
    details: {
      target,
      format: format || "default",
      inputBytes: yaml.length,
      outputBytes: result.query.length,
      toolVersion: result.toolVersion,
      sourceRuleId: sourceRuleId || null,
    },
    errorMessage: result.error || null,
  });

  // Persist conversion attempt (success OR failure) for audit trail
  try {
    await prisma.sigmaConversion.create({
      data: {
        sourceRuleId: sourceRuleId || null,
        sourceTable: sourceTable || "community_sigma_rules",
        inputYaml: yaml,
        targetBackend: target,
        outputFormat: format || "default",
        outputQuery: result.query || "",
        success: result.success,
        errorMessage: result.error || null,
        stderr: result.stderr || "",
        toolVersion: result.toolVersion || "",
      },
    });
  } catch { /* persistence is best-effort, don't fail the request */ }

  if (!result.success) {
    return NextResponse.json({
      success: false,
      error: result.error,
      installHint: result.installHint,
      stderr: result.stderr,
    }, { status: result.installHint ? 503 : 400 });
  }

  return NextResponse.json({
    success: true,
    query: result.query,
    target,
    format: format || "default",
    pipeline: result.pipeline || null,
    toolVersion: result.toolVersion,
  });
}
