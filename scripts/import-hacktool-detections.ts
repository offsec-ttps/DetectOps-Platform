#!/usr/bin/env tsx
/**
 * Imports a hacktool-behavior-lab export bundle into the detection-platform DB.
 *
 * Source: data/bundle/hacktool-detections.json produced by `hbl export` in the
 * standalone project (../hacktool-behavior-lab). Pass a path as argv[2] to
 * override; otherwise the real bundle is used, falling back to the committed
 * sample (…/data/bundle/hacktool-detections.sample.json) so the contract can be
 * validated without CAPE/GPU.
 *
 * It maps the bundle onto existing main-platform sinks (no schema change):
 *   atomic_tests[]     → AtomicTest  (source:"custom", createdBy:"hacktool-lab")
 *                        → runnable in the Hacktools attack-catalog + Campaign Designer
 *   detection_packs[]  → DetectionPack + DetectionRule[]  (sourceTable:"HacktoolBehaviorLab")
 *   spl_detections[]   → CustomDetection (source:"custom", sourceDetectionId:"hacktool-lab")
 *
 * SAFE TO RE-RUN: idempotent. It removes ONLY its own prior imports (scoped by
 * the provenance markers above — never user/community/upstream rows) and
 * recreates them, so re-running never duplicates and never touches other data.
 *
 * Usage:  npx tsx scripts/import-hacktool-detections.ts [bundle.json]
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { randomUUID, createHash } from "crypto";
import path from "path";

const dbPath = path.join(process.cwd(), "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

const LAB_CREATED_BY = "hacktool-lab";       // AtomicTest.createdBy provenance marker
const LAB_SOURCE_TABLE = "HacktoolBehaviorLab"; // DetectionPack.sourceTable provenance marker
const LAB_DETECTION_ID = "hacktool-lab";     // CustomDetection.sourceDetectionId provenance marker

function resolveBundlePath(): string {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const base = path.resolve(process.cwd(), "..", "hacktool-behavior-lab", "data", "bundle");
  const real = path.join(base, "hacktool-detections.json");
  const sample = path.join(base, "hacktool-detections.sample.json");
  if (existsSync(real)) return real;
  if (existsSync(sample)) return sample;
  throw new Error(`no bundle found (looked for ${real} and ${sample}); pass a path as the first argument`);
}

function jstr(v: unknown): string { return JSON.stringify(v ?? []); }
function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "pack";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 2; await prisma.detectionPack.findUnique({ where: { slug } }).catch(() => null); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

async function main() {
  const bundlePath = resolveBundlePath();
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  console.log(`[hbl-import] bundle: ${bundlePath}`);
  console.log(`[hbl-import] source=${bundle.source} version=${bundle.version} counts=`, bundle.counts || {});

  const atomicTests: any[] = bundle.atomic_tests || [];
  const detectionPacks: any[] = bundle.detection_packs || [];
  const splDetections: any[] = bundle.spl_detections || [];

  // ── 1. Remove only our own prior imports (idempotency, provenance-scoped) ──
  const delPacks = await prisma.detectionPack.deleteMany({ where: { sourceTable: LAB_SOURCE_TABLE } }); // cascades to rules
  const delCustom = await prisma.customDetection.deleteMany({ where: { sourceDetectionId: LAB_DETECTION_ID } });
  const delAtomics = await prisma.atomicTest.deleteMany({ where: { source: "custom", createdBy: LAB_CREATED_BY } });
  console.log(`[hbl-import] cleared prior lab rows: packs=${delPacks.count} customDetections=${delCustom.count} atomicTests=${delAtomics.count}`);

  // ── 2. AtomicTest recipes → runnable in the Hacktools attack-catalog ──
  // Assign testNumber after the current max per technique (respect @@unique[techniqueId,testNumber]).
  const byTech = new Map<string, any[]>();
  for (const a of atomicTests) {
    const tid = String(a.technique_id || "").toUpperCase();
    if (!/^T\d{4}(\.\d{3})?$/.test(tid)) { console.warn(`[hbl-import] skip atomic with bad technique_id: ${a.technique_id}`); continue; }
    (byTech.get(tid) || byTech.set(tid, []).get(tid)!).push(a);
  }
  let atomicsCreated = 0;
  for (const [tid, tests] of byTech) {
    const maxRow = await prisma.atomicTest.findFirst({ where: { techniqueId: tid }, orderBy: { testNumber: "desc" }, select: { testNumber: true } });
    let next = (maxRow?.testNumber ?? 0) + 1;
    for (const a of tests) {
      const platforms: string[] = Array.isArray(a.platforms) && a.platforms.length ? a.platforms : ["windows"];
      await prisma.atomicTest.create({
        data: {
          techniqueId: tid,
          techniqueName: a.technique_name || a.test_name || tid,
          testNumber: next++,
          testGuid: a.auto_generated_guid || randomUUID(),
          testName: a.test_name || `${tid} behavior detonation`,
          testDescription: a.description || "",
          platforms: jstr(platforms),
          elevationRequired: !!a.elevation_required,
          executorName: a.executor || "powershell",
          command: a.command || "",
          cleanupCommand: a.cleanup_command || "",
          inputArguments: jstr(a.input_arguments || {}),
          dependencies: jstr(a.dependencies || []),
          tactic: a.tactic || "",
          sourceUrl: "",
          contentHash: sha(`${tid}|${a.test_name}|${a.command}`),
          source: "custom",
          createdBy: LAB_CREATED_BY,
        },
      }).catch((e: any) => { if (e?.code === "P2002") console.warn(`[hbl-import] atomic collision ${tid}#${next - 1}`); else throw e; });
      atomicsCreated++;
    }
  }

  // ── 3. DetectionPack + DetectionRule[] (behavior-based Sigma/SPL rules) ──
  let packsCreated = 0, rulesCreated = 0;
  for (const p of detectionPacks) {
    // Tolerate both the rich model keys (name/mitreTechniques/…) and the
    // pipeline's compact keys (title/techniques/slug).
    const name = p.name || p.title || `Hacktool behavior: ${p.tool_id || "pack"}`;
    const techniques = p.mitreTechniques || p.techniques || [];
    const slug = await uniqueSlug(p.slug ? slugify(p.slug) : slugify(name));
    const pack = await prisma.detectionPack.create({
      data: {
        name: String(name).slice(0, 240),
        slug,
        description: String(p.description || "").slice(0, 4000),
        severity: p.severity || "high",
        riskScore: Math.max(0, Math.min(100, Number(p.riskScore ?? 70))),
        category: p.category || "other",
        platforms: jstr(p.platforms || []),
        dataSources: jstr(p.dataSources || []),
        mitreTechniques: jstr(techniques),
        mitreTactics: jstr(p.mitreTactics || p.tactics || []),
        references: jstr(p.references || []),
        status: "draft",
        sourceType: "rule",
        sourceTable: LAB_SOURCE_TABLE,
        sourceRefId: String(p.tool_id || p.slug || slug),
      },
    });
    packsCreated++;
    for (const r of (p.rules || []).slice(0, 8)) {
      await prisma.detectionRule.create({
        data: {
          packId: pack.id,
          format: r.format || "sigma",
          title: String(r.title || pack.name).slice(0, 240),
          body: String(r.body || "").slice(0, 32_000),
          language: r.language || "",
          falsePositives: jstr(r.falsePositives || []),
        },
      });
      rulesCreated++;
    }
  }

  // ── 4. SPL behavior detections → CustomDetection (Splunk-scoreable) ──
  let splCreated = 0;
  for (const s of splDetections) {
    if (!s.search) continue;
    await prisma.customDetection.create({
      data: {
        name: String(s.name || `hbl ${s.tool_id}`).slice(0, 240),
        description: s.description || "Behavior-based detection generated by hacktool-behavior-lab.",
        author: LAB_CREATED_BY,
        search: String(s.search),
        source: "custom",
        sourceDetectionId: LAB_DETECTION_ID,
        mitreTechniques: jstr(s.mitreTechniques || s.techniques || []),
        mitreTactics: jstr(s.mitreTactics || s.tactics || []),
        type: s.type || "TTP",
        tags: jstr(s.tags || ["behavioral", "hacktool-lab"]),
      },
    });
    splCreated++;
  }

  console.log(`[hbl-import] done: atomicTests=${atomicsCreated} packs=${packsCreated} rules=${rulesCreated} customDetections=${splCreated}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error("[hbl-import] FAILED:", e); process.exit(1); });
