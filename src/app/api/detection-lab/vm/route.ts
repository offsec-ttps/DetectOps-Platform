/**
 * POST /api/detection-lab/vm
 *
 * Control a single VirtualBox VM via VBoxManage.
 *
 * Body: { vmName: string, action: "start" | "stop" | "poweroff" | "restart" | "savestate" }
 *
 *   - start    : VBoxManage startvm <name> --type headless
 *                (if saved, resumes; if poweroff, boots from fresh)
 *   - stop     : VBoxManage controlvm <name> acpipowerbutton  (graceful shutdown)
 *   - poweroff : VBoxManage controlvm <name> poweroff         (hard power off)
 *   - savestate: VBoxManage controlvm <name> savestate        (pause + save state)
 *   - restart  : poweroff then startvm
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

const VALID_ACTIONS = ["start", "stop", "poweroff", "restart", "savestate", "delete"] as const;
type VMAction = typeof VALID_ACTIONS[number];

async function getVMState(vmName: string): Promise<string> {
  try {
    const { stdout } = await exec("VBoxManage", ["showvminfo", vmName, "--machinereadable"], { timeout: 10000 });
    const match = stdout.match(/VMState="([^"]+)"/);
    return match ? match[1] : "unknown";
  } catch {
    return "not_found";
  }
}

async function ensureRegisteredVM(vmName: string): Promise<boolean> {
  try {
    const { stdout } = await exec("VBoxManage", ["list", "vms"], { timeout: 10000 });
    return stdout.includes(`"${vmName}"`);
  } catch {
    return false;
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { vmName, action } = body;

  if (!vmName || typeof vmName !== "string") {
    return NextResponse.json({ error: "vmName required" }, { status: 400 });
  }
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  if (!(await ensureRegisteredVM(vmName))) {
    return NextResponse.json({ error: `VM '${vmName}' not registered in VirtualBox` }, { status: 404 });
  }

  const state = await getVMState(vmName);
  const results: string[] = [];

  try {
    if (action === "start") {
      if (state === "running") {
        return NextResponse.json({ success: true, vmName, action, state, message: "Already running" });
      }
      await exec("VBoxManage", ["startvm", vmName, "--type", "headless"], { timeout: 60000 });
      results.push(`Started ${vmName}`);
    }

    else if (action === "stop") {
      if (state === "poweroff" || state === "saved") {
        return NextResponse.json({ success: true, vmName, action, state, message: "Already stopped" });
      }
      if (state !== "running") {
        return NextResponse.json({ error: `Cannot stop VM in state '${state}'` }, { status: 409 });
      }
      // Graceful first (clean shutdown for a Linux/Splunk guest), then VERIFY.
      // A Windows guest (e.g. the SAR domain controller) with no interactive
      // session typically ignores the ACPI power button, so firing it and
      // returning — as this did before — left the VM running while the UI
      // reported "stopped". Poll for the guest to power off and hard-stop as a
      // fallback so "Stop" is deterministic and actually halts every VM.
      await exec("VBoxManage", ["controlvm", vmName, "acpipowerbutton"], { timeout: 30000 }).catch(() => {});
      results.push(`Sent ACPI shutdown to ${vmName}`);
      let stopped = false;
      for (let i = 0; i < 20; i++) {          // up to ~60s grace for a clean shutdown
        await sleep(3000);
        const s = await getVMState(vmName);
        if (s === "poweroff" || s === "saved") { stopped = true; break; }
      }
      if (!stopped) {
        await exec("VBoxManage", ["controlvm", vmName, "poweroff"], { timeout: 30000 });
        results.push(`ACPI shutdown ignored after 60s — forced power off ${vmName}`);
      } else {
        results.push(`${vmName} shut down gracefully`);
      }
    }

    else if (action === "poweroff") {
      if (state === "poweroff") {
        return NextResponse.json({ success: true, vmName, action, state, message: "Already off" });
      }
      await exec("VBoxManage", ["controlvm", vmName, "poweroff"], { timeout: 30000 });
      results.push(`Powered off ${vmName}`);
    }

    else if (action === "savestate") {
      if (state !== "running") {
        return NextResponse.json({ error: `Cannot save state — VM is not running (state: ${state})` }, { status: 409 });
      }
      await exec("VBoxManage", ["controlvm", vmName, "savestate"], { timeout: 60000 });
      results.push(`Saved state for ${vmName}`);
    }

    else if (action === "delete") {
      // Hard power off first (ignore errors if already off), then unregister and
      // delete the VM's disks. This is the teardown path for source-installed
      // labs that have no platform deployment.json to drive `-a destroy`.
      if (state === "running" || state === "paused") {
        try { await exec("VBoxManage", ["controlvm", vmName, "poweroff"], { timeout: 30000 }); results.push(`Powered off ${vmName}`); await sleep(2000); }
        catch (e: any) { results.push(`Power off had issues: ${e.message?.slice(0, 80)}`); }
      }
      await exec("VBoxManage", ["unregistervm", vmName, "--delete"], { timeout: 120000 });
      results.push(`Unregistered and deleted ${vmName}`);
      return NextResponse.json({ success: true, vmName, action, previousState: state, state: "deleted", results });
    }

    else if (action === "restart") {
      if (state === "running") {
        try {
          await exec("VBoxManage", ["controlvm", vmName, "poweroff"], { timeout: 30000 });
          results.push(`Powered off ${vmName}`);
          await sleep(3000);
        } catch (e: any) {
          results.push(`Power off had issues: ${e.message?.slice(0, 80)}`);
        }
      }
      await exec("VBoxManage", ["startvm", vmName, "--type", "headless"], { timeout: 60000 });
      results.push(`Started ${vmName}`);
    }

    const newState = await getVMState(vmName);
    return NextResponse.json({ success: true, vmName, action, previousState: state, state: newState, results });
  } catch (err: any) {
    return NextResponse.json(
      { error: `VBoxManage failed: ${err.message?.slice(0, 200)}`, vmName, action, state },
      { status: 500 }
    );
  }
}
