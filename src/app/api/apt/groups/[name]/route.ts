/**
 * GET /api/apt/groups/[name] — one APT group: its geo/sector profile and the
 * Atomic Red Team tests it exercises. Each atomic is resolved from the local
 * AtomicTest library by `testGuid`, so the returned `atomicTestId`/command are
 * exactly what the existing atomic runner executes (the simulate "one route").
 *
 * Query: q (search), platform, tactic, page, page_size (default 100).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { name } = await params;
  const groupName = decodeURIComponent(name);

  const group = await prisma.aptGroup.findUnique({ where: { name: groupName } });
  if (!group) return NextResponse.json({ error: `APT group "${groupName}" not found` }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim().toLowerCase();
  const platform = (sp.get("platform") || "").trim().toLowerCase();
  const tactic = (sp.get("tactic") || "").trim().toLowerCase();
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get("page_size") || "100", 10) || 100));

  const maps = await prisma.aptAtomic.findMany({ where: { groupName } });

  // Resolve commands from the local Atomic Red Team library by GUID.
  const guids = [...new Set(maps.map((m) => m.testGuid).filter(Boolean))];
  const tests = await prisma.atomicTest.findMany({ where: { testGuid: { in: guids } } });
  const byGuid = new Map(tests.map((t) => [t.testGuid.toLowerCase(), t]));

  let rows = maps.map((m) => {
    const t = byGuid.get(m.testGuid.toLowerCase());
    let platforms: string[] = [];
    try { platforms = t ? JSON.parse(t.platforms || "[]") : (m.platform ? [m.platform] : []); } catch { platforms = m.platform ? [m.platform] : []; }
    return {
      atomicTestId: t?.id || null,            // null = GUID not in local ART library (not runnable until synced)
      testGuid: m.testGuid,
      techniqueId: m.techniqueId,
      techniqueName: m.techniqueName || t?.techniqueName || "",
      testName: m.testName || t?.testName || "",
      testNumber: t?.testNumber ?? null,
      platform: m.platform || platforms[0] || "",
      platforms,
      executor: t?.executorName || m.executor || "",
      tactic: m.tactic || t?.tactic || "",
      command: t?.command || "",
      cleanupCommand: t?.cleanupCommand || "",
      description: t?.testDescription || "",
      elevationRequired: t?.elevationRequired ?? false,
      runnable: !!t?.id,
    };
  });

  // In-group filters.
  if (q) rows = rows.filter((r) => `${r.techniqueId} ${r.techniqueName} ${r.testName}`.toLowerCase().includes(q));
  if (platform) rows = rows.filter((r) => r.platform.toLowerCase() === platform || r.platforms.map((p) => p.toLowerCase()).includes(platform));
  if (tactic) rows = rows.filter((r) => r.tactic.toLowerCase().includes(tactic));

  rows.sort((a, b) => a.techniqueId.localeCompare(b.techniqueId) || a.testName.localeCompare(b.testName));

  const total = rows.length;
  const runnable = rows.filter((r) => r.runnable).length;
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize);

  const parse = (s: string) => { try { return JSON.parse(s || "[]") as string[]; } catch { return []; } };
  return NextResponse.json({
    group: {
      name: group.name,
      mitreId: group.mitreId,
      originCountry: group.originCountry || "",
      originCode: group.originCode || "",
      actorType: group.actorType,
      aliases: parse(group.aliases),
      sectors: parse(group.sectors),
      primarySectors: parse(group.primarySectors),
      targetedCountries: parse(group.targetedCountries),
      tactics: parse(group.tactics),
      atomicCount: group.atomicCount,
    },
    total, runnable, page, pageSize, totalPages: Math.ceil(total / pageSize),
    items,
  });
}
