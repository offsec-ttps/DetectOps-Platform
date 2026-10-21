/**
 * POST /api/sar/start
 *
 * Controls the active SAR deployment via its CLI.
 * Dynamically resolves the lab path from the latest deployment.
 *
 * POST body: { action: "resume" | "stop" | "build" | "destroy" | "dump" }
 * GET — returns current background operation status and logs.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { getActiveLab } from "@/lib/active-lab";
import { existsSync } from "fs";
import { requireRole } from "@/lib/auth-guard";

const VALID_ACTIONS = ["build", "destroy", "simulate", "stop", "resume", "dump"] as const;
type SARAction = typeof VALID_ACTIONS[number];

let bgOperation: {
  action: string;
  status: "running" | "completed" | "failed";
  logs: string[];
  startedAt: string;
  completedAt: string | null;
  pid: number | null;
  labPath: string;
} | null = null;

export async function POST(req: NextRequest) {
  // build/destroy/stop/resume the lab's VMs on the host.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const action: string = body.action || "resume";

  if (!VALID_ACTIONS.includes(action as SARAction)) {
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  }

  if (bgOperation?.status === "running") {
    return NextResponse.json({ error: "Operation in progress", operation: bgOperation }, { status: 409 });
  }

  // Resolve active lab
  const lab = getActiveLab();

  if (!existsSync(lab.sarScript)) {
    return NextResponse.json({
      error: `SAR script not found at ${lab.sarScript}`,
      labPath: lab.sarPath,
      isDeployed: lab.isDeployed,
    }, { status: 404 });
  }

  bgOperation = {
    action,
    status: "running",
    logs: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    pid: null,
    labPath: lab.sarPath,
  };

  // Use GOAD venv for working ansible
  const home = process.env.HOME || "/root";
  const goadVenvBin = `${home}/.goad/.venv/bin`;
  const extraPath = existsSync(goadVenvBin) ? `${goadVenvBin}:` : "";

  const args = [lab.sarScript, "-a", action];
  bgOperation.logs.push(`$ ${lab.pythonBin} ${args.join(" ")}`);
  bgOperation.logs.push(`[lab] ${lab.sarPath} (deployed: ${lab.isDeployed}, prefix: ${lab.prefix || "none"})`);

  const child = spawn(lab.pythonBin, args, {
    cwd: lab.sarPath,
    env: {
      ...process.env,
      OBJC_DISABLE_INITIALIZE_FORK_SAFETY: "YES",
      PATH: `${extraPath}${lab.sarPath}/venv/bin:${process.env.PATH}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  bgOperation.pid = child.pid || null;

  child.stdout.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    bgOperation!.logs.push(...lines);
    if (bgOperation!.logs.length > 300) bgOperation!.logs = bgOperation!.logs.slice(-300);
  });

  child.stderr.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    bgOperation!.logs.push(...lines.map((l) => `[stderr] ${l}`));
  });

  child.on("close", (code) => {
    bgOperation!.status = code === 0 ? "completed" : "failed";
    bgOperation!.completedAt = new Date().toISOString();
    bgOperation!.logs.push(code === 0 ? `=== SAR ${action} completed ===` : `=== SAR ${action} failed (code ${code}) ===`);
  });

  child.on("error", (err) => {
    bgOperation!.status = "failed";
    bgOperation!.completedAt = new Date().toISOString();
    bgOperation!.logs.push(`[error] ${err.message}`);
  });

  child.unref();

  return NextResponse.json({
    status: "started",
    action,
    labPath: lab.sarPath,
    isDeployed: lab.isDeployed,
    message: `SAR ${action} initiated from ${lab.sarPath}`,
  });
}

export async function GET() {
  if (!bgOperation) return NextResponse.json({ status: "idle", message: "No operation in progress" });
  return NextResponse.json(bgOperation);
}
