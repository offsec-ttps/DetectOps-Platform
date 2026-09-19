/**
 * IRP step templates keyed by tactic family.
 *
 * The detection-pack generator script picks one of these based on the
 * primary technique's `tacticHint`, then customises only the wording with
 * the pack name. Each template produces a fully-formed IrPlaybook:
 *   - summary, L1/L2/L3 (≥3 steps each), Containment, Eradication, Recovery
 *
 * Steps are intentionally generic-but-actionable so they apply across
 * sources/orgs. The Phase-4 IrPlaybookEditor lets the SOC tune them after
 * generation without re-running an LLM.
 */

export interface IrStep {
  order: number;
  title: string;
  action: string;
  expectedFinding: string;
  escalateIf?: string;
  references?: string[];
}

export interface IrPlaybookData {
  summary: string;
  l1Steps: IrStep[];
  l2Steps: IrStep[];
  l3Steps: IrStep[];
  containment: IrStep[];
  eradication: IrStep[];
  recovery: IrStep[];
}

export type TacticFamily =
  | "credential-access" | "execution" | "persistence" | "privilege-escalation"
  | "defense-evasion" | "discovery" | "lateral-movement" | "collection"
  | "command-and-control" | "exfiltration" | "impact" | "initial-access";

function step(order: number, title: string, action: string, expectedFinding: string, escalateIf = "none", references: string[] = []): IrStep {
  return { order, title, action, expectedFinding, escalateIf, references };
}

// ─── Credential Access (LSASS, brute force, dumps, …) ─────────────────────
const CREDENTIAL_ACCESS = (packName: string): IrPlaybookData => ({
  summary: `Credential-access alert (${packName}). Goal: confirm the technique fired, scope which accounts were exposed, rotate any credentials likely in scope, and seal the entry vector before lateral movement.`,
  l1Steps: [
    step(1, "Acknowledge the alert in SIEM", "Pull the originating event (Sysmon EID 1 / EID 10 / 4625 etc.) and note Image, CommandLine, User, ComputerName, ProcessGuid.", "A single matching event with full process context.", "Multiple users / hosts in the same window → escalate L2 immediately."),
    step(2, "Check for legitimate context", "Search change-mgmt / ticketing for any open admin work matching the host within ±15 min. Note vendor EDR sessions.", "No matching ticket OR explicit ticket confirming the activity.", "No ticket and ParentImage is interpreter (powershell / cmd / cscript) → escalate L2."),
    step(3, "Snapshot the affected user's session", "Pull last 4h of Azure AD / Okta sign-ins and Windows logon events (4624) for the alerted user. Capture src IPs, MFA results, app context.", "Sign-in history with no anomalies, or one anomalous sign-in matching the alert window.", "Anomalous geo / impossible travel / new MFA device → escalate L2."),
    step(4, "Open the host's EDR process tree", "Open the host in CrowdStrike / Defender XDR. View the process tree from the offending PID for ±10 min.", "Tree shows the alert process plus expected parent / grandparent.", "Parent is unexpected (winword.exe, outlook.exe, w3wp.exe) → escalate L2."),
  ],
  l2Steps: [
    step(1, "Isolate the host via EDR", "Trigger CrowdStrike RTR network-containment OR Defender for Endpoint isolation API.", "Host shows isolated state in the EDR console within 60s.", "Isolation fails → IT/platform engineering."),
    step(2, "Hunt for the dump / cred artefact", "Run osquery: SELECT path, sha256, size, mtime FROM file WHERE path LIKE '%lsass%dmp' OR path LIKE '%credentials%' OR path LIKE '%hash%'.", "Path of any cred artefact written to disk.", "Artefact found → escalate L3 with chain-of-custody."),
    step(3, "Pivot on the account", "Identify every host the alerted user authenticated to in the last 24h (4624 across the estate). Pull each host's process tree for the same window.", "List of touched hosts; nothing else suspicious OR matching pattern on N hosts.", ">1 host shows the same activity → escalate L3 + initiate org-wide cred rotation."),
    step(4, "Pull EDR alert siblings", "Query EDR for any related (same family, same hash, same parent process) alerts in the past 24h.", "0 siblings (isolated incident) OR N siblings showing campaign.", "Sibling count > 5 → escalate L3."),
    step(5, "Force user MFA re-auth + session revoke", "Revoke active Azure AD / Okta sessions for the user. Force MFA re-enrolment.", "User shows revoked sessions; next sign-in requires MFA.", "User reports unexpected MFA prompts → escalate L3 (likely active session hijack)."),
  ],
  l3Steps: [
    step(1, "Memory acquisition", "Acquire memory image via Volatility / DumpIt / WinPMEM with full chain-of-custody. Hash and store in evidence vault.", "Memory image hashed (sha256), CoC paperwork started, image accessible to forensics team.", "none"),
    step(2, "Identify the credential blast radius", "List every account that authenticated to the host within 72h pre-alert (4624 / 4648). Tag service / privileged accounts.", "List of impacted users + service accounts.", "Domain admin or KRBTGT-scope account exposed → trigger KRBTGT rotation runbook."),
    step(3, "Attribution + IOC extraction", "Extract artefact hashes, persistence indicators, C2 callbacks. Submit to VirusTotal / OpenCTI for attribution context.", "Threat-actor / family attribution with confidence label; new IOCs added to TIP.", "none"),
    step(4, "Detection-rule tuning recommendation", "Document false-positive sources observed and file tuning ticket against the originating Sigma / SPL / KQL rule.", "Tuning ticket created with rule id reference.", "none"),
  ],
  containment: [
    step(1, "Network-isolate the host", "Trigger EDR isolation; block the user account from new auth (disable, not delete).", "Host offline; account auth blocked in IdP.", "none"),
    step(2, "Block IOCs at perimeter", "Push file hashes + C2 IPs/domains to firewall + EDR allow/deny lists.", "Perimeter denies attempts; EDR quarantines matching files.", "none"),
  ],
  eradication: [
    step(1, "Remove persistence", "Hunt + remove scheduled tasks, run keys, service installs, WMI subscriptions created in the alert window.", "No remaining persistence vectors on host (autoruns clean).", "none"),
    step(2, "Rotate exposed credentials", "Force password reset for every account on the impacted-users list. Rotate KRBTGT if domain admin exposure was confirmed.", "All exposed creds rotated; KRBTGT rotation completed if applicable.", "none"),
  ],
  recovery: [
    step(1, "Re-image host", "Wipe + re-image from golden image; restore user profile from clean backup.", "Host re-enrolled clean.", "none"),
    step(2, "Verify telemetry", "Confirm Sysmon + EDR agents reporting on the rebuilt host. Re-test the originating rule fires on a known-good attack simulation.", "Host visible in EDR + SIEM ingest; ART/PurpleSharp test reproduces the alert end-to-end.", "none"),
  ],
});

// ─── Initial Access (phishing, web exploit, valid accounts) ───────────────
const INITIAL_ACCESS = (packName: string): IrPlaybookData => ({
  summary: `Initial-access alert (${packName}). Goal: confirm the entry vector, evict the attacker before they pivot, and close the door (patch, MFA, mail rule).`,
  l1Steps: [
    step(1, "Triage the alert + capture context", "Pull the original event. For email: subject + sender + url + recipient + attachment hash. For web exploit: src IP + URI + UA. For valid accounts: src IP + UA + risk signals.", "All metadata captured for downstream pivot.", "none"),
    step(2, "Determine if the vector succeeded", "Email: did the recipient click / open? Web: did the response code show 200 + suspicious size? Valid account: did the session establish?", "Boolean: vector executed / failed.", "Vector confirmed executed → escalate L2."),
    step(3, "Identify the asset / user touched", "Map the affected host or mailbox + the primary user. Note role / privilege level.", "Asset inventory entry + user profile.", "Privileged user / crown-jewel asset → escalate L2 immediately."),
  ],
  l2Steps: [
    step(1, "Hunt for follow-on activity", "On the affected host: 24h process tree from the entry timestamp. On the mailbox: outbound mail + new mailbox rules. On the cloud account: AAD audit logs.", "Nothing follow-on, OR a clear pivot chain (download → exec → C2).", "Follow-on chain observed → escalate L3."),
    step(2, "Quarantine the vector", "Email: kill via M365 ZAP / GraphAPI. Web: block source IP at WAF / firewall. Valid account: revoke sessions + force MFA.", "Vector blocked; user / host re-protected.", "none"),
    step(3, "Pull EDR similar alerts", "Search EDR + SIEM for the same hash / URL / source across the estate in the last 72h.", "Single isolated incident, OR campaign of N targets.", "Campaign > 5 → escalate L3 + activate incident comms."),
    step(4, "Pivot on the indicator", "Submit any URLs, hashes, domains to TIP. Add to org block-lists. Note threat-actor tags returned.", "Indicator enriched; block applied; intel tagged.", "none"),
  ],
  l3Steps: [
    step(1, "Full host / mailbox acquisition", "Acquire disk + memory image OR mailbox export per legal hold. CoC paperwork.", "Images hashed and stored.", "none"),
    step(2, "Root-cause analysis", "Identify the exact CVE / mail filter gap / IdP misconfig that allowed the vector. Document the failure mode.", "Written RCA with timeline + responsible control.", "none"),
    step(3, "Patch / configuration fix", "File the engineering ticket against the responsible control (WAF rule, IdP CA policy, mail filter). Verify the fix prevents recurrence in a test.", "Engineering work item open with target ship date.", "none"),
    step(4, "Lessons learned", "Run a 30-min post-mortem with detection eng + IR. Update playbook + add a new detection if a gap surfaced.", "Post-mortem doc + tuning ticket(s) filed.", "none"),
  ],
  containment: [
    step(1, "Block the vector", "WAF / firewall rule, email block, IdP block — kill the entry path.", "Vector denied at perimeter / in transit.", "none"),
    step(2, "Isolate affected asset", "Host EDR isolation OR user session revocation.", "Asset offline / user signed out everywhere.", "none"),
  ],
  eradication: [
    step(1, "Clean the asset", "Remove dropped payloads, persistence, mailbox rules.", "Asset fingerprint matches clean baseline.", "none"),
    step(2, "Patch the root cause", "Apply the patch / config change identified in L3.", "Patch verified in scanner; vulnerability re-scan clean.", "none"),
  ],
  recovery: [
    step(1, "Re-enable user / asset", "Lift isolation; re-enable user with forced MFA. Communicate to user.", "User operational with no recurrence.", "none"),
    step(2, "Verify the closure", "Re-run the original entry vector in a test environment. Confirm it now fails.", "Vector blocked; alert does not fire.", "none"),
  ],
});

// ─── Execution (PowerShell, scripting, exploitation execution) ────────────
const EXECUTION = (packName: string): IrPlaybookData => ({
  summary: `Code-execution alert (${packName}). Goal: confirm intent (malicious vs. admin), prevent next-stage payload, isolate if intent is confirmed.`,
  l1Steps: [
    step(1, "Capture command-line + parent chain", "Note Image, CommandLine, ParentImage, ParentCommandLine, IntegrityLevel. Decode any base64 if present.", "Command line decoded; intent assessable.", "Command line contains C2 indicators, lateral movement tools, or post-ex tooling → escalate L2."),
    step(2, "Verify the user / context", "Map user → role. Check change-mgmt for a matching activity window. If interpreter spawned from outlook/winword/w3wp/explorer, it's almost certainly malicious.", "Legitimate admin context OR confirmed unexpected interpreter spawn.", "Unexpected spawn → escalate L2."),
    step(3, "Run the command line through a sandbox / decoder", "If PowerShell is encoded, decode via Cyberchef / PSDecode. If JScript / VBS, walk the AST. Note any network IOCs.", "Decoded payload or AST with clear intent.", "Payload contains shellcode / C2 / cred-dump tooling → escalate L2 + isolate."),
  ],
  l2Steps: [
    step(1, "Isolate the host", "EDR network containment.", "Host offline.", "none"),
    step(2, "Hunt for next-stage payload", "On the host: search Temp + AppData for files written by the offending process. EDR: pull next 5 minutes of process tree.", "Empty / clean tree OR found next-stage binary.", "Next-stage binary found → escalate L3."),
    step(3, "Hunt the IOC across the estate", "If decoded payload includes a URL / IP / hash, pivot across EDR + DNS + firewall for matches.", "Single host, OR sibling matches found.", "Sibling matches → escalate L3 + activate incident."),
    step(4, "User comms", "Reach the user out-of-band (call, not email/IM). Confirm whether they ran something matching the command line.", "User awareness OR denial.", "User unaware → confirms compromise; escalate L3."),
  ],
  l3Steps: [
    step(1, "Memory acquisition", "Volatility-grade memory image with CoC.", "Image hashed + stored.", "none"),
    step(2, "Reverse the payload", "Identify second-stage capabilities (cred theft, persistence, lat-mov, encryption). Map to ATT&CK.", "Capability matrix documented.", "Capabilities include cred theft → run credential-access containment playbook in parallel."),
    step(3, "Hunt for attacker-implanted accounts / persistence", "Check for newly-created users, scheduled tasks, services, registry run keys in last 7 days.", "Persistence inventory.", "Persistence found → eradication step adjustments."),
  ],
  containment: [
    step(1, "Host isolation", "EDR network containment.", "Host offline.", "none"),
    step(2, "Block payload sources", "Block dropper URL / IP at proxy + firewall.", "Calls fail.", "none"),
  ],
  eradication: [
    step(1, "Remove dropped artefacts", "Delete files + registry entries + scheduled tasks from L3 inventory.", "Autoruns + filesystem clean.", "none"),
    step(2, "Rotate credentials touched", "Reset any user / service account that authenticated during the window.", "Creds rotated.", "none"),
  ],
  recovery: [
    step(1, "Re-image", "Re-image from golden; restore profile from clean backup.", "Host re-enrolled.", "none"),
    step(2, "Reproduce + verify", "Run an ART test for the matching technique against the rebuilt host. Confirm rule fires.", "ART test reproduces the alert.", "none"),
  ],
});

// ─── Persistence (run keys, web shells, scheduled tasks, …) ───────────────
const PERSISTENCE = (packName: string): IrPlaybookData => ({
  summary: `Persistence alert (${packName}). Goal: confirm the mechanism is attacker-installed, remove it, harden against re-install.`,
  l1Steps: [
    step(1, "Capture the persistence artefact", "Note the registry key / file path / scheduled task / WMI subscription. Capture the binary's path + hash.", "Artefact identified with full path.", "none"),
    step(2, "Check for install context", "EDR process tree: what wrote the artefact? When? Under which user?", "Writing process + parent chain identified.", "Writing process is unexpected (interpreter, LOLBAS) → escalate L2."),
    step(3, "Hash check", "Submit the binary hash to VirusTotal / EDR cloud. Note signer.", "Hash known-benign OR known-malicious OR unknown.", "Unknown hash + interpreter parent → escalate L2."),
  ],
  l2Steps: [
    step(1, "Hunt for siblings", "Search the estate for the same artefact (path / hash / scheduled-task name).", "Isolated incident OR campaign.", "Campaign → escalate L3."),
    step(2, "Hunt for pre-install activity", "EDR: 1h before artefact write. Look for dropper / loader / exploit chain.", "Pre-install chain found OR no signal (live-off-the-land).", "Exploit chain found → escalate L3 + initial-access containment."),
    step(3, "Determine attacker dwell", "Earliest evidence of the artefact across the estate.", "Dwell time established (hours / days / weeks).", "Dwell > 7 days → escalate L3 + activate full IR."),
  ],
  l3Steps: [
    step(1, "Full image acquisition", "Disk + memory image, CoC.", "Images hashed + stored.", "none"),
    step(2, "Reverse the persistence binary", "Static + dynamic analysis. Identify C2, capabilities, dependencies.", "Capability matrix + IOCs.", "none"),
    step(3, "Audit similar persistence locations across the estate", "Hunt every registry run key, scheduled task, service of unknown provenance org-wide.", "Inventory of additional unmanaged persistence.", "Additional unmanaged persistence found → eradicate."),
  ],
  containment: [
    step(1, "Isolate affected hosts", "EDR isolation.", "Hosts offline.", "none"),
    step(2, "Block the binary + C2", "Push hash + C2 IPs to EDR + firewall.", "Block in place.", "none"),
  ],
  eradication: [
    step(1, "Remove the artefact", "Delete the registry value / file / scheduled task / WMI subscription. Verify with autoruns.", "Persistence vector removed.", "none"),
    step(2, "Audit related accounts", "Service accounts used by the artefact: rotate creds.", "Creds rotated.", "none"),
  ],
  recovery: [
    step(1, "Re-image where dwell is uncertain", "Hosts where attacker dwell exceeds 48h: re-image from golden.", "Re-imaged hosts re-enrolled.", "none"),
    step(2, "Add the persistence vector to detection", "Push a tuning ticket: detect this exact persistence vector at install time, not after.", "Tuning ticket filed; new rule shipped.", "none"),
  ],
});

// ─── Defense Evasion (LOLBAS, obfuscation, side-loading, injection) ───────
const DEFENSE_EVASION = (packName: string): IrPlaybookData => ({
  summary: `Defense-evasion alert (${packName}). Goal: confirm the evasion was used to mask malicious activity, identify the masked activity, contain.`,
  l1Steps: [
    step(1, "Capture the evasion technique used", "Note the binary (regsvr32 / mshta / rundll32 / signed driver), the arguments, and the parent process.", "Technique + arguments + parent identified.", "Parent is interpreter / Office app / w3wp.exe → escalate L2."),
    step(2, "Check for legitimate context", "Is this on a build agent / dev box where MSBuild use is normal? Is the signer a known vendor?", "Yes / No.", "No legitimate context → escalate L2."),
    step(3, "Inspect the proxy target / loaded DLL", "If LOLBAS argument has a URL: probe it (safely, from sandbox). If DLL: check path + signer.", "Target classified.", "Target hosts script or unsigned DLL from user path → escalate L2."),
  ],
  l2Steps: [
    step(1, "Isolate the host", "EDR isolation.", "Host offline.", "none"),
    step(2, "Identify the masked activity", "The evasion technique exists to hide something. Pull EDR for child processes, file writes, network connections in next 10 minutes.", "Identified masked downstream activity.", "Downstream activity includes cred dump / lateral movement / C2 → escalate L3 + run matching playbook in parallel."),
    step(3, "Hash + binary lookup", "If a binary is involved, hash + look up. Reverse-engineer if novel.", "Classification.", "Novel malware → escalate L3."),
  ],
  l3Steps: [
    step(1, "Memory image", "Volatility-grade memory image, CoC.", "Image hashed.", "none"),
    step(2, "Reverse engineering", "Reverse the payload OR the loaded DLL. Identify capabilities + C2.", "Capability matrix + IOCs.", "none"),
    step(3, "Detect the evasion technique earlier", "File a tuning ticket: catch this exact LOLBAS / driver-load / obfuscation pattern at first occurrence, not after downstream pivots.", "Tuning ticket filed.", "none"),
  ],
  containment: [
    step(1, "Isolate", "EDR isolation.", "Host offline.", "none"),
    step(2, "Block payload + C2", "Hash + IP block.", "Block in place.", "none"),
  ],
  eradication: [
    step(1, "Remove dropped files + persistence", "Walk L3's IOC list. Delete each.", "Filesystem + autoruns clean.", "none"),
    step(2, "Rotate any account that ran the binary", "Service / user accounts associated.", "Creds rotated.", "none"),
  ],
  recovery: [
    step(1, "Re-image", "Re-image from golden if confidence in cleanup is < 95%.", "Host re-enrolled.", "none"),
    step(2, "Add LOLBAS-specific telemetry", "If a logsource gap was identified, file a logging-coverage ticket.", "Ticket filed; coverage gap closed.", "none"),
  ],
});

// ─── Command & Control (beacons, non-standard ports) ──────────────────────
const COMMAND_AND_CONTROL = (packName: string): IrPlaybookData => ({
  summary: `C2 alert (${packName}). Goal: confirm the channel is attacker-controlled, sever it, identify the implant.`,
  l1Steps: [
    step(1, "Snapshot the connection", "src host / src process / dst IP / dst port / TLS SNI / JA3 / first-seen / count / bytes.", "Connection fingerprint captured.", "Dst IP is known-bad in TIP / VT → escalate L2 immediately."),
    step(2, "Check the src process", "EDR: what process initiated? When? Signed?", "Process identified.", "Unsigned / interpreter src process → escalate L2."),
    step(3, "Check destination reputation", "VT + TIP lookup on IP / domain / cert.", "Reputation result.", "Malicious / suspicious → escalate L2."),
  ],
  l2Steps: [
    step(1, "Isolate the host", "EDR isolation. Block dst IP at firewall.", "Host offline; dst denied.", "none"),
    step(2, "Pivot on the channel", "Search EDR + DNS + proxy for ANY other host calling the same dst. Repeat for related infrastructure (same /24, same cert, same JA3).", "Single host OR multiple.", "Multiple → escalate L3 + activate incident."),
    step(3, "Inspect the implant", "Hash the calling binary. EDR-extract. Reverse if novel.", "Implant identified.", "Novel implant → escalate L3."),
  ],
  l3Steps: [
    step(1, "Acquire + reverse", "Memory image + binary extraction. Reverse for C2 cmd set + persistence + lateral capabilities.", "Capability matrix + IOCs.", "none"),
    step(2, "Hunt the campaign", "Sweep estate for the implant family by hash, persistence, behaviour.", "Campaign size estimated.", "none"),
    step(3, "Update perimeter blocks", "Push all attacker infrastructure (IPs, domains, certs, JA3) to perimeter denylist.", "Blocks in place.", "none"),
  ],
  containment: [
    step(1, "Cut the channel", "Firewall + EDR + DNS blocks.", "Implant can no longer reach C2.", "none"),
    step(2, "Isolate the affected hosts", "EDR isolation across the campaign-affected hosts.", "Hosts offline.", "none"),
  ],
  eradication: [
    step(1, "Remove the implant", "Delete the binary + persistence. Confirm autoruns clean.", "Hosts clean.", "none"),
    step(2, "Rotate creds", "Anything touched by the implant.", "Creds rotated.", "none"),
  ],
  recovery: [
    step(1, "Re-image", "Re-image from golden where the implant ran.", "Hosts re-enrolled.", "none"),
    step(2, "Add C2 detection earlier", "File detection ticket: catch the JA3 / beacon pattern at first-occurrence.", "Tuning shipped.", "none"),
  ],
});

// ─── Impact (ransomware, destruction) ─────────────────────────────────────
const IMPACT = (packName: string): IrPlaybookData => ({
  summary: `Impact-stage alert (${packName}) — likely encryption / destruction in progress. Goal: STOP the bleeding immediately, then identify scope and recover.`,
  l1Steps: [
    step(1, "Confirm the impact alert (FAST)", "Verify the alert is impact-stage and not an FP (e.g. backup tool, dev environment). DO NOT wait for full triage — escalate L2 in parallel.", "Confirmed impact event.", "ALWAYS escalate L2 immediately on impact alerts."),
    step(2, "Identify the affected hosts (parallel to L2 isolation)", "Pull the EDR event stream. List every host showing the impact pattern (mass rename / write).", "Host inventory growing in real time.", "Any DC / file server in scope → escalate L3 + activate IR comms."),
  ],
  l2Steps: [
    step(1, "Isolate ALL affected hosts NOW", "EDR mass-isolate. Do not wait for L1 to finish. Aim < 60s per host.", "Hosts offline.", "Isolation fails on N hosts → engage platform engineering immediately."),
    step(2, "Cut off shared storage", "Disable affected file shares. Block any SMB / NFS write from the source ranges.", "Shares isolated.", "none"),
    step(3, "Pivot to the implant", "EDR: identify the encrypting binary (hash, path, parent). Block + delete cluster-wide.", "Binary identified + blocked.", "none"),
    step(4, "Confirm scope", "Final count of affected hosts + estimated data volume. Notify IR + leadership + legal.", "Reported scope.", "Scope > 50 hosts OR crown-jewel data → activate full IR comms (legal, comms, exec)."),
  ],
  l3Steps: [
    step(1, "Image acquisition (selective)", "Memory + disk image on 2-3 representative hosts. CoC.", "Images hashed.", "none"),
    step(2, "Reverse the ransomware", "Identify family, key handling, network exfil. Check for free decryptors.", "Family + decryptor availability.", "Decryptor exists → use it; skip rebuild."),
    step(3, "Coordinate with legal + comms + exec", "Insurance notification. Breach disclosure clock starts now.", "Notifications sent per policy.", "none"),
  ],
  containment: [
    step(1, "Total host isolation", "Every affected + adjacent host.", "All offline.", "none"),
    step(2, "Block C2 + payment infra", "Push every attacker IOC to perimeter.", "Blocks live.", "none"),
  ],
  eradication: [
    step(1, "Wipe and rebuild", "All affected hosts → re-image from golden. NO selective cleanup for impact events.", "Hosts rebuilt.", "none"),
    step(2, "Rotate all creds + KRBTGT × 2", "Every account that authenticated to affected hosts in 30 days prior. KRBTGT rotation × 2 with the required delay.", "Cred rotation complete.", "none"),
  ],
  recovery: [
    step(1, "Restore from clean backup", "Restore data from backups predating the earliest implant evidence. Verify integrity.", "Data restored; checksums match expected baseline.", "Backups also affected → escalate to decryptor / pay decision per legal."),
    step(2, "Phased reconnection", "Reconnect rebuilt hosts in waves. EDR + telemetry verified per wave.", "Production restored in waves with no recurrence.", "none"),
    step(3, "Post-incident review", "Full PIR within 14 days. Identify the initial-access vector that allowed this and patch it.", "PIR doc published. Root-cause fixed.", "none"),
  ],
});

// ─── Generic / fallback ───────────────────────────────────────────────────
const GENERIC = (packName: string): IrPlaybookData => ({
  summary: `Alert for ${packName}. Goal: confirm intent, scope blast radius, contain if confirmed, document for tuning.`,
  l1Steps: [
    step(1, "Capture context", "Pull the originating event + minute-context around it.", "Event metadata captured.", "Any high-confidence malicious indicator → escalate L2."),
    step(2, "Check legitimate context", "Tickets / change-mgmt / vendor activity.", "Match or no match.", "No legitimate context → escalate L2."),
    step(3, "Check for sibling events", "Same actor / process / IP in last 4h.", "Isolated or pattern.", "Pattern → escalate L2."),
  ],
  l2Steps: [
    step(1, "Open EDR process tree", "Walk the parent chain + children for 10 min.", "Tree captured.", "Tree includes interpreter / LOLBAS / network beacon → escalate L3."),
    step(2, "Isolate if intent unclear", "EDR isolation pending L3 review.", "Host offline.", "none"),
    step(3, "Pivot across estate", "Search for the indicator pattern org-wide.", "Single or campaign.", "Campaign → escalate L3."),
  ],
  l3Steps: [
    step(1, "Forensic acquisition", "Memory + relevant disk slices.", "Images hashed.", "none"),
    step(2, "Root cause + IOC extraction", "Identify the entry vector + extract IOCs to TIP.", "RCA + IOCs.", "none"),
    step(3, "Tuning recommendation", "File a tuning ticket against the originating rule.", "Ticket filed.", "none"),
  ],
  containment: [
    step(1, "Isolate", "Host isolation if compromise confirmed.", "Host offline.", "none"),
  ],
  eradication: [
    step(1, "Remove artefacts", "Persistence + dropped files from L3 inventory.", "Host clean.", "none"),
  ],
  recovery: [
    step(1, "Verify + reconnect", "EDR + telemetry verified. Re-enable.", "Operational.", "none"),
  ],
});

const BY_FAMILY: Record<TacticFamily, (n: string) => IrPlaybookData> = {
  "credential-access":  CREDENTIAL_ACCESS,
  "initial-access":     INITIAL_ACCESS,
  "execution":          EXECUTION,
  "persistence":        PERSISTENCE,
  "privilege-escalation": PERSISTENCE, // reuse persistence shape — same response loop
  "defense-evasion":    DEFENSE_EVASION,
  "discovery":          GENERIC,
  "lateral-movement":   GENERIC,
  "collection":         GENERIC,
  "command-and-control": COMMAND_AND_CONTROL,
  "exfiltration":       COMMAND_AND_CONTROL, // exfil response mirrors C2 — cut the channel, scope
  "impact":             IMPACT,
};

export function pickIrPlaybook(tacticHint: TacticFamily, packName: string): IrPlaybookData {
  return (BY_FAMILY[tacticHint] || GENERIC)(packName);
}
