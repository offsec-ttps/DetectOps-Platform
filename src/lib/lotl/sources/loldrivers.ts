/**
 * LOLDrivers ingestor — Living Off The Land Drivers (vulnerable/BYOVD drivers
 * that can load despite HVCI). Ported from magicsword-io/Magic-Atomics
 * backend/app/ingestion/loldrivers.py.
 *
 * Source: https://github.com/magicsword-io/LOLDrivers — one YAML per driver
 * under yaml/, plus the driver sample binaries under drivers/{md5}.bin.
 *
 * Only drivers flagged LoadsDespiteHVCI=TRUE produce tests. For each such
 * KnownVulnerableSample the Python generates TWO prevention tests — an sc.exe
 * kernel-service load and a PowerShell New-Service load — that attempt to load
 * the vulnerable driver and report whether HVCI/WDAC/driver-signing blocked it.
 * A hardcoded list of well-known BYOVD drivers is always emitted too.
 *
 * Safety strategy (identical to the Python original):
 *  - The hash-only variant (no .bin shipped in the repo) never fetches a
 *    binary: it requires the operator to place the exact SHA256-verified file
 *    in %TEMP% themselves, and refuses to run on a hash mismatch.
 *  - Every test ships a cleanup_command that stops + deletes the service and
 *    removes the dropped file.
 *  - These are elevation-required, "observe whether your controls block it"
 *    tests; the command text is ported verbatim — no payloads are invented.
 *
 * Unlike the Python original (which git-clones the repo and reads local files)
 * collect() fetches over the GitHub tree + raw APIs via the github.ts helpers.
 * The repo's local `drivers/{md5}.bin` existence check becomes a lookup against
 * the set of .bin blobs present in the repo tree, and the Python's local
 * binary_path string becomes the raw URL of that blob.
 */

import yaml from "js-yaml";
import type { LotlIngestor } from "../base";
import type { NormalizedEntry } from "../types";
import { fetchTree, fetchRaw, pMap, rawUrl } from "../github";

const YAML_MATCH = /^yaml\/.*\.yaml$/i;
const BIN_MATCH = /^drivers\/([a-f0-9]+)\.bin$/i;

const MITRE_TECHNIQUES: Record<string, string> = {
  T1068: "Exploitation for Privilege Escalation",
  "T1543.003": "Create or Modify System Process: Windows Service",
  "T1562.001": "Impair Defenses: Disable or Modify Tools",
};
const TECHNIQUE_IDS = ["T1068", "T1543.003", "T1562.001"];

// ---------------------------------------------------------------------------
// Well-known BYOVD drivers that adversaries actively abuse in the wild.
// Hardcoded (ported verbatim from loldrivers.py) so tests are always generated
// even when the YAML data is incomplete. Every entry has a SHA256 and the .sys
// filename that sc.exe / the real-world loader expects.
// ---------------------------------------------------------------------------
interface WellKnownDriver {
  sys_name: string;
  sha256: string;
  product: string;
  company: string;
  description: string;
  cves: string[];
  loldrivers_id: string;
}

const WELL_KNOWN_BYOVD_DRIVERS: WellKnownDriver[] = [
  {
    sys_name: "procexp.sys",
    sha256: "ced9f516fae11b187e3bda06e40ca82d3b3b8a3c0168cf58b1261fc2e7b39843",
    product: "Process Explorer",
    company: "Sysinternals (Microsoft)",
    description:
      "Process Explorer kernel driver — abused by multiple ransomware groups " +
      "(Medusa Locker, LockBit) and threat actors to kill AV/EDR processes.",
    cves: [],
    loldrivers_id: "e0f3e4c1-26c5-4544-a4b5-a5781898a05a",
  },
  {
    sys_name: "dbutil_2_3.sys",
    sha256: "0296e2ce999e67c76352613a718e11516fe1b0efc3ffdb8918fc999dd76a73a5",
    product: "Dell BIOS Utility",
    company: "Dell",
    description:
      "Dell DBUtil driver — CVE-2021-21551 provides R/W physical memory " +
      "primitives. Used by Lazarus Group and multiple ransomware operators.",
    cves: ["CVE-2021-21551"],
    loldrivers_id: "a6c75e7a-0491-4b28-bbbb-1e75d4751c9a",
  },
  {
    sys_name: "gdrv.sys",
    sha256: "9ab9f3b75a2eb87fafb1b7361be9dfb73571bc12c3c5c4c4b53a3e7e48f7e4e2",
    product: "Gigabyte Driver",
    company: "Gigabyte / Giga-Byte Technology",
    description:
      "Gigabyte kernel driver — used by RobbinHood ransomware to disable " +
      "driver signature enforcement and kill security products.",
    cves: [],
    loldrivers_id: "d785807f-29c0-4bc1-97e6-3e0c5a1e1bde",
  },
  {
    sys_name: "asio3.sys",
    sha256: "b0032b8d8e6f4bd29a1b9e7e2e2c25a0f0e1d3c5a7b9f8e6d4c2b0a8f6e4d2c0",
    product: "ASUS I/O Driver",
    company: "ASUSTeK Computer",
    description:
      "ASUS low-level I/O driver — provides physical memory and I/O port " +
      "access primitives. Abused in BYOVD attacks for EDR tampering.",
    cves: [],
    loldrivers_id: "asus-asio3",
  },
  {
    sys_name: "rtcore64.sys",
    sha256: "01aa278b07b58dc46c84bd0b1b5c8e9ee4e62ea0bf7a695862b4f2eb3f1e5d36",
    product: "MSI Afterburner",
    company: "MICRO-STAR INTERNATIONAL",
    description:
      "MSI Afterburner RTCore64 driver — provides arbitrary R/W to physical " +
      "memory and MSRs. Used by BlackByte ransomware to disable EDR.",
    cves: ["CVE-2019-16098"],
    loldrivers_id: "d5a66be1-3e40-4b3b-811f-1e1b5a0e24b6",
  },
  {
    sys_name: "kprocesshacker.sys",
    sha256: "d4a0fe56316a2c45b9ba9ac1005363c8e893232a3e5c03b5bfd00df04ea1a3e3",
    product: "Process Hacker",
    company: "wj32 (Process Hacker)",
    description:
      "Process Hacker kernel driver — provides process termination and memory " +
      "manipulation primitives. Widely used in EDR killer campaigns.",
    cves: [],
    loldrivers_id: "kprocesshacker",
  },
  {
    sys_name: "zemana.sys",
    sha256: "543991ca8d1c65113dff039b85ae3f9a87f503daec30f4d0e8c50df7e27b14d0",
    product: "Zemana AntiMalware",
    company: "Zemana Ltd.",
    description:
      "Zemana AntiMalware driver — abused to terminate AV/EDR processes. " +
      "Used in multiple intrusions where attackers deploy it as a payload.",
    cves: [],
    loldrivers_id: "zemana-antimalware",
  },
  {
    sys_name: "ene.sys",
    sha256: "600a3d0a0751c3f3e53fc5c7d1f3c3ee2a8b4c0a9b5b7e4f3d1e8a6c2b0a9f8e",
    product: "ENE Technology Driver",
    company: "ENE Technology Inc.",
    description:
      "ENE Technology I/O driver — provides low-level hardware access. " +
      "Exploited in BYOVD attacks for privilege escalation.",
    cves: [],
    loldrivers_id: "ene-tech",
  },
  {
    sys_name: "winio64.sys",
    sha256: "a7b000451dc3a4de66a2b63b0c2b5e3f8e4d6c0a9b8f7e5d3c2b1a0f9e8d7c6b",
    product: "WinIo Library",
    company: "Yariv Kaplan",
    description:
      "WinIo direct hardware access library — provides Ring-0 I/O port and " +
      "physical memory access from user mode. BYOVD favorite.",
    cves: [],
    loldrivers_id: "winio64",
  },
  {
    sys_name: "cpuz.sys",
    sha256: "c5e2018bf7c0f314fed4fd7fe7e69fa2e648359620e0f4b1c1f800c8c6ce641e",
    product: "CPUID CPU-Z",
    company: "CPUID",
    description:
      "CPU-Z kernel driver — provides MSR, physical memory, and PCI config " +
      "access. Exploited for privilege escalation in BYOVD campaigns.",
    cves: ["CVE-2017-15302"],
    loldrivers_id: "cpuz-driver",
  },
];

interface LoldriverSample {
  Filename?: string;
  OriginalFilename?: string;
  MD5?: string;
  SHA256?: string;
  Product?: string;
  Company?: string;
  LoadsDespiteHVCI?: string | boolean;
  [k: string]: unknown;
}

interface LoldriverYaml {
  Id?: string;
  Category?: string;
  Tags?: unknown[];
  Commands?: { Description?: string } | unknown;
  KnownVulnerableSamples?: LoldriverSample[];
  [k: string]: unknown;
}

// Parameters shared by both test builders (mirrors the Python keyword args).
interface TestParams {
  sysName: string;
  svcName: string;
  sha256: string;
  md5: string;
  description: string;
  category: string;
  driverId: string;
  hasBin: boolean;
  binUrl: string | null;
  loldriversUrl: string;
  cves: string[];
  product: string;
  company: string;
}

export class LoldriversIngestor implements LotlIngestor {
  readonly sourceId = "loldrivers";
  readonly displayName = "LOLDrivers";
  readonly description = "Living Off The Land Drivers - HVCI-bypass driver loading tests";
  readonly repo = "magicsword-io/LOLDrivers";
  readonly branch = "main";
  readonly repoUrl = "https://github.com/magicsword-io/LOLDrivers";
  readonly platform = "windows";

  async collect(): Promise<NormalizedEntry[]> {
    // Discover the YAML entries and the set of driver sample blobs present in
    // the repo (the local `drivers/{md5}.bin` existence check in the Python).
    const [{ items: ymlItems }, { items: binItems }] = await Promise.all([
      fetchTree(this.repo, this.branch, (p) => YAML_MATCH.test(p)),
      fetchTree(this.repo, this.branch, (p) => BIN_MATCH.test(p)),
    ]);

    const driverBins = new Set<string>();
    for (const it of binItems) {
      const m = it.path.match(BIN_MATCH);
      if (m) driverBins.add(m[1].toLowerCase());
    }

    // Fetch raw YAML in parallel (concurrency 20); pMap preserves input order
    // so the shared SHA256 de-dup below stays deterministic.
    const contents = await pMap(
      ymlItems,
      async (item) => {
        try {
          return { path: item.path, content: await fetchRaw(this.repo, this.branch, item.path) };
        } catch {
          return { path: item.path, content: null as string | null };
        }
      },
      20,
    );

    const seenSha256 = new Set<string>();
    const out: NormalizedEntry[] = [];

    // --- Phase 1: parse YAML files ------------------------------------------
    for (const { path, content } of contents) {
      if (!content) continue;
      let data: LoldriverYaml | null = null;
      try {
        data = yaml.load(content) as LoldriverYaml;
      } catch {
        continue;
      }
      if (!data) continue;
      const url = rawUrl(this.repo, this.branch, path);
      try {
        for (const entry of this.parseDriver(data, driverBins, seenSha256)) {
          out.push({ ...entry, sourceUrl: url });
        }
      } catch {
        continue;
      }
    }

    // --- Phase 2: ensure well-known BYOVD drivers are always present --------
    for (const wk of WELL_KNOWN_BYOVD_DRIVERS) {
      const sha = wk.sha256.toLowerCase();
      if (seenSha256.has(sha)) continue;
      seenSha256.add(sha);
      for (const entry of this.buildWellKnownTests(wk)) {
        out.push({ ...entry, sourceUrl: this.repoUrl });
      }
    }

    return out;
  }

  // ------------------------------------------------------------------
  // Parse a single LOLDrivers YAML entry — only HVCI-bypass drivers.
  // ------------------------------------------------------------------
  private parseDriver(
    data: LoldriverYaml,
    driverBins: Set<string>,
    seen: Set<string>,
  ): NormalizedEntry[] {
    const tests: NormalizedEntry[] = [];
    const driverId = typeof data.Id === "string" ? data.Id : "";
    const category = typeof data.Category === "string" ? data.Category : "";
    const tags: unknown[] = Array.isArray(data.Tags) ? data.Tags : [];
    const commandsBlock =
      data.Commands && typeof data.Commands === "object" && !Array.isArray(data.Commands)
        ? (data.Commands as { Description?: string })
        : {};
    const cmdDescription = typeof commandsBlock.Description === "string" ? commandsBlock.Description : "";

    const samples = Array.isArray(data.KnownVulnerableSamples) ? data.KnownVulnerableSamples : [];
    if (samples.length === 0) return tests;

    for (const sample of samples) {
      if (!sample || typeof sample !== "object") continue;

      // ---- HVCI filter: only keep drivers that load despite HVCI ----
      const hvci = String(sample.LoadsDespiteHVCI ?? "").toUpperCase();
      if (hvci !== "TRUE") continue;

      const md5 = (sample.MD5 ?? "").trim().toLowerCase();
      const sha256 = (sample.SHA256 ?? "").trim().toLowerCase();
      if (!sha256 && !md5) continue;

      // De-duplicate on SHA256.
      if (sha256 && seen.has(sha256)) continue;
      if (sha256) seen.add(sha256);

      // Determine the .sys filename.
      const firstTag = tags.length > 0 && typeof tags[0] === "string" ? (tags[0] as string) : "";
      let sysName =
        (sample.OriginalFilename ?? "") ||
        (sample.Filename ?? "") ||
        firstTag ||
        `driver_${(sha256 || md5).slice(0, 8)}.sys`;
      if (!sysName.toLowerCase().endsWith(".sys")) sysName += ".sys";

      // Service name (sanitised for sc.exe — alphanumeric + underscore).
      const svcName = `MagicAtomics_${(sha256 || md5).slice(0, 12)}`;

      // Check whether a .bin file ships in the repo.
      const hasBin = !!md5 && driverBins.has(md5);
      const binUrl = hasBin ? rawUrl(this.repo, this.branch, `drivers/${md5}.bin`) : null;

      // Build human-readable description.
      const product = typeof sample.Product === "string" ? sample.Product : "";
      const company = typeof sample.Company === "string" ? sample.Company : "";
      const descParts: string[] = [];
      if (cmdDescription) descParts.push(cmdDescription);
      if (product) descParts.push(`Product: ${product}`);
      if (company) descParts.push(`Company: ${company}`);
      descParts.push(`Category: ${category}`);
      descParts.push("Loads despite HVCI=TRUE");
      const description = descParts.join(". ");

      // Collect CVEs for metadata.
      const cves: string[] = [];
      for (const tag of tags) {
        if (typeof tag === "string" && tag.toUpperCase().startsWith("CVE-")) cves.push(tag.toUpperCase());
      }

      const loldriversUrl = driverId ? `https://www.loldrivers.io/drivers/${driverId}/` : "";

      const params: TestParams = {
        sysName,
        svcName,
        sha256,
        md5,
        description,
        category,
        driverId,
        hasBin,
        binUrl,
        loldriversUrl,
        cves,
        product,
        company,
      };

      tests.push(this.buildScTest(params));
      tests.push(this.buildNewServiceTest(params));
    }

    return tests;
  }

  // ------------------------------------------------------------------
  // Build the two tests for a hardcoded well-known BYOVD driver.
  // ------------------------------------------------------------------
  private buildWellKnownTests(wk: WellKnownDriver): NormalizedEntry[] {
    const sha256 = wk.sha256.toLowerCase();
    const params: TestParams = {
      sysName: wk.sys_name,
      svcName: `MagicAtomics_${sha256.slice(0, 12)}`,
      sha256,
      md5: "",
      description: wk.description,
      category: "vulnerable driver",
      driverId: wk.loldrivers_id ?? "",
      hasBin: false,
      binUrl: null,
      loldriversUrl: wk.loldrivers_id ? `https://www.loldrivers.io/drivers/${wk.loldrivers_id}/` : "",
      cves: wk.cves ?? [],
      product: wk.product ?? "",
      company: wk.company ?? "",
    };
    return [this.buildScTest(params), this.buildNewServiceTest(params)];
  }

  // ------------------------------------------------------------------
  // Test builder: sc.exe create + sc.exe start.
  // ------------------------------------------------------------------
  private buildScTest(p: TestParams): NormalizedEntry {
    const { sysName, svcName, sha256, md5 } = p;

    const command = p.hasBin
      ? [
          'powershell.exe -NoProfile -Command "& {',
          " $ErrorActionPreference = 'Stop';",
          ` $binSrc = Join-Path $PSScriptRoot 'loldrivers\\drivers\\${md5}.bin';`,
          ` if (-not (Test-Path $binSrc)) { $binSrc = '${md5}.bin' };`,
          ` $dstPath = Join-Path $env:TEMP '${sysName}';`,
          " Copy-Item -Path $binSrc -Destination $dstPath -Force;",
          " Write-Host '[*] Driver copied to:' $dstPath;",
          ` $null = & sc.exe create ${svcName} type= kernel binPath= $dstPath 2>&1;`,
          ` $result = & sc.exe start ${svcName} 2>&1;`,
          " Write-Host '[sc.exe] ' $result;",
          " if ($LASTEXITCODE -eq 0) {",
          `   Write-Host 'ALLOWED: Driver ${sysName} loaded successfully via sc.exe'`,
          " } else {",
          "   Write-Host 'BLOCKED: sc.exe start returned exit code' $LASTEXITCODE",
          " }",
          '}"',
        ].join("")
      : [
          'powershell.exe -NoProfile -Command "& {',
          " $ErrorActionPreference = 'Stop';",
          ` $driverPath = Join-Path $env:TEMP '${sysName}';`,
          " if (-not (Test-Path $driverPath)) {",
          "   Write-Host 'Driver file not found at' $driverPath;",
          `   Write-Host 'Place ${sysName} (SHA256: ${sha256}) in %TEMP% to run this test.';`,
          "   exit 1",
          " };",
          " $fileHash = (Get-FileHash -Path $driverPath -Algorithm SHA256).Hash.ToLower();",
          ` if ($fileHash -ne '${sha256}') {`,
          `   Write-Host 'Hash mismatch! Expected ${sha256}, got' $fileHash;`,
          "   exit 1",
          " };",
          ` Write-Host '[*] Hash verified for ${sysName}';`,
          ` $null = & sc.exe create ${svcName} type= kernel binPath= $driverPath 2>&1;`,
          ` $result = & sc.exe start ${svcName} 2>&1;`,
          " Write-Host '[sc.exe] ' $result;",
          " if ($LASTEXITCODE -eq 0) {",
          `   Write-Host 'ALLOWED: Driver ${sysName} loaded via sc.exe'`,
          " } else {",
          "   Write-Host 'BLOCKED: sc.exe returned exit code' $LASTEXITCODE",
          " }",
          '}"',
        ].join("");

    const cleanup =
      `sc.exe stop ${svcName} 2>$null; ` +
      `sc.exe delete ${svcName} 2>$null; ` +
      `Remove-Item -Path "$env:TEMP\\${sysName}" -Force -ErrorAction SilentlyContinue`;

    return {
      sourceRef: `${sha256 || md5}:sc.exe`,
      name: `LOLDriver: ${sysName} sc.exe load (HVCI bypass)`,
      description: `[sc.exe] ${p.description}`,
      command,
      executor: "powershell",
      techniqueId: "T1068",
      binaryPath: p.binUrl,
      elevationRequired: true,
      riskLevel: "high",
      platforms: ["windows"],
      cleanupCommand: cleanup,
      metadata: {
        category: p.category,
        loldrivers_id: p.driverId,
        sha256,
        md5,
        sys_name: sysName,
        service_name: svcName,
        loads_despite_hvci: true,
        bin_available: p.hasBin,
        load_method: "sc.exe",
        loldrivers_url: p.loldriversUrl,
        cves: p.cves,
        product: p.product,
        company: p.company,
        mitre_techniques: MITRE_TECHNIQUES,
        technique_ids: TECHNIQUE_IDS,
        guidance: {
          what_this_tests:
            `Attempts to load vulnerable driver ${sysName} via sc.exe to test ` +
            `whether HVCI, WDAC, or driver signing enforcement blocks the load.`,
          if_blocked:
            `Your controls blocked the ${sysName} driver load via sc.exe. ` +
            `HVCI/WDAC is functioning correctly for this BYOVD vector.`,
          if_allowed:
            `ALLOWED: ${sysName} was loaded as a kernel service. ` +
            `This is a critical BYOVD gap. Enable HVCI, configure WDAC driver ` +
            `block rules, or deploy the Microsoft vulnerable driver blocklist.`,
          mitre_reference: "https://attack.mitre.org/techniques/T1068/",
        },
        resources: {
          driver_sha256: sha256,
          loldrivers_url: p.loldriversUrl,
        },
      },
    };
  }

  // ------------------------------------------------------------------
  // Test builder: PowerShell New-Service method.
  // ------------------------------------------------------------------
  private buildNewServiceTest(p: TestParams): NormalizedEntry {
    const { sysName, svcName, sha256, md5 } = p;
    // Different service-name suffix to avoid collision with the sc.exe test.
    const psSvcName = `${svcName}_ps`;

    const command = p.hasBin
      ? [
          'powershell.exe -NoProfile -Command "& {',
          " $ErrorActionPreference = 'Stop';",
          ` $binSrc = Join-Path $PSScriptRoot 'loldrivers\\drivers\\${md5}.bin';`,
          ` if (-not (Test-Path $binSrc)) { $binSrc = '${md5}.bin' };`,
          ` $dstPath = Join-Path $env:TEMP '${sysName}';`,
          " Copy-Item -Path $binSrc -Destination $dstPath -Force;",
          " Write-Host '[*] Driver copied to:' $dstPath;",
          " try {",
          `   New-Service -Name '${psSvcName}' -BinaryPathName $dstPath`,
          "     -DisplayName 'MagicAtomics HVCI Test'",
          "     -StartupType Manual",
          "     -ServiceType KernelDriver",
          "     -ErrorAction Stop;",
          `   Start-Service -Name '${psSvcName}' -ErrorAction Stop;`,
          `   Write-Host 'ALLOWED: Driver ${sysName} loaded via New-Service'`,
          " } catch {",
          "   Write-Host 'BLOCKED:' $_.Exception.Message",
          " }",
          '}"',
        ].join("")
      : [
          'powershell.exe -NoProfile -Command "& {',
          " $ErrorActionPreference = 'Stop';",
          ` $driverPath = Join-Path $env:TEMP '${sysName}';`,
          " if (-not (Test-Path $driverPath)) {",
          "   Write-Host 'Driver file not found at' $driverPath;",
          `   Write-Host 'Place ${sysName} (SHA256: ${sha256}) in %TEMP% to run this test.';`,
          "   exit 1",
          " };",
          " $fileHash = (Get-FileHash -Path $driverPath -Algorithm SHA256).Hash.ToLower();",
          ` if ($fileHash -ne '${sha256}') {`,
          `   Write-Host 'Hash mismatch! Expected ${sha256}, got' $fileHash;`,
          "   exit 1",
          " };",
          ` Write-Host '[*] Hash verified for ${sysName}';`,
          " try {",
          `   New-Service -Name '${psSvcName}' -BinaryPathName $driverPath`,
          "     -DisplayName 'MagicAtomics HVCI Test'",
          "     -StartupType Manual",
          "     -ServiceType KernelDriver",
          "     -ErrorAction Stop;",
          `   Start-Service -Name '${psSvcName}' -ErrorAction Stop;`,
          `   Write-Host 'ALLOWED: Driver ${sysName} loaded via New-Service'`,
          " } catch {",
          "   Write-Host 'BLOCKED:' $_.Exception.Message",
          " }",
          '}"',
        ].join("");

    const cleanup =
      'powershell.exe -NoProfile -Command "' +
      `Stop-Service -Name '${psSvcName}' -Force -ErrorAction SilentlyContinue;` +
      ` sc.exe delete ${psSvcName} 2>$null;` +
      ` Remove-Item -Path \\"$env:TEMP\\${sysName}\\" -Force -ErrorAction SilentlyContinue"`;

    return {
      sourceRef: `${sha256 || md5}:new-service`,
      name: `LOLDriver: ${sysName} New-Service load (HVCI bypass)`,
      description: `[New-Service] ${p.description}`,
      command,
      executor: "powershell",
      techniqueId: "T1543.003",
      binaryPath: p.binUrl,
      elevationRequired: true,
      riskLevel: "high",
      platforms: ["windows"],
      cleanupCommand: cleanup,
      metadata: {
        category: p.category,
        loldrivers_id: p.driverId,
        sha256,
        md5,
        sys_name: sysName,
        service_name: psSvcName,
        loads_despite_hvci: true,
        bin_available: p.hasBin,
        load_method: "New-Service",
        loldrivers_url: p.loldriversUrl,
        cves: p.cves,
        product: p.product,
        company: p.company,
        mitre_techniques: MITRE_TECHNIQUES,
        technique_ids: TECHNIQUE_IDS,
        guidance: {
          what_this_tests:
            `Attempts to load vulnerable driver ${sysName} via PowerShell ` +
            `New-Service to test whether HVCI/WDAC blocks the alternative load path.`,
          if_blocked:
            `Your controls blocked the ${sysName} driver load via New-Service. ` +
            `PowerShell-based driver installation is properly restricted.`,
          if_allowed:
            `ALLOWED: ${sysName} was loaded via New-Service. ` +
            `This alternate driver installation method bypassed your controls. ` +
            `Ensure WDAC driver block rules cover PowerShell service creation.`,
          mitre_reference: "https://attack.mitre.org/techniques/T1543/003/",
        },
        resources: {
          driver_sha256: sha256,
          loldrivers_url: p.loldriversUrl,
        },
      },
    };
  }
}
