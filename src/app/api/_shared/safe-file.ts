/**
 * Helpers for routes that serve or delete files whose paths are stored in the
 * DB. A stored path is only honoured when its *real* path (symlinks resolved)
 * is a regular file inside an expected base directory, so a poisoned row or a
 * symlink planted by a build can't turn a download into an arbitrary file read.
 */
import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

/** Root of Build Forge state (build cache, artifacts, binary collection). */
export const BUILD_FORGE_BASE = resolve(process.cwd(), "..", "MCP-DetecOps", "tmp");
export const BINARY_COLLECTION_DIR = resolve(BUILD_FORGE_BASE, "binary-collection");

/** Returns the resolved path if `p` is an existing regular file under one of `bases`, else null. */
export function confinedFile(p: string | null | undefined, bases: string[]): string | null {
  if (!p || typeof p !== "string") return null;
  let real: string;
  try { real = realpathSync(p); } catch { return null; }
  const inside = bases.some((b) => {
    let rb: string;
    try { rb = realpathSync(b); } catch { rb = resolve(b); }
    return real.startsWith(rb.endsWith(sep) ? rb : rb + sep);
  });
  if (!inside) return null;
  try { if (!statSync(real).isFile()) return null; } catch { return null; }
  return real;
}

/**
 * Builds a safe Content-Disposition value: an ASCII-only quoted fallback (no
 * quotes, backslashes, CR/LF or other control chars) plus RFC 5987 filename*.
 */
export function attachmentDisposition(name: string | null | undefined, fallback = "download"): string {
  const raw = String(name || "").split(/[\\/]/).pop() || "";
  const ascii = raw.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").slice(0, 150) || fallback;
  const utf8 = encodeURIComponent(raw.slice(0, 150) || fallback)
    .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
