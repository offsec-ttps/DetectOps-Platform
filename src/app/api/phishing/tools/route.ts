/** GET /api/phishing/tools — OSS phishing-framework catalogue (Mode B reference). */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { PHISHING_TOOLS } from "@/lib/phishing/tool-catalog";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: PHISHING_TOOLS });
}
