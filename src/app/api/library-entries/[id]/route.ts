/**
 * GET    /api/library-entries/:id            — full entry (YAML + JSON + version history)
 * PATCH  /api/library-entries/:id { status } — publish | retire | draft  (LOTL publish needs admin)
 * DELETE /api/library-entries/:id            — remove the entry (and its LOTL row)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { authedActor, toYaml } from "@/lib/library-entries/http";
import { setStatus, deleteEntry, ForbiddenError, type EntryStatus } from "@/lib/library-entries/store";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await authedActor();
  if (!a.ok) return a.response as NextResponse;
  const { id } = await ctx.params;
  const row = await prisma.libraryEntry.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  let doc: any = {}; let history: any[] = [];
  try { doc = JSON.parse(row.doc); } catch { /* */ }
  try { history = JSON.parse(row.history || "[]"); } catch { /* */ }
  return NextResponse.json({ id: row.id, kind: row.kind, library: row.moduleId, key: row.entryKey, name: row.name, status: row.status, version: row.version,
    yaml: toYaml(doc), doc, history: history.map((h) => ({ version: h.version, changelog: h.changelog, at: h.at, by: h.by })) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await authedActor();
  if (!a.ok) return a.response as NextResponse;
  const { id } = await ctx.params;
  const { status } = await req.json().catch(() => ({}));
  if (!["published", "retired", "draft"].includes(status)) return NextResponse.json({ error: "status must be published | retired | draft" }, { status: 400 });
  try {
    const row = await setStatus(id, status as EntryStatus, a.actor);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    void logEvent({ category: "module" as any, action: `library-entry.${status}`, actor: a.actor.email, status: "ok", targetType: "LibraryEntry", targetId: id, message: `${row.moduleId}/${row.entryKey} → ${status}` });
    return NextResponse.json({ ok: true, status: row.status, version: row.version });
  } catch (e: any) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: String(e?.message || e) }, { status: 422 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await authedActor();
  if (!a.ok) return a.response as NextResponse;
  const { id } = await ctx.params;
  let ok = false;
  try { ok = await deleteEntry(id, a.actor); }
  catch (e: any) { if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 }); throw e; }
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  void logEvent({ category: "module" as any, action: "library-entry.delete", actor: a.actor.email, status: "ok", targetType: "LibraryEntry", targetId: id, message: "entry deleted" });
  return NextResponse.json({ ok: true });
}
