/**
 * POST /api/goad/start
 *
 * Start GOAD lab VMs. Supports both headless and GUI modes.
 * Body: { gui?: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

const GOAD_INSTANCE_ID = process.env.GOAD_INSTANCE_ID || "d86a4c-minilab-virtualbox";

const LAB_VMS: Record<string, string[]> = {
  MINILAB: ["DC01", "WS01"],
  GOAD: ["DC01", "DC02", "DC03", "SRV02", "SRV03"],
  "GOAD-Light": ["DC01", "DC02", "SRV02"],
};

async function getVMState(vmName: string): Promise<string> {
  try {
    const { stdout } = await exec("VBoxManage", ["showvminfo", vmName, "--machinereadable"], {
      timeout: 10000,
    });
    const match = stdout.match(/VMState="([^"]+)"/);
    return match ? match[1] : "unknown";
  } catch {
    return "not_found";
  }
}

async function startVM(vmName: string, gui: boolean): Promise<{ name: string; status: string; error?: string }> {
  const state = await getVMState(vmName);

  if (state === "running") {
    return { name: vmName, status: "already_running" };
  }

  if (state === "not_found") {
    return { name: vmName, status: "error", error: "VM not found in VirtualBox" };
  }

  try {
    const vmType = gui ? "gui" : "headless";
    await exec("VBoxManage", ["startvm", vmName, "--type", vmType], { timeout: 30000 });
    return { name: vmName, status: "started" };
  } catch (err: any) {
    return { name: vmName, status: "error", error: err.message };
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const gui = body.gui === true;
  const lab = body.lab || "MINILAB";

  const vms = LAB_VMS[lab] || LAB_VMS.MINILAB;

  const results = await Promise.all(vms.map((vm) => startVM(vm, gui)));

  const allOk = results.every((r) => r.status === "started" || r.status === "already_running");

  return NextResponse.json({
    success: allOk,
    instanceId: GOAD_INSTANCE_ID,
    lab,
    mode: gui ? "gui" : "headless",
    vms: results,
  });
}
