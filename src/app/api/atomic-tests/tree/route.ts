/**
 * GET /api/atomic-tests/tree
 *
 * Grouped ATT&CK index for guided technique selection in the fleet Simulation
 * wizard: tactic → parent technique → sub-technique → atomic tests. Returns
 * only ids/names/refs (no commands), so the whole tree loads in one fetch and
 * the drill-down is instant. Mirrors the Detection-Engineering-Lab UX of
 * picking a technique then a sub-technique before running.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normTactic(t: string): string {
  return (t || "").toLowerCase().trim().replace(/\s+/g, "-") || "unspecified";
}
function safeArr(s: string): string[] { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } }

interface TestRef { testNumber: number; testName: string; platforms: string[]; executor: string; elevation: boolean }
interface SubNode { id: string; name: string; tests: TestRef[] }
interface TechNode { id: string; name: string; subs: SubNode[] }

export async function GET() {
  const rows = await prisma.atomicTest.findMany({
    select: {
      techniqueId: true, techniqueName: true, testNumber: true, testName: true,
      platforms: true, executorName: true, elevationRequired: true, tactic: true,
    },
    orderBy: [{ techniqueId: "asc" }, { testNumber: "asc" }],
  });

  // tactic -> parentId -> { name, subs: subId -> { name, tests } }
  const tree = new Map<string, Map<string, { name: string; subs: Map<string, SubNode> }>>();

  for (const r of rows) {
    const tactic = normTactic(r.tactic);
    const parentId = r.techniqueId.split(".")[0];
    const subId = r.techniqueId;
    // Parent name: prefer the part before ":" in a sub name, else the full name.
    const fullName = r.techniqueName || r.techniqueId;
    const parentName = fullName.includes(":") ? fullName.split(":")[0].trim() : (subId === parentId ? fullName : parentName0(parentId));
    const subName = fullName.includes(":") ? fullName.split(":").slice(1).join(":").trim() || fullName : fullName;

    if (!tree.has(tactic)) tree.set(tactic, new Map());
    const parents = tree.get(tactic)!;
    if (!parents.has(parentId)) parents.set(parentId, { name: parentName, subs: new Map() });
    const pnode = parents.get(parentId)!;
    if (subId === parentId && parentName && pnode.name !== parentName && fullName) pnode.name = parentName;
    if (!pnode.subs.has(subId)) pnode.subs.set(subId, { id: subId, name: subId === parentId ? fullName : subName, tests: [] });
    pnode.subs.get(subId)!.tests.push({
      testNumber: r.testNumber, testName: r.testName,
      platforms: safeArr(r.platforms), executor: r.executorName || "", elevation: r.elevationRequired,
    });
  }

  const tactics = [...tree.entries()].map(([tactic, parents]) => {
    const techniques: TechNode[] = [...parents.entries()].map(([id, p]) => ({
      id, name: p.name,
      subs: [...p.subs.values()].sort((a, b) => a.id.localeCompare(b.id)),
    })).sort((a, b) => a.id.localeCompare(b.id));
    const testCount = techniques.reduce((n, t) => n + t.subs.reduce((m, s) => m + s.tests.length, 0), 0);
    return { tactic, techniqueCount: techniques.length, testCount, techniques };
  }).sort((a, b) => a.tactic.localeCompare(b.tactic));

  return NextResponse.json({ tactics });
}

function parentName0(parentId: string): string { return parentId; }
