/**
 * POST /api/library-entries/import { yaml|text, publish? , dryRun? }
 * Push a bundle (from /export, or a hand-written list of entries) into the libraries.
 * Every entry is validated independently; valid ones are upserted (same library+key ⇒ new
 * version), invalid ones are reported and skipped — one bad entry never blocks the rest.
 */
import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/event-log";
import { authedActor, parseEntryInput } from "@/lib/library-entries/http";
import { upsertEntry, validateEntry } from "@/lib/library-entries/store";

export async function POST(req: NextRequest) {
  const a = await authedActor();
  if (!a.ok) return a.response as NextResponse;
  const body = await req.json().catch(() => ({}));
  const parsed = parseEntryInput({ yaml: body.yaml ?? body.text });
  if (!parsed.ok) return NextResponse.json({ ok: false, errors: [parsed.error] }, { status: 400 });
  const v: any = parsed.value;
  const entries: unknown[] = Array.isArray(v) ? v : Array.isArray(v?.entries) ? v.entries : v && typeof v === "object" ? [v] : [];
  if (!entries.length) return NextResponse.json({ ok: false, errors: ["no entries found (expected a bundle with an `entries:` list, a list, or a single entry)"] }, { status: 400 });
  if (entries.length > 200) return NextResponse.json({ ok: false, errors: ["too many entries (max 200 per import)"] }, { status: 400 });

  const results: Array<{ library: string; key: string; name: string; result: string; errors?: string[] }> = [];
  for (const e of entries) {
    if (body.dryRun) {
      const r = await validateEntry(e, { admin: a.actor.admin });
      results.push({ library: r.doc.library, key: r.doc.key, name: r.doc.name, result: r.ok ? (r.exists ? "would-update" : "would-create") : "invalid", ...(r.ok ? {} : { errors: r.errors }) });
      continue;
    }
    const r = await upsertEntry(e, a.actor, body.publish !== false);
    if (r.forbidden) { results.push({ library: r.validation.doc.library, key: r.validation.doc.key, name: r.validation.doc.name, result: "forbidden", errors: [r.forbidden] }); continue; }
    results.push({ library: r.validation.doc.library, key: r.validation.doc.key, name: r.validation.doc.name,
      result: r.ok && r.entry ? `${r.validation.exists ? "updated" : "created"}:${r.entry.status}` : "invalid", ...(r.ok ? {} : { errors: r.validation.errors }) });
  }
  const applied = results.filter((r) => /^(created|updated)/.test(r.result)).length;
  if (!body.dryRun) void logEvent({ category: "module" as any, action: "library-entry.import", actor: a.actor.email, status: "ok", targetType: "LibraryEntry", targetId: "", message: `${applied}/${results.length} entries applied` });
  return NextResponse.json({ ok: true, total: results.length, applied, dryRun: !!body.dryRun, results });
}
