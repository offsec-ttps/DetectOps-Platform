/**
 * GET /api/scenario-library
 *
 * Unified search across three simulation catalogues so a user can browse +
 * cherry-pick into a scenario:
 *
 *   - source="art"          → AtomicTest (1,773 rows in canonical platform)
 *   - source="detection-pack" → DetectionSimulation (Detection-Pack-attached sims)
 *   - source="purplesharp"  → PurpleSharpVariation + PurpleSharpTemplate
 *
 * Query parameters:
 *   ?source=art|detection-pack|purplesharp     restrict to one source (default: all)
 *   ?q=<text>          full-text-ish search across name + description
 *   ?technique=<tid>   exact technique-id filter (T1003.001, etc.)
 *   ?platform=<p>      filter by platform (windows|linux|macos|cloud|...)
 *   ?limit=<n>         items per source (default 30, max 100)
 *
 * Each item carries enough info to materialise a scenario step:
 *   { source, refId, techniqueId, displayName, description, command?, executor?, parameters? }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sourceFilter = sp.get("source") || "";
  const q = (sp.get("q") || "").trim();
  const technique = (sp.get("technique") || "").trim();
  const platform = (sp.get("platform") || "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "30", 10)));

  const wantArt = !sourceFilter || sourceFilter === "art";
  const wantDp  = !sourceFilter || sourceFilter === "detection-pack";
  const wantPs  = !sourceFilter || sourceFilter === "purplesharp";

  // ─── AtomicTest ───────────────────────────────────────────────────────────
  const artPromise = wantArt
    ? prisma.atomicTest.findMany({
        where: {
          ...(technique ? { techniqueId: technique } : {}),
          ...(q ? {
            OR: [
              { testName: { contains: q } },
              { testDescription: { contains: q } },
              { command: { contains: q } },
              { techniqueName: { contains: q } },
            ],
          } : {}),
          ...(platform ? { platforms: { contains: `"${platform}"` } } : {}),
        } as any,
        orderBy: [{ techniqueId: "asc" }, { testNumber: "asc" }],
        take: limit,
        select: {
          id: true, testGuid: true, techniqueId: true, techniqueName: true,
          testNumber: true, testName: true, testDescription: true,
          executorName: true, command: true, platforms: true,
          elevationRequired: true, inputArguments: true,
        },
      }).catch(() => [])
    : Promise.resolve([]);

  // ─── DetectionSimulation ──────────────────────────────────────────────────
  const dpPromise = wantDp
    ? prisma.detectionSimulation.findMany({
        where: {
          ...(technique ? { techniqueId: technique } : {}),
          ...(q ? {
            OR: [
              { displayName: { contains: q } },
              { description: { contains: q } },
              { rationale: { contains: q } },
            ],
          } : {}),
        } as any,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true, framework: true, refId: true,
          techniqueId: true, displayName: true,
          description: true, rationale: true, packId: true,
        },
      }).catch(() => [])
    : Promise.resolve([]);

  // ─── PurpleSharp ──────────────────────────────────────────────────────────
  const psPromise = wantPs
    ? prisma.purpleSharpVariation.findMany({
        where: {
          ...(technique ? { techniqueId: technique } : {}),
          ...(q ? {
            OR: [
              { techniqueName: { contains: q } },
              { variationLabel: { contains: q } },
              { description: { contains: q } },
            ],
          } : {}),
        } as any,
        orderBy: [{ techniqueId: "asc" }, { variation: "asc" }],
        take: limit,
        select: {
          id: true, techniqueId: true, techniqueName: true,
          variation: true, variationLabel: true, description: true,
          tactic: true, requiresUrl: true, requiresCommand: true, requiredParams: true,
        },
      }).catch(() => [])
    : Promise.resolve([]);

  const [art, dp, ps] = await Promise.all([artPromise, dpPromise, psPromise]);

  const items = [
    ...art.map((a) => ({
      libraryId:    `art:${a.testGuid}`,
      source:       "art" as const,
      framework:    "atomic" as const,
      refId:        a.testGuid,
      techniqueId:  a.techniqueId,
      techniqueName: a.techniqueName,
      displayName:  a.testName,
      description:  (a.testDescription || "").slice(0, 600),
      executor:     a.executorName,
      command:      (a.command || "").slice(0, 600),
      platforms:    safeJson<string[]>(a.platforms, []),
      elevationRequired: a.elevationRequired,
      inputArguments: safeJson<Record<string, any>>(a.inputArguments, {}),
      testNumber:   a.testNumber,
    })),
    ...dp.map((d) => ({
      libraryId:    `dp:${d.id}`,
      source:       "detection-pack" as const,
      framework:    d.framework as "atomic" | "purplesharp" | "stratus" | "manual",
      refId:        d.refId,
      techniqueId:  d.techniqueId,
      displayName:  d.displayName,
      description:  (d.description || "").slice(0, 600),
      rationale:    (d.rationale || "").slice(0, 300),
      packId:       d.packId,
    })),
    ...ps.map((p) => ({
      libraryId:    `ps:${p.id}`,
      source:       "purplesharp" as const,
      framework:    "purplesharp" as const,
      refId:        p.id,
      techniqueId:  p.techniqueId,
      techniqueName: p.techniqueName,
      displayName:  `${p.techniqueName} — variation ${p.variation}${p.variationLabel ? ` (${p.variationLabel})` : ""}`,
      description:  (p.description || "").slice(0, 600),
      tactic:       p.tactic,
      requiresUrl:  p.requiresUrl,
      requiresCommand: p.requiresCommand,
      requiredParams: safeJson<string[]>(p.requiredParams, []),
    })),
  ];

  return NextResponse.json({
    total: items.length,
    counts: {
      art: art.length,
      "detection-pack": dp.length,
      purplesharp: ps.length,
    },
    items,
  });
}
