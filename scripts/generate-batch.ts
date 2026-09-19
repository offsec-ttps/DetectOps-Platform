/**
 * scripts/generate-batch.ts
 *
 * Claude-Code-driven Detection Pack generation. NO Anthropic API calls;
 * uses templated rules + IRPs keyed to the source rows' MITRE technique IDs.
 * Produces real, runnable Sigma + SPL + KQL detections (not stubs).
 *
 * Sampling target (defaults to 100 rows; override via TARGET):
 *   - 40 TI reports        (severity CRITICAL|HIGH, mixed categories)
 *   - 30 Sigma rules       (level critical|high)
 *   - 20 Splunk detections (type TTP)
 *   - 10 Elastic rules     (severity critical|high)
 *
 * Run with:  npx tsx scripts/generate-batch.ts
 *
 * Inserts via the same persistPack helper used by the AI generator, so
 * ART/PurpleSharp/Stratus simulations are auto-inferred and the slug
 * versioning behaviour (Phase 4) applies to regen.
 */

import { prisma } from "../src/lib/prisma";
import { persistPack } from "../src/lib/detection-packs/persist";
import { inferSimulations } from "../src/lib/detection-packs/infer-sims";
import { extractReferences } from "../src/lib/detection-packs/references";
import { classifyPlatform } from "../src/lib/detection-packs/classify";
import { logEvent } from "../src/lib/event-log";
import { pickTemplate, type TechniqueTemplate } from "./templates-techniques";
import { pickIrPlaybook, type TacticFamily } from "./templates-irp";

interface SourceRow {
  sourceType: "ti" | "rule";
  sourceTable: string;
  sourceRefId: string;
  title: string;
  description: string;
  severity: string;
  techniques: string[];
  tactics?: string[];
  rawText: string;       // for reference extraction
  refsRaw?: string;
}

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function pickPrimaryTechnique(techs: string[]): string {
  // Prefer sub-techniques (more specific). Otherwise first valid TID.
  const valid = techs.filter((t) => /^T\d{4}(\.\d{3})?$/.test(t));
  const sub = valid.find((t) => t.includes("."));
  return sub || valid[0] || "T0000";
}

function normaliseSeverity(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low" || s === "info" || s === "informational") {
    return s === "informational" ? "info" : s;
  }
  return "medium";
}

function severityToRisk(sev: string): number {
  return sev === "critical" ? 88 : sev === "high" ? 75 : sev === "medium" ? 55 : sev === "low" ? 25 : 10;
}

async function sampleTi(limit: number): Promise<SourceRow[]> {
  const rows = await prisma.threatIntelReport.findMany({
    where: { severityLevel: { in: ["CRITICAL", "HIGH"] } },
    orderBy: [{ severityLevel: "asc" }, { syncedAt: "desc" }],
    take: limit,
  });
  return rows.map((r) => {
    const techRaw = safeJson<unknown[]>(r.mitreTechniques, []);
    const techniques = techRaw
      .map((t) => typeof t === "string" ? t : (t as any)?.technique_id || (t as any)?.id || "")
      .filter((s: string) => /^T\d{4}(\.\d{3})?$/.test(s));
    const tactics = techRaw
      .map((t) => typeof t === "object" ? (t as any)?.tactic : null)
      .filter(Boolean);
    return {
      sourceType: "ti",
      sourceTable: "ThreatIntelReport",
      sourceRefId: r.id,
      title: r.title,
      description: r.summary || r.description?.slice(0, 400) || "",
      severity: normaliseSeverity(r.severityLevel),
      techniques,
      tactics: tactics as string[],
      rawText: [r.title, r.summary, r.description, r.iocs, r.references].filter(Boolean).join(" "),
      refsRaw: r.references,
    };
  });
}

async function sampleSigma(limit: number): Promise<SourceRow[]> {
  const rows = await prisma.communitySigmaRule.findMany({
    where: { level: { in: ["critical", "high"] }, mitreTechniques: { not: "[]" } },
    orderBy: [{ level: "asc" }, { createdAt: "desc" }],
    take: limit,
  });
  return rows.map((r) => {
    const techniques = safeJson<string[]>(r.mitreTechniques, []).filter((t) => /^T\d{4}(\.\d{3})?$/.test(t));
    return {
      sourceType: "rule",
      sourceTable: "CommunitySigmaRule",
      sourceRefId: r.id,
      title: r.title,
      description: r.description?.slice(0, 400) || "",
      severity: normaliseSeverity(r.level),
      techniques,
      rawText: [r.title, r.description, r.detectionYaml?.slice(0, 1000), r.references].filter(Boolean).join(" "),
      refsRaw: r.references,
    };
  });
}

async function sampleSplunk(limit: number): Promise<SourceRow[]> {
  const rows = await prisma.splunkDetection.findMany({
    where: { type: "TTP", mitreTechniques: { not: "[]" } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => {
    const techniques = safeJson<string[]>(r.mitreTechniques, []).filter((t) => /^T\d{4}(\.\d{3})?$/.test(t));
    return {
      sourceType: "rule",
      sourceTable: "SplunkDetection",
      sourceRefId: r.id,
      title: r.name,
      description: r.description?.slice(0, 400) || "",
      severity: "high",
      techniques,
      rawText: [r.name, r.description, r.search?.slice(0, 500), r.references].filter(Boolean).join(" "),
      refsRaw: r.references,
    };
  });
}

async function sampleElastic(limit: number): Promise<SourceRow[]> {
  const rows = await prisma.communityElasticRule.findMany({
    where: { severity: { in: ["critical", "high"] }, mitreTechniques: { not: "[]" } },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    take: limit,
  });
  return rows.map((r) => {
    const techniques = safeJson<string[]>(r.mitreTechniques, []).filter((t) => /^T\d{4}(\.\d{3})?$/.test(t));
    return {
      sourceType: "rule",
      sourceTable: "CommunityElasticRule",
      sourceRefId: r.id,
      title: r.name,
      description: r.description?.slice(0, 400) || "",
      severity: normaliseSeverity(r.severity),
      techniques,
      rawText: [r.name, r.description, r.query?.slice(0, 500), r.references].filter(Boolean).join(" "),
      refsRaw: r.references,
    };
  });
}

async function alreadyGeneratedFor(sourceTable: string, sourceRefId: string): Promise<boolean> {
  const existing = await prisma.detectionPack.findFirst({
    where: { sourceTable, sourceRefId, status: { not: "deprecated" } },
    select: { id: true },
  });
  return !!existing;
}

async function generateForRow(row: SourceRow): Promise<{ packId: string; primaryTechnique: string }> {
  const primary = pickPrimaryTechnique(row.techniques);
  const tpl: TechniqueTemplate = pickTemplate(primary);

  // Build pack name + description: blend the source title with the technique
  const packName = `${row.title.slice(0, 180)} — ${primary}`;
  const description = `${row.description || `Detection pack derived from ${row.sourceTable} ${row.sourceRefId.slice(0, 8)} mapped to ${tpl.techniqueName} (${primary}).`}\n\nGenerated via Claude Code from the auto-pipeline queue source row. Detection rules + IR playbook templated per technique; ART/PurpleSharp/Stratus simulations auto-inferred from MITRE coverage.`.slice(0, 2500);

  // Use heuristic classifier as a sanity check on category; template wins ties
  const heuristicCategory = classifyPlatform({ text: row.rawText, techniques: row.techniques });
  const category = tpl.category || heuristicCategory;

  // Merge techniques: ensure the primary AND any other valid ones from the source are present
  const mergedTechniques = [...new Set([primary, ...row.techniques.filter((t) => /^T\d{4}(\.\d{3})?$/.test(t))])];

  // References: pull URLs out of the source text + the per-source refs field
  const extracted = extractReferences(row.rawText, row.refsRaw);

  // IRP — picked from tactic family the template knows it belongs to
  const irp = pickIrPlaybook(tpl.tacticHint as TacticFamily, row.title.slice(0, 80));

  // Sims — non-LLM ART/PurpleSharp/Stratus matches (capped)
  const sims = await inferSimulations({ techniques: mergedTechniques });

  // Persist
  const pack = await persistPack({
    sourceType: row.sourceType,
    sourceTable: row.sourceTable,
    sourceRefId: row.sourceRefId,
    packTool: {
      name: packName,
      description,
      severity: row.severity,
      riskScore: severityToRisk(row.severity),
      category,
      platforms: tpl.platforms,
      dataSources: tpl.dataSources,
      mitreTechniques: mergedTechniques,
      mitreTactics: tpl.tactics,
      references: extracted,
      rules: tpl.rules(row.title.slice(0, 80)),
    },
    irpTool: irp,
    simulations: sims,
  });

  return { packId: pack.id, primaryTechnique: primary };
}

async function main() {
  const target = parseInt(process.env.TARGET || "100", 10);

  // Pull a slightly oversized batch from each source so we can skip duplicates
  // without dropping under target.
  const tiBudget     = Math.round(target * 0.40);
  const sigmaBudget  = Math.round(target * 0.30);
  const splunkBudget = Math.round(target * 0.20);
  const elasticBudget = target - tiBudget - sigmaBudget - splunkBudget;

  console.log(`[generate-batch] target=${target} · ti=${tiBudget} sigma=${sigmaBudget} splunk=${splunkBudget} elastic=${elasticBudget}`);

  const [ti, sigma, splunk, elastic] = await Promise.all([
    sampleTi(tiBudget * 2),                 // 2× oversample
    sampleSigma(sigmaBudget * 2),
    sampleSplunk(splunkBudget * 2),
    sampleElastic(elasticBudget * 2),
  ]);

  console.log(`[generate-batch] sampled ti=${ti.length} sigma=${sigma.length} splunk=${splunk.length} elastic=${elastic.length}`);

  // Per-source caps: take in order, skip rows that already have a non-deprecated pack
  const perSource = { ti: 0, sigma: 0, splunk: 0, elastic: 0 };
  const queue: SourceRow[] = [];
  async function fillFrom(rows: SourceRow[], key: keyof typeof perSource, budget: number) {
    for (const r of rows) {
      if (perSource[key] >= budget) break;
      if (await alreadyGeneratedFor(r.sourceTable, r.sourceRefId)) continue;
      queue.push(r);
      perSource[key]++;
    }
  }
  await fillFrom(ti, "ti", tiBudget);
  await fillFrom(sigma, "sigma", sigmaBudget);
  await fillFrom(splunk, "splunk", splunkBudget);
  await fillFrom(elastic, "elastic", elasticBudget);

  console.log(`[generate-batch] queue ready: ${queue.length} rows (ti=${perSource.ti} sigma=${perSource.sigma} splunk=${perSource.splunk} elastic=${perSource.elastic})`);

  let ok = 0, fail = 0;
  const techCounts = new Map<string, number>();
  const startMs = Date.now();

  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    try {
      const result = await generateForRow(row);
      ok++;
      techCounts.set(result.primaryTechnique, (techCounts.get(result.primaryTechnique) || 0) + 1);
      if ((i + 1) % 10 === 0 || i === queue.length - 1) {
        console.log(`  [${i + 1}/${queue.length}] ok=${ok} fail=${fail}  (last: ${row.sourceTable.slice(0, 12)} → ${result.packId.slice(0, 8)})`);
      }
    } catch (err: any) {
      fail++;
      console.log(`  [${i + 1}/${queue.length}] FAIL ${row.sourceTable}/${row.sourceRefId.slice(0, 8)}: ${(err.message || err).slice(0, 100)}`);
    }
  }

  const durationMs = Date.now() - startMs;
  console.log(`\n[generate-batch] done — ${ok} packs generated, ${fail} failed in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`[generate-batch] technique coverage:`);
  [...techCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    console.log(`     ${t.padEnd(12)} ${c}`);
  });

  void logEvent({
    category: "detection-pack",
    action: "detection-pack.bulk-claude-code.done",
    actor: "claude-code",
    status: "ok",
    durationMs,
    message: `Claude-Code-driven batch: ${ok} packs (target ${target}); ${fail} failed`,
    details: {
      target,
      generated: ok,
      failed: fail,
      bySource: perSource,
      durationMs,
      techniqueCoverage: Object.fromEntries(techCounts),
    },
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
