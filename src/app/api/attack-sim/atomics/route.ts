/**
 * GET /api/attack-sim/atomics?module=<moduleId>&technique=<techniqueKey>
 *
 * Resolves the CURATED, directly-relevant Atomic Red Team tests for one technique
 * — NOT every test for its ATT&CK id. Each curated entry names the technique id
 * and (optionally) the test-name substrings that reproduce THIS behaviour, with a
 * `why`. This is the fix for blind mapping (e.g. Mimikatz/BloodHound were never
 * part of "Fake CAPTCHA → PowerShell").
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { getLibraryByModule } from "@/lib/attack-sim/registry";
import { contributionAtomics, type ContributionRow } from "@/lib/ti-watcher/contribution-to-technique";
import { publishedTechniqueEntries, entryAtomics } from "@/lib/library-entries/store";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const moduleId = (req.nextUrl.searchParams.get("module") || "").trim();
  const techniqueKey = (req.nextUrl.searchParams.get("technique") || "").trim();
  const library = getLibraryByModule(moduleId);
  const technique = library?.techniques.find((t) => t.key === techniqueKey);

  // Static (hand-curated) technique → its curated atomics; otherwise fall back
  // to an approved Threat-Intelligence contribution and use its linked test.
  let curated = technique?.atomics || [];
  if (!technique) {
    if (!library) return NextResponse.json({ error: "technique not found" }, { status: 404 });
    // Analyst-added library entry (Module Builder) → its linked, vetted atomics.
    const analyst = (await publishedTechniqueEntries(library.moduleId).catch(() => [])).find((e) => e.doc.key === techniqueKey);
    if (analyst) curated = entryAtomics(analyst.doc);
    const contrib = analyst ? null : await prisma.simLibraryContribution.findFirst({
      where: { libraryKey: library.key, status: "approved", techniqueKey },
    }).catch(() => null);
    if (!contrib && !analyst) return NextResponse.json({ error: "technique not found" }, { status: 404 });
    if (contrib) curated = contributionAtomics(contrib as ContributionRow);
  }
  const tids = [...new Set(curated.map((c: any) => c.techniqueId))];
  const rows = tids.length ? await prisma.atomicTest.findMany({ where: { techniqueId: { in: tids } }, orderBy: [{ techniqueId: "asc" }, { testNumber: "asc" }] }) : [];
  const parse = (s: string) => { try { return JSON.parse(s || "[]") as string[]; } catch { return []; } };

  const items: any[] = [];
  const seen = new Set<string>();
  for (const c of curated as any[]) {
    const inc = (c.nameIncludes || []).map((s: string) => s.toLowerCase());
    for (const r of rows) {
      if (r.techniqueId !== c.techniqueId) continue;
      if (inc.length && !inc.some((s: string) => r.testName.toLowerCase().includes(s))) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      items.push({
        id: r.id, techniqueId: r.techniqueId, testNumber: r.testNumber, testName: r.testName,
        executor: r.executorName, platforms: parse(r.platforms), command: r.command,
        elevationRequired: r.elevationRequired, why: c.why,
      });
    }
  }

  return NextResponse.json({ items, total: items.length, curated: curated.length });
}
