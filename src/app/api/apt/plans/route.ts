/**
 * GET /api/apt/plans — the ready-made adversary emulation plans in the APT
 * Simulation library (CTID full plans, CTID micro plans, ATT&CK-Eval rounds).
 * Each plan carries its real upstream link; CTID full plans also carry authentic
 * ATT&CK technique coverage, and we report how many local Atomic Red Team tests
 * cover those techniques (so the UI can offer a runnable count).
 *
 * Query: source=ctid-full|ctid-micro|attack-eval, actor=<name>, q=<search>.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const source = (sp.get("source") || "").trim();
  const actor = (sp.get("actor") || "").trim();
  const q = (sp.get("q") || "").trim().toLowerCase();

  const where: Record<string, unknown> = {};
  if (source) where.source = source;
  if (actor) where.actor = actor;
  let plans = await prisma.aptEmulationPlan.findMany({ where, orderBy: [{ source: "asc" }, { name: "asc" }] });
  if (q) plans = plans.filter((p) => `${p.name} ${p.actor} ${p.origin}`.toLowerCase().includes(q));

  const parse = (s: string) => { try { return JSON.parse(s || "[]") as string[]; } catch { return []; } };

  // Count local ART tests per plan (by its technique set) in one query.
  const allTechs = [...new Set(plans.flatMap((p) => parse(p.techniqueIds)))];
  const atomicByTech = new Map<string, number>();
  if (allTechs.length) {
    const grouped = await prisma.atomicTest.groupBy({ by: ["techniqueId"], where: { techniqueId: { in: allTechs } }, _count: { _all: true } });
    for (const g of grouped) atomicByTech.set(g.techniqueId, g._count._all);
  }

  const items = plans.map((p) => {
    const techniqueIds = parse(p.techniqueIds);
    const atomicCount = techniqueIds.reduce((n, t) => n + (atomicByTech.get(t) || 0), 0);
    const coveredTechniques = techniqueIds.filter((t) => atomicByTech.has(t)).length;
    return {
      key: p.key, name: p.name, source: p.source, actor: p.actor, origin: p.origin,
      sectors: parse(p.sectors), description: p.description, repoUrl: p.repoUrl, referenceUrl: p.referenceUrl,
      round: p.round, techniqueCount: techniqueIds.length, stepCount: p.stepCount,
      atomicCount, coveredTechniques, runnable: atomicCount > 0,
    };
  });

  const bySource = {
    "ctid-full": items.filter((i) => i.source === "ctid-full"),
    "ctid-micro": items.filter((i) => i.source === "ctid-micro"),
    "attack-eval": items.filter((i) => i.source === "attack-eval"),
  };
  return NextResponse.json({ total: items.length, items, bySource });
}
