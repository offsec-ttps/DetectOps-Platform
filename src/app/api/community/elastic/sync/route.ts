import { NextResponse } from "next/server";
import { syncElasticRules } from "@/lib/elastic/sync";
import { requireRole } from "@/lib/auth-guard";

export async function POST() {
  // Internet-fetching / bulk-rewriting maintenance op: admin only (dev: open).
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  try {
    const result = await syncElasticRules();
    return NextResponse.json({
      status: "completed",
      newCount: result.newCount,
      modifiedCount: result.modifiedCount,
      deletedCount: result.deletedCount,
      totalAfterSync: result.totalAfterSync,
      errors: result.errors.length > 0 ? result.errors.slice(0, 20) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "failed", error: message },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
