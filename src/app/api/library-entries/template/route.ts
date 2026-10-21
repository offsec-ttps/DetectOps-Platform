/** GET /api/library-entries/template?kind=technique|lotl&library=<id>&group=&domain= — starter YAML. */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { templateYaml } from "@/lib/library-entries/schema";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") === "lotl" ? "lotl" : "technique";
  const body = templateYaml(kind, sp.get("library") || "", sp.get("group") || "Windows", sp.get("domain") || "Analyst-added");
  return new NextResponse(body, { headers: { "Content-Type": "text/yaml; charset=utf-8", "Content-Disposition": `attachment; filename="library-entry-${kind}.yaml"` } });
}
