import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { installAtomicLibrary } from "@/lib/enterprise-use-cases/runner";

// POST /api/atomic-prereqs/install  { environmentId, budgetSec? }
//
// Installs / refreshes the FULL Atomic Red Team atomics library on the target
// WinRM endpoint (official redcanaryco installer) so techniques not yet present
// become testable. Downloads the atomics content from GitHub (endpoint needs
// internet); it never executes a test. Owner-checked, like the staging route.
// Long-running — one synchronous WinRM round-trip; the client should allow time.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const environmentId = String(body.environmentId || "").trim();
  if (!environmentId) return NextResponse.json({ error: "environmentId is required" }, { status: 400 });

  const env = await prisma.environmentTarget.findUnique({ where: { id: environmentId } });
  if (!env) return NextResponse.json({ error: "environment not found" }, { status: 404 });
  const own = ownsOr404(auth, env.ownerId);
  if (!own.ok) return own.response;

  const budgetSec = Math.max(120, Math.min(1800, Number(body.budgetSec) || 600));
  const r = await installAtomicLibrary(env as any, budgetSec);
  return NextResponse.json({
    environmentId,
    ok: r.ok,
    installedTechniques: r.installedTechniques,
    tail: r.tail,
    durationMs: r.durationMs,
  }, { status: r.ok ? 200 : 502 });
}
