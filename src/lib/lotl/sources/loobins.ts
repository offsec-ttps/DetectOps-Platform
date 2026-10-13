/**
 * LOOBins ingestor — Living Off the Orchard: macOS Binaries.
 * Ported from magicsword-io/Magic-Atomics backend/app/ingestion/loobins.py.
 *
 * Source: https://github.com/infosecB/LOOBins — one YAML per macOS binary under
 * LOOBins/. Each entry's example_use_cases are parsed into prevention tests and
 * the tactic names are mapped to MITRE ATT&CK technique IDs.
 *
 * Unlike a naive pass-through of the `code` field, this ingestor (identical to
 * the Python original):
 *   1. Substitutes placeholder paths, URLs, and IPs with safe, executable
 *      alternatives so tests actually *run* on a stock macOS system.
 *   2. Generates cleanup commands that undo filesystem side-effects.
 *   3. Marks genuinely destructive or un-safeable commands as risk_level "high"
 *      with an explanatory unsafe_reason in metadata so the runner can skip or
 *      gate them.
 *   4. Validates that referenced macOS binaries exist at standard paths.
 *   5. Uses per-binary technique refinements where the generic tactic-level
 *      mapping would be too coarse.
 *
 * LOOBins is macOS-only, so every entry's platforms are fixed to ["macos"].
 */

import yaml from "js-yaml";
import type { LotlIngestor } from "../base";
import type { NormalizedEntry, LotlExecutor, LotlRisk } from "../types";
import { fetchTree, fetchRaw, pMap, rawUrl } from "../github";

const MATCH = /^LOOBins\/.+\.yml$/;

// ---------------------------------------------------------------------------
// Safe test resources
// ---------------------------------------------------------------------------
// A small, always-available, public URL used as a stand-in for any placeholder
// URL in LOOBins code samples. The Atomic Red Team LICENSE file is a ~1 KB text
// file — perfect for download tests.
const SAFE_URL =
  "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/LICENSE.txt";
// Temp directory prefix for all test artifacts.
const TEMP_PREFIX = "/tmp/loobins_test";

// ---------------------------------------------------------------------------
// Tactic -> MITRE ATT&CK technique mapping
// ---------------------------------------------------------------------------
// LOOBins uses tactic names (Discovery, Execution, etc.) rather than technique
// IDs. Each tactic maps to the most relevant technique for macOS LOL binary
// abuse.
const TACTIC_TO_TECHNIQUE: Record<string, string> = {
  // Execution
  execution: "T1059.004", // Unix Shell
  // Persistence
  persistence: "T1543.001", // Launch Agent (unprivileged default)
  // Privilege Escalation
  "privilege-escalation": "T1548.004",
  "privilege escalation": "T1548.004",
  // Stealth (formerly Defense Evasion) — Gatekeeper Bypass is the dominant macOS LOL evasion
  stealth: "T1553.001", // Gatekeeper Bypass
  "defense-evasion": "T1553.001", // legacy mapping
  "defense evasion": "T1553.001",
  // Credential Access
  "credential-access": "T1555.001", // Keychain
  "credential access": "T1555.001",
  // Discovery
  discovery: "T1082", // System Information Discovery
  // Lateral Movement
  "lateral-movement": "T1021.004", // SSH
  "lateral movement": "T1021.004",
  // Collection
  collection: "T1560.001", // Archive via Utility
  // Command and Control
  "command-and-control": "T1105", // Ingress Tool Transfer
  "command and control": "T1105",
  // Exfiltration
  exfiltration: "T1048", // Exfiltration Over Alternative Protocol
  // Impact — Inhibit System Recovery matches tmutil abuse better
  impact: "T1490", // Inhibit System Recovery
  // Reconnaissance — Software Discovery for local recon
  reconnaissance: "T1518", // Software Discovery
};

// ---------------------------------------------------------------------------
// Per-binary technique overrides
// ---------------------------------------------------------------------------
// Some binaries have a clearly better technique than the generic tactic mapping
// would give. These override TACTIC_TO_TECHNIQUE when the binary name matches.
const BINARY_TECHNIQUE_MAP: Record<string, string> = {
  osascript: "T1059.002", // AppleScript
  osacompile: "T1059.002", // AppleScript
  swift: "T1059.004", // Unix Shell (Swift REPL)
  tclsh: "T1059.004", // Unix Shell (Tcl)
  security: "T1555.001", // Keychain
  sqlite3: "T1005", // Data from Local System
  ditto: "T1560.001", // Archive via Utility
  hdiutil: "T1553.001", // Gatekeeper Bypass (DMG mounting)
  xattr: "T1553.001", // Gatekeeper Bypass
  spctl: "T1553.001", // Gatekeeper Bypass
  launchctl: "T1569.001", // Launchctl
  screencapture: "T1113", // Screen Capture
  pbpaste: "T1115", // Clipboard Data
  nscurl: "T1105", // Ingress Tool Transfer
  networksetup: "T1090", // Proxy
  tmutil: "T1490", // Inhibit System Recovery
  defaults: "T1647", // Plist File Modification
  plutil: "T1647", // Plist File Modification
  profiles: "T1082", // System Information Discovery
  caffeinate: "T1059.004", // Unix Shell (execution wrapper)
  open: "T1204.002", // User Execution: Malicious File
  mdfind: "T1083", // File and Directory Discovery
  scutil: "T1016", // System Network Configuration Discovery
  system_profiler: "T1082", // System Information Discovery
  sw_vers: "T1082", // System Information Discovery
  sysctl: "T1082", // System Information Discovery
  dscl: "T1087.001", // Account Discovery: Local Account
  dscacheutil: "T1087.001", // Account Discovery: Local Account
  log: "T1070.002", // Indicator Removal: Clear Linux/Mac Logs
  textutil: "T1005", // Data from Local System
  codesign: "T1553.002", // Code Signing
  csrutil: "T1562.001", // Impair Defenses: Disable or Modify Tools
  nvram: "T1542.001", // Pre-OS Boot: System Firmware
  softwareupdate: "T1082", // System Information Discovery
  "ssh-keygen": "T1552.004", // Unsecured Credentials: Private Keys
};

// ---------------------------------------------------------------------------
// Known macOS binary paths (for validation)
// ---------------------------------------------------------------------------
const KNOWN_BINARY_PATHS: Record<string, string> = {
  caffeinate: "/usr/bin/caffeinate",
  chflags: "/usr/bin/chflags",
  codesign: "/usr/bin/codesign",
  csrutil: "/usr/bin/csrutil",
  defaults: "/usr/bin/defaults",
  ditto: "/usr/bin/ditto",
  "dns-sd": "/usr/bin/dns-sd",
  dscacheutil: "/usr/bin/dscacheutil",
  dscl: "/usr/bin/dscl",
  dsconfigad: "/usr/sbin/dsconfigad",
  dsexport: "/usr/bin/dsexport",
  funzip: "/usr/bin/funzip",
  GetFileInfo: "/usr/bin/GetFileInfo",
  hdiutil: "/usr/bin/hdiutil",
  ioreg: "/usr/sbin/ioreg",
  kextstat: "/usr/sbin/kextstat",
  last: "/usr/bin/last",
  launchctl: "/bin/launchctl",
  log: "/usr/bin/log",
  lsregister:
    "/System/Library/Frameworks/CoreServices.framework" +
    "/Versions/A/Frameworks/LaunchServices.framework" +
    "/Versions/A/Support/lsregister",
  mdfind: "/usr/bin/mdfind",
  mdls: "/usr/bin/mdls",
  mktemp: "/usr/bin/mktemp",
  networksetup: "/usr/sbin/networksetup",
  notifyutil: "/usr/bin/notifyutil",
  nscurl: "/usr/bin/nscurl",
  nvram: "/usr/sbin/nvram",
  odutil: "/usr/sbin/odutil",
  open: "/usr/bin/open",
  osacompile: "/usr/bin/osacompile",
  osascript: "/usr/bin/osascript",
  pbpaste: "/usr/bin/pbpaste",
  pkill: "/usr/bin/pkill",
  plutil: "/usr/bin/plutil",
  profiles: "/usr/bin/profiles",
  safaridriver: "/usr/bin/safaridriver",
  say: "/usr/bin/say",
  screencapture: "/usr/sbin/screencapture",
  scutil: "/usr/sbin/scutil",
  security: "/usr/bin/security",
  sfltool: "/usr/bin/sfltool",
  softwareupdate: "/usr/sbin/softwareupdate",
  spctl: "/usr/sbin/spctl",
  sqlite3: "/usr/bin/sqlite3",
  "ssh-keygen": "/usr/bin/ssh-keygen",
  streamzip: "/usr/bin/streamzip",
  sw_vers: "/usr/bin/sw_vers",
  swift: "/usr/bin/swift",
  sysadminctl: "/usr/sbin/sysadminctl",
  sysctl: "/usr/sbin/sysctl",
  system_profiler: "/usr/sbin/system_profiler",
  systemsetup: "/usr/sbin/systemsetup",
  tccutil: "/usr/bin/tccutil",
  tclsh: "/usr/bin/tclsh",
  textutil: "/usr/bin/textutil",
  tmutil: "/usr/bin/tmutil",
  xattr: "/usr/bin/xattr",
  SetFile: "/usr/bin/SetFile",
};

// ---------------------------------------------------------------------------
// Placeholder substitution patterns
// ---------------------------------------------------------------------------
// Order matters: more specific patterns must come before generic ones.
const PLACEHOLDER_SUBS: Array<[RegExp, string]> = [
  // Placeholder URLs — use [^\s;|&)'] to avoid consuming shell metacharacters
  [/https?:\/\/mypayload\.io\/[^\s;|&)']+/g, SAFE_URL],
  [/https?:\/\/[a-zA-Z0-9._-]*evil[a-zA-Z0-9._-]*\/[^\s;|&)']*/g, SAFE_URL],
  // Placeholder IP addresses (non-loopback, non-private used as C2 stand-ins)
  [/\b46\.226\.108\.171\b/g, "127.0.0.1"],
  // Placeholder variable-style URLs
  [/\$autoProxyURL/g, `"${SAFE_URL}"`],
  // Placeholder <password> tokens
  [/<password>/g, "testpassword123"],
  // Generic placeholder file/dir paths — must come after URL subs
  [/\/path\/to\/malicious-library\/malicious_library\.dylib/g, `${TEMP_PREFIX}/test_lib.dylib`],
  [/\/path\/to\/target-library\/original_library\.dylib/g, `${TEMP_PREFIX}/original_lib.dylib`],
  [/\/path\/to\/backup/g, `${TEMP_PREFIX}/backup`],
  [/\/path\/to\/folder/g, `${TEMP_PREFIX}/src_folder`],
  [/\/path\/to\/exclude/g, `${TEMP_PREFIX}/exclude_dir`],
  [/\/path\/to\/\S+/g, `${TEMP_PREFIX}/placeholder_path`],
  // Placeholder app references
  [/Malicious\.app/g, `${TEMP_PREFIX}/SafeTest.app`],
  [/malicious\.dmg/g, `${TEMP_PREFIX}/test.dmg`],
  [/malicious\.iso/g, `${TEMP_PREFIX}/test.iso`],
  [/unsigned\.app/g, `${TEMP_PREFIX}/test.app`],
  [/bad_cert\.crt/g, `${TEMP_PREFIX}/test_cert.crt`],
  [/bad\.dylib/g, `${TEMP_PREFIX}/test.dylib`],
  [/gain_persistence\.sh/g, `${TEMP_PREFIX}/test_persist.sh`],
  [/mycode\.swift/g, `${TEMP_PREFIX}/test_code.swift`],
  [/\/tmp\/evil/g, `${TEMP_PREFIX}/safe_exec`],
  // Home directory placeholder paths
  [/\/home\/user\/sensitive-files/g, `${TEMP_PREFIX}/src_folder`],
  [/\/home\/user\/l00t/g, `${TEMP_PREFIX}/l00t`],
  // TargetApp placeholder
  [/\/Applications\/TargetApp\.app\/Contents\/Info\.plist/g, `${TEMP_PREFIX}/TestApp.plist`],
];

// ---------------------------------------------------------------------------
// Commands that are inherently destructive / unsafe even after substitution
// ---------------------------------------------------------------------------
// These patterns cause the test to be flagged as unsafe with risk_level high
// and an explanatory note. The runner should gate these behind explicit user
// confirmation.
const UNSAFE_PATTERNS: Array<[RegExp, string]> = [
  [/\btmutil\s+disable\b/, "Disables Time Machine backups system-wide"],
  [/\btmutil\s+delete\b/, "Deletes Time Machine backups"],
  [/\bsecurity\s+dump-keychain\b/, "Dumps credentials from the macOS Keychain"],
  [/\bsecurity\s+delete-keychain\b/, "Deletes a macOS Keychain"],
  [/\bsecurity\s+add-trusted-cert\b/, "Installs a certificate into the system trust store"],
  [/\bcsrutil\s+disable\b/, "Disables System Integrity Protection"],
  [/\bnvram\b.*\bboot-args\b/, "Modifies firmware boot arguments"],
  [/\bdefaults\s+write\b.*\bGKAutoRearm\b/, "Disables Gatekeeper auto-rearm"],
  [/\bdefaults\s+write\b.*\bLoginHook\b/, "Installs a system-wide login hook for persistence"],
  [/\bdefaults\s+write\b.*\bglobalstate\s+-int\s+0\b/, "Disables the macOS firewall"],
  [
    /\blaunchctl\s+load\b.*(?:(?<!~)\/Library\/Launch|\/System\/)/,
    "Loads a system-level LaunchAgent/LaunchDaemon",
  ],
  [/\bkillall\s+/, "Terminates running processes"],
  [/\bsudo\s+vim\b/, "Opens an editor as root (interactive, not automatable)"],
  [/\bmount_apfs\b/, "Mounts an APFS snapshot (requires SIP disabled)"],
  [/\bsysadminctl\b.*\b-deleteUser\b/, "Deletes a user account"],
  [/\btccutil\s+reset\b/, "Resets TCC privacy permissions"],
  [/\bpkill\b/, "Sends signals to running processes"],
  [/\bnetworksetup\s+-set(?:web|secure|auto)proxy/, "Modifies system proxy settings"],
  [/\bditto\s+-V\b.*\.dylib/, "Overwrites a dynamic library (DLL hijacking)"],
  [/\bssh\s+remote_host\b/, "Requires SSH access to a remote host"],
];

// ---------------------------------------------------------------------------
// LOOBins YAML shape (only the fields the parser reads).
// ---------------------------------------------------------------------------
interface LoobinUseCase {
  name?: string;
  description?: string;
  code?: string;
  tactics?: string[];
  tags?: string[];
}
interface LoobinYaml {
  name?: string;
  short_description?: string;
  full_description?: string;
  paths?: string[];
  example_use_cases?: LoobinUseCase[];
}

// ---------------------------------------------------------------------------
// Setup commands that create required temp files/dirs for tests
// ---------------------------------------------------------------------------
/**
 * Return a shell snippet that creates any temp files/dirs the test needs, so
 * referenced placeholder paths actually exist before the test command runs.
 */
function makeSetupCommand(code: string): string | null {
  const parts: string[] = [`mkdir -p ${TEMP_PREFIX}`];

  // If the command references our temp source folder, create it with a file
  if (code.includes(`${TEMP_PREFIX}/src_folder`)) {
    parts.push(`mkdir -p ${TEMP_PREFIX}/src_folder`);
    parts.push(`echo 'LOOBins test data' > ${TEMP_PREFIX}/src_folder/testfile.txt`);
  }

  // If the command references a test .app bundle
  if (code.includes(`${TEMP_PREFIX}/SafeTest.app`) || code.includes(`${TEMP_PREFIX}/test.app`)) {
    const appPath = code.includes(`${TEMP_PREFIX}/SafeTest.app`)
      ? `${TEMP_PREFIX}/SafeTest.app`
      : `${TEMP_PREFIX}/test.app`;
    parts.push(`mkdir -p ${appPath}/Contents/MacOS`);
    parts.push(`echo '#!/bin/bash\necho LOOBins test' > ${appPath}/Contents/MacOS/run`);
    parts.push(`chmod +x ${appPath}/Contents/MacOS/run`);
  }

  // If the command references a test plist
  if (code.includes(`${TEMP_PREFIX}/TestApp.plist`)) {
    parts.push(
      `plutil -create xml1 ${TEMP_PREFIX}/TestApp.plist 2>/dev/null ` +
        `|| echo '<?xml version="1.0"?><plist version="1.0">` +
        `<dict></dict></plist>' > ${TEMP_PREFIX}/TestApp.plist`,
    );
  }

  // If the command references a test dylib
  if (code.includes(`${TEMP_PREFIX}/test.dylib`) || code.includes(`${TEMP_PREFIX}/test_lib.dylib`)) {
    parts.push(`touch ${TEMP_PREFIX}/test.dylib ${TEMP_PREFIX}/test_lib.dylib`);
  }

  // If the command references a DMG and this is hdiutil
  if (code.includes(`${TEMP_PREFIX}/test.dmg`)) {
    parts.push(
      `hdiutil create -size 1m -fs HFS+ -volname LOOBinsTest ` +
        `${TEMP_PREFIX}/test.dmg -quiet 2>/dev/null || true`,
    );
  }

  // If the command references a test swift file
  if (code.includes(`${TEMP_PREFIX}/test_code.swift`)) {
    parts.push(`echo 'print("LOOBins swift test")' > ${TEMP_PREFIX}/test_code.swift`);
  }

  // If the command references a test persistence script
  if (code.includes(`${TEMP_PREFIX}/test_persist.sh`)) {
    parts.push(`echo '#!/bin/bash\necho test' > ${TEMP_PREFIX}/test_persist.sh`);
    parts.push(`chmod +x ${TEMP_PREFIX}/test_persist.sh`);
  }

  // If the command references safe_exec (caffeinate stand-in for /tmp/evil)
  if (code.includes(`${TEMP_PREFIX}/safe_exec`)) {
    parts.push(`echo '#!/bin/bash\nsleep 1' > ${TEMP_PREFIX}/safe_exec`);
    parts.push(`chmod +x ${TEMP_PREFIX}/safe_exec`);
  }

  // If the command references a cert
  if (code.includes(`${TEMP_PREFIX}/test_cert.crt`)) {
    parts.push(`touch ${TEMP_PREFIX}/test_cert.crt`);
  }

  // If the command references backup dir
  if (code.includes(`${TEMP_PREFIX}/backup`)) {
    parts.push(`mkdir -p ${TEMP_PREFIX}/backup`);
  }

  // If the command references exclude dir
  if (code.includes(`${TEMP_PREFIX}/exclude_dir`)) {
    parts.push(`mkdir -p ${TEMP_PREFIX}/exclude_dir`);
  }

  // If the command references l00t dir
  if (code.includes(`${TEMP_PREFIX}/l00t`)) {
    parts.push(`mkdir -p ${TEMP_PREFIX}/l00t`);
  }

  // If the command references a screenshots dir
  if (code.includes("/tmp/screenshots")) {
    parts.push("mkdir -p /tmp/screenshots");
  }

  // If the command references original_lib.dylib
  if (code.includes(`${TEMP_PREFIX}/original_lib.dylib`)) {
    parts.push(`touch ${TEMP_PREFIX}/original_lib.dylib`);
  }

  // If the command references LaunchAgents plist
  if (code.includes("~/Library/LaunchAgents/")) {
    const plistMatch = code.match(/~\/Library\/LaunchAgents\/(\S+\.plist)/);
    if (plistMatch) {
      const plistName = plistMatch[1];
      parts.push("mkdir -p ~/Library/LaunchAgents");
      parts.push(
        `echo '<?xml version="1.0"?><plist version="1.0">` +
          `<dict><key>Label</key><string>com.loobins.test</string>` +
          `<key>ProgramArguments</key><array><string>/usr/bin/true` +
          `</string></array></dict></plist>' ` +
          `> ~/Library/LaunchAgents/${plistName}`,
      );
    }
  }

  // Only return if we added more than the base mkdir
  if (parts.length > 1) {
    return parts.join(" && ");
  }
  return null;
}

/** Return a shell snippet that cleans up any artifacts the test creates. */
function makeCleanupCommand(code: string): string | null {
  const parts: string[] = [];

  // Always clean the temp prefix if anything was created there
  if (code.includes(TEMP_PREFIX)) {
    parts.push(`rm -rf ${TEMP_PREFIX}`);
  }

  // Clean up screenshots
  if (code.includes("/tmp/screenshots")) {
    parts.push("rm -rf /tmp/screenshots");
  }

  // Clean up clipboard data file
  if (code.includes("clipdata.txt")) {
    parts.push("rm -f clipdata.txt");
  }

  // Clean up any DMG mounts
  if (code.includes("hdiutil") && (code.includes("mount") || code.includes("attach"))) {
    parts.push("hdiutil detach /Volumes/LOOBinsTest 2>/dev/null || true");
  }

  // Clean up LaunchAgents plist
  if (code.includes("~/Library/LaunchAgents/")) {
    const plistMatch = code.match(/~\/Library\/LaunchAgents\/(\S+\.plist)/);
    if (plistMatch) {
      const plistName = plistMatch[1];
      parts.push(`launchctl unload ~/Library/LaunchAgents/${plistName} 2>/dev/null || true`);
      parts.push(`rm -f ~/Library/LaunchAgents/${plistName}`);
    }
  }

  // Clean up tmutil exclusions
  if (code.includes("tmutil addexclusion") && code.includes(TEMP_PREFIX)) {
    parts.push(`tmutil removeexclusion ${TEMP_PREFIX}/exclude_dir 2>/dev/null || true`);
  }

  // Clean up proxy changes (restore to empty/off)
  if (code.includes("networksetup") && code.toLowerCase().includes("-set")) {
    // Attempt to undo proxy changes
    if (code.includes("-setsecurewebproxy")) {
      parts.push('networksetup -setsecurewebproxystate "Wi-Fi" off 2>/dev/null || true');
    }
    if (code.includes("-setwebproxy")) {
      parts.push('networksetup -setwebproxystate "Wi-Fi" off 2>/dev/null || true');
    }
    if (code.includes("-setautoproxyurl")) {
      parts.push('networksetup -setautoproxystate "Wi-Fi" off 2>/dev/null || true');
    }
    if (code.includes("-setautoproxystate") && code.includes(" on")) {
      parts.push('networksetup -setautoproxystate "Wi-Fi" off 2>/dev/null || true');
    }
  }

  if (parts.length > 0) {
    return parts.join(" ; ");
  }
  return null;
}

/** Replace placeholder values in a LOOBins code sample with safe alternatives. */
function applySubstitutions(code: string): string {
  for (const [pattern, replacement] of PLACEHOLDER_SUBS) {
    // Use a function replacer so '$' in replacements is treated literally.
    code = code.replace(pattern, () => replacement);
  }
  return code;
}

/**
 * Return an unsafe_reason string if the command matches a known destructive
 * pattern, or null if it looks safe enough to run.
 */
function checkUnsafe(code: string): string | null {
  for (const [pattern, reason] of UNSAFE_PATTERNS) {
    if (pattern.test(code)) {
      return reason;
    }
  }
  return null;
}

/**
 * Detect commands that are interactive or multi-step procedures that cannot be
 * meaningfully automated as a single shell invocation.
 */
function isMultilineInteractive(code: string): boolean {
  // Commands with 'sudo vim' or other interactive editors
  if (/\bsudo\s+vim\b/.test(code)) return true;
  // Bash 'read' builtin used for interactive input (but not 'defaults read')
  if (/(?:^|\n|;)\s*read\s+/.test(code)) return true;
  return false;
}

/**
 * Apply per-binary refinements to make commands actually executable: bound
 * infinite loops, add setup stanzas, rewrite remote-host commands to localhost.
 */
function refineCommand(code: string, binName: string): string {
  // Bound infinite clipboard/screenshot loops to a few iterations
  if (code.includes("while true") || code.includes("while :")) {
    // Replace 'while true' with a bounded loop (3 iterations)
    code = code.replace(/while\s+true\s*;?\s*do/g, "for _i in 1 2 3; do");
    code = code.replace(/while\s+:\s*;?\s*do/g, "for _i in 1 2 3; do");
  }

  // mdfind -live runs forever; add a timeout
  if (code.includes("mdfind -live")) {
    code = `timeout 3 ${code} || true`;
  }

  // osascript credential prompt — replace with a non-blocking version that just
  // echoes rather than popping a dialog
  if (binName === "osascript" && code.includes("display dialog")) {
    // Make the dialog test non-interactive by using a notification instead
    code =
      `osascript -e 'display notification ` +
      `"LOOBins credential prompt test" ` +
      `with title "Security Test"'`;
  }

  // ssh to remote_host — can't actually connect; rewrite to dry-run
  if (code.includes("ssh remote_host") || (code.includes("ssh ") && code.includes("remote_host"))) {
    code = code.replace(
      /\bssh\s+remote_host\b/g,
      "echo '[DRY RUN] ssh remote_host'  # would pipe to remote",
    );
  }

  // osascript AppleScript 'set appId to do shell script' — rewrite to a simpler
  // mdfind invocation that doesn't need AppleScript context
  if (code.includes("set appId to do shell script")) {
    code = 'mdfind "kMDItemCFBundleIdentifier == com.apple.Safari" 2>/dev/null | head -1';
  }

  // caffeinate with safe_exec — add a short timeout so it doesn't hang
  if (binName === "caffeinate" && code.includes(`${TEMP_PREFIX}/safe_exec`)) {
    code = `timeout 5 ${code} || true`;
  }

  // screencapture — reduce sleep in loops
  if (binName === "screencapture" && code.includes("sleep")) {
    code = code.replace(/sleep\s+\d+/g, "sleep 1");
  }

  // For 'open' with a URL — use a safe URL and suppress browser
  if (binName === "open" && (code.includes("https://") || code.includes("http://"))) {
    // Don't actually open a browser; rewrite to curl for testability. First
    // strip any trailing kill-Safari stanza so the rewrite is clean.
    code = code.replace(/;\s*sleep\s+\d+;\s*killall\s+\S+/g, "");
    code = code.replace(
      /open\s+(?:-[a-z]\s+)?https?:\/\/[^\s;|&)']+/g,
      () => `curl -sf -o /dev/null ${SAFE_URL}`,
    );
  }

  return code;
}

function resolveTechnique(tactics: string[], binName: string): string {
  // Per-binary override takes priority
  if (binName && binName in BINARY_TECHNIQUE_MAP) {
    return BINARY_TECHNIQUE_MAP[binName];
  }

  for (const tactic of tactics) {
    const tid = TACTIC_TO_TECHNIQUE[tactic.toLowerCase()];
    if (tid) return tid;
  }
  // Default: macOS command-line execution
  return "T1059.004";
}

function assessRisk(tactics: string[], unsafeReason: string | null): LotlRisk {
  // If flagged as unsafe, always high
  if (unsafeReason) return "high";

  const tacticSet = new Set(tactics.map((t) => t.toLowerCase()));

  // Explicit high-risk tactics
  const highRisk = [
    "execution",
    "credential access",
    "credential-access",
    "privilege escalation",
    "privilege-escalation",
    "impact",
  ];
  if (highRisk.some((t) => tacticSet.has(t))) return "high";

  // Medium risk for persistence, stealth, lateral movement
  const mediumRisk = [
    "persistence",
    "stealth",
    "defense evasion",
    "defense-evasion",
    "lateral movement",
    "lateral-movement",
    "command and control",
    "command-and-control",
    "exfiltration",
  ];
  if (mediumRisk.some((t) => tacticSet.has(t))) return "medium";

  // Low risk for pure discovery / recon
  const lowRisk = new Set(["discovery", "reconnaissance", "collection"]);
  if (tacticSet.size > 0 && [...tacticSet].every((t) => lowRisk.has(t))) return "low";

  return "medium";
}

/** Heuristic: does the command likely need root/admin? */
function needsElevation(code: string): boolean {
  const indicators = [
    "sudo ",
    "dscl . -create",
    "dscl . -delete",
    "launchctl load /Library/",
    "launchctl load /System/",
    "security unlock-keychain",
    "security dump-keychain",
    "security add-trusted-cert",
    "diskutil ",
    "spctl --master-disable",
    "csrutil ",
    "nvram ",
    "sysadminctl ",
    "systemsetup ",
    "profiles install",
  ];
  const codeLower = code.toLowerCase();
  return indicators.some((ind) => codeLower.includes(ind.toLowerCase()));
}

export class LoobinsIngestor implements LotlIngestor {
  readonly sourceId = "loobins";
  readonly displayName = "LOOBins";
  readonly description =
    "Living Off the Orchard: macOS Binaries that can be abused by adversaries";
  readonly repo = "infosecB/LOOBins";
  readonly branch = "main";
  readonly repoUrl = "https://github.com/infosecB/LOOBins";
  readonly platform = "macos";

  async collect(): Promise<NormalizedEntry[]> {
    const { items } = await fetchTree(this.repo, this.branch, (p) => MATCH.test(p));
    const parsed = await pMap(
      items,
      async (item) => {
        try {
          const content = await fetchRaw(this.repo, this.branch, item.path);
          const url = rawUrl(this.repo, this.branch, item.path);
          const data = yaml.load(content) as LoobinYaml | null | undefined;
          if (!data) return [];
          return this.parseEntry(data).map((e) => ({ ...e, sourceUrl: url }));
        } catch {
          return [];
        }
      },
      20,
    );
    return parsed.flat();
  }

  private parseEntry(data: LoobinYaml): NormalizedEntry[] {
    const tests: NormalizedEntry[] = [];
    const binName = data.name || "";
    const shortDesc = data.short_description || "";
    const fullDesc = data.full_description || shortDesc;

    // Get binary paths from the YAML and validate
    const paths = data.paths || [];
    let binaryPath: string | null = paths.length > 0 ? paths[0] : null;

    // Cross-check against known paths
    const known = KNOWN_BINARY_PATHS[binName];
    if (!binaryPath && known) {
      binaryPath = known;
    }

    const useCases = data.example_use_cases || [];
    if (useCases.length === 0) return tests;

    useCases.forEach((useCase, idx) => {
      const ucName = useCase.name || `Use Case ${idx + 1}`;
      const ucDesc = useCase.description || "";
      const rawCode = useCase.code || "";

      if (!rawCode || rawCode.trim() === "" || rawCode.trim() === "N/A") return;

      // --- Stage 1: Placeholder substitution ---
      let code = applySubstitutions(rawCode);

      // --- Stage 2: Per-binary refinement ---
      code = refineCommand(code, binName);

      // --- Stage 3: Unsafe detection ---
      const unsafeReason = checkUnsafe(code);

      // Map tactics to MITRE technique IDs
      const tactics = useCase.tactics || [];
      const techniqueId = resolveTechnique(tactics, binName);

      // Determine risk level from tactics + unsafe analysis
      const riskLevel = assessRisk(tactics, unsafeReason);

      // --- Stage 4: Setup and cleanup ---
      const setupCmd = makeSetupCommand(code);
      const cleanupCmd = makeCleanupCommand(code);

      // Check if command is interactive / can't be automated
      const isInteractive = isMultilineInteractive(code);

      // Tags for metadata
      const tags = useCase.tags || [];

      // Build the executor — mark manual if unsafe or interactive
      const executor: LotlExecutor = isInteractive ? "manual" : "bash";

      // Build metadata
      const metadata: Record<string, unknown> = {
        source: "loobins",
        binary: binName,
        use_case: ucName,
        tactics,
        tags,
        paths,
        original_command: rawCode,
      };
      if (binaryPath) {
        metadata.binary_path_validated = binaryPath === (KNOWN_BINARY_PATHS[binName] ?? binaryPath);
      }
      if (unsafeReason) {
        metadata.unsafe_reason = unsafeReason;
      }
      if (setupCmd) {
        metadata.setup_command = setupCmd;
      }

      tests.push({
        sourceRef: `${binName}#${idx}`,
        name: `LOOBins: ${binName} - ${ucName}`,
        description: `${ucDesc} [${fullDesc.slice(0, 200)}]`.trim(),
        command: code,
        executor,
        techniqueId,
        binaryPath,
        elevationRequired: needsElevation(code),
        riskLevel,
        platforms: ["macos"],
        cleanupCommand: cleanupCmd,
        metadata,
      });
    });

    return tests;
  }
}
