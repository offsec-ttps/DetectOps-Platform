/**
 * First-party simulation modules seeded as LIVE (LOTL, Phishing). They use the
 * "technique-catalog" built-in view; their catalogue techniques resolve to
 * atomic tests at simulate-time. Idempotent upsert by moduleId. Ransomware is a
 * separate module (acme.ransomware-sim) using the ransomware-intel view.
 */

import { prisma } from "@/lib/prisma";
import type { ModuleManifest } from "./types";
import { moduleContentHash, signModule } from "./signing";

function T(id: string, name: string, tactic: string) { return { id, name, tactic }; }

const LOTL: ModuleManifest = {
  id: "detectops.lotl-sim", name: "Living-off-the-Land Simulation", version: "1.0.0",
  category: "discovery", description: "Abuse of built-in OS binaries (LOLBins) for execution, ingress, and recon — the stealthy tradecraft behind most hands-on-keyboard intrusions.",
  author: "DetectOps", icon: "Terminal", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "technique-catalog", nav: [{ label: "LOTL Simulation", icon: "Terminal" }],
    catalog: [
      { name: "LOLBin Execution", description: "Execute payloads through trusted signed binaries.", techniques: [T("T1059.001", "PowerShell", "execution"), T("T1059.003", "Windows Command Shell", "execution"), T("T1218.011", "Rundll32", "defense-evasion"), T("T1218.010", "Regsvr32", "defense-evasion"), T("T1218.005", "Mshta", "defense-evasion")] },
      { name: "Ingress & Proxy Execution", description: "Download/stage tooling with native utilities.", techniques: [T("T1105", "Ingress Tool Transfer (certutil/bitsadmin)", "command-and-control"), T("T1197", "BITS Jobs", "defense-evasion"), T("T1218.007", "Msiexec", "defense-evasion")] },
      { name: "Native Recon & Persistence", description: "Discovery + persistence via built-in tooling.", techniques: [T("T1047", "Windows Management Instrumentation", "execution"), T("T1053.005", "Scheduled Task", "persistence"), T("T1016", "System Network Configuration Discovery", "discovery")] },
    ],
  },
};

const PHISHING: ModuleManifest = {
  id: "detectops.phishing-sim", name: "Phishing Simulation", version: "1.0.0",
  category: "phishing", description: "Phishing delivery and user-execution tradecraft — attachments, links, and the follow-on payload execution that detection should catch.",
  author: "DetectOps", icon: "Mail", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "phishing-sim", nav: [{ label: "Phishing Simulation", icon: "Mail" }],
    catalog: [
      { name: "Delivery", description: "Initial-access phishing vectors.", techniques: [T("T1566.001", "Spearphishing Attachment", "initial-access"), T("T1566.002", "Spearphishing Link", "initial-access"), T("T1566.003", "Spearphishing via Service", "initial-access")] },
      { name: "User Execution", description: "Payload execution after the user interacts.", techniques: [T("T1204.001", "Malicious Link", "execution"), T("T1204.002", "Malicious File", "execution"), T("T1059.001", "PowerShell (macro/payload)", "execution")] },
      { name: "Reconnaissance", description: "Phishing for information / credentials.", techniques: [T("T1598", "Phishing for Information", "reconnaissance"), T("T1598.003", "Spearphishing Link (recon)", "reconnaissance")] },
    ],
  },
};

const APT: ModuleManifest = {
  id: "detectops.apt-sim", name: "APT Simulation", version: "1.0.0",
  category: "apt", description: "Atomic emulation of named APT groups — browse by origin country and targeted sector, then run each group's Atomic Red Team tests. Snapshot imported from CyberGeoOps.",
  author: "DetectOps", icon: "Globe", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    // The whole imported library IS the catalogue (browsed in the apt-catalog
    // view by country + sector); no curated quick-run groups are needed.
    scenarios: [], view: "apt-catalog", nav: [{ label: "APT Simulation", icon: "Globe" }],
    catalog: [],
  },
};

// Group helper for the attack-catalog view: name = tactic label, domain = sub-domain.
function G(domain: string, tactic: string, description: string, techniques: Array<{ id: string; name: string; tactic: string }>) {
  return { name: tactic, domain, description, techniques };
}

// ─── Container & Orchestration Attack (Docker + Kubernetes) ───────────────────
const CONTAINER: ModuleManifest = {
  id: "detectops.container-attack", name: "Container & Orchestration Attack", version: "1.0.0",
  category: "container", description: "Offensive techniques against Docker and Kubernetes — gaining access, escaping containers to the host, privilege escalation, evasion and impact — each runnable as an atomic test and detection-scored.",
  author: "DetectOps", icon: "Boxes", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-catalog", nav: [{ label: "Container & Orchestration Attack", icon: "Boxes" }],
    catalog: [
      G("Docker", "Initial Access", "Reach a Docker host and get code running.", [T("T1610", "Deploy Container (exposed Docker API 2375/2376)", "initial-access"), T("T1133", "External Remote Services (unauth daemon)", "initial-access"), T("T1525", "Implant Internal Image", "persistence"), T("T1204.003", "User Execution: Malicious Image", "execution"), T("T1190", "Exploit Public-Facing Application (Docker API/registry)", "initial-access"), T("T1195.002", "Supply Chain Compromise: Compromise Software Supply Chain", "initial-access"), T("T1078", "Valid Accounts (compromised registry creds)", "initial-access")]),
      G("Docker", "Execution", "Run commands in / deploy containers.", [T("T1609", "Container Administration Command (docker exec)", "execution"), T("T1610", "Deploy Container", "execution"), T("T1612", "Build Image on Host", "defense-evasion"), T("T1059.004", "Unix Shell", "execution")]),
      G("Docker", "Privilege Escalation / Escape to Host", "Break out of the container to the host.", [T("T1611", "Escape to Host (privileged, docker.sock, caps, nsenter)", "privilege-escalation"), T("T1610", "Deploy Container (privileged)", "privilege-escalation")]),
      G("Docker", "Defense Evasion", "Disable controls / remove traces.", [T("T1562.001", "Impair Defenses: Disable seccomp/AppArmor", "defense-evasion"), T("T1070", "Indicator Removal (clear container logs)", "defense-evasion"), T("T1036", "Masquerading (rename malicious process to app name)", "defense-evasion")]),
      G("Docker", "Credential Access", "Harvest secrets from containers/images.", [T("T1552.007", "Container API (secrets / tokens)", "credential-access"), T("T1552.001", "Credentials In Files (image layers, config.json)", "credential-access"), T("T1528", "Steal Application Access Token (mounted SA/IAM tokens)", "credential-access")]),
      G("Docker", "Discovery", "Enumerate containers and resources.", [T("T1613", "Container and Resource Discovery", "discovery"), T("T1526", "Cloud Service Discovery", "discovery"), T("T1082", "System Information Discovery (/.dockerenv, /proc/1/cgroup)", "discovery")]),
      G("Docker", "Persistence", "Survive restarts on host/daemon.", [T("T1525", "Implant Internal Image", "persistence"), T("T1053.003", "Cron (host, via mount)", "persistence"), T("T1543.002", "Systemd Service (host, via mount)", "persistence"), T("T1136", "Create Account / persistent restart policy", "persistence")]),
      G("Docker", "Impact", "Abuse or break the host.", [T("T1496", "Resource Hijacking (cryptomining)", "impact"), T("T1485", "Data Destruction", "impact"), T("T1499", "Endpoint Denial of Service", "impact")]),
      G("Docker", "Lateral Movement", "Pivot across the Docker bridge network.", [T("T1021", "Remote Services (internal bridge pivot)", "lateral-movement")]),
      G("Docker", "Exfiltration", "Exfiltrate data via the daemon's NAT egress.", [T("T1041", "Exfiltration Over C2 Channel", "exfiltration")]),
      G("Kubernetes", "Initial Access", "Reach the cluster.", [T("T1190", "Exploit Public-Facing Application (API server/kubelet)", "initial-access"), T("T1610", "Deploy Container", "initial-access"), T("T1133", "External Remote Services", "initial-access"), T("T1078", "Valid Accounts (anonymous API / stolen kubeconfig)", "initial-access"), T("T1210", "Exploitation of Remote Services (kubelet 10250 / API server)", "initial-access"), T("T1195.002", "Supply Chain Compromise: Compromise Software Supply Chain", "initial-access"), T("T1552.004", "Unsecured Credentials: Private Keys (kubeconfig/client cert)", "credential-access")]),
      G("Kubernetes", "Execution", "Run in / create pods.", [T("T1609", "Container Administration Command (kubectl exec)", "execution"), T("T1610", "Deploy Container", "execution")]),
      G("Kubernetes", "Privilege Escalation", "Escalate within / out of the cluster.", [T("T1611", "Escape to Host (privileged pod)", "privilege-escalation"), T("T1548", "Abuse Elevation Control Mechanism", "privilege-escalation"), T("T1098", "Account Manipulation (RBAC abuse / clusterrolebinding to cluster-admin)", "privilege-escalation")]),
      G("Kubernetes", "Credential Access", "Steal service-account tokens & secrets.", [T("T1552.007", "Container API (service-account tokens, secrets)", "credential-access"), T("T1528", "Steal Application Access Token", "credential-access"), T("T1552.005", "Cloud Instance Metadata API (IMDS from a pod)", "credential-access")]),
      G("Kubernetes", "Defense Evasion", "Blind cluster telemetry and bypass admission.", [T("T1070", "Indicator Removal (delete pods/events)", "defense-evasion"), T("T1562.001", "Impair Defenses: Disable audit logging", "defense-evasion")]),
      G("Kubernetes", "Discovery", "Map the cluster.", [T("T1613", "Container and Resource Discovery", "discovery"), T("T1580", "Cloud Infrastructure Discovery", "discovery"), T("T1526", "Cloud Service Discovery", "discovery"), T("T1087.004", "Account Discovery: Cloud Account (kubectl auth can-i / RBAC enum)", "discovery"), T("T1046", "Network Service Discovery (internal scan / DNS)", "discovery")]),
      G("Kubernetes", "Lateral Movement", "Pivot across pods and to the node/cloud.", [T("T1021", "Remote Services (pod-to-pod)", "lateral-movement"), T("T1210", "Exploitation of Remote Services (kubelet node pivot)", "lateral-movement")]),
      G("Kubernetes", "Persistence", "Hold access in the cluster.", [T("T1610", "Deploy Container", "persistence"), T("T1053.007", "Container Orchestration Job (CronJob)", "persistence"), T("T1133", "External Remote Services", "persistence"), T("T1098", "Account Manipulation (rolebinding backdoor / admission webhook)", "persistence")]),
      G("Kubernetes", "Impact", "Abuse cluster resources.", [T("T1496", "Resource Hijacking", "impact"), T("T1499", "Endpoint Denial of Service", "impact"), T("T1485", "Data Destruction (delete cluster resources)", "impact")]),
    ],
  },
};

// ─── Cloud Attack (AWS + Azure + GCP) ─────────────────────────────────────────
const CLOUD: ModuleManifest = {
  id: "detectops.cloud-attack", name: "Cloud Attack", version: "1.0.0",
  category: "cloud", description: "Offensive techniques against AWS, Azure and GCP — cloud-account access, IAM privilege escalation, log tampering, metadata-service credential theft, storage exfiltration and destructive impact — mapped to atomic tests.",
  author: "DetectOps", icon: "Cloud", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic", "stratus"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-catalog", nav: [{ label: "Cloud Attack", icon: "Cloud" }],
    catalog: [
      G("AWS", "Initial Access", "Get into the account.", [T("T1078.004", "Valid Accounts: Cloud Accounts", "initial-access"), T("T1190", "Exploit Public-Facing Application", "initial-access"), T("T1199", "Trusted Relationship", "initial-access"), T("T1566", "Phishing / Consent Phishing (malicious OAuth app)", "initial-access")]),
      G("AWS", "Execution", "Run via cloud APIs.", [T("T1651", "Cloud Administration Command", "execution"), T("T1059.009", "Cloud API", "execution"), T("T1648", "Serverless Execution (backdoor Lambda)", "execution")]),
      G("AWS", "Persistence", "Plant durable access.", [T("T1098.001", "Additional Cloud Credentials", "persistence"), T("T1098.003", "Additional Cloud Roles", "persistence"), T("T1136.003", "Create Account: Cloud Account", "persistence"), T("T1525", "Implant Internal Image (AMI)", "persistence")]),
      G("AWS", "Privilege Escalation", "Climb IAM.", [T("T1548.005", "Temporary Elevated Cloud Access", "privilege-escalation"), T("T1098.003", "Additional Cloud Roles", "privilege-escalation")]),
      G("AWS", "Defense Evasion", "Blind the defenders.", [T("T1562.008", "Disable or Modify Cloud Logs (CloudTrail)", "defense-evasion"), T("T1578", "Modify Cloud Compute Infrastructure", "defense-evasion")]),
      G("AWS", "Credential Access", "Steal cloud creds/tokens.", [T("T1552.005", "Cloud Instance Metadata API", "credential-access"), T("T1552.001", "Credentials In Files", "credential-access"), T("T1528", "Steal Application Access Token", "credential-access"), T("T1555.006", "Credentials from Password Stores: Cloud Secrets Management Stores (Key Vault / Secrets Manager / Secret Manager)", "credential-access")]),
      G("AWS", "Discovery", "Enumerate the environment.", [T("T1580", "Cloud Infrastructure Discovery", "discovery"), T("T1526", "Cloud Service Discovery", "discovery"), T("T1087.004", "Account Discovery: Cloud Account", "discovery"), T("T1538", "Cloud Service Dashboard", "discovery")]),
      G("AWS", "Lateral Movement", "Pivot via alternate auth material and cloud services.", [T("T1550", "Use Alternate Authentication Material (token/key reuse)", "lateral-movement"), T("T1021.007", "Remote Services: Cloud Services", "lateral-movement")]),
      G("AWS", "Collection & Exfiltration", "Take the data.", [T("T1530", "Data from Cloud Storage (S3)", "collection"), T("T1537", "Transfer Data to Cloud Account", "exfiltration")]),
      G("AWS", "Impact", "Hijack or destroy.", [T("T1496", "Resource Hijacking", "impact"), T("T1485", "Data Destruction", "impact"), T("T1578.003", "Delete Cloud Instance", "impact")]),
      G("Azure", "Initial Access", "Get into the tenant.", [T("T1078.004", "Valid Accounts: Cloud Accounts", "initial-access"), T("T1190", "Exploit Public-Facing Application", "initial-access"), T("T1199", "Trusted Relationship", "initial-access"), T("T1566", "Phishing / Consent Phishing (malicious OAuth app)", "initial-access")]),
      G("Azure", "Execution", "Run via cloud admin APIs and serverless.", [T("T1648", "Serverless Execution (backdoor Function)", "execution"), T("T1651", "Cloud Administration Command", "execution"), T("T1059.009", "Cloud API", "execution")]),
      G("Azure", "Persistence", "Durable identity footholds.", [T("T1098.001", "Additional Cloud Credentials (service principal)", "persistence"), T("T1136.003", "Create Account: Cloud Account", "persistence"), T("T1098.003", "Additional Cloud Roles", "persistence")]),
      G("Azure", "Privilege Escalation", "Escalate Entra/RBAC.", [T("T1548.005", "Temporary Elevated Cloud Access", "privilege-escalation"), T("T1098.003", "Additional Cloud Roles", "privilege-escalation")]),
      G("Azure", "Defense Evasion", "Tamper with logging.", [T("T1562.008", "Disable or Modify Cloud Logs", "defense-evasion"), T("T1578", "Modify Cloud Compute Infrastructure", "defense-evasion")]),
      G("Azure", "Credential Access", "Harvest tokens/secrets.", [T("T1552.005", "Cloud Instance Metadata API (IMDS)", "credential-access"), T("T1528", "Steal Application Access Token", "credential-access"), T("T1555", "Credentials from Password Stores (Key Vault)", "credential-access"), T("T1555.006", "Credentials from Password Stores: Cloud Secrets Management Stores (Key Vault / Secrets Manager / Secret Manager)", "credential-access")]),
      G("Azure", "Discovery", "Enumerate the tenant.", [T("T1580", "Cloud Infrastructure Discovery", "discovery"), T("T1526", "Cloud Service Discovery", "discovery"), T("T1087.004", "Account Discovery: Cloud Account", "discovery"), T("T1538", "Cloud Service Dashboard", "discovery")]),
      G("Azure", "Lateral Movement", "Pivot via alternate auth material and cloud services.", [T("T1550", "Use Alternate Authentication Material (token/key reuse)", "lateral-movement"), T("T1021.007", "Remote Services: Cloud Services", "lateral-movement")]),
      G("Azure", "Collection & Exfiltration", "Take the data.", [T("T1530", "Data from Cloud Storage (Blob)", "collection"), T("T1537", "Transfer Data to Cloud Account", "exfiltration")]),
      G("Azure", "Impact", "Hijack or destroy.", [T("T1496", "Resource Hijacking", "impact"), T("T1485", "Data Destruction", "impact")]),
      G("GCP", "Initial Access", "Get into the project.", [T("T1078.004", "Valid Accounts: Cloud Accounts", "initial-access"), T("T1190", "Exploit Public-Facing Application", "initial-access"), T("T1199", "Trusted Relationship", "initial-access"), T("T1566", "Phishing / Consent Phishing (malicious OAuth app)", "initial-access")]),
      G("GCP", "Execution", "Run via cloud admin APIs and serverless.", [T("T1648", "Serverless Execution (backdoor Cloud Function)", "execution"), T("T1651", "Cloud Administration Command", "execution"), T("T1059.009", "Cloud API", "execution")]),
      G("GCP", "Persistence", "Service-account footholds.", [T("T1098.001", "Additional Cloud Credentials (SA keys)", "persistence"), T("T1136.003", "Create Account: Cloud Account", "persistence")]),
      G("GCP", "Privilege Escalation", "Escalate IAM.", [T("T1548.005", "Temporary Elevated Cloud Access", "privilege-escalation"), T("T1098.003", "Additional Cloud Roles", "privilege-escalation")]),
      G("GCP", "Defense Evasion", "Tamper with logging.", [T("T1562.008", "Disable or Modify Cloud Logs", "defense-evasion")]),
      G("GCP", "Credential Access", "Steal creds/tokens.", [T("T1552.005", "Cloud Instance Metadata API", "credential-access"), T("T1528", "Steal Application Access Token", "credential-access"), T("T1555.006", "Credentials from Password Stores: Cloud Secrets Management Stores (Key Vault / Secrets Manager / Secret Manager)", "credential-access")]),
      G("GCP", "Discovery", "Enumerate the project.", [T("T1580", "Cloud Infrastructure Discovery", "discovery"), T("T1526", "Cloud Service Discovery", "discovery"), T("T1087.004", "Account Discovery: Cloud Account", "discovery"), T("T1538", "Cloud Service Dashboard", "discovery")]),
      G("GCP", "Lateral Movement", "Pivot via alternate auth material and cloud services.", [T("T1550", "Use Alternate Authentication Material (token/key reuse)", "lateral-movement"), T("T1021.007", "Remote Services: Cloud Services", "lateral-movement")]),
      G("GCP", "Collection & Exfiltration", "Take the data.", [T("T1530", "Data from Cloud Storage (GCS)", "collection"), T("T1537", "Transfer Data to Cloud Account", "exfiltration")]),
      G("GCP", "Impact", "Hijack or destroy.", [T("T1496", "Resource Hijacking", "impact"), T("T1485", "Data Destruction", "impact")]),
    ],
  },
};

// ─── Active Directory Attack ──────────────────────────────────────────────────
const AD_LIB: ModuleManifest = {
  id: "detectops.ad-attack", name: "Active Directory Attack", version: "1.0.0",
  category: "active-directory", description: "On-prem Active Directory tradecraft — domain recon, Kerberoasting/AS-REP, DCSync, ticket forging, and lateral movement (PtH/PtT) — each runnable as an atomic test against the SAR/GOAD lab and detection-scored.",
  author: "DetectOps", icon: "Network", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-catalog", nav: [{ label: "Active Directory Attack", icon: "Network" }],
    catalog: [
      G("Active Directory", "Discovery", "Map the domain.", [T("T1087.002", "Account Discovery: Domain Account", "discovery"), T("T1482", "Domain Trust Discovery", "discovery"), T("T1018", "Remote System Discovery", "discovery"), T("T1069.002", "Permission Groups: Domain Groups", "discovery"), T("T1201", "Password Policy Discovery", "discovery"), T("T1046", "Network Service Discovery", "discovery")]),
      G("Active Directory", "Credential Access", "Harvest domain credentials.", [T("T1558.003", "Kerberoasting", "credential-access"), T("T1558.004", "AS-REP Roasting", "credential-access"), T("T1003.006", "DCSync", "credential-access"), T("T1003.001", "OS Credential Dumping: LSASS Memory", "credential-access"), T("T1110", "Brute Force (password spray)", "credential-access"), T("T1557.001", "LLMNR/NBT-NS Poisoning", "credential-access"), T("T1552.006", "Group Policy Preferences", "credential-access"), T("T1003.003", "OS Credential Dumping: NTDS.dit (ntdsutil/VSS)", "credential-access"), T("T1649", "Steal or Forge Authentication Certificates (AD CS ESC1-ESC8, Certipy)", "credential-access")]),
      G("Active Directory", "Privilege Escalation", "Escalate to domain dominance.", [T("T1134.005", "SID-History Injection", "privilege-escalation"), T("T1484.001", "Group Policy Modification", "privilege-escalation"), T("T1068", "Exploitation for Privilege Escalation", "privilege-escalation"), T("T1134", "Access Token Manipulation / Kerberos delegation abuse (unconstrained/constrained/RBCD)", "privilege-escalation"), T("T1134.001", "Access Token Manipulation: Token Impersonation/Theft", "privilege-escalation")]),
      G("Active Directory", "Persistence", "Hold the domain.", [T("T1558.001", "Golden Ticket", "persistence"), T("T1558.002", "Silver Ticket", "persistence"), T("T1207", "Rogue Domain Controller (DCShadow)", "persistence"), T("T1136.002", "Create Account: Domain Account", "persistence"), T("T1098", "Account Manipulation (AdminSDHolder / DSRM backdoor)", "persistence"), T("T1558", "Steal or Forge Kerberos Tickets (Diamond/Sapphire ticket)", "persistence")]),
      G("Active Directory", "Lateral Movement", "Move across the domain.", [T("T1550.002", "Pass the Hash", "lateral-movement"), T("T1550.003", "Pass the Ticket", "lateral-movement"), T("T1021.001", "Remote Desktop Protocol", "lateral-movement"), T("T1021.002", "SMB/Windows Admin Shares", "lateral-movement"), T("T1021.006", "Windows Remote Management", "lateral-movement"), T("T1047", "Windows Management Instrumentation", "lateral-movement"), T("T1570", "Lateral Tool Transfer", "lateral-movement"), T("T1021.003", "Remote Services: Distributed Component Object Model (DCOM)", "lateral-movement")]),
      G("Active Directory", "Defense Evasion", "Abuse trust & auth material.", [T("T1484.001", "Group Policy Modification", "defense-evasion"), T("T1550", "Use Alternate Authentication Material", "defense-evasion"), T("T1207", "Rogue Domain Controller", "defense-evasion"), T("T1070.001", "Indicator Removal: Clear Windows Event Logs", "defense-evasion")]),
    ],
  },
};

// ─── Hacktools (open-source offensive tooling) ────────────────────────────────
const HACKTOOLS: ModuleManifest = {
  id: "detectops.hacktools", name: "Hacktools (Open-Source)", version: "1.0.0",
  category: "hacktools", description: "Detection coverage for the open-source offensive toolset — Mimikatz, BloodHound/SharpHound, Impacket, PsExec, Rubeus, CrackMapExec, chisel and more — grouped by behavior and runnable as atomic tests.",
  author: "DetectOps", icon: "Hammer", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-catalog", nav: [{ label: "Hacktools (Open-Source)", icon: "Hammer" }],
    catalog: [
      G("Open-Source Tooling", "Credential Dumping (Mimikatz, LaZagne, Rubeus)", "Dump secrets with common tools.", [T("T1003.001", "LSASS Memory", "credential-access"), T("T1003.002", "Security Account Manager", "credential-access"), T("T1003.003", "NTDS", "credential-access"), T("T1558.003", "Kerberoasting (Rubeus)", "credential-access"), T("T1555", "Credentials from Password Stores (LaZagne)", "credential-access")]),
      G("Open-Source Tooling", "Recon & Mapping (BloodHound/SharpHound, PowerView, nmap)", "Enumerate the environment.", [T("T1087.002", "Domain Account Discovery", "discovery"), T("T1482", "Domain Trust Discovery", "discovery"), T("T1069.002", "Domain Groups", "discovery"), T("T1018", "Remote System Discovery", "discovery"), T("T1046", "Network Service Discovery", "discovery")]),
      G("Open-Source Tooling", "Execution & Lateral Movement (PsExec, Impacket, CrackMapExec)", "Run and spread.", [T("T1569.002", "Service Execution (PsExec)", "execution"), T("T1021.002", "SMB/Windows Admin Shares", "lateral-movement"), T("T1047", "Windows Management Instrumentation", "execution"), T("T1570", "Lateral Tool Transfer", "lateral-movement"), T("T1021.006", "Windows Remote Management", "lateral-movement")]),
      G("Open-Source Tooling", "Defense Evasion (AMSI/AV bypass, injectors)", "Evade controls.", [T("T1562.001", "Disable or Modify Tools", "defense-evasion"), T("T1055", "Process Injection", "defense-evasion"), T("T1027", "Obfuscated Files or Information", "defense-evasion"), T("T1070.001", "Clear Windows Event Logs", "defense-evasion")]),
      G("Open-Source Tooling", "C2 & Tunneling (chisel, ligolo)", "Command-and-control channels.", [T("T1105", "Ingress Tool Transfer", "command-and-control"), T("T1071.001", "Web Protocols", "command-and-control"), T("T1572", "Protocol Tunneling", "command-and-control"), T("T1090", "Proxy", "command-and-control")]),
      G("Open-Source Tooling", "Privilege Escalation (PEASS, GTFOBins)", "Local escalation.", [T("T1068", "Exploitation for Privilege Escalation", "privilege-escalation"), T("T1134", "Access Token Manipulation", "privilege-escalation"), T("T1548.003", "Sudo and Sudo Caching", "privilege-escalation")]),
      G("Open-Source Tooling", "Persistence (SharPersist, schtasks)", "Stay resident.", [T("T1053.005", "Scheduled Task", "persistence"), T("T1543.003", "Windows Service", "persistence"), T("T1547.001", "Registry Run Keys / Startup Folder", "persistence")]),
    ],
  },
};

// Deceptive Delivery & Execution (ClickFix) — the first Attack Technique Library.
// Its techniques (kill-chain + Simulate-via-ART + Detect + Mitigate) live in
// src/config/attack-libraries/clickfix.ts and are served to the "attack-sim" view
// via /api/attack-sim/libraries. The manifest is the registration shell.
const CLICKFIX: ModuleManifest = {
  id: "detectops.clickfix-sim", name: "Deceptive Delivery & Execution", version: "1.0.0",
  category: "deceptive-delivery", description: "ClickFix (copy-paste execution, T1204.004) and its delivery/obfuscation relatives — FileFix, mshta, HTML smuggling, ClickOnce, PixelCode, BitB — each with the kill-chain, a simulate action (vetted Atomic Red Team tests + detection scoring), curated detection logic, and attack-surface-reduction guidance.",
  author: "DetectOps", icon: "MousePointerClick", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-sim", nav: [{ label: "ClickFix Simulation", icon: "MousePointerClick" }],
    catalog: [],
  },
};

const MODULES = [LOTL, PHISHING, APT, CONTAINER, CLOUD, AD_LIB, HACKTOOLS, CLICKFIX];

export async function ensureSimulationModules(): Promise<void> {
  for (const manifest of MODULES) {
    const existing = await prisma.simulationModule.findUnique({ where: { moduleId: manifest.id } });
    const contentHash = moduleContentHash({ manifest });
    if (existing) {
      // Idempotent, but re-seed first-party manifest changes (e.g. catalog
      // additions) when the content hash differs — without clobbering operator
      // fields (enabled/status/ownerId).
      if (existing.contentHash !== contentHash) {
        // Don't overwrite a manifest an operator has edited in place: an edited
        // row's stored manifest no longer hashes to its own contentHash (the
        // hash is only rewritten by this seeder). Only an untouched first-party
        // row is refreshed; an edited one is left exactly as the operator set it.
        let operatorEdited = false;
        try {
          const storedHash = moduleContentHash({ manifest: JSON.parse(existing.manifest) });
          operatorEdited = storedHash !== existing.contentHash;
        } catch { operatorEdited = true; } // unparseable ⇒ treat as hand-modified, never clobber
        if (operatorEdited) continue;

        await prisma.simulationModule.update({
          where: { moduleId: manifest.id },
          data: {
            name: manifest.name, version: manifest.version, category: manifest.category,
            description: manifest.description, author: manifest.author, icon: manifest.icon || "",
            manifest: JSON.stringify(manifest), contentHash, signatureB64: signModule(contentHash),
            permissions: JSON.stringify(manifest.permissions),
          },
        });
        // Version history: the manifest version string usually stays the same
        // across a content refresh, so a blind create hits the
        // (moduleRowId, version) unique constraint. Update the existing version
        // row in place when present, else create it.
        const versionData = { manifest: JSON.stringify(manifest), contentHash, status: "published", signatureB64: signModule(contentHash) };
        const existingVersion = await prisma.moduleVersion.findFirst({ where: { moduleRowId: existing.id, version: manifest.version }, select: { id: true } }).catch(() => null);
        if (existingVersion) {
          await prisma.moduleVersion.update({ where: { id: existingVersion.id }, data: versionData }).catch(() => {});
        } else {
          await prisma.moduleVersion.create({ data: { moduleRowId: existing.id, version: manifest.version, ...versionData } }).catch(() => {});
        }
      }
      continue;
    }
    await prisma.simulationModule.create({
      data: {
        moduleId: manifest.id, name: manifest.name, version: manifest.version, category: manifest.category,
        description: manifest.description, author: manifest.author, icon: manifest.icon || "",
        manifest: JSON.stringify(manifest), contentHash, status: "live",
        signatureState: "verified", signatureB64: signModule(contentHash),
        permissions: JSON.stringify(manifest.permissions), packageRef: "", ownerId: "", enabled: true, installedAt: new Date(),
      },
    });
    await prisma.moduleVersion.create({ data: { moduleRowId: (await prisma.simulationModule.findUnique({ where: { moduleId: manifest.id } }))!.id, version: manifest.version, manifest: JSON.stringify(manifest), contentHash, status: "published", signatureB64: signModule(contentHash) } }).catch(() => {});
  }
}
