/**
 * Sigma CLI / pySigma wrapper.
 *
 * Tries to locate a working Sigma CLI installation in (in order):
 *   1. SIGMA_CLI_PATH env var
 *   2. detection-platform backend venv (/backend/.venv/bin/sigma)
 *   3. ~/.local/bin/sigma
 *   4. system PATH (`which sigma`)
 *
 * If none is found, returns a structured error with install instructions
 * so the UI can guide the user instead of crashing.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync } from "fs";
import { writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

const exec = promisify(execFile);

export interface SigmaCliInfo {
  found: boolean;
  binary: string;
  version: string | null;
  installHint: string;
  searchedPaths: string[];
}

const INSTALL_HINT =
  "Sigma CLI not found. Install with: " +
  "`pip install sigma-cli pysigma-backend-splunk pysigma-backend-elasticsearch`. " +
  "Or set SIGMA_CLI_PATH to a sigma binary location.";

let cachedInfo: SigmaCliInfo | null = null;

export async function detectSigmaCli(force = false): Promise<SigmaCliInfo> {
  if (cachedInfo && !force) return cachedInfo;

  const searched: string[] = [];
  const candidates: string[] = [];

  if (process.env.SIGMA_CLI_PATH) candidates.push(process.env.SIGMA_CLI_PATH);

  // detection-platform backend venv
  candidates.push(path.join(process.cwd(), "backend", ".venv", "bin", "sigma"));

  // user-local pip install
  if (process.env.HOME) {
    candidates.push(path.join(process.env.HOME, ".local", "bin", "sigma"));
  }

  // System PATH
  try {
    const { stdout } = await exec("which", ["sigma"], { timeout: 3000 });
    const onPath = stdout.trim();
    if (onPath) candidates.push(onPath);
  } catch { /* not on PATH */ }

  for (const c of candidates) {
    searched.push(c);
    if (!existsSync(c)) continue;
    // sigma-cli ≥ 1.0 dropped `--version` in favour of the `version`
    // subcommand. Try the new form first, fall back to the legacy flag.
    let version: string | null = null;
    for (const args of [["version"], ["--version"]]) {
      try {
        const { stdout } = await exec(c, args, { timeout: 5000 });
        version = stdout.trim();
        break;
      } catch { /* try next form */ }
    }
    if (version) {
      cachedInfo = {
        found: true, binary: c, version, installHint: "", searchedPaths: searched,
      };
      return cachedInfo;
    }
    // Binary present but neither version invocation worked — keep looking.
  }

  cachedInfo = {
    found: false, binary: "", version: null,
    installHint: INSTALL_HINT, searchedPaths: searched,
  };
  return cachedInfo;
}

/**
 * Read installed backend packages directly from the venv site-packages — instant
 * and offline, unlike `sigma plugin list` which fetches the plugin registry over
 * the network (~20s and re-run on every page load). The package dir name is the
 * `-t` target id (splunk, elasticsearch, kusto, …).
 */
function backendsFromVenv(binary: string): string[] | null {
  try {
    const venv = path.dirname(path.dirname(binary)); // <venv>/bin/sigma → <venv>
    const libDir = path.join(venv, "lib");
    if (!existsSync(libDir)) return null;
    const py = readdirSync(libDir).find((d) => /^python3/.test(d));
    if (!py) return null;
    const bdir = path.join(libDir, py, "site-packages", "sigma", "backends");
    if (!existsSync(bdir)) return null;
    return readdirSync(bdir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "__pycache__" && e.name !== "test")
      .map((e) => e.name);
  } catch { return null; }
}

let cachedBackends: { found: boolean; backends: string[]; raw: string; error?: string } | null = null;

/** List installed pySigma backends. Offline (venv) first, CLI fallback; cached. */
export async function listBackends(force = false): Promise<{ found: boolean; backends: string[]; raw: string; error?: string }> {
  if (cachedBackends && !force) return cachedBackends;
  const info = await detectSigmaCli();
  if (!info.found) {
    return { found: false, backends: [], raw: "", error: info.installHint };
  }
  // Fast path: read installed backend packages straight from the venv.
  const offline = backendsFromVenv(info.binary);
  if (offline && offline.length) {
    cachedBackends = { found: true, backends: offline.sort(), raw: offline.join("\n") };
    return cachedBackends;
  }
  try {
    // `sigma plugin list` prints the whole plugin registry in a bordered
    // table, including backends that are incompatible with the installed
    // pySigma core (Compatible? = no) and therefore cannot convert. Filter to
    // backends only (`-t backend`) that are compatible (`-c`) so we never
    // advertise a target that `sigma convert` will reject. (There is no CLI
    // flag to list only pip-installed plugins in this version; `-c` is the
    // closest signal for "can actually convert to right now".)
    const { stdout: installedOut } = await exec(
      info.binary, ["plugin", "list", "-t", "backend", "-c"],
      { timeout: 10000 },
    ).catch(async () => {
      // Fallback for older sigma-cli that lacks the -t/-c filters: list all
      // plugins and let the row regex keep only `backend`-type entries.
      return await exec(info.binary, ["plugin", "list"], { timeout: 10000 });
    });
    // Table rows look like:  "| splunk         | backend  | stable  | ..."
    const backends: string[] = [];
    for (const line of installedOut.split("\n")) {
      const m = line.match(/^\|\s*([a-z][\w-]+)\s*\|\s*backend\s*\|/i);
      if (m) backends.push(m[1]);
    }
    cachedBackends = { found: true, backends, raw: installedOut };
    return cachedBackends;
  } catch (err: any) {
    return { found: false, backends: [], raw: "", error: err.message };
  }
}

export interface ConvertResult {
  success: boolean;
  query: string;
  stderr: string;
  toolVersion: string;
  error?: string;
  installHint?: string;
}

/**
 * Convert a Sigma YAML rule to the target backend.
 * Writes the YAML to a temp file, invokes `sigma convert -t <backend> <file>`,
 * captures stdout as the converted query.
 */
// A default processing pipeline per backend so conversion produces real,
// field-mapped queries (e.g. Splunk gets Sysmon EventID/field mapping) instead of
// raw field names. Callers may override; if the pipeline doesn't apply to the
// rule's logsource we retry --without-pipeline so a query is still returned.
const DEFAULT_PIPELINE: Record<string, string> = {
  splunk: "sysmon",
  elasticsearch: "ecs_windows",
  opensearch: "ecs_windows",
  "elasticsearch-eql": "ecs_windows",
  kusto: "microsoft_xdr",
  microsoft365defender: "microsoft_365_defender",
};

export async function convertSigmaRule(
  yamlContent: string,
  targetBackend: string,
  outputFormat?: string,
  pipeline?: string,
): Promise<ConvertResult & { pipeline?: string }> {
  const info = await detectSigmaCli();
  if (!info.found) {
    return {
      success: false, query: "", stderr: "", toolVersion: "",
      error: "Sigma CLI not installed", installHint: info.installHint,
    };
  }

  const tmp = await mkdtemp(path.join(tmpdir(), "sigma-convert-"));
  const tmpFile = path.join(tmp, "rule.yml");
  await writeFile(tmpFile, yamlContent, "utf-8");

  const run = async (pipe: string | null): Promise<ConvertResult & { pipeline?: string }> => {
    const args = ["convert", "-t", targetBackend];
    if (pipe) args.push("-p", pipe); else args.push("--without-pipeline");
    if (outputFormat) args.push("-f", outputFormat);
    args.push(tmpFile);
    const { stdout, stderr } = await exec(info.binary, args, { timeout: 30000 });
    return { success: true, query: stdout.trim(), stderr: stderr || "", toolVersion: info.version || "", pipeline: pipe || undefined };
  };

  // Prefer an explicit pipeline, else a sensible per-backend default; fall back
  // to no pipeline if the chosen one can't be applied to this rule.
  const chosen = pipeline || DEFAULT_PIPELINE[targetBackend] || null;
  try {
    try {
      return await run(chosen);
    } catch (e: any) {
      if (chosen) return await run(null);
      throw e;
    }
  } catch (err: any) {
    // Sigma CLI returns non-zero on conversion errors but writes useful info to stderr
    return {
      success: false, query: "", stderr: err.stderr || "",
      toolVersion: info.version || "",
      error: err.message || "conversion failed",
    };
  } finally {
    try { await rm(tmp, { recursive: true, force: true }); } catch {}
  }
}
