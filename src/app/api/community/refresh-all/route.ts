/**
 * POST /api/community/refresh-all
 *
 * Phase 8 — orchestrate a refresh across every enabled community source.
 *
 * This is the endpoint that a scheduled job (cron, CI, k8s job, anything
 * that can hit an HTTPS URL) calls to keep the catalog current. It is also
 * exposed in the UI for manual "refresh everything" actions.
 *
 * Behavior:
 *   - Runs adapters with bounded concurrency (default 2) so we don't burn
 *     GitHub rate limits all at once.
 *   - Skips legacy adapters by default since they have their own dedicated
 *     sync routes; opt in with `?includeLegacy=true`.
 *   - Always returns per-source results (success/failure + counts), never
 *     short-circuits on a single failure.
 *   - Invalidates the in-process community cache after each successful sync.
 *   - Writes a WorkspaceAudit row for the orchestration as a whole.
 *
 * Body (optional):
 *   {
 *     sources?: string[]   // restrict to these adapter ids
 *     concurrency?: number // default 2
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAllAdapters } from "@/lib/community-sources/registry";
import { invalidateCache } from "@/lib/community-sources/cache";
import { logWorkspaceAudit } from "@/lib/rule-workspace/audit";
import { requireRole } from "@/lib/auth-guard";

export const maxDuration = 600;

interface PerSourceResult {
  id: string;
  name: string;
  ok: boolean;
  newCount?: number;
  modifiedCount?: number;
  deletedCount?: number;
  totalAfterSync?: number;
  errors?: { file?: string; message: string }[];
  errorMessage?: string;
  durationMs: number;
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(concurrency, items.length || 1)).fill(0).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function POST(req: NextRequest) {
  // Internet-fetching / bulk-rewriting maintenance op: admin only (dev: open).
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const includeLegacy = sp.get("includeLegacy") === "true";

  const body = await req.json().catch(() => ({}));
  const restrictTo: string[] | undefined = Array.isArray(body.sources) ? body.sources : undefined;
  const concurrency: number = Math.max(1, Math.min(6, Number(body.concurrency) || 2));

  const adapters = await getAllAdapters();
  const targets = adapters.filter((a) => {
    const meta = a.meta();
    if (restrictTo && !restrictTo.includes(meta.id)) return false;
    if (!includeLegacy && meta.legacy) return false;
    return true;
  });

  const startedAt = Date.now();
  const results = await runWithConcurrency<typeof targets[number], PerSourceResult>(
    targets,
    async (adapter) => {
      const meta = adapter.meta();
      const t0 = Date.now();
      try {
        const r = await adapter.sync();
        invalidateCache("community:");
        return {
          id: meta.id,
          name: meta.name,
          ok: true,
          newCount: r.newCount,
          modifiedCount: r.modifiedCount,
          deletedCount: r.deletedCount,
          totalAfterSync: r.totalAfterSync,
          errors: r.errors,
          durationMs: Date.now() - t0,
        };
      } catch (e: any) {
        return {
          id: meta.id,
          name: meta.name,
          ok: false,
          errorMessage: e?.message || String(e),
          durationMs: Date.now() - t0,
        };
      }
    },
    concurrency,
  );

  const totalDurationMs = Date.now() - startedAt;
  const summary = {
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    totalDurationMs,
  };

  await logWorkspaceAudit({
    action: "source.refresh",
    targetType: "source",
    details: { summary, ids: targets.map((t) => t.meta().id), includeLegacy, concurrency },
    success: summary.failed === 0,
    errorMessage: summary.failed > 0 ? `${summary.failed} source(s) failed` : undefined,
  });

  return NextResponse.json({ summary, results });
}
