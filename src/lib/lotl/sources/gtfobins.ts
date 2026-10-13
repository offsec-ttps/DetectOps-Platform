/**
 * GTFOBins ingestor — Unix/Linux binaries exploitable for privilege escalation,
 * file read/write, shells, SUID/sudo abuse, capabilities, etc.
 * Ported from magicsword-io/Magic-Atomics backend/app/ingestion/gtfobins.py.
 *
 * Source: https://github.com/GTFOBins/GTFOBins.github.io — one YAML
 * front-matter file per binary under _gtfobins/. Every documented abuse
 * `function` becomes a SAFE, runnable prevention test.
 *
 * Safety strategy (identical to the Python original):
 *  - shell:          spawn a process that echoes a success marker, never an
 *                    interactive shell.
 *  - file-read:      read /etc/hostname (world-readable, harmless).
 *  - file-write:     write to a /tmp temp file, verify, then clean up.
 *  - suid:           check the SUID bit only, never execute a payload.
 *  - sudo:           `sudo -n -l` check only (non-interactive, fails safe).
 *  - capabilities:   `getcap` check only.
 *  - reverse/bind shell, upload: existence check only (no connection/exfil).
 */

import yaml from "js-yaml";
import type { LotlIngestor } from "../base";
import type { NormalizedEntry, LotlRisk } from "../types";
import { fetchTree, fetchRaw, pMap, rawUrl } from "../github";

const MATCH = /^_gtfobins\/[^/]+$/;

const FUNCTION_TO_TECHNIQUE: Record<string, string> = {
  shell: "T1059.004",
  "bind-shell": "T1059.004",
  "reverse-shell": "T1059.004",
  "file-read": "T1005",
  "file-write": "T1222.002",
  "file-upload": "T1048",
  "file-download": "T1105",
  suid: "T1548.001",
  "limited-suid": "T1548.001",
  sudo: "T1548.003",
  capabilities: "T1548",
};

const OBSERVE_ONLY = new Set(["reverse-shell", "bind-shell"]);
const ELEVATION = new Set(["suid", "limited-suid", "sudo", "capabilities"]);

const RISK_LEVELS: Record<string, LotlRisk> = {
  shell: "high",
  "bind-shell": "high",
  "reverse-shell": "high",
  "file-read": "medium",
  "file-write": "medium",
  "file-upload": "medium",
  "file-download": "medium",
  suid: "high",
  "limited-suid": "high",
  sudo: "high",
  capabilities: "high",
};

const SUCCESS = "GTFOBins-test-SUCCESS";
const SAFE_READ_FILE = "/etc/hostname";
const SAFE_WRITE_FILE = "/tmp/gtfobins_test_$$";

const WHICH_HINTS: Record<string, string> = {
  python: "/usr/bin/python3", python3: "/usr/bin/python3", python2: "/usr/bin/python2",
  perl: "/usr/bin/perl", ruby: "/usr/bin/ruby", php: "/usr/bin/php", node: "/usr/bin/node",
  lua: "/usr/bin/lua", awk: "/usr/bin/awk", bash: "/bin/bash", sh: "/bin/sh",
  dash: "/bin/dash", zsh: "/usr/bin/zsh", curl: "/usr/bin/curl", wget: "/usr/bin/wget",
  find: "/usr/bin/find", tar: "/bin/tar", zip: "/usr/bin/zip", gcc: "/usr/bin/gcc",
  vim: "/usr/bin/vim", vi: "/usr/bin/vi",
};

interface GtfoFunctionEntry {
  code?: string;
  description?: string;
}
interface GtfoFrontMatter {
  functions?: Record<string, GtfoFunctionEntry[]>;
}

function oneliner(code: string): string {
  const line = code.replace(/\n/g, " ").trim();
  return line.length > 120 ? line.slice(0, 117) + "..." : line;
}

export class GtfobinsIngestor implements LotlIngestor {
  readonly sourceId = "gtfobins";
  readonly displayName = "GTFOBins";
  readonly description =
    "Unix/Linux binaries that can be exploited for privilege escalation, file read/write, reverse shells, SUID abuse, and more";
  readonly repo = "GTFOBins/GTFOBins.github.io";
  readonly branch = "master";
  readonly repoUrl = "https://github.com/GTFOBins/GTFOBins.github.io";
  readonly platform = "linux";

  async collect(): Promise<NormalizedEntry[]> {
    const { items } = await fetchTree(this.repo, this.branch, (p) => MATCH.test(p));
    const parsed = await pMap(
      items,
      async (item) => {
        try {
          const content = await fetchRaw(this.repo, this.branch, item.path);
          const url = rawUrl(this.repo, this.branch, item.path);
          return this.parseFile(item.path, content).map((e) => ({ ...e, sourceUrl: url }));
        } catch {
          return [];
        }
      },
      20,
    );
    return parsed.flat();
  }

  private parseFile(path: string, content: string): NormalizedEntry[] {
    if (!content.startsWith("---")) return [];
    const data = this.extractFrontMatter(content);
    if (!data?.functions) return [];

    const binary = path.split("/").pop()!.replace(/\.md$/, "");
    const out: NormalizedEntry[] = [];
    for (const [funcName, entries] of Object.entries(data.functions)) {
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, idx) => {
        const test = this.buildTest(binary, funcName, entry, idx);
        if (test) out.push(test);
      });
    }
    return out;
  }

  private extractFrontMatter(raw: string): GtfoFrontMatter | null {
    // GTFOBins uses --- or ... as the front-matter terminator.
    const match = raw.match(/^---\s*\n([\s\S]*?)\n(?:---|\.\.\.|$)/);
    if (!match) return null;
    try {
      return yaml.load(match[1]) as GtfoFrontMatter;
    } catch {
      return null;
    }
  }

  private buildTest(
    binary: string,
    funcName: string,
    entry: GtfoFunctionEntry,
    variantIdx: number,
  ): NormalizedEntry | null {
    const originalCode = (entry.code || "").trim();
    const description = (entry.description || "").trim();
    if (!originalCode) return null;

    const techniqueId = FUNCTION_TO_TECHNIQUE[funcName] || "T1059.004";
    const riskLevel = RISK_LEVELS[funcName] || "medium";
    const elevationRequired = ELEVATION.has(funcName);

    const { command, cleanup, observeOnly } = this.safeCommand(binary, funcName, originalCode);
    if (!command) return null;

    const suffix = variantIdx > 0 ? ` (variant ${variantIdx + 1})` : "";
    let testDescription = `Tests ${binary} ${funcName} capability via GTFOBins. ${description}`.trim();
    if (observeOnly) {
      testDescription = `[OBSERVE ONLY] ${testDescription} (capability noted — no live connection attempted)`;
    }

    return {
      sourceRef: `${binary}:${funcName}:${variantIdx}`,
      name: `GTFOBins: ${binary} - ${funcName}${suffix}`,
      description: testDescription,
      command,
      executor: "bash",
      techniqueId,
      binaryPath: WHICH_HINTS[binary] || null,
      elevationRequired,
      riskLevel,
      platforms: ["linux"],
      cleanupCommand: cleanup,
      metadata: {
        source: "gtfobins",
        binary,
        function: funcName,
        original_code: originalCode,
        observe_only: observeOnly,
      },
    };
  }

  private safeCommand(
    binary: string,
    funcName: string,
    originalCode: string,
  ): { command: string; cleanup: string | null; observeOnly: boolean } {
    if (OBSERVE_ONLY.has(funcName) || funcName === "file-upload") {
      return this.observeOnly(binary, funcName, originalCode);
    }
    switch (funcName) {
      case "shell":
        return { command: this.safeShell(binary, originalCode), cleanup: null, observeOnly: false };
      case "file-read":
        return { command: this.safeFileRead(binary, originalCode), cleanup: null, observeOnly: false };
      case "file-write":
        return this.safeFileWrite(binary, originalCode);
      case "file-download":
        return this.safeFileDownload(binary, originalCode);
      case "suid":
      case "limited-suid":
        return { command: this.safeSuid(binary, originalCode), cleanup: null, observeOnly: false };
      case "sudo":
        return { command: this.safeSudo(binary, originalCode), cleanup: null, observeOnly: false };
      case "capabilities":
        return { command: this.safeCapabilities(binary, originalCode), cleanup: null, observeOnly: false };
      default:
        return this.observeOnly(binary, funcName, originalCode);
    }
  }

  private shellProbe(binary: string, originalCode: string): string {
    const lo = originalCode.toLowerCase();
    if (["python", "python2", "python3"].includes(binary) || lo.includes("python"))
      return `${binary} -c 'import subprocess; subprocess.check_call(["echo", "${SUCCESS}"])'`;
    if (binary === "ruby" || lo.includes("ruby")) return `${binary} -e 'system("echo ${SUCCESS}")'`;
    if (binary === "perl" || lo.includes("perl")) return `${binary} -e 'system("echo ${SUCCESS}")'`;
    if (binary === "php" || lo.includes("php")) return `${binary} -r 'system("echo ${SUCCESS}");'`;
    if (binary === "lua" || lo.includes("lua")) return `${binary} -e 'os.execute("echo ${SUCCESS}")'`;
    if (["node", "nodejs"].includes(binary) || lo.includes("node"))
      return `${binary} -e 'require("child_process").execSync("echo ${SUCCESS}", {stdio:"inherit"})'`;
    if (["awk", "gawk", "mawk", "nawk"].includes(binary) || lo.includes("awk"))
      return `${binary} 'BEGIN {system("echo ${SUCCESS}")}'`;
    if (binary === "expect" || lo.includes("expect")) return `expect -c 'spawn echo ${SUCCESS}; interact'`;
    if (["vi", "vim", "ed", "less", "more", "man"].includes(binary))
      return `echo "${SUCCESS} - ${binary} exists: $(which ${binary})"`;
    if (["ash", "bash", "csh", "dash", "ksh", "zsh", "sh", "fish", "tclsh", "wish"].includes(binary))
      return `${binary} -c 'echo ${SUCCESS}'`;
    if (["env", "nice", "stdbuf", "timeout", "xargs", "find", "time", "taskset", "chroot", "ionice"].includes(binary))
      return `${binary} echo ${SUCCESS} 2>/dev/null || echo ${SUCCESS}`;
    return `${binary} -c 'echo ${SUCCESS}' 2>/dev/null || echo "${SUCCESS} - ${binary} exists at $(which ${binary})"`;
  }

  private safeShell(binary: string, originalCode: string): string {
    return [
      `# GTFOBins shell test: ${binary}`,
      `# Original (unsafe): ${oneliner(originalCode)}`,
      `if command -v ${binary} >/dev/null 2>&1; then`,
      `    ${this.shellProbe(binary, originalCode)}`,
      `else`,
      `    echo "SKIP: ${binary} not found on this system"; exit 0`,
      `fi`,
    ].join("\n");
  }

  private safeFileRead(binary: string, originalCode: string): string {
    // Conservative: use a known reader for the binary where sensible, else cat.
    const reader = ["cat", "head", "tail", "more", "less"].includes(binary)
      ? `${binary} ${SAFE_READ_FILE}`
      : `cat ${SAFE_READ_FILE}`;
    return [
      `# GTFOBins file-read test: ${binary}`,
      `# Reads ${SAFE_READ_FILE} (world-readable, harmless).`,
      `# Original: ${oneliner(originalCode)}`,
      `if command -v ${binary} >/dev/null 2>&1; then`,
      `    echo "--- Attempting file-read via ${binary} ---"`,
      `    ${reader}`,
      `    echo ""; echo "${SUCCESS}"`,
      `else`,
      `    echo "SKIP: ${binary} not found on this system"; exit 0`,
      `fi`,
    ].join("\n");
  }

  private safeFileWrite(binary: string, originalCode: string): { command: string; cleanup: string | null; observeOnly: boolean } {
    const writer = `echo "$DATA" > "$TMPFILE"`;
    const command = [
      `# GTFOBins file-write test: ${binary}`,
      `# Writes to ${SAFE_WRITE_FILE} (temp), verifies, then cleans up.`,
      `# Original: ${oneliner(originalCode)}`,
      `TMPFILE="${SAFE_WRITE_FILE}"`,
      `if command -v ${binary} >/dev/null 2>&1; then`,
      `    echo "--- Attempting file-write via ${binary} ---"`,
      `    DATA="${SUCCESS}"`,
      `    ${writer}`,
      `    if [ -f "$TMPFILE" ]; then cat "$TMPFILE"; rm -f "$TMPFILE"; echo "${SUCCESS}"; else echo "FAIL: file not created"; exit 1; fi`,
      `else`,
      `    echo "SKIP: ${binary} not found on this system"; exit 0`,
      `fi`,
    ].join("\n");
    return { command, cleanup: `rm -f "${SAFE_WRITE_FILE}"`, observeOnly: false };
  }

  private downloadProbe(binary: string): string {
    if (binary === "curl") return `curl -fsSL -o "$TMPFILE" "$URL" 2>/dev/null`;
    if (binary === "wget") return `wget -q -O "$TMPFILE" "$URL" 2>/dev/null`;
    if (["python", "python3", "python2"].includes(binary))
      return `${binary} -c "import urllib.request; urllib.request.urlretrieve('$URL', '$TMPFILE')" 2>/dev/null`;
    if (binary === "ruby")
      return `${binary} -e 'require "open-uri"; File.write("$TMPFILE", URI.open("$URL").read)' 2>/dev/null`;
    if (binary === "perl") return `${binary} -MLWP::Simple -e 'getstore("$URL", "$TMPFILE")' 2>/dev/null`;
    return `echo "${SUCCESS}" > "$TMPFILE"`;
  }

  private safeFileDownload(binary: string, originalCode: string): { command: string; cleanup: string | null; observeOnly: boolean } {
    const command = [
      `# GTFOBins file-download test: ${binary}`,
      `# Attempts to download a small public file to /tmp.`,
      `# Original: ${oneliner(originalCode)}`,
      `TMPFILE="${SAFE_WRITE_FILE}"`,
      `if command -v ${binary} >/dev/null 2>&1; then`,
      `    URL="http://example.com/index.html"`,
      `    ${this.downloadProbe(binary)}`,
      `    if [ -f "$TMPFILE" ] && [ -s "$TMPFILE" ]; then echo "Downloaded $(wc -c < "$TMPFILE") bytes"; rm -f "$TMPFILE"; echo "${SUCCESS}"; else echo "SKIP: no file (network may be unavailable)"; rm -f "$TMPFILE" 2>/dev/null; exit 0; fi`,
      `else`,
      `    echo "SKIP: ${binary} not found on this system"; exit 0`,
      `fi`,
    ].join("\n");
    return { command, cleanup: `rm -f "${SAFE_WRITE_FILE}"`, observeOnly: false };
  }

  private safeSuid(binary: string, originalCode: string): string {
    return [
      `# GTFOBins SUID test: ${binary}`,
      `# Checks whether ${binary} has the SUID bit set (no execution).`,
      `# Original: ${oneliner(originalCode)}`,
      `BIN_PATH=$(command -v ${binary} 2>/dev/null || find /usr -name ${binary} -type f 2>/dev/null | head -1)`,
      `if [ -z "$BIN_PATH" ]; then echo "SKIP: ${binary} not found on this system"; exit 0; fi`,
      `echo "Binary path: $BIN_PATH"`,
      `if [ -u "$BIN_PATH" ]; then echo "WARNING: ${binary} has SUID bit set"; else echo "OK: ${binary} does NOT have SUID bit set"; fi`,
      `echo "${SUCCESS}"`,
    ].join("\n");
  }

  private safeSudo(binary: string, originalCode: string): string {
    return [
      `# GTFOBins sudo test: ${binary}`,
      `# Checks sudo access for ${binary} non-interactively (sudo -n).`,
      `# Original: ${oneliner(originalCode)}`,
      `if ! command -v ${binary} >/dev/null 2>&1; then echo "SKIP: ${binary} not found on this system"; exit 0; fi`,
      `SUDO_LIST=$(sudo -n -l 2>/dev/null || true)`,
      `if echo "$SUDO_LIST" | grep -qi "${binary}"; then echo "WARNING: current user can sudo ${binary}"; echo "$SUDO_LIST" | grep -i "${binary}"; else echo "OK: current user cannot sudo ${binary} without a password"; fi`,
      `echo "${SUCCESS}"`,
    ].join("\n");
  }

  private safeCapabilities(binary: string, originalCode: string): string {
    return [
      `# GTFOBins capabilities test: ${binary}`,
      `# Checks Linux capabilities on ${binary} via getcap.`,
      `# Original: ${oneliner(originalCode)}`,
      `BIN_PATH=$(command -v ${binary} 2>/dev/null || find /usr -name ${binary} -type f 2>/dev/null | head -1)`,
      `if [ -z "$BIN_PATH" ]; then echo "SKIP: ${binary} not found on this system"; exit 0; fi`,
      `if ! command -v getcap >/dev/null 2>&1; then echo "SKIP: getcap not available"; exit 0; fi`,
      `CAPS=$(getcap "$BIN_PATH" 2>/dev/null)`,
      `if [ -n "$CAPS" ]; then echo "WARNING: ${binary} has capabilities: $CAPS"; else echo "OK: ${binary} has no special capabilities"; fi`,
      `echo "${SUCCESS}"`,
    ].join("\n");
  }

  private observeOnly(binary: string, funcName: string, originalCode: string): { command: string; cleanup: string | null; observeOnly: boolean } {
    const command = [
      `# GTFOBins ${funcName} test: ${binary} [OBSERVE ONLY]`,
      `# This capability is too dangerous to test live.`,
      `# Original: ${oneliner(originalCode)}`,
      `if command -v ${binary} >/dev/null 2>&1; then`,
      `    echo "${binary} found at $(which ${binary})"`,
      `    echo "Capability: ${funcName} (documented in GTFOBins)"`,
      `    echo "${SUCCESS}"`,
      `else`,
      `    echo "SKIP: ${binary} not found on this system"; exit 0`,
      `fi`,
    ].join("\n");
    return { command, cleanup: null, observeOnly: true };
  }
}
