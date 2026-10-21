/**
 * POST /api/purplesharp-templates/sync   — pull PurpleTeamPlaybook templates
 * from GitHub and persist. Idempotent via content hash.
 */

import { NextResponse } from "next/server";
import { syncPurpleSharpTemplates } from "@/lib/use-cases/sync/purplesharp-templates";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";
import { requireRole } from "@/lib/auth-guard";

export async function POST() {
  // Internet-fetching / bulk-rewriting maintenance op: admin only (dev: open).
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const t0 = Date.now();
  const sessionUser = await getSessionUser().catch(() => null);
  try {
    const result = await syncPurpleSharpTemplates();
    void logEvent({
      category: "usecase", action: "purplesharp.templates.sync",
      actor: sessionUser?.email || "system",
      status: result.errors.length ? "warn" : "ok",
      durationMs: Date.now() - t0,
      message: `${result.upserted} upserted / ${result.unchanged} unchanged / ${result.errors.length} error(s) (${result.candidatesFound} candidates)`,
      details: {
        treeEntries: result.treeEntries,
        candidatesFound: result.candidatesFound,
        upserted: result.upserted,
        unchanged: result.unchanged,
        errorCount: result.errors.length,
      },
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const msg = err?.message || String(err);
    void logEvent({
      category: "usecase", action: "purplesharp.templates.sync",
      actor: sessionUser?.email || "system", status: "error",
      durationMs: Date.now() - t0,
      message: msg, errorMessage: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
