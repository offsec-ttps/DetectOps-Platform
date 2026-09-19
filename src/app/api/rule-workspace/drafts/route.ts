/**
 * GET  /api/rule-workspace/drafts             — list drafts (filterable by status)
 * POST /api/rule-workspace/drafts             — create a new draft
 *
 * Phase 7 — Rule Workspace drafts. A draft is an analyst's working copy of
 * a detection that has been pulled in from any catalog (or authored from
 * scratch) and is on its way through review → PR → merged.
 *
 * Production deployment is intentionally NOT redesigned here. The plan calls
 * for "reuse your current production integration path and only add 'Create
 * draft / Create PR' actions". The PR creation lives in
 * /api/rule-workspace/drafts/[id]/create-pr and delegates to the existing
 * pushFileToBranchAndCreatePR helper in src/lib/github.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logWorkspaceAudit } from "@/lib/rule-workspace/audit";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status")?.trim() ?? "";
  const q = sp.get("q")?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "50", 10)));

  const where: any = {};
  if (status) where.status = status;
  if (q) where.OR = [
    { title: { contains: q } },
    { notes: { contains: q } },
  ];

  const [total, items] = await Promise.all([
    prisma.ruleDraft.count({ where }),
    prisma.ruleDraft.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    title, notes, sourceTable, sourceRuleId, sourceName,
    originalLanguage, originalLogic,
    adaptedLanguage, adaptedLogic,
    conversionTarget, conversionToolVersion,
  } = body as Record<string, string | undefined>;

  if (!title || title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const draft = await prisma.ruleDraft.create({
    data: {
      title: title.trim(),
      notes: notes ?? "",
      sourceTable: sourceTable ?? null,
      sourceRuleId: sourceRuleId ?? null,
      sourceName: sourceName ?? "",
      originalLanguage: originalLanguage ?? "",
      originalLogic: originalLogic ?? "",
      adaptedLanguage: adaptedLanguage ?? originalLanguage ?? "",
      adaptedLogic: adaptedLogic ?? originalLogic ?? "",
      conversionTarget: conversionTarget ?? null,
      conversionToolVersion: conversionToolVersion ?? "",
      status: "draft",
    },
  });

  await logWorkspaceAudit({
    action: "draft.create",
    targetType: "draft",
    targetId: draft.id,
    details: { title: draft.title, sourceTable: draft.sourceTable, sourceName: draft.sourceName },
  });

  return NextResponse.json(draft, { status: 201 });
}
