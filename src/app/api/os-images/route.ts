/**
 * GET  /api/os-images — catalog + this user's deployed analyst VMs
 * POST /api/os-images — deploy an image locally (self-hosted, gated + audited)
 *
 * Dashboard-facing (session-gated). Only images with an automated local path
 * (build.available + method vagrant-box) can be deployed; everything else is
 * template-only and rejected with guidance.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { OS_IMAGE_CATALOG, getOsImage } from "@/config/os-images";
import { localDeployAvailable } from "@/lib/deploy/mode";
import { logEvent } from "@/lib/event-log";
import { addDeployment, setStatus, listDeployments } from "@/lib/os-images/registry";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const items = await listDeployments(auth.enforced ? auth.user.id : null).catch(() => []);
  return NextResponse.json({
    catalog: OS_IMAGE_CATALOG,
    localDeployAvailable: localDeployAvailable(),
    items,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const imageId = String(body.imageId || "").trim();
  const entry = getOsImage(imageId);
  if (!entry) return NextResponse.json({ error: `unknown OS image "${imageId}"` }, { status: 400 });

  if (!localDeployAvailable()) {
    return NextResponse.json({ error: "Local deploy is available on self-hosted installs only (set PLATFORM_MODE=self-hosted)." }, { status: 400 });
  }
  if (entry.build.method !== "vagrant-box" || !entry.build.available) {
    return NextResponse.json({ error: `"${entry.name}" is template-only right now — follow its guided setup steps.` }, { status: 400 });
  }

  // Fire-and-forget: the client polls GET /api/os-images for status. The box
  // download + first boot can take several minutes.
  const deploymentId = `pending-${Date.now().toString(36)}`;
  void (async () => {
    try {
      const { deployOsImage } = await import("@/lib/os-images/deploy");
      const res = await deployOsImage(imageId);
      await addDeployment({
        deploymentId: res.deploymentId, imageId, name: entry.name, vmName: res.vmName,
        ownerId: auth.user.id, status: "running", createdAt: new Date().toISOString(),
      });
      void logEvent({ category: "bas", action: "osimage.deploy", actor: auth.user.email, status: "ok", targetType: "OsImage", targetId: res.deploymentId, message: `deployed ${entry.name}` });
    } catch (e: any) {
      await addDeployment({
        deploymentId, imageId, name: entry.name, vmName: "", ownerId: auth.user.id,
        status: "error", lastError: String(e?.message || e).slice(0, 500), createdAt: new Date().toISOString(),
      }).catch(() => {});
      await setStatus(deploymentId, "error", String(e?.message || e).slice(0, 500)).catch(() => {});
      void logEvent({ category: "bas", action: "osimage.deploy", actor: auth.user.email, status: "error", targetType: "OsImage", targetId: imageId, message: `deploy ${entry.name} failed: ${e?.message || e}` });
    }
  })();

  void logEvent({ category: "bas", action: "osimage.deploy.start", actor: auth.user.email, status: "ok", targetType: "OsImage", targetId: imageId, message: `${entry.name} deploy started` });
  return NextResponse.json({ ok: true, status: "installing" }, { status: 202 });
}
