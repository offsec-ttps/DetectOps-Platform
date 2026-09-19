/**
 * POST /api/stratus-attacks/sync   — parse + upsert every Stratus attack
 * technique from DataDog/stratus-red-team. Idempotent.
 */

import { NextResponse } from "next/server";
import { syncStratusAttacks } from "@/lib/use-cases/sync/stratus-attacks";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

export async function POST() {
  const t0 = Date.now();
  const sessionUser = await getSessionUser().catch(() => null);
  try {
    const r = await syncStratusAttacks();
    void logEvent({
      category: "usecase", action: "stratus.attacks.sync",
      actor: sessionUser?.email || "system",
      status: r.errors.length ? "warn" : "ok",
      durationMs: Date.now() - t0,
      message: `${r.upserted} upserted / ${r.unchanged} unchanged / ${r.errors.length} error(s) (${r.parsed}/${r.totalGoFiles} parsed)`,
      details: { ...r, errorCount: r.errors.length },
    });
    return NextResponse.json(r);
  } catch (err: any) {
    const msg = err?.message || String(err);
    void logEvent({
      category: "usecase", action: "stratus.attacks.sync",
      actor: sessionUser?.email || "system", status: "error",
      durationMs: Date.now() - t0,
      message: msg, errorMessage: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
