/**
 * GET  /api/os-images — catalog + this user's deployed analyst VMs
 * POST /api/os-images — deploy an image to a chosen target (local | aws | vps)
 *
 * Dashboard-facing (session-gated). The analyst picks a target:
 *   local → Vagrant/VirtualBox (self-hosted only)
 *   aws   → Terraform → EC2 (vault creds, analyst-IP-locked SG, SSH-provisioned)
 *   vps   → SSH-provision an existing host the analyst owns (vaulted SSH key)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireRole } from "@/lib/auth-guard";
import { OS_IMAGE_CATALOG, getOsImage, priceFor } from "@/config/os-images";
import { localDeployAvailable } from "@/lib/deploy/mode";
import { logEvent } from "@/lib/event-log";
import { prisma } from "@/lib/prisma";
import { addDeployment, setStatus, listDeployments, type OsDeployTarget } from "@/lib/os-images/registry";

const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const ownerId = auth.enforced ? auth.user.id : null;
  const items = await listDeployments(ownerId).catch(() => []);

  // Lightweight auto-stop: stop any running cloud row past its autoStopAt.
  const now = Date.now();
  for (const d of items) {
    if (d.target === "aws" && d.status === "running" && d.autoStopAt && Date.parse(d.autoStopAt) < now) {
      void (async () => {
        try {
          const { stopCloud } = await import("@/lib/os-images/deploy-cloud");
          await stopCloud(d);
          await setStatus(d.deploymentId, "stopped");
          void logEvent({ category: "bas", action: "osimage.autostop", actor: "system", status: "ok", targetType: "OsImage", targetId: d.deploymentId, message: `auto-stopped ${d.name} (past autoStopAt)` });
        } catch { /* best-effort */ }
      })();
    }
  }

  const cloudCreds = await prisma.cloudCredential.count({ where: ownerId ? { ownerId } : {} }).catch(() => 0);
  return NextResponse.json({
    catalog: OS_IMAGE_CATALOG,
    localDeployAvailable: localDeployAvailable(),
    cloudDeployAvailable: true,     // offerable; the picker links to "add credentials" when none exist
    vpsDeployAvailable: true,       // bring-your-own-host
    savedCloudCredentials: cloudCreds,
    items,
  });
}

export async function POST(req: NextRequest) {
  // Runs vagrant (local host), terraform (cloud spend) or SSH provisioning from
  // this server — admin only.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({} as any));
  const imageId = String(body.imageId || "").trim();
  const target = (String(body.target || "local").trim() || "local") as OsDeployTarget;
  const entry = getOsImage(imageId);
  if (!entry) return NextResponse.json({ error: `unknown OS image "${imageId}"` }, { status: 400 });
  if (!entry.targets.includes(target as any)) {
    return NextResponse.json({ error: `"${entry.name}" does not support target "${target}" (allowed: ${entry.targets.join(", ")})` }, { status: 400 });
  }

  // Per-image concurrency guard (all targets): never run two deploys of one image.
  const ownerId = auth.enforced ? auth.user.id : null;
  const existing = (await listDeployments(ownerId).catch(() => []))
    .find((d) => d.imageId === imageId && (d.status === "installing" || d.status === "running"));
  if (existing) {
    return NextResponse.json(
      { error: `"${entry.name}" is already ${existing.status} (${existing.deploymentId}). Stop or delete it before deploying another.`, deploymentId: existing.deploymentId, status: existing.status },
      { status: 409 },
    );
  }

  const { newOsDeploymentIds, deployOsImage } = await import("@/lib/os-images/deploy");
  const ids = newOsDeploymentIds(imageId);
  const email = auth.user.email;

  // ── Validate per target + build the installing row + the deploy action ──
  let deployAction: () => Promise<void>;
  const rowExtra: Record<string, any> = { target };

  if (target === "local") {
    if (!localDeployAvailable()) return NextResponse.json({ error: "Local deploy is available on self-hosted installs only (set PLATFORM_MODE=self-hosted)." }, { status: 400 });
    if (entry.build.method !== "vagrant-box" || !entry.build.available) return NextResponse.json({ error: `"${entry.name}" is template-only right now — follow its guided setup steps.` }, { status: 400 });
    deployAction = async () => { await deployOsImage(imageId, undefined, ids); };
  } else if (target === "aws") {
    const c = body.cloud || {};
    const credentialId = String(c.credentialId || "");
    const region = String(c.region || "us-east-1");
    const allowedCidr = String(c.allowedCidr || "");
    if (!entry.build.cloud?.aws) return NextResponse.json({ error: `"${entry.name}" has no AWS cloud config` }, { status: 400 });
    if (!credentialId) return NextResponse.json({ error: "cloud deploy requires a saved CloudCredential (credentialId)" }, { status: 400 });
    if (!CIDR_RE.test(allowedCidr) || allowedCidr === "0.0.0.0/0") return NextResponse.json({ error: "supply allowedCidr as your IP /32 (never 0.0.0.0/0)" }, { status: 400 });
    if (!/^[a-z]{2}-[a-z]+-\d{1,2}$/.test(region)) return NextResponse.json({ error: "invalid AWS region" }, { status: 400 });
    const instanceType = String(c.instanceType || entry.build.cloud.aws.instanceType);
    if (!/^[a-z0-9]+\.[a-z0-9]+$/.test(instanceType)) return NextResponse.json({ error: "invalid instance type" }, { status: 400 });
    const autoStopMinutes = Number.isFinite(c.autoStopMinutes) ? Number(c.autoStopMinutes) : 240;
    Object.assign(rowExtra, { provider: "aws", region, instanceType, credentialId, estCostUsdPerHr: priceFor(instanceType) });
    deployAction = async () => {
      const { deployCloud } = await import("@/lib/os-images/deploy-cloud");
      await deployCloud(imageId, { provider: "aws", region, instanceType, credentialId, allowedCidr, ownerId: auth.user.id, autoStopMinutes }, ids);
    };
  } else if (target === "vps") {
    const v = body.vps || {};
    const host = String(v.host || "").trim();
    const sshKeyCredentialId = String(v.sshKeyCredentialId || "");
    const sshUser = v.sshUser ? String(v.sshUser) : undefined;
    if (!host) return NextResponse.json({ error: "VPS deploy requires a host" }, { status: 400 });
    if (!sshKeyCredentialId) return NextResponse.json({ error: "VPS deploy requires a saved SSH key credential (sshKeyCredentialId)" }, { status: 400 });
    // Reject host/user that could be read as an ssh/scp flag (argument injection).
    if (!/^(?!-)[A-Za-z0-9._-]{1,253}$/.test(host)) return NextResponse.json({ error: "invalid host — use a hostname or IPv4 with no leading '-'" }, { status: 400 });
    if (sshUser && !/^[a-z_][a-z0-9_-]{0,31}$/i.test(sshUser)) return NextResponse.json({ error: "invalid ssh user" }, { status: 400 });
    Object.assign(rowExtra, { provider: "vps", publicIp: host, credentialId: sshKeyCredentialId });
    deployAction = async () => {
      const { deployVps } = await import("@/lib/os-images/deploy-vps");
      await deployVps(imageId, { host, sshUser, sshKeyCredentialId, ownerId: auth.user.id }, ids);
    };
  } else {
    return NextResponse.json({ error: `target "${target}" is scaffolded but not wired yet` }, { status: 400 });
  }

  // Installing row up front so the UI shows progress immediately.
  await addDeployment({
    deploymentId: ids.deploymentId, imageId, name: entry.name, vmName: ids.vmName,
    ownerId: auth.user.id, status: "installing", createdAt: new Date().toISOString(), ...rowExtra,
  }).catch(() => {});

  // Fire-and-forget: the client polls GET for status.
  void (async () => {
    try {
      await deployAction();
      await setStatus(ids.deploymentId, "running").catch(() => {});
      void logEvent({ category: "bas", action: "osimage.deploy", actor: email, status: "ok", targetType: "OsImage", targetId: ids.deploymentId, message: `deployed ${entry.name} (${target})` });
    } catch (e: any) {
      await setStatus(ids.deploymentId, "error", String(e?.message || e).slice(0, 500)).catch(() => {});
      void logEvent({ category: "bas", action: "osimage.deploy", actor: email, status: "error", targetType: "OsImage", targetId: imageId, message: `deploy ${entry.name} (${target}) failed: ${e?.message || e}` });
    }
  })();

  void logEvent({ category: "bas", action: "osimage.deploy.start", actor: email, status: "ok", targetType: "OsImage", targetId: imageId, message: `${entry.name} deploy started (${target})` });
  return NextResponse.json({ ok: true, status: "installing", deploymentId: ids.deploymentId, target }, { status: 202 });
}
