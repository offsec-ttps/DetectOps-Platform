/**
 * GET /api/attack/atomics?techniques=T1611,T1610,... — resolve a set of ATT&CK
 * technique IDs to the actual Atomic Red Team tests in the local library
 * (atomic_tests), returning the exact command/executor/platform that the
 * Campaign Designer will execute. Matches each requested id exactly AND its
 * sub-techniques (startsWith "<id>."). Used by the attack-catalog libraries
 * (Container / Cloud / Active Directory / Hacktools) so analysts see and pick
 * the real commands before handing them to the Campaign Designer.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const ids = [...new Set((req.nextUrl.searchParams.get("techniques") || "")
    .split(",").map((s) => s.trim()).filter((s) => /^T\d{4}(\.\d{3})?$/.test(s)))];
  if (!ids.length) return NextResponse.json({ items: [], byTechnique: {}, total: 0 });

  const ors = ids.flatMap((id) => [{ techniqueId: id }, { techniqueId: { startsWith: `${id}.` } }]);
  const rows = await prisma.atomicTest.findMany({
    where: { OR: ors },
    orderBy: [{ techniqueId: "asc" }, { testNumber: "asc" }],
  });

  const parse = (s: string) => { try { return JSON.parse(s || "[]") as string[]; } catch { return []; } };
  const matchKey = (tech: string) => ids.find((id) => tech === id || tech.startsWith(`${id}.`)) || tech;

  const items = rows.map((r) => ({
    id: r.id,
    techniqueId: r.techniqueId,
    requestedId: matchKey(r.techniqueId),
    techniqueName: r.techniqueName,
    testNumber: r.testNumber,
    testName: r.testName,
    executor: r.executorName,
    platforms: parse(r.platforms),
    command: r.command,
    cleanupCommand: r.cleanupCommand,
    elevationRequired: r.elevationRequired,
    tactic: r.tactic,
    description: r.testDescription,
  }));

  const byTechnique: Record<string, number> = {};
  for (const it of items) byTechnique[it.requestedId] = (byTechnique[it.requestedId] || 0) + 1;

  return NextResponse.json({ items, byTechnique, total: items.length });
}
