#!/usr/bin/env tsx
/**
 * Imports the CyberGeoOps APT snapshot into detection-platform's own DB as the
 * "APT Simulation" library (apt_groups + apt_atomics).
 *
 * Source: resources/apt-sim/apt-atomics.json — produced by the extractor that
 * reads CyberGeoOps' tip.sqlite (atomics + targeted sectors) and its Postgres
 * threat_actors (origin-country attribution). All atomics are Atomic Red Team
 * tests referenced by GUID; the executable command lives in AtomicTest
 * (atomic_tests), resolved at run time by `testGuid` — so this import carries
 * only the group↔test mapping + geo/sector metadata, never a copy of commands.
 *
 * Facets: originCountry = APT attribution origin; group sectors = targeted
 * industry (the "domain" facet). primarySectors is the high-signal subset.
 *
 * Usage:  npx tsx scripts/import-apt-sim.ts
 * SAFE TO RE-RUN: it replaces apt_groups/apt_atomics wholesale (a snapshot).
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { readFileSync } from "fs";
import path from "path";

const dbPath = path.join(process.cwd(), "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

const BUNDLE = path.join(process.cwd(), "resources/apt-sim/apt-atomics.json");

/** A group's "primary" targeted sectors: the high-signal head of the weighted
 *  list (>=15% of the top sector's weight), capped at 8, at least the top one.
 *  Keeps "domain" faceting meaningful instead of matching every group to every
 *  sector via the long tail. */
function primarySectorsOf(weights: Record<string, number>, ordered: string[]): string[] {
  if (!ordered.length) return [];
  const max = Math.max(...Object.values(weights), 1);
  const head = ordered.filter((s) => (weights[s] || 0) >= 0.15 * max);
  return (head.length ? head : ordered.slice(0, 1)).slice(0, 8);
}

function guidOf(a: any): string {
  const g = String(a.guid || "").trim();
  if (g) return g;
  const m = String(a.command || "").match(/-TestGuids\s+([0-9a-fA-F-]{36})/);
  return m ? m[1] : "";
}

async function chunkedCreate<T>(rows: T[], create: (batch: T[]) => Promise<unknown>, size = 1000) {
  for (let i = 0; i < rows.length; i += size) await create(rows.slice(i, i + size));
}

async function main() {
  const bundle = JSON.parse(readFileSync(BUNDLE, "utf8"));
  console.log(`[apt-import] source: ${bundle.source}`);
  console.log(`[apt-import] bundle counts:`, bundle.counts);

  // Which ART GUIDs actually exist locally? Report coverage so a mapping to a
  // missing test is visible rather than silently un-runnable.
  const localGuids = new Set(
    (await prisma.atomicTest.findMany({ select: { testGuid: true } }))
      .map((r) => r.testGuid.toLowerCase())
      .filter(Boolean),
  );

  const groupRows = (bundle.groups as any[]).map((g) => ({
    name: g.name,
    mitreId: g.mitreId || "",
    originCode: g.originCode || "",
    originCountry: g.originCountry || "",
    actorType: g.actorType || "unknown",
    aliases: JSON.stringify(g.aliases || []),
    sectors: JSON.stringify(g.sectors || []),
    primarySectors: JSON.stringify(primarySectorsOf(g.sectorWeights || {}, g.sectors || [])),
    targetedCountries: JSON.stringify(g.targetedCountries || []),
    tactics: JSON.stringify(g.tactics || []),
    atomicCount: g.atomicCount || 0,
  }));

  let missing = 0;
  const atomicRows = (bundle.atomics as any[]).map((a) => {
    const guid = guidOf(a).toLowerCase();
    if (guid && !localGuids.has(guid)) missing++;
    return {
      groupName: a.group,
      techniqueId: a.techniqueId || "",
      techniqueName: a.techniqueName || "",
      testGuid: guid,
      testName: a.name || "",
      platform: a.platform || "",
      executor: a.executor || "",
      tactic: a.tactic || "",
    };
  });

  console.log(`[apt-import] replacing existing apt_groups/apt_atomics …`);
  await prisma.aptAtomic.deleteMany({});
  await prisma.aptGroup.deleteMany({});

  await chunkedCreate(groupRows, (b) => prisma.aptGroup.createMany({ data: b }));
  await chunkedCreate(atomicRows, (b) => prisma.aptAtomic.createMany({ data: b }));

  const uniqueGuids = new Set(atomicRows.map((r) => r.testGuid).filter(Boolean));
  console.log(`\n[apt-import] DONE`);
  console.log(`  groups:        ${groupRows.length}`);
  console.log(`  atomic rows:   ${atomicRows.length}`);
  console.log(`  unique GUIDs:  ${uniqueGuids.size}`);
  console.log(`  GUID rows with NO local AtomicTest: ${missing}` + (missing ? "  ← run Atomic Red Team sync to fill" : "  (all resolvable)"));
  const withCountry = groupRows.filter((g) => g.originCountry).length;
  const withSector = groupRows.filter((g) => JSON.parse(g.primarySectors).length).length;
  console.log(`  groups with origin country: ${withCountry}/${groupRows.length}`);
  console.log(`  groups with targeted sector: ${withSector}/${groupRows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
