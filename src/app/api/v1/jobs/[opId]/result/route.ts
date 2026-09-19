/**
 * POST /api/v1/jobs/[opId]/result   (AGENT-FACING — report a test-run result)
 *
 * The agent posts here after executing + cleaning up. Creates a FleetTestRun
 * record (the immutable audit row) and rolls the FleetOperation to a terminal
 * status. Clears the node's currentRunId.
 *
 * Auth: node_id + api_key in the body.
 *
 * Body:
 *   {
 *     node_id, api_key,
 *     technique, test_index, bundle_hash,
 *     exit_code,
 *     execute_status: "success"|"failed"|"blocked",
 *     cleanup_status: "ok"|"failed",
 *     stdout, stderr,          // truncated previews (full blobs → object store in M6)
 *     duration_ms
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authNode } from "@/lib/bas/agent-auth";
import { logEvent } from "@/lib/event-log";

const EXEC = new Set(["success", "failed", "blocked"]);
const CLEAN = new Set(["ok", "failed"]);
// An operation that has already reached one of these states must not accept a
// new result — otherwise a node could replay/overwrite a finished op, forge a
// success, spam the immutable audit log, or clobber an unrelated in-flight run.
const TERMINAL = new Set(["success", "failed", "blocked", "cleanup_failed"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ opId: string }> }) {
  const { opId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const node = await authNode(String(body.node_id || ""), String(body.api_key || ""));
  if (!node) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const op = await prisma.fleetOperation.findUnique({ where: { id: opId } });
  if (!op || op.nodeId !== node.id) return NextResponse.json({ error: "operation not found for this node" }, { status: 404 });
  if (TERMINAL.has(op.status)) {
    return NextResponse.json({ error: "operation already finalized" }, { status: 409 });
  }

  const executeStatus = EXEC.has(body.execute_status) ? body.execute_status : "failed";
  const cleanupStatus = CLEAN.has(body.cleanup_status) ? body.cleanup_status : "failed";

  // Operation terminal status: cleanup failure is surfaced distinctly.
  const opStatus = cleanupStatus === "failed" ? "cleanup_failed"
                 : executeStatus === "success" ? "success"
                 : executeStatus === "blocked" ? "blocked"
                 : "failed";

  const run = await prisma.fleetTestRun.create({
    data: {
      operationId: opId,
      nodeId: node.id,
      technique: String(body.technique || ""),
      testIndex: Number(body.test_index) || 0,
      bundleHash: String(body.bundle_hash || ""),
      exitCode: body.exit_code != null ? Number(body.exit_code) : null,
      executeStatus,
      cleanupStatus,
      detection: "{}",                       // M6: detection verdict
      stdoutRef: String(body.stdout || "").slice(0, 8000),   // execute stdout
      stderrRef: String(body.stderr || "").slice(0, 4000),   // execute stderr
      cleanupStdoutRef: String(body.cleanup_stdout || "").slice(0, 4000),
      cleanupStderrRef: String(body.cleanup_stderr || "").slice(0, 4000),
      durationMs: Number(body.duration_ms) || 0,
      startedAt: op.createdAt,
      endedAt: new Date(),
    },
  });

  await prisma.fleetOperation.update({ where: { id: opId }, data: { status: opStatus } });
  await prisma.fleetNode.update({ where: { id: node.id }, data: { currentRunId: null } });

  void logEvent({
    category: "bas", action: "bas.testrun.complete",
    actor: "agent", status: opStatus === "success" ? "ok" : "error",
    targetType: "FleetTestRun", targetId: run.id,
    durationMs: Number(body.duration_ms) || 0,
    message: `${node.hostname} · ${body.technique} #${body.test_index} · exec=${executeStatus} cleanup=${cleanupStatus} exit=${body.exit_code}`,
    details: { nodeId: node.id, operationId: opId, executeStatus, cleanupStatus, exitCode: body.exit_code },
  });

  return NextResponse.json({ ok: true, testRunId: run.id, operationStatus: opStatus });
}
