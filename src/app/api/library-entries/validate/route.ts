/** POST /api/library-entries/validate — dry-run: structure + library + linked-atomic checks. Writes nothing. */
import { NextRequest, NextResponse } from "next/server";
import { authedActor, parseEntryInput } from "@/lib/library-entries/http";
import { validateEntry } from "@/lib/library-entries/store";
import { entryCatalogItems } from "@/lib/library-entries/store";
import type { TechniqueEntryDoc } from "@/lib/library-entries/schema";

export async function POST(req: NextRequest) {
  const a = await authedActor();
  if (!a.ok) return a.response as NextResponse;
  const body = await req.json().catch(() => ({}));
  const input = parseEntryInput(body);
  if (!input.ok) return NextResponse.json({ ok: false, errors: [input.error], warnings: [], resolved: [] }, { status: 200 });
  const v = await validateEntry(input.value, { admin: a.actor.admin });
  const preview = v.doc.kind === "technique" ? entryCatalogItems(v.doc as TechniqueEntryDoc) : [];
  return NextResponse.json({
    ok: v.ok, errors: v.errors, warnings: v.warnings, resolved: v.resolved, exists: v.exists, nextVersion: v.nextVersion,
    target: v.target ? { id: v.target.id, name: v.target.name, kind: v.target.kind } : null,
    key: v.doc.key, kind: v.doc.kind, preview,
    willBePending: v.doc.kind === "lotl" && !a.actor.admin,
  });
}
