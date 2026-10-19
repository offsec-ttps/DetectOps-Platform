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
      G("Docker", "Credential Access", "Harvest secrets from containers/images.", [T("T1552.007", "Container API (secrets / tokens)", "credential-access"), T("T1552.001", "Credentials In Files (image layers, config.json)", "credential-access"), T("T1528", "Steal Application Access Token (mounted SA/IAM tokens)", "credential-access"), T("T1552.005", "Cloud Instance Metadata API (IMDS reachable from container)", "credential-access")]),
      G("Docker", "Discovery", "Enumerate containers and resources.", [T("T1613", "Container and Resource Discovery", "discovery"), T("T1526", "Cloud Service Discovery", "discovery"), T("T1082", "System Information Discovery (/.dockerenv, /proc/1/cgroup)", "discovery"), T("T1046", "Network Service Discovery (scan the Docker bridge / host)", "discovery")]),
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
      G("AWS", "Defense Evasion", "Blind the defenders.", [T("T1562.008", "Disable or Modify Cloud Logs (CloudTrail)", "defense-evasion"), T("T1578.001", "Modify Cloud Compute Infrastructure: Create Snapshot", "defense-evasion"), T("T1578.002", "Modify Cloud Compute Infrastructure: Create Cloud Instance", "defense-evasion"), T("T1535", "Unused/Unsupported Cloud Regions", "defense-evasion")]),
      G("AWS", "Credential Access", "Steal cloud creds/tokens.", [T("T1552.005", "Cloud Instance Metadata API", "credential-access"), T("T1552.001", "Credentials In Files", "credential-access"), T("T1528", "Steal Application Access Token", "credential-access"), T("T1555.006", "Credentials from Password Stores: Cloud Secrets Management Stores (Key Vault / Secrets Manager / Secret Manager)", "credential-access")]),
      G("AWS", "Discovery", "Enumerate the environment.", [T("T1580", "Cloud Infrastructure Discovery", "discovery"), T("T1526", "Cloud Service Discovery", "discovery"), T("T1087.004", "Account Discovery: Cloud Account", "discovery"), T("T1538", "Cloud Service Dashboard", "discovery"), T("T1619", "Cloud Storage Object Discovery (S3 object enumeration)", "discovery")]),
      G("AWS", "Lateral Movement", "Pivot via alternate auth material and cloud services.", [T("T1550", "Use Alternate Authentication Material (token/key reuse)", "lateral-movement"), T("T1021.007", "Remote Services: Cloud Services", "lateral-movement")]),
      G("AWS", "Collection & Exfiltration", "Take the data.", [T("T1530", "Data from Cloud Storage (S3)", "collection"), T("T1537", "Transfer Data to Cloud Account", "exfiltration")]),
      G("AWS", "Impact", "Hijack or destroy.", [T("T1496", "Resource Hijacking", "impact"), T("T1485", "Data Destruction", "impact"), T("T1578.003", "Delete Cloud Instance", "impact")]),
      G("Azure", "Initial Access", "Get into the tenant.", [T("T1078.004", "Valid Accounts: Cloud Accounts", "initial-access"), T("T1190", "Exploit Public-Facing Application", "initial-access"), T("T1199", "Trusted Relationship", "initial-access"), T("T1566", "Phishing / Consent Phishing (malicious OAuth app)", "initial-access"), T("T1621", "Multi-Factor Authentication Request Generation (MFA fatigue)", "initial-access")]),
      G("Azure", "Execution", "Run via cloud admin APIs and serverless.", [T("T1648", "Serverless Execution (backdoor Function)", "execution"), T("T1651", "Cloud Administration Command", "execution"), T("T1059.009", "Cloud API", "execution")]),
      G("Azure", "Persistence", "Durable identity footholds.", [T("T1098.001", "Additional Cloud Credentials (service principal)", "persistence"), T("T1136.003", "Create Account: Cloud Account", "persistence"), T("T1098.003", "Additional Cloud Roles", "persistence"), T("T1098.005", "Account Manipulation: Device Registration", "persistence"), T("T1556.007", "Modify Authentication Process: Hybrid Identity (AD Connect / PTA / Seamless SSO)", "persistence")]),
      G("Azure", "Privilege Escalation", "Escalate Entra/RBAC.", [T("T1548.005", "Temporary Elevated Cloud Access", "privilege-escalation"), T("T1098.003", "Additional Cloud Roles", "privilege-escalation"), T("T1484.002", "Domain Policy Modification: Domain Trust Modification (federated domain)", "privilege-escalation")]),
      G("Azure", "Defense Evasion", "Tamper with logging.", [T("T1562.008", "Disable or Modify Cloud Logs", "defense-evasion"), T("T1578.001", "Modify Cloud Compute Infrastructure: Create Snapshot", "defense-evasion")]),
      G("Azure", "Credential Access", "Harvest tokens/secrets.", [T("T1552.005", "Cloud Instance Metadata API (IMDS)", "credential-access"), T("T1528", "Steal Application Access Token", "credential-access"), T("T1555", "Credentials from Password Stores (Key Vault)", "credential-access"), T("T1555.006", "Credentials from Password Stores: Cloud Secrets Management Stores (Key Vault / Secrets Manager / Secret Manager)", "credential-access"), T("T1606.002", "Forge Web Credentials: SAML Tokens (Golden SAML)", "credential-access")]),
      G("Azure", "Discovery", "Enumerate the tenant.", [T("T1580", "Cloud Infrastructure Discovery", "discovery"), T("T1526", "Cloud Service Discovery", "discovery"), T("T1087.004", "Account Discovery: Cloud Account", "discovery"), T("T1538", "Cloud Service Dashboard", "discovery"), T("T1619", "Cloud Storage Object Discovery (Blob enumeration)", "discovery")]),
      G("Azure", "Lateral Movement", "Pivot via alternate auth material and cloud services.", [T("T1550", "Use Alternate Authentication Material (token/key reuse)", "lateral-movement"), T("T1021.007", "Remote Services: Cloud Services", "lateral-movement")]),
      G("Azure", "Collection & Exfiltration", "Take the data.", [T("T1530", "Data from Cloud Storage (Blob)", "collection"), T("T1537", "Transfer Data to Cloud Account", "exfiltration")]),
      G("Azure", "Impact", "Hijack or destroy.", [T("T1496", "Resource Hijacking", "impact"), T("T1485", "Data Destruction", "impact")]),
      G("GCP", "Initial Access", "Get into the project.", [T("T1078.004", "Valid Accounts: Cloud Accounts", "initial-access"), T("T1190", "Exploit Public-Facing Application", "initial-access"), T("T1199", "Trusted Relationship", "initial-access"), T("T1566", "Phishing / Consent Phishing (malicious OAuth app)", "initial-access")]),
      G("GCP", "Execution", "Run via cloud admin APIs and serverless.", [T("T1648", "Serverless Execution (backdoor Cloud Function)", "execution"), T("T1651", "Cloud Administration Command", "execution"), T("T1059.009", "Cloud API", "execution")]),
      G("GCP", "Persistence", "Service-account footholds.", [T("T1098.001", "Additional Cloud Credentials (SA keys)", "persistence"), T("T1136.003", "Create Account: Cloud Account", "persistence")]),
      G("GCP", "Privilege Escalation", "Escalate IAM.", [T("T1548.005", "Temporary Elevated Cloud Access", "privilege-escalation"), T("T1098.003", "Additional Cloud Roles", "privilege-escalation")]),
      G("GCP", "Defense Evasion", "Tamper with logging.", [T("T1562.008", "Disable or Modify Cloud Logs", "defense-evasion"), T("T1578.001", "Modify Cloud Compute Infrastructure: Create Snapshot", "defense-evasion")]),
      G("GCP", "Credential Access", "Steal creds/tokens.", [T("T1552.005", "Cloud Instance Metadata API", "credential-access"), T("T1528", "Steal Application Access Token", "credential-access"), T("T1555.006", "Credentials from Password Stores: Cloud Secrets Management Stores (Key Vault / Secrets Manager / Secret Manager)", "credential-access")]),
      G("GCP", "Discovery", "Enumerate the project.", [T("T1580", "Cloud Infrastructure Discovery", "discovery"), T("T1526", "Cloud Service Discovery", "discovery"), T("T1087.004", "Account Discovery: Cloud Account", "discovery"), T("T1538", "Cloud Service Dashboard", "discovery"), T("T1619", "Cloud Storage Object Discovery (GCS object enumeration)", "discovery")]),
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
    // AD-SPECIFIC only: every technique here targets or abuses the domain
    // (Kerberos/NTLM-in-domain, LDAP/AD objects, DCs, trusts, AD CS, GPO,
    // delegation, the domain credential store). Generic host techniques (generic
    // LSASS, WMI/RDP, log-clearing, cloud account-manipulation, generic host/
    // network discovery) are intentionally excluded — they live in Hacktools.
    // The attack-catalog view additionally scopes this library to WINDOWS atomic
    // tests, so cross-platform/cloud tests of a shared technique never leak in.
    // NTDS.dit (T1003.003, the "Volume Shadow Copy" tests) IS AD: it is how the
    // whole domain's password database is stolen from a domain controller.
    catalog: [
      G("Active Directory", "Discovery", "Enumerate the domain — users, groups, trusts, DCs, shares and GPOs (PowerView, SharpHound/BloodHound, nltest, net).", [T("T1087.002", "Account Discovery: Domain Account", "discovery"), T("T1069.002", "Permission Groups: Domain Groups", "discovery"), T("T1482", "Domain Trust Discovery", "discovery"), T("T1018", "Remote System Discovery (locate domain controllers)", "discovery"), T("T1201", "Password Policy Discovery", "discovery"), T("T1615", "Group Policy Discovery", "discovery"), T("T1135", "Network Share Discovery (SYSVOL/NETLOGON)", "discovery")]),
      G("Active Directory", "Credential Access", "Roast, relay and dump domain credentials (Rubeus, Impacket, Mimikatz, Responder, Certipy).", [T("T1558.003", "Kerberoasting", "credential-access"), T("T1558.004", "AS-REP Roasting", "credential-access"), T("T1110.003", "Brute Force: Password Spraying", "credential-access"), T("T1003.006", "OS Credential Dumping: DCSync", "credential-access"), T("T1003.003", "OS Credential Dumping: NTDS.dit (ntdsutil / VSS / secretsdump)", "credential-access"), T("T1557.001", "LLMNR/NBT-NS Poisoning and SMB Relay (Responder)", "credential-access"), T("T1187", "Forced Authentication / coercion (PetitPotam, PrinterBug)", "credential-access"), T("T1552.006", "Unsecured Credentials: Group Policy Preferences (cpassword)", "credential-access"), T("T1649", "Steal or Forge Authentication Certificates (AD CS ESC1-ESC8, Certipy)", "credential-access"), T("T1110.002", "Brute Force: Password Cracking (crack/shuck Kerberoast & AS-REP hashes, hashcat)", "credential-access"), T("T1555", "Credentials from Password Stores (LAPS / gMSA read)", "credential-access")]),
      G("Active Directory", "Privilege Escalation", "Escalate toward domain dominance (SID history, GPO abuse, trust/delegation).", [T("T1134.005", "Access Token Manipulation: SID-History Injection", "privilege-escalation"), T("T1484.001", "Domain Policy Modification: Group Policy Modification", "privilege-escalation"), T("T1484.002", "Domain Policy Modification: Domain Trust Modification", "privilege-escalation"), T("T1098", "Account Manipulation (AdminSDHolder, AD ACL/ACE abuse, RBCD write, group changes)", "privilege-escalation"), T("T1068", "Exploitation for Privilege Escalation (PrintNightmare, noPac/sAMAccountName)", "privilege-escalation")]),
      G("Active Directory", "Persistence", "Hold the domain — forged tickets, rogue DC, backdoor accounts, Skeleton Key.", [T("T1558.001", "Golden Ticket", "persistence"), T("T1558.002", "Silver Ticket", "persistence"), T("T1207", "Rogue Domain Controller (DCShadow)", "persistence"), T("T1136.002", "Create Account: Domain Account", "persistence"), T("T1556.001", "Modify Authentication Process: Domain Controller Authentication (Skeleton Key)", "persistence"), T("T1547.005", "Boot/Logon Autostart: Security Support Provider (Custom SSP on DC)", "persistence")]),
      G("Active Directory", "Lateral Movement", "Move with domain credentials and tickets (PtH, PtT/overpass, PsExec, WinRM, DCOM).", [T("T1550.002", "Use Alternate Authentication Material: Pass the Hash", "lateral-movement"), T("T1550.003", "Use Alternate Authentication Material: Pass the Ticket", "lateral-movement"), T("T1021.002", "Remote Services: SMB/Windows Admin Shares (PsExec)", "lateral-movement"), T("T1021.006", "Remote Services: Windows Remote Management (WinRM)", "lateral-movement"), T("T1021.003", "Remote Services: Distributed Component Object Model (DCOM)", "lateral-movement"), T("T1569.002", "System Services: Service Execution (PsExec)", "lateral-movement"), T("T1570", "Lateral Tool Transfer", "lateral-movement"), T("T1210", "Exploitation of Remote Services (MSSQL AD abuse & trusted links)", "lateral-movement"), T("T1563.002", "Remote Service Session Hijacking: RDP Hijacking", "lateral-movement"), T("T1072", "Software Deployment Tools (SCCM / Lansweeper abuse)", "lateral-movement")]),
      G("Active Directory", "Collection", "Stage domain data from shares and logon scripts (SYSVOL/NETLOGON, mapped drives).", [T("T1039", "Data from Network Shared Drive", "collection")]),
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

// Process Injection (T1055 sub-techniques) — the second Attack Technique Library.
// Comprehensive coverage: Windows (DLL Injection, Process Hollowing, APC, Module Stomping, Doppelgänging),
// Linux (ptrace, /proc/[pid]/mem), macOS (DYLD_INSERT_LIBRARIES) — each with kill-chain,
// curated atomics, SPL + Sigma detection queries, and mitigations.
const PROCESS_INJECTION: ModuleManifest = {
  id: "detectops.process-injection-sim", name: "Process Injection", version: "1.0.0",
  category: "privilege-escalation", description: "Process Injection techniques (T1055) across Windows, Linux, and macOS — DLL Injection, Process Hollowing, APC Injection, Ptrace, DYLD preload, and more. Each technique maps to Atomic Red Team tests, Sysmon/ETW telemetry, and detection queries (SPL + Sigma).",
  author: "DetectOps", icon: "Syringe", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-sim", nav: [{ label: "Process Injection Simulation", icon: "Syringe" }],
    catalog: [
      { name: "Windows", domain: "Remote Thread & DLL", description: "Inject code into a remote process via CreateRemoteThread, DLL mapping, or memory overwrite.", techniques: [T("T1055.001", "DLL Injection (CreateRemoteThread)", "privilege-escalation"), T("T1055.002", "Reflective DLL Injection", "defense-evasion"), T("T1055.004", "APC Injection (Early Bird)", "defense-evasion"), T("T1055.003", "Thread Execution Hijacking", "defense-evasion"), T("T1055.001", "Module Stomping", "defense-evasion"), T("T1055.013", "Process Doppelgänging (TxF)", "defense-evasion"), T("T1055.012", "Process Hollowing", "defense-evasion")] },
      { name: "Linux", domain: "System Call & Memory", description: "Inject code via ptrace syscalls or /proc memory writes.", techniques: [T("T1055.008", "Ptrace System Call Injection", "privilege-escalation"), T("T1055.009", "/proc/[pid]/mem Injection", "privilege-escalation")] },
      { name: "macOS", domain: "Dynamic Linker & Libraries", description: "Preload attacker libraries via environment variables or task manipulation.", techniques: [T("T1574.006", "DYLD_INSERT_LIBRARIES Preload", "persistence")] },
    ],
  },
};

// ─── Tactic-lens Attack Simulation libraries (Windows + Linux) ────────────────
// These are a TACTIC lens over the same atomic library (like AD/Hacktools are a
// domain/tool lens): Privilege Escalation and Lateral Movement across OSes, plus
// three focused Windows escalation libraries (UAC Bypass, User→Admin, User→SYSTEM).
// Each technique appears at most once PER MODULE (no intra-module duplicates); the
// same ATT&CK id may appear across modules because they are different lenses.

const PRIVESC: ModuleManifest = {
  id: "detectops.privesc", name: "Privilege Escalation", version: "1.0.0",
  category: "privilege-escalation",
  description: "Local privilege escalation across Windows and Linux — token abuse, UAC bypass, execution-flow hijacking, service/task abuse, process injection, sudo/SUID and dynamic-linker abuse — each runnable as an atomic test and detection-scored.",
  author: "DetectOps", icon: "ArrowUpCircle", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-catalog", nav: [{ label: "Privilege Escalation", icon: "ArrowUpCircle" }],
    catalog: [
      G("Windows", "Access Token Abuse", "Steal or forge tokens to run as another user.", [T("T1134.001", "Access Token Manipulation: Token Impersonation/Theft", "privilege-escalation"), T("T1134.002", "Access Token Manipulation: Create Process with Token", "privilege-escalation")]),
      G("Windows", "Bypass UAC", "Jump from medium to high integrity.", [T("T1548.002", "Abuse Elevation Control Mechanism: Bypass User Account Control", "privilege-escalation")]),
      G("Windows", "Hijack Execution Flow", "Load attacker code via search-order / path weaknesses.", [T("T1574.001", "DLL Search Order Hijacking", "privilege-escalation"), T("T1574.008", "Path Interception by Search Order Hijacking", "privilege-escalation"), T("T1574.011", "Services Registry Permissions Weakness", "privilege-escalation"), T("T1574.012", "COR_PROFILER", "privilege-escalation")]),
      G("Windows", "Event Triggered Execution", "Hook accessibility / debug / COM to run elevated.", [T("T1546.008", "Accessibility Features", "privilege-escalation"), T("T1546.012", "Image File Execution Options Injection", "privilege-escalation"), T("T1546.015", "Component Object Model Hijacking", "privilege-escalation")]),
      G("Windows", "Scheduled Task & Service", "Abuse schedulers and services for elevated execution.", [T("T1053.005", "Scheduled Task", "privilege-escalation"), T("T1543.003", "Create or Modify System Process: Windows Service", "privilege-escalation")]),
      G("Windows", "Process Injection", "Inject into a higher-privileged process.", [T("T1055.001", "Dynamic-link Library Injection", "privilege-escalation"), T("T1055.002", "Portable Executable Injection", "privilege-escalation"), T("T1055.003", "Thread Execution Hijacking", "privilege-escalation"), T("T1055.004", "Asynchronous Procedure Call", "privilege-escalation"), T("T1055.012", "Process Hollowing", "privilege-escalation")]),
      G("Windows", "Autostart & Accounts", "Persist-to-escalate, valid-account and GPO abuse, exploits.", [T("T1547.001", "Registry Run Keys / Startup Folder", "privilege-escalation"), T("T1078.003", "Valid Accounts: Local Accounts", "privilege-escalation"), T("T1484.001", "Group Policy Modification", "privilege-escalation"), T("T1068", "Exploitation for Privilege Escalation", "privilege-escalation")]),
      G("Linux", "Sudo & SUID", "Abuse sudo rules and setuid binaries (GTFOBins).", [T("T1548.001", "Setuid and Setgid", "privilege-escalation"), T("T1548.003", "Sudo and Sudo Caching", "privilege-escalation")]),
      G("Linux", "Scheduled Jobs & Services", "Abuse cron and systemd for root.", [T("T1053.003", "Cron", "privilege-escalation"), T("T1543.002", "Systemd Service", "privilege-escalation")]),
      G("Linux", "Dynamic Linker Hijacking", "Preload attacker libraries.", [T("T1574.006", "Dynamic Linker Hijacking (LD_PRELOAD)", "privilege-escalation")]),
    ],
  },
};

const LATERAL: ModuleManifest = {
  id: "detectops.lateral-movement", name: "Lateral Movement", version: "1.0.0",
  category: "lateral-movement",
  description: "Move between hosts — remote services (RDP/SMB/DCOM/SSH/WinRM/VNC), pass-the-hash/ticket, session hijacking, remote execution (PsExec/WMI), deployment-tool abuse and exploitation — each runnable as an atomic test and detection-scored.",
  author: "DetectOps", icon: "Network", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-catalog", nav: [{ label: "Lateral Movement", icon: "Network" }],
    catalog: [
      G("General", "Remote Services", "Authenticate to and run on remote hosts.", [T("T1021.001", "Remote Desktop Protocol", "lateral-movement"), T("T1021.002", "SMB/Windows Admin Shares", "lateral-movement"), T("T1021.003", "Distributed Component Object Model (DCOM)", "lateral-movement"), T("T1021.004", "SSH", "lateral-movement"), T("T1021.005", "VNC", "lateral-movement"), T("T1021.006", "Windows Remote Management (WinRM)", "lateral-movement")]),
      G("General", "Alternate Authentication Material", "Reuse hashes/tickets/tokens instead of passwords.", [T("T1550.002", "Pass the Hash", "lateral-movement"), T("T1550.003", "Pass the Ticket", "lateral-movement"), T("T1550.001", "Application Access Token", "lateral-movement")]),
      G("General", "Remote Service Session Hijacking", "Ride existing sessions.", [T("T1563.001", "SSH Hijacking", "lateral-movement"), T("T1563.002", "RDP Hijacking", "lateral-movement")]),
      G("General", "Remote Execution & Tooling", "Execute code and move tools across hosts.", [T("T1569.002", "System Services: Service Execution (PsExec)", "lateral-movement"), T("T1047", "Windows Management Instrumentation", "lateral-movement"), T("T1570", "Lateral Tool Transfer", "lateral-movement"), T("T1072", "Software Deployment Tools", "lateral-movement")]),
      G("General", "Exploitation & Spread", "Exploit services and spread via shared media/content.", [T("T1210", "Exploitation of Remote Services", "lateral-movement"), T("T1534", "Internal Spearphishing", "lateral-movement"), T("T1080", "Taint Shared Content", "lateral-movement"), T("T1091", "Replication Through Removable Media", "lateral-movement")]),
    ],
  },
};

const UAC_BYPASS: ModuleManifest = {
  id: "detectops.uac-bypass", name: "UAC Bypass", version: "1.0.0",
  category: "uac-bypass",
  description: "Windows User Account Control bypass methods — auto-elevating binaries, registry/env hijacks and COM elevation (fodhelper, eventvwr, sdclt, computerdefaults, ICMLuaUtil, cmstp, DiskCleanup, wsreset) — each runnable as an atomic test and detection-scored.",
  author: "DetectOps", icon: "ShieldOff", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-catalog", nav: [{ label: "UAC Bypass", icon: "ShieldOff" }],
    catalog: [
      G("Windows", "UAC Bypass", "Elevate from medium to high integrity without a prompt.", [T("T1548.002", "Abuse Elevation Control Mechanism: Bypass User Account Control", "privilege-escalation")]),
      G("Windows", "COM-based Elevation", "Auto-elevated COM interfaces (ICMLuaUtil, IFileOperation).", [T("T1546.015", "Component Object Model Hijacking", "privilege-escalation")]),
    ],
  },
};

const USER_TO_ADMIN: ModuleManifest = {
  id: "detectops.user-to-admin", name: "User to Admin", version: "1.0.0",
  category: "user-to-admin",
  description: "Escalation paths from an unprivileged Windows user to local Administrator — UAC bypass, weak service/registry permissions, execution-flow hijacking, IFEO/run-key abuse, token theft and exploitation — each runnable as an atomic test and detection-scored.",
  author: "DetectOps", icon: "UserCog", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-catalog", nav: [{ label: "User to Admin", icon: "UserCog" }],
    catalog: [
      G("Windows", "Integrity Bypass", "Medium → high integrity.", [T("T1548.002", "Bypass User Account Control", "privilege-escalation")]),
      G("Windows", "Weak Service & Registry Permissions", "Abuse misconfigured services and paths.", [T("T1543.003", "Create or Modify System Process: Windows Service", "privilege-escalation"), T("T1574.011", "Services Registry Permissions Weakness", "privilege-escalation"), T("T1574.009", "Path Interception by Unquoted Path", "privilege-escalation")]),
      G("Windows", "Execution-Flow Hijacking", "Load code into a privileged process.", [T("T1574.001", "DLL Search Order Hijacking", "privilege-escalation"), T("T1574.012", "COR_PROFILER", "privilege-escalation")]),
      G("Windows", "Triggered & Autostart", "IFEO, run keys and scheduled tasks.", [T("T1546.012", "Image File Execution Options Injection", "privilege-escalation"), T("T1547.001", "Registry Run Keys / Startup Folder", "privilege-escalation"), T("T1053.005", "Scheduled Task", "privilege-escalation")]),
      G("Windows", "Token & Exploitation", "Impersonate tokens and exploit.", [T("T1134.001", "Access Token Manipulation: Token Impersonation/Theft", "privilege-escalation"), T("T1068", "Exploitation for Privilege Escalation", "privilege-escalation"), T("T1078.003", "Valid Accounts: Local Accounts", "privilege-escalation")]),
    ],
  },
};

const USER_TO_SYSTEM: ModuleManifest = {
  id: "detectops.user-to-system", name: "User to SYSTEM", version: "1.0.0",
  category: "user-to-system",
  description: "Escalation from a Windows user/admin to NT AUTHORITY\\\\SYSTEM — SeImpersonate 'Potato' token abuse (PrintSpoofer, JuicyPotato, GodPotato), service- and task-as-SYSTEM, named-pipe impersonation, process injection and service DLL hijack — each runnable as an atomic test and detection-scored.",
  author: "DetectOps", icon: "Crown", compatibleCoreVersion: "^1.0.0",
  permissions: { frameworks: ["atomic"], integrations: ["siem"], dataScopes: ["atomic-catalogue:read"] }, dependencies: [],
  contributes: {
    scenarios: [], view: "attack-catalog", nav: [{ label: "User to SYSTEM", icon: "Crown" }],
    catalog: [
      G("Windows", "Token Impersonation (Potato)", "SeImpersonate → SYSTEM via named-pipe / RPC coercion.", [T("T1134.001", "Access Token Manipulation: Token Impersonation/Theft", "privilege-escalation"), T("T1134.002", "Create Process with Token", "privilege-escalation"), T("T1134.003", "Make and Impersonate Token", "privilege-escalation")]),
      G("Windows", "Service & Task as SYSTEM", "Run payloads under SYSTEM services and tasks.", [T("T1543.003", "Create or Modify System Process: Windows Service", "privilege-escalation"), T("T1569.002", "System Services: Service Execution", "privilege-escalation"), T("T1053.005", "Scheduled Task", "privilege-escalation")]),
      G("Windows", "Injection into SYSTEM", "Inject into a SYSTEM-owned process.", [T("T1055.012", "Process Hollowing", "privilege-escalation"), T("T1055.001", "Dynamic-link Library Injection", "privilege-escalation"), T("T1055.004", "Asynchronous Procedure Call", "privilege-escalation")]),
      G("Windows", "Service DLL Hijack", "Hijack a DLL loaded by a SYSTEM service.", [T("T1574.001", "DLL Search Order Hijacking", "privilege-escalation")]),
    ],
  },
};

const MODULES = [LOTL, PHISHING, APT, CONTAINER, CLOUD, AD_LIB, HACKTOOLS, CLICKFIX, PROCESS_INJECTION, PRIVESC, LATERAL, UAC_BYPASS, USER_TO_ADMIN, USER_TO_SYSTEM];

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
