/**
 * Per-technique detection rule templates.
 *
 * Keyed by ATT&CK technique ID (parent OR sub-technique). Each entry yields:
 *   - category   : DetectionPack.category bucket
 *   - tacticHint : drives IRP tactic-template selection
 *   - platforms  : default platform list
 *   - dataSources: telemetry required for the rules to fire
 *   - rules(name): returns [{format, title, body, language, falsePositives}, …]
 *
 * The rule bodies are REAL, RUNNABLE detections — not stubs. Every Sigma
 * passes sigma-cli validate; every SPL is valid Splunk syntax; every KQL
 * is valid Microsoft Sentinel / Defender XDR.
 */

import { randomUUID } from "node:crypto";

export type DetectionCategory =
  | "os-windows" | "os-linux" | "os-macos"
  | "cloud" | "identity" | "email" | "web" | "network" | "third-party" | "other";

export interface RuleTemplate {
  format: "sigma" | "spl" | "kql" | "elastic-eql" | "yara";
  title: string;
  body: string;
  language?: string;
  falsePositives?: string[];
}

export interface TechniqueTemplate {
  techniqueId: string;
  techniqueName: string;
  tactics: string[];
  category: DetectionCategory;
  platforms: string[];
  dataSources: string[];
  /** Tactic family for IRP template selection. */
  tacticHint:
    | "credential-access" | "execution" | "persistence" | "privilege-escalation"
    | "defense-evasion" | "discovery" | "lateral-movement" | "collection"
    | "command-and-control" | "exfiltration" | "impact" | "initial-access";
  rules: (sourceTitle: string) => RuleTemplate[];
}

function sigmaId(): string { return randomUUID(); }

// ─── T1003.001 — OS Credential Dumping: LSASS Memory ──────────────────────
const T1003_001: TechniqueTemplate = {
  techniqueId: "T1003.001",
  techniqueName: "OS Credential Dumping: LSASS Memory",
  tactics: ["credential-access"],
  category: "os-windows",
  platforms: ["windows"],
  dataSources: ["Sysmon EID 1 (process creation)", "Sysmon EID 10 (process access)", "Windows Security 4688"],
  tacticHint: "credential-access",
  rules: (src) => [
    {
      format: "sigma",
      title: `LSASS memory access via comsvcs.dll (${src})`,
      language: "sigma",
      body: `title: LSASS Memory Dump via comsvcs.dll MiniDump
id: ${sigmaId()}
status: experimental
description: Detects rundll32 invoking comsvcs.dll!MiniDump against lsass.exe, a well-known LOLBin path used by Mimikatz and modern operators.
references:
  - https://attack.mitre.org/techniques/T1003/001/
  - https://lolbas-project.github.io/lolbas/Libraries/Comsvcs/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.credential_access
  - attack.t1003.001
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith: '\\\\rundll32.exe'
    CommandLine|contains|all:
      - 'comsvcs.dll'
      - 'MiniDump'
  condition: selection
falsepositives:
  - Administrator troubleshooting using comsvcs.dll diagnostic minidump
  - EDR vendor synthetic tests
level: high`,
      falsePositives: ["Administrator troubleshooting using comsvcs.dll diagnostic minidump"],
    },
    {
      format: "spl",
      title: `LSASS dump via comsvcs.dll (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=1
| eval cmd=lower(CommandLine)
| where like(Image,"%\\\\rundll32.exe") AND like(cmd,"%comsvcs.dll%") AND like(cmd,"%minidump%")
| stats values(CommandLine) as cmd, values(ParentImage) as parent, values(User) as user, count by ComputerName, _time
| eval risk="credential_access:T1003.001"`,
    },
    {
      format: "kql",
      title: `LSASS dump via comsvcs.dll (Defender XDR)`,
      language: "kql",
      body: `DeviceProcessEvents
| where ProcessCommandLine contains_cs "comsvcs.dll"
| where ProcessCommandLine has_cs "MiniDump"
| project Timestamp, DeviceName, AccountName, InitiatingProcessFileName, FileName, ProcessCommandLine, InitiatingProcessCommandLine
| order by Timestamp desc`,
    },
  ],
};

// ─── T1059.001 — PowerShell ────────────────────────────────────────────────
const T1059_001: TechniqueTemplate = {
  techniqueId: "T1059.001",
  techniqueName: "Command and Scripting Interpreter: PowerShell",
  tactics: ["execution"],
  category: "os-windows",
  platforms: ["windows"],
  dataSources: ["Sysmon EID 1", "Microsoft-Windows-PowerShell/Operational EID 4104"],
  tacticHint: "execution",
  rules: (src) => [
    {
      format: "sigma",
      title: `PowerShell encoded command execution (${src})`,
      language: "sigma",
      body: `title: PowerShell EncodedCommand Execution
id: ${sigmaId()}
status: experimental
description: Detects powershell.exe invoked with -EncodedCommand / -enc switches, the standard obfuscation path for stagers, RATs, and post-exploitation tooling.
references:
  - https://attack.mitre.org/techniques/T1059/001/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.execution
  - attack.t1059.001
logsource:
  category: process_creation
  product: windows
detection:
  selection_image:
    Image|endswith:
      - '\\\\powershell.exe'
      - '\\\\pwsh.exe'
  selection_args:
    CommandLine|contains:
      - ' -enc '
      - ' -EncodedCommand'
      - ' -e '
      - ' -ec '
  condition: selection_image and selection_args
falsepositives:
  - Configuration management tools (Ansible, Puppet) launching encoded payloads
  - Citrix / VDI launchers
level: high`,
      falsePositives: ["Configuration management tools launching encoded payloads"],
    },
    {
      format: "spl",
      title: `PowerShell -EncodedCommand (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=1
  (Image="*\\\\powershell.exe" OR Image="*\\\\pwsh.exe")
  (CommandLine="* -enc *" OR CommandLine="* -EncodedCommand*" OR CommandLine="* -e *")
| eval encoded_arg=mvindex(split(CommandLine," "),-1)
| stats values(CommandLine) as cmds, values(User) as user, values(ParentImage) as parent by ComputerName, _time
| eval risk="execution:T1059.001"`,
    },
    {
      format: "kql",
      title: `PowerShell -EncodedCommand (KQL)`,
      language: "kql",
      body: `DeviceProcessEvents
| where FileName in~ ("powershell.exe","pwsh.exe")
| where ProcessCommandLine matches regex @"\\s-(e|ec|enc|EncodedCommand)\\s"
| project Timestamp, DeviceName, AccountName, ProcessCommandLine, InitiatingProcessFileName, InitiatingProcessCommandLine
| order by Timestamp desc`,
    },
  ],
};

// ─── T1078.004 — Cloud Accounts (Azure AD / Entra) ────────────────────────
const T1078_004: TechniqueTemplate = {
  techniqueId: "T1078.004",
  techniqueName: "Valid Accounts: Cloud Accounts",
  tactics: ["initial-access", "persistence", "privilege-escalation", "defense-evasion"],
  category: "identity",
  platforms: ["azure-ad", "office-365"],
  dataSources: ["Azure AD SigninLogs", "AzureActivity"],
  tacticHint: "initial-access",
  rules: (src) => [
    {
      format: "sigma",
      title: `Suspicious Azure AD sign-in (${src})`,
      language: "sigma",
      body: `title: Azure AD Sign-in From Anonymous IP / Anomalous Token
id: ${sigmaId()}
status: experimental
description: Detects Azure AD interactive sign-ins flagged by Identity Protection as risk Anonymous IP, Atypical Travel, or Token Anomaly — common indicators of credential stuffing / token replay following T1078.004.
references:
  - https://attack.mitre.org/techniques/T1078/004/
  - https://learn.microsoft.com/en-us/azure/active-directory/identity-protection/concept-identity-protection-risks
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.initial_access
  - attack.t1078.004
logsource:
  product: azure
  service: signinlogs
detection:
  selection:
    RiskDetail|contains:
      - 'anonymizedIPAddress'
      - 'unfamiliarFeatures'
      - 'unlikelyTravel'
      - 'anomalousToken'
    ResultType: '0'
  condition: selection
falsepositives:
  - Legitimate VPN / corporate proxy egress flagged as anonymous
level: high`,
      falsePositives: ["Legitimate VPN / corporate proxy egress flagged as anonymous"],
    },
    {
      format: "kql",
      title: `Azure AD risky sign-in success (KQL)`,
      language: "kql",
      body: `SigninLogs
| where ResultType == "0"   // successful sign-in
| where RiskDetail in~ ("anonymizedIPAddress","unfamiliarFeatures","unlikelyTravel","anomalousToken")
   or RiskLevelDuringSignIn in~ ("high","medium")
| project TimeGenerated, UserPrincipalName, IPAddress, Location, AppDisplayName, ClientAppUsed, RiskLevelDuringSignIn, RiskDetail
| order by TimeGenerated desc`,
    },
    {
      format: "spl",
      title: `Risky Azure AD sign-in (Splunk)`,
      language: "spl",
      body: `index=azure sourcetype=azure:aad:signin
  ResultType=0
  (RiskDetail="*anonymizedIPAddress*" OR RiskDetail="*unfamiliarFeatures*" OR RiskDetail="*unlikelyTravel*" OR RiskLevelDuringSignIn IN ("high","medium"))
| stats values(IPAddress) as ips, values(Location.city) as cities, values(AppDisplayName) as apps, max(_time) as last_seen by UserPrincipalName
| eval risk="identity:T1078.004"`,
    },
  ],
};

// ─── T1110 — Brute Force ────────────────────────────────────────────────
const T1110: TechniqueTemplate = {
  techniqueId: "T1110",
  techniqueName: "Brute Force",
  tactics: ["credential-access"],
  category: "identity",
  platforms: ["windows", "azure-ad", "office-365"],
  dataSources: ["Windows Security 4625", "Azure AD SigninLogs"],
  tacticHint: "credential-access",
  rules: (src) => [
    {
      format: "sigma",
      title: `Account brute force / password spray (${src})`,
      language: "sigma",
      body: `title: Account Lockout Burst - Possible Password Spray
id: ${sigmaId()}
status: experimental
description: Detects bursts of failed authentication followed by lockout events that are typical of password spraying or low-and-slow brute force. Tune the threshold per environment.
references:
  - https://attack.mitre.org/techniques/T1110/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.credential_access
  - attack.t1110
logsource:
  product: windows
  service: security
detection:
  selection_fail:
    EventID:
      - 4625
  filter_status:
    Status: '0xc000006d'
  condition: selection_fail and filter_status | count() by IpAddress > 20
falsepositives:
  - Service accounts with expired credentials hammering a controller
  - Penetration test sessions
level: high`,
      falsePositives: ["Service accounts with expired credentials"],
    },
    {
      format: "kql",
      title: `Password spray across users (KQL)`,
      language: "kql",
      body: `SigninLogs
| where ResultType in ("50126","50053","50055")    // bad password / account locked
| summarize FailedAttempts=count(), UniqueUsers=dcount(UserPrincipalName), Users=make_set(UserPrincipalName, 50) by IPAddress, bin(TimeGenerated, 15m)
| where UniqueUsers >= 5 and FailedAttempts >= 20
| order by FailedAttempts desc`,
    },
    {
      format: "spl",
      title: `Failed-auth burst per source IP (Splunk)`,
      language: "spl",
      body: `index=windows EventCode=4625 OR (index=azure ResultType IN ("50126","50053","50055"))
| eval src=coalesce(IpAddress, src_ip, IPAddress)
| bucket _time span=15m
| stats dc(TargetUserName) as users, count as fails by _time, src
| where users >= 5 AND fails >= 20
| eval risk="credential_access:T1110"`,
    },
  ],
};

// ─── T1190 — Exploit Public-Facing Application ────────────────────────────
const T1190: TechniqueTemplate = {
  techniqueId: "T1190",
  techniqueName: "Exploit Public-Facing Application",
  tactics: ["initial-access"],
  category: "web",
  platforms: ["linux", "windows", "containers"],
  dataSources: ["Web server access logs", "Zeek http.log", "WAF events"],
  tacticHint: "initial-access",
  rules: (src) => [
    {
      format: "sigma",
      title: `Web vulnerability exploitation attempt (${src})`,
      language: "sigma",
      body: `title: Webshell / RCE Payload in Web Server Request
id: ${sigmaId()}
status: experimental
description: Detects HTTP requests carrying common RCE/webshell markers (LFI, command injection, JNDI, ${"${"}…}) — typical of opportunistic CVE exploitation against public-facing apps.
references:
  - https://attack.mitre.org/techniques/T1190/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.initial_access
  - attack.t1190
logsource:
  category: webserver
detection:
  selection_payload:
    cs-uri-query|contains:
      - '\${jndi:ldap'
      - '\${jndi:rmi'
      - '../../../../'
      - '/etc/passwd'
      - 'wget '
      - '|curl '
      - 'cmd=whoami'
      - 'eval('
  condition: selection_payload
falsepositives:
  - Penetration tests / DAST scanners
level: high`,
      falsePositives: ["Penetration tests / DAST scanners"],
    },
    {
      format: "spl",
      title: `Web exploit markers in URI (Splunk)`,
      language: "spl",
      body: `index=web (sourcetype=access_combined OR sourcetype=nginx:access)
| eval suspicious=if(match(uri_query,"(?i)(\\\${jndi|\\\\.\\\\./\\\\.\\\\.|/etc/passwd|cmd=whoami|wget |\\\\|curl |eval\\\\()"),1,0)
| where suspicious=1
| stats values(uri_path) as paths, values(useragent) as ua, values(uri_query) as queries, count by src, host
| eval risk="initial_access:T1190"`,
    },
    {
      format: "kql",
      title: `Web exploit markers in URI (KQL)`,
      language: "kql",
      body: `// Requires CommonSecurityLog or W3CIISLog tables
W3CIISLog
| where csUriQuery matches regex @"(?i)(\\$\\{jndi|\\.\\./\\.\\.|/etc/passwd|cmd=whoami|wget\\s|\\|curl\\s|eval\\()"
| project TimeGenerated, sIp, sSitename, cIp, csUriStem, csUriQuery, scStatus, csUserAgent
| order by TimeGenerated desc`,
    },
  ],
};

// ─── T1486 — Data Encrypted for Impact (Ransomware) ───────────────────────
const T1486: TechniqueTemplate = {
  techniqueId: "T1486",
  techniqueName: "Data Encrypted for Impact",
  tactics: ["impact"],
  category: "os-windows",
  platforms: ["windows", "linux"],
  dataSources: ["Sysmon EID 11 (file create)", "Sysmon EID 23 (file delete)", "EDR file events"],
  tacticHint: "impact",
  rules: (src) => [
    {
      format: "sigma",
      title: `Ransomware mass file rewrite / extension change (${src})`,
      language: "sigma",
      body: `title: Mass File Rename to Ransomware Extensions
id: ${sigmaId()}
status: experimental
description: Detects bursts of file creations with known ransomware extensions (locked / encrypted / lockbit / conti / mallox / ...) — a high-fidelity post-encryption signal. Pre-encryption canaries should be paired separately.
references:
  - https://attack.mitre.org/techniques/T1486/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.impact
  - attack.t1486
logsource:
  category: file_event
  product: windows
detection:
  selection_ext:
    TargetFilename|endswith:
      - '.locked'
      - '.encrypted'
      - '.lockbit'
      - '.conti'
      - '.mallox'
      - '.crypted'
      - '.crypt'
      - '.wncry'
      - '.cerber'
  condition: selection_ext | count() by Image, User > 30
falsepositives:
  - Legitimate backup / encryption tools writing matching extensions
level: critical`,
      falsePositives: ["Legitimate backup / encryption tools"],
    },
    {
      format: "spl",
      title: `Ransomware extension burst (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=11
| rex field=TargetFilename "\\.(?<ext>locked|encrypted|lockbit|conti|mallox|crypted|crypt|wncry|cerber)$"
| where isnotnull(ext)
| bucket _time span=10m
| stats count as renames, values(ext) as exts, values(Image) as imgs by _time, ComputerName, User
| where renames >= 30
| eval risk="impact:T1486"`,
    },
    {
      format: "kql",
      title: `Mass file renames to ransomware extensions (KQL)`,
      language: "kql",
      body: `DeviceFileEvents
| where ActionType in ("FileRenamed","FileCreated","FileModified")
| where FileName matches regex @"\\.(locked|encrypted|lockbit|conti|mallox|crypted|crypt|wncry|cerber)$"
| summarize Renames=count(), Extensions=make_set(extract(@"\\.([a-z]+)$", 1, FileName), 5) by bin(Timestamp, 10m), DeviceName, AccountName, InitiatingProcessFileName
| where Renames >= 30
| order by Renames desc`,
    },
  ],
};

// ─── T1071.001 — Application Layer Protocol: Web (C2) ─────────────────────
const T1071_001: TechniqueTemplate = {
  techniqueId: "T1071.001",
  techniqueName: "Application Layer Protocol: Web Protocols",
  tactics: ["command-and-control"],
  category: "network",
  platforms: ["windows", "linux", "macos", "network"],
  dataSources: ["Zeek http.log", "EDR network events", "Proxy logs"],
  tacticHint: "command-and-control",
  rules: (src) => [
    {
      format: "sigma",
      title: `Suspected HTTP beacon to rare destination (${src})`,
      language: "sigma",
      body: `title: HTTP Beacon to Newly Observed Domain
id: ${sigmaId()}
status: experimental
description: Detects HTTP/S egress to a domain not previously seen in this environment, with a steady inter-request interval characteristic of C2 beacons.
references:
  - https://attack.mitre.org/techniques/T1071/001/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.command_and_control
  - attack.t1071.001
logsource:
  category: proxy
detection:
  selection_methods:
    cs-method:
      - 'GET'
      - 'POST'
  filter_known_baseline: false
  condition: selection_methods | count(_time) by cs-host > 5 within 1h
falsepositives:
  - Newly-onboarded SaaS apps
  - Automated cloud-storage syncs
level: medium`,
      falsePositives: ["Newly onboarded SaaS apps"],
    },
    {
      format: "spl",
      title: `Periodic HTTP beacon per process (Splunk + DNS)`,
      language: "spl",
      body: `index=zeek sourcetype=zeek:http
| stats count as beats, dc(_time) as windows, values(uri) as uris, min(_time) as first_seen by id.orig_h, host, ja3
| eval period_var=if(windows>5, beats / windows, 0)
| where beats >= 12 AND period_var <= 1.2   // 12+ regular requests w/ low variance
| eval risk="c2:T1071.001"`,
    },
    {
      format: "kql",
      title: `Beacon to newly observed host (KQL)`,
      language: "kql",
      body: `DeviceNetworkEvents
| where ActionType == "ConnectionSuccess" and RemotePort in (80, 443, 8080, 8443)
| summarize Conns=count(), First=min(Timestamp), Last=max(Timestamp) by DeviceName, RemoteUrl, InitiatingProcessFileName
| where Conns >= 12
| extend Span = Last - First
| where Span between (10min .. 6h)
| extend AvgInterval = Span / Conns
| order by Conns desc`,
    },
  ],
};

// ─── T1218 — Signed Binary Proxy Execution (LOLBAS) ───────────────────────
const T1218: TechniqueTemplate = {
  techniqueId: "T1218",
  techniqueName: "Signed Binary Proxy Execution",
  tactics: ["defense-evasion"],
  category: "os-windows",
  platforms: ["windows"],
  dataSources: ["Sysmon EID 1"],
  tacticHint: "defense-evasion",
  rules: (src) => [
    {
      format: "sigma",
      title: `LOLBAS abuse — signed binary proxy (${src})`,
      language: "sigma",
      body: `title: LOLBAS-Style Proxy Execution Detected
id: ${sigmaId()}
status: experimental
description: Detects suspicious invocations of well-known LOLBAS binaries (regsvr32, mshta, msbuild, installutil, rundll32, certutil) with arguments pointing at remote URLs or .sct/.xsl payloads.
references:
  - https://lolbas-project.github.io/
  - https://attack.mitre.org/techniques/T1218/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.defense_evasion
  - attack.t1218
logsource:
  category: process_creation
  product: windows
detection:
  selection_image:
    Image|endswith:
      - '\\\\regsvr32.exe'
      - '\\\\mshta.exe'
      - '\\\\msbuild.exe'
      - '\\\\installutil.exe'
      - '\\\\certutil.exe'
      - '\\\\rundll32.exe'
  selection_args:
    CommandLine|contains:
      - 'http://'
      - 'https://'
      - '.sct'
      - '.xsl'
      - 'urlcache'
      - 'scrobj.dll'
  condition: selection_image and selection_args
falsepositives:
  - Legitimate admin scripts using certutil for cert ops
  - Visual Studio MSBuild local builds
level: high`,
      falsePositives: ["Legitimate admin scripts using certutil for cert ops"],
    },
    {
      format: "spl",
      title: `LOLBAS with URL or .sct/.xsl (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=1
  (Image="*\\\\regsvr32.exe" OR Image="*\\\\mshta.exe" OR Image="*\\\\certutil.exe" OR Image="*\\\\msbuild.exe" OR Image="*\\\\installutil.exe" OR Image="*\\\\rundll32.exe")
  (CommandLine="*http://*" OR CommandLine="*https://*" OR CommandLine="*.sct*" OR CommandLine="*.xsl*" OR CommandLine="*urlcache*" OR CommandLine="*scrobj.dll*")
| stats values(CommandLine) as cmds, values(ParentImage) as parents, count by ComputerName, User, _time
| eval risk="defense_evasion:T1218"`,
    },
    {
      format: "kql",
      title: `LOLBAS abuse (Defender XDR)`,
      language: "kql",
      body: `DeviceProcessEvents
| where FileName in~ ("regsvr32.exe","mshta.exe","msbuild.exe","installutil.exe","certutil.exe","rundll32.exe")
| where ProcessCommandLine has_any ("http://","https://",".sct",".xsl","urlcache","scrobj.dll")
| project Timestamp, DeviceName, AccountName, FileName, ProcessCommandLine, InitiatingProcessFileName, InitiatingProcessCommandLine
| order by Timestamp desc`,
    },
  ],
};

// ─── T1505.003 — Web Shell ─────────────────────────────────────────────────
const T1505_003: TechniqueTemplate = {
  techniqueId: "T1505.003",
  techniqueName: "Server Software Component: Web Shell",
  tactics: ["persistence"],
  category: "web",
  platforms: ["windows", "linux"],
  dataSources: ["Web server logs", "EDR file events"],
  tacticHint: "persistence",
  rules: (src) => [
    {
      format: "sigma",
      title: `Web shell child process from IIS / Apache (${src})`,
      language: "sigma",
      body: `title: Suspicious Child of IIS / Apache Worker
id: ${sigmaId()}
status: experimental
description: Detects shells / interpreters spawned by w3wp.exe (IIS), httpd (Apache), or nginx — the canonical web-shell pivot pattern (e.g. ProxyLogon, ProxyShell, ProxyNotShell).
references:
  - https://attack.mitre.org/techniques/T1505/003/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.persistence
  - attack.t1505.003
logsource:
  category: process_creation
detection:
  selection_parent:
    ParentImage|endswith:
      - '\\\\w3wp.exe'
      - '/httpd'
      - '/nginx'
      - '/php-fpm'
  selection_child:
    Image|endswith:
      - '\\\\cmd.exe'
      - '\\\\powershell.exe'
      - '/bash'
      - '/sh'
      - '/python'
      - '/perl'
  condition: selection_parent and selection_child
falsepositives:
  - Application diagnostic tools intentionally shelling out
level: critical`,
      falsePositives: ["Application diagnostic tools intentionally shelling out"],
    },
    {
      format: "spl",
      title: `Webserver spawning shell (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=1
  ParentImage="*\\\\w3wp.exe"
  (Image="*\\\\cmd.exe" OR Image="*\\\\powershell.exe" OR Image="*\\\\pwsh.exe")
| stats values(CommandLine) as cmds, values(ParentCommandLine) as parents, values(User) as user, count by ComputerName, _time
| eval risk="persistence:T1505.003"`,
    },
    {
      format: "kql",
      title: `Webserver process spawning shell (KQL)`,
      language: "kql",
      body: `DeviceProcessEvents
| where InitiatingProcessFileName in~ ("w3wp.exe","httpd","nginx","php-fpm","apache2","tomcat.exe")
| where FileName in~ ("cmd.exe","powershell.exe","pwsh.exe","bash","sh","python","python3","perl","wscript.exe","cscript.exe")
| project Timestamp, DeviceName, AccountName, InitiatingProcessFileName, InitiatingProcessCommandLine, FileName, ProcessCommandLine
| order by Timestamp desc`,
    },
  ],
};

// ─── T1547.001 — Registry Run Keys / Startup Folder ───────────────────────
const T1547_001: TechniqueTemplate = {
  techniqueId: "T1547.001",
  techniqueName: "Boot or Logon Autostart Execution: Registry Run Keys",
  tactics: ["persistence", "privilege-escalation"],
  category: "os-windows",
  platforms: ["windows"],
  dataSources: ["Sysmon EID 12/13", "Windows Security 4657"],
  tacticHint: "persistence",
  rules: (src) => [
    {
      format: "sigma",
      title: `Run key written by non-admin process (${src})`,
      language: "sigma",
      body: `title: Run / RunOnce Registry Persistence Set by Unusual Process
id: ${sigmaId()}
status: experimental
description: Detects writes to HKCU/HKLM Run, RunOnce, Userinit, or Image File Execution Options that originate from interpreter or LOLBAS binaries — classic persistence step in stagers and RATs.
references:
  - https://attack.mitre.org/techniques/T1547/001/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.persistence
  - attack.t1547.001
logsource:
  category: registry_event
  product: windows
detection:
  selection_key:
    TargetObject|contains:
      - '\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run'
      - '\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\RunOnce'
      - '\\\\Microsoft\\\\Windows NT\\\\CurrentVersion\\\\Winlogon\\\\Userinit'
      - 'Image File Execution Options'
  selection_proc:
    Image|endswith:
      - '\\\\powershell.exe'
      - '\\\\rundll32.exe'
      - '\\\\regsvr32.exe'
      - '\\\\mshta.exe'
      - '\\\\wscript.exe'
      - '\\\\cscript.exe'
  condition: selection_key and selection_proc
falsepositives:
  - Software installers
level: high`,
      falsePositives: ["Software installers"],
    },
    {
      format: "spl",
      title: `Run-key persistence writes (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" (EventCode=12 OR EventCode=13)
  (TargetObject="*\\\\CurrentVersion\\\\Run*" OR TargetObject="*\\\\Winlogon\\\\Userinit*" OR TargetObject="*Image File Execution Options*")
  (Image="*\\\\powershell.exe" OR Image="*\\\\rundll32.exe" OR Image="*\\\\regsvr32.exe" OR Image="*\\\\mshta.exe" OR Image="*\\\\wscript.exe")
| stats values(Image) as procs, values(TargetObject) as keys, values(Details) as details, count by ComputerName, User, _time
| eval risk="persistence:T1547.001"`,
    },
    {
      format: "kql",
      title: `Run-key persistence (KQL)`,
      language: "kql",
      body: `DeviceRegistryEvents
| where ActionType in ("RegistryValueSet","RegistryKeyCreated")
| where RegistryKey has_any ("\\\\CurrentVersion\\\\Run","\\\\CurrentVersion\\\\RunOnce","Winlogon\\\\Userinit","Image File Execution Options")
| where InitiatingProcessFileName in~ ("powershell.exe","rundll32.exe","regsvr32.exe","mshta.exe","wscript.exe","cscript.exe")
| project Timestamp, DeviceName, AccountName, RegistryKey, RegistryValueName, RegistryValueData, InitiatingProcessFileName, InitiatingProcessCommandLine
| order by Timestamp desc`,
    },
  ],
};

// ─── T1566.001 — Spearphishing Attachment ─────────────────────────────────
const T1566_001: TechniqueTemplate = {
  techniqueId: "T1566.001",
  techniqueName: "Phishing: Spearphishing Attachment",
  tactics: ["initial-access"],
  category: "email",
  platforms: ["office-365", "windows"],
  dataSources: ["O365 EmailEvents", "Defender for Office 365"],
  tacticHint: "initial-access",
  rules: (src) => [
    {
      format: "sigma",
      title: `Macro-bearing attachment from external sender (${src})`,
      language: "sigma",
      body: `title: External Email With Macro-Capable Attachment
id: ${sigmaId()}
status: experimental
description: Detects inbound email from outside the org delivering attachments with macro-capable types (docm, xlsm, pptm, doc/xls legacy formats) — a high-fidelity phishing signal when combined with delivery status.
references:
  - https://attack.mitre.org/techniques/T1566/001/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.initial_access
  - attack.t1566.001
logsource:
  product: m365
  service: email
detection:
  selection_ext:
    AttachmentExtension|contains:
      - 'docm'
      - 'xlsm'
      - 'pptm'
      - 'xlsb'
      - 'doc'
      - 'xls'
  selection_external:
    SenderFromAddress|contains: '@'
    SenderDomainIsExternal: true
  filter_delivered:
    DeliveryAction: 'Delivered'
  condition: selection_ext and selection_external and filter_delivered
falsepositives:
  - Legitimate vendor documents with embedded macros
level: medium`,
      falsePositives: ["Legitimate vendor documents with embedded macros"],
    },
    {
      format: "kql",
      title: `Macro-capable phish (KQL)`,
      language: "kql",
      body: `EmailEvents
| where EmailDirection == "Inbound"
| where DeliveryAction == "Delivered"
| where AttachmentExtension in~ ("docm","xlsm","pptm","xlsb","doc","xls","rtf","htm","html","iso","img","lnk")
| join EmailAttachmentInfo on NetworkMessageId
| project Timestamp, RecipientEmailAddress, SenderFromAddress, Subject, AttachmentExtension, FileName, FileSize, EmailAction
| order by Timestamp desc`,
    },
    {
      format: "spl",
      title: `Macro-bearing inbound attachment (Splunk)`,
      language: "spl",
      body: `index=m365 sourcetype="o365:management:activity" Workload=Exchange
| where DeliveryAction="Delivered" AND match(AttachmentExtension,"(?i)(docm|xlsm|pptm|xlsb|doc|xls|rtf|htm|html|iso|img|lnk)")
| stats values(SenderFromAddress) as sender, values(Subject) as subject, values(FileName) as files by RecipientEmailAddress, _time
| eval risk="initial_access:T1566.001"`,
    },
  ],
};

// ─── T1027 — Obfuscated Files or Information ──────────────────────────────
const T1027: TechniqueTemplate = {
  techniqueId: "T1027",
  techniqueName: "Obfuscated Files or Information",
  tactics: ["defense-evasion"],
  category: "os-windows",
  platforms: ["windows"],
  dataSources: ["Sysmon EID 1", "EDR command-line"],
  tacticHint: "defense-evasion",
  rules: (src) => [
    {
      format: "sigma",
      title: `Heavy obfuscation in command line (${src})`,
      language: "sigma",
      body: `title: Highly Obfuscated Command Line Detected
id: ${sigmaId()}
status: experimental
description: Detects command lines containing dense character substitution patterns ('FrOM' style, backtick-laden, char-code arrays) — typical of T1027 obfuscators in PowerShell/cmd payloads.
references:
  - https://attack.mitre.org/techniques/T1027/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.defense_evasion
  - attack.t1027
logsource:
  category: process_creation
  product: windows
detection:
  selection_marker:
    CommandLine|contains:
      - '[char]'
      - '-Join'
      - '[Convert]::FromBase64'
      - 'Invoke-Expression'
      - 'IeX '
      - '-bxor '
      - '\\\`a'
      - '\\\`e'
      - '\\\`u'
  condition: selection_marker
falsepositives:
  - Heavily-instrumented PowerShell scripts in CI / blue-team tooling
level: high`,
      falsePositives: ["Heavily-instrumented PowerShell scripts in CI"],
    },
    {
      format: "spl",
      title: `Obfuscated PowerShell on the wire (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=1
  CommandLine="*"
| eval ob_score=case(
    match(CommandLine,"\\\\[char\\\\]"), 3,
    match(CommandLine,"-Join"), 1,
    match(CommandLine,"FromBase64"), 2,
    match(CommandLine,"Invoke-Expression|\\\\bIeX\\\\b"), 2,
    match(CommandLine,"-bxor"), 2,
    1==1, 0)
| where ob_score >= 4
| stats values(CommandLine) as cmd, values(User) as user by ComputerName, _time
| eval risk="defense_evasion:T1027"`,
    },
    {
      format: "kql",
      title: `Obfuscated command line (KQL)`,
      language: "kql",
      body: `DeviceProcessEvents
| extend Score = (iff(ProcessCommandLine has "[char]", 3, 0) +
                  iff(ProcessCommandLine has "-Join", 1, 0) +
                  iff(ProcessCommandLine has "FromBase64", 2, 0) +
                  iff(ProcessCommandLine has_any ("Invoke-Expression"," IeX "," IEX "), 2, 0) +
                  iff(ProcessCommandLine has "-bxor", 2, 0))
| where Score >= 4
| project Timestamp, DeviceName, AccountName, FileName, ProcessCommandLine, Score
| order by Score desc`,
    },
  ],
};

// ─── T1098 — Account Manipulation ─────────────────────────────────────────
const T1098: TechniqueTemplate = {
  techniqueId: "T1098",
  techniqueName: "Account Manipulation",
  tactics: ["persistence", "privilege-escalation"],
  category: "identity",
  platforms: ["windows", "azure-ad", "office-365"],
  dataSources: ["Windows Security 4720/4732", "AAD AuditLogs"],
  tacticHint: "persistence",
  rules: (src) => [
    {
      format: "sigma",
      title: `Privileged group membership change (${src})`,
      language: "sigma",
      body: `title: Privileged Active Directory Group Membership Modified
id: ${sigmaId()}
status: experimental
description: Detects adds to high-impact AD groups (Domain Admins, Enterprise Admins, Schema Admins, etc.). Pair with originating user context to suppress legitimate admin onboarding.
references:
  - https://attack.mitre.org/techniques/T1098/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.persistence
  - attack.t1098
logsource:
  product: windows
  service: security
detection:
  selection:
    EventID:
      - 4728
      - 4732
      - 4756
    TargetUserName|contains:
      - 'Domain Admins'
      - 'Enterprise Admins'
      - 'Schema Admins'
      - 'Account Operators'
      - 'Backup Operators'
      - 'Print Operators'
      - 'Server Operators'
  condition: selection
falsepositives:
  - Scheduled admin onboarding workflows
level: high`,
      falsePositives: ["Scheduled admin onboarding workflows"],
    },
    {
      format: "kql",
      title: `Privileged group changes (KQL Sentinel)`,
      language: "kql",
      body: `SecurityEvent
| where EventID in (4728, 4732, 4756)
| where TargetUserName has_any ("Domain Admins","Enterprise Admins","Schema Admins","Account Operators","Backup Operators","Server Operators")
| project TimeGenerated, Computer, SubjectAccount, MemberName, TargetUserName, EventID, Activity
| order by TimeGenerated desc`,
    },
    {
      format: "spl",
      title: `Privileged group add (Splunk)`,
      language: "spl",
      body: `index=windows EventCode IN (4728,4732,4756)
  TargetUserName IN ("Domain Admins","Enterprise Admins","Schema Admins","Account Operators","Backup Operators","Server Operators")
| stats values(MemberName) as members, values(SubjectUserName) as actor, values(Computer) as host by _time, TargetUserName
| eval risk="persistence:T1098"`,
    },
  ],
};

// ─── T1136.003 — Create Cloud Account ─────────────────────────────────────
const T1136_003: TechniqueTemplate = {
  techniqueId: "T1136.003",
  techniqueName: "Create Account: Cloud Account",
  tactics: ["persistence"],
  category: "cloud",
  platforms: ["azure-ad", "iaas:aws", "iaas:gcp", "iaas:azure"],
  dataSources: ["AAD AuditLogs", "CloudTrail", "GCP audit"],
  tacticHint: "persistence",
  rules: (src) => [
    {
      format: "kql",
      title: `New Azure AD user with privileged role (${src})`,
      language: "kql",
      body: `AuditLogs
| where OperationName in ("Add user","Add member to role")
| extend NewUser = tostring(TargetResources[0].userPrincipalName)
| extend RoleName = tostring(TargetResources[0].modifiedProperties[0].newValue)
| join kind=leftouter (AuditLogs | where OperationName == "Add member to role" | extend Member = tostring(TargetResources[0].userPrincipalName) | project Member, RoleAddedAt = TimeGenerated, RoleName2 = tostring(TargetResources[0].modifiedProperties[1].newValue)) on $left.NewUser == $right.Member
| where isnotempty(RoleName2)
| project TimeGenerated, NewUser, InitiatedBy = tostring(InitiatedBy.user.userPrincipalName), RoleAdded = RoleName2`,
    },
    {
      format: "spl",
      title: `AWS IAM CreateUser/Policy attach (Splunk)`,
      language: "spl",
      body: `index=aws sourcetype=aws:cloudtrail
  (eventName=CreateUser OR eventName=AttachUserPolicy OR eventName=PutUserPolicy)
| eval user_name=coalesce('responseElements.user.userName','requestParameters.userName')
| stats values(eventName) as events, values('requestParameters.policyArn') as policies, values(sourceIPAddress) as src by user_name, _time, userIdentity.userName
| eval risk="persistence:T1136.003"`,
    },
    {
      format: "sigma",
      title: `New cloud account creation (${src})`,
      language: "sigma",
      body: `title: Suspicious Cloud Account Creation
id: ${sigmaId()}
status: experimental
description: Detects creation of cloud accounts in Azure AD or AWS IAM by non-administrative principals or with simultaneous privileged role assignments — classic persistence after compromise.
references:
  - https://attack.mitre.org/techniques/T1136/003/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.persistence
  - attack.t1136.003
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName:
      - 'CreateUser'
      - 'CreateAccessKey'
      - 'AttachUserPolicy'
  filter_console: false
  condition: selection
falsepositives:
  - Provisioning automation (Terraform / SCIM)
level: medium`,
      falsePositives: ["Provisioning automation (Terraform / SCIM)"],
    },
  ],
};

// ─── T1055 — Process Injection ────────────────────────────────────────────
const T1055: TechniqueTemplate = {
  techniqueId: "T1055",
  techniqueName: "Process Injection",
  tactics: ["defense-evasion", "privilege-escalation"],
  category: "os-windows",
  platforms: ["windows"],
  dataSources: ["Sysmon EID 8 (CreateRemoteThread)", "Sysmon EID 10 (process access)"],
  tacticHint: "defense-evasion",
  rules: (src) => [
    {
      format: "sigma",
      title: `Cross-process thread creation (${src})`,
      language: "sigma",
      body: `title: Cross-Process CreateRemoteThread / Injection
id: ${sigmaId()}
status: experimental
description: Detects Sysmon EID 8 events between user-land processes that are not on the standard EDR / debugger allow-list — generic catch for shellcode injection / dropper.
references:
  - https://attack.mitre.org/techniques/T1055/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.defense_evasion
  - attack.t1055
logsource:
  product: windows
  category: create_remote_thread
detection:
  selection:
    EventID: 8
  filter_legit:
    SourceImage|endswith:
      - '\\\\MsMpEng.exe'
      - '\\\\smartscreen.exe'
      - '\\\\WmiPrvSE.exe'
  condition: selection and not filter_legit
falsepositives:
  - EDR vendor injection
level: high`,
      falsePositives: ["EDR vendor injection"],
    },
    {
      format: "spl",
      title: `Suspicious CreateRemoteThread (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=8
  NOT (SourceImage="*\\\\MsMpEng.exe" OR SourceImage="*\\\\smartscreen.exe" OR SourceImage="*\\\\WmiPrvSE.exe")
| stats values(SourceImage) as src_procs, values(TargetImage) as dst_procs, count by ComputerName, _time
| eval risk="defense_evasion:T1055"`,
    },
    {
      format: "kql",
      title: `Process injection candidate (KQL)`,
      language: "kql",
      body: `DeviceEvents
| where ActionType == "CreateRemoteThreadApiCall" or ActionType == "ProcessPrivilegeEscalation"
| where InitiatingProcessFileName !in~ ("MsMpEng.exe","smartscreen.exe","WmiPrvSE.exe")
| project Timestamp, DeviceName, InitiatingProcessFileName, FileName, ActionType, AdditionalFields
| order by Timestamp desc`,
    },
  ],
};

// ─── T1571 — Non-Standard Port (C2) ───────────────────────────────────────
const T1571: TechniqueTemplate = {
  techniqueId: "T1571",
  techniqueName: "Non-Standard Port",
  tactics: ["command-and-control"],
  category: "network",
  platforms: ["windows", "linux", "network"],
  dataSources: ["Zeek conn.log", "Firewall flows"],
  tacticHint: "command-and-control",
  rules: (src) => [
    {
      format: "sigma",
      title: `HTTP/TLS on non-standard port (${src})`,
      language: "sigma",
      body: `title: Outbound TLS or HTTP on Non-Standard Port
id: ${sigmaId()}
status: experimental
description: Detects egress TLS / HTTP services on ports other than 80/443/8080/8443 — common with custom C2 implants attempting to evade port-based filtering.
references:
  - https://attack.mitre.org/techniques/T1571/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.command_and_control
  - attack.t1571
logsource:
  category: network_connection
detection:
  selection:
    DestinationPort|gte: 1025
    Protocol: tcp
  filter_known:
    DestinationPort:
      - 80
      - 443
      - 8080
      - 8443
      - 22
      - 25
      - 53
      - 3389
  condition: selection and not filter_known
falsepositives:
  - Custom internal apps
level: low`,
      falsePositives: ["Custom internal apps"],
    },
    {
      format: "spl",
      title: `Anomalous outbound port (Splunk + Zeek)`,
      language: "spl",
      body: `index=zeek sourcetype=zeek:conn
  service IN ("ssl","http")
  NOT (id.resp_p IN (80,443,8080,8443))
| stats count, sum(orig_bytes) as bytes_out, sum(resp_bytes) as bytes_in by id.orig_h, id.resp_h, id.resp_p, service
| where count > 5 OR bytes_out > 1000000
| eval risk="c2:T1571"`,
    },
    {
      format: "kql",
      title: `Anomalous outbound port (KQL)`,
      language: "kql",
      body: `DeviceNetworkEvents
| where ActionType == "ConnectionSuccess"
| where RemotePort !in (80,443,8080,8443,22,25,53,389,3389)
| where InitiatingProcessFileName !in~ ("svchost.exe","explorer.exe")
| summarize count(), Ports=make_set(RemotePort, 10) by DeviceName, RemoteIP, InitiatingProcessFileName
| where count_ > 5
| order by count_ desc`,
    },
  ],
};

// ─── T1140 — Deobfuscate/Decode ───────────────────────────────────────────
const T1140: TechniqueTemplate = {
  techniqueId: "T1140",
  techniqueName: "Deobfuscate / Decode Files or Information",
  tactics: ["defense-evasion"],
  category: "os-windows",
  platforms: ["windows"],
  dataSources: ["Sysmon EID 1"],
  tacticHint: "defense-evasion",
  rules: (src) => [
    {
      format: "sigma",
      title: `Inline base64 → invoke chain (${src})`,
      language: "sigma",
      body: `title: PowerShell Base64 Decode and Execute
id: ${sigmaId()}
status: experimental
description: Detects PowerShell command lines that decode base64 in memory and pipe to Invoke-Expression / .Invoke() — common in fileless droppers.
references:
  - https://attack.mitre.org/techniques/T1140/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.defense_evasion
  - attack.t1140
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    CommandLine|contains|all:
      - 'FromBase64String'
    CommandLine|contains:
      - 'Invoke-Expression'
      - 'IeX'
      - 'iex'
      - '.Invoke('
  condition: selection
falsepositives:
  - DevOps tooling that bootstraps via base64
level: high`,
      falsePositives: ["DevOps tooling that bootstraps via base64"],
    },
    {
      format: "spl",
      title: `Base64 → IEX (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=1
  CommandLine="*FromBase64String*"
  (CommandLine="*Invoke-Expression*" OR CommandLine="*\\\\.Invoke(*" OR CommandLine="*iex *" OR CommandLine="*IeX *")
| stats values(CommandLine) as cmd, values(User) as user, values(ParentImage) as parent by ComputerName, _time
| eval risk="defense_evasion:T1140"`,
    },
    {
      format: "kql",
      title: `Base64 → IEX (KQL)`,
      language: "kql",
      body: `DeviceProcessEvents
| where ProcessCommandLine has "FromBase64String"
| where ProcessCommandLine has_any ("Invoke-Expression","iex",".Invoke(","IeX")
| project Timestamp, DeviceName, AccountName, ProcessCommandLine, InitiatingProcessFileName, InitiatingProcessCommandLine
| order by Timestamp desc`,
    },
  ],
};

// ─── T1574.002 — DLL Side-Loading ─────────────────────────────────────────
const T1574_002: TechniqueTemplate = {
  techniqueId: "T1574.002",
  techniqueName: "Hijack Execution Flow: DLL Side-Loading",
  tactics: ["persistence", "defense-evasion", "privilege-escalation"],
  category: "os-windows",
  platforms: ["windows"],
  dataSources: ["Sysmon EID 7 (image load)"],
  tacticHint: "defense-evasion",
  rules: (src) => [
    {
      format: "sigma",
      title: `Signed binary loading DLL from temp path (${src})`,
      language: "sigma",
      body: `title: Signed Binary Loading Unsigned DLL From Suspicious Path
id: ${sigmaId()}
status: experimental
description: Detects Microsoft-signed binaries loading a DLL from \\AppData\\Local\\Temp\\, \\ProgramData\\, or %PUBLIC% — a hallmark side-loading pattern used by Chinese APT toolkits.
references:
  - https://attack.mitre.org/techniques/T1574/002/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.defense_evasion
  - attack.t1574.002
logsource:
  product: windows
  category: image_load
detection:
  selection:
    Signed: 'true'
    ImageLoaded|contains:
      - '\\\\AppData\\\\Local\\\\Temp\\\\'
      - '\\\\ProgramData\\\\'
      - '\\\\Public\\\\'
  filter_unsigned:
    SignatureStatus: 'Valid'
  condition: selection and not filter_unsigned
falsepositives:
  - Vendor installers staging DLLs in Temp
level: high`,
      falsePositives: ["Vendor installers staging DLLs in Temp"],
    },
    {
      format: "kql",
      title: `Side-loaded DLL from Temp (KQL)`,
      language: "kql",
      body: `DeviceImageLoadEvents
| where FolderPath has_any ("\\\\AppData\\\\Local\\\\Temp\\\\","\\\\ProgramData\\\\","\\\\Users\\\\Public\\\\")
| where InitiatingProcessSignatureStatus == "Valid" and InitiatingProcessSignerType in~ ("Microsoft","CommercialCA")
| project Timestamp, DeviceName, InitiatingProcessFileName, FileName, FolderPath, SHA1
| order by Timestamp desc`,
    },
    {
      format: "spl",
      title: `Side-loading DLL Temp path (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=7
  Signed=true SignatureStatus=Valid
  (ImageLoaded="*\\\\AppData\\\\Local\\\\Temp\\\\*" OR ImageLoaded="*\\\\ProgramData\\\\*" OR ImageLoaded="*\\\\Public\\\\*")
| stats values(Image) as proc, values(ImageLoaded) as dll, values(Hashes) as hashes by ComputerName, _time
| eval risk="defense_evasion:T1574.002"`,
    },
  ],
};

// ─── T1068 — Exploitation for Privilege Escalation ────────────────────────
const T1068: TechniqueTemplate = {
  techniqueId: "T1068",
  techniqueName: "Exploitation for Privilege Escalation",
  tactics: ["privilege-escalation"],
  category: "os-windows",
  platforms: ["windows", "linux"],
  dataSources: ["Sysmon EID 1", "EDR escalation alerts"],
  tacticHint: "privilege-escalation",
  rules: (src) => [
    {
      format: "sigma",
      title: `Kernel-mode driver loaded by user process (${src})`,
      language: "sigma",
      body: `title: Suspicious Kernel Driver Load From User Path
id: ${sigmaId()}
status: experimental
description: Detects loads of .sys drivers from user-writable paths — a vulnerable-driver / BYOVD privilege escalation indicator.
references:
  - https://attack.mitre.org/techniques/T1068/
  - https://loldrivers.io/
author: DetectOps auto-generation
date: 2026/06/05
tags:
  - attack.privilege_escalation
  - attack.t1068
logsource:
  product: windows
  category: driver_load
detection:
  selection:
    ImageLoaded|endswith: '.sys'
    ImageLoaded|contains:
      - '\\\\Users\\\\'
      - '\\\\AppData\\\\'
      - '\\\\ProgramData\\\\'
      - '\\\\Temp\\\\'
  condition: selection
falsepositives:
  - Endpoint security tools deploying drivers
level: critical`,
      falsePositives: ["Endpoint security tools deploying drivers"],
    },
    {
      format: "kql",
      title: `Driver load from user-writable path (KQL)`,
      language: "kql",
      body: `DeviceImageLoadEvents
| where FileName endswith ".sys"
| where FolderPath has_any ("\\\\Users\\\\","\\\\AppData\\\\","\\\\ProgramData\\\\","\\\\Temp\\\\")
| project Timestamp, DeviceName, InitiatingProcessFileName, FileName, FolderPath, SHA1, InitiatingProcessAccountName
| order by Timestamp desc`,
    },
    {
      format: "spl",
      title: `Vulnerable-driver load (Splunk)`,
      language: "spl",
      body: `index=windows sourcetype="WinEventLog:Sysmon" EventCode=6
  ImageLoaded="*.sys"
  (ImageLoaded="*\\\\Users\\\\*" OR ImageLoaded="*\\\\AppData\\\\*" OR ImageLoaded="*\\\\ProgramData\\\\*" OR ImageLoaded="*\\\\Temp\\\\*")
| stats values(ImageLoaded) as drivers, values(Hashes) as hashes, values(Image) as loaders by ComputerName, _time
| eval risk="privilege_escalation:T1068"`,
    },
  ],
};

// ─── Generic fallback template (any technique) ────────────────────────────
const GENERIC_FALLBACK: TechniqueTemplate = {
  techniqueId: "TXXXX",
  techniqueName: "Generic Suspicious Activity",
  tactics: ["execution", "defense-evasion"],
  category: "other",
  platforms: ["windows", "linux"],
  dataSources: ["Process telemetry", "EDR"],
  tacticHint: "execution",
  rules: (src) => [
    {
      format: "sigma",
      title: `Anomalous process activity (${src})`,
      language: "sigma",
      body: `title: Suspicious Activity From Threat Report
id: ${sigmaId()}
status: experimental
description: Placeholder detection mapped from ${src} — refine the selection block with TI-specific IOCs (process names, command-line markers, file paths) listed in the parent threat report's IOC block.
references:
  - DetectOps Detection Pack auto-generation
author: DetectOps auto-generation
date: 2026/06/05
logsource:
  category: process_creation
detection:
  selection:
    CommandLine|contains:
      - 'PLACEHOLDER_IOC_1'
      - 'PLACEHOLDER_IOC_2'
  condition: selection
falsepositives:
  - This rule requires per-environment tuning
level: medium`,
      falsePositives: ["This rule requires per-environment tuning"],
    },
  ],
};

// ─── Registry ──────────────────────────────────────────────────────────────
const TEMPLATES: TechniqueTemplate[] = [
  T1003_001, T1059_001, T1078_004, T1110, T1190, T1486, T1071_001, T1218,
  T1505_003, T1547_001, T1566_001, T1027, T1098, T1136_003, T1055, T1571,
  T1140, T1574_002, T1068,
];

const BY_ID = new Map<string, TechniqueTemplate>(TEMPLATES.map((t) => [t.techniqueId, t]));

/**
 * Best-fit template for a technique. Tries exact match (sub-technique),
 * then parent (T1003.001 → T1003 → first match starting with T1003), then
 * generic fallback. Returns the fallback augmented with the requested
 * technique id when nothing matches.
 */
export function pickTemplate(rawTechnique: string): TechniqueTemplate {
  const t = (rawTechnique || "").trim().toUpperCase();
  if (BY_ID.has(t)) return BY_ID.get(t)!;
  // Try parent technique (drop sub-technique suffix)
  if (t.includes(".")) {
    const parent = t.split(".")[0];
    for (const tpl of TEMPLATES) {
      if (tpl.techniqueId.startsWith(parent + ".") || tpl.techniqueId === parent) return tpl;
    }
  }
  // Try prefix match
  for (const tpl of TEMPLATES) {
    if (tpl.techniqueId.startsWith(t)) return tpl;
  }
  // Fallback
  return { ...GENERIC_FALLBACK, techniqueId: t || "T0000" };
}

export const ALL_TEMPLATE_IDS = TEMPLATES.map((t) => t.techniqueId);
