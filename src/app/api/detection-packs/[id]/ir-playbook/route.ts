/**
 * PATCH /api/detection-packs/[id]/ir-playbook
 *
 * Replace the IR playbook attached to a pack. Body shape mirrors the
 * IrPlaybook model — tiers (l1Steps/l2Steps/l3Steps) and cross-tier
 * checklists (containment/eradication/recovery) each hold a JSON array of:
 *
 *   { order:int, title:string, action:string, expectedFinding:string,
 *     escalateIf?:string, references?:string[] }
 *
 * Missing tiers are left untouched (so the UI can save one tab at a time).
 * `summary` is optional — pass null to clear.
 *
 * When no IRP row exists for the pack, one is created via upsert.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const TIER_KEYS = ["l1Steps", "l2Steps", "l3Steps", "containment", "eradication", "recovery"] as const;

interface RawStep {
  order?: unknown;
  title?: unknown;
  action?: unknown;
  expectedFinding?: unknown;
  escalateIf?: unknown;
  references?: unknown;
}

function clampStr(v: unknown, max: number): string {
  return String(v ?? "").slice(0, max);
}

function normaliseStep(raw: RawStep, fallbackOrder: number) {
  return {
    order: typeof raw.order === "number" && Number.isFinite(raw.order) ? Math.max(1, Math.min(50, Math.round(raw.order))) : fallbackOrder,
    title: clampStr(raw.title, 240),
    action: clampStr(raw.action, 4000),
    expectedFinding: clampStr(raw.expectedFinding, 2000),
    escalateIf: clampStr(raw.escalateIf, 2000),
    references: Array.isArray(raw.references) ? raw.references.map((r) => clampStr(r, 500)).filter(Boolean).slice(0, 10) : [],
  };
}

function normaliseTier(arr: unknown): unknown[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 30).map((step, i) => normaliseStep(step as RawStep, i + 1));
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const pack = await prisma.detectionPack.findUnique({ where: { id }, select: { id: true } });
  if (!pack) return NextResponse.json({ error: "pack not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  for (const k of TIER_KEYS) {
    if (k in body) {
      data[k] = JSON.stringify(normaliseTier(body[k]));
    }
  }
  if ("summary" in body) {
    data.summary = clampStr(body.summary, 4000);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no IRP fields supplied" }, { status: 400 });
  }

  const existing = await prisma.irPlaybook.findUnique({ where: { packId: id }, select: { id: true } });
  let updatedTiers: string[];
  if (existing) {
    await prisma.irPlaybook.update({ where: { packId: id }, data: data as any });
    updatedTiers = Object.keys(data);
  } else {
    // Backfill with empty arrays where the caller didn't pass one
    const seed: Record<string, unknown> = {
      packId: id,
      summary: "",
      l1Steps: "[]", l2Steps: "[]", l3Steps: "[]",
      containment: "[]", eradication: "[]", recovery: "[]",
    };
    await prisma.irPlaybook.create({ data: { ...seed, ...data } as any });
    updatedTiers = Object.keys(data);
  }
  // Bump pack.updatedAt so the list view's "last touched" reflects the edit
  await prisma.detectionPack.update({ where: { id }, data: { updatedAt: new Date() } });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "detection-pack",
    action: "detection-pack.irp.update",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "DetectionPack", targetId: id,
    message: `IRP updated: ${updatedTiers.join(", ")}`,
    details: { packId: id, updatedTiers },
  });

  return NextResponse.json({ ok: true, updatedTiers });
}
