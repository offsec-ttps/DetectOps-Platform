import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

// SAR-tested marker for atomics.
//
//   GET  → how many atomics are currently marked tested-and-working on SAR.
//   POST → backfill the marker from existing run history:
//            • Campaign Designer simulations that ran locally (SAR) and succeeded
//              → mark every atomic of each simulated technique (technique-grain,
//              since a SimulationRun records techniqueIds, not test numbers).
//            • Coverage Assessment items that actually executed → mark the exact
//              (technique, testNumber); "detected" if the distinctive indicator
//              reached the SIEM, else "working".
//
// This marks DETONATED-and-working atomics — distinct from merely having their
// prerequisites staged. Idempotent; safe to re-run as more history accumulates.

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const [tested, detected, total] = await Promise.all([
    prisma.atomicTest.count({ where: { sarTested: true } }),
    prisma.atomicTest.count({ where: { sarStatus: "detected" } }),
    prisma.atomicTest.count(),
  ]);
  return NextResponse.json({ tested, detected, total });
}

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const now = new Date();
  let fromSimulations = 0;
  let fromCoverage = 0;

  // ── 1. Successful local (SAR) Campaign Designer simulations ──────────────
  const runs = await prisma.simulationRun.findMany({
    where: { source: "local", status: "success" },
    select: { techniqueIds: true },
  });
  const simTechniques = new Set<string>();
  for (const r of runs) {
    try {
      for (const t of JSON.parse(r.techniqueIds || "[]")) {
        if (typeof t === "string" && /^T\d{4}(\.\d{3})?$/.test(t)) simTechniques.add(t);
      }
    } catch { /* skip malformed */ }
  }
  if (simTechniques.size) {
    const res = await prisma.atomicTest.updateMany({
      where: { techniqueId: { in: [...simTechniques] }, sarTested: false },
      // Don't downgrade a coverage "detected" mark applied later; only set the
      // base working mark for not-yet-marked rows.
      data: { sarTested: true, sarStatus: "working", sarSource: "simulation", sarTestedAt: now },
    });
    fromSimulations = res.count;
  }

  // ── 2. Coverage Assessment items that executed ───────────────────────────
  const items = await prisma.coverageAssessmentItem.findMany({
    where: { executed: true },
    select: { tech: true, num: true, visBucket: true },
  });
  for (const it of items) {
    const status = it.visBucket === "visible" ? "detected" : "working";
    const r = await prisma.atomicTest.updateMany({
      where: { techniqueId: it.tech, testNumber: it.num },
      data: { sarTested: true, sarStatus: status, sarSource: "coverage", sarTestedAt: now },
    });
    fromCoverage += r.count;
  }

  const tested = await prisma.atomicTest.count({ where: { sarTested: true } });
  return NextResponse.json({
    ok: true,
    fromSimulations,
    fromCoverage,
    tested,
    note: "Marks atomics actually detonated-and-working on SAR (not merely prereq-staged).",
  });
}
