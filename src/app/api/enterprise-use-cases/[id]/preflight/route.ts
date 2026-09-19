/**
 * GET /api/enterprise-use-cases/[id]/preflight?scenarioId=&environmentId=&mode=
 *
 * Run the deterministic pre-flight checklist for a (use case, scenario,
 * environment, mode) tuple. See src/lib/enterprise-use-cases/preflight.ts.
 *
 * Returns: { verdict, checks, runnable, destructive, generatedAt }
 *
 * 400 — missing scenarioId / environmentId
 * 404 — use case not found (returned in the body's checks)
 */

import { NextRequest, NextResponse } from "next/server";
import { runPreflight } from "@/lib/enterprise-use-cases/preflight";

const MODES = new Set(["simulate-only", "simulate-and-validate"]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const scenarioId = sp.get("scenarioId") || "";
  const environmentId = sp.get("environmentId") || "";
  const mode = sp.get("mode") || "simulate-only";

  if (!scenarioId) return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
  if (!environmentId) return NextResponse.json({ error: "environmentId is required" }, { status: 400 });
  if (!MODES.has(mode)) return NextResponse.json({ error: `mode must be one of ${[...MODES].join("|")}` }, { status: 400 });

  const result = await runPreflight({
    useCaseId: id, scenarioId, environmentId, mode: mode as any,
  });
  return NextResponse.json(result);
}
