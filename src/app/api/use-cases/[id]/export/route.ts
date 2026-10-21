/**
 * POST /api/use-cases/[id]/export
 *
 * Body: { format: "atomic-yaml" | "purplesharp-json" | "stratus-sh" }
 *
 * Renders the requested artifact, persists a new Playbook row (auto-bumps
 * version), returns body + checksum + warning about skipped steps.
 *
 * Phase 1 ships the atomic-yaml exporter; PurpleSharp + Stratus exporters
 * stub out cleanly and emit a "not implemented" body so the surface is
 * complete and we can fill them in Phase 1B without route changes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";
import { exportAtomicYaml } from "@/lib/use-cases/exporters/atomic";
import { exportPurpleSharpJson } from "@/lib/use-cases/exporters/purplesharp";
import { exportStratusShell } from "@/lib/use-cases/exporters/stratus";
import type { PlaybookFormat } from "@/lib/use-cases/types";

const FORMATS: PlaybookFormat[] = ["atomic-yaml", "purplesharp-json", "stratus-sh"];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const format = body.format as PlaybookFormat;
  if (!FORMATS.includes(format)) {
    return NextResponse.json({ error: `format must be one of ${FORMATS.join("|")}` }, { status: 400 });
  }

  const useCase = await prisma.useCase.findUnique({
    where: { id },
    include: { steps: { orderBy: { orderIndex: "asc" } } },
  });
  if (!useCase) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404(auth, useCase.authorId);
  if (!owns.ok) return owns.response;

  let rendered = "";
  let checksum = "";
  let warnings: Record<string, number> = {};
  let emitted = 0;

  if (format === "atomic-yaml") {
    const r = exportAtomicYaml({
      useCase: { id: useCase.id, name: useCase.name, description: useCase.description },
      steps: useCase.steps.map((s) => ({
        id: s.id, kind: s.kind, refId: s.refId, techniqueId: s.techniqueId,
        displayName: s.displayName, parameters: s.parameters,
        expectedSignal: s.expectedSignal, notes: s.notes,
      })),
    });
    rendered = r.body;
    checksum = r.checksum;
    warnings = r.skippedKinds;
    emitted = r.emittedTests;
  } else if (format === "purplesharp-json") {
    const r = exportPurpleSharpJson({
      useCase: { id: useCase.id, name: useCase.name, description: useCase.description },
      steps: useCase.steps.map((s) => ({
        id: s.id, kind: s.kind, techniqueId: s.techniqueId,
        displayName: s.displayName, parameters: s.parameters,
      })),
      rootConfig: typeof body.rootConfig === "object" ? body.rootConfig : undefined,
    });
    rendered = r.body;
    checksum = r.checksum;
    warnings = r.skippedKinds;
    emitted = r.emittedTasks;
  } else if (format === "stratus-sh") {
    const r = exportStratusShell({
      useCase: { id: useCase.id, name: useCase.name, description: useCase.description },
      steps: useCase.steps.map((s) => ({
        id: s.id, kind: s.kind, refId: s.refId, techniqueId: s.techniqueId,
        displayName: s.displayName, parameters: s.parameters,
        expectedSignal: s.expectedSignal, notes: s.notes,
      })),
    });
    rendered = r.body;
    checksum = r.checksum;
    warnings = r.skippedKinds;
    emitted = r.emittedAttacks;
  } else {
    return NextResponse.json({ error: "unsupported format" }, { status: 400 });
  }

  // Auto-bump version per format
  const latest = await prisma.playbook.findFirst({
    where: { useCaseId: id, format },
    orderBy: { version: "desc" },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  const sessionUser = await getSessionUser().catch(() => null);
  const playbook = await prisma.playbook.create({
    data: {
      useCaseId: id,
      format,
      version: nextVersion,
      body: rendered,
      checksum,
      generator: "manual",
      generatorModel: "",
    },
  });

  void logEvent({
    category: "usecase", action: "usecase.export",
    actor: sessionUser?.email || "anonymous", status: "ok",
    targetType: "usecase", targetId: id,
    message: `${format} v${nextVersion} (${rendered.length}B)`,
    details: { format, version: nextVersion, bytes: rendered.length, emitted, warnings },
  });

  return NextResponse.json({
    id: playbook.id,
    format,
    version: nextVersion,
    checksum,
    bytes: rendered.length,
    body: rendered,
    warnings,
    emitted,
  });
}
