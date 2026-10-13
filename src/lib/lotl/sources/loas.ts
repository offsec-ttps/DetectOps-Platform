/**
 * LOAS ingestor — Living Off Apple Systems (Living Off the Orchard: AppleScript).
 * Ported from magicsword-io/Magic-Atomics backend/app/ingestion/loas.py.
 *
 * Source: https://github.com/cyberbuff/loas — one YAML technique file per MITRE
 * ATT&CK technique under yaml/<TID>/. Each documented test becomes up to three
 * self-contained, executable macOS prevention tests:
 *
 *   1. osascript CLI — runs the AppleScript/JXA directly (tests TCC/Automation).
 *   2. Swift-compiled binary — embeds the script via NSAppleScript/OSAKit and
 *      runs an unsigned, quarantined binary (tests Gatekeeper/code-signing).
 *   3. osacompile applet (.app) — AppleScript only (tests Gatekeeper quarantine
 *      & notarization).
 *
 * Every generated command analyzes its own output to report ALLOWED vs BLOCKED
 * and cleans up its artifacts. Unlike the Python original (which git-clones the
 * repo), collect() fetches the YAML over the GitHub tree + raw APIs.
 */

import yaml from "js-yaml";
import type { LotlIngestor } from "../base";
import type { NormalizedEntry, LotlRisk } from "../types";
import { fetchTree, fetchRaw, pMap, rawUrl } from "../github";

// MITRE ATT&CK technique metadata (verbatim from the Python _TECHNIQUE_META).
const TECHNIQUE_META: Record<string, { tactic: string; risk: string; name: string }> = {
  T1005: { tactic: "Collection", risk: "high", name: "Data from Local System" },
  T1010: { tactic: "Discovery", risk: "low", name: "Application Window Discovery" },
  "T1016.001": { tactic: "Discovery", risk: "low", name: "Internet Connection Discovery" },
  T1018: { tactic: "Discovery", risk: "low", name: "Remote System Discovery" },
  T1033: { tactic: "Discovery", risk: "low", name: "System Owner/User Discovery" },
  "T1056.002": { tactic: "Credential Access", risk: "high", name: "GUI Input Capture" },
  T1057: { tactic: "Discovery", risk: "medium", name: "Process Discovery" },
  "T1059.002": { tactic: "Execution", risk: "high", name: "AppleScript" },
  "T1059.004": { tactic: "Execution", risk: "high", name: "Unix Shell" },
  "T1070.002": { tactic: "Defense Evasion", risk: "high", name: "Clear Linux or Mac System Logs" },
  "T1070.009": { tactic: "Defense Evasion", risk: "medium", name: "Clear Persistence" },
  T1082: { tactic: "Discovery", risk: "low", name: "System Information Discovery" },
  T1083: { tactic: "Discovery", risk: "medium", name: "File and Directory Discovery" },
  "T1087.001": { tactic: "Discovery", risk: "medium", name: "Local Account Discovery" },
  T1113: { tactic: "Collection", risk: "high", name: "Screen Capture" },
  T1115: { tactic: "Collection", risk: "medium", name: "Clipboard Data" },
  T1120: { tactic: "Discovery", risk: "low", name: "Peripheral Device Discovery" },
  T1123: { tactic: "Collection", risk: "high", name: "Audio Capture" },
  T1124: { tactic: "Discovery", risk: "low", name: "System Time Discovery" },
  T1217: { tactic: "Discovery", risk: "medium", name: "Browser Information Discovery" },
  T1489: { tactic: "Impact", risk: "high", name: "Service Stop" },
  "T1491.001": { tactic: "Impact", risk: "medium", name: "Internal Defacement" },
  "T1518.001": { tactic: "Discovery", risk: "low", name: "Security Software Discovery" },
  T1529: { tactic: "Impact", risk: "high", name: "System Shutdown/Reboot" },
  T1539: { tactic: "Credential Access", risk: "high", name: "Steal Web Session Cookie" },
  "T1547.015": { tactic: "Persistence", risk: "high", name: "Login Items" },
  "T1552.003": { tactic: "Credential Access", risk: "high", name: "Bash History" },
  "T1564.003": { tactic: "Defense Evasion", risk: "medium", name: "Hidden Window" },
  "T1614.001": { tactic: "Discovery", risk: "low", name: "System Language Discovery" },
};

// macOS security controls each tactic exercises (verbatim _SECURITY_CONTROL_MAP).
const SECURITY_CONTROL_MAP: Record<string, string> = {
  Execution: "TCC (Transparency Consent & Control), Gatekeeper, XProtect",
  "Credential Access": "TCC, Keychain Access controls, Password AutoFill protections",
  Collection: "TCC (Screen Recording, Microphone, Accessibility), Privacy preferences",
  Persistence: "TCC (Login Items), SIP (System Integrity Protection)",
  Impact: "TCC (System Events), SIP, Endpoint Security framework",
  "Defense Evasion": "SIP, Endpoint Security framework, TCC",
  Discovery: "TCC (Automation), Endpoint Security telemetry",
};

interface LoasTestEntry {
  name?: string;
  guid?: string;
  language?: string;
  description?: string;
  command?: string;
  tcc_required?: boolean;
  elevation_required?: boolean;
  args?: Record<string, unknown> | null;
  references?: unknown[] | null;
}
interface LoasYaml {
  name?: string;
  tests?: LoasTestEntry[] | null;
}

/** Mimics Python textwrap.dedent (whitespace-only lines normalized, common
 *  leading whitespace removed). */
function dedent(text: string): string {
  text = text.replace(/^[ \t]+$/gm, "");
  const matches = text.match(/^[ \t]*(?=[^ \t\n])/gm);
  let margin: string | null = null;
  if (matches) {
    for (const indent of matches) {
      if (margin === null) margin = indent;
      else if (indent.startsWith(margin)) continue;
      else if (margin.startsWith(indent)) margin = indent;
      else {
        let i = 0;
        const n = Math.min(margin.length, indent.length);
        while (i < n && margin[i] === indent[i]) i++;
        margin = margin.slice(0, i);
      }
    }
  }
  if (margin) {
    const esc = margin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp("^" + esc, "gm"), "");
  }
  return text;
}

function pyBool(b: boolean): string {
  return b ? "True" : "False";
}

function pyStr(v: unknown): string {
  if (v === true) return "True";
  if (v === false) return "False";
  if (v === null || v === undefined) return "None";
  return String(v);
}

/** Substitute #{argName} placeholders with their default argument values. */
function resolveArgs(command: string, args: Record<string, unknown>): string {
  let result = command;
  for (const [argName, defaultValue] of Object.entries(args)) {
    const placeholder = `#{${argName}}`;
    result = result.split(placeholder).join(pyStr(defaultValue));
  }
  return result;
}

/** Convert a test name into a safe filename component. */
function safeFilename(name: string): string {
  let safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  safe = safe.replace(/_+/g, "_");
  return safe.slice(0, 80).replace(/^_+|_+$/g, "").toLowerCase();
}

/** File extension for a script language. */
function scriptExt(language: string): string {
  return language.toLowerCase() === "javascript" ? "js" : "scpt";
}

function buildOsascriptCommand(
  script: string,
  language: string,
  testName: string,
  techniqueId: string,
  tccRequired: boolean,
  elevationRequired: boolean,
): string {
  const langFlag = language.toLowerCase() === "javascript" ? "JavaScript" : "AppleScript";
  const raw = `
            #!/bin/bash
            # === Magic-Atomics LOAS Prevention Test ===
            # Test: ${testName}
            # Technique: ${techniqueId}
            # Language: ${langFlag}
            # TCC Required: ${pyBool(tccRequired)}
            # Elevation Required: ${pyBool(elevationRequired)}
            # Security Surface: osascript CLI execution
            # ==========================================

            WORK_DIR="\${TMPDIR:-/tmp}/magic-atomics-loas/${techniqueId}"
            mkdir -p "$WORK_DIR"

            SCRIPT_FILE="$WORK_DIR/${safeFilename(testName)}.${scriptExt(langFlag)}"

            cat > "$SCRIPT_FILE" << 'LOAS_SCRIPT_EOF'
            ${script}
            LOAS_SCRIPT_EOF

            echo "[*] LOAS Test: ${testName}"
            echo "[*] Technique: ${techniqueId} (${langFlag})"
            echo "[*] Executing via osascript..."
            echo ""

            # Execute the script via osascript
            OUTPUT=$(osascript -l ${langFlag} "$SCRIPT_FILE" 2>&1)
            EXIT_CODE=$?

            echo "[*] osascript exit code: $EXIT_CODE"
            echo "[*] Output: $OUTPUT"
            echo ""

            # Analyze the result to determine if security controls intervened
            if [ $EXIT_CODE -ne 0 ]; then
                # Check for TCC denial patterns
                if echo "$OUTPUT" | grep -qi -e "not allowed" -e "not permitted" \\
                    -e "access denied" -e "assistive access" \\
                    -e "System Events got an error" -e "Application isn't running" \\
                    -e "execution error" -e "not allowed assistive" \\
                    -e "osascript is not allowed" -e "not authorized" \\
                    -e "requires user consent" -e "tccutil" \\
                    -e "operation not permitted" -e "sandbox" \\
                    -e "deny mach-lookup"; then
                    echo "[RESULT] BLOCKED - macOS security controls prevented this technique"
                    echo "[DETAIL] TCC/Privacy controls denied access"
                    exit 0
                fi
                # Check for Endpoint Security / policy blocks
                if echo "$OUTPUT" | grep -qi -e "blocked" -e "quarantine" \\
                    -e "malware" -e "XProtect" -e "Gatekeeper" \\
                    -e "not trusted" -e "security policy"; then
                    echo "[RESULT] BLOCKED - Endpoint security prevented execution"
                    exit 0
                fi
                echo "[RESULT] ERROR - Script failed but not due to security controls"
                echo "[DETAIL] Exit code: $EXIT_CODE"
                exit 1
            else
                echo "[RESULT] ALLOWED - Technique executed successfully"
                echo "[DETAIL] macOS security controls did NOT prevent this technique"
                echo "[ACTION] Review TCC/Privacy settings and endpoint security policies"
                exit 0
            fi`;
  return dedent(raw.slice(1));
}

function buildSwiftCommand(
  script: string,
  language: string,
  testName: string,
  techniqueId: string,
): string {
  const swiftEscapedScript = script
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  const safeName = safeFilename(testName);
  let swiftSource: string;
  if (language.toLowerCase() === "javascript") {
    swiftSource = dedent((`
import Foundation
import OSAKit

let script = "${swiftEscapedScript}"
let lang = OSALanguage(forName: "JavaScript")
let osa = OSAScript(source: script, language: lang!)
var errorInfo: NSDictionary?
let result = osa.executeAndReturnError(&errorInfo)
if let error = errorInfo {
    fputs("Error: \\\\(error)\\n", stderr)
    exit(1)
}
if let val = result?.stringValue {
    print(val)
}`).slice(1));
  } else {
    swiftSource = dedent((`
import Foundation

let script = "${swiftEscapedScript}"
let appleScript = NSAppleScript(source: script)
var errorInfo: NSDictionary?
let result = appleScript?.executeAndReturnError(&errorInfo)
if let error = errorInfo {
    let errMsg = error[NSAppleScript.errorMessage] as? String ?? "Unknown error"
    fputs("Error: \\\\(errMsg)\\n", stderr)
    exit(1)
}
if let val = result?.stringValue {
    print(val)
}`).slice(1));
  }
  const raw = `
            #!/bin/bash
            # === Magic-Atomics LOAS Prevention Test (Swift Binary) ===
            # Test: ${testName}
            # Technique: ${techniqueId}
            # Execution: Swift-compiled binary (unsigned/ad-hoc)
            # Security Surface: Gatekeeper, code-signing, Endpoint Security
            # ==========================================================

            WORK_DIR="\${TMPDIR:-/tmp}/magic-atomics-loas/${techniqueId}"
            mkdir -p "$WORK_DIR"

            SWIFT_FILE="$WORK_DIR/${safeName}_swift.swift"
            BINARY="$WORK_DIR/${safeName}_swift_bin"

            echo "[*] LOAS Test: ${testName} [Swift Binary]"
            echo "[*] Technique: ${techniqueId}"
            echo "[*] Writing Swift source..."

            cat > "$SWIFT_FILE" << 'LOAS_SWIFT_EOF'
            ${swiftSource}
            LOAS_SWIFT_EOF

            # Compile the Swift wrapper
            echo "[*] Compiling Swift binary (ad-hoc signed)..."
            COMPILE_OUTPUT=$(swiftc -o "$BINARY" "$SWIFT_FILE" -framework Foundation 2>&1)
            COMPILE_EXIT=$?

            if [ $COMPILE_EXIT -ne 0 ]; then
                echo "[*] Swift compilation failed: $COMPILE_OUTPUT"
                # Check if swiftc is available
                if ! command -v swiftc &>/dev/null; then
                    echo "[RESULT] SKIPPED - Xcode Command Line Tools not installed (swiftc not found)"
                    echo "[ACTION] Install with: xcode-select --install"
                    exit 0
                fi
                echo "[RESULT] ERROR - Swift compilation failed"
                exit 1
            fi

            echo "[*] Binary compiled: $BINARY"
            echo "[*] Binary size: $(stat -f%z "$BINARY" 2>/dev/null || echo unknown) bytes"

            # Set the quarantine attribute to simulate a downloaded binary
            # This triggers Gatekeeper checks on execution
            xattr -w com.apple.quarantine "0083;$(printf '%08x' $(date +%s));Magic-Atomics;$(uuidgen)" "$BINARY" 2>/dev/null

            echo "[*] Quarantine attribute set (triggers Gatekeeper)"
            echo "[*] Executing compiled binary..."
            echo ""

            # Execute the compiled binary
            OUTPUT=$("$BINARY" 2>&1)
            EXIT_CODE=$?

            echo "[*] Binary exit code: $EXIT_CODE"
            echo "[*] Output: $OUTPUT"
            echo ""

            if [ $EXIT_CODE -ne 0 ]; then
                if echo "$OUTPUT" | grep -qi -e "not allowed" -e "not permitted" \\
                    -e "access denied" -e "execution error" \\
                    -e "not authorized" -e "sandbox" \\
                    -e "killed" -e "abort" -e "quarantine"; then
                    echo "[RESULT] BLOCKED - macOS security controls prevented the compiled binary"
                    echo "[DETAIL] Gatekeeper/code-signing/TCC enforcement active"
                    exit 0
                fi
                # Check if the process was killed by Endpoint Security
                if [ $EXIT_CODE -eq 137 ] || [ $EXIT_CODE -eq 126 ] || [ $EXIT_CODE -eq 9 ]; then
                    echo "[RESULT] BLOCKED - Process killed by Endpoint Security or Gatekeeper"
                    exit 0
                fi
                echo "[RESULT] ERROR - Binary execution failed (not a security block)"
                exit 1
            else
                echo "[RESULT] ALLOWED - Unsigned binary executed AppleScript successfully"
                echo "[DETAIL] Gatekeeper did NOT prevent unsigned binary execution"
                echo "[ACTION] Review Gatekeeper settings (spctl --status) and code-signing policies"
                exit 0
            fi`;
  return dedent(raw.slice(1));
}

function buildAppletCommand(
  script: string,
  testName: string,
  techniqueId: string,
): string {
  const safeName = safeFilename(testName);
  const raw = `
            #!/bin/bash
            # === Magic-Atomics LOAS Prevention Test (Applet) ===
            # Test: ${testName}
            # Technique: ${techniqueId}
            # Execution: osacompile .app bundle
            # Security Surface: Gatekeeper quarantine, notarization, XProtect
            # =====================================================

            WORK_DIR="\${TMPDIR:-/tmp}/magic-atomics-loas/${techniqueId}"
            mkdir -p "$WORK_DIR"

            SCRIPT_FILE="$WORK_DIR/${safeName}_applet.applescript"
            APP_BUNDLE="$WORK_DIR/${safeName}.app"

            echo "[*] LOAS Test: ${testName} [Applet]"
            echo "[*] Technique: ${techniqueId}"
            echo "[*] Writing AppleScript source..."

            cat > "$SCRIPT_FILE" << 'LOAS_APPLET_EOF'
            ${script}
            LOAS_APPLET_EOF

            # Remove any prior build
            rm -rf "$APP_BUNDLE"

            # Compile into an .app bundle
            echo "[*] Compiling .app bundle via osacompile..."
            COMPILE_OUTPUT=$(osacompile -o "$APP_BUNDLE" "$SCRIPT_FILE" 2>&1)
            COMPILE_EXIT=$?

            if [ $COMPILE_EXIT -ne 0 ]; then
                echo "[*] osacompile failed: $COMPILE_OUTPUT"
                echo "[RESULT] ERROR - Failed to compile applet"
                exit 1
            fi

            echo "[*] App bundle created: $APP_BUNDLE"

            # Set quarantine attribute to simulate a downloaded .app
            xattr -w com.apple.quarantine "0083;$(printf '%08x' $(date +%s));Magic-Atomics;$(uuidgen)" "$APP_BUNDLE" 2>/dev/null

            # Also quarantine the inner binary
            INNER_BIN="$APP_BUNDLE/Contents/MacOS/applet"
            if [ -f "$INNER_BIN" ]; then
                xattr -w com.apple.quarantine "0083;$(printf '%08x' $(date +%s));Magic-Atomics;$(uuidgen)" "$INNER_BIN" 2>/dev/null
            fi

            echo "[*] Quarantine attribute set (triggers Gatekeeper)"
            echo "[*] Launching applet..."
            echo ""

            # Attempt to open the applet — this triggers Gatekeeper
            # Use 'open' command which goes through LaunchServices (real Gatekeeper path)
            OUTPUT=$(open -W -a "$APP_BUNDLE" 2>&1)
            EXIT_CODE=$?

            echo "[*] Applet exit code: $EXIT_CODE"
            echo "[*] Output: $OUTPUT"
            echo ""

            # Also check if Gatekeeper or spctl would block it
            echo "[*] Checking Gatekeeper assessment..."
            SPCTL_OUTPUT=$(spctl --assess --type execute "$APP_BUNDLE" 2>&1)
            SPCTL_EXIT=$?

            echo "[*] spctl result: $SPCTL_OUTPUT (exit: $SPCTL_EXIT)"

            if [ $SPCTL_EXIT -ne 0 ] || [ $EXIT_CODE -ne 0 ]; then
                if echo "$OUTPUT $SPCTL_OUTPUT" | grep -qi -e "not allowed" \\
                    -e "rejected" -e "quarantine" -e "Gatekeeper" \\
                    -e "unidentified developer" -e "damaged" \\
                    -e "not opened" -e "can't be opened" \\
                    -e "cannot be opened" -e "malicious software" \\
                    -e "not from an identified" -e "security policy" \\
                    -e "from an unidentified developer" \\
                    -e "Apple cannot check it"; then
                    echo "[RESULT] BLOCKED - Gatekeeper prevented the unsigned applet"
                    echo "[DETAIL] Quarantine enforcement and/or notarization check active"
                    exit 0
                fi
                if echo "$SPCTL_OUTPUT" | grep -qi "rejected"; then
                    echo "[RESULT] BLOCKED - spctl rejected the applet"
                    exit 0
                fi
                echo "[RESULT] ERROR - Applet failed but not clearly a security block"
                exit 1
            else
                echo "[RESULT] ALLOWED - Unsigned .app bundle executed successfully"
                echo "[DETAIL] Gatekeeper did NOT block the quarantined applet"
                echo "[ACTION] Check Gatekeeper status: spctl --status"
                echo "[ACTION] Verify quarantine enforcement: defaults read com.apple.LaunchServices LSQuarantine"
                exit 0
            fi`;
  return dedent(raw.slice(1));
}

function buildCleanupCommand(techniqueId: string, testName: string, mode: string): string {
  const safeName = safeFilename(testName);
  const workDir = `\${TMPDIR:-/tmp}/magic-atomics-loas/${techniqueId}`;
  if (mode === "osascript") {
    return `rm -f "${workDir}/${safeName}.scpt" "${workDir}/${safeName}.js" 2>/dev/null; echo "[*] Cleaned up osascript artifacts"`;
  } else if (mode === "swift") {
    return `rm -f "${workDir}/${safeName}_swift.swift" "${workDir}/${safeName}_swift_bin" 2>/dev/null; echo "[*] Cleaned up Swift binary artifacts"`;
  } else if (mode === "applet") {
    return `rm -rf "${workDir}/${safeName}.app" "${workDir}/${safeName}_applet.applescript" 2>/dev/null; echo "[*] Cleaned up applet artifacts"`;
  }
  return `rm -rf "${workDir}" 2>/dev/null; echo "[*] Cleaned up LOAS test artifacts"`;
}

export class LoasIngestor implements LotlIngestor {
  readonly sourceId = "loas";
  readonly displayName = "LOAS";
  readonly description =
    "Living Off Apple Systems: macOS offensive techniques using AppleScript/JXA with multiple execution methods (osascript, Swift-compiled, applets) mapped to MITRE ATT&CK";
  readonly repo = "cyberbuff/loas";
  readonly branch = "main";
  readonly repoUrl = "https://github.com/cyberbuff/loas";
  readonly platform = "macos";

  async collect(): Promise<NormalizedEntry[]> {
    const MATCH = /^yaml\/T[^/]*\/[^/]+\.ya?ml$/;
    const { items } = await fetchTree(this.repo, this.branch, (p) => MATCH.test(p));
    // Mirror the Python walk order: technique dirs sorted, then .yaml before .yml.
    items.sort((a, b) => {
      const [, da, fa] = a.path.split("/");
      const [, db, fb] = b.path.split("/");
      if (da !== db) return da < db ? -1 : 1;
      const ra = fa.endsWith(".yaml") ? 0 : 1;
      const rb = fb.endsWith(".yaml") ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return fa < fb ? -1 : fa > fb ? 1 : 0;
    });
    const parsed = await pMap(
      items,
      async (item) => {
        try {
          const content = await fetchRaw(this.repo, this.branch, item.path);
          const data = yaml.load(content) as LoasYaml | undefined;
          if (!data) return [];
          const techniqueId = item.path.split("/")[1];
          const url = rawUrl(this.repo, this.branch, item.path);
          return this.parseTechnique(data, techniqueId).map((e) => ({ ...e, sourceUrl: url }));
        } catch {
          return [];
        }
      },
      20,
    );
    return parsed.flat();
  }

  private parseTechnique(data: LoasYaml, techniqueId: string): NormalizedEntry[] {
    const tests: NormalizedEntry[] = [];
    const techniqueName = data.name ?? techniqueId;
    const testEntries = data.tests ?? [];
    if (!testEntries || testEntries.length === 0) return tests;

    const meta = TECHNIQUE_META[techniqueId] ?? {};
    const tactic = (meta as { tactic?: string }).tactic ?? "Execution";
    const baseRisk = ((meta as { risk?: string }).risk ?? "medium") as LotlRisk;

    for (const entry of testEntries) {
      const testName = entry.name ?? "";
      const guid = entry.guid ?? "";
      const language = entry.language ?? "AppleScript";
      const description = entry.description ?? "";
      const command = entry.command ?? "";
      const tccRequired = entry.tcc_required ?? false;
      const elevationRequired = entry.elevation_required ?? false;
      const args = (entry.args ?? {}) as Record<string, unknown>;
      const references = (entry.references ?? []) as unknown[];

      if (!command || !command.trim()) continue;

      const resolvedCommand = resolveArgs(command, args);

      let riskLevel: LotlRisk = baseRisk;
      if (elevationRequired) riskLevel = "high";
      else if (tccRequired && riskLevel === "low") riskLevel = "medium";

      const securityControls = SECURITY_CONTROL_MAP[tactic] ?? "macOS Endpoint Security";

      const commonMeta = {
        source: "loas",
        guid,
        language,
        technique_name: techniqueName,
        tactic,
        tcc_required: tccRequired,
        references,
        original_args: args,
        security_controls_tested: securityControls,
      };

      // Variant 1: osascript CLI execution.
      tests.push({
        sourceRef: `${techniqueId}:${guid}:osascript`,
        name: `LOAS: ${testName} [osascript]`,
        description: `[${techniqueName}] ${description} | Execution: osascript CLI | Security controls tested: ${securityControls}`,
        command: buildOsascriptCommand(resolvedCommand, language, testName, techniqueId, tccRequired, elevationRequired),
        executor: "bash",
        techniqueId,
        binaryPath: "/usr/bin/osascript",
        elevationRequired,
        riskLevel,
        platforms: ["macos"],
        cleanupCommand: buildCleanupCommand(techniqueId, testName, "osascript"),
        metadata: { ...commonMeta, execution_mode: "osascript" },
      });

      // Variant 2: Swift-compiled binary.
      tests.push({
        sourceRef: `${techniqueId}:${guid}:swift-binary`,
        name: `LOAS: ${testName} [swift-binary]`,
        description: `[${techniqueName}] ${description} | Execution: Swift-compiled binary (tests Gatekeeper code-signing enforcement) | Security controls tested: Gatekeeper, ${securityControls}`,
        command: buildSwiftCommand(resolvedCommand, language, testName, techniqueId),
        executor: "bash",
        techniqueId,
        binaryPath: null,
        elevationRequired,
        riskLevel: "high",
        platforms: ["macos"],
        cleanupCommand: buildCleanupCommand(techniqueId, testName, "swift"),
        metadata: { ...commonMeta, execution_mode: "swift_binary" },
      });

      // Variant 3: osacompile applet (.app bundle) — AppleScript only.
      if (language.toLowerCase() === "applescript" || language.toLowerCase() === "") {
        tests.push({
          sourceRef: `${techniqueId}:${guid}:applet`,
          name: `LOAS: ${testName} [applet]`,
          description: `[${techniqueName}] ${description} | Execution: osacompile .app bundle (tests Gatekeeper quarantine & notarization) | Security controls tested: Gatekeeper, XProtect, ${securityControls}`,
          command: buildAppletCommand(resolvedCommand, testName, techniqueId),
          executor: "bash",
          techniqueId,
          binaryPath: null,
          elevationRequired,
          riskLevel: "high",
          platforms: ["macos"],
          cleanupCommand: buildCleanupCommand(techniqueId, testName, "applet"),
          metadata: { ...commonMeta, execution_mode: "applet" },
        });
      }
    }

    return tests;
  }
}
