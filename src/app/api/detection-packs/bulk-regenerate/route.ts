/**
 * POST /api/detection-packs/bulk-regenerate
 *
 * Body: {
 *   filter: {
 *     category?: string,
 *     severity?: string,
 *     status?: string,
 *     ageBefore?: string (ISO timestamp; packs whose updatedAt is older)
 *   },
 *   provider?: ProviderId,
 *   irpProvider?: ProviderId,
 *   packModel?: string,
 *   irpModel?: string,
 *   limit?: number,                  // hard cap; default 50, max 200
 *   dryRun?: boolean
 * }
 *
 * Returns: {
 *   matched: number,
 *   processed: number,
 *   succeeded: Array<{packId, newPackId, costUsd}>,
 *   failed:    Array<{packId, error}>,
 *   skipped:   Array<{packId, reason}>,
 *   dryRunMatches?: string[]
 * }
 *
 * Concurrency 2. Calls the generator directly (not the auto-pipeline queue)
 * since regen is admin-triggered. New packs land with a `-vN` slug so the
 * old GitHub issues stay linked to the original pack.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDetectionPack, DetectionPackError } from "@/lib/detection-packs/generator";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";
import { requireRole } from "@/lib/auth-guard";
import type { ProviderId } from "@/lib/llm";

const VALID_PROVIDERS = new Set<ProviderId>(["anthropic", "openai", "openrouter", "nvidia", "ollama"]);

interface BulkResult {
  matched: number;
  processed: number;
  succeeded: Array<{ originalPackId: string; newPackId: string; costUsd: number }>;
  failed:    Array<{ packId: string; error: string }>;
  skipped:   Array<{ packId: string; reason: string }>;
  dryRunMatches?: string[];
}

async function processOne(p: { id: string; sourceType: string; sourceTable: string; sourceRefId: string }, opts: {
  provider?: ProviderId; irpProvider?: ProviderId; packModel?: string; irpModel?: string; actor: string;
}): Promise<{ originalPackId: string; newPackId?: string; costUsd?: number; error?: string }> {
  try {
    const r = await generateDetectionPack({
      sourceType: p.sourceType as "ti" | "rule",
      sourceTable: p.sourceTable,
      sourceRefId: p.sourceRefId,
      provider: opts.provider,
      irpProvider: opts.irpProvider,
      packModel: opts.packModel,
      irpModel: opts.irpModel,
      actor: opts.actor,
    });
    return { originalPackId: p.id, newPackId: r.packId, costUsd: r.totalCostUsd };
  } catch (err) {
    const msg = err instanceof DetectionPackError ? `[${err.code}] ${err.message}` : (err as Error).message || String(err);
    return { originalPackId: p.id, error: msg };
  }
}

export async function POST(req: NextRequest) {
  // Bulk regeneration is expensive + platform-wide → admin-gated when enforcing.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const filter = body.filter || {};
  const provider = typeof body.provider === "string" ? body.provider as ProviderId : undefined;
  const irpProvider = typeof body.irpProvider === "string" ? body.irpProvider as ProviderId : undefined;
  const packModel = typeof body.packModel === "string" ? body.packModel : undefined;
  const irpModel = typeof body.irpModel === "string" ? body.irpModel : undefined;
  const limit = Math.min(200, Math.max(1, parseInt(String(body.limit || "50"), 10) || 50));
  const dryRun = !!body.dryRun;

  if (provider && !VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: `provider must be one of ${[...VALID_PROVIDERS].join("|")}` }, { status: 400 });
  }
  if (irpProvider && !VALID_PROVIDERS.has(irpProvider)) {
    return NextResponse.json({ error: `irpProvider must be one of ${[...VALID_PROVIDERS].join("|")}` }, { status: 400 });
  }

  const where: Record<string, unknown> = { status: { not: "deprecated" } };
  if (filter.category && typeof filter.category === "string") where.category = filter.category;
  if (filter.severity && typeof filter.severity === "string") where.severity = filter.severity;
  if (filter.status   && typeof filter.status   === "string") where.status   = filter.status;
  if (filter.ageBefore && typeof filter.ageBefore === "string") {
    const d = new Date(filter.ageBefore);
    if (!isNaN(d.getTime())) where.updatedAt = { lt: d };
  }

  const matches = await prisma.detectionPack.findMany({
    where: where as any,
    select: { id: true, sourceType: true, sourceTable: true, sourceRefId: true },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  if (dryRun) {
    return NextResponse.json<BulkResult>({
      matched: matches.length,
      processed: 0,
      succeeded: [],
      failed: [],
      skipped: [],
      dryRunMatches: matches.map((m) => m.id),
    });
  }

  const sessionUser = await getSessionUser().catch(() => null);
  const actor = sessionUser?.email || "anonymous";

  void logEvent({
    category: "detection-pack",
    action: "detection-pack.bulk-regenerate.start",
    actor, status: "info",
    message: `${matches.length} matched · provider=${provider || "default"} · limit=${limit}`,
    details: { filter, provider, irpProvider, packModel, irpModel, limit, matched: matches.length },
  });

  // Concurrency 2 — same cap as the auto-pipeline tick so we never blow past
  // global rate limits even when multiple regens run.
  const CONC = 2;
  const result: BulkResult = { matched: matches.length, processed: 0, succeeded: [], failed: [], skipped: [] };

  let cursor = 0;
  async function worker() {
    while (cursor < matches.length) {
      const idx = cursor++;
      const p = matches[idx];
      const r = await processOne(p, { provider, irpProvider, packModel, irpModel, actor });
      result.processed++;
      if (r.newPackId) result.succeeded.push({ originalPackId: p.id, newPackId: r.newPackId, costUsd: r.costUsd ?? 0 });
      else result.failed.push({ packId: p.id, error: r.error || "unknown" });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, matches.length) }, () => worker()));

  void logEvent({
    category: "detection-pack",
    action: "detection-pack.bulk-regenerate.done",
    actor, status: "ok",
    message: `processed=${result.processed} ok=${result.succeeded.length} fail=${result.failed.length}`,
    details: {
      processed: result.processed,
      succeeded: result.succeeded.length,
      failed: result.failed.length,
      totalCostUsd: result.succeeded.reduce((sum, x) => sum + (x.costUsd || 0), 0),
    },
  });

  return NextResponse.json(result);
}
