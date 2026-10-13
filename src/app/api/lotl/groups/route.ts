/**
 * LOTL technique groups — an analyst-created, reusable selection of techniques
 * from one library, simulated later via /api/lotl/simulate.
 *
 * GET  /api/lotl/groups?library=lolbas  — list groups (optionally one library)
 * POST /api/lotl/groups                 — create a group { name, library, entries[], description? }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { getRegistry } from "@/lib/lotl/registry";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const library = req.nextUrl.searchParams.get("library") || "";
  const where: Record<string, unknown> = { createdBy: auth.user.id };
  if (library) where.library = library;
  const groups = await prisma.lotlGroup.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 });
  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id, name: g.name, library: g.library, description: g.description,
      entries: JSON.parse(g.entries || "[]"), count: JSON.parse(g.entries || "[]").length,
      createdBy: g.createdBy, createdAt: g.createdAt, updatedAt: g.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const library = String(body.library || "").trim();
  const description = String(body.description || "").trim();
  const entries = Array.isArray(body.entries) ? body.entries.map(String).filter(Boolean) : [];

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!getRegistry().get(library)) return NextResponse.json({ error: `unknown library: ${library}` }, { status: 400 });
  if (entries.length === 0) return NextResponse.json({ error: "select at least one technique" }, { status: 400 });

  // Only keep ids that actually belong to this library.
  const valid = await prisma.lotlTechnique.findMany({
    where: { library, id: { in: entries } }, select: { id: true },
  });
  const validIds = valid.map((v) => v.id);
  if (validIds.length === 0) return NextResponse.json({ error: "no valid techniques in selection" }, { status: 400 });

  const row = await prisma.lotlGroup.create({
    data: { name, library, description, entries: JSON.stringify(validIds), createdBy: auth.user.id },
  });
  void logEvent({
    category: "usecase", action: "lotl.group.create", actor: auth.user.email, status: "ok",
    targetType: "LotlGroup", targetId: row.id,
    message: `${library} group "${name}" (${validIds.length} techniques)`,
    details: { library, count: validIds.length },
  });
  return NextResponse.json({ id: row.id, name: row.name, library: row.library, count: validIds.length });
}
