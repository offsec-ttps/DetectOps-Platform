/**
 * Connective tissue (Phase 2): on a successful deploy, register the lab into the
 * simulation pipeline so it's instantly usable — deploy → simulate → detect.
 *
 * Creates/updates (idempotent by unique name):
 *   - an EnvironmentTarget   → the lab shows up as a simulation target
 *   - a SIEM Integration (Splunk) → detection scoring works out of the box
 *
 * Splunk credentials follow the existing Integration storage convention
 * (plaintext fields, read directly by validate-coverage's runSplunkSearch).
 */

import { prisma } from "@/lib/prisma";
import type { LabTemplate } from "@/config/lab-templates";

export interface RegisterResult {
  environmentTargetId: string;
  integrationId: string | null;
  notes: string[];
}

function splunkVm(t: LabTemplate) {
  return t.vms.find((v) => v.role.toLowerCase().includes("splunk") || v.name.toLowerCase().startsWith("splunk"));
}
function primaryWindowsVm(t: LabTemplate) {
  // Prefer a GOAD DC, then any Domain Controller, then a workstation.
  return t.vms.find((v) => /^DC0?1$/i.test(v.name))
    || t.vms.find((v) => v.role.toLowerCase().includes("domain controller"))
    || t.vms.find((v) => v.role.toLowerCase().includes("workstation"))
    || t.vms.find((v) => v.os.toLowerCase().includes("windows"));
}

export async function registerDeployedEnvironment(opts: {
  source: "local" | "cloud";
  ownerId: string;
  template: LabTemplate;
  // cloud
  cloudProvider?: string;
  credentialId?: string;
  rangeId?: string;
  // resolved Splunk endpoint (cloud passes this in when known)
  splunkHost?: string;
  splunkUser?: string;
  splunkPassword?: string;
}): Promise<RegisterResult> {
  const { template, source, ownerId } = opts;
  const notes: string[] = [];

  const splunk = splunkVm(template);
  const win = primaryWindowsVm(template);
  const cfg = (template.config || {}) as Record<string, any>;

  const splunkHost = opts.splunkHost || (source === "local" ? splunk?.ip : undefined);
  const splunkUser = opts.splunkUser || cfg.splunk_admin_user || "admin";
  const splunkPassword = opts.splunkPassword || cfg.splunk_admin_password || "";

  // ── EnvironmentTarget (the simulation target record) ──
  const envName = `${template.name}`;
  const baseEnv = {
    templateRef: template.id,
    description: `Auto-registered from Deploy (${source}) — ${template.labType}`,
    ownerId,
    enabled: true,
  };
  let envData: any;
  if (source === "cloud") {
    envData = {
      ...baseEnv, kind: "user-cloud",
      cloudProvider: opts.cloudProvider || template.cloudProvider || "aws",
      credentialId: opts.credentialId || null,
      hostname: splunkHost || "",
    };
  } else {
    envData = {
      ...baseEnv, kind: "our-template-deployed",
      hostname: win?.ip || splunkHost || "",
      sshUser: "vagrant",   // SAR/GOAD default; the operator can adjust
    };
  }
  const env = await prisma.environmentTarget.upsert({
    where: { name: envName },
    create: { name: envName, ...envData },
    update: envData,
  });

  // ── SIEM Integration (Splunk) — only when we can resolve the endpoint ──
  let integrationId: string | null = null;
  if (splunkHost) {
    const intName = `${template.name} — Splunk`;
    const intData = {
      type: "siem",
      authMethod: "credentials",
      apiUrl: `https://${splunkHost}:8089`,
      username: splunkUser,
      password: splunkPassword,
      extraConfig: JSON.stringify({ source: "auto-deploy", templateId: template.id }),
      enabled: true,
      connected: false,   // flips true after a successful test
    };
    const integ = await prisma.integration.upsert({
      where: { name: intName },
      create: { name: intName, ...intData },
      update: { apiUrl: intData.apiUrl, username: intData.username, password: intData.password, enabled: true },
    });
    integrationId = integ.id;
    notes.push(`Splunk SIEM registered at ${intData.apiUrl} (test it under Integrations to turn detection scoring on).`);
  } else {
    notes.push("Splunk endpoint not resolved yet — configure it under Integrations to enable detection scoring.");
  }

  notes.push(`Environment "${envName}" registered as a simulation target.`);
  return { environmentTargetId: env.id, integrationId, notes };
}
