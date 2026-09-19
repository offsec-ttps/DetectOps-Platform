import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * ATT&CK Enterprise technique count (techniques + sub-techniques), used as the
 * denominator for coverage. A constant because the platform has no local copy of
 * the ATT&CK catalogue; update it when the matrix version is bumped.
 */
const ATTACK_ENTERPRISE_TECHNIQUES = 656;

const TECHNIQUE_ID = /\bT\d{4}(?:\.\d{3})?\b/g;

/** A single malformed row must not 500 the whole dashboard. */
function safeParseArray(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Cached so the scan doesn't re-run on every dashboard poll. */
let techniqueCache: { at: number; value: TechniqueCoverage } | null = null;
const TECHNIQUE_TTL_MS = 60_000;

interface TechniqueCoverage {
  covered: number;      // distinct techniques referenced by at least one rule
  baseCovered: number;  // ditto, collapsing sub-techniques (T1059.001 -> T1059)
  simulatable: number;  // distinct techniques with at least one atomic test
  validated: number;    // simulatable AND covered by a rule
}

/**
 * Distinct ATT&CK techniques referenced by the rule libraries. The columns hold
 * JSON arrays of technique IDs, so we regex rather than parse — some rows carry
 * malformed or empty JSON and a parse error should not blank the dashboard.
 */
async function getTechniqueCoverage(): Promise<TechniqueCoverage> {
  if (techniqueCache && Date.now() - techniqueCache.at < TECHNIQUE_TTL_MS) {
    return techniqueCache.value;
  }

  const collect = (rows: { mitreTechniques?: string | null; techniqueId?: string | null }[]) => {
    const found = new Set<string>();
    for (const r of rows) {
      const raw = r.mitreTechniques ?? r.techniqueId;
      if (!raw) continue;
      for (const m of String(raw).matchAll(TECHNIQUE_ID)) found.add(m[0]);
    }
    return found;
  };

  const [splunkRows, sigmaRows, communityRows, atomicRows] = await Promise.all([
    prisma.splunkDetection.findMany({ select: { mitreTechniques: true } }),
    prisma.communitySigmaRule.findMany({ select: { mitreTechniques: true } }),
    prisma.communityRule.findMany({ select: { mitreTechniques: true } }),
    prisma.atomicTest.findMany({ select: { techniqueId: true } }),
  ]);

  const byRules = new Set([
    ...collect(splunkRows), ...collect(sigmaRows), ...collect(communityRows),
  ]);
  const byAtomics = collect(atomicRows);

  const value: TechniqueCoverage = {
    covered: byRules.size,
    baseCovered: new Set([...byRules].map((t) => t.split(".")[0])).size,
    simulatable: byAtomics.size,
    validated: [...byAtomics].filter((t) => byRules.has(t)).length,
  };
  techniqueCache = { at: Date.now(), value };
  return value;
}

export async function GET() {
  // Run all queries in parallel
  const [
    splunkTotal, sigmaTotal, elasticTotal, customTotal, atomicTotal,
    splunkVerified, simulations, reports, integrations,
    splunkByCategory, splunkByType, splunkByStatus, splunkByDomain,
    simByStatus, reportsbyStatus,
    // Counts below are the AUTHORITATIVE totals. The `simulations`/`reports`
    // lists above are capped (take:20 / take:10) because they only feed the
    // "recent" tables — using their .length as a total under-reports every
    // number once you have more history than the cap.
    communityTotal, communityBySource, simulationsTotal, reportsTotal, reportsPushed,
  ] = await Promise.all([
    prisma.splunkDetection.count(),
    prisma.communitySigmaRule.count(),
    prisma.communityElasticRule.count(),
    prisma.customDetection.count(),
    prisma.atomicTest.count(),
    prisma.splunkDetection.count({ where: { verified: true } }),
    prisma.simulationRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    prisma.detectionReport.findMany({ orderBy: { updatedAt: "desc" }, take: 10 }),
    prisma.integration.findMany(),
    // Platform distribution from Splunk detections (category maps to platform)
    prisma.splunkDetection.groupBy({ by: ["category"], _count: true }),
    prisma.splunkDetection.groupBy({ by: ["type"], _count: true }),
    prisma.splunkDetection.groupBy({ by: ["status"], _count: true }),
    prisma.splunkDetection.groupBy({ by: ["securityDomain"], _count: true }),
    prisma.simulationRun.groupBy({ by: ["status"], _count: true }),
    prisma.detectionReport.groupBy({ by: ["status"], _count: true }),
    // CommunityRule is a separate library from the Sigma/Elastic tables — it
    // holds Wazuh, Sentinel, Defender XDR, Panther, Chronicle, CAR and Falco
    // content. It was missing from the totals entirely, which hid more than
    // half of the installed rules.
    prisma.communityRule.count(),
    prisma.communityRule.groupBy({ by: ["sourceId"], _count: true }),
    prisma.simulationRun.count(),
    prisma.detectionReport.count(),
    prisma.detectionReport.count({ where: { NOT: { githubPushedAt: null } } }),
  ]);

  // Platform distribution — Splunk categories + Sigma/Elastic logsource products
  // Sigma rules have logsourceProduct stored as part of the rule
  const sigmaProducts = await prisma.communitySigmaRule.groupBy({ by: ["logsourceProduct"], _count: true, orderBy: { _count: { logsourceProduct: "desc" } }, take: 15 });
  const elasticPlatforms = await prisma.communityElasticRule.groupBy({ by: ["platform"], _count: true, orderBy: { _count: { platform: "desc" } }, take: 10 });

  // Build platform distribution map
  const platformMap: Record<string, number> = {};
  // From Splunk categories
  for (const c of splunkByCategory) {
    const name = c.category || "other";
    platformMap[name] = (platformMap[name] || 0) + c._count;
  }
  // From Sigma products
  for (const p of sigmaProducts) {
    const name = (p.logsourceProduct || "other").toLowerCase();
    platformMap[name] = (platformMap[name] || 0) + p._count;
  }
  // From Elastic platforms
  for (const p of elasticPlatforms) {
    const name = (p.platform || "other").toLowerCase();
    platformMap[name] = (platformMap[name] || 0) + p._count;
  }

  // Normalize platform names
  const normalizedPlatforms: Record<string, number> = {};
  for (const [key, count] of Object.entries(platformMap)) {
    const k = key.toLowerCase();
    if (k.includes("windows") || k === "endpoint") normalizedPlatforms["Windows"] = (normalizedPlatforms["Windows"] || 0) + count;
    else if (k.includes("linux") || k === "linux") normalizedPlatforms["Linux"] = (normalizedPlatforms["Linux"] || 0) + count;
    else if (k.includes("aws") || k.includes("amazon") || k.includes("cloudtrail")) normalizedPlatforms["AWS"] = (normalizedPlatforms["AWS"] || 0) + count;
    else if (k.includes("azure") || k.includes("microsoft") || k.includes("m365") || k.includes("entra")) normalizedPlatforms["Azure / M365"] = (normalizedPlatforms["Azure / M365"] || 0) + count;
    else if (k.includes("gcp") || k.includes("google")) normalizedPlatforms["GCP"] = (normalizedPlatforms["GCP"] || 0) + count;
    else if (k.includes("macos") || k.includes("mac")) normalizedPlatforms["macOS"] = (normalizedPlatforms["macOS"] || 0) + count;
    else if (k.includes("network") || k.includes("firewall") || k.includes("dns") || k.includes("proxy")) normalizedPlatforms["Network"] = (normalizedPlatforms["Network"] || 0) + count;
    else if (k.includes("cloud") || k.includes("saas") || k.includes("okta")) normalizedPlatforms["Cloud / SaaS"] = (normalizedPlatforms["Cloud / SaaS"] || 0) + count;
    else if (k.includes("web") || k.includes("apache") || k.includes("nginx")) normalizedPlatforms["Web"] = (normalizedPlatforms["Web"] || 0) + count;
    else if (k.includes("application") || k.includes("antivirus")) normalizedPlatforms["Application"] = (normalizedPlatforms["Application"] || 0) + count;
    else if (k.includes("container") || k.includes("kubernetes") || k.includes("docker")) normalizedPlatforms["Containers"] = (normalizedPlatforms["Containers"] || 0) + count;
    else normalizedPlatforms["Other"] = (normalizedPlatforms["Other"] || 0) + count;
  }

  // Sort platforms by count
  const platforms = Object.entries(normalizedPlatforms)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Simulation stats — `simulationsTotal` is the real count; `simulations` is
  // only the 20 most recent rows used by the table below.
  const simStats = {
    total: simulationsTotal,
    success: simByStatus.find((s) => s.status === "success")?._count || 0,
    failure: simByStatus.find((s) => s.status === "failure")?._count || 0,
    error: simByStatus.find((s) => s.status === "error")?._count || 0,
    running: simByStatus.find((s) => s.status === "running")?._count || 0,
  };

  // Connected integrations
  const connectedIntegrations = integrations.filter((i) => i.connected);
  const enabledIntegrations = integrations.filter((i) => i.enabled);

  // Total detection rules — every rule library the platform has ingested.
  const totalRules = splunkTotal + sigmaTotal + elasticTotal + customTotal + communityTotal;

  // Real ATT&CK coverage: the distinct techniques our rules actually reference.
  // This previously read `min(100, (totalRules / 100) * 1.2)` — a function of how
  // many rules exist, not of what they cover, which pinned the figure at 100% as
  // soon as the library passed ~8.3k rules and told an operator nothing.
  const techniques = await getTechniqueCoverage();
  const attackCoverage = Math.min(
    100,
    Math.round((techniques.covered / ATTACK_ENTERPRISE_TECHNIQUES) * 100),
  );

  // Content freshness = when each rule library was last synced. (The rules' own
  // modified dates are upstream authoring dates, not ingest dates, so they say
  // nothing about whether YOUR copy is current.)
  const sourceSyncs = await prisma.communitySource.findMany({
    select: { id: true, name: true, lastSyncAt: true, totalRules: true },
    orderBy: { lastSyncAt: "desc" },
  });
  const sourceNames = new Map(sourceSyncs.map((s) => [s.id, s.name]));
  const lastSync = sourceSyncs.find((s) => s.lastSyncAt)?.lastSyncAt ?? null;
  const freshnessDays = lastSync
    ? Math.floor((Date.now() - new Date(lastSync).getTime()) / 86_400_000)
    : null;

  return NextResponse.json({
    totalRules,
    sources: {
      splunk: { total: splunkTotal, verified: splunkVerified },
      sigma: { total: sigmaTotal },
      elastic: { total: elasticTotal },
      custom: { total: customTotal },
      community: {
        total: communityTotal,
        bySource: communityBySource
          .map((g) => ({
            name: sourceNames.get(g.sourceId) || "Unknown",
            count: g._count,
          }))
          .sort((a, b) => b.count - a.count),
      },
    },
    techniques,
    freshness: {
      lastSyncAt: lastSync,
      days: freshnessDays,
      sources: sourceSyncs
        .filter((s) => s.lastSyncAt)
        .map((s) => ({ name: s.name, lastSyncAt: s.lastSyncAt, totalRules: s.totalRules })),
    },
    platforms,
    splunkTypes: splunkByType.map((t) => ({ name: t.type || "Unknown", count: t._count })),
    splunkStatuses: splunkByStatus.map((s) => ({ name: s.status || "Unknown", count: s._count })),
    splunkDomains: splunkByDomain.map((d) => ({ name: d.securityDomain || "Unknown", count: d._count })),
    atomicTests: atomicTotal,
    simulations: simStats,
    recentSimulations: simulations.map((s) => {
      // Per-run detection outcome. The table used to print the GLOBAL verified
      // count on every row, so each simulation appeared to have the same result.
      let detections: { detected: number; total: number } | null = null;
      try {
        const parsed = JSON.parse(s.detectionResults || "[]");
        if (Array.isArray(parsed) && parsed.length > 0) {
          detections = {
            detected: parsed.filter((d: { status?: string }) => d?.status === "detected").length,
            total: parsed.length,
          };
        }
      } catch { /* a malformed row shouldn't blank the table */ }
      return {
        id: s.id,
        techniques: safeParseArray(s.techniqueIds),
        target: s.targetServer,
        status: s.status,
        durationMs: s.durationMs,
        startedAt: s.startedAt,
        detections,
      };
    }),
    reports: {
      total: reportsTotal,
      byStatus: reportsbyStatus.map((r) => ({ status: r.status, count: r._count })),
      pushed: reportsPushed,
    },
    integrations: {
      total: integrations.length,
      connected: connectedIntegrations.length,
      enabled: enabledIntegrations.length,
      list: integrations.map((i) => ({ name: i.name, type: i.type, connected: i.connected, enabled: i.enabled })),
    },
    attackCoverage,
    threatIntel: await getThreatIntelStats(),
  });
}

async function getThreatIntelStats() {
  try {
    const [threatCount, articleCount, indicatorCount, sourceCount,
      byCategory, bySeverity, byActor, byNation] = await Promise.all([
      prisma.threatIntelReport.count(),
      prisma.tiArticle.count(),
      prisma.tiIndicator.count(),
      prisma.tiFeedSource.count({ where: { active: true } }),
      prisma.threatIntelReport.groupBy({ by: ["category"], _count: true, orderBy: { _count: { category: "desc" } } }),
      prisma.threatIntelReport.groupBy({ by: ["severityLevel"], _count: true }),
      prisma.threatIntelReport.groupBy({ by: ["threatActor"], _count: true, orderBy: { _count: { threatActor: "desc" } }, take: 10 }),
      prisma.threatIntelReport.groupBy({ by: ["nationState"], _count: true, orderBy: { _count: { nationState: "desc" } }, take: 10 }),
    ]);

    // Sectors
    const sectorMap: Record<string, number> = {};
    const threats = await prisma.threatIntelReport.findMany({ select: { targetSectors: true } });
    for (const t of threats) {
      for (const s of JSON.parse(t.targetSectors) as string[]) {
        const norm = s.toLowerCase().replace(/-/g, " ");
        sectorMap[norm] = (sectorMap[norm] || 0) + 1;
      }
    }

    return {
      counts: { threats: threatCount, articles: articleCount, indicators: indicatorCount, sources: sourceCount },
      categories: byCategory.map((c) => ({ name: c.category || "Unknown", count: c._count })),
      severities: bySeverity.map((s) => ({ name: s.severityLevel || "Unknown", count: s._count })),
      actors: byActor.filter((a) => a.threatActor).map((a) => ({ name: a.threatActor, count: a._count })),
      nations: byNation.filter((n) => n.nationState).map((n) => ({ name: n.nationState, count: n._count })),
      sectors: Object.entries(sectorMap).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count })),
    };
  } catch {
    return { counts: { threats: 0, articles: 0, indicators: 0, sources: 0 }, categories: [], severities: [], actors: [], nations: [], sectors: [] };
  }
}
