/**
 * PUT  /api/use-cases/[id]/canvas    — save nodes/edges (debounced autosave)
 * GET  /api/use-cases/[id]/canvas    — load
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await prisma.useCaseCanvas.findUnique({ where: { useCaseId: id } });
  if (!row) {
    return NextResponse.json({ nodes: [], edges: [], layoutVersion: 1 });
  }
  return NextResponse.json({
    nodes: safeJson<unknown[]>(row.nodes, []),
    edges: safeJson<unknown[]>(row.edges, []),
    layoutVersion: row.layoutVersion,
    updatedAt: row.updatedAt,
  });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const useCase = await prisma.useCase.findUnique({ where: { id } });
  if (!useCase) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404(auth, useCase.authorId);
  if (!owns.ok) return owns.response;

  const body = await req.json().catch(() => ({}));
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const edges = Array.isArray(body.edges) ? body.edges : [];
  if (nodes.length > 2000 || edges.length > 5000 || JSON.stringify(nodes).length + JSON.stringify(edges).length > 2_000_000) {
    return NextResponse.json({ error: "canvas too large" }, { status: 413 });
  }

  await prisma.useCaseCanvas.upsert({
    where: { useCaseId: id },
    create: {
      useCaseId: id,
      nodes: JSON.stringify(nodes),
      edges: JSON.stringify(edges),
      layoutVersion: 1,
    },
    update: {
      nodes: JSON.stringify(nodes),
      edges: JSON.stringify(edges),
    },
  });

  return NextResponse.json({ ok: true, nodeCount: nodes.length, edgeCount: edges.length });
}
