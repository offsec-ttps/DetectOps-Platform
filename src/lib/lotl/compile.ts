/**
 * Compile a LOTL technique into a runnable "atomic contract" at run time.
 *
 * LOLBAS and friends ship reference commands with placeholders that are not
 * executable as-is: `{PATH:.dll}` / `{PATH_ABSOLUTE:.sct}` (a payload artifact
 * of some type), `{LSASS_PID}` (a value resolved on the target), `{URL}`, etc.
 * This module turns a LotlTechnique row into a self-contained, deterministic
 * script that:
 *   1. stages benign artifacts for any {PATH:*} placeholder,
 *   2. resolves dynamic values ({LSASS_PID}, {URL}) on-target,
 *   3. runs the original command with placeholders substituted,
 *   4. cleans up staged artifacts.
 *
 * It is a PURE function of the row, so the fleet bundle pipeline can rebuild +
 * re-hash it identically (hash-pinned model preserved), and the SSH runner can
 * run the same script. Techniques with no recognized placeholders pass through
 * unchanged (GTFOBins/LOOBins/LOAS/etc. are already self-contained safe probes).
 *
 * Safety: staged artifacts are inert. Script-type artifacts (.ps1/.vbs/.hta/…)
 * emit only a success marker; binary-type artifacts (.dll/.exe/.cpl/…) are
 * placeholders that make the invocation observable (for detection) without
 * carrying a real payload. Genuinely destructive techniques still run behind
 * the runner's confirmDestructive + consent gates.
 */

export interface LotlCompileInput {
  command: string;
  executor: string;          // cmd | powershell | bash | manual
  cleanupCommand?: string | null;
  platforms: string[];       // ["windows"] | ["linux"] | ["macos"] | ...
  name?: string;
}

export interface CompiledLotl {
  executor: "cmd" | "powershell" | "bash" | "manual";
  command: string;
  cleanupCommand: string;
  platform: "windows" | "linux" | "macos" | "multi";
  /** Placeholder tokens that were resolved. */
  resolved: string[];
  /** Human-readable notes (e.g. "benign .dll artifact staged"). */
  warnings: string[];
  /** True when the command still contains unresolved placeholders. */
  unresolved: string[];
}

const SUCCESS = "LOTL-ARTIFACT-OK";
const MARKER = "LOTL-TEST-MARKER";
const SAFE_URL = "http://example.com/index.html";

// Benign content per artifact extension. Script types do something harmless and
// observable; binary types are inert placeholders (invocation still fires).
function artifactContent(ext: string): { content: string; valid: boolean } {
  const e = ext.replace(/^\./, "").toLowerCase();
  switch (e) {
    case "ps1": return { content: `Write-Output '${SUCCESS}'`, valid: true };
    case "bat": case "cmd": return { content: `@echo ${SUCCESS}`, valid: true };
    case "vbs": return { content: `WScript.Echo "${SUCCESS}"`, valid: true };
    case "js": case "jse": return { content: `WScript.Echo("${SUCCESS}");`, valid: true };
    case "hta": return { content: `<html><head><script>document.write('${SUCCESS}')</script></head><body>${SUCCESS}</body></html>`, valid: true };
    case "sct": return { content: `<?XML version="1.0"?><scriptlet><registration progid="LOTL" classid="{10001111-0000-0000-0000-000000000001}"><script language="JScript"><![CDATA[var x='${SUCCESS}';]]></script></registration></scriptlet>`, valid: true };
    case "xsl": return { content: `<?xml version='1.0'?><stylesheet xmlns="http://www.w3.org/1999/XSL/Transform" version="1.0"><output method="text"/><template match="/">${SUCCESS}</template></stylesheet>`, valid: true };
    case "xml": return { content: `<?xml version='1.0'?><root>${SUCCESS}</root>`, valid: true };
    case "inf": return { content: `[version]\\nSignature=$CHICAGO$\\n[DefaultInstall]\\n; ${MARKER}`, valid: true };
    case "txt": case "log": case "ini": return { content: MARKER, valid: true };
    // Binary / PE types — cannot forge a valid PE inline; stage an inert
    // placeholder so the host binary is still invoked (observable for detection).
    case "dll": case "exe": case "cpl": case "ocx": case "sys": case "scr": case "com": case "bin":
      return { content: `${MARKER} (inert placeholder; not a valid ${e.toUpperCase()})`, valid: false };
    default:
      return { content: MARKER, valid: true };
  }
}

const PLACEHOLDER_RE = /\{([A-Z_]+)(?::([^}]+))?\}/g;

function detectPlaceholders(command: string): Array<{ token: string; kind: string; arg?: string }> {
  const out: Array<{ token: string; kind: string; arg?: string }> = [];
  for (const m of command.matchAll(PLACEHOLDER_RE)) {
    out.push({ token: m[0], kind: m[1], arg: m[2] });
  }
  return out;
}

function primaryPlatform(platforms: string[]): "windows" | "linux" | "macos" | "multi" {
  const set = new Set(platforms.map((p) => p.toLowerCase()));
  if (set.size > 1) {
    if (set.has("windows")) return "windows"; // placeholders are a Windows concern
  }
  if (set.has("windows")) return "windows";
  if (set.has("linux")) return "linux";
  if (set.has("macos") || set.has("darwin")) return "macos";
  return "multi";
}

/**
 * Windows compile: wrap in PowerShell (always present as powershell.exe), stage
 * artifacts via Set-Content, resolve dynamics, run the original command (cmd
 * commands via `cmd /c`), then clean up. Deterministic.
 */
function compileWindows(input: LotlCompileInput, placeholders: ReturnType<typeof detectPlaceholders>): CompiledLotl {
  const resolved: string[] = [];
  const warnings: string[] = [];
  const unresolved: string[] = [];
  const stage: string[] = [];
  const cleanup: string[] = [];
  let cmd = input.command;

  let pathIdx = 0;
  for (const ph of placeholders) {
    if (ph.kind === "PATH" || ph.kind === "PATH_ABSOLUTE") {
      const ext = (ph.arg || ".txt").trim();
      const safeExt = ext.replace(/[^A-Za-z0-9.]/g, "") || ".txt";
      const varName = `$lotlArt${pathIdx++}`;
      const { content, valid } = artifactContent(safeExt);
      const fileName = `lotl_${Math.abs(hashStr(ph.token + pathIdx))}${safeExt.startsWith(".") ? safeExt : "." + safeExt}`;
      stage.push(`${varName} = Join-Path $env:TEMP '${fileName}'`);
      stage.push(`Set-Content -Path ${varName} -Value @'\n${content}\n'@ -Encoding ASCII -Force`);
      cleanup.push(`Remove-Item -Path (Join-Path $env:TEMP '${fileName}') -ErrorAction SilentlyContinue`);
      // Substitute every occurrence of this exact token with the staged path.
      cmd = cmd.split(ph.token).join(`$($env:TEMP + '\\${fileName}')`);
      resolved.push(ph.token);
      if (!valid) warnings.push(`${ph.token}: staged inert ${safeExt} placeholder (invocation observable; payload will not load)`);
      else warnings.push(`${ph.token}: staged benign ${safeExt} artifact`);
    } else if (ph.kind === "LSASS_PID") {
      cmd = cmd.split(ph.token).join(`$((Get-Process lsass -ErrorAction SilentlyContinue).Id)`);
      resolved.push(ph.token);
      warnings.push(`${ph.token}: resolved to the live lsass PID on the target`);
    } else if (ph.kind === "URL") {
      cmd = cmd.split(ph.token).join(SAFE_URL);
      resolved.push(ph.token);
      warnings.push(`${ph.token}: resolved to a benign URL`);
    } else {
      unresolved.push(ph.token);
    }
  }

  // Run the original command via its native interpreter inside the PS wrapper.
  const runLine = input.executor === "powershell"
    ? cmd
    : `cmd /c @"\n${cmd}\n"@`;

  const script = [
    `# LOTL compiled: ${input.name || ""}`.trim(),
    ...stage,
    `try {`,
    `  ${runLine}`,
    `} finally {`,
    ...cleanup.map((c) => `  ${c}`),
    input.cleanupCommand ? `  try { ${input.executor === "powershell" ? input.cleanupCommand : `cmd /c @"\n${input.cleanupCommand}\n"@`} } catch {}` : `  # no original cleanup`,
    `}`,
  ].join("\n");

  return {
    executor: "powershell",
    command: script,
    cleanupCommand: cleanup.join("; "),
    platform: "windows",
    resolved,
    warnings,
    unresolved,
  };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return h;
}

/**
 * Compile a LOTL technique for execution. Pure + deterministic.
 */
export function compileLotl(input: LotlCompileInput): CompiledLotl {
  const platform = primaryPlatform(input.platforms || []);
  const placeholders = detectPlaceholders(input.command || "");

  // No recognized placeholders → self-contained; pass through unchanged.
  if (placeholders.length === 0) {
    return {
      executor: (["cmd", "powershell", "bash", "manual"].includes(input.executor) ? input.executor : "bash") as CompiledLotl["executor"],
      command: input.command,
      cleanupCommand: input.cleanupCommand || "",
      platform,
      resolved: [],
      warnings: [],
      unresolved: [],
    };
  }

  if (platform === "windows") return compileWindows(input, placeholders);

  // Unix placeholders are rare; substitute the known ones, leave the rest.
  let cmd = input.command;
  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const ph of placeholders) {
    if (ph.kind === "URL") { cmd = cmd.split(ph.token).join(SAFE_URL); resolved.push(ph.token); }
    else unresolved.push(ph.token);
  }
  return {
    executor: (input.executor === "manual" ? "manual" : "bash"),
    command: cmd,
    cleanupCommand: input.cleanupCommand || "",
    platform,
    resolved,
    warnings: [],
    unresolved,
  };
}

/** Does a technique's platform set run on the chosen target OS? */
export function platformMatchesTarget(techniquePlatforms: string[], targetOs: string): boolean {
  const os = (targetOs || "").toLowerCase();
  const set = new Set((techniquePlatforms || []).map((p) => p.toLowerCase()));
  if (set.size === 0) return true;
  if (os.includes("win")) return set.has("windows");
  if (os.includes("lin") || os.includes("nix") || os.includes("ubuntu") || os.includes("debian")) return set.has("linux");
  if (os.includes("mac") || os.includes("darwin") || os.includes("osx")) return set.has("macos") || set.has("darwin");
  return true; // unknown OS → don't block
}
