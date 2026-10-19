/**
 * Catalog of purpose-built analyst / lab OS images for the Deploy hub.
 *
 * These are complete, publicly distributed security workstations — forensics,
 * OSINT, reverse-engineering, and authorized-pentest distros — that an operator
 * spins up on demand during investigation, use-case development, or hunting.
 * This is distinct from the C2 framework catalog (`src/config/c2-catalog`): a
 * C2 entry installs one framework; an OS-image entry deploys a whole VM.
 *
 * Build philosophy (from the plan): store recipes/box references (KB of text),
 * NOT disk images. The local path materialises a Vagrant box from its public
 * upstream; cloud builds (Packer into the user's own AWS/Azure/GCP account) are
 * a follow-on and ship here as "coming soon" until a validated recipe exists.
 *
 * Honest availability (mirrors the C2 first-wave pattern): `build.available` is
 * true only where we have a known-good upstream box + a working deploy path.
 * Everything else is template-only (docs + guided setup), including offensive
 * red-team appliances, which are cataloged for reference but not auto-deployed.
 */

export type OsImageCategory = "forensics" | "osint" | "reverse-eng" | "pentest" | "red-team" | "malware-analysis";
export type DeployTarget = "local" | "aws" | "azure" | "gcp" | "vps";

/**
 * Optional provisioning for a `vagrant-box` entry. When present, the deploy
 * engine copies `recipeDir` into the deployment workdir and runs `script` as a
 * Vagrant shell provisioner, enabling an image to install heavy tooling on top
 * of a base box (vs. referencing a prebuilt box). `nestedVirt` turns on VT-x
 * nesting (needed by sandboxes that run their own KVM analysis guest).
 */
export interface OsImageProvision {
  /** Repo-relative dir (e.g. build-recipes/os-images/behavior-lab) copied into the workdir. */
  recipeDir: string;
  /** Entry script within recipeDir, run privileged as a shell provisioner. */
  script: string;
  nestedVirt?: boolean;
  /** Host port forwards. `hostIp` defaults to 127.0.0.1 (loopback) so an analysis
   *  appliance's UI is never exposed on all host interfaces; set it explicitly
   *  only when remote access is genuinely intended. */
  forwardedPorts?: Array<{ guest: number; host: number; name?: string; hostIp?: string }>;
  /** Local source tree (repo-relative path) copied into the deployment workdir
   *  as provision/hbl-src and synced into the guest, so the provisioner installs
   *  from it instead of cloning a remote. Heavy/ignored dirs are filtered out. */
  localSource?: string;
}

/** Per-provider cloud sizing defaults for an image's Terraform deploy. */
export interface OsImageCloudSizing {
  instanceType: string;          // nested-virt-capable default (CAPE full mode)
  fallbackInstanceType?: string; // cheaper, no nested virt → in-guest Sysmon mode
  diskGB: number;
}
export interface OsImageCloud {
  terraformDir: string;          // repo-relative dir holding the <provider>/ TF modules
  aws?: OsImageCloudSizing;
  azure?: OsImageCloudSizing;
  gcp?: OsImageCloudSizing;
}

export interface OsImageEntry {
  id: string;
  name: string;
  category: OsImageCategory;
  description: string;
  baseOs: string;
  docsUrl: string;
  /** Headline preinstalled tooling (for reference / detection context). */
  tools?: string[];
  resources: { cpus: number; memoryMB: number; diskGB: number };
  /** Infra this image can target. Only `local` is wired this phase. */
  targets: DeployTarget[];
  build: {
    method: "vagrant-box" | "packer" | "cloud-init";
    /** Public Vagrant Cloud box (method: vagrant-box) materialised on deploy. */
    boxRef?: string;
    /** Recipe dir under build-recipes/os-images/<id>/ (method: packer) — follow-on. */
    packerRef?: string;
    /** Ordered guided setup steps when there is no automated path yet. */
    guidedSteps?: string[];
    /** Shell-provisioning on top of the base box (method: vagrant-box). */
    provision?: OsImageProvision;
    /** Cloud (Terraform) sizing + module location, for targets aws/azure/gcp. */
    cloud?: OsImageCloud;
    /** false → template-only ("coming soon"); no automated deploy. */
    available: boolean;
  };
  seeded: true;
}

/** Rough on-demand hourly USD per instance type, for the pre-launch estimate.
 *  Approximate us-east-1 list prices; update as needed — informational only. */
export const CLOUD_HOURLY_USD: Record<string, number> = {
  // AWS nested-virt-capable (CAPE full mode)
  "m7i.2xlarge": 0.4032, "m7i.4xlarge": 0.8064, "c7i.2xlarge": 0.357, "r7i.2xlarge": 0.5292,
  "m8i.2xlarge": 0.4435,
  // AWS cheaper / fallback + general-purpose analyst workstations (no nested virt)
  "t3.large": 0.0832, "t3.xlarge": 0.1664, "t3.2xlarge": 0.3328, "m6i.2xlarge": 0.384,
  // Azure (Dv5 nested-virt)
  "Standard_D8s_v5": 0.384, "Standard_D4s_v5": 0.192,
  // GCP (nested-virt via flag)
  "n2-standard-8": 0.3881, "n2-standard-4": 0.1941,
};

export function priceFor(instanceType: string): number | undefined {
  return CLOUD_HOURLY_USD[instanceType];
}

const guided = (name: string, url: string): string[] => [
  `Provision a VM in your lab (isolated from production) sized per the requirements below.`,
  `Download ${name} from its official source: ${url}`,
  `Verify the published checksum / signature before importing.`,
  `Import the appliance (OVA) or install from ISO into VirtualBox / your hypervisor.`,
  `Snapshot the clean state so you can revert after each investigation.`,
  `Attach it to the lab network and begin your analysis / hunt.`,
];

export const OS_IMAGE_CATALOG: OsImageEntry[] = [
  // ── Pentest — one wired local box (first wave) ──
  {
    id: "kali",
    name: "Kali Linux",
    category: "pentest",
    description:
      "The standard authorized-pentest distribution. Local uses the official Kali Vagrant box; cloud/VPS install the Kali toolset (kali-linux-headless) on Ubuntu over SSH.",
    baseOs: "Kali Rolling (Debian)",
    docsUrl: "https://www.kali.org/docs/",
    tools: ["nmap", "metasploit-framework", "burpsuite", "wireshark", "hashcat"],
    resources: { cpus: 2, memoryMB: 4096, diskGB: 40 },
    targets: ["local", "aws", "vps"],
    build: {
      method: "vagrant-box",
      boxRef: "kalilinux/rolling",
      available: true,
      provision: { recipeDir: "build-recipes/os-images/kali", script: "provision.sh" },
      cloud: { terraformDir: "build-recipes/os-images/terraform", aws: { instanceType: "t3.xlarge", fallbackInstanceType: "t3.large", diskGB: 40 } },
    },
    seeded: true,
  },

  // ── Forensics ──
  {
    id: "sift",
    name: "SANS SIFT Workstation",
    category: "forensics",
    description:
      "SANS incident-response and digital-forensics toolkit on Ubuntu. Ideal for triage, timeline analysis, and artifact carving during an investigation.",
    baseOs: "Ubuntu 22.04",
    docsUrl: "https://www.sans.org/tools/sift-workstation/",
    tools: ["Autopsy", "Sleuth Kit", "Volatility", "log2timeline/plaso", "bulk_extractor"],
    resources: { cpus: 4, memoryMB: 8192, diskGB: 60 },
    targets: ["local", "aws", "vps"],
    build: {
      method: "vagrant-box",
      boxRef: "bento/ubuntu-22.04",
      available: true,
      provision: { recipeDir: "build-recipes/os-images/sift", script: "provision.sh" },
      cloud: { terraformDir: "build-recipes/os-images/terraform", aws: { instanceType: "t3.xlarge", fallbackInstanceType: "t3.large", diskGB: 60 } },
    },
    seeded: true,
  },
  {
    id: "tsurugi",
    name: "Tsurugi Linux",
    category: "forensics",
    description: "DFIR-focused Linux distribution for forensic acquisition and analysis.",
    baseOs: "Ubuntu-based",
    docsUrl: "https://tsurugi-linux.org/",
    tools: ["forensic imaging", "memory analysis", "OSINT modules"],
    resources: { cpus: 2, memoryMB: 4096, diskGB: 40 },
    targets: ["local"],
    build: { method: "cloud-init", guidedSteps: guided("Tsurugi Linux", "https://tsurugi-linux.org/download.php"), available: false },
    seeded: true,
  },

  // ── Reverse engineering / malware analysis ──
  {
    id: "remnux",
    name: "REMnux",
    category: "reverse-eng",
    description:
      "Linux toolkit for reverse-engineering and analyzing malicious software. Pairs well with SIFT for a full IR bench.",
    baseOs: "Ubuntu 24.04",
    docsUrl: "https://remnux.org/",
    tools: ["radare2", "YARA", "CyberChef", "oletools", "capa"],
    resources: { cpus: 4, memoryMB: 8192, diskGB: 60 },
    targets: ["local", "aws", "vps"],
    build: {
      method: "vagrant-box",
      boxRef: "bento/ubuntu-24.04",
      available: true,
      provision: { recipeDir: "build-recipes/os-images/remnux", script: "provision.sh" },
      cloud: { terraformDir: "build-recipes/os-images/terraform", aws: { instanceType: "t3.xlarge", fallbackInstanceType: "t3.large", diskGB: 60 } },
    },
    seeded: true,
  },
  {
    id: "flare-vm",
    name: "FLARE-VM",
    category: "reverse-eng",
    description:
      "Mandiant's Windows-based reverse-engineering and malware-analysis environment (installed onto a Windows VM you provide).",
    baseOs: "Windows 10/11",
    docsUrl: "https://github.com/mandiant/flare-vm",
    tools: ["IDA Free", "x64dbg", "Ghidra", "PE-bear", "dnSpy"],
    resources: { cpus: 2, memoryMB: 8192, diskGB: 80 },
    targets: ["local"],
    build: { method: "cloud-init", guidedSteps: guided("FLARE-VM", "https://github.com/mandiant/flare-vm"), available: false },
    seeded: true,
  },

  // ── OSINT ──
  {
    id: "tracelabs",
    name: "Trace Labs OSINT VM",
    category: "osint",
    description:
      "Kali-based OSINT workstation curated by Trace Labs for open-source investigation and missing-persons CTFs.",
    baseOs: "Kali-based",
    docsUrl: "https://www.tracelabs.org/initiatives/osint-vm",
    tools: ["Maltego CE", "Sherlock", "theHarvester", "recon-ng", "spiderfoot"],
    resources: { cpus: 2, memoryMB: 4096, diskGB: 30 },
    targets: ["local"],
    build: { method: "cloud-init", guidedSteps: guided("Trace Labs OSINT VM", "https://www.tracelabs.org/initiatives/osint-vm"), available: false },
    seeded: true,
  },

  // ── Malware / behavior analysis (detection-engineering appliance) ──
  {
    id: "behavior-lab",
    name: "Behavior Analysis Workstation",
    category: "malware-analysis",
    description:
      "Self-contained detection-engineering appliance for open-source hacktools. Detonates real binaries in CAPEv2, captures behavioral telemetry (Sysmon/ETW + eBPF), maps capabilities with capa, and generates behavior-based detection rules with a local open-weight model — so a student can analyze → simulate → detect → tune the whole loop in one VM. NOTE: CAPE's analysis guest needs CPU nested virtualization (VT-x/AMD-V); without it the lab falls back to lighter in-guest Sysmon detonation. Isolated-lab use only.",
    baseOs: "Ubuntu 22.04 LTS",
    docsUrl: "https://capev2.readthedocs.io/",
    tools: ["CAPEv2", "mandiant capa", "Sysmon", "sigma-cli / pySigma", "hacktool-behavior-lab (hbl)", "Tetragon/Falco (eBPF)"],
    resources: { cpus: 8, memoryMB: 16384, diskGB: 200 },
    targets: ["local", "aws", "vps"],
    build: {
      method: "vagrant-box",
      boxRef: "bento/ubuntu-22.04",
      available: true,
      cloud: {
        terraformDir: "build-recipes/os-images/terraform",
        // Nested-virt default (full CAPE); fallback is cheaper → in-guest Sysmon mode.
        aws: { instanceType: "m7i.2xlarge", fallbackInstanceType: "t3.2xlarge", diskGB: 200 },
      },
      guidedSteps: [
        "Host requirement: a CPU with nested virtualization (Intel VT-x / AMD-V) enabled in BIOS, ≥8 cores, ≥16 GB free RAM, ≥200 GB free disk.",
        "Deploy launches an Ubuntu base box and provisions CAPEv2 + capa + the hbl pipeline automatically (first run is long — large downloads + a Windows analysis guest build).",
        "Open the CAPE web UI at http://localhost:8000 (forwarded) once provisioning completes.",
        "Run the hbl loop from inside the VM; export findings and import them into the main platform with scripts/import-hacktool-detections.ts.",
      ],
      provision: {
        recipeDir: "build-recipes/os-images/behavior-lab",
        script: "provision.sh",
        nestedVirt: true,
        // Install the pipeline from the sibling repo's synced source (no remote).
        localSource: "../hacktool-behavior-lab",
        forwardedPorts: [
          { guest: 8000, host: 8000, name: "cape-web" },
          { guest: 8888, host: 8888, name: "hbl-server" },
          { guest: 11434, host: 11434, name: "ollama" },
        ],
      },
    },
    seeded: true,
  },

  // ── Red team (cataloged for reference; not auto-deployed) ──
  {
    id: "slingshot",
    name: "Slingshot Linux",
    category: "red-team",
    description:
      "SANS Ubuntu-based red-team distribution that ships several offensive frameworks preinstalled. Cataloged for reference and detection context; automated deployment is not provided — build it yourself from the official source for authorized engagements.",
    baseOs: "Ubuntu-based",
    docsUrl: "https://www.sans.org/tools/slingshot/",
    tools: ["preinstalled C2 / red-team tooling (see official docs)"],
    resources: { cpus: 2, memoryMB: 4096, diskGB: 40 },
    targets: ["local"],
    build: { method: "cloud-init", guidedSteps: guided("Slingshot Linux", "https://www.sans.org/tools/slingshot/"), available: false },
    seeded: true,
  },
];

export function getOsImage(id: string): OsImageEntry | undefined {
  return OS_IMAGE_CATALOG.find((e) => e.id === id);
}
