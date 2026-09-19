export const tactics = [
  { id: "TA0043", stixId: "x-mitre-tactic--daa4cbb1-b4f4-4723-a824-7f1efd6e0592", name: "Reconnaissance", shortName: "reconnaissance", order: 0 },
  { id: "TA0042", stixId: "x-mitre-tactic--d679bca2-4d54-4bb3-954a-a0bedd8377e8", name: "Resource Development", shortName: "resource-development", order: 1 },
  { id: "TA0001", stixId: "x-mitre-tactic--ffd5bcee-6e16-4dd2-8eca-7b3beedf33ca", name: "Initial Access", shortName: "initial-access", order: 2 },
  { id: "TA0002", stixId: "x-mitre-tactic--4ca45d45-df4d-4613-8980-bfe8b80e4c07", name: "Execution", shortName: "execution", order: 3 },
  { id: "TA0003", stixId: "x-mitre-tactic--5bc1d813-693e-4823-9961-abf9af4b0e92", name: "Persistence", shortName: "persistence", order: 4 },
  { id: "TA0004", stixId: "x-mitre-tactic--5e29b093-294e-49e9-a803-dab3d73b77dd", name: "Privilege Escalation", shortName: "privilege-escalation", order: 5 },
  { id: "TA0005", stixId: "x-mitre-tactic--78b23412-0651-46d7-a540-170a1ce8bd5a", name: "Defense Evasion", shortName: "defense-evasion", order: 6 },
  { id: "TA0006", stixId: "x-mitre-tactic--2558fd61-8c75-4730-94c4-11926db2a263", name: "Credential Access", shortName: "credential-access", order: 7 },
  { id: "TA0007", stixId: "x-mitre-tactic--c17c5845-175e-4421-9713-829d0573dbc9", name: "Discovery", shortName: "discovery", order: 8 },
  { id: "TA0008", stixId: "x-mitre-tactic--7141578b-e50b-4dcc-bfa4-08a8dd689e9e", name: "Lateral Movement", shortName: "lateral-movement", order: 9 },
  { id: "TA0009", stixId: "x-mitre-tactic--d108ce10-2419-4cf9-a774-46161d6c6cfe", name: "Collection", shortName: "collection", order: 10 },
  { id: "TA0011", stixId: "x-mitre-tactic--f72804c5-f15a-449e-a5da-2eecd181f813", name: "Command and Control", shortName: "command-and-control", order: 11 },
  { id: "TA0010", stixId: "x-mitre-tactic--9a4e74ab-5008-408c-84bf-a10dfbc53462", name: "Exfiltration", shortName: "exfiltration", order: 12 },
  { id: "TA0040", stixId: "x-mitre-tactic--5569339b-94c2-49ee-afb3-2222936571d8", name: "Impact", shortName: "impact", order: 13 },
];

export const techniques = [
  {
    id: "T1003", name: "OS Credential Dumping", tactics: ["TA0006"],
    platforms: ["Windows", "Linux", "macOS"], dataSources: ["Process: OS API Execution", "Command: Command Execution"],
    description: "Adversaries may attempt to dump credentials to obtain account login and credential material.",
    subTechniques: [
      { id: "T1003.001", name: "LSASS Memory", tactics: ["TA0006"], platforms: ["Windows"], dataSources: ["Process: Process Access", "Process: Process Creation"], description: "Adversaries may attempt to access credential material stored in LSASS process memory." },
    ],
  },
  {
    id: "T1059", name: "Command and Scripting Interpreter", tactics: ["TA0002"],
    platforms: ["Windows", "Linux", "macOS"], dataSources: ["Command: Command Execution", "Process: Process Creation"],
    description: "Adversaries may abuse command and script interpreters to execute commands, scripts, or binaries.",
    subTechniques: [
      { id: "T1059.001", name: "PowerShell", tactics: ["TA0002"], platforms: ["Windows"], dataSources: ["Script: Script Execution", "Process: Process Creation"], description: "Adversaries may abuse PowerShell commands and scripts for execution." },
      { id: "T1059.003", name: "Windows Command Shell", tactics: ["TA0002"], platforms: ["Windows"], dataSources: ["Process: Process Creation"], description: "Adversaries may abuse the Windows command shell for execution." },
    ],
  },
  {
    id: "T1053", name: "Scheduled Task/Job", tactics: ["TA0003", "TA0004", "TA0002"],
    platforms: ["Windows", "Linux", "macOS"], dataSources: ["Scheduled Job: Scheduled Job Creation", "Process: Process Creation"],
    description: "Adversaries may abuse task scheduling functionality to facilitate initial or recurring execution.",
    subTechniques: [
      { id: "T1053.005", name: "Scheduled Task", tactics: ["TA0003", "TA0004", "TA0002"], platforms: ["Windows"], dataSources: ["Scheduled Job: Scheduled Job Creation"], description: "Adversaries may abuse the Windows Task Scheduler to perform task scheduling." },
    ],
  },
  {
    id: "T1547", name: "Boot or Logon Autostart Execution", tactics: ["TA0003", "TA0004"],
    platforms: ["Windows", "Linux", "macOS"], dataSources: ["Windows Registry: Windows Registry Key Modification", "Process: Process Creation"],
    description: "Adversaries may configure system settings to automatically execute a program during system boot or logon.",
    subTechniques: [
      { id: "T1547.001", name: "Registry Run Keys / Startup Folder", tactics: ["TA0003", "TA0004"], platforms: ["Windows"], dataSources: ["Windows Registry: Windows Registry Key Modification"], description: "Adversaries may achieve persistence by adding a program to a startup folder or referencing it with a Registry run key." },
    ],
  },
  { id: "T1078", name: "Valid Accounts", tactics: ["TA0001", "TA0003", "TA0004", "TA0005"], platforms: ["Windows", "Linux", "macOS", "Azure AD", "Google Workspace"], dataSources: ["Logon Session: Logon Session Creation", "User Account: User Account Authentication"], description: "Adversaries may obtain and abuse credentials of existing accounts.", subTechniques: [] },
  {
    id: "T1021", name: "Remote Services", tactics: ["TA0008"],
    platforms: ["Windows", "Linux", "macOS"], dataSources: ["Logon Session: Logon Session Creation", "Network Traffic: Network Connection Creation"],
    description: "Adversaries may use valid accounts to log into a service specifically designed to accept remote connections.",
    subTechniques: [
      { id: "T1021.001", name: "Remote Desktop Protocol", tactics: ["TA0008"], platforms: ["Windows"], dataSources: ["Logon Session: Logon Session Creation", "Network Traffic: Network Connection Creation"], description: "Adversaries may use RDP to remotely access systems." },
    ],
  },
  { id: "T1071", name: "Application Layer Protocol", tactics: ["TA0011"], platforms: ["Windows", "Linux", "macOS"], dataSources: ["Network Traffic: Network Traffic Content", "Network Traffic: Network Traffic Flow"], description: "Adversaries may communicate using application layer protocols to avoid detection.", subTechniques: [] },
  { id: "T1105", name: "Ingress Tool Transfer", tactics: ["TA0011"], platforms: ["Windows", "Linux", "macOS"], dataSources: ["Network Traffic: Network Traffic Content", "File: File Creation"], description: "Adversaries may transfer tools or other files from an external system into a compromised environment.", subTechniques: [] },
  { id: "T1055", name: "Process Injection", tactics: ["TA0005", "TA0004"], platforms: ["Windows", "Linux", "macOS"], dataSources: ["Process: OS API Execution", "Process: Process Access"], description: "Adversaries may inject code into processes in order to evade process-based defenses.", subTechniques: [] },
  { id: "T1027", name: "Obfuscated Files or Information", tactics: ["TA0005"], platforms: ["Windows", "Linux", "macOS"], dataSources: ["File: File Metadata", "Process: Process Creation"], description: "Adversaries may attempt to make an executable or file difficult to discover or analyze.", subTechniques: [] },
  { id: "T1082", name: "System Information Discovery", tactics: ["TA0007"], platforms: ["Windows", "Linux", "macOS"], dataSources: ["Process: Process Creation", "Command: Command Execution"], description: "An adversary may attempt to get detailed information about the operating system and hardware.", subTechniques: [] },
  { id: "T1486", name: "Data Encrypted for Impact", tactics: ["TA0040"], platforms: ["Windows", "Linux", "macOS"], dataSources: ["File: File Modification", "Process: Process Creation"], description: "Adversaries may encrypt data on target systems or on large numbers of systems to interrupt availability.", subTechniques: [] },
  {
    id: "T1566", name: "Phishing", tactics: ["TA0001"],
    platforms: ["Windows", "Linux", "macOS", "Google Workspace", "Office 365"], dataSources: ["Application Log: Application Log Content", "Network Traffic: Network Traffic Content"],
    description: "Adversaries may send phishing messages to gain access to victim systems.",
    subTechniques: [
      { id: "T1566.001", name: "Spearphishing Attachment", tactics: ["TA0001"], platforms: ["Windows", "Linux", "macOS"], dataSources: ["Application Log: Application Log Content", "Network Traffic: Network Traffic Content"], description: "Adversaries may send spearphishing emails with a malicious attachment." },
    ],
  },
  { id: "T1190", name: "Exploit Public-Facing Application", tactics: ["TA0001"], platforms: ["Windows", "Linux", "macOS", "Containers"], dataSources: ["Application Log: Application Log Content", "Network Traffic: Network Traffic Content"], description: "Adversaries may attempt to exploit a weakness in an Internet-facing host or program.", subTechniques: [] },
  { id: "T1048", name: "Exfiltration Over Alternative Protocol", tactics: ["TA0010"], platforms: ["Windows", "Linux", "macOS"], dataSources: ["Network Traffic: Network Traffic Content", "Network Traffic: Network Traffic Flow"], description: "Adversaries may steal data by exfiltrating it over a different protocol than that of the existing command and control channel.", subTechniques: [] },
];

export const stixObjects = [
  {
    id: "stix-001", stixId: "campaign--a]b2c3d4-e5f6-7890-abcd-ef1234567890", type: "campaign" as const,
    name: "APT29 SolarWinds Campaign", description: "A sophisticated supply chain attack leveraging trojanized SolarWinds Orion updates to establish persistent access to high-value government and enterprise targets.",
    created: "2020-12-13T00:00:00Z", modified: "2025-06-15T00:00:00Z",
    relatedTechniques: ["T1566.001", "T1059.001", "T1003.001", "T1021.001", "T1048"],
    aliases: ["SUNBURST Campaign", "SolarWinds Hack"],
    externalReferences: [{ source: "CISA", url: "https://www.cisa.gov/news-events/alerts", description: "CISA Alert AA21-008A" }],
  },
  {
    id: "stix-002", stixId: "intrusion-set--b2c3d4e5-f6a7-8901-bcde-f12345678901", type: "intrusion-set" as const,
    name: "APT29", description: "APT29 (Cozy Bear, The Dukes) is a threat group attributed to Russia's SVR intelligence service. Active since at least 2008.",
    created: "2015-05-15T00:00:00Z", modified: "2026-01-20T00:00:00Z",
    relatedTechniques: ["T1566.001", "T1059.001", "T1003.001", "T1021.001", "T1078", "T1105"],
    aliases: ["Cozy Bear", "The Dukes", "NOBELIUM", "Midnight Blizzard"],
  },
  {
    id: "stix-003", stixId: "malware--c3d4e5f6-a7b8-9012-cdef-123456789012", type: "malware" as const,
    name: "SUNBURST", description: "SUNBURST is a trojanized DLL planted in SolarWinds Orion software updates. It provides initial access and C2 capabilities.",
    created: "2020-12-13T00:00:00Z", modified: "2021-03-10T00:00:00Z",
    relatedTechniques: ["T1071", "T1105", "T1027"],
    labels: ["trojan", "backdoor"],
  },
  {
    id: "stix-004", stixId: "attack-pattern--d4e5f6a7-b8c9-0123-defa-234567890123", type: "attack-pattern" as const,
    name: "LSASS Memory Dumping", description: "Technique pattern for dumping LSASS process memory to extract credentials using various tools including comsvcs.dll, Mimikatz, and procdump.",
    created: "2019-03-15T00:00:00Z", modified: "2025-11-01T00:00:00Z",
    relatedTechniques: ["T1003.001"],
  },
  {
    id: "stix-005", stixId: "attack-pattern--e5f6a7b8-c9d0-1234-efab-345678901234", type: "attack-pattern" as const,
    name: "PowerShell Download Cradle", description: "Technique pattern for using PowerShell to download and execute payloads from remote servers.",
    created: "2018-06-20T00:00:00Z", modified: "2025-09-15T00:00:00Z",
    relatedTechniques: ["T1059.001", "T1105"],
  },
  {
    id: "stix-006", stixId: "indicator--f6a7b8c9-d0e1-2345-fabc-456789012345", type: "indicator" as const,
    name: "comsvcs.dll MiniDump CommandLine", description: "Command line pattern indicating use of comsvcs.dll to dump LSASS memory: contains 'comsvcs' AND 'MiniDump'.",
    created: "2022-01-10T00:00:00Z", modified: "2025-08-20T00:00:00Z",
    relatedTechniques: ["T1003.001"],
    labels: ["malicious-activity", "anomalous-activity"],
  },
];
