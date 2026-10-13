/**
 * GET    /api/lotl/groups/[id] — group detail with resolved techniques
 * PATCH  /api/lotl/groups/[id] — rename / edit selection { name?, description?, entries? }
 * DELETE /api/lotl/groups/[id] — delete a group
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const g = await prisma.lotlGroup.findUnique({ where: { id } });
  if (!g) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, g.createdBy);
  if (!owns.ok) return owns.response;
  const ids: string[] = JSON.parse(g.entries || "[]");
  const techniques = await prisma.lotlTechnique.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, techniqueId: true, executor: true, riskLevel: true, elevationRequired: true },
  });
  return NextResponse.json({
    id: g.id, name: g.name, library: g.library, description: g.description,
    entries: ids, techniques, createdAt: g.createdAt, updatedAt: g.updatedAt,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const g = await prisma.lotlGroup.findUnique({ where: { id } });
  if (!g) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, g.createdBy);
  if (!owns.ok) return owns.response;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.description === "string") data.description = body.description;
  if (Array.isArray(body.entries)) {
    const ids = body.entries.map(String).filter(Boolean);
    const valid = await prisma.lotlTechnique.findMany({ where: { library: g.library, id: { in: ids } }, select: { id: true } });
    data.entries = JSON.stringify(valid.map((v) => v.id));
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const row = await prisma.lotlGroup.update({ where: { id }, data });
  return NextResponse.json({ id: row.id, name: row.name, count: JSON.parse(row.entries || "[]").length });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const g = await prisma.lotlGroup.findUnique({ where: { id } });
  if (!g) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, g.createdBy);
  if (!owns.ok) return owns.response;
  await prisma.lotlGroup.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
