/**
 * Sysinternals ingestor — download, stage, rename & run prevention tests.
 * Ported from magicsword-io/Magic-Atomics backend/app/ingestion/sysinternals.py.
 *
 * SYNTHESIZED source: there is no GitHub repo to clone. This module catalogs
 * the most commonly abused Sysinternals tools and generates four prevention
 * test variants per tool, all pointing at live.sysinternals.com:
 *
 *   1. Download from live.sysinternals.com and execute (T1105).
 *   2. Place in a random directory and execute (non-standard path).
 *   3. Rename and execute (masquerading, T1036.005).
 *   4. Execute directly from the Sysinternals Live UNC share (T1105).
 *
 * All data is hardcoded; collect() returns the synthesized entries directly
 * without any network fetch (tools are downloaded at test-execution time, not
 * at sync time). Platform: Windows only.
 */

import type { LotlIngestor } from "../base";
import type { NormalizedEntry, LotlExecutor, LotlRisk } from "../types";

interface SysinternalsTool {
  id: string;
  name: string;
  description: string;
  filename: string;
  altFilename: string | null;
  techniqueId: string;
  techniqueIds: string[];
  safeFlag: string;
  renamedAs: string;
  elevationRequired: boolean;
  riskLevel: LotlRisk;
}

// Hardcoded catalog of the most commonly abused Sysinternals tools (verbatim).
const SYSINTERNALS_CATALOG: SysinternalsTool[] = [
  {
    id: "psexec",
    name: "PsExec",
    description:
      "PsExec is a lightweight telnet-replacement that lets you execute processes on remote systems. Adversaries abuse it for lateral movement and remote code execution.",
    filename: "PsExec64.exe",
    altFilename: "PsExec.exe",
    techniqueId: "T1569.002",
    techniqueIds: ["T1569.002", "T1021.002"],
    safeFlag: "-accepteula -nobanner /?",
    renamedAs: "svchost_update.exe",
    elevationRequired: true,
    riskLevel: "high",
  },
  {
    id: "procdump",
    name: "ProcDump",
    description:
      "ProcDump is a process dumping utility. Adversaries use it to dump LSASS memory for credential theft.",
    filename: "procdump64.exe",
    altFilename: "procdump.exe",
    techniqueId: "T1003.001",
    techniqueIds: ["T1003.001"],
    safeFlag: "-accepteula /?",
    renamedAs: "debugger_helper.exe",
    elevationRequired: true,
    riskLevel: "high",
  },
  {
    id: "accesschk",
    name: "AccessChk",
    description:
      "AccessChk enumerates effective permissions on files, registry keys, services, and other objects. Adversaries use it to discover privilege-escalation opportunities.",
    filename: "accesschk64.exe",
    altFilename: "accesschk.exe",
    techniqueId: "T1069",
    techniqueIds: ["T1069", "T1083"],
    safeFlag: "-accepteula /?",
    renamedAs: "perms_audit.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "autoruns",
    name: "Autoruns",
    description:
      "Autoruns shows programs configured to run during system boot or login. Adversaries use it to enumerate and discover persistence mechanisms on a target.",
    filename: "Autoruns64.exe",
    altFilename: "Autoruns.exe",
    techniqueId: "T1518.001",
    techniqueIds: ["T1518.001"],
    safeFlag: "-accepteula /?",
    renamedAs: "startup_check.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "procmon",
    name: "ProcMon",
    description:
      "Process Monitor shows real-time file, registry, and process activity. Adversaries may use it to understand defensive tools running on a host.",
    filename: "Procmon64.exe",
    altFilename: "Procmon.exe",
    techniqueId: "T1057",
    techniqueIds: ["T1057"],
    safeFlag: "-accepteula /Terminate",
    renamedAs: "perfmon_helper.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "psservice",
    name: "PsService",
    description:
      "PsService is a command-line service viewer and controller. Adversaries use it to enumerate services and discover security-related services that may be disabled.",
    filename: "PsService64.exe",
    altFilename: "PsService.exe",
    techniqueId: "T1007",
    techniqueIds: ["T1007"],
    safeFlag: "-accepteula /?",
    renamedAs: "svc_query.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "psinfo",
    name: "PsInfo",
    description:
      "PsInfo gathers system information including installed software, hotfixes, and hardware. Adversaries use it for host reconnaissance.",
    filename: "PsInfo64.exe",
    altFilename: "PsInfo.exe",
    techniqueId: "T1082",
    techniqueIds: ["T1082"],
    safeFlag: "-accepteula /?",
    renamedAs: "hw_inventory.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "pslist",
    name: "PsList",
    description:
      "PsList displays detailed information about running processes. Adversaries use it for process discovery.",
    filename: "PsList64.exe",
    altFilename: "PsList.exe",
    techniqueId: "T1057",
    techniqueIds: ["T1057"],
    safeFlag: "-accepteula /?",
    renamedAs: "tasklist_helper.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "psloggedon",
    name: "PsLoggedOn",
    description:
      "PsLoggedOn shows who is logged on locally and via resource sharing. Adversaries use it to discover active user sessions.",
    filename: "PsLoggedon64.exe",
    altFilename: "PsLoggedon.exe",
    techniqueId: "T1033",
    techniqueIds: ["T1033"],
    safeFlag: "-accepteula /?",
    renamedAs: "session_check.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "adexplorer",
    name: "ADExplorer",
    description:
      "ADExplorer is an Active Directory viewer and editor. Adversaries use it to enumerate AD objects, users, groups, and trusts.",
    filename: "ADExplorer64.exe",
    altFilename: "ADExplorer.exe",
    techniqueId: "T1018",
    techniqueIds: ["T1018", "T1087.002"],
    safeFlag: "-accepteula /?",
    renamedAs: "ldap_browser.exe",
    elevationRequired: false,
    riskLevel: "high",
  },
  {
    id: "handle",
    name: "Handle",
    description:
      "Handle displays information about open handles for any process. Adversaries use it to discover files and resources locked by security tools.",
    filename: "handle64.exe",
    altFilename: "handle.exe",
    techniqueId: "T1057",
    techniqueIds: ["T1057"],
    safeFlag: "-accepteula /?",
    renamedAs: "resource_mon.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "sdelete",
    name: "SDelete",
    description:
      "SDelete securely deletes files by overwriting their contents. Adversaries use it to destroy evidence and cover tracks.",
    filename: "sdelete64.exe",
    altFilename: "sdelete.exe",
    techniqueId: "T1070.004",
    techniqueIds: ["T1070.004"],
    safeFlag: "-accepteula /?",
    renamedAs: "disk_cleanup.exe",
    elevationRequired: false,
    riskLevel: "high",
  },
  {
    id: "strings",
    name: "Strings",
    description:
      "Strings extracts printable strings from binary files. Adversaries use it to inspect files for credentials, keys, or sensitive data.",
    filename: "strings64.exe",
    altFilename: "strings.exe",
    techniqueId: "T1005",
    techniqueIds: ["T1005"],
    safeFlag: "-accepteula /?",
    renamedAs: "text_extract.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "tcpview",
    name: "TCPView",
    description:
      "TCPView shows detailed listings of all TCP and UDP endpoints. Adversaries use it for network connection discovery.",
    filename: "Tcpview64.exe",
    altFilename: "Tcpview.exe",
    techniqueId: "T1049",
    techniqueIds: ["T1049"],
    safeFlag: "-accepteula /?",
    renamedAs: "netstat_gui.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "shellrunas",
    name: "ShellRunas",
    description:
      "ShellRunas launches programs as a different user via a shell context menu. Adversaries use it as an alternative to runas.exe for access token manipulation.",
    filename: "ShellRunas.exe",
    altFilename: null,
    techniqueId: "T1134",
    techniqueIds: ["T1134"],
    safeFlag: "/? ",
    renamedAs: "run_elevated.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "pipelist",
    name: "PipeList",
    description:
      "PipeList displays the named pipes on a system. Adversaries use it to discover inter-process communication channels that may be exploitable for lateral movement.",
    filename: "pipelist64.exe",
    altFilename: "pipelist.exe",
    techniqueId: "T1570",
    techniqueIds: ["T1570"],
    safeFlag: "-accepteula /?",
    renamedAs: "ipc_enum.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "logonsessions",
    name: "LogonSessions",
    description:
      "LogonSessions lists the currently active logon sessions. Adversaries use it to enumerate local and domain accounts.",
    filename: "logonsessions64.exe",
    altFilename: "logonsessions.exe",
    techniqueId: "T1087.001",
    techniqueIds: ["T1087.001"],
    safeFlag: "-accepteula /?",
    renamedAs: "session_enum.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "du",
    name: "du",
    description:
      "du reports the disk space usage for a directory tree. Adversaries use it to survey disk contents and locate large data stores for exfiltration.",
    filename: "du64.exe",
    altFilename: "du.exe",
    techniqueId: "T1083",
    techniqueIds: ["T1083"],
    safeFlag: "-accepteula /?",
    renamedAs: "space_check.exe",
    elevationRequired: false,
    riskLevel: "medium",
  },
  {
    id: "sysmon",
    name: "Sysmon",
    description:
      "Sysmon is a system monitoring service. Testing whether an adversary can install or tamper with Sysmon validates defense integrity controls.",
    filename: "Sysmon64.exe",
    altFilename: "Sysmon.exe",
    techniqueId: "T1562.001",
    techniqueIds: ["T1562.001"],
    safeFlag: "-accepteula /?",
    renamedAs: "monitor_svc.exe",
    elevationRequired: true,
    riskLevel: "high",
  },
  {
    id: "livekd",
    name: "LiveKd",
    description:
      "LiveKd runs the Kd/WinDbg kernel debuggers on a live system. Adversaries may use it for kernel-level inspection and privilege escalation research.",
    filename: "livekd64.exe",
    altFilename: "livekd.exe",
    techniqueId: "T1068",
    techniqueIds: ["T1068"],
    safeFlag: "-accepteula /?",
    renamedAs: "kernel_diag.exe",
    elevationRequired: true,
    riskLevel: "high",
  },
];

// MITRE technique name lookup (verbatim from the Python _TECHNIQUE_NAMES).
const TECHNIQUE_NAMES: Record<string, string> = {
  "T1569.002": "System Services: Service Execution",
  "T1021.002": "Remote Services: SMB/Windows Admin Shares",
  "T1003.001": "OS Credential Dumping: LSASS Memory",
  T1069: "Permission Groups Discovery",
  T1083: "File and Directory Discovery",
  "T1518.001": "Software Discovery: Security Software Discovery",
  T1057: "Process Discovery",
  T1007: "System Service Discovery",
  T1082: "System Information Discovery",
  T1033: "System Owner/User Discovery",
  T1018: "Remote System Discovery",
  "T1087.002": "Account Discovery: Domain Account",
  "T1087.001": "Account Discovery: Local Account",
  "T1070.004": "Indicator Removal: File Deletion",
  T1005: "Data from Local System",
  T1049: "System Network Connections Discovery",
  T1134: "Access Token Manipulation",
  T1570: "Lateral Tool Transfer",
  "T1562.001": "Impair Defenses: Disable or Modify Tools",
  T1068: "Exploitation for Privilege Escalation",
  T1105: "Ingress Tool Transfer",
  "T1036.005": "Masquerading: Match Legitimate Name or Location",
};

interface SysVariant {
  variantName: string;
  executor: LotlExecutor;
  elevation: boolean;
  riskLevel: LotlRisk;
  command: string;
  cleanup: string;
  description: string;
  extraTechniqueIds: string[];
}

// Build the four test variants for a single tool (verbatim command templates).
function buildVariants(tool: SysinternalsTool): SysVariant[] {
  const filename = tool.filename;
  const safeFlag = tool.safeFlag;
  const renamedAs = tool.renamedAs;
  const elevation = tool.elevationRequired;
  const risk = tool.riskLevel;

  const variants: SysVariant[] = [];

  // Variant 1: Download from live.sysinternals.com and execute.
  const dlCmd = `$toolUrl = 'https://live.sysinternals.com/tools/${filename}'; $outPath = Join-Path $env:TEMP '${filename}'; try { Invoke-WebRequest -Uri $toolUrl -OutFile $outPath -UseBasicParsing -ErrorAction Stop; if (Test-Path $outPath) { $hash = (Get-FileHash $outPath -Algorithm SHA256).Hash; Write-Host "Downloaded: $outPath (SHA256: $hash)"; & $outPath ${safeFlag} 2>&1 | Out-Null; Write-Host 'ALLOWED: ${filename} downloaded from live.sysinternals.com and executed from TEMP' } else { Write-Host 'BLOCKED: ${filename} download prevented' } } catch { Write-Host 'BLOCKED:' $_.Exception.Message }`;
  const dlCleanup = `Remove-Item -Path (Join-Path $env:TEMP '${filename}') -Force -ErrorAction SilentlyContinue`;
  variants.push({
    variantName: "Download from live.sysinternals.com",
    executor: "powershell",
    elevation,
    riskLevel: risk,
    command: dlCmd,
    cleanup: dlCleanup,
    description: `Downloads ${filename} from https://live.sysinternals.com/tools/ and executes it from %TEMP%. Tests ingress tool transfer controls and whether execution of freshly downloaded Sysinternals binaries is detected or blocked.`,
    extraTechniqueIds: ["T1105"],
  });

  // Variant 2: Place in a random directory and execute.
  const stageCmd = `$randomDir = Join-Path $env:USERPROFILE ('Desktop\\' + [System.IO.Path]::GetRandomFileName()); New-Item -ItemType Directory -Path $randomDir -Force | Out-Null; $toolUrl = 'https://live.sysinternals.com/tools/${filename}'; $toolPath = Join-Path $randomDir '${filename}'; try { Invoke-WebRequest -Uri $toolUrl -OutFile $toolPath -UseBasicParsing -ErrorAction Stop; if (Test-Path $toolPath) { & $toolPath ${safeFlag} 2>&1 | Out-Null; Write-Host "ALLOWED: ${filename} executed from random location: $randomDir" } else { Write-Host 'BLOCKED: ${filename} could not be staged to random directory' } } catch { Write-Host 'BLOCKED:' $_.Exception.Message }`;
  const stageCleanup = `$randomDir = Get-ChildItem -Path (Join-Path $env:USERPROFILE 'Desktop') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[a-z0-9]{8}\\.[a-z0-9]{3}$' }; foreach ($d in $randomDir) { Remove-Item $d.FullName -Recurse -Force -ErrorAction SilentlyContinue }`;
  variants.push({
    variantName: "Stage in random directory",
    executor: "powershell",
    elevation,
    riskLevel: risk,
    command: stageCmd,
    cleanup: stageCleanup,
    description: `Downloads ${filename} and copies it to a randomly named directory on the Desktop, then executes it. Simulates adversary staging in a non-standard location.`,
    extraTechniqueIds: ["T1105"],
  });

  // Variant 3: Rename and execute (masquerading).
  const renameCmd = `$toolUrl = 'https://live.sysinternals.com/tools/${filename}'; $renamedPath = Join-Path $env:TEMP '${renamedAs}'; try { Invoke-WebRequest -Uri $toolUrl -OutFile $renamedPath -UseBasicParsing -ErrorAction Stop; if (Test-Path $renamedPath) { & $renamedPath ${safeFlag} 2>&1 | Out-Null; Write-Host 'ALLOWED: ${filename} renamed to ${renamedAs} and executed successfully' } else { Write-Host 'BLOCKED: Renamed ${filename} could not be written to disk' } } catch { Write-Host 'BLOCKED:' $_.Exception.Message }`;
  const renameCleanup = `Remove-Item -Path (Join-Path $env:TEMP '${renamedAs}') -Force -ErrorAction SilentlyContinue`;
  variants.push({
    variantName: "Rename and execute (masquerading)",
    executor: "powershell",
    elevation,
    riskLevel: risk,
    command: renameCmd,
    cleanup: renameCleanup,
    description: `Downloads ${filename} and saves it as ${renamedAs} in %TEMP%, then executes the renamed binary. Tests whether security controls detect Sysinternals tools by hash/signature even when the filename is changed (masquerading).`,
    extraTechniqueIds: ["T1036.005"],
  });

  // Variant 4: Execute from UNC path (Sysinternals Live share).
  const uncCmd = `$uncPath = '\\\\live.sysinternals.com\\tools\\${filename}'; try { & $uncPath ${safeFlag} 2>&1 | Out-Null; Write-Host 'ALLOWED: ${filename} executed directly from Sysinternals Live UNC share' } catch { Write-Host 'BLOCKED:' $_.Exception.Message }`;
  variants.push({
    variantName: "Execute from UNC path",
    executor: "powershell",
    elevation,
    riskLevel: risk,
    command: uncCmd,
    cleanup: "# No cleanup needed -- no file written to disk",
    description: `Executes ${filename} directly from the Sysinternals Live UNC share (\\\\live.sysinternals.com\\tools). Tests whether WebDAV-based remote execution is blocked by network or endpoint controls.`,
    extraTechniqueIds: ["T1105"],
  });

  return variants;
}

export class SysinternalsIngestor implements LotlIngestor {
  readonly sourceId = "sysinternals";
  readonly displayName = "Sysinternals";
  readonly description =
    "Prevention tests for Sysinternals tools commonly abused by adversaries. Downloads each tool from live.sysinternals.com, stages it in random directories, renames it to masquerade as a legitimate binary, and executes from UNC paths -- testing whether security controls detect or block each scenario.";
  // Synthesized source: no GitHub repo (sync tolerates empty repo/branch).
  readonly repo = "";
  readonly branch = "";
  readonly repoUrl = "https://live.sysinternals.com/";
  readonly platform = "windows";

  async collect(): Promise<NormalizedEntry[]> {
    const out: NormalizedEntry[] = [];

    for (const tool of SYSINTERNALS_CATALOG) {
      const toolId = tool.id;
      const toolName = tool.name;
      const toolDesc = tool.description;
      const techniqueId = tool.techniqueId;
      const baseTids = tool.techniqueIds;

      for (const variant of buildVariants(tool)) {
        const variantName = variant.variantName;
        const testName = `Sysinternals: ${toolName} - ${variantName}`;

        // Merge base technique IDs with variant-specific extras (order-preserving dedup).
        const allTids = Array.from(new Set([...baseTids, ...variant.extraTechniqueIds]));

        const downloadUrl = `https://live.sysinternals.com/tools/${tool.filename}`;
        const mitreTechniques: Record<string, string> = {};
        for (const tid of allTids) mitreTechniques[tid] = TECHNIQUE_NAMES[tid] ?? tid;

        out.push({
          sourceRef: `${toolId}:${variantName}`,
          name: testName,
          description: `${variant.description} [${toolDesc.slice(0, 300)}]`.trim(),
          command: variant.command,
          executor: variant.executor,
          techniqueId,
          binaryPath: null,
          elevationRequired: variant.elevation,
          riskLevel: variant.riskLevel,
          platforms: ["windows"],
          cleanupCommand: variant.cleanup,
          metadata: {
            source: "sysinternals",
            tool_id: toolId,
            tool_name: toolName,
            filename: tool.filename,
            variant: variantName,
            download_url: downloadUrl,
            mitre_techniques: mitreTechniques,
            technique_ids: allTids,
            guidance: {
              what_this_tests: `Attempts to ${variantName.toLowerCase()} the Sysinternals tool ${toolName} (${tool.filename}) and checks whether security controls detect or block the operation.`,
              if_blocked: `Your security controls blocked ${toolName} (${variantName.toLowerCase()}). This attack vector is covered.`,
              if_allowed: `ALLOWED: ${toolName} was successfully used via ${variantName.toLowerCase()}. Review your EDR/endpoint policies to detect or prevent Sysinternals tool abuse.`,
              mitre_reference: `https://attack.mitre.org/techniques/${techniqueId.split(".").join("/")}/`,
            },
          },
          sourceUrl: downloadUrl,
        });
      }
    }

    return out;
  }
}
