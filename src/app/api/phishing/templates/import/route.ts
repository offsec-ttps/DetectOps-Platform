/**
 * POST /api/phishing/templates/import — clone the LinkSec email templates into
 * packs/phishing/email-templates + the PhishingTemplate store. Admin-only.
 */

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { importLinkSecEmails } from "@/lib/phishing/import-linksec";

export async function POST() {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  try {
    const r = await importLinkSecEmails();
    void logEvent({ category: "phishing" as any, action: "phishing.templates.import", actor: auth.user.email, status: "ok", message: `LinkSec import: +${r.imported} templates (${r.brands} brands)` });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
