/**
 * POST   /api/os-images/[id]  { action: "start" | "stop" } — power the VM
 * DELETE /api/os-images/[id] — destroy the VM + remove the deployment
 *
 * [id] is the deploymentId. Session-gated + owner-scoped; audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { getDeployment, setStatus, removeDeployment } from "@/lib/os-images/registry";

async function loadOwned(id: string) {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const dep = await getDeployment(id);
  if (!dep) return { ok: false as const, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
  // Unowned (legacy) rows are admin-only when enforcing.
  const own = ownsOr404(auth, dep.ownerId || "");
  if (!own.ok) return { ok: false as const, response: own.response };
  return { ok: true as const, dep, auth };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwned(id);
  if (!r.ok) return r.response;

  const action = String((await req.json().catch(() => ({}))).action || "");
  if (action !== "start" && action !== "stop") return NextResponse.json({ error: 'action must be "start" or "stop"' }, { status: 400 });

  try {
    const t = r.dep.target || "local";
    if (t === "aws") {
      const m = await import("@/lib/os-images/deploy-cloud");
      if (action === "stop") { await m.stopCloud(r.dep); await setStatus(id, "stopped"); }
      else { await m.startCloud(r.dep); await setStatus(id, "running"); }
    } else if (t === "vps") {
      const m = await import("@/lib/os-images/deploy-vps");
      if (action === "stop") { await m.stopVps(r.dep); await setStatus(id, "stopped"); }
      else { await m.startVps(r.dep); await setStatus(id, "running"); }
    } else {
      const m = await import("@/lib/os-images/deploy");
      if (action === "stop") { await m.stopOsImage(id); await setStatus(id, "stopped"); }
      else { await m.startOsImage(id); await setStatus(id, "running"); }
    }
    void logEvent({ category: "bas", action: `osimage.${action}`, actor: r.auth.user.email, status: "ok", targetType: "OsImage", targetId: id, message: `${action} ${r.dep.name} (${r.dep.target || "local"})` });
    return NextResponse.json({ ok: true, status: action === "stop" ? "stopped" : "running" });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwned(id);
  if (!r.ok) return r.response;
  try {
    const t = r.dep.target || "local";
    if (t === "aws") { await (await import("@/lib/os-images/deploy-cloud")).teardownCloud(r.dep); }
    else if (t === "vps") { await (await import("@/lib/os-images/deploy-vps")).teardownVps(r.dep); }
    else { await (await import("@/lib/os-images/deploy")).teardownOsImage(id); }
  } catch { /* best-effort; still drop the record */ }
  await removeDeployment(id);
  void logEvent({ category: "bas", action: "osimage.delete", actor: r.auth.user.email, status: "ok", targetType: "OsImage", targetId: id, message: `deleted ${r.dep.name}` });
  return NextResponse.json({ ok: true });
}
