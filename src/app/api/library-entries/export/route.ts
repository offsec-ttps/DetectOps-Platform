/**
 * GET /api/library-entries/export?library=<id>&format=yaml|json&drafts=1
 * A portable bundle of entries — commit it to git, or import it into another DetectOps
 * instance to push the same updates there.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { toYaml } from "@/lib/library-entries/http";
import { exportEntries } from "@/lib/library-entries/store";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const bundle = await exportEntries(sp.get("library") || undefined, sp.get("drafts") === "1");
  const json = (sp.get("format") || "yaml") === "json";
  return new NextResponse(json ? JSON.stringify(bundle, null, 2) : toYaml(bundle), {
    headers: { "Content-Type": json ? "application/json" : "text/yaml; charset=utf-8", "Content-Disposition": `attachment; filename="library-entries.${json ? "json" : "yaml"}"` },
  });
}
