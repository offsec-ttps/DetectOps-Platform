/**
 * POST /api/phishing/ai/generate — Mode C: AI-generate a training lure for
 * AUTHORIZED simulation. Body: { scenario, targetPersona, company? }. Every
 * prompt is audit-logged. Output is editable in the UI before use; the campaign
 * still requires approval before launch.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { generateLure } from "@/lib/phishing/generate";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const scenario = String(body.scenario || "").trim();
  if (!scenario) return NextResponse.json({ error: "scenario required" }, { status: 400 });

  const r = await generateLure({ scenario, targetPersona: String(body.targetPersona || "employee"), company: body.company ? String(body.company) : undefined });
  void logEvent({ category: "phishing" as any, action: "phishing.ai.generate", actor: auth.user.email, status: r.ok ? "ok" : "warn", message: `AI lure: "${scenario.slice(0, 60)}" → ${r.ok ? "generated" : r.error}`, details: { scenario, targetPersona: body.targetPersona } });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
