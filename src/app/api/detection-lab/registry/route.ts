/**
 * GET  /api/detection-lab/registry  — List registered source installations + live status
 * POST /api/detection-lab/registry  — Add/update a source entry
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const LABS_DIR = path.join(process.cwd(), "labs");
const REGISTRY_FILE = path.join(LABS_DIR, "registry", "sources.json");

interface SourceEntry {
  id: string;
  name: string;
  type: string;
  path: string;
  configFiles: string[];
  keyDirs: string[];
  activeInstance?: string;
  description: string;
}

interface RegistryData {
  _description: string;
  sources: SourceEntry[];
}

async function loadRegistry(): Promise<RegistryData> {
  if (!existsSync(REGISTRY_FILE)) return { _description: "", sources: [] };
  const raw = await readFile(REGISTRY_FILE, "utf-8");
  return JSON.parse(raw);
}

async function probeSource(src: SourceEntry) {
  const exists = existsSync(src.path);
  const configs: { file: string; exists: boolean; sizeKB: number }[] = [];

  for (const cf of src.configFiles) {
    const full = path.join(src.path, cf);
    if (existsSync(full)) {
      try {
        const s = await stat(full);
        configs.push({ file: cf, exists: true, sizeKB: Math.round(s.size / 1024) });
      } catch {
        configs.push({ file: cf, exists: false, sizeKB: 0 });
      }
    } else {
      configs.push({ file: cf, exists: false, sizeKB: 0 });
    }
  }

  const dirs: { dir: string; exists: boolean }[] = src.keyDirs.map((d) => ({
    dir: d,
    exists: existsSync(path.join(src.path, d)),
  }));

  return {
    ...src,
    status: exists ? "found" : "missing",
    configs,
    dirs,
    healthy: exists && configs.every((c) => c.exists) && dirs.every((d) => d.exists),
  };
}

export async function GET() {
  const registry = await loadRegistry();
  const probed = await Promise.all(registry.sources.map(probeSource));

  // Also list existing deployments
  const deploymentsDir = path.join(LABS_DIR, "deployments");
  let deployments: { id: string; path: string }[] = [];
  if (existsSync(deploymentsDir)) {
    const { readdirSync } = require("fs");
    const entries = readdirSync(deploymentsDir, { withFileTypes: true });
    deployments = entries
      .filter((e: any) => e.isDirectory())
      .map((e: any) => ({ id: e.name, path: path.join(deploymentsDir, e.name) }));
  }

  return NextResponse.json({
    sources: probed,
    deployments,
    labsDir: LABS_DIR,
    registryPath: REGISTRY_FILE,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { id, name, type, path: srcPath, description } = body;

  if (!id || !srcPath) {
    return NextResponse.json({ error: "id and path are required" }, { status: 400 });
  }

  if (!existsSync(srcPath)) {
    return NextResponse.json({ error: `Path does not exist: ${srcPath}` }, { status: 400 });
  }

  const registry = await loadRegistry();
  const existing = registry.sources.findIndex((s) => s.id === id);
  const entry: SourceEntry = {
    id,
    name: name || id,
    type: type || "sar",
    path: srcPath,
    configFiles: body.configFiles || [],
    keyDirs: body.keyDirs || [],
    description: description || "",
  };

  if (existing >= 0) {
    registry.sources[existing] = entry;
  } else {
    registry.sources.push(entry);
  }

  await writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf-8");
  return NextResponse.json({ success: true, entry });
}
