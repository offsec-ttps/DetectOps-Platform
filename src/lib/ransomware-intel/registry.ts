/**
 * Collector registry + collection orchestrator for the self-hosted intel engine.
 * Mirrors community-sources/registry.ts: flag-gated collectors, run them all,
 * upsert into our DB with sha256 content-hash change detection, audit each run.
 */

import { prisma } from "@/lib/prisma";
import { hashContent } from "@/lib/community-sources/adapters/_common";
import { isCollectorEnabled } from "./flags";
import { seedAliasMap, seedGangs } from "./seed";
import type { Collector, NormalizedGang, NormalizedVictim } from "./collectors/types";
import { ransomwatchCollector } from "./collectors/ransomwatch";
import { ransomwareLiveCollector } from "./collectors/ransomware-live";
import { torLeaksiteCollector } from "./collectors/tor-leaksite";

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\d+$/, "");

/**
 * Build a normalized-name → canonical-name map from the curated seed aliases +
 * every existing gang's name/aliases. Lets collector slugs (e.g. "lockbit3")
 * reconcile onto curated gangs (e.g. "LockBit") so victims/onion endpoints
 * attach to the right row instead of creating duplicates.
 */
async function buildCanonicalMap(): Promise<Map<string, string>> {
  const m = seedAliasMap();
  const rows = await prisma.ransomwareGang.findMany({ select: { name: true, aliases: true } });
  for (const r of rows) {
    if (!m.has(normKey(r.name))) m.set(normKey(r.name), r.name);
    try { for (const a of JSON.parse(r.aliases) as string[]) if (!m.has(normKey(a))) m.set(normKey(a), r.name); } catch { /* ignore */ }
  }
  return m;
}

export function getCollectors(): Collector[] {
  const out: Collector[] = [];
  if (isCollectorEnabled("ransomwatch")) out.push(ransomwatchCollector);
  if (isCollectorEnabled("ransomwareLive")) out.push(ransomwareLiveCollector);
  if (isCollectorEnabled("tor")) out.push(torLeaksiteCollector);
  return out;
}

export function collectorStatuses() {
  // Show all collectors + whether enabled/active (for the UI).
  return [ransomwatchCollector, ransomwareLiveCollector, torLeaksiteCollector].map((c) => {
    const key = c.id === "ransomwatch" ? "ransomwatch" : c.id === "ransomware-live" ? "ransomwareLive" : "tor";
    return { ...c.meta(), enabled: isCollectorEnabled(key as any) };
  });
}

async function upsertGang(g: NormalizedGang, name: string): Promise<"new" | "updated" | "unchanged"> {
  const hash = hashContent(JSON.stringify({ ...g, name }));
  const existing = await prisma.ransomwareGang.findUnique({ where: { name } });
  const data = {
    aliases: JSON.stringify(g.aliases || []),
    status: g.status || existing?.status || "unknown",
    leakSiteUrls: JSON.stringify(g.leakSiteUrls || []),
    screenshotRef: g.screenshotRef || existing?.screenshotRef || "",
    description: g.description || existing?.description || "",
    profile: JSON.stringify(g.profile || {}),
    targetSectors: JSON.stringify(g.targetSectors || (existing ? JSON.parse(existing.targetSectors) : [])),
    targetRegions: JSON.stringify(g.targetRegions || (existing ? JSON.parse(existing.targetRegions) : [])),
    references: JSON.stringify(g.references || []),
    contentHash: hash,
  };
  if (!existing) {
    // Merge leak-site URLs across collectors for a freshly-created canonical row.
    await prisma.ransomwareGang.create({ data: { name, source: "collector", ...data } });
    return "new";
  }
  // Don't clobber curated/AI enrichment fields (knownTTPs/iocs/signatures) — collectors only refresh profile/leak data.
  // Also union leak-site URLs so a curated gang gains the collector's onion endpoints.
  const mergedLeak = [...new Set([...(JSON.parse(existing.leakSiteUrls || "[]")), ...(g.leakSiteUrls || [])])];
  if (existing.contentHash === hash && JSON.stringify(mergedLeak) === existing.leakSiteUrls) return "unchanged";
  await prisma.ransomwareGang.update({
    where: { name },
    data: { ...data, leakSiteUrls: JSON.stringify(mergedLeak), screenshotRef: existing.screenshotRef || data.screenshotRef, source: existing.source === "seed" ? "seed" : existing.source === "ai" ? "ai" : "collector" },
  });
  return "updated";
}

async function upsertVictim(v: NormalizedVictim, gangName: string): Promise<boolean> {
  const discoveredAt = v.discoveredAt ? new Date(v.discoveredAt) : null;
  const hash = hashContent(JSON.stringify({ ...v, gangName }));
  try {
    await prisma.ransomwareVictim.upsert({
      where: { gangName_victim_discoveredAt: { gangName, victim: v.victim, discoveredAt: discoveredAt as any } },
      create: { gangName, victim: v.victim, sector: v.sector || "", country: v.country || "", postUrl: v.postUrl || "", screenshotRef: v.screenshotRef || "", discoveredAt, contentHash: hash },
      update: { sector: v.sector || undefined, country: v.country || undefined, postUrl: v.postUrl || undefined, contentHash: hash },
    });
    return true;
  } catch { return false; }
}

export async function runCollection(): Promise<{ runId: string; groupsNew: number; groupsUpdated: number; victimsNew: number; errors: string[] }> {
  // Always ensure the curated baseline (TTPs/IOCs/signatures) is present before augmenting.
  await seedGangs().catch(() => {});
  const collectors = getCollectors();
  const run = await prisma.intelCollectionRun.create({ data: { collector: collectors.map((c) => c.id).join(",") || "none", status: "running" } });
  let groupsNew = 0, groupsUpdated = 0, victimsNew = 0;
  const errors: string[] = [];
  const canon = await buildCanonicalMap();
  const resolve = (raw: string) => canon.get(normKey(raw)) || raw;

  for (const c of collectors) {
    try {
      const res = await c.collect();
      errors.push(...res.errors.map((e) => `${c.id}: ${e}`));
      for (const g of res.groups) {
        const name = resolve(g.name);
        const r = await upsertGang(g, name).catch((e) => { errors.push(`${c.id} gang ${g.name}: ${e?.message || e}`); return null; });
        // Newly-created gang becomes canonical for its normalized key (so later collectors merge).
        if (r === "new") { canon.set(normKey(g.name), name); groupsNew++; } else if (r === "updated") groupsUpdated++;
      }
      for (const v of res.victims) { if (await upsertVictim(v, resolve(v.gangName))) victimsNew++; }
    } catch (e: any) {
      errors.push(`${c.id}: ${e?.message || e}`);
    }
  }

  // Refresh per-gang victim counts.
  const counts = await prisma.ransomwareVictim.groupBy({ by: ["gangName"], _count: { _all: true } });
  for (const c of counts) {
    await prisma.ransomwareGang.updateMany({ where: { name: c.gangName }, data: { victimCount: c._count._all } }).catch(() => {});
  }

  await prisma.intelCollectionRun.update({ where: { id: run.id }, data: { status: "success", groupsNew, groupsUpdated, victimsNew, errors: JSON.stringify(errors.slice(0, 50)), completedAt: new Date() } });
  return { runId: run.id, groupsNew, groupsUpdated, victimsNew, errors };
}
