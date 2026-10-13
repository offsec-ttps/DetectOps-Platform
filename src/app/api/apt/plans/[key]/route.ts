/**
 * GET /api/apt/plans/[key] — one emulation plan, with its ATT&CK technique list
 * resolved to runnable Atomic Red Team tests. For each technique we pick one
 * representative local test (Windows-preferred, then Linux), so the plan can be
 * launched as a campaign through the APT runner. Returns `atomicTestIds` for the
 * Campaign Designer hand-off plus a per-technique breakdown.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { key } = await params;

  const plan = await prisma.aptEmulationPlan.findUnique({ where: { key } });
  if (!plan) return NextResponse.json({ error: `emulation plan "${key}" not found` }, { status: 404 });

  const parse = (s: string) => { try { return JSON.parse(s || "[]") as string[]; } catch { return []; } };
  const techniqueIds = parse(plan.techniqueIds);

  const tests = techniqueIds.length
    ? await prisma.atomicTest.findMany({ where: { techniqueId: { in: techniqueIds } } })
    : [];

  // One representative test per technique: Windows first (the SAR DC), then Linux.
  const rank = (t: { platforms: string }) => {
    let p: string[] = []; try { p = JSON.parse(t.platforms || "[]"); } catch { p = []; }
    const l = p.map((x) => x.toLowerCase());
    return l.includes("windows") ? 0 : l.includes("linux") ? 1 : 2;
  };
  const byTech = new Map<string, typeof tests>();
  for (const t of tests) { const a = byTech.get(t.techniqueId) || []; a.push(t); byTech.set(t.techniqueId, a); }

  const perTechnique = techniqueIds.map((tid) => {
    const cand = (byTech.get(tid) || []).slice().sort((a, b) => rank(a) - rank(b));
    const chosen = cand[0];
    return {
      techniqueId: tid,
      covered: !!chosen,
      total: cand.length,
      atomicTestId: chosen?.id || null,
      testName: chosen?.testName || "",
      platforms: chosen ? parse(chosen.platforms) : [],
      executor: chosen?.executorName || "",
    };
  });

  const atomicTestIds = perTechnique.map((p) => p.atomicTestId).filter((x): x is string => !!x);

  return NextResponse.json({
    plan: {
      key: plan.key, name: plan.name, source: plan.source, actor: plan.actor, origin: plan.origin,
      sectors: parse(plan.sectors), description: plan.description, repoUrl: plan.repoUrl, referenceUrl: plan.referenceUrl,
      round: plan.round, stepCount: plan.stepCount, techniqueIds,
    },
    techniqueCount: techniqueIds.length,
    coveredTechniques: perTechnique.filter((p) => p.covered).length,
    atomicTestIds,
    perTechnique,
  });
}
