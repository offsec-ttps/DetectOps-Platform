/**
 * Detection Engineering Lab Templates
 *
 * Predefined infrastructure configurations for SAR, SAR+GOAD,
 * and cloud deployments across different resource tiers.
 */

// ── Types ──

export type DeploymentMode = "on-prem" | "cloud";
export type LabType = "sar" | "sar-goad" | "sar-docker";
export type CloudProvider = "aws" | "gcp" | "azure";
export type TemplateSize = "minimal" | "standard" | "full" | "custom";
export type DeploymentStatus = "idle" | "validating" | "deploying" | "provisioning" | "installing-tools" | "running" | "error" | "destroyed";

export interface SystemRequirements {
  // For on-prem templates these MUST equal the aggregate of the template's VMs
  // (sum of vms[].memoryMB → GB, sum of vms[].cpus, sum of vms[].diskGB). This
  // is what the card + feasibility check display, so a drift shows users a wrong
  // RAM/CPU/disk figure. Cloud templates use 0 (nothing runs on the host).
  ramGB: number;
  cpuCores: number;
  diskGB: number;
  gpuRequired: boolean;
  notes?: string;
}

export interface VMDefinition {
  name: string;
  role: string;
  os: string;
  ip?: string;
  cpus: number;
  memoryMB: number;
  diskGB: number;
  services: string[];
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  repo: string;
  category: "adversary-simulation" | "red-team" | "purple-team" | "utility";
  platforms: ("windows" | "linux")[];
  requirements: string[];
  installSteps: string[];
  targetVM: string; // which VM to install on
  enabled: boolean;
}

export interface LabTemplate {
  id: string;
  name: string;
  description: string;
  labType: LabType;
  mode: DeploymentMode;
  size: TemplateSize;
  cloudProvider?: CloudProvider;
  cloudTemplateRef?: string; // path in attack_range repo
  requirements: SystemRequirements;
  vms: VMDefinition[];
  tools: string[]; // tool IDs available for this template
  config: Record<string, unknown>; // provider-specific config
  recommended?: boolean;
  // Deployed from Fleet Simulation to give the fleet a Splunk to forward to —
  // grouped under "Fleet Simulation" (not "Local Lab") across the UI.
  fleetLab?: boolean;
}

// ── Tools ──

export const TOOLS: ToolDefinition[] = [
  {
    id: "purplesharp",
    name: "PurpleSharp",
    description: "Adversary simulation tool for Windows Active Directory environments. Executes ATT&CK techniques to test detection capabilities.",
    repo: "https://github.com/mvelazc0/PurpleSharp",
    category: "adversary-simulation",
    platforms: ["windows"],
    requirements: [".NET Framework 3.5+", "Windows x64", "Domain-joined preferred", "Local admin"],
    installSteps: [
      "Detect target architecture (x64/x86)",
      "Verify .NET Framework 3.5 is installed, install if missing",
      "Download latest PurpleSharp release binary",
      "Copy to target VM (C:\\Tools\\PurpleSharp\\)",
      "Create exclusion in Windows Defender for tool path",
      "Verify execution with --help flag",
    ],
    targetVM: "windows_domain_controller",
    enabled: true,
  },
  {
    id: "rta",
    name: "RTA (Red Team Automation)",
    description: "Framework for testing detection rules by simulating adversary techniques. Python-based scripts mapped to ATT&CK.",
    repo: "https://github.com/endgameinc/RTA",
    category: "red-team",
    platforms: ["windows", "linux"],
    requirements: ["Python 3.6+", "Admin/root access"],
    installSteps: [
      "Clone RTA repository",
      "Install Python dependencies",
      "Configure target environment variables",
      "Verify execution with test script",
    ],
    targetVM: "windows_domain_controller",
    enabled: true,
  },
  {
    id: "atomic-red-team",
    name: "Atomic Red Team",
    description: "Library of small, portable detection tests mapped to MITRE ATT&CK. Already integrated with SAR.",
    repo: "https://github.com/redcanaryco/atomic-red-team",
    category: "red-team",
    platforms: ["windows", "linux"],
    requirements: ["PowerShell 5.1+"],
    installSteps: [
      "Install Invoke-AtomicRedTeam module",
      "Download atomics folder",
      "Configure execution policy",
    ],
    targetVM: "windows_domain_controller",
    enabled: true,
  },
];

// ── On-Prem Templates ──

export const ON_PREM_TEMPLATES: LabTemplate[] = [
  // SAR-only templates
  {
    id: "sar-minimal",
    name: "SAR Minimal",
    description: "Lightweight setup with Splunk server and a single Windows Domain Controller. Ideal for quick detection testing with limited resources.",
    labType: "sar",
    mode: "on-prem",
    size: "minimal",
    requirements: { ramGB: 6, cpuCores: 3, diskGB: 35, gpuRequired: false, notes: "Runs on most modern laptops" },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM", os: "Ubuntu 18.04", ip: "10.0.1.12", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["Splunk Enterprise", "Splunk ESCU", "Caldera"] },
      { name: "windows-dc", role: "Domain Controller", os: "Windows Server 2016", ip: "10.0.1.14", cpus: 1, memoryMB: 2048, diskGB: 15, services: ["AD DS", "DNS", "Splunk UF", "Sysmon", "ART"] },
    ],
    tools: ["purplesharp", "atomic-red-team"],
    config: {
      provider: "virtualbox",
      network: "10.0.1.0/24",
      splunk_admin_password: "I-l1ke-Attack-Range!",
      splunk_version: "8.0.2",
    },
    recommended: true,
  },
  {
    // Same lab as sar-minimal, deployed from Fleet Simulation to give the fleet a
    // Splunk to forward to. Flagged fleetLab so it groups under "Fleet Simulation"
    // (not "Local Lab") in the Campaign Designer.
    id: "sar-fleet-detection",
    name: "Fleet Detection Lab (Splunk + Windows)",
    description: "Ubuntu Splunk Enterprise + a Windows host running the Universal Forwarder + Sysmon, for real-time fleet Simulation & Detection. Splunk listens on 0.0.0.0 so fleet endpoints can forward to it.",
    labType: "sar",
    mode: "on-prem",
    size: "minimal",
    requirements: { ramGB: 6, cpuCores: 3, diskGB: 35, gpuRequired: false, notes: "Runs on most modern laptops" },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM", os: "Ubuntu 18.04", ip: "10.0.1.12", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["Splunk Enterprise", "Splunk ESCU", "Caldera"] },
      { name: "windows-dc", role: "Windows telemetry host", os: "Windows Server 2016", ip: "10.0.1.14", cpus: 1, memoryMB: 2048, diskGB: 15, services: ["Splunk UF", "Sysmon", "ART"] },
    ],
    tools: ["purplesharp", "atomic-red-team"],
    config: {
      provider: "virtualbox",
      network: "10.0.1.0/24",
      splunk_admin_password: "I-l1ke-Attack-Range!",
      splunk_version: "8.0.2",
    },
    fleetLab: true,
  },
  {
    id: "sar-standard",
    name: "SAR Standard",
    description: "Full SAR deployment with Splunk, Domain Controller, Windows Server, and Kali attack machine.",
    labType: "sar",
    mode: "on-prem",
    size: "standard",
    requirements: { ramGB: 12, cpuCores: 7, diskGB: 70, gpuRequired: false },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM", os: "Ubuntu 18.04", ip: "10.0.1.12", cpus: 4, memoryMB: 6144, diskGB: 25, services: ["Splunk Enterprise", "Splunk ESCU", "CIM", "Stream", "Caldera"] },
      { name: "windows-dc", role: "Domain Controller", os: "Windows Server 2016", ip: "10.0.1.14", cpus: 1, memoryMB: 2048, diskGB: 15, services: ["AD DS", "DNS", "Splunk UF", "Sysmon", "ART"] },
      { name: "windows-server", role: "Member Server", os: "Windows Server 2016", ip: "10.0.1.15", cpus: 1, memoryMB: 2048, diskGB: 15, services: ["Splunk UF", "Sysmon"] },
      { name: "kali", role: "Attack Machine", os: "Kali Linux", ip: "10.0.1.16", cpus: 1, memoryMB: 2048, diskGB: 15, services: ["Metasploit", "Impacket", "CrackMapExec"] },
    ],
    tools: ["purplesharp", "rta", "atomic-red-team"],
    config: {
      provider: "virtualbox",
      network: "10.0.1.0/24",
      splunk_admin_password: "I-l1ke-Attack-Range!",
      install_es: false,
    },
  },
  // SAR + GOAD templates
  {
    id: "sar-goad-minimal",
    name: "SAR + GOAD Minimal",
    description: "SAR Splunk server + SAR Windows DC combined with GOAD MINILAB (1 DC + 1 Workstation). Vulnerable AD environment with full Splunk visibility across both environments.",
    labType: "sar-goad",
    mode: "on-prem",
    size: "minimal",
    requirements: { ramGB: 16, cpuCores: 9, diskGB: 80, gpuRequired: false, notes: "Best balance of resources vs detection coverage" },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM (SAR)", os: "Ubuntu 18.04", ip: "10.0.1.12", cpus: 4, memoryMB: 6144, diskGB: 25, services: ["Splunk Enterprise", "ESCU", "CIM", "Caldera"] },
      { name: "windows-dc", role: "SAR Domain Controller", os: "Windows Server 2016", ip: "10.0.1.14", cpus: 1, memoryMB: 2048, diskGB: 15, services: ["AD DS", "DNS", "Splunk UF", "Sysmon", "ART"] },
      { name: "DC01", role: "GOAD Domain Controller", os: "Windows Server 2019", ip: "10.0.1.30", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["AD DS (mini.lab)", "DNS", "Splunk UF", "Sysmon", "Vulnerable AD config"] },
      { name: "WS01", role: "GOAD Workstation", os: "Windows 10", ip: "10.0.1.31", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["Domain-joined", "Splunk UF", "Sysmon", "CredSSP enabled"] },
    ],
    tools: ["purplesharp", "rta", "atomic-red-team"],
    config: {
      provider: "virtualbox",
      network: "10.0.1.0/24",
      goad_lab: "MINILAB",
      goad_instance_id: "d86a4c-minilab-virtualbox",
      splunk_admin_password: "I-l1ke-Attack-Range!",
      goad_domain: "mini.lab",
    },
    recommended: true,
  },
  {
    id: "sar-goad-standard",
    name: "SAR + GOAD Standard",
    description: "SAR Splunk + SAR DC with full GOAD lab — 3 Domain Controllers, 2 Servers across 3 AD forests with trust relationships, ADCS, MSSQL, and advanced misconfigurations.",
    labType: "sar-goad",
    mode: "on-prem",
    size: "standard",
    requirements: { ramGB: 28, cpuCores: 15, diskGB: 140, gpuRequired: false, notes: "Requires dedicated lab machine" },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM (SAR)", os: "Ubuntu 18.04", ip: "10.0.1.12", cpus: 4, memoryMB: 6144, diskGB: 25, services: ["Splunk Enterprise", "ESCU", "CIM", "ES (optional)"] },
      { name: "windows-dc", role: "SAR Domain Controller", os: "Windows Server 2016", ip: "10.0.1.14", cpus: 1, memoryMB: 2048, diskGB: 15, services: ["AD DS", "DNS", "Splunk UF", "Sysmon", "ART"] },
      { name: "DC01", role: "DC - sevenkingdoms.local", os: "Windows Server 2019", ip: "192.168.56.10", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["AD DS", "ADCS", "Splunk UF", "Sysmon", "MSSQL"] },
      { name: "DC02", role: "DC - north.sevenkingdoms.local", os: "Windows Server 2019", ip: "192.168.56.11", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["AD DS", "Child domain", "Splunk UF", "Sysmon"] },
      { name: "DC03", role: "DC - essos.local", os: "Windows Server 2019", ip: "192.168.56.12", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["AD DS", "Forest trust", "Splunk UF", "Sysmon"] },
      { name: "SRV02", role: "Server - north", os: "Windows Server 2019", ip: "192.168.56.22", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["IIS", "MSSQL", "Splunk UF", "Sysmon"] },
      { name: "SRV03", role: "Server - essos", os: "Windows Server 2019", ip: "192.168.56.23", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["MSSQL", "Splunk UF", "Sysmon"] },
    ],
    tools: ["purplesharp", "rta", "atomic-red-team"],
    config: {
      provider: "virtualbox",
      network: "192.168.56.0/24",
      goad_lab: "GOAD",
      splunk_admin_password: "I-l1ke-Attack-Range!",
    },
  },
  {
    id: "sar-goad-full",
    name: "SAR + GOAD Full + Kali",
    description: "Maximum coverage: SAR Splunk + DC, full GOAD AD environment (3 forests), Kali attack machine, and Enterprise Security. For dedicated security labs.",
    labType: "sar-goad",
    mode: "on-prem",
    size: "full",
    requirements: { ramGB: 34, cpuCores: 17, diskGB: 175, gpuRequired: false, notes: "Dedicated server or workstation recommended" },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM (SAR)", os: "Ubuntu 18.04", ip: "10.0.1.12", cpus: 4, memoryMB: 8192, diskGB: 40, services: ["Splunk Enterprise", "Splunk ES 6.4", "ESCU", "CIM", "MLTK", "Caldera"] },
      { name: "windows-dc", role: "SAR Domain Controller", os: "Windows Server 2016", ip: "10.0.1.14", cpus: 1, memoryMB: 2048, diskGB: 15, services: ["AD DS", "DNS", "Splunk UF", "Sysmon", "ART"] },
      { name: "DC01", role: "DC - sevenkingdoms.local", os: "Windows Server 2019", ip: "10.0.1.10", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["AD DS", "ADCS", "Splunk UF", "Sysmon"] },
      { name: "DC02", role: "DC - north.sevenkingdoms.local", os: "Windows Server 2019", ip: "10.0.1.11", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["AD DS", "Splunk UF", "Sysmon"] },
      { name: "DC03", role: "DC - essos.local", os: "Windows Server 2019", ip: "10.0.1.32", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["AD DS", "Forest trust", "Splunk UF", "Sysmon"] },
      { name: "SRV02", role: "Server - north", os: "Windows Server 2019", ip: "10.0.1.22", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["IIS", "MSSQL", "Splunk UF", "Sysmon"] },
      { name: "SRV03", role: "Server - essos", os: "Windows Server 2019", ip: "10.0.1.23", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["MSSQL", "Splunk UF", "Sysmon"] },
      { name: "kali", role: "Attack Machine", os: "Kali Linux", ip: "10.0.1.16", cpus: 2, memoryMB: 4096, diskGB: 20, services: ["Metasploit", "Impacket", "CrackMapExec", "BloodHound"] },
    ],
    tools: ["purplesharp", "rta", "atomic-red-team"],
    config: {
      provider: "virtualbox",
      network: "10.0.1.0/24",
      goad_lab: "GOAD",
      install_es: true,
    },
  },
  // SAR Cloud Deployment Docker — local docker controller that brokers cloud range builds.
  {
    id: "sar-onprem-docker",
    name: "SAR Cloud Deployment Docker",
    description:
      "Local Docker Compose stack that hosts the Splunk Attack Range v3 controller. Once started, open the web UI at localhost:4321 (REST API on localhost:4000) and pick a cloud template to build a SAR range in AWS / Azure / GCP — e.g. AWS Splunk + Kali, AWS Splunk + Windows DC, AWS SAR + GOAD. Nothing runs on the host beyond the two controller containers; the actual VMs are provisioned in the chosen cloud.",
    labType: "sar-docker",
    mode: "on-prem",
    size: "minimal",
    requirements: {
      ramGB: 3, cpuCores: 2, diskGB: 6, gpuRequired: false,
      notes: "Docker controller only — no VMs on host. Cloud creds needed to build ranges.",
    },
    vms: [
      { name: "attack_range", role: "SAR Controller (API)", os: "Docker (Python 3.11)",
        ip: "localhost:4000", cpus: 1, memoryMB: 2048, diskGB: 4,
        services: ["REST API", "attack_range core", "OpenAPI /openapi/swagger"] },
      { name: "web_app", role: "SAR Web UI", os: "Docker (Node)",
        ip: "localhost:4321", cpus: 1, memoryMB: 1024, diskGB: 2,
        services: ["Visual range builder"] },
    ],
    tools: [],
    config: {
      provider: "docker-compose",
      sar_repo: "https://github.com/splunk/attack_range",
      sar_ref: "develop",
      compose_file: "docker/docker-compose.yml",
      web_url: "http://localhost:4321",
      api_url: "http://localhost:4000",
      swagger_url: "http://localhost:4000/openapi/swagger",
    },
  },
];

// ── Cloud Templates ──

export const CLOUD_TEMPLATES: LabTemplate[] = [
  {
    id: "cloud-aws-sar-minimal",
    name: "AWS SAR Minimal",
    description: "Splunk Attack Range on AWS with 1 Splunk server and 1 Windows DC. Uses official SAR Terraform templates.",
    labType: "sar",
    mode: "cloud",
    size: "minimal",
    cloudProvider: "aws",
    cloudTemplateRef: "templates/aws_default.yml",
    requirements: { ramGB: 0, cpuCores: 0, diskGB: 0, gpuRequired: false, notes: "Requires AWS account with EC2 permissions" },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM", os: "Ubuntu 20.04 (t3.xlarge)", ip: "auto", cpus: 4, memoryMB: 16384, diskGB: 50, services: ["Splunk Enterprise", "ESCU", "CIM"] },
      { name: "windows-dc", role: "Domain Controller", os: "Windows Server 2019 (t3.large)", ip: "auto", cpus: 2, memoryMB: 8192, diskGB: 40, services: ["AD DS", "Splunk UF", "Sysmon", "ART"] },
    ],
    tools: ["purplesharp", "atomic-red-team"],
    config: {
      provider: "aws",
      region: "us-east-1",
      template_url: "https://github.com/splunk/attack_range/tree/develop/templates",
      template_file: "aws_default.yml",
    },
  },
  {
    id: "cloud-aws-sar-goad",
    name: "AWS SAR + GOAD",
    description: "Full SAR + GOAD deployment on AWS. Splunk server with GOAD AD environment using nested VirtualBox on large instances.",
    labType: "sar-goad",
    mode: "cloud",
    size: "standard",
    cloudProvider: "aws",
    cloudTemplateRef: "templates/aws_goad.yml",
    requirements: { ramGB: 0, cpuCores: 0, diskGB: 0, gpuRequired: false, notes: "Uses m5.2xlarge instances (~$0.38/hr)" },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM", os: "Ubuntu 20.04 (t3.xlarge)", ip: "auto", cpus: 4, memoryMB: 16384, diskGB: 50, services: ["Splunk Enterprise", "ESCU"] },
      { name: "goad-host", role: "GOAD Nested VMs", os: "Ubuntu 20.04 (m5.2xlarge)", ip: "auto", cpus: 8, memoryMB: 32768, diskGB: 100, services: ["VirtualBox", "GOAD MINILAB", "Nested DC01+WS01"] },
    ],
    tools: ["purplesharp", "rta", "atomic-red-team"],
    config: {
      provider: "aws",
      region: "us-east-1",
      instance_type_splunk: "t3.xlarge",
      instance_type_goad: "m5.2xlarge",
    },
  },
  {
    id: "cloud-azure-sar",
    name: "Azure SAR",
    description: "Splunk Attack Range on Azure with DC and Splunk server. Uses official Terraform templates.",
    labType: "sar",
    mode: "cloud",
    size: "standard",
    cloudProvider: "azure",
    cloudTemplateRef: "templates/azure_default.yml",
    requirements: { ramGB: 0, cpuCores: 0, diskGB: 0, gpuRequired: false, notes: "Requires Azure subscription" },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM", os: "Ubuntu 20.04 (Standard_D4s_v3)", ip: "auto", cpus: 4, memoryMB: 16384, diskGB: 50, services: ["Splunk Enterprise", "ESCU"] },
      { name: "windows-dc", role: "Domain Controller", os: "Windows Server 2019 (Standard_D2s_v3)", ip: "auto", cpus: 2, memoryMB: 8192, diskGB: 40, services: ["AD DS", "Splunk UF", "Sysmon"] },
    ],
    tools: ["purplesharp", "atomic-red-team"],
    config: { provider: "azure", region: "eastus", template_file: "azure_default.yml" },
  },
  {
    id: "cloud-gcp-sar",
    name: "GCP SAR",
    description: "Splunk Attack Range on Google Cloud Platform.",
    labType: "sar",
    mode: "cloud",
    size: "standard",
    cloudProvider: "gcp",
    cloudTemplateRef: "templates/gcp_default.yml",
    requirements: { ramGB: 0, cpuCores: 0, diskGB: 0, gpuRequired: false, notes: "Requires GCP project with Compute Engine API" },
    vms: [
      { name: "splunk-server", role: "Splunk SIEM", os: "Ubuntu 20.04 (n2-standard-4)", ip: "auto", cpus: 4, memoryMB: 16384, diskGB: 50, services: ["Splunk Enterprise", "ESCU"] },
      { name: "windows-dc", role: "Domain Controller", os: "Windows Server 2019 (n2-standard-2)", ip: "auto", cpus: 2, memoryMB: 8192, diskGB: 40, services: ["AD DS", "Splunk UF", "Sysmon"] },
    ],
    tools: ["purplesharp", "atomic-red-team"],
    config: { provider: "gcp", region: "us-central1", template_file: "gcp_default.yml" },
  },
];

// ── Helpers ──

export const ALL_TEMPLATES = [...ON_PREM_TEMPLATES, ...CLOUD_TEMPLATES];

export function getTemplate(id: string): LabTemplate | undefined {
  return ALL_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesForMode(mode: DeploymentMode): LabTemplate[] {
  return ALL_TEMPLATES.filter((t) => t.mode === mode);
}

export function getTool(id: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function canRunTemplate(template: LabTemplate, system: { ramGB: number; cpuCores: number; diskGB: number }): { feasible: boolean; warnings: string[] } {
  if (template.mode === "cloud") return { feasible: true, warnings: [] };
  const warnings: string[] = [];
  if (system.ramGB < template.requirements.ramGB) warnings.push(`Need ${template.requirements.ramGB}GB RAM, have ${system.ramGB}GB`);
  if (system.cpuCores < template.requirements.cpuCores) warnings.push(`Need ${template.requirements.cpuCores} CPU cores, have ${system.cpuCores}`);
  if (system.diskGB < template.requirements.diskGB) warnings.push(`Need ${template.requirements.diskGB}GB disk, have ${system.diskGB}GB`);
  return { feasible: warnings.length === 0, warnings };
}
