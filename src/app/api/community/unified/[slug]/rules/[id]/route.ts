/**
 * GET /api/community/unified/[slug]/rules/[id]
 *
 * Generic single-rule endpoint. Returns the full normalized rule + the
 * source-specific raw payload so the UI can render format-native fields
 * (Sentinel entityMappings, Falco condition, Wazuh XML, YARA-L meta block, etc).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const safe = (s: string, fb: any) => { try { return JSON.parse(s); } catch { return fb; } };

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = await ctx.params;
  const rule = await prisma.communityRule.findUnique({
    where: { id },
    include: { source: true },
  });
  if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    id: rule.id,
    source: { id: rule.source.id, name: rule.source.name, type: rule.source.type, url: rule.source.url },
    upstreamRuleId: rule.upstreamRuleId,
    title: rule.title,
    description: rule.description,
    author: rule.author,
    upstreamCreatedAt: rule.upstreamCreatedAt,
    upstreamModifiedAt: rule.upstreamModifiedAt,
    severity: rule.severity,
    status: rule.status,
    ruleLanguage: rule.ruleLanguage,
    ruleType: rule.ruleType,
    detectionLogicRaw: rule.detectionLogicRaw,
    conversionSupported: rule.conversionSupported,
    mitreTechniques: safe(rule.mitreTechniques, []),
    mitreTactics: safe(rule.mitreTactics, []),
    platforms: safe(rule.platforms, []),
    products: safe(rule.products, []),
    logSources: safe(rule.logSources, []),
    tags: safe(rule.tags, []),
    references: safe(rule.references, []),
    falsePositives: safe(rule.falsePositives, []),
    sourceFilePath: rule.sourceFilePath,
    sourceUrl: rule.sourceUrl,
    rawPayload: safe(rule.rawPayload, {}),
    changeStatus: rule.changeStatus,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  });
}
