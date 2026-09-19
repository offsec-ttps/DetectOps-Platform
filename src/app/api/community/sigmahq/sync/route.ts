import { NextResponse } from "next/server";
import { syncSigmaHQ } from "@/lib/sigmahq/sync";

export async function POST() {
  try {
    const result = await syncSigmaHQ();
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
