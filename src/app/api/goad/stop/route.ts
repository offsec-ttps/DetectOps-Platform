/**
 * POST /api/goad/stop
 *
 * Gracefully stop GOAD lab VMs via ACPI power button.
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireRole } from "@/lib/auth-guard";

const exec = promisify(execFile);

const GOAD_INSTANCE_ID = process.env.GOAD_INSTANCE_ID || "d86a4c-minilab-virtualbox";

const LAB_VMS: Record<string, string[]> = {
  MINILAB: ["DC01", "WS01"],
  GOAD: ["DC01", "DC02", "DC03", "SRV02", "SRV03"],
  "GOAD-Light": ["DC01", "DC02", "SRV02"],
};

async function stopVM(vmName: string): Promise<{ name: string; status: string; error?: string }> {
  try {
    const { stdout } = await exec("VBoxManage", ["showvminfo", vmName, "--machinereadable"], {
      timeout: 10000,
    });
    const match = stdout.match(/VMState="([^"]+)"/);
    const state = match ? match[1] : "unknown";

    if (state !== "running") {
      return { name: vmName, status: "already_stopped" };
    }

    await exec("VBoxManage", ["controlvm", vmName, "acpipowerbutton"], { timeout: 15000 });
    return { name: vmName, status: "stopping" };
  } catch (err: any) {
    return { name: vmName, status: "error", error: err.message };
  }
}

export async function POST(req: NextRequest) {
  // Shuts down host VirtualBox VMs.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const lab = body.lab || "MINILAB";

  const vms = LAB_VMS[lab] || LAB_VMS.MINILAB;
  const results = await Promise.all(vms.map((vm) => stopVM(vm)));

  const allOk = results.every((r) => r.status === "stopping" || r.status === "already_stopped");

  return NextResponse.json({
    success: allOk,
    instanceId: GOAD_INSTANCE_ID,
    lab,
    vms: results,
  });
}
