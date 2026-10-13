/**
 * LOTTunnels ingestor — Living Off The Tunnels.
 * Ported from magicsword-io/Magic-Atomics backend/app/ingestion/loltunnels.py.
 *
 * Source: https://github.com/LOTTunnels/LOTTunnels.github.io — one Jekyll
 * front-matter file per tool under _lottunnels/Binaries/. These are legitimate
 * tunneling/proxy tools (ngrok, cloudflared, chisel, frp, …) abused for C2,
 * exfiltration, and persistent remote access.
 *
 * Per the Python's safety model, every tool gets the detection tests that work
 * without any download: "detect existing installation" and "relay-domain
 * connectivity". We generate exactly those here (PowerShell + bash), using the
 * binary name and Detection domains from each tool's front matter. The Python's
 * hardcoded download-and-execute catalog (which carries per-tool download URLs)
 * is intentionally not reproduced — those tests actually fetch the tool, so the
 * safe detection tests are the portable, non-destructive core.
 */

import yaml from "js-yaml";
import type { LotlIngestor } from "../base";
import type { NormalizedEntry } from "../types";
import { fetchTree, fetchRaw, pMap, rawUrl } from "../github";

const MATCH = /^_lottunnels\/Binaries\/.+\.md$/;
const DEFAULT_TECHNIQUE = "T1572"; // Protocol Tunneling

interface TunnelFrontMatter {
  Name?: string;
  Description?: string;
  Full_Path?: Array<{ Filename?: string; Path?: string }>;
  Commands?: Array<{ OperatingSystem?: string }>;
  Detection?: Array<{ Domain?: string } | string>;
}

function osToPlatforms(fm: TunnelFrontMatter): string[] {
  const set = new Set<string>();
  for (const c of fm.Commands || []) {
    const os = (c.OperatingSystem || "").toLowerCase();
    if (os.includes("windows")) set.add("windows");
    if (os.includes("linux")) set.add("linux");
    if (os.includes("mac")) set.add("macos");
  }
  return set.size ? [...set] : ["windows", "linux", "macos"];
}

function domainsOf(fm: TunnelFrontMatter): string[] {
  const out: string[] = [];
  for (const d of fm.Detection || []) {
    if (typeof d === "object" && d.Domain) out.push(d.Domain);
  }
  return out;
}

export class LottunnelsIngestor implements LotlIngestor {
  readonly sourceId = "lottunnels";
  readonly displayName = "LOTTunnels";
  readonly description =
    "Living Off The Tunnels: legitimate tunneling and proxy tools abused by adversaries for C2, data exfiltration, and remote access";
  readonly repo = "LOTTunnels/LOTTunnels.github.io";
  readonly branch = "main";
  readonly repoUrl = "https://github.com/LOTTunnels/LOTTunnels.github.io";
  readonly platform = "multi";

  async collect(): Promise<NormalizedEntry[]> {
    const { items } = await fetchTree(this.repo, this.branch, (p) => MATCH.test(p));
    const parsed = await pMap(
      items,
      async (item) => {
        try {
          const content = await fetchRaw(this.repo, this.branch, item.path);
          const url = rawUrl(this.repo, this.branch, item.path);
          return this.parseFile(content).map((e) => ({ ...e, sourceUrl: url }));
        } catch {
          return [];
        }
      },
      20,
    );
    return parsed.flat();
  }

  private parseFile(content: string): NormalizedEntry[] {
    const m = content.match(/^-{3,}\s*\n([\s\S]*?)\n-{3,}/);
    if (!m) return [];
    let fm: TunnelFrontMatter;
    try { fm = yaml.load(m[1]) as TunnelFrontMatter; } catch { return []; }
    if (!fm?.Name) return [];

    const tool = fm.Name;
    const desc = fm.Description || tool;
    const platforms = osToPlatforms(fm);
    const domains = domainsOf(fm);
    const filename = fm.Full_Path?.[0]?.Filename || `${tool}.exe`;
    const exeBase = filename.replace(/\.exe$/i, "");

    const out: NormalizedEntry[] = [];

    // Detect existing installation — Windows / PowerShell.
    out.push({
      sourceRef: `${tool}:detect-ps`,
      name: `LOTTunnels: ${tool} - detect existing installation (Windows)`,
      description: `Checks whether the ${tool} tunnel tool is already present (process or binary) on a Windows host. ${desc}`,
      command: [
        `# LOTTunnels detect: ${tool} (Windows)`,
        `$marker = 'LOTTunnels-DETECT'`,
        `$proc = Get-Process -Name '${exeBase}' -ErrorAction SilentlyContinue`,
        `$cmd = Get-Command '${exeBase}' -ErrorAction SilentlyContinue`,
        `if ($proc) { Write-Output "FOUND running process: ${tool}" }`,
        `elseif ($cmd) { Write-Output "FOUND binary: $($cmd.Source)" }`,
        `else { Write-Output "NOT PRESENT: ${tool}" }`,
        `Write-Output $marker`,
      ].join("\n"),
      executor: "powershell",
      techniqueId: DEFAULT_TECHNIQUE,
      elevationRequired: false,
      riskLevel: "medium",
      platforms,
      cleanupCommand: null,
      metadata: { source: "lottunnels", tunnel_tool: tool, test_type: "detect-existing", observe_only: true },
    });

    // Detect existing installation — Linux/macOS / bash.
    if (platforms.includes("linux") || platforms.includes("macos")) {
      out.push({
        sourceRef: `${tool}:detect-bash`,
        name: `LOTTunnels: ${tool} - detect existing installation (Linux/macOS)`,
        description: `Checks whether the ${tool} tunnel tool is already present (process or binary) on a Linux/macOS host. ${desc}`,
        command: [
          `# LOTTunnels detect: ${tool} (Linux/macOS)`,
          `if command -v ${exeBase} >/dev/null 2>&1; then echo "FOUND binary: $(command -v ${exeBase})";`,
          `elif pgrep -x ${exeBase} >/dev/null 2>&1; then echo "FOUND running process: ${tool}";`,
          `else echo "NOT PRESENT: ${tool}"; fi`,
          `echo LOTTunnels-DETECT`,
        ].join("\n"),
        executor: "bash",
        techniqueId: DEFAULT_TECHNIQUE,
        elevationRequired: false,
        riskLevel: "medium",
        platforms,
        cleanupCommand: null,
        metadata: { source: "lottunnels", tunnel_tool: tool, test_type: "detect-existing", observe_only: true },
      });
    }

    // Relay-domain connectivity check (DNS resolution only — no tunnel established).
    if (domains.length) {
      const psList = domains.map((d) => `'${d.replace(/^\*\.?/, "")}'`).join(", ");
      out.push({
        sourceRef: `${tool}:network-ps`,
        name: `LOTTunnels: ${tool} - relay domain connectivity (Windows)`,
        description: `Resolves ${tool}'s known relay domains to check whether egress DNS/network controls would block the tunnel. DNS resolution only; no tunnel is established.`,
        command: [
          `# LOTTunnels relay check: ${tool} (Windows)`,
          `$domains = @(${psList})`,
          `foreach ($h in $domains) {`,
          `  try { Resolve-DnsName -Name $h -ErrorAction Stop | Out-Null; Write-Output "RESOLVES: $h" }`,
          `  catch { Write-Output "BLOCKED/NXDOMAIN: $h" }`,
          `}`,
          `Write-Output 'LOTTunnels-NET'`,
        ].join("\n"),
        executor: "powershell",
        techniqueId: DEFAULT_TECHNIQUE,
        elevationRequired: false,
        riskLevel: "medium",
        platforms,
        cleanupCommand: null,
        metadata: { source: "lottunnels", tunnel_tool: tool, test_type: "network-connectivity", detection_domains: domains, observe_only: true },
      });

      if (platforms.includes("linux") || platforms.includes("macos")) {
        const shList = domains.map((d) => d.replace(/^\*\.?/, "")).join(" ");
        out.push({
          sourceRef: `${tool}:network-bash`,
          name: `LOTTunnels: ${tool} - relay domain connectivity (Linux/macOS)`,
          description: `Resolves ${tool}'s known relay domains to check whether egress DNS/network controls would block the tunnel. DNS resolution only; no tunnel is established.`,
          command: [
            `# LOTTunnels relay check: ${tool} (Linux/macOS)`,
            `for h in ${shList}; do`,
            `  if getent hosts "$h" >/dev/null 2>&1 || nslookup "$h" >/dev/null 2>&1; then echo "RESOLVES: $h"; else echo "BLOCKED: $h"; fi`,
            `done`,
            `echo LOTTunnels-NET`,
          ].join("\n"),
          executor: "bash",
          techniqueId: DEFAULT_TECHNIQUE,
          elevationRequired: false,
          riskLevel: "medium",
          platforms,
          cleanupCommand: null,
          metadata: { source: "lottunnels", tunnel_tool: tool, test_type: "network-connectivity", detection_domains: domains, observe_only: true },
        });
      }
    }

    return out;
  }
}
