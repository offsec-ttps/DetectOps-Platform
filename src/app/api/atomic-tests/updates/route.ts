import { NextResponse } from "next/server";
import { checkForUpdates } from "@/lib/atomic-red-team/sync";

export async function GET() {
  try {
    const result = await checkForUpdates();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: msg, updateAvailable: false },
      { status: 502 }
    );
  }
}
