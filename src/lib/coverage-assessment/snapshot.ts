import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getActiveLab } from "@/lib/active-lab";

const exec = promisify(execFile);

// Pre-simulation VM snapshot: a rollback point taken before a sweep detonates
// anything, so the analyst can restore the lab to its known state and knows the
// run is what changed it. Snapshots every VM of the currently-running local lab
// (DC + Splunk) via VBoxManage. Best-effort: a partial snapshot is still useful,
// and a cloud/fleet env (no local VMs) simply yields no snapshot.
export async function snapshotActiveLab(tag: string): Promise<{ name: string; vms: string[]; error?: string }> {
  let lab;
  try { lab = getActiveLab(); } catch (e: any) { return { name: "", vms: [], error: `no active lab: ${e?.message || e}` }; }
  const vms = Object.values(lab?.vmNames || {}).filter(Boolean).map(String);
  if (!vms.length) return { name: "", vms: [], error: "no local lab VMs to snapshot" };

  const stamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
  const name = `presim-${tag}-${stamp}`;
  const done: string[] = [];
  for (const vm of vms) {
    try {
      await exec("VBoxManage", [
        "snapshot", vm, "take", name, "--live",
        "--description", `Pre-simulation rollback point for coverage assessment ${tag} (${new Date().toISOString()})`,
      ], { timeout: 180000 });
      done.push(vm);
    } catch { /* keep going — a snapshot of the DC alone is still a useful rollback point */ }
  }
  return { name: done.length ? name : "", vms: done, error: done.length ? undefined : "snapshot failed for all VMs" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vmState(vm: string): Promise<string> {
  try {
    const { stdout } = await exec("VBoxManage", ["showvminfo", vm, "--machinereadable"], { timeout: 30_000 });
    return (stdout.match(/^VMState="([^"]+)"/m) || [])[1] || "unknown";
  } catch { return "unknown"; }
}

async function powerOff(vm: string): Promise<void> {
  if ((await vmState(vm)) === "poweroff") return;
  // Graceful ACPI shutdown first; fall back to a hard poweroff if it ignores it.
  try { await exec("VBoxManage", ["controlvm", vm, "acpipowerbutton"], { timeout: 30_000 }); } catch { /* */ }
  for (let i = 0; i < 20; i++) { if ((await vmState(vm)) === "poweroff") return; await sleep(3000); }
  try { await exec("VBoxManage", ["controlvm", vm, "poweroff"], { timeout: 30_000 }); } catch { /* */ }
  for (let i = 0; i < 10; i++) { if ((await vmState(vm)) === "poweroff") return; await sleep(2000); }
}

// Post-simulation teardown for a destructive sweep: revert the DETONATION host
// (the DC) to the pre-sim snapshot so any damage is undone, then delete that
// snapshot from every lab VM. The SIEM VM (Splunk) is deliberately NOT reverted —
// it holds the telemetry the sweep just measured. VBox requires the VM powered
// off to restore, so each reverted VM is ACPI-stopped, restored and restarted.
// Best-effort and self-contained: returns what happened for the audit trail.
export async function restoreAndDeleteSnapshot(
  name: string, opts: { preserve?: RegExp } = {},
): Promise<{ reverted: string[]; deleted: string[]; error?: string }> {
  const preserve = opts.preserve ?? /splunk|siem/i;
  let lab;
  try { lab = getActiveLab(); } catch (e: any) { return { reverted: [], deleted: [], error: `no active lab: ${e?.message || e}` }; }
  const vms = Object.values(lab?.vmNames || {}).filter(Boolean).map(String);
  if (!vms.length || !name) return { reverted: [], deleted: [], error: "no lab VMs / snapshot name" };

  const reverted: string[] = [];
  const deleted: string[] = [];
  for (const vm of vms) {
    const hasSnap = await exec("VBoxManage", ["snapshot", vm, "list", "--machinereadable"], { timeout: 30_000 })
      .then((r) => r.stdout.includes(`="${name}"`)).catch(() => false);
    if (!hasSnap) continue;
    const isSiem = preserve.test(vm);
    try {
      if (!isSiem) {
        await powerOff(vm);
        await exec("VBoxManage", ["snapshot", vm, "restore", name], { timeout: 180_000 });
        reverted.push(vm);
      }
      await exec("VBoxManage", ["snapshot", vm, "delete", name], { timeout: 180_000 });
      deleted.push(vm);
      if (!isSiem) {
        try { await exec("VBoxManage", ["startvm", vm, "--type", "headless"], { timeout: 120_000 }); } catch { /* left powered off; operator can start it */ }
      }
    } catch { /* keep going for the other VMs */ }
  }
  return { reverted, deleted, error: reverted.length ? undefined : "no VM reverted" };
}
