/**
 * GET  /api/phishing/campaigns — list campaigns (session-auth).
 * POST /api/phishing/campaigns — create a campaign (requires consent ack).
 *
 * Campaigns are created in `pending_approval`; an admin must approve before
 * launch. Consent acknowledgement (config.consent=true) is mandatory at creation
 * — the authorized-use guardrail.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

const DEFAULT_TECHNIQUES = ["T1566.001", "T1566.002", "T1566.003", "T1204.001", "T1204.002", "T1598"];
const MODES = new Set(["template", "tool", "ai"]);

function j<T>(s: string, fb: T): T { try { return JSON.parse(s) as T; } catch { return fb; } }

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const rows = await prisma.phishingCampaign.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id, name: r.name, mode: r.mode, status: r.status, techniques: j<string[]>(r.techniques, []),
      approval: j<any>(r.approval, {}), results: j<any>(r.results, {}), runId: r.runId,
      createdAt: r.createdAt, launchedAt: r.launchedAt, completedAt: r.completedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));

  const name = String(body.name || "").trim();
  const mode = MODES.has(body.mode) ? body.mode : "template";
  const config = (body.config && typeof body.config === "object") ? body.config : {};
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (config.consent !== true) return NextResponse.json({ error: "consent acknowledgement required (authorized-use guardrail)" }, { status: 400 });

  // Techniques: from the chosen template / AI output / explicit config, else defaults.
  let techniques: string[] = Array.isArray(config.techniques) ? config.techniques.filter((t: string) => /^T\d{4}(\.\d{3})?$/.test(t)) : [];
  if (techniques.length === 0 && config.templateId) {
    const tpl = await prisma.phishingTemplate.findUnique({ where: { id: String(config.templateId) } });
    if (tpl) techniques = j<string[]>(tpl.techniques, []);
  }
  if (techniques.length === 0) techniques = DEFAULT_TECHNIQUES;

  const row = await prisma.phishingCampaign.create({
    data: {
      name, mode, status: "pending_approval",
      config: JSON.stringify(config), generated: JSON.stringify(body.generated || {}),
      techniques: JSON.stringify(techniques),
      approval: JSON.stringify({ requestedBy: auth.user.email, requestedAt: new Date().toISOString() }),
      ownerId: auth.user.id,
    },
  });
  void logEvent({ category: "phishing" as any, action: "phishing.campaign.create", actor: auth.user.email, status: "ok", targetType: "PhishingCampaign", targetId: row.id, message: `${name} (${mode}) created → pending approval` });
  return NextResponse.json({ ok: true, id: row.id, status: row.status });
}
