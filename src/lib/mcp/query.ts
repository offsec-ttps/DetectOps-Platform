/**
 * Data-access layer for the detection-content MCP server.
 *
 * Fans out across the four detection stores in dev.db and normalizes to one
 * `McpDetection` shape, plus threat-intel (IOCs, threat actors, CVEs). Reuses the
 * JSON-column filter strategy from src/app/api/community/unified/search/route.ts
 * and the in-process cache from src/lib/community-sources/cache.ts. Read-only.
 *
 *   Stores: "unified"  → community_rules  (Sentinel, Defender XDR, Wazuh, Panther, …)
 *           "sigma"    → community_sigma_rules
 *           "elastic"  → community_elastic_rules
 *           "splunk"   → splunk_detections
 */

import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/community-sources/cache";

export type DetectionStore = "unified" | "sigma" | "elastic" | "splunk";
export const ALL_STORES: DetectionStore[] = ["unified", "sigma", "elastic", "splunk"];

export interface McpDetection {
  store: DetectionStore;
  id: string;
  source: string; // human-readable source / vendor
  sourceType?: string;
  title: string;
  description: string;
  severity: string;
  ruleLanguage: string;
  ruleType: string;
  platforms: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  tags: string[];
  sourceUrl: string;
  detectionLogicRaw?: string; // only populated by getDetection()
  _ts?: number; // internal: for cross-store recency sort
}

const safe = <T,>(s: string | null | undefined, fb: T): T => {
  try {
    return JSON.parse(s || "") as T;
  } catch {
    return fb;
  }
};
const clampLimit = (n: unknown, def = 25, max = 100) => Math.min(max, Math.max(1, parseInt(String(n ?? def), 10) || def));
const ts = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0);

// ── normalizers ────────────────────────────────────────────────────────────
function normUnified(r: any): McpDetection {
  return {
    store: "unified",
    id: r.id,
    source: r.source?.name ?? "Community",
    sourceType: r.source?.type,
    title: r.title,
    description: r.description || "",
    severity: r.severity || "",
    ruleLanguage: r.ruleLanguage || "",
    ruleType: r.ruleType || "",
    platforms: safe<string[]>(r.platforms, []),
    mitreTechniques: safe<string[]>(r.mitreTechniques, []),
    mitreTactics: safe<string[]>(r.mitreTactics, []),
    tags: safe<string[]>(r.tags, []),
    sourceUrl: r.sourceUrl || "",
    detectionLogicRaw: r.detectionLogicRaw ?? undefined,
    _ts: ts(r.updatedAt),
  };
}
function normSigma(r: any): McpDetection {
  return {
    store: "sigma",
    id: r.id,
    source: "SigmaHQ",
    sourceType: "sigma",
    title: r.title,
    description: r.description || "",
    severity: r.level || "",
    ruleLanguage: "sigma",
    ruleType: "detection",
    platforms: [r.logsourceProduct, r.logsourceCategory, r.logsourceService].filter(Boolean),
    mitreTechniques: safe<string[]>(r.mitreTechniques, []),
    mitreTactics: [],
    tags: safe<string[]>(r.tags, []),
    sourceUrl: r.repositoryUrl || "",
    detectionLogicRaw: r.detectionYaml ?? undefined,
    _ts: ts(r.updatedAt),
  };
}
function normElastic(r: any): McpDetection {
  return {
    store: "elastic",
    id: r.id,
    source: "Elastic Security",
    sourceType: "elastic",
    title: r.name,
    description: r.description || "",
    severity: r.severity || "",
    ruleLanguage: r.language || r.type || "eql",
    ruleType: r.type || "detection",
    platforms: [r.platform].filter(Boolean),
    mitreTechniques: safe<string[]>(r.mitreTechniques, []),
    mitreTactics: safe<string[]>(r.mitreTactics, []),
    tags: safe<string[]>(r.tags, []),
    sourceUrl: r.repositoryUrl || "",
    detectionLogicRaw: r.ruleContent || r.query || undefined,
    _ts: ts(r.updatedAt),
  };
}
function normSplunk(r: any): McpDetection {
  return {
    store: "splunk",
    id: r.id,
    source: "Splunk Security Content",
    sourceType: "splunk",
    title: r.name,
    description: r.description || "",
    severity: "",
    ruleLanguage: "spl",
    ruleType: r.type || "detection",
    platforms: safe<string[]>(r.products, []),
    mitreTechniques: safe<string[]>(r.mitreTechniques, []),
    mitreTactics: safe<string[]>(r.mitreTactics, []),
    tags: r.category ? [r.category] : [],
    sourceUrl: r.sourceUrl || "",
    detectionLogicRaw: r.search ?? undefined,
    _ts: ts(r.updatedAt),
  };
}

// Per-store coarse SQL prefilter caps (bound memory when no q/technique given).
const STORE_CAP = 3000;

// ── search ─────────────────────────────────────────────────────────────────
export interface SearchFilters {
  q?: string;
  technique?: string;
  tactic?: string;
  platform?: string;
  severity?: string;
  ruleLanguage?: string;
  ruleType?: string;
  stores?: DetectionStore[];
  limit?: number;
  offset?: number;
}

export async function searchDetections(f: SearchFilters): Promise<{ total: number; items: McpDetection[] }> {
  const key = `mcp:search:${JSON.stringify(f)}`;
  return cached(key, 30_000, async () => {
    const q = (f.q || "").trim();
    const technique = (f.technique || "").trim().toUpperCase();
    const tactic = (f.tactic || "").trim().toUpperCase();
    const platform = (f.platform || "").trim().toLowerCase();
    const severity = (f.severity || "").trim().toLowerCase();
    const ruleLanguage = (f.ruleLanguage || "").trim().toLowerCase();
    const ruleType = (f.ruleType || "").trim().toLowerCase();
    const stores = f.stores && f.stores.length ? f.stores : ALL_STORES;
    const limit = clampLimit(f.limit, 25, 100);
    const offset = Math.max(0, parseInt(String(f.offset ?? 0), 10) || 0);

    let all: McpDetection[] = [];

    // unified: community_rules
    if (stores.includes("unified")) {
      const where: any = { changeStatus: { not: "deleted" } };
      if (q) where.OR = [{ title: { contains: q } }, { description: { contains: q } }, { upstreamRuleId: { contains: q } }];
      if (technique) where.mitreTechniques = { contains: technique };
      const rows = await prisma.communityRule.findMany({
        where,
        include: { source: { select: { name: true, type: true } } },
        orderBy: { updatedAt: "desc" },
        take: q || technique ? undefined : STORE_CAP,
      });
      all = all.concat(rows.map(normUnified));
    }
    // sigma
    if (stores.includes("sigma")) {
      const where: any = { changeStatus: { not: "deleted" } };
      if (q) where.OR = [{ title: { contains: q } }, { description: { contains: q } }];
      if (technique) where.mitreTechniques = { contains: technique };
      const rows = await prisma.communitySigmaRule.findMany({ where, orderBy: { updatedAt: "desc" }, take: q || technique ? undefined : STORE_CAP });
      all = all.concat(rows.map(normSigma));
    }
    // elastic
    if (stores.includes("elastic")) {
      const where: any = { changeStatus: { not: "deleted" } };
      if (q) where.OR = [{ name: { contains: q } }, { description: { contains: q } }];
      if (technique) where.mitreTechniques = { contains: technique };
      const rows = await prisma.communityElasticRule.findMany({ where, orderBy: { updatedAt: "desc" }, take: q || technique ? undefined : STORE_CAP });
      all = all.concat(rows.map(normElastic));
    }
    // splunk
    if (stores.includes("splunk")) {
      const where: any = {};
      if (q) where.OR = [{ name: { contains: q } }, { description: { contains: q } }];
      if (technique) where.mitreTechniques = { contains: technique };
      const rows = await prisma.splunkDetection.findMany({ where, orderBy: { updatedAt: "desc" }, take: q || technique ? undefined : STORE_CAP });
      all = all.concat(rows.map(normSplunk));
    }

    // Fine JS filters over the normalized shape (array/vocabulary-aware).
    let items = all;
    if (technique) items = items.filter((r) => r.mitreTechniques.some((t) => t.toUpperCase() === technique || t.toUpperCase().startsWith(technique + ".")));
    if (tactic) items = items.filter((r) => r.mitreTactics.some((t) => t.toUpperCase() === tactic) || r.mitreTactics.map((x) => x.toLowerCase()).includes(tactic.toLowerCase()));
    if (platform) items = items.filter((r) => r.platforms.some((p) => p.toLowerCase().includes(platform)));
    if (severity) items = items.filter((r) => r.severity.toLowerCase() === severity);
    if (ruleLanguage) items = items.filter((r) => r.ruleLanguage.toLowerCase() === ruleLanguage);
    if (ruleType) items = items.filter((r) => r.ruleType.toLowerCase() === ruleType);

    items.sort((a, b) => (b._ts || 0) - (a._ts || 0));
    const total = items.length;
    const page = items.slice(offset, offset + limit).map(strip);
    return { total, items: page };
  });
}

/** Drop internal fields + heavy raw body from list results. */
function strip(d: McpDetection): McpDetection {
  const { _ts, detectionLogicRaw, ...rest } = d;
  return rest as McpDetection;
}

// ── detail ─────────────────────────────────────────────────────────────────
export async function getDetection(args: { store: DetectionStore; id: string }): Promise<McpDetection | null> {
  const { store, id } = args;
  if (store === "unified") {
    const r = await prisma.communityRule.findUnique({ where: { id }, include: { source: { select: { name: true, type: true } } } });
    return r ? cleanTs(normUnified(r)) : null;
  }
  if (store === "sigma") {
    const r = await prisma.communitySigmaRule.findUnique({ where: { id } });
    return r ? cleanTs(normSigma(r)) : null;
  }
  if (store === "elastic") {
    const r = await prisma.communityElasticRule.findUnique({ where: { id } });
    return r ? cleanTs(normElastic(r)) : null;
  }
  if (store === "splunk") {
    const r = await prisma.splunkDetection.findUnique({ where: { id } });
    return r ? cleanTs(normSplunk(r)) : null;
  }
  return null;
}
function cleanTs(d: McpDetection): McpDetection {
  const { _ts, ...rest } = d;
  return rest as McpDetection;
}

// ── convenience wrappers ────────────────────────────────────────────────────
export function listByMitre(args: { technique?: string; tactic?: string; limit?: number }) {
  return searchDetections({ technique: args.technique, tactic: args.tactic, limit: args.limit });
}
export function listByPlatform(args: { platform: string; limit?: number }) {
  return searchDetections({ platform: args.platform, limit: args.limit });
}

export async function latestDetections(args: { limit?: number }): Promise<McpDetection[]> {
  const limit = clampLimit(args.limit, 25, 100);
  return cached(`mcp:latest:${limit}`, 30_000, async () => {
    const [u, s, e, p] = await Promise.all([
      prisma.communityRule.findMany({ where: { changeStatus: { not: "deleted" } }, include: { source: { select: { name: true, type: true } } }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.communitySigmaRule.findMany({ where: { changeStatus: { not: "deleted" } }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.communityElasticRule.findMany({ where: { changeStatus: { not: "deleted" } }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.splunkDetection.findMany({ orderBy: { updatedAt: "desc" }, take: limit }),
    ]);
    const merged = [...u.map(normUnified), ...s.map(normSigma), ...e.map(normElastic), ...p.map(normSplunk)];
    merged.sort((a, b) => (b._ts || 0) - (a._ts || 0));
    return merged.slice(0, limit).map(strip);
  });
}

// ── sources / vendors ───────────────────────────────────────────────────────
export async function listSources(): Promise<Array<{ store: DetectionStore; name: string; type: string; ruleCount: number }>> {
  return cached("mcp:sources", 60_000, async () => {
    const unified = await prisma.communitySource.findMany({ where: { unifiedRules: { some: {} } }, select: { name: true, type: true, _count: { select: { unifiedRules: true } } } });
    const [sigma, elastic, splunk] = await Promise.all([
      prisma.communitySigmaRule.count({ where: { changeStatus: { not: "deleted" } } }),
      prisma.communityElasticRule.count({ where: { changeStatus: { not: "deleted" } } }),
      prisma.splunkDetection.count(),
    ]);
    const out: Array<{ store: DetectionStore; name: string; type: string; ruleCount: number }> = [
      { store: "sigma", name: "SigmaHQ", type: "sigma", ruleCount: sigma },
      { store: "elastic", name: "Elastic Security", type: "elastic", ruleCount: elastic },
      { store: "splunk", name: "Splunk Security Content", type: "splunk", ruleCount: splunk },
    ];
    for (const s of unified) out.push({ store: "unified", name: s.name, type: s.type, ruleCount: (s as any)._count.unifiedRules });
    return out.sort((a, b) => b.ruleCount - a.ruleCount);
  });
}

export async function listByVendor(args: { vendor: string; limit?: number }): Promise<{ total: number; items: McpDetection[] }> {
  const vendor = (args.vendor || "").trim().toLowerCase();
  const limit = clampLimit(args.limit, 25, 100);
  if (!vendor) return { total: 0, items: [] };
  // vendor ≈ source name: pull recent from each store then filter by source match.
  const recent = await latestDetectionsRaw(500);
  const items = recent.filter((r) => r.source.toLowerCase().includes(vendor) || (r.sourceType || "").toLowerCase().includes(vendor));
  return { total: items.length, items: items.slice(0, limit).map(strip) };
}
async function latestDetectionsRaw(cap: number): Promise<McpDetection[]> {
  const [u, s, e, p] = await Promise.all([
    prisma.communityRule.findMany({ where: { changeStatus: { not: "deleted" } }, include: { source: { select: { name: true, type: true } } }, orderBy: { updatedAt: "desc" }, take: cap }),
    prisma.communitySigmaRule.findMany({ where: { changeStatus: { not: "deleted" } }, orderBy: { updatedAt: "desc" }, take: cap }),
    prisma.communityElasticRule.findMany({ where: { changeStatus: { not: "deleted" } }, orderBy: { updatedAt: "desc" }, take: cap }),
    prisma.splunkDetection.findMany({ orderBy: { updatedAt: "desc" }, take: cap }),
  ]);
  return [...u.map(normUnified), ...s.map(normSigma), ...e.map(normElastic), ...p.map(normSplunk)];
}

// ── threat intel: IOCs / CVE / actors / malware ─────────────────────────────
export interface McpIoc {
  id: string;
  type: string;
  value: string;
  confidence: string | null;
  tlp: string | null;
  context: string | null;
  mitreTechniques: string[];
  tags: string[];
  firstSeen: Date | null;
  lastSeen: Date | null;
  sourceRef: string | null;
}
function normIoc(r: any): McpIoc {
  return {
    id: r.id,
    type: r.type,
    value: r.value,
    confidence: r.confidence,
    tlp: r.tlp,
    context: r.context,
    mitreTechniques: safe<string[]>(r.mitreTechniques, []),
    tags: safe<string[]>(r.tags, []),
    firstSeen: r.firstSeen ?? null,
    lastSeen: r.lastSeen ?? null,
    sourceRef: r.sourceRef,
  };
}

export async function searchIocs(args: { type?: string; value?: string; confidence?: string; limit?: number }): Promise<{ total: number; items: McpIoc[] }> {
  const limit = clampLimit(args.limit, 50, 200);
  const where: any = {};
  if (args.type) where.type = args.type.trim().toLowerCase();
  if (args.value) where.value = { contains: args.value.trim() }; // value is indexed → fast path
  if (args.confidence) where.confidence = args.confidence.trim().toLowerCase();
  const [total, rows] = await Promise.all([
    prisma.tiIndicator.count({ where }),
    prisma.tiIndicator.findMany({ where, orderBy: { lastSeen: "desc" }, take: limit }),
  ]);
  return { total, items: rows.map(normIoc) };
}

export interface McpThreatReport {
  id: string;
  threatId: string;
  title: string;
  summary: string;
  category: string;
  severity: string;
  threatActor: string;
  aliases: string[];
  nationState: string | null;
  mitreTechniques: any[];
  targetSectors: string[];
  sourceVendor: string | null;
  sourceUrl: string | null;
}
function normReport(r: any): McpThreatReport {
  return {
    id: r.id,
    threatId: r.threatId,
    title: r.title,
    summary: (r.summary || "").slice(0, 400),
    category: r.category || "",
    severity: r.severityLevel || "",
    threatActor: r.threatActor || "",
    aliases: safe<string[]>(r.threatActorAliases, []),
    nationState: r.nationState || null,
    mitreTechniques: safe<any[]>(r.mitreTechniques, []),
    targetSectors: safe<string[]>(r.targetSectors, []),
    sourceVendor: r.sourceVendor || null,
    sourceUrl: r.sourceUrl || null,
  };
}

export async function searchByCve(args: { cve: string; limit?: number }): Promise<{ indicators: McpIoc[]; reports: McpThreatReport[] }> {
  const cve = (args.cve || "").trim().toUpperCase();
  const limit = clampLimit(args.limit, 25, 100);
  if (!cve) return { indicators: [], reports: [] };
  const [iocs, reports] = await Promise.all([
    prisma.tiIndicator.findMany({ where: { type: "cve", value: { contains: cve } }, take: limit }),
    prisma.threatIntelReport.findMany({
      where: { OR: [{ title: { contains: cve } }, { summary: { contains: cve } }, { description: { contains: cve } }, { affected: { contains: cve } }] },
      orderBy: { sourceCreated: "desc" },
      take: limit,
    }),
  ]);
  return { indicators: iocs.map(normIoc), reports: reports.map(normReport) };
}

export async function searchThreatActors(args: { actor: string; limit?: number }): Promise<{ total: number; items: McpThreatReport[] }> {
  const actor = (args.actor || "").trim();
  const limit = clampLimit(args.limit, 25, 100);
  if (!actor) return { total: 0, items: [] };
  const where: any = { OR: [{ threatActor: { contains: actor } }, { threatActorAliases: { contains: actor } }, { title: { contains: actor } }] };
  const [total, rows] = await Promise.all([
    prisma.threatIntelReport.count({ where }),
    prisma.threatIntelReport.findMany({ where, orderBy: { sourceCreated: "desc" }, take: limit }),
  ]);
  return { total, items: rows.map(normReport) };
}

export async function searchByMalwareFamily(args: { family: string; limit?: number }): Promise<{ total: number; items: McpThreatReport[] }> {
  const family = (args.family || "").trim();
  const limit = clampLimit(args.limit, 25, 100);
  if (!family) return { total: 0, items: [] };
  // Best-effort: no dedicated malware-family column exists — text-scan reports.
  const where: any = { OR: [{ title: { contains: family } }, { summary: { contains: family } }, { tags: { contains: family } }, { threatActor: { contains: family } }] };
  const [total, rows] = await Promise.all([
    prisma.threatIntelReport.count({ where }),
    prisma.threatIntelReport.findMany({ where, orderBy: { sourceCreated: "desc" }, take: limit }),
  ]);
  return { total, items: rows.map(normReport) };
}

// ── stats ────────────────────────────────────────────────────────────────
export async function getStats(): Promise<any> {
  return cached("mcp:stats", 60_000, async () => {
    const [unified, sigma, elastic, splunk, reports, indicators] = await Promise.all([
      prisma.communityRule.count({ where: { changeStatus: { not: "deleted" } } }),
      prisma.communitySigmaRule.count({ where: { changeStatus: { not: "deleted" } } }),
      prisma.communityElasticRule.count({ where: { changeStatus: { not: "deleted" } } }),
      prisma.splunkDetection.count(),
      prisma.threatIntelReport.count(),
      prisma.tiIndicator.count(),
    ]);
    const iocByType = await prisma.tiIndicator.groupBy({ by: ["type"], _count: { _all: true } });
    return {
      detections: { total: unified + sigma + elastic + splunk, unified, sigma, elastic, splunk },
      threatIntel: { reports, indicators, indicatorsByType: Object.fromEntries(iocByType.map((g) => [g.type, g._count._all])) },
      sources: await listSources(),
    };
  });
}
