/**
 * Local payload artefact store for shell-kind environments.
 *
 * Phase 3 keeps payloads on the local filesystem under
 * `<project>/.uploads/enterprise-payloads/` keyed by SHA-256. The store
 * never executes payloads; it just retains the bytes so a future runner can
 * deliver them to the listener target.
 *
 *   PUT  → save bytes, returns { sha256, sizeBytes, ext, storedAt }
 *   GET  → load by sha256
 *   meta → small metadata object suitable for surfacing in the UI
 *
 * Bounds:
 *   - 8 MB upper cap per artefact
 *   - allowed extensions: .ps1 .sh .py .bat .vbs .exe .bin .dll .raw .b64
 *   - dir created on demand, perms 0700
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXT = new Set([".ps1", ".sh", ".py", ".bat", ".vbs", ".exe", ".bin", ".dll", ".raw", ".b64", ".txt"]);

function rootDir(): string {
  return path.join(process.cwd(), ".uploads", "enterprise-payloads");
}

export interface PayloadMeta {
  sha256: string;
  sizeBytes: number;
  ext: string;
  storedAt: string;                              // ISO; mtime of the file
  filename: string;                              // original filename
}

async function ensureRoot(): Promise<string> {
  const dir = rootDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function isAllowedExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext);
}

export function getMaxBytes(): number { return MAX_BYTES; }

/**
 * Save the given buffer. Returns a metadata object the EnvironmentTarget can
 * persist as `payloadRef` (e.g. `sha256:<hash>`).
 */
export async function savePayload(filename: string, buf: Buffer): Promise<PayloadMeta> {
  if (buf.length > MAX_BYTES) {
    throw new Error(`payload too large (max ${MAX_BYTES} bytes)`);
  }
  if (!isAllowedExtension(filename)) {
    const ext = path.extname(filename) || "(none)";
    throw new Error(`extension ${ext} not allowed`);
  }
  const dir = await ensureRoot();
  const sha = createHash("sha256").update(buf).digest("hex");
  const ext = path.extname(filename).toLowerCase();
  const filePath = path.join(dir, `${sha}${ext}`);

  // Mark filename in a sidecar so we can return the original on read
  await fs.writeFile(filePath, buf, { mode: 0o600 });
  await fs.writeFile(filePath + ".meta", JSON.stringify({ filename }), { mode: 0o600 });

  return {
    sha256: sha,
    sizeBytes: buf.length,
    ext,
    storedAt: new Date().toISOString(),
    filename,
  };
}

export function payloadRef(meta: { sha256: string; ext: string }): string {
  return `sha256:${meta.sha256}${meta.ext}`;
}

function parseRef(ref: string): { sha256: string; ext: string } | null {
  const m = ref.match(/^sha256:([0-9a-f]{64})(\.[a-z0-9]+)?$/i);
  if (!m) return null;
  return { sha256: m[1].toLowerCase(), ext: (m[2] || "").toLowerCase() };
}

export async function readPayload(ref: string): Promise<{ buf: Buffer; meta: PayloadMeta } | null> {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const dir = await ensureRoot();
  const filePath = path.join(dir, `${parsed.sha256}${parsed.ext}`);
  try {
    const [buf, sidecar] = await Promise.all([
      fs.readFile(filePath),
      fs.readFile(filePath + ".meta", "utf-8").catch(() => "{}"),
    ]);
    const meta = JSON.parse(sidecar) as { filename?: string };
    const st = await fs.stat(filePath);
    return {
      buf,
      meta: {
        sha256: parsed.sha256,
        sizeBytes: buf.length,
        ext: parsed.ext,
        storedAt: st.mtime.toISOString(),
        filename: meta.filename || `payload${parsed.ext}`,
      },
    };
  } catch {
    return null;
  }
}

export async function payloadMeta(ref: string): Promise<PayloadMeta | null> {
  const r = await readPayload(ref);
  return r?.meta || null;
}
