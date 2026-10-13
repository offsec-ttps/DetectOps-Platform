/**
 * Pre-flight checks for running a LOTL technique on a chosen target.
 *
 * Two things make a LOTL command fail before it even starts:
 *   1. the technique targets a different OS than the server (a Windows binary
 *      sent to a Linux host), and
 *   2. the reference command still contains template placeholders such as
 *      {PATH:.dll} that need a real value from the operator.
 *
 * Rather than run a command that cannot succeed, the Campaign Designer skips it
 * and reports the reason, so the analyst sees an accurate status.
 */

import { compileLotl } from "./compile";

/** Does a technique's platform list run on the target's OS? Unknown OS never blocks. */
export function platformMatchesTarget(techniquePlatforms: string[], targetOs: string): boolean {
  const os = (targetOs || "").toLowerCase();
  const set = new Set((techniquePlatforms || []).map((p) => p.toLowerCase()));
  if (set.size === 0 || !os) return true;
  if (os.includes("win")) return set.has("windows");
  if (os.includes("mac") || os.includes("darwin") || os.includes("osx")) return set.has("macos") || set.has("darwin");
  if (os.includes("lin") || os.includes("nix") || os.includes("ubuntu") || os.includes("debian") || os.includes("centos")) return set.has("linux");
  return true;
}

/** Template placeholders (e.g. {PATH:.dll}, {LSASS_PID}) left in a reference command. */
export function findPlaceholders(command: string): string[] {
  return [...new Set([...(command || "").matchAll(/\{[A-Z][A-Z_]*(?::[^}]+)?\}/g)].map((m) => m[0]))];
}

export interface SkippedTechnique {
  id: string;
  name: string;
  reason: string;
}

/**
 * Split a selection into runnable rows and skipped rows with a reason for each.
 *
 * Placeholder handling defers to compileLotl: it stages benign artifacts for
 * {PATH*}, resolves {LSASS_PID}/{URL}, etc. A technique is only skipped when
 * compileLotl reports placeholders it CANNOT resolve (e.g. {PATH_SMB}, which
 * needs a real share) — not merely because a placeholder is present. Before this,
 * any placeholder was skipped, which (now that the compiler resolves most of
 * them) wrongly rejected runnable techniques like `colorcpl {PATH}`.
 */
export function splitRunnable<T extends { id: string; name: string; command: string; platforms: string; executor?: string }>(
  rows: T[],
  targetOs: string,
): { runnable: T[]; skipped: SkippedTechnique[] } {
  const runnable: T[] = [];
  const skipped: SkippedTechnique[] = [];
  for (const r of rows) {
    let platforms: string[] = [];
    try { platforms = JSON.parse(r.platforms || "[]"); } catch { /* treat as unknown */ }
    if (!platformMatchesTarget(platforms, targetOs)) {
      skipped.push({ id: r.id, name: r.name, reason: `platform mismatch: technique is ${platforms.join("/") || "unknown"}, target is ${targetOs}` });
      continue;
    }
    const compiled = compileLotl({ command: r.command, executor: r.executor || "manual", platforms });
    if (compiled.unresolved.length) {
      skipped.push({ id: r.id, name: r.name, reason: `needs operator input for ${compiled.unresolved.join(", ")}` });
      continue;
    }
    runnable.push(r);
  }
  return { runnable, skipped };
}
