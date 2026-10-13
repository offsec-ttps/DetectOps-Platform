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

export type OsImageCategory = "forensics" | "osint" | "reverse-eng" | "pentest" | "red-team";
export type DeployTarget = "local" | "aws" | "azure" | "gcp" | "vps";

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
    /** false → template-only ("coming soon"); no automated deploy. */
    available: boolean;
  };
  seeded: true;
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
      "The standard authorized-pentest distribution. Deployed locally from the official Vagrant box for hands-on technique execution and detection lab work.",
    baseOs: "Kali Rolling (Debian)",
    docsUrl: "https://www.kali.org/docs/",
    tools: ["nmap", "metasploit-framework", "burpsuite", "wireshark", "hashcat"],
    resources: { cpus: 2, memoryMB: 4096, diskGB: 30 },
    targets: ["local"],
    build: { method: "vagrant-box", boxRef: "kalilinux/rolling", available: true },
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
    resources: { cpus: 2, memoryMB: 4096, diskGB: 40 },
    targets: ["local", "aws"],
    build: { method: "cloud-init", guidedSteps: guided("SIFT Workstation", "https://www.sans.org/tools/sift-workstation/"), available: false },
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
    baseOs: "Ubuntu 20.04",
    docsUrl: "https://remnux.org/",
    tools: ["radare2", "YARA", "CyberChef", "oletools", "capa"],
    resources: { cpus: 2, memoryMB: 4096, diskGB: 40 },
    targets: ["local"],
    build: { method: "cloud-init", guidedSteps: guided("REMnux", "https://docs.remnux.org/install-distro/get-virtual-appliance"), available: false },
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
