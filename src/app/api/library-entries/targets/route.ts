/** GET /api/library-entries/targets — every library an analyst can add techniques to. */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { listTargets } from "@/lib/library-entries/store";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ targets: await listTargets() });
}
