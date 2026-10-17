import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { stagePrereqs } from "@/lib/enterprise-use-cases/runner";

// POST /api/atomic-prereqs
// body: { environmentId, techniques: [{ tech: "T1003.001", num?: 1 }], budgetSec? }
//
// Online GetPrereqs staging: for each atomic, run Invoke-AtomicTest -GetPrereqs on
// the (WinRM) endpoint while it has internet, so the external payload the test
// declares (ProcDump, PsExec, plink, …) is downloaded and persists for later
// offline runs. It only fetches declared prerequisites — the test itself is never
// executed — then verifies with -CheckPrereqs. The caller must own the target
// environment (anti confused-deputy on a privileged host; admins/dev bypass).
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

  // Normalize, validate, and cap the batch — each item is one privileged WinRM
  // round-trip that may download files, so this stays a bounded synchronous job
  // (chunk larger sets across calls).
  const raw = Array.isArray(body.techniques) ? body.techniques : [];
  const seen = new Set<string>();
  const items: Array<{ tech: string; num: number }> = [];
  for (const it of raw) {
    const tech = String(it?.tech || "").toUpperCase();
    const num = Number(it?.num ?? 1);
    const key = `${tech}#${num}`;
    if (/^T\d{4}(\.\d{3})?$/.test(tech) && Number.isInteger(num) && num >= 1 && num <= 999 && !seen.has(key)) {
      seen.add(key);
      items.push({ tech, num });
    }
    if (items.length >= 25) break;
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "no valid techniques (expect techniques: [{tech:'T1003.001', num:1}])" }, { status: 400 });
  }

  const budgetSec = Math.max(30, Math.min(900, Number(body.budgetSec) || 120));
  const results: Array<{ tech: string; num: number; status: string; tail: string; durationMs: number }> = [];
  for (const { tech, num } of items) {
    const r = await stagePrereqs(env as any, tech, num, budgetSec);
    results.push({ tech, num, status: r.status, tail: r.tail, durationMs: r.durationMs });
  }

  const count = (s: string) => results.filter((r) => r.status === s).length;
  return NextResponse.json({
    environmentId,
    total: results.length,
    satisfied: count("satisfied"),
    missing: count("missing"),
    na: count("n/a"),
    failed: count("failed"),
    results,
  });
}
