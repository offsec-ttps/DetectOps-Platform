/**
 * Resolve published BAS-agent binaries for the download + manifest routes.
 *
 * Binaries live under `bas-agent/dist/bas_agent-<os>-<arch>[.exe]` (produced by
 * scripts/publish-bas-agent.sh), with a `.sha256` sidecar. In production this
 * dir can point at a release-artifacts mount or be synced from object storage
 * via BAS_AGENT_ARTIFACTS_DIR.
 */

import { createHash } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";

// Report the real agent version from its Cargo.toml so the manifest never lies
// about what `publish-bas-agent.sh` produced. Override with BAS_AGENT_VERSION.
function cargoVersion(): string {
  try {
    const toml = readFileSync(path.join(process.cwd(), "bas-agent", "Cargo.toml"), "utf8");
    const m = toml.match(/^version\s*=\s*"([^"]+)"/m);
    return m?.[1] || "0.0.0";
  } catch { return "0.0.0"; }
}
const AGENT_VERSION = process.env.BAS_AGENT_VERSION || cargoVersion();

export function artifactsDir(): string {
  return process.env.BAS_AGENT_ARTIFACTS_DIR || path.join(process.cwd(), "bas-agent", "dist");
}

export function normalizeArch(arch: string): string {
  const a = (arch || "").toLowerCase();
  if (["x86_64", "amd64", "x64"].includes(a)) return "x86_64";
  if (["aarch64", "arm64"].includes(a)) return "aarch64";
  return a || "x86_64";
}

export function normalizeOs(os: string): string {
  const o = (os || "").toLowerCase();
  if (["windows", "win", "win32"].includes(o)) return "windows";
  if (["macos", "darwin", "osx", "mac"].includes(o)) return "macos";
  return "linux";
}

export function artifactName(os: string, arch: string): string {
  const ext = normalizeOs(os) === "windows" ? ".exe" : "";
  return `bas_agent-${normalizeOs(os)}-${normalizeArch(arch)}${ext}`;
}

export interface ArtifactInfo {
  available: boolean;
  filename: string;
  absPath: string;
  sizeBytes: number;
  sha256: string;
  version: string;
}

export async function resolveArtifact(os: string, arch: string): Promise<ArtifactInfo> {
  const filename = artifactName(os, arch);
  const absPath = path.join(artifactsDir(), filename);
  try {
    const buf = await fs.readFile(absPath);
    // Prefer the sidecar sha256 (cheap); fall back to hashing the bytes.
    let sha256 = "";
    try { sha256 = (await fs.readFile(`${absPath}.sha256`, "utf8")).trim().split(/\s+/)[0]; } catch { /* compute below */ }
    if (!sha256) sha256 = createHash("sha256").update(buf).digest("hex");
    return { available: true, filename, absPath, sizeBytes: buf.length, sha256, version: AGENT_VERSION };
  } catch {
    return { available: false, filename, absPath, sizeBytes: 0, sha256: "", version: AGENT_VERSION };
  }
}
