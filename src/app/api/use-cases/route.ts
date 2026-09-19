/**
 * GET  /api/use-cases               — list (paged + filtered)
 * POST /api/use-cases               — create a new UseCase (with steps)
 *
 * Filters: ?authorMode=&framework=&source=&q=&page=&pageSize=
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { requireUser } from "@/lib/auth-guard";
import type { UseCaseDraft, StepDraft } from "@/lib/use-cases/types";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function uniqStrings(xs: unknown): string[] {
  if (!Array.isArray(xs)) return [];
  const out = new Set<string>();
  for (const x of xs) if (typeof x === "string" && x) out.add(x);
  return [...out];
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const where: Record<string, unknown> = {};
  if (auth.enforced) where.authorId = auth.user.id;   // tenant-scope
  const authorMode = sp.get("authorMode");
  if (authorMode) where.authorMode = authorMode;
  const framework = sp.get("framework");
  if (framework) where.framework = framework;
  const source = sp.get("source");
  if (source) where.source = source;
  const q = sp.get("q");
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
      { tags: { contains: q } },
    ];
  }
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") || "25", 10)));

  const [rows, total] = await Promise.all([
    prisma.useCase.findMany({
      where: where as any,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { steps: true, playbooks: true } } },
    }),
    prisma.useCase.count({ where: where as any }),
  ]);

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      mitreTechniques: safeJson<string[]>(r.mitreTechniques, []),
      mitreTactics: safeJson<string[]>(r.mitreTactics, []),
      platforms: safeJson<string[]>(r.platforms, []),
      tags: safeJson<string[]>(r.tags, []),
      stepCount: (r as any)._count?.steps ?? 0,
      playbookCount: (r as any)._count?.playbooks ?? 0,
    })),
    total, page, pageSize, totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({})) as Partial<UseCaseDraft>;
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const authorMode = body.authorMode || "atomic";
  const framework = body.framework || "atomic";

  const techniqueSet = new Set<string>();
  const platforms = uniqStrings(body.platforms);

  const steps: StepDraft[] = Array.isArray(body.steps) ? body.steps : [];
  for (const s of steps) {
    if (s.techniqueId) techniqueSet.add(s.techniqueId);
  }

  const sessionUser = auth.user;

  const created = await prisma.useCase.create({
    data: {
      name: body.name.slice(0, 240),
      description: (body.description || "").slice(0, 4000),
      authorMode,
      framework,
      source: body.source || "manual",
      sourceRefType: body.sourceRefType ?? null,
      sourceRefId: body.sourceRefId ?? null,
      mitreTechniques: JSON.stringify([...techniqueSet]),
      mitreTactics: "[]",
      platforms: JSON.stringify(platforms),
      tags: JSON.stringify(uniqStrings(body.tags)),
      authorId: sessionUser?.id || "",
      steps: {
        create: steps.map((s, i) => ({
          orderIndex: typeof s.orderIndex === "number" ? s.orderIndex : i,
          kind: s.kind,
          refId: s.refId || "",
          techniqueId: s.techniqueId || "",
          displayName: s.displayName || s.techniqueId || `step ${i + 1}`,
          parameters: JSON.stringify(s.parameters ?? {}),
          expectedSignal: (s.expectedSignal || "").slice(0, 500),
          notes: (s.notes || "").slice(0, 2000),
        })),
      },
    },
    include: { steps: { orderBy: { orderIndex: "asc" } } },
  });

  void logEvent({
    category: "usecase", action: "usecase.create",
    actor: sessionUser?.email || "anonymous", status: "ok",
    targetType: "usecase", targetId: created.id,
    message: `${authorMode} · ${framework} · ${steps.length} step(s)`,
    details: { authorMode, framework, source: body.source, stepCount: steps.length },
  });

  return NextResponse.json({
    ...created,
    mitreTechniques: safeJson<string[]>(created.mitreTechniques, []),
    platforms: safeJson<string[]>(created.platforms, []),
    tags: safeJson<string[]>(created.tags, []),
  });
}
