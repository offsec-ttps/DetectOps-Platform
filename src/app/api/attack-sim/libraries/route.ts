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
    const merged = { ...lib, techniques: [...lib.techniques.map((t) => ({ ...t, origin: t.origin ?? ("curated" as const) })), ...contributed] };
    return NextResponse.json({ library: merged, contributedCount: contributed.length });
  }
  return NextResponse.json({
    libraries: ATTACK_LIBRARIES.map((l) => ({
      key: l.key, moduleId: l.moduleId, name: l.name, shortName: l.shortName,
      category: l.category, icon: l.icon, description: l.description, techniqueCount: l.techniques.length,
    })),
  });
}
