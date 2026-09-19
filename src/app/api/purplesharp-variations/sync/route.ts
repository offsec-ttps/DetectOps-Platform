/**
 * POST /api/purplesharp-variations/sync   — idempotent seed from the static
 * JSON parsed from upstream PurpleSharp Program.cs.
 */

import { NextResponse } from "next/server";
import { seedPurpleSharpVariations } from "@/lib/use-cases/sync/purplesharp-variations";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

export async function POST() {
  const t0 = Date.now();
  const sessionUser = await getSessionUser().catch(() => null);
  try {
    const result = await seedPurpleSharpVariations();
    void logEvent({
      category: "usecase", action: "purplesharp.variations.sync",
      actor: sessionUser?.email || "system",
      status: result.errors.length ? "warn" : "ok",
      durationMs: Date.now() - t0,
      message: `${result.upsertedCount}/${result.variationsTotal} variations across ${result.techniques} techniques`,
      details: { ...result, errorCount: result.errors.length },
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const msg = err?.message || String(err);
    void logEvent({
      category: "usecase", action: "purplesharp.variations.sync",
      actor: sessionUser?.email || "system", status: "error",
      durationMs: Date.now() - t0,
      message: msg, errorMessage: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
