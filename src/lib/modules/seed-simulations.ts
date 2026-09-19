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

const MODULES = [LOTL, PHISHING];

export async function ensureSimulationModules(): Promise<void> {
  for (const manifest of MODULES) {
    const existing = await prisma.simulationModule.findUnique({ where: { moduleId: manifest.id } });
    if (existing) continue;   // idempotent — don't overwrite operator edits
    const contentHash = moduleContentHash({ manifest });
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
