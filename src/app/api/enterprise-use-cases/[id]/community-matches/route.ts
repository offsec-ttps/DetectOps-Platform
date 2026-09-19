/**
 * GET /api/enterprise-use-cases/[id]/community-matches
 *
 * Find community detection rules whose MITRE techniques overlap with this
 * use case's techniques. Searches the three community catalogues:
 *   - CommunitySigmaRule (SigmaHQ)
 *   - SplunkDetection    (splunk/security_content / ESCU)
 *   - CommunityElasticRule (elastic/detection-rules)
 *
 * Returns up to ?limit=8 rows per source, ordered by overlap-count desc.
 * Each row carries a small excerpt of the rule body so the UI can render
 * an inline preview without a second fetch.
 *
 *   ?limit=8   default
 *   ?source=sigma|splunk|elastic   restrict to one source
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function overlap(a: string[], b: string[]): number {
  const sa = new Set(a.map((t) => t.toUpperCase()));
  let n = 0;
  for (const t of b) if (sa.has(t.toUpperCase())) n++;
  return n;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(20, Math.max(1, parseInt(sp.get("limit") || "8", 10)));
  const sourceFilter = sp.get("source") || "";

  const uc = await prisma.enterpriseUseCase.findUnique({ where: { id }, select: { id: true, mitreTechniques: true } });
  if (!uc) return NextResponse.json({ error: "not found" }, { status: 404 });
  const techniques = safeJson<string[]>(uc.mitreTechniques, []);
  if (techniques.length === 0) {
    return NextResponse.json({ techniques: [], sigma: [], splunk: [], elastic: [], total: 0 });
  }

  // SQLite LIKE doesn't index well; we scan with `contains` for each technique
  // and aggregate in JS. The community catalogues are O(few-thousand) rows so
  // this is cheap. (Detection Packs already uses the same pattern at scale.)
  const buildWhere = () => ({
    OR: techniques.map((t) => ({ mitreTechniques: { contains: `"${t}"` } })),
  });

  const [sigmaRows, splunkRows, elasticRows] = await Promise.all([
    !sourceFilter || sourceFilter === "sigma" ? prisma.communitySigmaRule.findMany({
      where: buildWhere() as any,
      select: { id: true, title: true, description: true, level: true, mitreTechniques: true, repositoryUrl: true, filePath: true, detectionYaml: true },
      take: 64,
    }) : Promise.resolve([]),
    !sourceFilter || sourceFilter === "splunk" ? prisma.splunkDetection.findMany({
      where: buildWhere() as any,
      select: { id: true, name: true, description: true, type: true, mitreTechniques: true, search: true, sourceUrl: true, filePath: true },
      take: 64,
    }) : Promise.resolve([]),
    !sourceFilter || sourceFilter === "elastic" ? prisma.communityElasticRule.findMany({
      where: buildWhere() as any,
      select: { id: true, name: true, description: true, severity: true, mitreTechniques: true, query: true, language: true, filePath: true, repositoryUrl: true },
      take: 64,
    }) : Promise.resolve([]),
  ]);

  // Internal Community Content routes per source. External GitHub URLs are
  // intentionally NOT included in the response so the UI can't surface them.
  const sigma = (sigmaRows || []).map((r) => ({
    id: r.id, source: "sigma" as const,
    title: r.title, description: r.description,
    severity: r.level, language: "sigma",
    techniques: safeJson<string[]>(r.mitreTechniques, []),
    overlapCount: overlap(techniques, safeJson<string[]>(r.mitreTechniques, [])),
    bodyPreview: (r.detectionYaml || "").slice(0, 600),
    internalHref: `/community/sigmahq/${r.id}`,
  })).filter((r) => r.overlapCount > 0).sort((a, b) => b.overlapCount - a.overlapCount).slice(0, limit);

  const splunk = (splunkRows || []).map((r) => ({
    id: r.id, source: "splunk" as const,
    title: r.name, description: r.description,
    severity: r.type, language: "spl",
    techniques: safeJson<string[]>(r.mitreTechniques, []),
    overlapCount: overlap(techniques, safeJson<string[]>(r.mitreTechniques, [])),
    bodyPreview: (r.search || "").slice(0, 600),
    internalHref: `/community/splunk/${r.id}`,
  })).filter((r) => r.overlapCount > 0).sort((a, b) => b.overlapCount - a.overlapCount).slice(0, limit);

  const elastic = (elasticRows || []).map((r) => ({
    id: r.id, source: "elastic" as const,
    title: r.name, description: r.description,
    severity: r.severity, language: r.language,
    techniques: safeJson<string[]>(r.mitreTechniques, []),
    overlapCount: overlap(techniques, safeJson<string[]>(r.mitreTechniques, [])),
    bodyPreview: (r.query || "").slice(0, 600),
    internalHref: `/community/elastic/${r.id}`,
  })).filter((r) => r.overlapCount > 0).sort((a, b) => b.overlapCount - a.overlapCount).slice(0, limit);

  return NextResponse.json({
    techniques,
    sigma, splunk, elastic,
    total: sigma.length + splunk.length + elastic.length,
  });
}
