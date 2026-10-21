/**
 * GET /api/attack-sim/libraries[?module=<moduleId>] — the Attack Technique
 * Libraries (ClickFix / Deceptive Delivery & Execution, …): per-technique
 * kill-chain narrative, ATT&CK mapping (resolved to Atomic Red Team tests for the
 * Simulate leg by /api/attack/atomics), and curated detection + mitigation. All
 * defensive reference data — no payloads/commands.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ATTACK_LIBRARIES, getLibraryByModule } from "@/lib/attack-sim/registry";
import { contributionToTechnique, type ContributionRow } from "@/lib/ti-watcher/contribution-to-technique";
import { publishedTechniqueEntries, entryToTechnique } from "@/lib/library-entries/store";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const moduleId = (req.nextUrl.searchParams.get("module") || "").trim();
  if (moduleId) {
    const lib = getLibraryByModule(moduleId);
    if (!lib) return NextResponse.json({ error: `no attack library for module "${moduleId}"` }, { status: 404 });
    // Merge approved Threat-Intelligence contributions for this library (review-gated).
    const contributions = await prisma.simLibraryContribution.findMany({
      where: { libraryKey: lib.key, status: "approved" }, orderBy: { reviewedAt: "desc" },
    }).catch(() => [] as ContributionRow[]);
    const contributed = (contributions as ContributionRow[]).map(contributionToTechnique);
    // Merge analyst-added entries (Module Builder → "Add technique to a library").
    const analyst = (await publishedTechniqueEntries(lib.moduleId).catch(() => [])).map((e) => entryToTechnique(e.doc));
    const merged = { ...lib, techniques: [...lib.techniques.map((t) => ({ ...t, origin: t.origin ?? ("curated" as const) })), ...contributed, ...analyst] };
    return NextResponse.json({ library: merged, contributedCount: contributed.length, analystCount: analyst.length });
  }
  const entryDocs = await publishedTechniqueEntries().catch(() => []);
  const perLib = new Map<string, number>();
  for (const e of entryDocs) perLib.set(e.row.moduleId, (perLib.get(e.row.moduleId) || 0) + 1);
  return NextResponse.json({
    libraries: ATTACK_LIBRARIES.map((l) => ({
      key: l.key, moduleId: l.moduleId, name: l.name, shortName: l.shortName,
      category: l.category, icon: l.icon, description: l.description, techniqueCount: l.techniques.length + (perLib.get(l.moduleId) || 0),
    })),
  });
}
