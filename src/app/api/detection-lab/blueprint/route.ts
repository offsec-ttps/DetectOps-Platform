/**
 * POST /api/detection-lab/blueprint  — Scan sources & snapshot configs into .blueprints/
 * GET  /api/detection-lab/blueprint  — List available blueprints
 *
 * POST /api/detection-lab/blueprint  body: { action: "scan" }
 *   Reads configs from registered source paths (read-only) and copies them
 *   into labs/.blueprints/<source-id>/ for reuse.
 *
 * POST /api/detection-lab/blueprint  body: { action: "deploy", sourceId, templateId, targetPath, deployName }
 *   Copies a blueprint into targetPath to create a deployable lab directory.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir, copyFile, readdir, stat } from "fs/promises";
import { existsSync, mkdirSync, cpSync } from "fs";
import path from "path";
import { requireRole } from "@/lib/auth-guard";

// Ids/names become path segments under labs/ — no separators or traversal.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const LABS_DIR = path.join(process.cwd(), "labs");
const BLUEPRINTS_DIR = path.join(LABS_DIR, ".blueprints");
const DEPLOYMENTS_DIR = path.join(LABS_DIR, "deployments");
const REGISTRY_FILE = path.join(LABS_DIR, "registry", "sources.json");

// ── Helpers ──

async function loadRegistry() {
  if (!existsSync(REGISTRY_FILE)) return { sources: [] as any[] };
  return JSON.parse(await readFile(REGISTRY_FILE, "utf-8"));
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Copy a file preserving relative structure
async function copyIfExists(src: string, destDir: string, relPath: string) {
  const srcFull = path.join(src, relPath);
  if (!existsSync(srcFull)) return false;
  const destFull = path.join(destDir, relPath);
  ensureDir(path.dirname(destFull));
  await copyFile(srcFull, destFull);
  return true;
}

// Recursively copy a directory (only configs, not multi-GB VM images)
function copyDirSelective(src: string, dest: string, maxDepth = 3, depth = 0) {
  if (depth > maxDepth) return;
  if (!existsSync(src)) return;
  ensureDir(dest);

  const { readdirSync, statSync, copyFileSync } = require("fs");
  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip large binary/VM artifacts and INI/inventory files that break Tailwind CSS scanning
    if ([".vagrant", ".git", "node_modules", "__pycache__", "boxes", ".tox"].includes(entry.name)) continue;
    if (entry.name.endsWith(".box") || entry.name.endsWith(".vmdk") || entry.name.endsWith(".vdi")) continue;
    if (entry.name.endsWith(".ini") || entry.name === "inventory" || entry.name === "inventory_disable_vagrant") continue;

    if (entry.isDirectory()) {
      copyDirSelective(srcPath, destPath, maxDepth, depth + 1);
    } else {
      const s = statSync(srcPath);
      // Only copy files under 5MB (configs, scripts, playbooks — not disk images)
      if (s.size < 5 * 1024 * 1024) {
        ensureDir(path.dirname(destPath));
        copyFileSync(srcPath, destPath);
      }
    }
  }
}

// ── GET: List blueprints ──

export async function GET() {
  const blueprints: { id: string; path: string; files: number; sizeKB: number; scannedAt?: string }[] = [];

  if (existsSync(BLUEPRINTS_DIR)) {
    const { readdirSync } = require("fs");
    const entries = readdirSync(BLUEPRINTS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const bpDir = path.join(BLUEPRINTS_DIR, entry.name);
      const metaFile = path.join(bpDir, ".blueprint-meta.json");

      let meta: any = {};
      if (existsSync(metaFile)) {
        try { meta = JSON.parse(await readFile(metaFile, "utf-8")); } catch {}
      }

      // Count files
      let fileCount = 0;
      let totalSize = 0;
      function countFiles(dir: string) {
        const { readdirSync, statSync } = require("fs");
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) countFiles(p);
            else { fileCount++; totalSize += statSync(p).size; }
          }
        } catch {}
      }
      countFiles(bpDir);

      blueprints.push({
        id: entry.name,
        path: bpDir,
        files: fileCount,
        sizeKB: Math.round(totalSize / 1024),
        scannedAt: meta.scannedAt,
      });
    }
  }

  // List deployments
  const deployments: { id: string; name: string; path: string; sourceId: string; templateId: string; createdAt: string }[] = [];
  if (existsSync(DEPLOYMENTS_DIR)) {
    const { readdirSync } = require("fs");
    const entries = readdirSync(DEPLOYMENTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaFile = path.join(DEPLOYMENTS_DIR, entry.name, ".deploy-meta.json");
      if (existsSync(metaFile)) {
        try {
          const meta = JSON.parse(await readFile(metaFile, "utf-8"));
          deployments.push({ id: entry.name, ...meta });
        } catch {}
      }
    }
  }

  return NextResponse.json({
    blueprintsDir: BLUEPRINTS_DIR,
    deploymentsDir: DEPLOYMENTS_DIR,
    blueprints,
    deployments,
  });
}

// ── POST: Scan or Deploy ──

export async function POST(req: NextRequest) {
  // Copies host directories and writes into caller-chosen paths.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { action } = body;

  if (action === "scan") {
    return handleScan();
  } else if (action === "deploy") {
    return handleDeploy(body);
  }

  return NextResponse.json({ error: "action must be 'scan' or 'deploy'" }, { status: 400 });
}

// ── Scan: snapshot configs from registered sources into .blueprints/ ──

async function handleScan() {
  const registry = await loadRegistry();
  ensureDir(BLUEPRINTS_DIR);

  const results: { id: string; status: string; files: number; error?: string }[] = [];

  for (const src of registry.sources) {
    if (typeof src.id !== "string" || !SAFE_NAME.test(src.id)) {
      results.push({ id: String(src.id), status: "skipped", files: 0, error: "invalid source id" });
      continue;
    }
    const bpDir = path.join(BLUEPRINTS_DIR, src.id);

    if (!existsSync(src.path)) {
      results.push({ id: src.id, status: "skipped", files: 0, error: `Source path not found: ${src.path}` });
      continue;
    }

    try {
      ensureDir(bpDir);

      // 1. Copy config files
      let filesCopied = 0;
      for (const cf of src.configFiles || []) {
        if (await copyIfExists(src.path, bpDir, cf)) filesCopied++;
      }

      // 2. Copy key directories (selective — configs/scripts only, no VMs)
      for (const dir of src.keyDirs || []) {
        const srcDir = path.join(src.path, dir);
        const destDir = path.join(bpDir, dir);
        if (existsSync(srcDir)) {
          copyDirSelective(srcDir, destDir, 4);
        }
      }

      // 3. If GOAD, also copy the active instance config
      if (src.activeInstance) {
        const instDir = path.join(src.path, "workspace", src.activeInstance);
        const destInst = path.join(bpDir, "workspace", src.activeInstance);
        if (existsSync(instDir)) {
          // Copy instance.json and inventories (not .vagrant/)
          for (const f of ["instance.json", "inventory", "inventory_disable_vagrant"]) {
            await copyIfExists(instDir, destInst, f).catch(() => {});
          }
        }
      }

      // 4. Write metadata
      const meta = {
        sourceId: src.id,
        sourcePath: src.path,
        sourceType: src.type,
        scannedAt: new Date().toISOString(),
      };
      await writeFile(path.join(bpDir, ".blueprint-meta.json"), JSON.stringify(meta, null, 2));

      // Count total files
      let count = 0;
      function countAll(dir: string) {
        const { readdirSync } = require("fs");
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) countAll(path.join(dir, e.name));
            else count++;
          }
        } catch {}
      }
      countAll(bpDir);

      results.push({ id: src.id, status: "scanned", files: count });
    } catch (err: any) {
      results.push({ id: src.id, status: "error", files: 0, error: err.message });
    }
  }

  return NextResponse.json({ success: true, results, blueprintsDir: BLUEPRINTS_DIR });
}

// ── Deploy: copy blueprint to target path ──

async function handleDeploy(body: any) {
  const { sourceId, templateId, targetPath, deployName } = body;

  if (!sourceId) return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
  if (typeof sourceId !== "string" || !SAFE_NAME.test(sourceId))
    return NextResponse.json({ error: "invalid sourceId" }, { status: 400 });
  if (deployName !== undefined && deployName !== "" && (typeof deployName !== "string" || !SAFE_NAME.test(deployName)))
    return NextResponse.json({ error: "deployName may contain only letters, digits, . _ -" }, { status: 400 });
  if (targetPath !== undefined && targetPath !== "" && (typeof targetPath !== "string" || !path.isAbsolute(targetPath) || targetPath.split(/[\\/]/).includes("..")))
    return NextResponse.json({ error: "targetPath must be an absolute path without '..'" }, { status: 400 });

  const bpDir = path.join(BLUEPRINTS_DIR, sourceId);
  if (!existsSync(bpDir)) {
    return NextResponse.json({ error: `Blueprint '${sourceId}' not found. Run scan first.` }, { status: 404 });
  }

  // Determine target directory
  const name = deployName || `${sourceId}-${Date.now().toString(36)}`;
  const dest = targetPath
    ? path.join(targetPath, name)
    : path.join(DEPLOYMENTS_DIR, name);

  try {
    ensureDir(dest);

    // Copy entire blueprint to target
    cpSync(bpDir, dest, { recursive: true });

    // Write deployment metadata
    const meta = {
      name,
      sourceId,
      templateId: templateId || sourceId,
      path: dest,
      blueprintPath: bpDir,
      createdAt: new Date().toISOString(),
    };
    await writeFile(path.join(dest, ".deploy-meta.json"), JSON.stringify(meta, null, 2));

    return NextResponse.json({
      success: true,
      deployment: meta,
      message: `Lab deployed to ${dest}`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
