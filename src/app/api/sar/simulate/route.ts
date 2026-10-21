/**
 * POST /api/sar/simulate
 *
 * Starts an ART simulation on the active SAR deployment.
 * Dynamically resolves the lab path from the latest deployment.
 *
 * Body: {
 *   techniques: string[],
 *   target?: string,
 *   parameters?: Record<string, string>
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { spawn } from "child_process";
import { getActiveLab, getVMName, type ActiveLab } from "@/lib/active-lab";
import { existsSync, readFileSync } from "fs";
import path from "path";
import os from "os";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

function expandHome(p: string | null | undefined): string {
  if (!p) return p || "";
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Find the platform deployment that OWNS the selected VM name and return a lab
 * rooted at that deployment's SAR dir. Campaign Designer targets are the
 * deployment's prefixed VM names (e.g. "lab-ob36ng-windows-dc"); the source SAR
 * install's Vagrantfile does not define those, so simulating there fails with
 * "<name> not found as vagrant box". We must run SAR from the deployment that
 * built the VM, whose Vagrantfile defines the prefixed machine.
 */
function resolveDeploymentForTarget(target: string): ActiveLab | null {
  if (!target) return null;
  try {
    const registryPath = path.join(process.cwd(), "labs", ".deployments-registry.json");
    if (!existsSync(registryPath)) return null;
    const registry: Array<{ prefix?: string; deployPath: string; labType?: string; vmNames?: Record<string, string> }> =
      JSON.parse(readFileSync(registryPath, "utf-8"));
    for (const dep of registry) {
      const names = Object.values(dep.vmNames || {});
      if (!names.includes(target)) continue;
      const dp = expandHome(dep.deployPath);
      const sarDir = path.join(dp, "sar");
      const script = path.join(sarDir, "attack_range_local.py");
      const python = path.join(sarDir, "venv", "bin", "python3");
      if (!existsSync(script)) return null; // deployment not simulatable (docker/cloud/missing)
      return {
        sarPath: sarDir,
        sarVagrantDir: path.join(sarDir, "vagrant"),
        sarScript: script,
        pythonBin: python,
        deployPath: dp,
        prefix: dep.prefix || null,
        vmNames: dep.vmNames || {},
        labType: dep.labType || "sar",
        isDeployed: true,
      };
    }
  } catch { /* ignore — fall back to getActiveLab */ }
  return null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const techniques: string[] = (body.techniques as string[]) || [];
  const target: string = (body.target as string) || "";
  const parameters: Record<string, string> = (body.parameters as Record<string, string>) || {};

  if (!techniques.length) {
    return NextResponse.json({ error: "At least one technique ID is required" }, { status: 400 });
  }

  if (!Array.isArray(techniques) || techniques.length > 50) {
    return NextResponse.json({ error: "techniques must be an array of at most 50 IDs" }, { status: 400 });
  }
  // `target` is passed as a CLI argument to SAR (which hands it to vagrant/ansible):
  // no leading '-' (option injection) and no shell/pattern metacharacters.
  if (target && (typeof target !== "string" || !/^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,127}$/.test(target))) {
    return NextResponse.json({ error: "Invalid target name" }, { status: 400 });
  }
  for (const t of techniques) {
    if (typeof t !== "string" || !/^T\d{4}(\.\d{3})?$/i.test(t)) {
      return NextResponse.json({ error: `Invalid technique ID format: ${t}` }, { status: 400 });
    }
  }

  // Resolve the lab. Prefer the deployment that actually owns the selected VM
  // (so we run SAR from the dir whose Vagrantfile defines that machine); fall
  // back to the "active lab" heuristic when the target isn't a known deploy VM.
  const owning = resolveDeploymentForTarget(target);
  const lab = owning || getActiveLab();
  const targetIp = parameters.target_ip || "10.0.1.14";

  // Determine the target server name using the deployment's VM names.
  // For an owning deploy the target is already the exact (prefixed) machine name.
  let targetServer: string;
  if (target) {
    targetServer = lab.vmNames[target] || target;
  } else {
    // Default: use the deployed windows-dc name
    targetServer = getVMName(lab, "windows-dc");
  }

  if (!existsSync(lab.sarScript)) {
    return NextResponse.json({
      error: `SAR script not found at ${lab.sarScript}. Deploy a lab first.`,
      labPath: lab.sarPath,
      isDeployed: lab.isDeployed,
    }, { status: 404 });
  }

  // Create simulation record
  const simRun = await prisma.simulationRun.create({
    data: {
      techniqueIds: JSON.stringify(techniques),
      targetServer,
      targetIp,
      source: "local",
      executor: "art",
      parameters: JSON.stringify({ ...parameters, labPath: lab.sarPath, deployPath: lab.deployPath }),
      status: "running",
      logs: `[info] Starting ART simulation: ${techniques.join(", ")} on ${targetServer}\n[info] Lab path: ${lab.sarPath}\n[info] Deployed: ${lab.isDeployed} (prefix: ${lab.prefix || "none"})\n`,
    },
  });
  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "simulation", action: "simulation.start",
    actor: sessionUser?.email || "anonymous", status: "ok",
    targetType: "simulation", targetId: simRun.id,
    message: `ART ${techniques.join(",")} → ${targetServer}`,
    details: { techniques, target: targetServer, targetIp, executor: "art", labPath: lab.sarPath, deployPath: lab.deployPath },
  });

  const args = [lab.sarScript, "-a", "simulate", "-st", techniques.join(","), "-t", targetServer];
  const startTime = Date.now();

  // Use GOAD venv for ansible (system ansible is broken)
  const home = process.env.HOME || "/root";
  const goadVenvBin = `${home}/.goad/.venv/bin`;
  const extraPath = existsSync(goadVenvBin) ? `${goadVenvBin}:` : "";

  try {
    const child = spawn(lab.pythonBin, args, {
      cwd: lab.sarPath,
      env: {
        ...process.env,
        OBJC_DISABLE_INITIALIZE_FORK_SAFETY: "YES",
        PATH: `${extraPath}${lab.sarPath}/venv/bin:${process.env.PATH}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let allLogs = `$ ${lab.pythonBin} ${args.join(" ")}\n[cwd] ${lab.sarPath}\n\n`;

    child.stdout.on("data", (data: Buffer) => {
      allLogs += data.toString();
      prisma.simulationRun.update({ where: { id: simRun.id }, data: { logs: allLogs } }).catch(() => {});
    });

    child.stderr.on("data", (data: Buffer) => {
      allLogs += data.toString();
      prisma.simulationRun.update({ where: { id: simRun.id }, data: { logs: allLogs } }).catch(() => {});
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      // Check if ART actually executed (even if exit code is non-zero due to
      // credential disruption from techniques like T1003 Mimikatz)
      const artExecuted = allLogs.includes("ART_EXECUTION_DONE") ||
                          allLogs.includes("Invoke-AtomicTest") ||
                          allLogs.includes("successfully executed");
      const status = (code === 0 || artExecuted) ? "success" : "failure";
      allLogs += `\n[${status}] Process exited with code ${code} (${(durationMs / 1000).toFixed(1)}s)`;
      if (code !== 0 && artExecuted) {
        allLogs += `\n[info] Technique was executed successfully. Non-zero exit code is expected for credential-dumping techniques (T1003, etc.) that disrupt WinRM sessions.\n`;
      }
      allLogs += "\n";
      prisma.simulationRun.update({
        where: { id: simRun.id },
        data: { status, logs: allLogs, durationMs, completedAt: new Date() },
      }).catch((err) => console.error("Failed to update simulation run:", err));
      void logEvent({
        category: "simulation", action: "simulation.complete",
        actor: sessionUser?.email || "anonymous",
        status: status === "success" ? "ok" : "error",
        targetType: "simulation", targetId: simRun.id,
        durationMs,
        message: `exit=${code} ${status}`,
        details: { exitCode: code, artExecuted, techniques, target: targetServer },
      });
    });

    child.on("error", (err) => {
      allLogs += `\n[error] ${err.message}\n`;
      prisma.simulationRun.update({
        where: { id: simRun.id },
        data: { status: "error", logs: allLogs, errorMessage: err.message, durationMs: Date.now() - startTime, completedAt: new Date() },
      }).catch(() => {});
    });

    // 5 minute timeout
    setTimeout(async () => {
      try {
        const run = await prisma.simulationRun.findUnique({ where: { id: simRun.id } });
        if (run && run.status === "running") {
          child.kill("SIGTERM");
          await prisma.simulationRun.update({
            where: { id: simRun.id },
            data: { status: "failure", logs: allLogs + "\n[timeout] Simulation timed out after 5 minutes\n", errorMessage: "Timed out", durationMs: Date.now() - startTime, completedAt: new Date() },
          });
        }
      } catch {}
    }, 300000);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.simulationRun.update({
      where: { id: simRun.id },
      data: { status: "error", logs: `[error] Failed to spawn: ${errorMsg}`, errorMessage: errorMsg, completedAt: new Date() },
    });
    return NextResponse.json({ id: simRun.id, status: "error", error: errorMsg }, { status: 500 });
  }

  return NextResponse.json({
    id: simRun.id,
    status: "running",
    techniques,
    target: targetServer,
    labPath: lab.sarPath,
    isDeployed: lab.isDeployed,
    message: "Simulation started. Poll GET /api/sar/simulations for live status.",
  });
}
