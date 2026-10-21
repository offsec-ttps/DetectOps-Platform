/**
 * GET  /api/library-entries?library=<id>&status=<s>  — list entries (no document body)
 * POST /api/library-entries { yaml | doc, publish? } — create or update (same library+key ⇒ new version)
 *
 * An entry is an atomic-style technique record added to an EXISTING library; published
 * entries are merged into that library at read time (see lib/library-entries/store.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { authedActor, parseEntryInput } from "@/lib/library-entries/http";
import { upsertEntry } from "@/lib/library-entries/store";

export async function GET(req: NextRequest) {
  const a = await authedActor();
  if (!a.ok) return a.response as NextResponse;
  const sp = req.nextUrl.searchParams;
  const library = sp.get("library") || ""; const status = sp.get("status") || "";
  const rows = await prisma.libraryEntry.findMany({
    where: { ...(library ? { moduleId: library } : {}), ...(status ? { status } : {}) },
    orderBy: [{ moduleId: "asc" }, { updatedAt: "desc" }],
    select: { id: true, kind: true, moduleId: true, entryKey: true, name: true, attackId: true, status: true, version: true, changelog: true, createdBy: true, publishedBy: true, publishedAt: true, updatedAt: true },
  });
  return NextResponse.json({ items: rows });
}

export async function POST(req: NextRequest) {
  const a = await authedActor();
  if (!a.ok) return a.response as NextResponse;
  const body = await req.json().catch(() => ({}));
  const input = parseEntryInput(body);
  if (!input.ok) return NextResponse.json({ ok: false, errors: [input.error] }, { status: 400 });
  const publish = body.publish !== false;                    // default: publish when valid
  const r = await upsertEntry(input.value, a.actor, publish);
  if (r.forbidden) return NextResponse.json({ ok: false, errors: [r.forbidden] }, { status: 403 });
  if (!r.ok || !r.entry) {
    return NextResponse.json({ ok: false, errors: r.validation.errors, warnings: r.validation.warnings }, { status: 422 });
  }
  void logEvent({ category: "module" as any, action: "library-entry.upsert", actor: a.actor.email, status: "ok", targetType: "LibraryEntry", targetId: r.entry.id, message: `${r.entry.moduleId}/${r.entry.entryKey} v${r.entry.version} → ${r.entry.status}` });
  return NextResponse.json({
    ok: true, id: r.entry.id, status: r.entry.status, version: r.entry.version, library: r.entry.moduleId, key: r.entry.entryKey,
    warnings: r.validation.warnings,
    note: r.entry.status === "pending" ? "Queued for admin approval — it goes live in the library once approved." : r.entry.status === "published" ? "Published — now merged into the library." : "Saved as draft.",
  });
}
