import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { resolveScope, type ScopeSpec } from "@/lib/coverage-assessment/scope";
import { ensureWorkerLoop } from "@/lib/coverage-assessment/worker";
import { listInstalledAtomicTechniques } from "@/lib/enterprise-use-cases/runner";

// GET /api/coverage-assessments — list the caller's assessments (newest first).
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // Resilience: if any sweep is mid-flight (e.g. after a server restart), make
  // sure the in-process drive loop is running so it resumes. Idempotent.
  const active = await prisma.coverageAssessment.count({ where: { status: { in: ["queued", "running", "rendering"] } } });
  if (active > 0) ensureWorkerLoop();
  // Multi-tenant scoping: a non-admin caller only sees their own assessments
  // when auth is enforced (dev mode / admin see all).
  const scope = auth.enforced && auth.user.role !== "admin" ? { ownerId: auth.user.id } : {};
  const rows = await prisma.coverageAssessment.findMany({
    where: scope,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, name: true, assessor: true, client: true, lab: true, status: true,
      atomicsTotal: true, processed: true, executedCount: true, visibleCount: true,
      genericCount: true, absentCount: true, naCount: true, failedCount: true,
      reportPaths: true, error: true, createdAt: true, completedAt: true,
    },
  });
  return NextResponse.json({ items: rows.map((r) => ({ ...r, reportPaths: safe(r.reportPaths) })) });
}

// POST /api/coverage-assessments — create + enqueue a sweep.
// body: { name, assessor, client, lab, environmentId, siemConnectionId?,
//         scope: {mode, libraries?, techniques?}, detectionNote? }
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const environmentId = String(body.environmentId || "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!environmentId) return NextResponse.json({ error: "environmentId is required" }, { status: 400 });

  const env = await prisma.environmentTarget.findUnique({ where: { id: environmentId } });
  if (!env) return NextResponse.json({ error: "environment not found" }, { status: 404 });
  // Authorization: the caller must own the environment they want to detonate
  // against (anti confused-deputy — a tenant must not drive a privileged sweep
  // at another tenant's host). Admins/dev bypass. 404 to avoid leaking existence.
  const envOwn = ownsOr404(auth, env.ownerId);
  if (!envOwn.ok) return envOwn.response;

  // Likewise the SIEM connection (it carries decrypted credentials at use time).
  let siemConnectionId: string | null = null;
  if (body.siemConnectionId) {
    const conn = await prisma.siemConnection.findUnique({ where: { id: String(body.siemConnectionId) } });
    if (!conn) return NextResponse.json({ error: "siem connection not found" }, { status: 404 });
    const siemOwn = ownsOr404(auth, conn.ownerId);
    if (!siemOwn.ok) return siemOwn.response;
    siemConnectionId = conn.id;
  }

  const scope: ScopeSpec = normalizeScope(body.scope);

  // Best-effort: intersect with the technique folders actually installed on the
  // host so a "full" sweep doesn't spend round-trips on absent techniques.
  let installed: Set<string> | undefined;
  if (env.shellMode === "winrm") {
    try { installed = await listInstalledAtomicTechniques(env); } catch { installed = undefined; }
    if (installed && installed.size === 0) installed = undefined;
  }

  const atomics = await resolveScope(scope, installed);
  if (atomics.length === 0) return NextResponse.json({ error: "scope resolved to 0 runnable atomics" }, { status: 400 });

  const user: any = (auth as any).user || {};
  const assessment = await prisma.coverageAssessment.create({
    data: {
      name, assessor: String(body.assessor || ""), client: String(body.client || ""),
      lab: String(body.lab || env.name || ""),
      environmentId, siemConnectionId,
      scope: JSON.stringify(scope), detectionNote: String(body.detectionNote || ""),
      status: "queued", atomicsTotal: atomics.length,
      ownerId: user.id || "", actor: user.email || user.id || "",
    },
  });
  await prisma.coverageAssessmentItem.createMany({
    data: atomics.map((a, idx) => ({
      assessmentId: assessment.id, tech: a.tech, num: a.num, name: a.name,
      tactic: a.tactic, library: a.library, order: idx,
    })),
  });

  ensureWorkerLoop();
  return NextResponse.json({ id: assessment.id, atomicsTotal: atomics.length, installedTechniques: installed ? installed.size : null });
}

function normalizeScope(raw: any): ScopeSpec {
  const mode = raw?.mode === "libraries" || raw?.mode === "techniques" ? raw.mode : "full";
  return {
    mode,
    libraries: Array.isArray(raw?.libraries) ? raw.libraries.map(String) : undefined,
    techniques: Array.isArray(raw?.techniques) ? raw.techniques.map(String) : undefined,
  };
}
function safe(s: string) { try { return JSON.parse(s); } catch { return {}; } }
