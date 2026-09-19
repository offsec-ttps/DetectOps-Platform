import { NextResponse } from "next/server";
import { checkForSplunkUpdates } from "@/lib/splunk/sync";

export async function GET() {
  try {
    const result = await checkForSplunkUpdates();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: msg, updateAvailable: false },
      { status: 502 }
    );
  }
}
