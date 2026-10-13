/**
 * "Deceptive Delivery & Execution" (ClickFix) — the first Attack Technique
 * Library. A DEFENSIVE knowledge + simulation hub for social-engineering-to-
 * execution tradecraft: ClickFix (T1204.004) and its delivery/obfuscation
 * relatives.
 *
 * Per technique: what-it-is, how-bad-actors-misuse-it, lab-setup resources, the
 * kill-chain, a CURATED set of directly-relevant Atomic Red Team tests for the
 * Simulate leg (we never blind-map every test for an ATT&CK id), and curated
 * DETECTION + MITIGATION guidance. Content is curated from public research
 * (MITRE ATT&CK, ClickGrab/MHaggis, mr.d0x, Red Canary, Jamf, CrowdStrike/
 * Trellix, Kaspersky, Stormshield).
 */

import type { LibraryDef, TechniqueDef } from "@/lib/attack-sim/types";

const CLICKFIX = "ClickFix (copy-paste execution)";
const DELIVERY = "Delivery & Obfuscation";

// Shared mitigations reused across the ClickFix execution family.
const M_BLOCK_WINR = { title: "Block Win+R & remove Run from Start (GPO)", kind: "gpo" as const, mitreId: "M1042", detail: "Enable 'Turn off Windows+X hotkeys'/'Turn off Windows key hotkeys' and 'Remove Run menu from Start Menu' for standard users. Closes the most common ClickFix paste target (disruptive — scope to standard profiles)." };
const M_ASR = { title: "Defender ASR rules (audit → block)", kind: "asr" as const, mitreId: "M1038", detail: "Enable ASR: block obfuscated scripts, Office child processes, executable content from email/web, and credential/PsExec-WMI rules. Roll out in audit, then block. Raises the cost even where the paste succeeds." };
const M_AWARENESS = { title: "User awareness: never paste commands", kind: "awareness" as const, mitreId: "M1017", detail: "Train staff on one simple rule: no legitimate website, CAPTCHA, or document will EVER ask you to open Run/Terminal/File-Explorer and paste a command. This defeats the whole family regardless of lure." };
const M_ALLOWLIST = { title: "Script / LOLBIN constraint", kind: "allowlist" as const, mitreId: "M1038", detail: "PowerShell Constrained Language Mode + WDAC/AppLocker; restrict mshta.exe, finger.exe, and other LOLBINs for standard users." };

const REF_CLICKGRAB = { title: "ClickGrab (MHaggis) — ClickFix/FakeCAPTCHA analyzer + Techniques Library", url: "https://github.com/MHaggis/clickgrab" };
const REF_T1204_004 = { title: "MITRE ATT&CK T1204.004 — User Execution: Malicious Copy and Paste", url: "https://attack.mitre.org/techniques/T1204/004/" };
const REF_REDCANARY_MSHTA = { title: "Red Canary — mshta detection (mshta + http in command line)", url: "https://redcanary.com/threat-detection-report/techniques/mshta/" };

// Lab-setup resources shared by the endpoint-execution ClickFix family.
const LAB_WIN = ["Windows endpoint (the SAR domain controller) as the 'victim'", "Sysmon + PowerShell Script Block logging forwarded to Splunk", "Registry (RunMRU) + process-creation (Sysmon EC1 / Security 4688) telemetry", "Lure/payload hosting is operator-driven and not provisioned by the platform"];

const techniques: TechniqueDef[] = [
  // ───────────────────────── ClickFix execution family ─────────────────────────
  {
    key: "fake-captcha-powershell",
    name: "Fake CAPTCHA → PowerShell cradle",
    category: CLICKFIX, variant: "fake-captcha",
    description: "A fake 'Verify you are human' (Cloudflare-style) page instructs the victim to press Win+R and paste a PowerShell download-cradle. The most common ClickFix lure in the wild (2024–2025).",
    summary: "Fake 'verify you are human' page tricks the user into pasting a PowerShell download-cradle into the Run dialog.",
    abuse: "Mass-malware operators (Lumma/Vidar stealers, DarkGate, NetSupport) replace a fake-CAPTCHA page's clipboard with a hidden PowerShell cradle; the victim pastes it into Win+R and runs it themselves — downloading and executing the stealer/loader while bypassing email and web filters (the lure is plain text).",
    labSetup: LAB_WIN,
    attackTechniques: ["T1204.004", "T1059.001"], tactic: "execution", platforms: ["windows"], severity: "high",
    chainNarrative: [
      "Victim lands on a fake 'Verify you are human' page.",
      "A JS copy-event listener silently replaces the clipboard with a PowerShell download-cradle (the 'pastejacking' primitive — Dylan Ayrey, 2016).",
      "The victim is told to press Win+R and paste+run — populating the RunMRU key.",
      "PowerShell (hidden window + ExecutionPolicy bypass) downloads and IEX-executes the next stage → C2.",
    ],
    atomics: [
      { techniqueId: "T1204.004", why: "The ClickFix copy-paste-via-Run primitive — populates RunMRU and runs the pasted command." },
      { techniqueId: "T1059.001", nameIncludes: ["Invoke-DownloadCradle"], why: "The PowerShell download-cradle the fake-CAPTCHA pastes (NOT the unrelated Mimikatz/BloodHound PowerShell tests)." },
    ],
    simulateNote: "Runs only the ClickFix copy-paste test + the PowerShell download-cradle — the two behaviours this lure actually produces.",
    runnableOnSar: true,
    detection: {
      summary: "The Run dialog records the pasted command in the RunMRU registry key, and PowerShell then spawns with a hidden window + bypass + a download-cradle (IWR/DownloadString → IEX). Either side is a high-fidelity signal.",
      dataSources: ["RunMRU registry (Sysmon EC13)", "Process creation (Sysmon EC1 / 4688)", "PowerShell Script Block (EC4104)", "Network connection (Sysmon EC3)"],
      queries: [
        { format: "spl", title: "RunMRU populated with a command", query: `index=* (EventCode=13 OR source="*Sysmon*") TargetObject="*\\RunMRU\\*" | table _time, host, Details, TargetObject` },
        { format: "spl", title: "PowerShell download-cradle", query: `index=* (Image="*\\powershell.exe" OR process_name=powershell.exe) (CommandLine="*DownloadString*" OR CommandLine="*Invoke-WebRequest*" OR CommandLine="*iwr *") (CommandLine="*IEX*" OR CommandLine="*Invoke-Expression*") | table _time, host, CommandLine` },
        { format: "sigma", title: "Sigma — RunMRU command entry", query: "title: Suspicious RunMRU Command Entry\nlogsource: {product: windows, category: registry_set}\ndetection:\n  sel:\n    TargetObject|contains: '\\\\RunMRU\\\\'\n    Details|contains: ['powershell','mshta','cmd','curl','\\\\\\\\']\n  condition: sel\nlevel: high" },
      ],
    },
    mitigations: [M_BLOCK_WINR, M_ASR, M_ALLOWLIST, M_AWARENESS],
    references: [REF_T1204_004, REF_CLICKGRAB, { title: "Stormshield — the ClickFix technique", url: "https://www.stormshield.com/news/clickfix-technique-growing-cyberthreat/" }, { title: "Pastejacking primitive (Dylan Ayrey, 2016)", url: "https://github.com/dxa4481/Pastejacking" }],
  },
  {
    key: "fake-captcha-mshta",
    name: "Fake CAPTCHA → mshta (HTA over HTTP)",
    category: CLICKFIX, variant: "fake-captcha",
    description: "ClickFix variant whose pasted command calls mshta.exe against a remote HTA URL, which runs script (often spawning a second mshta/PowerShell). Red Canary rates 'mshta + http in the command line' as one of its highest-converting detections.",
    summary: "Pasted command runs mshta.exe against a remote HTA that executes script.",
    abuse: "Actors host a remote .hta and have the victim paste `mshta <url>` via Win+R; mshta (a signed Microsoft LOLBIN) fetches and runs the HTA's JScript/VBScript, often launching PowerShell — a proxy-execution that evades application control.",
    labSetup: LAB_WIN,
    attackTechniques: ["T1204.004", "T1218.005"], tactic: "execution", platforms: ["windows"], severity: "high",
    chainNarrative: [
      "Fake CAPTCHA page copies an `mshta <remote-url>` command to the clipboard.",
      "Victim pastes+runs it via Win+R (RunMRU entry created).",
      "mshta.exe fetches a remote HTA and executes its script, often spawning mshta/PowerShell children → next stage.",
    ],
    atomics: [
      { techniqueId: "T1204.004", why: "The ClickFix copy-paste-via-Run primitive (RunMRU)." },
      { techniqueId: "T1218.005", nameIncludes: ["Remote HTML", "JavaScript Scheme", "Direct download", "Execute PowerShell"], why: "mshta fetching & running a remote HTA — the mshta ClickFix tail (not the UNC/lateral-movement mshta tests)." },
    ],
    simulateNote: "Runs the ClickFix primitive + the remote-HTA mshta tests only.",
    runnableOnSar: true,
    detection: {
      summary: "mshta.exe executing with an http/https URL on its command line is rare and high-signal; pivot on mshta spawning mshta/powershell/cmd children.",
      dataSources: ["Process creation (Sysmon EC1 / 4688)", "RunMRU registry", "Network connection (Sysmon EC3)"],
      queries: [
        { format: "spl", title: "mshta with a remote URL", query: `index=* (Image="*\\mshta.exe" OR process_name=mshta.exe) (CommandLine="*http://*" OR CommandLine="*https://*") | table _time, host, CommandLine, ParentImage` },
        { format: "sigma", title: "Sigma — mshta remote HTA", query: "title: Mshta Executing Remote HTA\nlogsource: {product: windows, category: process_creation}\ndetection:\n  sel:\n    Image|endswith: '\\\\mshta.exe'\n    CommandLine|contains: ['http://','https://']\n  condition: sel\nlevel: high" },
      ],
    },
    mitigations: [M_BLOCK_WINR, M_ASR, { title: "Restrict/disable mshta.exe", kind: "allowlist", mitreId: "M1042", detail: "Block mshta.exe for standard users via WDAC/AppLocker; it has no routine business use on most endpoints." }, M_AWARENESS],
    references: [REF_REDCANARY_MSHTA, REF_T1204_004, REF_CLICKGRAB],
  },
  {
    key: "filefix",
    name: "FileFix (paste into File Explorer address bar)",
    category: CLICKFIX, variant: "filefix",
    description: "mr.d0x's FileFix moves the paste target: a fake file-upload prompt tells the victim to paste a 'file path' into the Explorer address bar. The real command sits in front; a plausible path hides behind a '#' comment, so Explorer runs the command with explorer.exe as parent — slipping past Run-dialog (RunMRU) detections.",
    summary: "Fake file-upload prompt tricks the user into pasting a command into the File Explorer address bar.",
    abuse: "Because the paste target is Explorer (not Run), the command runs with explorer.exe as parent and leaves NO RunMRU entry — actors adopted FileFix specifically to evade the RunMRU-based ClickFix detections defenders deployed.",
    labSetup: LAB_WIN,
    attackTechniques: ["T1204.004", "T1059.001"], tactic: "execution", platforms: ["windows"], severity: "high",
    chainNarrative: [
      "Fake file-upload page tells the victim to paste a 'path' into the File Explorer address bar.",
      "The clipboard holds a command followed by `# <plausible path>` — the shell treats the path as a comment.",
      "Explorer launches the command with explorer.exe as PARENT and NO RunMRU entry — evading Run-dialog detections.",
    ],
    atomics: [
      { techniqueId: "T1204.004", why: "The copy-paste-run primitive. NOTE: for FileFix the paste target is the Explorer address bar, so detect on parent=explorer.exe — RunMRU is absent." },
      { techniqueId: "T1059.001", nameIncludes: ["Invoke-DownloadCradle"], why: "The pasted PowerShell cradle FileFix delivers." },
    ],
    simulateNote: "Runs the copy-paste primitive + the download-cradle; verify your detection keys on parent=explorer.exe, not RunMRU.",
    runnableOnSar: true,
    detection: {
      summary: "Because the paste goes into the Explorer address bar, the parent of the launched shell is explorer.exe and there is NO RunMRU entry. Detect on explorer.exe spawning powershell/cmd/mshta with a download-cradle.",
      dataSources: ["Process creation (parent=explorer.exe)", "PowerShell Script Block"],
      queries: [
        { format: "spl", title: "explorer.exe spawning a shell cradle", query: `index=* ParentImage="*\\explorer.exe" (Image="*\\powershell.exe" OR Image="*\\cmd.exe" OR Image="*\\mshta.exe") (CommandLine="*http*" OR CommandLine="*DownloadString*" OR CommandLine="*IEX*") | table _time, host, ParentImage, CommandLine` },
        { format: "sigma", title: "Sigma — explorer-spawned cradle (FileFix)", query: "title: Explorer Address-Bar Execution (FileFix)\nlogsource: {product: windows, category: process_creation}\ndetection:\n  sel:\n    ParentImage|endswith: '\\\\explorer.exe'\n    Image|endswith: ['\\\\powershell.exe','\\\\cmd.exe','\\\\mshta.exe']\n    CommandLine|contains: ['http','DownloadString','IEX']\n  condition: sel\nlevel: high" },
      ],
    },
    mitigations: [M_ASR, M_ALLOWLIST, M_AWARENESS, { title: "Win+R block does NOT cover FileFix", kind: "awareness", detail: "FileFix uses the Explorer address bar, not Run — disabling Win+R alone is insufficient. Pair with ASR + awareness + parent-process detection." }],
    references: [{ title: "mr.d0x — FileFix", url: "https://mrd0x.com/filefix-clickfix-alternative/" }, REF_T1204_004, REF_CLICKGRAB],
  },
  {
    key: "consentfix",
    name: "ConsentFix (OAuth consent copy-paste)",
    category: CLICKFIX, variant: "consentfix",
    description: "A ClickFix wrapper that steals an OAuth authorization code / consent by having the victim copy it from a fake consent screen and paste it back — handing the attacker a token. Catalogued by ClickGrab's 2026 update.",
    summary: "Fake 'grant access' screen has the user copy & hand over an OAuth authorization code / token.",
    abuse: "Rather than malware, the attacker harvests a cloud OAuth token: the victim copies an 'authorization code' from a spoofed consent page and pastes it back, granting the attacker's app access to mail/files — no password or endpoint execution needed.",
    labSetup: ["Windows endpoint for the copy-paste execution tail", "Entra ID (or IdP) consent + audit logs for the cloud-side detection", "Sysmon / RunMRU telemetry"],
    attackTechniques: ["T1204.004", "T1528"], tactic: "execution", platforms: ["windows"], severity: "medium",
    chainNarrative: [
      "Fake 'grant access to continue' screen prompts the victim to copy an authorization code.",
      "The victim pastes it back (or into a shell), handing over an OAuth token / consent.",
      "Attacker uses the token to access cloud resources (no password needed).",
    ],
    atomics: [
      { techniqueId: "T1204.004", why: "The copy-paste-run primitive. The OAuth-consent token theft itself is cloud-side (detected in Entra ID audit logs, not on the endpoint)." },
    ],
    simulateNote: "Only the copy-paste primitive runs on the endpoint; the consent abuse is validated against identity logs (see Detect).",
    runnableOnSar: true,
    detection: {
      summary: "Watch for OAuth consent to unverified/risky apps and for the copy-paste execution tail. In Entra ID, alert on new consent grants to non-gallery apps; on the endpoint, the RunMRU/PowerShell signals still apply.",
      dataSources: ["Entra ID consent/audit logs", "RunMRU registry", "Process creation"],
      queries: [{ format: "spl", title: "Consent-grant / paste execution tail", query: `index=* (TargetObject="*\\RunMRU\\*" OR (sourcetype=azure:audit operationName="Consent to application")) | table _time, host, user, Details, CommandLine` }],
    },
    mitigations: [{ title: "Restrict user consent to apps", kind: "config", mitreId: "M1018", detail: "In Entra ID, require admin consent for apps / limit user consent to verified publishers + low-risk permissions." }, M_AWARENESS, M_ASR],
    references: [REF_CLICKGRAB, REF_T1204_004],
  },
  {
    key: "dns-clickfix",
    name: "DNS ClickFix (nslookup TXT retrieval)",
    category: CLICKFIX, variant: "dns",
    description: "The pasted command uses nslookup to pull the next-stage payload/command from an attacker TXT record, evading HTTP inspection. Added to ClickGrab's 2026 detections.",
    summary: "Pasted command retrieves the next stage from a DNS TXT record via nslookup (no HTTP).",
    abuse: "To defeat web proxies and HTTP inspection, actors stage the next command/payload in a DNS TXT record; the pasted nslookup query pulls it over DNS and executes it — a covert channel that looks like ordinary name resolution.",
    labSetup: [...LAB_WIN, "DNS query telemetry (Sysmon EC22) for the TXT-retrieval detection"],
    attackTechniques: ["T1204.004", "T1071.004"], tactic: "execution", platforms: ["windows"], severity: "high",
    chainNarrative: [
      "Fake CAPTCHA copies a command that runs nslookup for a TXT record.",
      "nslookup retrieves the next stage/command from the attacker's TXT record (DNS, not HTTP).",
      "The returned content is executed → next stage, with no HTTP download to inspect.",
    ],
    atomics: [
      { techniqueId: "T1204.004", why: "The copy-paste-run primitive. (No on-point nslookup-TXT atomic exists in the local library; the DNS-retrieval step is covered by the Detect guidance below.)" },
    ],
    simulateNote: "The copy-paste primitive runs; score the nslookup-TXT behaviour with the Detect queries.",
    runnableOnSar: true,
    detection: {
      summary: "nslookup.exe spawned by a shell querying TXT records (especially to a non-corporate resolver) right after a RunMRU entry is a strong ClickFix-DNS signal.",
      dataSources: ["Process creation (nslookup.exe)", "RunMRU registry", "DNS query (Sysmon EC22)"],
      queries: [
        { format: "spl", title: "nslookup TXT from a shell", query: `index=* Image="*\\nslookup.exe" (CommandLine="*-type=txt*" OR CommandLine="*-q=txt*") (ParentImage="*\\powershell.exe" OR ParentImage="*\\cmd.exe") | table _time, host, CommandLine, ParentImage` },
        { format: "spl", title: "RunMRU entry abusing nslookup", query: `index=* TargetObject="*\\RunMRU\\*" Details="*nslookup*" | table _time, host, Details` },
      ],
    },
    mitigations: [M_BLOCK_WINR, { title: "Restrict external DNS / monitor TXT", kind: "network", mitreId: "M1037", detail: "Force endpoints to corporate resolvers, block/alert on direct external DNS, and flag unusual TXT queries." }, M_AWARENESS],
    references: [REF_CLICKGRAB, REF_T1204_004],
  },
  {
    key: "finger-clickfix",
    name: "Finger protocol variant (finger.exe)",
    category: CLICKFIX, variant: "finger",
    description: "A ClickFix variant whose pasted command uses the legacy finger.exe (TCP/79) to retrieve and run a payload from the attacker server — an unusual LOLBIN channel.",
    summary: "Pasted command uses the legacy finger.exe (TCP/79) to pull and run the payload.",
    abuse: "Actors abuse finger.exe — an obsolete, signed Windows binary — as an ingress channel over TCP/79, a port rarely watched, piping the server's response to a shell for execution.",
    labSetup: [...LAB_WIN, "Egress to TCP/79 (or detection of the attempt); finger.exe is an optional Windows feature"],
    attackTechniques: ["T1204.004", "T1105"], tactic: "execution", platforms: ["windows"], severity: "medium",
    chainNarrative: [
      "Fake CAPTCHA copies a command invoking the legacy finger.exe.",
      "finger.exe retrieves the next stage over TCP/79 from the attacker server.",
      "The content is piped to a shell and executed.",
    ],
    atomics: [
      { techniqueId: "T1204.004", why: "The copy-paste-run primitive." },
      { techniqueId: "T1105", nameIncludes: ["finger.exe"], why: "finger.exe retrieving a file over TCP/79 — the distinctive ingress channel of this variant." },
    ],
    simulateNote: "Runs the copy-paste primitive + the finger.exe ingress test specifically.",
    runnableOnSar: true,
    detection: {
      summary: "finger.exe has virtually no legitimate modern use; its execution (especially from a shell / with outbound TCP/79) is a near-certain hunt hit.",
      dataSources: ["Process creation (finger.exe)", "Network connection TCP/79", "RunMRU registry"],
      queries: [{ format: "spl", title: "finger.exe execution", query: `index=* (Image="*\\finger.exe" OR process_name=finger.exe) | table _time, host, CommandLine, ParentImage` }, { format: "sigma", title: "Sigma — finger.exe", query: "title: Finger.exe Execution\nlogsource: {product: windows, category: process_creation}\ndetection:\n  sel: {Image|endswith: '\\\\finger.exe'}\n  condition: sel\nlevel: high" }],
    },
    mitigations: [{ title: "Remove/block finger.exe", kind: "allowlist", mitreId: "M1042", detail: "Block finger.exe via WDAC/AppLocker and egress-filter TCP/79; it is obsolete." }, M_BLOCK_WINR, M_AWARENESS],
    references: [{ title: "Kaspersky — ClickFix variations", url: "https://www.kaspersky.com/blog/clickfix-attack-variations/" }, REF_CLICKGRAB],
  },
  {
    key: "webdav-clickfix",
    name: "WebDAV variant (net use → remote script)",
    category: CLICKFIX, variant: "webdav",
    description: "The pasted command mounts an attacker WebDAV share (net use) and runs a batch/script from it — fetching the payload over WebDAV instead of an HTTP download.",
    summary: "Pasted command mounts an attacker WebDAV share and runs a script from it.",
    abuse: "The payload is fetched over WebDAV (UNC-over-HTTP) rather than a plain download, so it never touches the Downloads folder and can evade controls that focus on HTTP file writes.",
    labSetup: [...LAB_WIN, "WebClient (WebDAV) service enabled to observe the mount; UNC-over-HTTP egress"],
    attackTechniques: ["T1204.004", "T1021.002"], tactic: "execution", platforms: ["windows"], severity: "medium",
    chainNarrative: [
      "Fake CAPTCHA copies a `net use` command pointing at an attacker WebDAV (UNC-over-HTTP) share.",
      "The WebClient service mounts the share; a batch/script is executed from it.",
      "Payload runs from the WebDAV path → next stage.",
    ],
    atomics: [
      { techniqueId: "T1204.004", why: "The copy-paste-run primitive. (No on-point WebDAV atomic in the local library; detect the WebClient/UNC-over-HTTP signals below.)" },
    ],
    simulateNote: "The copy-paste primitive runs; score the WebDAV mount with the Detect guidance.",
    runnableOnSar: true,
    detection: {
      summary: "WebDAV client activity (WebClient service, net use to a UNC over HTTP, svchost WebDAV) spawned from a shell after a RunMRU entry indicates WebDAV-based ClickFix delivery.",
      dataSources: ["Process creation (net.exe)", "WebClient/WebDAV network", "RunMRU registry"],
      queries: [{ format: "spl", title: "net use to a WebDAV UNC", query: `index=* Image="*\\net*.exe" CommandLine="*use*" CommandLine="*\\\\*@*" | table _time, host, CommandLine, ParentImage` }],
    },
    mitigations: [{ title: "Disable the WebClient service", kind: "config", mitreId: "M1042", detail: "Set the WebClient (WebDAV) service to Disabled on endpoints that do not need it; blocks UNC-over-HTTP fetches." }, M_BLOCK_WINR, M_AWARENESS],
    references: [REF_CLICKGRAB, REF_T1204_004],
  },
  {
    key: "winx-terminal",
    name: "Win+X → Windows Terminal variant",
    category: CLICKFIX, variant: "winx",
    description: "A ClickFix variant that routes the victim through Win+X → Windows Terminal (PowerShell) instead of Win+R, avoiding the RunMRU artifact while still landing a pasted cradle.",
    summary: "Routes the user through Win+X → Terminal to paste the cradle, avoiding RunMRU.",
    abuse: "By using Terminal instead of Run, the attack produces no RunMRU entry — another evasion of RunMRU-based ClickFix detections; the pasted PowerShell cradle still downloads and runs the payload.",
    labSetup: LAB_WIN,
    attackTechniques: ["T1204.004", "T1059.001"], tactic: "execution", platforms: ["windows"], severity: "medium",
    chainNarrative: [
      "Lure instructs the victim to press Win+X and open Terminal.",
      "The clipboard cradle is pasted into the terminal (no RunMRU entry).",
      "PowerShell downloads + executes the next stage.",
    ],
    atomics: [
      { techniqueId: "T1204.004", why: "The copy-paste-run primitive (here via Terminal — expect NO RunMRU)." },
      { techniqueId: "T1059.001", nameIncludes: ["Invoke-DownloadCradle"], why: "The pasted PowerShell cradle." },
    ],
    simulateNote: "Runs the copy-paste primitive + the download-cradle; detect on WindowsTerminal/wt.exe → powershell parentage.",
    runnableOnSar: true,
    detection: {
      summary: "No RunMRU here — detect on WindowsTerminal/wt.exe → powershell with a download-cradle, and on the cradle itself.",
      dataSources: ["Process creation (parent=WindowsTerminal.exe/wt.exe)", "PowerShell Script Block"],
      queries: [{ format: "spl", title: "Terminal-spawned cradle", query: `index=* (ParentImage="*\\WindowsTerminal.exe" OR ParentImage="*\\wt.exe") Image="*\\powershell.exe" (CommandLine="*iwr*" OR CommandLine="*DownloadString*" OR CommandLine="*IEX*") | table _time, host, CommandLine` }],
    },
    mitigations: [M_BLOCK_WINR, M_ASR, M_ALLOWLIST, M_AWARENESS],
    references: [REF_CLICKGRAB, REF_T1204_004],
  },
  {
    key: "macos-script-editor",
    name: "macOS Script Editor (applescript://)",
    category: CLICKFIX, variant: "macos",
    description: "The macOS ClickFix variant (Jamf Threat Labs, 2025+): the lure uses the applescript:// URL scheme to auto-open Script Editor pre-loaded with a script the victim runs by clicking a button.",
    summary: "macOS lure opens Script Editor via applescript:// with a pre-loaded script the user runs.",
    abuse: "Porting ClickFix to macOS, actors use the applescript:// handler to pop Script Editor pre-filled with a malicious AppleScript; the victim clicks Run, executing it (often fetching a stealer).",
    labSetup: ["A macOS endpoint (not present on the current SAR lab)", "macOS Unified Log / ESF process telemetry"],
    attackTechniques: ["T1204.004", "T1059.002"], tactic: "execution", platforms: ["macos"], severity: "medium",
    chainNarrative: [
      "macOS lure uses an applescript:// URL to open Script Editor with a pre-loaded script.",
      "The victim clicks Run; osascript executes the AppleScript.",
      "The script fetches + runs the next stage (curl/bash).",
    ],
    atomics: [],
    simulateNote: "No macOS endpoint on the current SAR lab — catalogued for detection + mitigation only.",
    runnableOnSar: false,
    detection: {
      summary: "On macOS: Script Editor (osascript / Script Editor.app) launched from a browser URL handler, and osascript spawning curl/bash. Collect Unified Log / ESF process events.",
      dataSources: ["macOS Unified Log / ESF process exec", "osascript / Script Editor launches"],
      queries: [{ format: "sigma", title: "Sigma — osascript via URL handler", query: "title: macOS Script Editor via URL Handler\nlogsource: {product: macos, category: process_creation}\ndetection:\n  sel:\n    Image|contains: ['osascript','Script Editor']\n  condition: sel\nlevel: medium" }],
    },
    mitigations: [{ title: "Restrict URL handlers / Script Editor", kind: "config", detail: "Remove the applescript:// handler for standard users; restrict Script Editor and osascript via MDM/allowlisting." }, M_AWARENESS],
    references: [{ title: "Jamf Threat Labs — macOS ClickFix (Script Editor)", url: "https://www.jamf.com/blog/" }, REF_CLICKGRAB],
  },

  // ───────────────────────── Delivery & Obfuscation ─────────────────────────
  {
    key: "html-smuggling",
    name: "HTML Smuggling (JS Blob file drop)",
    category: DELIVERY, variant: "html-smuggling",
    description: "A benign-looking HTML page rebuilds a payload client-side (Base64 → Blob → URL.createObjectURL → download), smuggling it past network content filters. A common ClickFix delivery front-end. ATT&CK T1027.006.",
    summary: "HTML page rebuilds the payload in the browser (JS Blob) so filters see only benign HTML.",
    abuse: "Used by Qakbot, Pikabot, and many loaders: the payload is Base64-embedded in HTML and reassembled client-side, so email/web gateways pass it; it's often wrapped in an ISO/IMG to strip Mark-of-the-Web.",
    labSetup: [...LAB_WIN, "Browser process + file-creation (Sysmon EC11) telemetry for the Downloads drop"],
    attackTechniques: ["T1027.006"], tactic: "defense-evasion", platforms: ["windows"], severity: "high",
    chainNarrative: [
      "Victim opens an HTML file/page (email attachment or link).",
      "JavaScript decodes an embedded Base64 blob and uses the download attribute to drop a file locally.",
      "Content filters saw only benign HTML; the assembled file (often in an ISO/IMG to strip MOTW) is run.",
    ],
    atomics: [
      { techniqueId: "T1027.006", why: "Assembles & drops a payload client-side via a JS Blob ('HTML Smuggling Remote Payload') — the exact technique." },
    ],
    simulateNote: "Runs the HTML-smuggling atomic; detect on the browser-spawned file write.",
    runnableOnSar: true,
    detection: {
      summary: "The payload is inside the HTML, so inspect the endpoint/browser, not the wire: a browser process writing an executable/archive to Downloads right after loading an HTML doc, and HTML with atob()+createObjectURL()+anchor.click(). ISO/IMG that strip Mark-of-the-Web are a red flag.",
      dataSources: ["Browser-spawned file writes (Sysmon EC11)", "Email/web-gateway HTML attachments", "Downloads folder file creation"],
      queries: [
        { format: "spl", title: "Browser writing a risky file to Downloads", query: `index=* EventCode=11 (Image="*\\chrome.exe" OR Image="*\\msedge.exe" OR Image="*\\firefox.exe") TargetFilename="*\\Downloads\\*" (TargetFilename="*.exe" OR TargetFilename="*.iso" OR TargetFilename="*.img" OR TargetFilename="*.zip" OR TargetFilename="*.hta") | table _time, host, Image, TargetFilename` },
        { format: "sigma", title: "Sigma — HTML smuggling file drop", query: "title: Browser File Drop (HTML Smuggling)\nlogsource: {product: windows, category: file_event}\ndetection:\n  sel:\n    Image|endswith: ['\\\\chrome.exe','\\\\msedge.exe','\\\\firefox.exe']\n    TargetFilename|contains: '\\\\Downloads\\\\'\n    TargetFilename|endswith: ['.exe','.iso','.img','.hta','.zip']\n  condition: sel\nlevel: high" },
      ],
    },
    mitigations: [
      { title: "Remote Browser Isolation (RBI)", kind: "network", mitreId: "M1021", detail: "Render untrusted HTML in an isolated remote container so the file is never assembled on the endpoint." },
      { title: "Block/sandbox HTML attachments", kind: "config", mitreId: "M1049", detail: "Quarantine/sandbox HTML (and ISO/IMG) attachments containing Blob/createObjectURL/large Base64 at the email gateway." },
      M_ALLOWLIST,
      { title: "Keep Mark-of-the-Web intact", kind: "config", detail: "Enforce MOTW handling; block mounting of downloaded ISO/IMG for standard users so Protected View / SmartScreen stay effective." },
    ],
    references: [{ title: "MITRE ATT&CK T1027.006 — HTML Smuggling", url: "https://attack.mitre.org/techniques/T1027/006/" }],
  },
  {
    key: "clickonce-abuse",
    name: "ClickOnce abuse (.appref-ms → dfsvc.exe)",
    category: DELIVERY, variant: "clickonce",
    description: "Microsoft ClickOnce (.application/.appref-ms) delivers and self-updates apps with no admin rights, via trusted dfsvc.exe — abused to run malware as a trusted process (CrowdStrike; the OneClik energy-sector campaign). Tooling: ClickForClickOnce.",
    summary: "Abuses ClickOnce (.appref-ms via trusted dfsvc.exe) to install/run malware with no admin prompt.",
    abuse: "The OneClik campaign (energy sector) used ClickOnce + AppDomainManager injection to run malware as a trusted, self-updating app with AWS-hidden C2 — bypassing mail gateways that don't inspect .application/.appref-ms.",
    labSetup: [...LAB_WIN, "Process telemetry for dfsvc.exe/dfshim.dll and .exe.config writes (AppDomainManager)"],
    attackTechniques: ["T1204.002", "T1574.014"], tactic: "defense-evasion", platforms: ["windows"], severity: "high",
    chainNarrative: [
      "Victim is lured to click an 'Install' link hosting ClickOnce deployment files (.application/.appref-ms).",
      "dfsvc.exe (trusted) downloads and launches the app with no admin prompt; AppDomainManager injection can hijack a benign exe.",
      "Malware runs as a trusted, self-updating ClickOnce app, often with cloud (AWS) C2.",
    ],
    atomics: [],
    simulateNote: "No directly-relevant Atomic Red Team test for ClickOnce/AppDomainManager (T1574.014) in the local library — catalogued for detection + mitigation. Simulate the dfsvc behaviour manually if required.",
    runnableOnSar: false,
    detection: {
      summary: "Hunt dfsvc.exe activity and .application/.appref-ms handling: dfsvc.exe / dfshim.dll launching unusual children, .appref-ms created outside normal app installs, and AppDomainManager config hijacks (.exe.config loading a side-by-side DLL).",
      dataSources: ["Process creation (dfsvc.exe)", ".application/.appref-ms file events", ".exe.config writes (AppDomainManager)"],
      queries: [
        { format: "spl", title: "dfsvc / .appref-ms activity", query: `index=* (Image="*\\dfsvc.exe" OR CommandLine="*.appref-ms*" OR CommandLine="*.application*") | table _time, host, Image, CommandLine, ParentImage` },
        { format: "spl", title: "AppDomainManager .exe.config write", query: `index=* EventCode=11 TargetFilename="*.exe.config" | table _time, host, Image, TargetFilename` },
      ],
    },
    mitigations: [
      { title: "Disable ClickOnce for non-approved apps (GPO)", kind: "gpo", mitreId: "M1042", detail: "Restrict/disable ClickOnce deployment via GPO/endpoint management; treat .application/.appref-ms with the same scrutiny as macros." },
      M_ALLOWLIST,
      { title: "Monitor cloud egress", kind: "network", detail: "OneClik C2 hid in AWS traffic — baseline and alert on anomalous cloud-service callbacks." },
    ],
    references: [
      { title: "CrowdStrike — Abuse of ClickOnce (Part 2)", url: "https://www.crowdstrike.com/en-us/blog/new-abuse-of-the-clickonce-technology-part-two/" },
      { title: "BleepingComputer — OneClik (ClickOnce + AWS, energy sector)", url: "https://www.bleepingcomputer.com/news/security/oneclik-attacks-use-microsoft-clickonce-and-aws-to-target-energy-sector/" },
      { title: "ClickForClickOnce (whokilleddb)", url: "https://github.com/whokilleddb/ClickForClickOnce" },
    ],
  },
  {
    key: "pixelcode",
    name: "PixelCode (pixel/video-encoded payload)",
    category: DELIVERY, variant: "pixelcode",
    description: "A research technique (S3N4T0R, 2025+) that encodes an executable into image/video pixel data hosted on a trusted platform (e.g. YouTube); a loader downloads the media and rebuilds the binary in memory, so scanners see only a valid MP4/image. Obfuscation/ingress analogous to HTML smuggling.",
    summary: "Hides an executable in image/video pixels on a trusted platform; a loader rebuilds it in memory.",
    abuse: "A stealth delivery/obfuscation concept: hosting the encoded payload on YouTube (a universally-allowed domain) lets the loader fetch a 'valid video' that scanners ignore, then reconstruct and run the binary in memory.",
    labSetup: [...LAB_WIN, "EDR with in-memory execution visibility; egress baseline for non-browser media fetches"],
    attackTechniques: ["T1027", "T1105", "T1204.001"], tactic: "defense-evasion", platforms: ["windows"], severity: "medium",
    chainNarrative: [
      "An executable is encoded into the pixels of an image/video and uploaded to a trusted platform.",
      "A loader downloads the media (a valid MP4/image to scanners) and rebuilds the binary in memory.",
      "The reconstructed payload runs in memory → next stage.",
    ],
    atomics: [],
    simulateNote: "No directly-relevant atomic for the pixel-decode loader in the local library — catalogued for detection + mitigation (reference technique).",
    runnableOnSar: false,
    detection: {
      summary: "The file on the wire is a valid media file, so focus on the loader behaviour: a process downloading media from a content platform then reconstructing/executing code in memory (unbacked executable memory, media→script chains), and anomalous outbound to video CDNs from non-browser processes.",
      dataSources: ["Process creation + network (non-browser → video CDN)", "In-memory execution (EDR)", "Script interpreter spawned post-download"],
      queries: [{ format: "spl", title: "Non-browser pulling media", query: `index=* (Image!="*\\chrome.exe" AND Image!="*\\msedge.exe") (CommandLine="*.mp4*" OR CommandLine="*youtube*") | table _time, host, Image, CommandLine` }],
    },
    mitigations: [M_ALLOWLIST, { title: "Egress & memory controls", kind: "edr", detail: "Alert on unbacked/injected executable memory and on non-browser processes fetching from media CDNs; restrict script interpreters." }, { title: "Content-platform egress policy", kind: "network", detail: "Where feasible, constrain direct programmatic access to public video/image hosts from endpoints." }],
    references: [{ title: "Red Hot Cyber — PixelCode (malware hidden in video)", url: "https://www.redhotcyber.com/en/post/when-malware-hides-in-videos-the-pixelcode-technique-breaks-the-rules" }],
  },
  {
    key: "motw-bypass-iso",
    name: "Mark-of-the-Web bypass (ISO/IMG container)",
    category: DELIVERY, variant: "motw",
    description: "Delivering the payload inside an ISO/IMG container: Windows historically did not propagate the Mark-of-the-Web to contents, so Protected View / SmartScreen did not trigger when the user mounted and ran the file. Common pairing with HTML smuggling.",
    summary: "Payload shipped in an ISO/IMG so its contents don't inherit Mark-of-the-Web.",
    abuse: "A near-universal 2022–2024 delivery trick (Qakbot, Bumblebee, IcedID): wrapping the payload in an ISO/IMG meant mounted contents lacked MOTW, so SmartScreen/Protected View stayed silent and the user ran it.",
    labSetup: [...LAB_WIN, "Disk-image mount telemetry; Zone.Identifier (MOTW) visibility"],
    attackTechniques: ["T1553.005"], tactic: "defense-evasion", platforms: ["windows"], severity: "medium",
    chainNarrative: [
      "Payload is delivered inside an ISO/IMG (often via HTML smuggling).",
      "The user mounts the container; contents historically did NOT inherit Mark-of-the-Web.",
      "Protected View / SmartScreen do not trigger → the payload runs.",
    ],
    atomics: [
      { techniqueId: "T1553.005", nameIncludes: ["Mount an ISO", "Remove the Zone.Identifier", "Execute LNK"], why: "Mount an ISO/IMG, strip the Mark-of-the-Web (Zone.Identifier), and run from it — the MOTW-bypass delivery steps." },
    ],
    simulateNote: "Runs the ISO-mount / Zone.Identifier-removal / run-from-ISO tests specifically.",
    runnableOnSar: true,
    detection: {
      summary: "Detect mounting of downloaded ISO/IMG (Explorer/PowerShell Mount-DiskImage) and execution of files from a mounted volume lacking MOTW shortly after a browser download.",
      dataSources: ["Disk-image mount events", "Process execution from mounted volume", "Zone.Identifier (MOTW) absence"],
      queries: [{ format: "spl", title: "ISO/IMG mount + execute", query: `index=* (CommandLine="*Mount-DiskImage*" OR CommandLine="*.iso*" OR CommandLine="*.img*") | table _time, host, Image, CommandLine` }],
    },
    mitigations: [{ title: "Block mounting of downloaded ISO/IMG (GPO)", kind: "gpo", mitreId: "M1042", detail: "Prevent standard users from mounting ISO/IMG; ensure MOTW propagates to container contents (modern Windows)." }, { title: "Keep SmartScreen/Protected View on", kind: "config", detail: "Enforce SmartScreen + Office Protected View so MOTW'd files are gated." }],
    references: [{ title: "MITRE ATT&CK T1553.005 — Mark-of-the-Web Bypass", url: "https://attack.mitre.org/techniques/T1553/005/" }],
  },
  {
    key: "browser-in-the-browser",
    name: "Browser-in-the-Browser (BitB) SSO lure",
    category: DELIVERY, variant: "bitb",
    description: "A fake browser window rendered INSIDE the page (with a spoofed address bar) impersonates a 'Sign in with Microsoft/Google' SSO popup to phish credentials/tokens — defeating URL checks and often paired with AiTM to beat MFA. Published by mr.d0x (2022).",
    summary: "A fake in-page browser window spoofs an SSO popup (with a fake URL bar) to phish credentials.",
    abuse: "Actors render a convincing 'Sign in with Microsoft/Google' popup inside the page with a legitimate-looking URL bar; victims enter credentials/tokens, often relayed via AiTM to beat MFA.",
    labSetup: ["Identity provider (Entra ID/IdP) sign-in + risk telemetry", "No endpoint execution — this is a credential-phishing lure"],
    attackTechniques: ["T1204.001", "T1566.002"], tactic: "credential-access", platforms: ["windows"], severity: "high",
    chainNarrative: [
      "Victim clicks a 'Sign in with Microsoft/Google' button on a malicious page.",
      "A fake browser window (with a spoofed, legitimate-looking URL bar) is drawn inside the page.",
      "Credentials/tokens entered go to the attacker (often relayed via AiTM to beat MFA).",
    ],
    atomics: [],
    simulateNote: "Credential-phishing lure — no endpoint-execution atomic. Catalogued for identity-layer detection + mitigation.",
    runnableOnSar: false,
    detection: {
      summary: "BitB is client-side; detect at the identity layer and via awareness: impossible-travel / new-device sign-ins, AiTM session-cookie reuse, and the fact that a real SSO popup is a separate OS window (can be dragged outside the page) while a BitB one cannot.",
      dataSources: ["Entra ID / IdP sign-in logs", "AiTM session anomalies"],
      queries: [{ format: "spl", title: "Suspicious new-device/geo sign-in", query: `index=* sourcetype=azure:signin (riskLevelAggregated=high OR (status.errorCode=0 deviceDetail.isCompliant=false)) | table _time, user, ipAddress, appDisplayName` }],
    },
    mitigations: [{ title: "Phishing-resistant MFA (FIDO2)", kind: "config", mitreId: "M1032", detail: "FIDO2/passkeys bind the credential to the real origin, defeating BitB + AiTM credential theft." }, M_AWARENESS, { title: "Try to drag the login window", kind: "awareness", detail: "A genuine SSO popup is a real OS window and can be moved outside the page; a BitB fake cannot." }],
    references: [{ title: "mr.d0x — Browser-in-the-Browser", url: "https://mrd0x.com/browser-in-the-browser-phishing-attack/" }],
  },
];

export const CLICKFIX_LIBRARY: LibraryDef = {
  key: "clickfix",
  moduleId: "detectops.clickfix-sim",
  name: "Deceptive Delivery & Execution",
  shortName: "ClickFix",
  category: "deceptive-delivery",
  icon: "MousePointerClick",
  description: "ClickFix (copy-paste execution, T1204.004) and its delivery/obfuscation relatives — per technique: what it is, how it's abused, lab-setup resources, a simulate action running the directly-relevant Atomic Red Team tests, curated detection logic, and attack-surface-reduction guidance.",
  techniques,
};
