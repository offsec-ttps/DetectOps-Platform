/**
 * GET /api/rule-workspace/candidates
 *
 * Phase 6 — Cross-source candidate selector for Rule Workspace.
 *
 * Returns matching detections from EVERY integrated catalog, in a single
 * unified shape, so an analyst can browse "all rules from all sources that
 * touch this use case", drop one into the editor, and then convert / adapt /
 * draft it.
 *
 * Sources queried:
 *   - community_sigma_rules     (legacy SigmaHQ)        → sigmaConvertible: true
 *   - community_elastic_rules   (legacy Elastic)        → sigmaConvertible: false
 *   - splunk_detections         (legacy Splunk SC)      → sigmaConvertible: false
 *   - community_rules           (all new Phase 2-4 sources) → sigmaConvertible only if ruleLanguage === "sigma"
 *
 * Important constraint from the plan:
 *   "Do not force every rule through Sigma conversion. KQL, YARA-L, Panther
 *    Python, Falco YAML, and Wazuh rule XML should remain reference logic
 *    unless you later implement separate conversion/transpilation support."
 *
 * Query params:
 *   q          — full-text search (title / description / id)
 *   technique  — ATT&CK technique id (T1059, T1059.001 — also matches subs)
 *   tactic     — ATT&CK tactic id (TA0002 …)
 *   platform   — windows | linux | macos | aws | azure | gcp | m365 | …
 *   sigmaOnly  — "true" filters to ONLY sigma-convertible rules
 *   page, pageSize
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const safe = <T,>(s: string, fb: T): T => { try { return JSON.parse(s) as T; } catch { return fb; } };

interface Candidate {
  id: string;
  sourceTable: string;          // which catalog table the rule lives in
  sourceName: string;           // human-readable provenance
  sourceType: string;           // sigma | elastic | splunk | kql | yara-l | …
  upstreamRuleId: string;
  title: string;
  description: string;
  severity: string;
  ruleLanguage: string;
  sigmaConvertible: boolean;
  detectionLogic: string;       // pre-loaded so the editor can show it immediately
  mitreTechniques: string[];
  mitreTactics: string[];
  platforms: string[];
  tags: string[];
}

function matchesQuery(c: Candidate, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    c.title.toLowerCase().includes(needle) ||
    c.description.toLowerCase().includes(needle) ||
    c.upstreamRuleId.toLowerCase().includes(needle)
  );
}

function matchesTechnique(c: Candidate, technique: string): boolean {
  if (!technique) return true;
  const t = technique.toUpperCase();
  return c.mitreTechniques.some((x) => x.toUpperCase() === t || x.toUpperCase().startsWith(t + "."));
}

function matchesTactic(c: Candidate, tactic: string): boolean {
  if (!tactic) return true;
  const t = tactic.toUpperCase();
  return c.mitreTactics.some((x) => x.toUpperCase() === t);
}

function matchesPlatform(c: Candidate, platform: string): boolean {
  if (!platform) return true;
  const p = platform.toLowerCase();
  return c.platforms.some((x) => x.toLowerCase() === p);
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const technique = sp.get("technique")?.trim() ?? "";
  const tactic = sp.get("tactic")?.trim() ?? "";
  const platform = sp.get("platform")?.trim() ?? "";
  const sigmaOnly = sp.get("sigmaOnly") === "true";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "50", 10)));

  // ── 1. Legacy SigmaHQ ──
  // Cheap-side filter on title/description; technique/platform/tactic done in JS
  // because they're stored as JSON strings.
  const sigmaWhere: any = {};
  if (q) {
    sigmaWhere.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
    ];
  }
  const sigmaRows = await prisma.communitySigmaRule.findMany({
    where: sigmaWhere,
    take: 800, // hard cap before JS filtering
    orderBy: { updatedAt: "desc" },
  });
  const sigmaCandidates: Candidate[] = sigmaRows.map((r) => ({
    id: r.id,
    sourceTable: "community_sigma_rules",
    sourceName: "SigmaHQ",
    sourceType: "sigma",
    upstreamRuleId: r.sigmaId ?? r.id,
    title: r.title,
    description: r.description,
    severity: r.level || "info",
    ruleLanguage: "sigma",
    sigmaConvertible: true,
    detectionLogic: r.detectionYaml,
    mitreTechniques: safe<string[]>(r.mitreTechniques, []),
    mitreTactics: [],
    platforms: r.logsourceProduct ? [r.logsourceProduct] : [],
    tags: safe<string[]>(r.tags, []),
  }));

  // ── 2. Legacy Elastic ──
  const elasticWhere: any = {};
  if (q) {
    elasticWhere.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
    ];
  }
  const elasticRows = await prisma.communityElasticRule.findMany({
    where: elasticWhere,
    take: 600,
    orderBy: { updatedAt: "desc" },
  });
  const elasticCandidates: Candidate[] = elasticRows.map((r) => ({
    id: r.id,
    sourceTable: "community_elastic_rules",
    sourceName: "Elastic Detection Rules",
    sourceType: "elastic",
    upstreamRuleId: r.ruleId ?? r.id,
    title: r.name,
    description: r.description,
    severity: r.severity || "info",
    ruleLanguage: r.language || "kuery",
    sigmaConvertible: false, // Elastic rules are TOML/KQL — not Sigma
    detectionLogic: r.query || r.ruleContent,
    mitreTechniques: safe<string[]>(r.mitreTechniques, []),
    mitreTactics: safe<string[]>(r.mitreTactics, []),
    platforms: r.platform ? [r.platform] : [],
    tags: safe<string[]>(r.tags, []),
  }));

  // ── 3. Legacy Splunk Security Content ──
  const splunkWhere: any = {};
  if (q) {
    splunkWhere.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
    ];
  }
  const splunkRows = await prisma.splunkDetection.findMany({
    where: splunkWhere,
    take: 600,
    orderBy: { updatedAt: "desc" },
  });
  const splunkCandidates: Candidate[] = splunkRows.map((r) => ({
    id: r.id,
    sourceTable: "splunk_detections",
    sourceName: "Splunk Security Content",
    sourceType: "splunk",
    upstreamRuleId: r.detectionId,
    title: r.name,
    description: r.description,
    severity: "info",
    ruleLanguage: "spl",
    sigmaConvertible: false, // SPL — not Sigma
    detectionLogic: r.search,
    mitreTechniques: safe<string[]>(r.mitreTechniques, []),
    mitreTactics: safe<string[]>(r.mitreTactics, []),
    platforms: safe<string[]>(r.products, []),
    tags: [],
  }));

  // ── 4. Unified community_rules (all Phase 2-4 sources) ──
  const unifiedWhere: any = { changeStatus: { not: "deleted" } };
  if (q) {
    unifiedWhere.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
      { upstreamRuleId: { contains: q } },
    ];
  }
  const unifiedRows = await prisma.communityRule.findMany({
    where: unifiedWhere,
    include: { source: { select: { name: true, type: true } } },
    take: 800,
    orderBy: { updatedAt: "desc" },
  });
  const unifiedCandidates: Candidate[] = unifiedRows.map((r) => {
    const lang = (r.ruleLanguage || "").toLowerCase();
    return {
      id: r.id,
      sourceTable: "community_rules",
      sourceName: r.source.name,
      sourceType: r.source.type,
      upstreamRuleId: r.upstreamRuleId ?? r.id,
      title: r.title,
      description: r.description ?? "",
      severity: r.severity || "info",
      ruleLanguage: r.ruleLanguage ?? "",
      // Only true Sigma rules are convertible. KQL, YARA-L, Panther python,
      // falco-yaml, wazuh-xml, car-yaml all stay as reference logic.
      sigmaConvertible: lang === "sigma",
      detectionLogic: r.detectionLogicRaw ?? "",
      mitreTechniques: safe<string[]>(r.mitreTechniques, []),
      mitreTactics: safe<string[]>(r.mitreTactics, []),
      platforms: safe<string[]>(r.platforms, []),
      tags: safe<string[]>(r.tags, []),
    };
  });

  // ── Merge + filter ──
  let all: Candidate[] = [
    ...sigmaCandidates,
    ...elasticCandidates,
    ...splunkCandidates,
    ...unifiedCandidates,
  ];
  if (sigmaOnly) all = all.filter((c) => c.sigmaConvertible);
  all = all.filter((c) =>
    matchesQuery(c, q) &&
    matchesTechnique(c, technique) &&
    matchesTactic(c, tactic) &&
    matchesPlatform(c, platform),
  );

  // Stable sort: sigma-convertible first (most useful for the workspace),
  // then by title for predictable pagination.
  all.sort((a, b) => {
    if (a.sigmaConvertible !== b.sigmaConvertible) return a.sigmaConvertible ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const total = all.length;
  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);

  // Aggregate facet counts so the UI can show "X SigmaHQ · Y Sentinel · …"
  const bySource: Record<string, number> = {};
  for (const c of all) bySource[c.sourceName] = (bySource[c.sourceName] ?? 0) + 1;

  return NextResponse.json({
    items: items.map((c) => ({
      ...c,
      // Truncate logic preview in the list response — full body comes from
      // the dedicated detail endpoints if needed.
      detectionLogic: c.detectionLogic.slice(0, 4000),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    facets: {
      bySource,
      sigmaConvertible: all.filter((c) => c.sigmaConvertible).length,
      referenceOnly: all.filter((c) => !c.sigmaConvertible).length,
    },
  });
}
