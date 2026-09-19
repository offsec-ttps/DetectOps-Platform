/**
 * GET /api/community/unified/compare?ids=id1,id2,id3
 *
 * Phase 5: comparison mode. Returns the FULL detail (including detection
 * logic) for up to 6 rules at once so the UI can show them side-by-side.
 *
 * Accepts ids from the unified `community_rules` table. (Legacy SigmaHQ /
 * Elastic / Splunk rules use their own ids in their own tables and are
 * compared via the existing /community/<source>/[id] routes.)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const safe = <T,>(s: string, fb: T): T => { try { return JSON.parse(s) as T; } catch { return fb; } };

export async function GET(req: NextRequest) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids query param required" }, { status: 400 });
  }

  const rules = await prisma.communityRule.findMany({
    where: { id: { in: ids } },
    include: { source: true },
  });

  // Sort to match the requested order
  const byId = new Map(rules.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  return NextResponse.json({
    count: ordered.length,
    rules: ordered.map((r) => ({
      id: r!.id,
      sourceName: r!.source.name,
      sourceType: r!.source.type,
      sourceUrl: r!.source.url,
      upstreamRuleId: r!.upstreamRuleId,
      title: r!.title,
      description: r!.description,
      severity: r!.severity,
      ruleLanguage: r!.ruleLanguage,
      ruleType: r!.ruleType,
      detectionLogicRaw: r!.detectionLogicRaw,
      mitreTechniques: safe<string[]>(r!.mitreTechniques, []),
      mitreTactics: safe<string[]>(r!.mitreTactics, []),
      platforms: safe<string[]>(r!.platforms, []),
      tags: safe<string[]>(r!.tags, []),
    })),
  });
}
