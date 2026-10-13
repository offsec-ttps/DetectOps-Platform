/**
 * LOLRMM ingestor — Living Off The Land Remote Monitoring and Management tools.
 * Ported from magicsword-io/Magic-Atomics backend/app/ingestion/lolrmm.py.
 *
 * Source: https://github.com/magicsword-io/LOLRMM — one YAML per RMM tool under
 * yaml/. LOLRMM data is artifact-oriented (files, registry, network, services),
 * not test-oriented, so this ingestor generates meaningful prevention tests from
 * those artifacts and cross-references them with Atomic Red Team T1219 tests.
 *
 * Per RMM tool it emits (where the data supports it):
 *  1. Download & Execute prevention — for tools with a known free binary; where
 *     an Atomic Red Team test exists its tested command is used verbatim.
 *  2. Execution prevention — can the RMM executable run from known paths?
 *  3. Service installation prevention — can the RMM service be created?
 *  4. Network connectivity prevention — can the endpoint reach the RMM C2?
 *
 * Safety strategy (identical to the Python original): every generated command is
 * a detection/observation probe — it logs ALLOWED/BLOCKED/FOUND, runs the binary
 * only with a benign flag for a few seconds then kills it, and cleans up any
 * downloaded file. No destructive actions are taken.
 */

import yaml from "js-yaml";
import type { LotlIngestor } from "../base";
import type { NormalizedEntry } from "../types";
import { fetchTree, fetchRaw, pMap, rawUrl } from "../github";

const MATCH = /^yaml\/.+\.yaml$/i;

// All RMM tools map to MITRE ATT&CK T1219 (Remote Access Software).
const TECHNIQUE_ID = "T1219";

// ---------------------------------------------------------------------------
// Well-known RMM tools with download URLs and Atomic Red Team cross-references
// ---------------------------------------------------------------------------
// These are *legitimate* tools commonly abused by adversaries for persistent
// remote access. The "test" is whether your security stack blocks an
// unauthorised download + execution — not whether the software itself is
// malicious. Ported verbatim from the Python _RMM_CATALOG.
interface RmmCatalogEntry {
  url: string;
  exe: string;
  desc: string;
  vendor: string;
  abuse_reason: string;
  platforms: string[];
  safe_flag: string;
  art_guid: string;
  art_command: string;
  art_cleanup: string;
  account_required: boolean;
}

const RMM_CATALOG: Record<string, RmmCatalogEntry> = {
  AnyDesk: {
    url: "https://download.anydesk.com/AnyDesk.exe",
    exe: "AnyDesk.exe",
    desc: "AnyDesk remote desktop client",
    vendor: "AnyDesk Software GmbH",
    abuse_reason:
      "Lightweight single-binary RMM frequently deployed by ransomware " +
      "operators (Conti, Royal, BlackBasta) for hands-on-keyboard access " +
      "after initial compromise.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "--help",
    art_guid: "6b8b7391-5c0a-4f8c-baee-78d8ce0ce330",
    art_command:
      `Invoke-WebRequest -OutFile C:\\Users\\$env:username\\Desktop\\AnyDesk.exe ` +
      `https://download.anydesk.com/AnyDesk.exe\n` +
      `$file1 = "C:\\Users\\" + $env:username + "\\Desktop\\AnyDesk.exe"\n` +
      `Start-Process $file1 /S;`,
    art_cleanup:
      `$file1 = "C:\\Users\\" + $env:username + "\\Desktop\\AnyDesk.exe"\n` +
      `Remove-Item $file1 -ErrorAction Ignore`,
    account_required: false,
  },
  TeamViewer: {
    url: "https://download.teamviewer.com/download/TeamViewer_Setup.exe",
    exe: "TeamViewer_Setup.exe",
    desc: "TeamViewer remote support & access",
    vendor: "TeamViewer Germany GmbH",
    abuse_reason:
      "One of the most widely-used legitimate RMMs, routinely abused by " +
      "APT groups and ransomware affiliates as a stealthy C2 channel " +
      "because it blends in with normal enterprise traffic.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "--help",
    art_guid: "8ca3b96d-8983-4a7f-b125-fc98cc0a2aa0",
    art_command:
      `Invoke-WebRequest -OutFile C:\\Users\\$env:username\\Desktop\\TeamViewer_Setup.exe ` +
      `https://download.teamviewer.com/download/TeamViewer_Setup.exe\n` +
      `$file1 = "C:\\Users\\" + $env:username + "\\Desktop\\TeamViewer_Setup.exe"\n` +
      `Start-Process -Wait $file1 /S;\n` +
      `Start-Process 'C:\\Program Files (x86)\\TeamViewer\\TeamViewer.exe'`,
    art_cleanup:
      `$file = 'C:\\Program Files (x86)\\TeamViewer\\uninstall.exe'\n` +
      `if(Test-Path $file){ Start-Process $file "/S" -ErrorAction Ignore | Out-Null }\n` +
      `$file1 = "C:\\Users\\" + $env:username + "\\Desktop\\TeamViewer_Setup.exe"\n` +
      `Remove-Item $file1 -ErrorAction Ignore | Out-Null`,
    account_required: false,
  },
  ScreenConnect: {
    url: "",
    exe: "ScreenConnect.msi",
    desc: "ConnectWise ScreenConnect (formerly Control) remote support",
    vendor: "ConnectWise LLC",
    abuse_reason:
      "Heavily abused in BEC, ransomware, and tech-support scam campaigns. " +
      "Threat actors generate custom agent installers tied to their own " +
      "ScreenConnect instance for persistent access.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "--help",
    art_guid: "4a18cc4e-416f-4966-9a9d-75731c4684c0",
    art_command:
      `$installer = "C:\\Users\\$env:username\\Downloads\\ScreenConnect.msi"\n` +
      `Invoke-WebRequest -OutFile $installer ` +
      `"https://d1kuyuqowve5id.cloudfront.net/ScreenConnect_25.1.10.9197_Release.msi"\n` +
      `msiexec /i $installer /qn`,
    art_cleanup:
      `$installer = "C:\\Users\\$env:username\\Downloads\\ScreenConnect.msi"\n` +
      `msiexec /x $installer /qn`,
    account_required: true,
  },
  Atera: {
    url: "",
    exe: "AteraAgent.msi",
    desc: "Atera RMM agent",
    vendor: "Atera Networks Ltd",
    abuse_reason:
      "Cloud-based RMM abused by threat actors who register free trial " +
      "accounts to generate agent installers. The agent provides full " +
      "remote shell, file transfer, and persistence.",
    platforms: ["windows", "macos"],
    safe_flag: "--help",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: true,
  },
  Splashtop: {
    url: "https://download.splashtop.com/winclient/STP/Splashtop_Personal_Win_v3.6.6.0.exe",
    exe: "Splashtop_Personal.exe",
    desc: "Splashtop Personal remote desktop",
    vendor: "Splashtop Inc.",
    abuse_reason:
      "Remote desktop tool abused for persistent access. Some adversaries " +
      "deploy the Splashtop Streamer component for unattended access.",
    platforms: ["windows", "macos"],
    safe_flag: "/S",
    art_guid: "b025c580-029e-4023-888d-a42710d76934",
    art_command:
      `New-Item -Type Directory "$env:TEMP\\ExternalPayloads\\" -ErrorAction Ignore -Force | Out-Null\n` +
      `Invoke-WebRequest -OutFile "$env:TEMP\\ExternalPayloads\\splashtop_install.exe" ` +
      `"https://download.splashtop.com/winclient/STP/Splashtop_Personal_Win_v3.6.6.0.exe"\n` +
      `Start-Process "$env:TEMP\\ExternalPayloads\\splashtop_install.exe" /S`,
    art_cleanup: `Stop-Process -Name "strwinclt" -force -erroraction silentlycontinue`,
    account_required: false,
  },
  RustDesk: {
    url: "https://github.com/rustdesk/rustdesk/releases/latest/download/rustdesk-1.3.8-x86_64.exe",
    exe: "rustdesk.exe",
    desc: "RustDesk open-source remote desktop",
    vendor: "RustDesk (open source)",
    abuse_reason:
      "Open-source remote desktop with self-hostable relay server. " +
      "Adversaries deploy self-hosted RustDesk infrastructure to avoid " +
      "vendor takedowns and maintain covert C2 channels.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "--help",
    art_guid: "f1641ba9-919a-4323-b74f-33372333bf0e",
    art_command:
      `$file = Join-Path $env:USERPROFILE "Desktop\\rustdesk-1.2.3-1-x86_64.exe"\n` +
      `Invoke-WebRequest -OutFile $file ` +
      `https://github.com/rustdesk/rustdesk/releases/download/1.2.3-1/rustdesk-1.2.3-1-x86_64.exe\n` +
      `Start-Process -FilePath $file "/S"`,
    art_cleanup:
      `$file = Join-Path $env:USERPROFILE "Desktop\\rustdesk-1.2.3-1-x86_64.exe"\n` +
      `Remove-Item $file -ErrorAction Ignore`,
    account_required: false,
  },
  MeshCentral: {
    url: "https://meshcentral.com/info/tools/MeshAgent64.exe",
    exe: "MeshAgent64.exe",
    desc: "MeshCentral open-source remote management agent",
    vendor: "MeshCentral (open source, formerly Intel AMT)",
    abuse_reason:
      "Open-source, self-hostable RMM that gives full remote shell, " +
      "file management, and desktop access. Increasingly used by " +
      "ransomware affiliates as a free, customisable C2 platform.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "--help",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  TightVNC: {
    url: "https://www.tightvnc.com/download/2.8.85/tightvnc-2.8.85-gpl-setup-64bit.msi",
    exe: "tightvnc-setup.msi",
    desc: "TightVNC open-source VNC remote desktop",
    vendor: "GlavSoft LLC",
    abuse_reason:
      "Lightweight, open-source VNC server/viewer that can be installed " +
      "silently. Used by threat actors for remote desktop access where " +
      "commercial RMMs would be detected.",
    platforms: ["windows", "linux"],
    safe_flag: "",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  UltraVNC: {
    url: "https://www.uvnc.eu/download/1381/UltraVNC_1_3_81_X64_Setup.exe",
    exe: "UltraVNC_Setup.exe",
    desc: "UltraVNC open-source remote access",
    vendor: "uvnc bvba (open source)",
    abuse_reason:
      "Open-source VNC implementation frequently deployed by threat " +
      "actors as an alternative to commercial RMMs. Supports silent " +
      "installation and can be configured with a pre-set password.",
    platforms: ["windows"],
    safe_flag: "/silent",
    art_guid: "42e51815-a6cc-4c75-b970-3f0ff54b610e",
    art_command:
      `New-Item -Type Directory "$env:TEMP\\ExternalPayloads\\" -ErrorAction Ignore -Force | Out-Null\n` +
      `Invoke-WebRequest "https://www.uvnc.eu/download/1381/UltraVNC_1_3_81_X64_Setup.exe" ` +
      `-OutFile "$env:TEMP\\ExternalPayloads\\vncsetup.exe"\n` +
      `start-process "$env:TEMP\\ExternalPayloads\\vncsetup.exe" /silent`,
    art_cleanup: `Stop-Process -Name "vncviewer" -force -erroraction silentlycontinue`,
    account_required: false,
  },
  Action1: {
    url: "https://www.action1.com/download/action1_agent.exe",
    exe: "action1_agent.exe",
    desc: "Action1 free endpoint management agent",
    vendor: "Action1 Corporation",
    abuse_reason:
      "Free-tier cloud RMM platform abused by threat actors who create " +
      "accounts to generate custom agent installers. Provides remote " +
      "shell, patch management, and software deployment.",
    platforms: ["windows"],
    safe_flag: "--help",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  SimpleHelp: {
    url: "https://simple-help.com/releases/SimpleHelp-windows-amd64.exe",
    exe: "SimpleHelp.exe",
    desc: "SimpleHelp remote support software",
    vendor: "SimpleHelp Ltd",
    abuse_reason:
      "Self-hosted remote support tool. Adversaries compromise existing " +
      "SimpleHelp servers or deploy their own to distribute agents to " +
      "victim machines.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "--help",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  Level: {
    url: "https://updates.level.io/level-windows-amd64.exe",
    exe: "level.exe",
    desc: "Level.io RMM agent",
    vendor: "Level (level.io)",
    abuse_reason:
      "Cloud-based RMM platform. Free-tier accounts can be used to " +
      "generate agent installers that provide persistent remote access.",
    platforms: ["windows", "macos"],
    safe_flag: "--help",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  "NetSupport Manager": {
    url: "https://nsproducts.azureedge.net/nsm-1270/en/Setup.exe",
    exe: "NetSupport_Setup.exe",
    desc: "NetSupport Manager remote control",
    vendor: "NetSupport Ltd",
    abuse_reason:
      "Widely abused by threat actors (TA569/SocGholish, TA505, Raspberry Robin). " +
      "The client component (client32.exe) is frequently dropped as a " +
      "RAT payload because it is a signed, legitimate binary.",
    platforms: ["windows"],
    safe_flag: "/S /v/qn",
    art_guid: "ecca999b-e0c8-40e8-8416-ad320b146a75",
    art_command:
      `New-Item -Type Directory "$env:TEMP\\ExternalPayloads\\" -ErrorAction Ignore -Force | Out-Null\n` +
      `(New-Object Net.WebClient).DownloadFile(` +
      `"https://nsproducts.azureedge.net/nsm-1270/en/Setup.exe",` +
      `"$env:TEMP\\ExternalPayloads\\T1219_NetSupport.exe")\n` +
      `Start-Process "$env:TEMP\\ExternalPayloads\\T1219_NetSupport.exe" -ArgumentList "/S /v/qn"`,
    art_cleanup: `Stop-Process -Name "client32" -force -erroraction silentlycontinue`,
    account_required: false,
  },
  "Ammyy Admin": {
    url: "https://web.archive.org/web/20140625232737/http://www.ammyy.com/AA_v3.exe",
    exe: "ammyy.exe",
    desc: "Ammyy Admin remote desktop",
    vendor: "Ammyy Group",
    abuse_reason:
      "Historically one of the most abused RMM tools. Its official " +
      "website was compromised multiple times to distribute malware. " +
      "Frequently used in tech-support scams and by APT groups.",
    platforms: ["windows"],
    safe_flag: "",
    art_guid: "0ae9e327-3251-465a-a53b-485d4e3f58fa",
    art_command:
      `New-Item -Type Directory "$env:TEMP\\ExternalPayloads\\" -ErrorAction Ignore -Force | Out-Null\n` +
      `Invoke-WebRequest ` +
      `"https://web.archive.org/web/20140625232737/http://www.ammyy.com/AA_v3.exe" ` +
      `-OutFile "$env:TEMP\\ExternalPayloads\\ammyy.exe" -UseBasicParsing\n` +
      `Start-Process "$env:TEMP\\ExternalPayloads\\ammyy.exe"`,
    art_cleanup: `Stop-Process -Name "Ammyy" -force -erroraction silentlycontinue`,
    account_required: false,
  },
  DWService: {
    url: "https://www.dwservice.net/download/dwagent.exe",
    exe: "dwagent.exe",
    desc: "DWService open-source remote access",
    vendor: "DWService (open source)",
    abuse_reason:
      "Free, open-source remote access agent. Adversaries create free " +
      "DWService accounts and deploy agents to victim machines for " +
      "persistent remote shell and file transfer access.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "--help",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  "Tactical RMM": {
    url: "https://github.com/amidaware/tacticalrmm/releases",
    exe: "tacticalrmm.exe",
    desc: "Tactical RMM open-source IT management",
    vendor: "Amidaware (open source)",
    abuse_reason:
      "Open-source, self-hosted RMM that provides full remote shell, " +
      "script execution, and file management. Increasingly popular " +
      "with threat actors due to its self-hosted nature.",
    platforms: ["windows", "linux"],
    safe_flag: "--help",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  LogMeIn: {
    url: "https://secure.logmein.com/LogMeInIgnition.msi",
    exe: "LogMeInIgnition.msi",
    desc: "LogMeIn Ignition remote access",
    vendor: "GoTo (formerly LogMeIn Inc.)",
    abuse_reason:
      "Enterprise remote access tool abused for persistent access. " +
      "Adversaries install LogMeIn on compromised hosts to maintain " +
      "access that blends with legitimate enterprise usage.",
    platforms: ["windows", "macos"],
    safe_flag: "/quiet",
    art_guid: "d03683ec-aae0-42f9-9b4c-534780e0f8e1",
    art_command:
      `Invoke-WebRequest -OutFile C:\\Users\\$env:username\\Desktop\\LogMeInIgnition.msi ` +
      `https://secure.logmein.com/LogMeInIgnition.msi\n` +
      `$file1 = "C:\\Users\\" + $env:username + "\\Desktop\\LogMeInIgnition.msi"\n` +
      `Start-Process -Wait $file1 /quiet;\n` +
      `Start-Process 'C:\\Program Files (x86)\\LogMeIn Ignition\\LMIIgnition.exe' "/S"`,
    art_cleanup:
      `get-package *'LogMeIn Client'* -ErrorAction Ignore | uninstall-package\n` +
      `$file1 = "C:\\Users\\" + $env:username + "\\Desktop\\LogMeInIgnition.msi"\n` +
      `Remove-Item $file1 -ErrorAction Ignore`,
    account_required: false,
  },
  RemotePC: {
    url: "https://static.remotepc.com/downloads/rpc/140422/RemotePC.exe",
    exe: "RemotePC.exe",
    desc: "RemotePC remote desktop access",
    vendor: "iDrive Inc.",
    abuse_reason:
      "Remote access software that can be silently installed. Creates " +
      "multiple scheduled tasks for persistence and auto-start.",
    platforms: ["windows", "macos"],
    safe_flag: "",
    art_guid: "fbff3f1f-b0bf-448e-840f-7e1687affdce",
    art_command:
      `New-Item -Type Directory "$env:TEMP\\ExternalPayloads\\" -ErrorAction Ignore -Force | Out-Null\n` +
      `Invoke-WebRequest "https://static.remotepc.com/downloads/rpc/140422/RemotePC.exe" ` +
      `-OutFile "$env:TEMP\\ExternalPayloads\\RemotePC.exe" -UseBasicParsing\n` +
      `Start-Process "$env:TEMP\\ExternalPayloads\\RemotePC.exe"`,
    art_cleanup:
      `Unregister-ScheduledTask -TaskName "RemotePC" -Confirm:$False -ErrorAction SilentlyContinue\n` +
      `Unregister-ScheduledTask -TaskName "RPCServiceHealthCheck" -Confirm:$False -ErrorAction SilentlyContinue\n` +
      `Stop-Process -Name "RemotePCService" -force -erroraction silentlycontinue\n` +
      `Stop-Process -Name "RPCService" -force -erroraction silentlycontinue`,
    account_required: false,
  },
  UltraViewer: {
    url: "https://www.ultraviewer.net/en/UltraViewer_setup_6.5_en.exe",
    exe: "UltraViewer_setup.exe",
    desc: "UltraViewer remote support",
    vendor: "DucFabulous Co., Ltd.",
    abuse_reason:
      "Free remote support tool popular in Asia-Pacific. Abused in " +
      "tech-support scams and by threat actors as an alternative to " +
      "more heavily monitored RMMs.",
    platforms: ["windows"],
    safe_flag: "/silent",
    art_guid: "19acf63b-55c4-4b6a-8552-00a8865105c8",
    art_command:
      `New-Item -Type Directory "$env:TEMP\\ExternalPayloads\\" -ErrorAction Ignore -Force | Out-Null\n` +
      `(New-Object Net.WebClient).DownloadFile(` +
      `"https://www.ultraviewer.net/en/UltraViewer_setup_6.5_en.exe",` +
      `"$env:TEMP\\ExternalPayloads\\T1219_UltraViewer.exe")\n` +
      `Start-Process -Wait -FilePath "$env:TEMP\\ExternalPayloads\\T1219_UltraViewer.exe" ` +
      `-Argument "/silent" -PassThru\n` +
      `Start-Process 'C:\\Program Files (x86)\\UltraViewer\\UltraViewer_Desktop.exe'`,
    art_cleanup:
      `Stop-Process -Name "UltraViewer_Desktop" -Force -ErrorAction SilentlyContinue`,
    account_required: false,
  },
  GoToAssist: {
    url: "https://launch.getgo.com/launcher2/helper?token=e0-FaCddxmtMoX8_cY4czssnTeGvy83ihp8CLREfvwQshiBW0_RcbdoaEp8IA-Qn8wpbKlpGIflS-39gW6RuWRM-XHwtkRVMLBsp5RSKp-a3PBM-Pb1Fliy73EDgoaxr-q83WtXbLKqD7-u3cfDl9gKsymmhdkTGsXcDXir90NqKj92LsN_KpyYwV06lIxsdRekhNZjNwhkWrBa_hG8RQJqWSGk6tkZLVMuMufmn37eC2Cqqiwq5bCGnH5dYiSUUsklSedRLjh4N46qPYT1bAU0qD25ZPr-Kvf4Kzu9bT02q3Yntj02ZA99TxL2-SKzgryizoopBPg4Ilfo5t78UxKTYeEwo4etQECfkCRvenkTRlIHmowdbd88zz7NiccXnbHJZehgs6_-JSVjQIdPTXZbF9T5z44mi4BQYMtZAS3DE86F0C3D4Tcd7fa5F6Ve8rQWt7pvqFCYyiJAailslxOw0LsGyFokoy65tMF980ReP8zhVcTKYP8s8mhGXihUQJQPNk20Sw&downloadTrigger=restart&renameFile=1",
    exe: "GoToAssist.exe",
    desc: "GoTo Assist (GoTo) remote support",
    vendor: "GoTo (formerly Citrix/LogMeIn)",
    abuse_reason:
      "Remote support tool from the GoTo (LogMeIn) family. Abused for " +
      "persistent access and tech-support scams.",
    platforms: ["windows", "macos"],
    safe_flag: "/S",
    art_guid: "1b72b3bd-72f8-4b63-a30b-84e91b9c3578",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  "MSP360 Connect": {
    url: "",
    exe: "Connect.exe",
    desc: "MSP360 Connect (formerly CloudBerry) remote access",
    vendor: "MSP360 (formerly CloudBerry Lab)",
    abuse_reason:
      "MSP-focused remote access tool. Can be deployed silently and " +
      "provides full remote desktop capabilities.",
    platforms: ["windows"],
    safe_flag: "",
    art_guid: "b1b8128b-c5d4-4de9-bf70-e60419274562",
    art_command: "",
    art_cleanup: `Stop-Process -Name "Connect" -force -erroraction silentlycontinue`,
    account_required: true,
  },
  "Zoho Assist": {
    url: "",
    exe: "ZohoAssist.exe",
    desc: "Zoho Assist remote support and access",
    vendor: "Zoho Corporation",
    abuse_reason:
      "Cloud-based remote support tool. Free tier allows adversaries to " +
      "quickly generate agent installers for persistent access.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: true,
  },
  Supremo: {
    url: "https://www.supremocontrol.com/downloads/Supremo.exe",
    exe: "Supremo.exe",
    desc: "Supremo remote desktop control",
    vendor: "Nanosystems S.r.l.",
    abuse_reason:
      "Italian remote desktop tool. Portable single-binary that can run " +
      "without installation, making it attractive for adversaries.",
    platforms: ["windows"],
    safe_flag: "",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  Parsec: {
    url: "https://builds.parsec.app/package/parsec-windows.exe",
    exe: "parsec-windows.exe",
    desc: "Parsec remote desktop (gaming-focused)",
    vendor: "Unity Technologies (Parsec)",
    abuse_reason:
      "Low-latency remote desktop designed for gaming. Provides high-quality " +
      "interactive remote access that can evade RMM-focused detections.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  HopToDesk: {
    url: "https://www.hoptodesk.com/download/HopToDesk.exe",
    exe: "HopToDesk.exe",
    desc: "HopToDesk free remote desktop",
    vendor: "HopToDesk",
    abuse_reason:
      "Free, portable remote desktop tool. No installation required, " +
      "single executable — ideal for adversary quick-deploy scenarios.",
    platforms: ["windows", "macos", "linux"],
    safe_flag: "--help",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
  "Remote Utilities": {
    url: "https://www.remoteutilities.com/download/RUSetup.exe",
    exe: "RUSetup.exe",
    desc: "Remote Utilities (RUT) remote access",
    vendor: "Remote Utilities LLC",
    abuse_reason:
      "Remote access tool with a free-for-personal-use tier. Supports " +
      "silent/unattended installation with pre-configured settings, " +
      "making it useful for adversary deployment.",
    platforms: ["windows"],
    safe_flag: "",
    art_guid: "",
    art_command: "",
    art_cleanup: "",
    account_required: false,
  },
};

// ---------------------------------------------------------------------------
// LOLRMM YAML shape (only the fields the parser reads).
// ---------------------------------------------------------------------------
interface PeMetadata {
  Filename?: string;
  OriginalFileName?: string;
}
interface LolrmmDetails {
  Website?: string;
  SupportedOS?: string[];
  InstallationPaths?: string[];
  PEMetadata?: PeMetadata[] | PeMetadata;
}
interface EventLogArtifact {
  ServiceName?: string;
  ImagePath?: string;
}
interface NetworkArtifact {
  Domains?: string[];
  Ports?: Array<number | string>;
}
interface LolrmmArtifacts {
  EventLog?: EventLogArtifact[];
  Network?: NetworkArtifact[];
}
interface LolrmmYaml {
  Name?: string;
  Description?: string;
  Details?: LolrmmDetails;
  Artifacts?: LolrmmArtifacts;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export class LolrmmIngestor implements LotlIngestor {
  readonly sourceId = "lolrmm";
  readonly displayName = "LOLRMM";
  readonly description = "Living Off The Land Remote Monitoring and Management tools";
  readonly repo = "magicsword-io/LOLRMM";
  readonly branch = "main";
  readonly repoUrl = "https://github.com/magicsword-io/LOLRMM";
  readonly platform = "windows";

  async collect(): Promise<NormalizedEntry[]> {
    const { items } = await fetchTree(this.repo, this.branch, (p) => MATCH.test(p));

    const perFile = await pMap(
      items,
      async (item) => {
        try {
          const content = await fetchRaw(this.repo, this.branch, item.path);
          const data = yaml.load(content) as LolrmmYaml | null | undefined;
          if (!data) return { name: "", tests: [] as NormalizedEntry[] };
          const name = data.Name || "";
          const url = rawUrl(this.repo, this.branch, item.path);
          const base = item.path.split("/").pop()!.replace(/\.yaml$/i, "");
          const tests = this.parseRmm(data, base).map((e) => ({ ...e, sourceUrl: url }));
          return { name, tests };
        } catch {
          return { name: "", tests: [] as NormalizedEntry[] };
        }
      },
      20,
    );

    const seen = new Set<string>();
    for (const f of perFile) if (f.name) seen.add(f.name);

    const tests: NormalizedEntry[] = perFile.flatMap((f) => f.tests);

    // Generate tests for catalog tools not found in LOLRMM YAML data. These are
    // well-known abused RMMs that may not (yet) have a LOLRMM YAML entry but
    // should still be testable.
    for (const [toolName, catalog] of Object.entries(RMM_CATALOG)) {
      if (seen.has(toolName)) continue;
      const ref = `catalog:${slugify(toolName)}`;
      for (const t of this.generateCatalogOnlyTests(toolName, ref, catalog)) {
        tests.push({ ...t, sourceUrl: this.repoUrl });
      }
    }

    return tests;
  }

  // -- per-tool parsing from LOLRMM YAML ------------------------------------

  private parseRmm(data: LolrmmYaml, ref: string): NormalizedEntry[] {
    const tests: NormalizedEntry[] = [];
    const name = data.Name || "";
    const description = data.Description || "";
    if (!name) return tests;

    const details = data.Details || {};
    const website = details.Website || "";
    const supportedOs = (details.SupportedOS || []).map((s) => String(s).toLowerCase());
    const artifacts = data.Artifacts || {};

    const catalog = RMM_CATALOG[name];
    const vendor = catalog?.vendor || "";
    const abuseReason = catalog?.abuse_reason || "";

    const platforms = this.resolvePlatforms(supportedOs, catalog);

    tests.push(
      ...this.buildDownloadExecuteTest(name, ref, website, catalog, platforms, vendor, abuseReason),
    );
    tests.push(
      ...this.buildExecutionTest(name, ref, description, website, details, platforms, vendor, abuseReason),
    );
    tests.push(
      ...this.buildServiceTest(name, ref, website, artifacts, vendor, abuseReason),
    );
    tests.push(
      ...this.buildNetworkTest(name, ref, website, artifacts, platforms, vendor, abuseReason),
    );

    return tests;
  }

  // -- test builders ---------------------------------------------------------

  private buildDownloadExecuteTest(
    name: string,
    ref: string,
    website: string,
    catalog: RmmCatalogEntry | undefined,
    platforms: string[],
    vendor: string,
    abuseReason: string,
  ): NormalizedEntry[] {
    if (!catalog) return [];

    const dlUrl = catalog.url || "";
    const dlExe = catalog.exe || "";
    const dlDesc = catalog.desc || name;
    const safeFlag = catalog.safe_flag !== undefined ? catalog.safe_flag : "--help";
    const artGuid = catalog.art_guid || "";
    const artCommand = catalog.art_command || "";
    const artCleanup = catalog.art_cleanup || "";
    const accountRequired = catalog.account_required || false;

    if (!dlUrl && !artCommand) {
      // No direct download and no ART command — generate a note-only test.
      if (!accountRequired) return [];
      return this.buildAccountRequiredTest(name, ref, website, catalog, platforms, vendor, abuseReason);
    }

    let command: string;
    let cleanup: string | null;

    if (artCommand) {
      // Prefer Atomic Red Team command when available (tested, community-validated).
      command =
        `# === LOLRMM + Atomic Red Team: ${name} Download & Execute ===\n` +
        `# ART GUID: ${artGuid}\n` +
        `# Source: Atomic Red Team T1219 + LOLRMM catalog\n` +
        `# This test downloads and executes ${name} to validate that\n` +
        `# application control and endpoint protection prevent\n` +
        `# unauthorized RMM deployment.\n` +
        `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12\n` +
        `${artCommand}`;
      cleanup = artCleanup ? artCleanup : null;
    } else {
      // Generate our standard download+execute+cleanup template.
      command =
        `# === LOLRMM: ${name} Download & Execute Prevention Test ===\n` +
        `# Source: LOLRMM catalog\n` +
        `# This test downloads and attempts to execute ${name} to validate\n` +
        `# that your security stack blocks unauthorized RMM deployment.\n` +
        `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12\n` +
        `$outPath = Join-Path $env:TEMP '${dlExe}'\n` +
        `Write-Host '[*] Downloading ${name} from ${dlUrl}...'\n` +
        `try {\n` +
        `    Invoke-WebRequest -Uri '${dlUrl}' -OutFile $outPath -UseBasicParsing -ErrorAction Stop\n` +
        `} catch {\n` +
        `    Write-Host "BLOCKED: Download failed - $($_.Exception.Message)"\n` +
        `    exit 0\n` +
        `}\n` +
        `if (Test-Path $outPath) {\n` +
        `    $hash = (Get-FileHash -Path $outPath -Algorithm SHA256).Hash\n` +
        `    Write-Host "[*] Downloaded to: $outPath (SHA256: $hash)"\n` +
        `    Write-Host '[*] Attempting execution...'\n` +
        `    try {\n` +
        `        $proc = Start-Process -FilePath $outPath`;
      if (safeFlag) command += ` -ArgumentList '${safeFlag}'`;
      command +=
        ` -PassThru -NoNewWindow -ErrorAction Stop\n` +
        `        Start-Sleep -Seconds 5\n` +
        `        if (-not $proc.HasExited) { $proc.Kill() }\n` +
        `        Write-Host 'ALLOWED: ${name} executed successfully (PID:' $proc.Id ')'\n` +
        `    } catch {\n` +
        `        Write-Host "BLOCKED: Execution prevented - $($_.Exception.Message)"\n` +
        `    }\n` +
        `} else {\n` +
        `    Write-Host 'BLOCKED: File not written to disk'\n` +
        `}`;
      cleanup = `Remove-Item -Path "$env:TEMP\\${dlExe}" -Force -ErrorAction SilentlyContinue`;
    }

    let testDescription =
      `Download and attempt to execute ${name} (${dlDesc}). ` +
      `This tests whether application control and endpoint protection ` +
      `prevent the download, write-to-disk, and execution of an unauthorized ` +
      `RMM tool. `;
    if (abuseReason) testDescription += abuseReason;

    return [
      {
        sourceRef: `${ref}:download_execute`,
        name: `LOLRMM: ${name} - Download & Execute (${dlExe})`,
        description: testDescription,
        command,
        executor: "powershell",
        techniqueId: TECHNIQUE_ID,
        binaryPath: dlExe,
        elevationRequired: false,
        riskLevel: "high",
        platforms,
        cleanupCommand: cleanup,
        metadata: {
          rmm_tool: name,
          vendor,
          website,
          test_type: "download_execute",
          download_url: dlUrl,
          abuse_reason: abuseReason,
          art_guid: artGuid || null,
          art_cross_reference: Boolean(artCommand),
          source: "lolrmm",
        },
      },
    ];
  }

  private buildAccountRequiredTest(
    name: string,
    ref: string,
    website: string,
    catalog: RmmCatalogEntry,
    platforms: string[],
    vendor: string,
    abuseReason: string,
  ): NormalizedEntry[] {
    const dlDesc = catalog.desc || name;
    const firstWord = name.split(/\s+/)[0].toLowerCase();

    const command =
      `# === LOLRMM: ${name} - Account-Required RMM Test ===\n` +
      `# ${name} requires a vendor account to generate agent installers.\n` +
      `# This test checks if the ${name} agent is already deployed.\n` +
      `#\n` +
      `# To perform a full download+execute test:\n` +
      `#   1. Create a trial account at ${website || "the vendor website"}\n` +
      `#   2. Generate an agent installer\n` +
      `#   3. Attempt to deploy it on this endpoint\n` +
      `#\n` +
      `$found = $false\n` +
      `# Check for running processes\n` +
      `$procs = Get-Process -Name '*${firstWord}*' -ErrorAction SilentlyContinue\n` +
      `if ($procs) {\n` +
      `    Write-Host 'FOUND: ${name} process running:' ($procs | Select-Object Name, Id | Out-String)\n` +
      `    $found = $true\n` +
      `}\n` +
      `# Check for services\n` +
      `$svcs = Get-Service -Name '*${firstWord}*' -ErrorAction SilentlyContinue\n` +
      `if ($svcs) {\n` +
      `    Write-Host 'FOUND: ${name} service:' ($svcs | Select-Object Name, Status | Out-String)\n` +
      `    $found = $true\n` +
      `}\n` +
      `if (-not $found) { Write-Host 'NOT FOUND: ${name} not detected on this system' }`;

    return [
      {
        sourceRef: `${ref}:detect_existing`,
        name: `LOLRMM: ${name} - Detect Existing Deployment`,
        description:
          `Check if ${name} (${dlDesc}) is already deployed on this endpoint. ` +
          `${name} requires an account to download agent installers. ` +
          `${abuseReason}`,
        command,
        executor: "powershell",
        techniqueId: TECHNIQUE_ID,
        binaryPath: null,
        elevationRequired: false,
        riskLevel: "medium",
        platforms,
        cleanupCommand: null,
        metadata: {
          rmm_tool: name,
          vendor,
          website,
          test_type: "detect_existing",
          account_required: true,
          abuse_reason: abuseReason,
          source: "lolrmm",
        },
      },
    ];
  }

  private buildExecutionTest(
    name: string,
    ref: string,
    description: string,
    website: string,
    details: LolrmmDetails,
    platforms: string[],
    vendor: string,
    abuseReason: string,
  ): NormalizedEntry[] {
    const installPaths = details.InstallationPaths || [];
    const peMetadata = details.PEMetadata;

    const exeNames: string[] = [];
    if (Array.isArray(peMetadata)) {
      for (const pe of peMetadata) {
        if (pe && typeof pe === "object") {
          const fn = pe.Filename || pe.OriginalFileName || "";
          if (fn) exeNames.push(fn);
        }
      }
    } else if (peMetadata && typeof peMetadata === "object") {
      const fn = peMetadata.Filename || peMetadata.OriginalFileName || "";
      if (fn) exeNames.push(fn);
    }

    if (exeNames.length === 0) return [];

    const concretePaths: string[] = [];
    for (const p of installPaths) {
      if (typeof p === "string" && p.trim()) {
        if (p.includes("\\") && !p.endsWith("*.exe")) {
          const cleaned = p.replace(/\*/g, "").replace(/\\+$/, "");
          if (cleaned) concretePaths.push(cleaned);
        }
      }
    }

    const primaryExe = exeNames[0];

    const pathChecks: string[] = [];
    for (const cp of concretePaths.slice(0, 5)) {
      let fullPath = cp;
      if (!cp.toLowerCase().endsWith(".exe")) {
        fullPath = `${cp}\\${primaryExe}`;
      }
      pathChecks.push(`'${fullPath}'`);
    }

    let checkScript: string;
    if (pathChecks.length > 0) {
      checkScript =
        `# === LOLRMM: ${name} - Execution Prevention Test ===\n` +
        `# Check if ${name} is installed and can execute\n` +
        `$paths = @(${pathChecks.join(", ")})\n` +
        `$found = $false\n` +
        `foreach ($p in $paths) {\n` +
        `    if (Test-Path $p) {\n` +
        `        Write-Host "FOUND: $p"\n` +
        `        $hash = (Get-FileHash -Path $p -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash\n` +
        `        Write-Host "SHA256: $hash"\n` +
        `        try {\n` +
        `            $proc = Start-Process -FilePath $p -ArgumentList '--version' -PassThru -NoNewWindow -ErrorAction Stop\n` +
        `            $proc | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue\n` +
        `            if (-not $proc.HasExited) { $proc.Kill() }\n` +
        `            Write-Host 'ALLOWED: ${name} executed'\n` +
        `        } catch {\n` +
        `            Write-Host "BLOCKED: Execution prevented - $($_.Exception.Message)"\n` +
        `        }\n` +
        `        $found = $true; break\n` +
        `    }\n` +
        `}\n` +
        `if (-not $found) { Write-Host 'NOT INSTALLED: ${name} not found at known paths' }`;
    } else {
      checkScript =
        `# === LOLRMM: ${name} - Execution Prevention Test ===\n` +
        `$exe = Get-Command '${primaryExe}' -ErrorAction SilentlyContinue\n` +
        `if ($exe) {\n` +
        `    Write-Host "FOUND: $($exe.Source)"\n` +
        `    $hash = (Get-FileHash -Path $exe.Source -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash\n` +
        `    Write-Host "SHA256: $hash"\n` +
        `    try {\n` +
        `        Start-Process -FilePath $exe.Source -ArgumentList '--version' -PassThru -NoNewWindow -ErrorAction Stop | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue\n` +
        `        Write-Host 'ALLOWED: ${name} executed'\n` +
        `    } catch {\n` +
        `        Write-Host "BLOCKED: Execution prevented - $($_.Exception.Message)"\n` +
        `    }\n` +
        `} else { Write-Host 'NOT INSTALLED: ${primaryExe} not in PATH' }`;
    }

    return [
      {
        sourceRef: `${ref}:execution`,
        name: `LOLRMM: ${name} - Execution (${primaryExe})`,
        description:
          `Test whether ${name} RMM tool can execute from known installation paths. ` +
          `Application control policies (AppLocker/WDAC) should prevent ` +
          `unauthorized RMM tools from running. ${description}`,
        command: checkScript,
        executor: "powershell",
        techniqueId: TECHNIQUE_ID,
        binaryPath: primaryExe,
        elevationRequired: false,
        riskLevel: "medium",
        platforms,
        cleanupCommand: null,
        metadata: {
          rmm_tool: name,
          vendor,
          website,
          test_type: "execution",
          install_paths: installPaths,
          executables: exeNames,
          abuse_reason: abuseReason,
          source: "lolrmm",
        },
      },
    ];
  }

  private buildServiceTest(
    name: string,
    ref: string,
    website: string,
    artifacts: LolrmmArtifacts,
    vendor: string,
    abuseReason: string,
  ): NormalizedEntry[] {
    const eventLogs = artifacts.EventLog || [];
    const serviceNames: string[] = [];
    const serviceImages: string[] = [];

    for (const evt of eventLogs) {
      if (evt && typeof evt === "object" && evt.ServiceName) {
        const svc = evt.ServiceName;
        const img = evt.ImagePath || "";
        if (!serviceNames.includes(svc)) {
          serviceNames.push(svc);
          if (img) serviceImages.push(img);
        }
      }
    }

    if (serviceNames.length === 0) return [];

    const svcName = serviceNames[0];
    const svcChecks = serviceNames
      .slice(0, 5)
      .map((s) => `$_.Name -eq '${s}'`)
      .join(" -or ");

    const command =
      `# === LOLRMM: ${name} - Service Prevention Test ===\n` +
      `# Check if ${name} RMM service exists or is running\n` +
      `$services = Get-Service | Where-Object { ${svcChecks} }\n` +
      `if ($services) {\n` +
      `    foreach ($svc in $services) {\n` +
      `        Write-Host "SERVICE EXISTS: $($svc.Name) - Status: $($svc.Status)"\n` +
      `        # Check service binary path\n` +
      `        $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$($svc.Name)"\n` +
      `        $imgPath = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).ImagePath\n` +
      `        if ($imgPath) { Write-Host "  ImagePath: $imgPath" }\n` +
      `    }\n` +
      `} else {\n` +
      `    Write-Host 'NOT FOUND: No ${name} services detected'\n` +
      `}`;

    return [
      {
        sourceRef: `${ref}:service`,
        name: `LOLRMM: ${name} - Service (${svcName})`,
        description:
          `Check if ${name} RMM service '${svcName}' exists or can be created. ` +
          `Endpoint policies should prevent unauthorized RMM service installation.`,
        command,
        executor: "powershell",
        techniqueId: TECHNIQUE_ID,
        binaryPath: null,
        elevationRequired: false,
        riskLevel: "medium",
        platforms: ["windows"],
        cleanupCommand: null,
        metadata: {
          rmm_tool: name,
          vendor,
          website,
          test_type: "service",
          service_names: serviceNames,
          service_images: serviceImages,
          abuse_reason: abuseReason,
          source: "lolrmm",
        },
      },
    ];
  }

  private buildNetworkTest(
    name: string,
    ref: string,
    website: string,
    artifacts: LolrmmArtifacts,
    platforms: string[],
    vendor: string,
    abuseReason: string,
  ): NormalizedEntry[] {
    const networkArtifacts = artifacts.Network || [];
    const domains: string[] = [];
    const ports: Array<number | string> = [];

    for (const net of networkArtifacts) {
      if (net && typeof net === "object") {
        for (const d of net.Domains || []) {
          // Skip wildcard-only, regex, or placeholder domains.
          if (typeof d === "string" && d && !d.startsWith("*") && !d.includes("[")) {
            if (!/[[\]()]/.test(d)) {
              domains.push(d);
            }
          }
        }
        for (const p of net.Ports || []) {
          if (p && !ports.includes(p)) ports.push(p);
        }
      }
    }

    if (domains.length === 0) return [];

    const testDomains = domains.slice(0, 3);
    const port = ports.length > 0 ? ports[0] : 443;

    const domainChecks: string[] = [];
    for (const d of testDomains) {
      domainChecks.push(
        `    # Test: ${d}\n` +
          `    $dns = Resolve-DnsName '${d}' -ErrorAction SilentlyContinue\n` +
          `    if ($dns) {\n` +
          `        Write-Host "RESOLVED: ${d} ->" ($dns | Where-Object { $_.IPAddress } | Select-Object -First 1 -ExpandProperty IPAddress)\n` +
          `        $tcp = Test-NetConnection -ComputerName '${d}' -Port ${port} -WarningAction SilentlyContinue -ErrorAction SilentlyContinue\n` +
          `        if ($tcp.TcpTestSucceeded) {\n` +
          `            Write-Host "ALLOWED: TCP connection to ${d}:${port} succeeded"\n` +
          `        } else {\n` +
          `            Write-Host "BLOCKED: TCP connection to ${d}:${port} failed"\n` +
          `        }\n` +
          `    } else {\n` +
          `        Write-Host "BLOCKED: DNS resolution failed for ${d}"\n` +
          `    }`,
      );
    }

    const primaryDomain = testDomains[0];
    const command =
      `# === LOLRMM: ${name} - Network Connectivity Prevention Test ===\n` +
      `# Test whether this endpoint can reach ${name} RMM infrastructure\n` +
      `# DNS filtering and firewall rules should block these connections\n` +
      domainChecks.join("\n");

    return [
      {
        sourceRef: `${ref}:network`,
        name: `LOLRMM: ${name} - Network (${primaryDomain})`,
        description:
          `Test whether the endpoint can resolve and reach ${name} RMM ` +
          `infrastructure at ${primaryDomain}. Network controls and DNS ` +
          `filtering should block unauthorized RMM tool communications.`,
        command,
        executor: "powershell",
        techniqueId: TECHNIQUE_ID,
        binaryPath: null,
        elevationRequired: false,
        riskLevel: "low",
        platforms,
        cleanupCommand: null,
        metadata: {
          rmm_tool: name,
          vendor,
          website,
          test_type: "network",
          domains,
          ports,
          abuse_reason: abuseReason,
          source: "lolrmm",
        },
      },
    ];
  }

  // -- catalog-only tests (tools not in LOLRMM YAML) ------------------------

  private generateCatalogOnlyTests(
    name: string,
    ref: string,
    catalog: RmmCatalogEntry,
  ): NormalizedEntry[] {
    const vendor = catalog.vendor || "";
    const abuseReason = catalog.abuse_reason || "";
    const website = "";
    const platforms = catalog.platforms || ["windows"];

    return this.buildDownloadExecuteTest(name, ref, website, catalog, platforms, vendor, abuseReason);
  }

  // -- helpers ---------------------------------------------------------------

  private resolvePlatforms(supportedOs: string[], catalog: RmmCatalogEntry | undefined): string[] {
    const platforms = new Set<string>();

    const osMap: Record<string, string> = {
      windows: "windows",
      mac: "macos",
      macos: "macos",
      linux: "linux",
      android: "android",
      ios: "ios",
      chromeos: "chromeos",
    };
    for (const osName of supportedOs) {
      const mapped = osMap[osName.toLowerCase()];
      if (mapped) platforms.add(mapped);
    }

    for (const p of catalog?.platforms || []) platforms.add(p);

    if (platforms.size === 0) platforms.add("windows");

    return [...platforms].sort();
  }
}
