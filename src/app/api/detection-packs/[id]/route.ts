/**
 * GET    /api/detection-packs/[id] — full pack + rules + IRP + simulations
 * PATCH  /api/detection-packs/[id] — update mutable metadata
 * DELETE /api/detection-packs/[id] — soft-archive (status="deprecated")
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const PATCHABLE = new Set(["name", "description", "severity", "riskScore", "category", "platforms", "dataSources", "references", "status", "mitreTechniques", "mitreTactics"]);

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pack = await prisma.detectionPack.findUnique({
    where: { id },
    include: {
      rules: { orderBy: { createdAt: "asc" } },
      simulations: { orderBy: { createdAt: "asc" } },
      irPlaybook: true,
    },
  });
  if (!pack) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rules = pack.rules.map((r) => ({
    ...r,
    falsePositives: safeJson<string[]>(r.falsePositives, []),
  }));
  const irp = pack.irPlaybook ? {
    summary: pack.irPlaybook.summary,
    l1Steps: safeJson<unknown[]>(pack.irPlaybook.l1Steps, []),
    l2Steps: safeJson<unknown[]>(pack.irPlaybook.l2Steps, []),
    l3Steps: safeJson<unknown[]>(pack.irPlaybook.l3Steps, []),
    containment: safeJson<unknown[]>(pack.irPlaybook.containment, []),
    eradication: safeJson<unknown[]>(pack.irPlaybook.eradication, []),
    recovery: safeJson<unknown[]>(pack.irPlaybook.recovery, []),
  } : null;

  return NextResponse.json({
    id: pack.id,
    name: pack.name,
    slug: pack.slug,
    description: pack.description,
    severity: pack.severity,
    riskScore: pack.riskScore,
    category: pack.category,
    platforms: safeJson<string[]>(pack.platforms, []),
    dataSources: safeJson<string[]>(pack.dataSources, []),
    mitreTechniques: safeJson<string[]>(pack.mitreTechniques, []),
    mitreTactics: safeJson<string[]>(pack.mitreTactics, []),
    references: safeJson<unknown[]>(pack.references, []),
    status: pack.status,
    sourceType: pack.sourceType,
    sourceTable: pack.sourceTable,
    sourceRefId: pack.sourceRefId,
    generatorRunId: pack.generatorRunId,
    githubIssueUrl: pack.githubIssueUrl,
    githubIssueNumber: pack.githubIssueNumber,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
    rules,
    simulations: pack.simulations,
    irPlaybook: irp,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    if (k === "platforms" || k === "dataSources" || k === "mitreTechniques" || k === "mitreTactics" || k === "references") {
      data[k] = JSON.stringify(v ?? []);
    } else if (k === "riskScore") {
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      data[k] = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
    } else {
      data[k] = v;
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no patchable fields supplied" }, { status: 400 });
  }
  try {
    const pack = await prisma.detectionPack.update({ where: { id }, data: data as any });
    const sessionUser = await getSessionUser().catch(() => null);
    void logEvent({
      category: "detection-pack", action: "detection-pack.update",
      actor: sessionUser?.email || "anonymous", status: "ok",
      targetType: "DetectionPack", targetId: id,
      message: `Updated ${Object.keys(data).join(", ")}`,
      details: { fields: Object.keys(data) },
    });
    return NextResponse.json({ id: pack.id, updated: Object.keys(data) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await prisma.detectionPack.update({ where: { id }, data: { status: "deprecated" } });
    const sessionUser = await getSessionUser().catch(() => null);
    void logEvent({
      category: "detection-pack", action: "detection-pack.archive",
      actor: sessionUser?.email || "anonymous", status: "ok",
      targetType: "DetectionPack", targetId: id,
      message: "Archived (status=deprecated)",
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
