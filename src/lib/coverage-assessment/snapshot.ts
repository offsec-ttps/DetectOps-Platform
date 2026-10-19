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
