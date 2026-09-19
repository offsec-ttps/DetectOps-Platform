/**
 * Stratus CLI detector.
 *
 * Looks for the `stratus` binary in (in order):
 *   1. STRATUS_BIN env override
 *   2. /usr/local/bin/stratus
 *   3. ~/go/bin/stratus
 *   4. system PATH (`which stratus`)
 *
 * Returns structured info so the UI can hint to the user how to install
 * when missing.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

const exec = promisify(execFile);

export interface StratusInfo {
  found: boolean;
  binary: string;
  version: string | null;
  installHint: string;
  searchedPaths: string[];
}

const INSTALL_HINT =
  "Stratus CLI not found. Install with `brew install stratus-red-team` (macOS) " +
  "or `go install github.com/datadog/stratus-red-team/v2/cmd/stratus@latest` (Go), " +
  "or set STRATUS_BIN to the binary path.";

let cached: StratusInfo | null = null;

export async function detectStratusCli(force = false): Promise<StratusInfo> {
  if (cached && !force) return cached;
  const searched: string[] = [];
  const candidates: string[] = [];

  if (process.env.STRATUS_BIN) candidates.push(process.env.STRATUS_BIN);
  candidates.push("/usr/local/bin/stratus");
  if (process.env.HOME) candidates.push(join(process.env.HOME, "go", "bin", "stratus"));
  try {
    const { stdout } = await exec("which", ["stratus"], { timeout: 3000 });
    const p = stdout.trim();
    if (p) candidates.push(p);
  } catch { /* not on PATH */ }

  for (const c of candidates) {
    searched.push(c);
    if (!existsSync(c)) continue;
    try {
      const { stdout } = await exec(c, ["version"], { timeout: 5000 });
      cached = { found: true, binary: c, version: stdout.trim().split("\n")[0], installHint: "", searchedPaths: searched };
      return cached;
    } catch {
      // try --version as a fallback (older versions)
      try {
        const { stdout } = await exec(c, ["--version"], { timeout: 5000 });
        cached = { found: true, binary: c, version: stdout.trim().split("\n")[0], installHint: "", searchedPaths: searched };
        return cached;
      } catch { /* binary present but broken */ }
    }
  }

  cached = { found: false, binary: "", version: null, installHint: INSTALL_HINT, searchedPaths: searched };
  return cached;
}
