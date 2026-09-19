/**
 * GET /api/community/mitre-car/rules/[id] — fetch a single CAR analytic.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSourceEnabled } from "@/lib/community-sources/flags";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isSourceEnabled("mitreCar")) {
    return NextResponse.json({ enabled: false }, { status: 403 });
  }
  const { id } = await ctx.params;

  const rule = await prisma.communityRule.findUnique({ where: { id } });
  if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });

  const safe = (s: string, fb: any) => { try { return JSON.parse(s); } catch { return fb; } };

  return NextResponse.json({
    id: rule.id,
    upstreamRuleId: rule.upstreamRuleId,
    title: rule.title,
    description: rule.description,
    author: rule.author,
    upstreamCreatedAt: rule.upstreamCreatedAt,
    upstreamModifiedAt: rule.upstreamModifiedAt,
    mitreTechniques: safe(rule.mitreTechniques, []),
    mitreTactics: safe(rule.mitreTactics, []),
    platforms: safe(rule.platforms, []),
    products: safe(rule.products, []),
    logSources: safe(rule.logSources, []),
    tags: safe(rule.tags, []),
    ruleLanguage: rule.ruleLanguage,
    ruleType: rule.ruleType,
    detectionLogicRaw: rule.detectionLogicRaw,
    severity: rule.severity,
    status: rule.status,
    references: safe(rule.references, []),
    sourceFilePath: rule.sourceFilePath,
    sourceUrl: rule.sourceUrl,
    rawPayload: safe(rule.rawPayload, {}),
    changeStatus: rule.changeStatus,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  });
}
