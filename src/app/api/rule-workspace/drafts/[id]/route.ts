/**
 * GET    /api/rule-workspace/drafts/[id]   — fetch a single draft
 * PATCH  /api/rule-workspace/drafts/[id]   — update fields (title/notes/adaptedLogic/status)
 * DELETE /api/rule-workspace/drafts/[id]   — discard a draft (status → abandoned, then row delete)
 *
 * Phase 7 — Rule Workspace draft mutation endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logWorkspaceAudit } from "@/lib/rule-workspace/audit";

const ALLOWED_STATUSES = new Set(["draft", "review", "pr_open", "merged", "abandoned"]);
const PATCHABLE = new Set([
  "title", "notes", "adaptedLanguage", "adaptedLogic",
  "conversionTarget", "conversionToolVersion", "status",
  "prNumber", "prUrl", "prBranch", "prRepo",
]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const draft = await prisma.ruleDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(draft);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE.has(k)) data[k] = v;
  }
  if (data.status && !ALLOWED_STATUSES.has(data.status as string)) {
    return NextResponse.json({ error: `invalid status; allowed: ${[...ALLOWED_STATUSES].join(", ")}` }, { status: 400 });
  }

  const existing = await prisma.ruleDraft.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const updated = await prisma.ruleDraft.update({ where: { id }, data });

  await logWorkspaceAudit({
    action: "draft.update",
    targetType: "draft",
    targetId: id,
    details: { changedKeys: Object.keys(data), newStatus: updated.status },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = await prisma.ruleDraft.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.ruleDraft.delete({ where: { id } });
  await logWorkspaceAudit({
    action: "draft.delete",
    targetType: "draft",
    targetId: id,
    details: { title: existing.title },
  });
  return NextResponse.json({ ok: true });
}
