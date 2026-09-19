/**
 * Simulation module package store. Mirrors payload-store.ts: SHA-256-keyed files
 * under `<project>/.uploads/simulation-modules/`. v1 package format is a single
 * JSON document ({manifest, scenarios}) — no zip dependency yet (true .zip is a
 * Phase 8 enhancement).
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModulePackage } from "./types";

const MAX_BYTES = 4 * 1024 * 1024;

function rootDir(): string {
  return path.join(process.cwd(), ".uploads", "simulation-modules");
}
async function ensureRoot(): Promise<string> {
  const dir = rootDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function getMaxBytes(): number { return MAX_BYTES; }

/** Save a package JSON; returns { sha256, packageRef }. */
export async function savePackage(json: string): Promise<{ sha256: string; packageRef: string; sizeBytes: number }> {
  const buf = Buffer.from(json, "utf8");
  if (buf.length > MAX_BYTES) throw new Error(`package too large (max ${MAX_BYTES} bytes)`);
  const dir = await ensureRoot();
  const sha = createHash("sha256").update(buf).digest("hex");
  await fs.writeFile(path.join(dir, `${sha}.json`), buf, { mode: 0o600 });
  return { sha256: sha, packageRef: `sha256:${sha}.json`, sizeBytes: buf.length };
}

function parseRef(ref: string): string | null {
  const m = ref.match(/^sha256:([0-9a-f]{64})\.json$/i);
  return m ? m[1].toLowerCase() : null;
}

export async function readPackage(ref: string): Promise<ModulePackage | null> {
  const sha = parseRef(ref);
  if (!sha) return null;
  try {
    const raw = await fs.readFile(path.join(await ensureRoot(), `${sha}.json`), "utf8");
    return JSON.parse(raw) as ModulePackage;
  } catch { return null; }
}

/** Parse an uploaded package body (JSON string or already-parsed) into ModulePackage. */
export function parsePackage(input: string | unknown): ModulePackage | null {
  try {
    const obj = typeof input === "string" ? JSON.parse(input) : input;
    if (obj && typeof obj === "object" && "manifest" in (obj as any)) return obj as ModulePackage;
    if (obj && typeof obj === "object") return { manifest: obj as any };  // bare manifest
    return null;
  } catch { return null; }
}
