export interface StaticRule {
  id: string;
  title: string;
  source: "Splunk Security Content" | "Elastic Detection Rules";
  sourceSlug: "splunk" | "elastic";
  technique: string;
  tactic: string;
  level: string;
  author: string;
  stars: number;
  updatedAt: string;
  importStatus: "available" | "imported" | "modified";
  description: string;
  tags: string[];
  mitreTechniques: string[];
  logsourceProduct: string;
  detectionLogic: string;
  references: string[];
  falsepositives: string[];
}

export const staticRules: StaticRule[] = [
  {
    id: "sp-1",
    title: "Suspicious Scheduled Task Creation",
    source: "Splunk Security Content",
    sourceSlug: "splunk",
    technique: "T1053.005",
    tactic: "Persistence",
    level: "medium",
    author: "Splunk Threat Research",
    stars: 156,
    updatedAt: "2026-02-01",
    importStatus: "available",
    description: "Detects suspicious scheduled task creation using schtasks.exe with unusual parameters. Monitors for tasks created with SYSTEM privileges, tasks pointing to suspicious directories (e.g., temp, appdata), or tasks using encoded commands.",
    tags: ["scheduled-task", "persistence", "schtasks"],
    mitreTechniques: ["T1053.005"],
    logsourceProduct: "windows",
    detectionLogic: `| tstats summariesonly=true count min(_time) as firstTime max(_time) as lastTime from datamodel=Endpoint.Processes
  where Processes.process_name=schtasks.exe Processes.process=*create*
  by Processes.dest Processes.user Processes.parent_process_name Processes.process
| \`drop_dm_object_name(Processes)\`
| where match(process, "(?i)(SYSTEM|\\\\temp|\\\\appdata|encodedcommand)")`,
    references: [
      "https://attack.mitre.org/techniques/T1053/005/",
      "https://research.splunk.com/endpoint/suspicious_scheduled_task_creation/",
    ],
    falsepositives: [
      "Legitimate system administration tasks",
      "Software installers that create scheduled tasks",
    ],
  },
  {
    id: "sp-2",
    title: "DNS Tunneling via High Frequency Queries",
    source: "Splunk Security Content",
    sourceSlug: "splunk",
    technique: "T1071",
    tactic: "Command and Control",
    level: "high",
    author: "Splunk Threat Research",
    stars: 134,
    updatedAt: "2025-12-15",
    importStatus: "available",
    description: "Detects potential DNS tunneling through unusually high DNS query frequency to a single domain. Adversaries may use DNS as a covert channel for command and control or data exfiltration by encoding data in DNS query subdomains.",
    tags: ["dns", "tunneling", "c2", "exfiltration"],
    mitreTechniques: ["T1071"],
    logsourceProduct: "network",
    detectionLogic: `| tstats count from datamodel=Network_Resolution
  where DNS.message_type=QUERY
  by _time span=1m DNS.src DNS.query
| stats count dc(DNS.query) as unique_queries by DNS.src
| where unique_queries > 100`,
    references: [
      "https://attack.mitre.org/techniques/T1071/",
      "https://research.splunk.com/network/dns_tunneling_detection/",
    ],
    falsepositives: [
      "CDN services with high query rates",
      "Legitimate applications with frequent DNS lookups",
    ],
  },
  {
    id: "sp-3",
    title: "Excessive Authentication Failures",
    source: "Splunk Security Content",
    sourceSlug: "splunk",
    technique: "T1110",
    tactic: "Credential Access",
    level: "medium",
    author: "Splunk Threat Research",
    stars: 98,
    updatedAt: "2026-01-10",
    importStatus: "available",
    description: "Detects brute force login attempts across multiple accounts from a single source. Monitors Windows Security Event IDs 4625 (failed logon) for high volumes within a short time window, indicating credential stuffing or password spraying.",
    tags: ["brute-force", "authentication", "credential-access"],
    mitreTechniques: ["T1110"],
    logsourceProduct: "windows",
    detectionLogic: `index=wineventlog sourcetype=WinEventLog:Security EventCode=4625
| stats count dc(TargetUserName) as unique_accounts values(TargetUserName) as attempted_accounts by src_ip
| where count > 20 AND unique_accounts > 5`,
    references: [
      "https://attack.mitre.org/techniques/T1110/",
      "https://research.splunk.com/endpoint/excessive_authentication_failures/",
    ],
    falsepositives: [
      "Password rotation scripts",
      "Service accounts with expired credentials",
    ],
  },
  {
    id: "el-1",
    title: "Windows Registry Run Key Modification",
    source: "Elastic Detection Rules",
    sourceSlug: "elastic",
    technique: "T1547.001",
    tactic: "Persistence",
    level: "medium",
    author: "Elastic Security",
    stars: 198,
    updatedAt: "2026-01-28",
    importStatus: "modified",
    description: "Detects modifications to Windows registry run keys used for persistence. Monitors changes to HKLM and HKCU Run/RunOnce keys, which are common targets for malware to establish automatic execution on system startup.",
    tags: ["registry", "run-key", "persistence", "autostart"],
    mitreTechniques: ["T1547.001"],
    logsourceProduct: "windows",
    detectionLogic: `registry where event.type == "change" and
  registry.path : (
    "HKLM\\\\SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run\\\\*",
    "HKLM\\\\SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\RunOnce\\\\*",
    "HKCU\\\\SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run\\\\*",
    "HKCU\\\\SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\RunOnce\\\\*"
  ) and not process.executable : ("C:\\\\Windows\\\\*", "C:\\\\Program Files\\\\*")`,
    references: [
      "https://attack.mitre.org/techniques/T1547/001/",
      "https://www.elastic.co/guide/en/security/current/windows-registry-run-key.html",
    ],
    falsepositives: [
      "Legitimate software installations that add startup entries",
      "Group Policy updates modifying run keys",
    ],
  },
  {
    id: "el-2",
    title: "Certutil Download and Decode",
    source: "Elastic Detection Rules",
    sourceSlug: "elastic",
    technique: "T1105",
    tactic: "Command and Control",
    level: "medium",
    author: "Elastic Security",
    stars: 176,
    updatedAt: "2026-02-10",
    importStatus: "imported",
    description: "Detects certutil.exe being used to download or decode files. Certutil is a legitimate Windows utility often abused by attackers as a living-off-the-land binary (LOLBin) to download payloads or decode base64-encoded files.",
    tags: ["certutil", "lolbin", "download", "ingress-tool"],
    mitreTechniques: ["T1105"],
    logsourceProduct: "windows",
    detectionLogic: `process where event.type == "start" and
  process.name : "certutil.exe" and
  process.args : ("-urlcache", "-decode", "-encode", "-decodehex") and
  not process.parent.executable : "C:\\\\Windows\\\\System32\\\\mmc.exe"`,
    references: [
      "https://attack.mitre.org/techniques/T1105/",
      "https://www.elastic.co/guide/en/security/current/certutil-download-decode.html",
    ],
    falsepositives: [
      "Certificate management operations by IT administrators",
      "Legitimate use of certutil for certificate verification",
    ],
  },
  {
    id: "el-3",
    title: "Unusual Parent-Child Process Relationship",
    source: "Elastic Detection Rules",
    sourceSlug: "elastic",
    technique: "T1055",
    tactic: "Defense Evasion",
    level: "high",
    author: "Elastic Security",
    stars: 221,
    updatedAt: "2026-03-05",
    importStatus: "available",
    description: "Detects unusual parent-child process relationships indicative of process injection or suspicious execution chains. Identifies scenarios where processes like cmd.exe or powershell.exe are spawned by uncommon parents such as outlook.exe, excel.exe, or other Office applications.",
    tags: ["injection", "process-tree", "defense-evasion"],
    mitreTechniques: ["T1055"],
    logsourceProduct: "windows",
    detectionLogic: `process where event.type == "start" and
  process.name : ("cmd.exe", "powershell.exe", "wscript.exe", "cscript.exe") and
  process.parent.name : ("outlook.exe", "excel.exe", "winword.exe", "powerpnt.exe", "mshta.exe") and
  not process.args : ("/c", "echo")`,
    references: [
      "https://attack.mitre.org/techniques/T1055/",
      "https://www.elastic.co/guide/en/security/current/unusual-parent-child-relationship.html",
    ],
    falsepositives: [
      "Legitimate macros in Office documents",
      "IT automation scripts launched from Office applications",
    ],
  },
];

export function getStaticRuleById(id: string): StaticRule | undefined {
  return staticRules.find((r) => r.id === id);
}

export function getStaticRulesBySource(slug: "splunk" | "elastic"): StaticRule[] {
  return staticRules.filter((r) => r.sourceSlug === slug);
}
