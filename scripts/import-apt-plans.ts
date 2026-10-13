#!/usr/bin/env tsx
/**
 * Imports ready-made adversary emulation plans into the APT Simulation library
 * (apt_emulation_plans), sourced from the research in APT-Simulation-Lab-Resources.docx:
 *
 *   • MITRE CTID Adversary Emulation Library — 11 full plans. For each plan that
 *     ships a machine-readable YAML we FETCH it and parse the real ATT&CK
 *     technique IDs + step count (authentic coverage → the plan is runnable).
 *   • CTID micro emulation plans (12) — referential (link to the real repo).
 *   • ATT&CK Evaluations (ael) rounds (7) — referential (link + actor).
 *
 * Every row's repoUrl/referenceUrl points at the real upstream; nothing is
 * fabricated. SAFE TO RE-RUN (replaces apt_emulation_plans). Needs network for
 * the CTID YAML fetch; without it, full plans import as reference-only.
 *
 * Usage:  npx tsx scripts/import-apt-plans.ts
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const adapter = new PrismaBetterSqlite3({ url: `file:${path.join(process.cwd(), "dev.db")}` });
const prisma = new PrismaClient({ adapter });

const CTID_REPO = "https://github.com/center-for-threat-informed-defense/adversary_emulation_library";
const RAW = "https://raw.githubusercontent.com/center-for-threat-informed-defense/adversary_emulation_library/master";

// Table 11 of the research doc — the 11 CTID full plans. `yaml` lists the plan's
// machine-readable emulation YAML(s) (relative to the repo root); empty = the
// plan has no single parseable YAML, so it imports as reference-only.
const CTID_FULL: { key: string; name: string; actor: string; origin: string; sectors: string[]; dir: string; yaml: string[] }[] = [
  { key: "apt29", name: "APT29", actor: "APT29", origin: "Russia (SVR)", sectors: ["Government", "Healthcare", "Technology / IT"], dir: "apt29", yaml: ["apt29/Emulation_Plan/yaml/APT29.yaml"] },
  { key: "blind_eagle", name: "Blind Eagle", actor: "Blind Eagle", origin: "South America", sectors: ["Financial", "Manufacturing", "Oil & Gas"], dir: "blind_eagle", yaml: [] },
  { key: "carbanak", name: "Carbanak", actor: "Carbanak", origin: "eCrime", sectors: ["Financial"], dir: "carbanak", yaml: ["carbanak/Emulation_Plan/yaml/Carbanak.yaml"] },
  { key: "fin6", name: "FIN6", actor: "FIN6", origin: "eCrime", sectors: ["Retail / Hospitality"], dir: "fin6", yaml: ["fin6/Emulation_Plan/yaml/FIN6.yaml"] },
  { key: "fin7", name: "FIN7", actor: "FIN7", origin: "eCrime", sectors: ["Financial", "Retail / Hospitality"], dir: "fin7", yaml: ["fin7/Emulation_Plan/yaml/Fin7.yaml"] },
  { key: "menu_pass", name: "menuPass (APT10)", actor: "menuPass", origin: "China (MSS)", sectors: ["Healthcare", "Defense / Military", "Aerospace / Aviation", "Government"], dir: "menu_pass", yaml: ["menu_pass/Emulation_Plan/yaml/menupass.yaml"] },
  { key: "ocean_lotus", name: "OceanLotus (APT32)", actor: "OceanLotus", origin: "Vietnam", sectors: ["Government", "Manufacturing", "Media / Journalists"], dir: "ocean_lotus", yaml: [] },
  { key: "oilrig", name: "OilRig (APT34)", actor: "OilRig", origin: "Iran", sectors: ["Financial", "Government", "Energy", "Telecommunications"], dir: "oilrig", yaml: ["oilrig/Emulation_Plan/yaml/oilrig.yaml"] },
  { key: "sandworm", name: "Sandworm", actor: "Sandworm", origin: "Russia (GRU)", sectors: ["Critical infrastructure", "ICS / OT"], dir: "sandworm", yaml: ["sandworm/Emulation_Plan/yaml/sandworm.yaml"] },
  { key: "turla", name: "Turla", actor: "Turla", origin: "Russia (FSB)", sectors: ["Government", "Defense / Military"], dir: "turla", yaml: ["turla/Emulation_Plan/yaml/turla_carbon.yaml", "turla/Emulation_Plan/yaml/turla_snake.yaml"] },
  { key: "wizard_spider", name: "Wizard Spider", actor: "Wizard Spider", origin: "Russia eCrime", sectors: ["Financial", "Healthcare"], dir: "wizard_spider", yaml: ["wizard_spider/Emulation_Plan/yaml/wizard_spider.yaml"] },
];

// Section 5.2 — the 12 behavior-focused micro plans (reference-only).
const MICRO = [
  "AD Enumeration", "Data Exfiltration", "DLL Sideloading", "File Access/Modification", "Log Clearing",
  "Named Pipes", "Process Injection", "Reflective Loading", "Remote Code Execution", "User Execution",
  "Web Shells", "Windows Registry",
];

// Table 12 — ATT&CK Evaluations (ael) rounds (reference-only).
const EVALS: { round: string; name: string; actor: string; origin: string }[] = [
  { round: "R1/R2", name: "APT3", actor: "APT3", origin: "China (Gothic Panda)" },
  { round: "R2", name: "APT29", actor: "APT29", origin: "Russia (SVR)" },
  { round: "R3", name: "Carbanak + FIN7", actor: "Carbanak", origin: "eCrime (finance/hospitality)" },
  { round: "R4", name: "Wizard Spider + Sandworm", actor: "Wizard Spider", origin: "Russia (eCrime + GRU)" },
  { round: "R5", name: "Turla", actor: "Turla", origin: "Russia (FSB)" },
  { round: "R6", name: "DPRK cluster", actor: "Lazarus Group", origin: "North Korea" },
  { round: "Ransomware", name: "ALPHV/BlackCat, LockBit, Cl0p", actor: "", origin: "eCrime" },
];

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

/** Parse authentic ATT&CK technique ids + a step count from a CTID plan YAML. */
function parsePlanYaml(text: string): { techniqueIds: string[]; steps: number } {
  const techniqueIds = [...new Set((text.match(/\bT\d{4}(?:\.\d{3})?\b/g) || []))].sort();
  // Each emulation step carries exactly one `tactic:` — a good step-count proxy.
  const steps = (text.match(/^\s*tactic:/gim) || []).length;
  return { techniqueIds, steps };
}

async function main() {
  const rows: any[] = [];

  console.log("[plans] fetching CTID full-plan YAMLs for authentic technique coverage…");
  for (const p of CTID_FULL) {
    const tids = new Set<string>();
    let steps = 0;
    for (const y of p.yaml) {
      const text = await fetchText(`${RAW}/${y}`);
      if (text) { const parsed = parsePlanYaml(text); parsed.techniqueIds.forEach((t) => tids.add(t)); steps += parsed.steps; }
    }
    const techniqueIds = [...tids].sort();
    console.log(`  ${p.name.padEnd(20)} techniques=${techniqueIds.length} steps=${steps}${p.yaml.length ? "" : " (reference-only, no YAML)"}`);
    rows.push({
      key: `ctid-${p.key}`, name: p.name, source: "ctid-full", actor: p.actor, origin: p.origin,
      sectors: JSON.stringify(p.sectors), description: `MITRE CTID Adversary Emulation Library — full, intel-driven plan replaying ${p.name}'s tradecraft end-to-end.`,
      repoUrl: `${CTID_REPO}/tree/master/${p.dir}`, referenceUrl: "https://ctid.mitre.org/",
      round: "", techniqueIds: JSON.stringify(techniqueIds), stepCount: steps,
    });
  }

  for (const m of MICRO) {
    rows.push({
      key: `ctid-micro-${m.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      name: `Micro: ${m}`, source: "ctid-micro", actor: "", origin: "",
      sectors: "[]", description: `CTID micro emulation plan — small, technique-focused behavior (${m}) to run à la carte or bolt onto a full campaign.`,
      repoUrl: `${CTID_REPO}/tree/master/micro_emulation_plans`, referenceUrl: "https://ctid.mitre.org/",
      round: "", techniqueIds: "[]", stepCount: 0,
    });
  }

  for (const e of EVALS) {
    rows.push({
      key: `eval-${e.round.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
      name: `ATT&CK Eval ${e.round} — ${e.name}`, source: "attack-eval", actor: e.actor, origin: e.origin,
      sectors: "[]", description: `MITRE ATT&CK Evaluations adversary plan (${e.round}: ${e.name}) — realistic multi-stage emulation used for public benchmarking.`,
      repoUrl: "https://github.com/attackevals/ael", referenceUrl: "https://attackevals.mitre-engenuity.org/",
      round: e.round, techniqueIds: "[]", stepCount: 0,
    });
  }

  await prisma.aptEmulationPlan.deleteMany({});
  for (let i = 0; i < rows.length; i += 200) await prisma.aptEmulationPlan.createMany({ data: rows.slice(i, i + 200) });

  const full = rows.filter((r) => r.source === "ctid-full");
  const runnable = full.filter((r) => JSON.parse(r.techniqueIds).length > 0).length;
  console.log(`\n[plans] DONE — ${rows.length} plans (${full.length} CTID full, ${MICRO.length} micro, ${EVALS.length} eval rounds)`);
  console.log(`  CTID full plans with authentic technique coverage (runnable): ${runnable}/${full.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
