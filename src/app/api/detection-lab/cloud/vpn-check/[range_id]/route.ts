/**
 * GET /api/detection-lab/cloud/vpn-check/[range_id]
 *
 * Verifies that the WireGuard tunnel to a range is actually up before the UI
 * lets the operator continue into the lab-build phase.
 *
 * Why this exists: the lab phase runs ansible against the range's PRIVATE IPs
 * (10.0.2.x), which are only routable through the tunnel. The UI used to take
 * the operator's word for it ("I'm connected"), so clicking it early sent
 * ansible at unreachable hosts — it burned ~45 minutes, logged
 * "unreachable=1", and killed the build thread while the EC2s kept billing.
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Resolve the range's private lab IPs from the controller's config. */
async function labTargets(rangeId: string): Promise<string[]> {
  try {
    const res = await fetch(`http://127.0.0.1:4000/attack-range/status/${rangeId}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, unknown>;
    // Prefer explicit host entries; fall back to the SAR default splunk host.
    const hosts = new Set<string>();
    const arch = data.architecture as { hosts?: Array<{ private_ip?: string }> } | undefined;
    for (const h of arch?.hosts || []) {
      if (h.private_ip && /^10\.0\.2\./.test(h.private_ip)) hosts.add(h.private_ip);
    }
    if (!hosts.size) hosts.add("10.0.2.10");
    return [...hosts];
  } catch {
    return ["10.0.2.10"];
  }
}

/** A plain TCP connect is the honest test: it proves the route works. */
function tcpProbe(host: string, port = 22, timeout = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

/** Is any wireguard interface up on this host? */
async function wgInterfaceUp(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ip", ["-brief", "link", "show", "type", "wireguard"], {
      timeout: 3000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ range_id: string }> }) {
  const { range_id } = await ctx.params;
  if (!range_id) return NextResponse.json({ error: "range_id required" }, { status: 400 });

  const [iface, targets] = await Promise.all([wgInterfaceUp(), labTargets(range_id)]);
  const results = await Promise.all(
    targets.map(async (ip) => ({ ip, reachable: await tcpProbe(ip) })),
  );
  const reachable = results.filter((r) => r.reachable).map((r) => r.ip);

  const connected = reachable.length > 0;
  return NextResponse.json({
    connected,
    wg_interface: iface,
    targets: results,
    reason: connected
      ? null
      : iface
        ? "A WireGuard interface is up, but the lab's private IPs are still unreachable. Check that the config's AllowedIPs covers 10.0.2.0/24 and that the router's security group allows your current public IP."
        : "No WireGuard interface is up on this host. Import the config and activate the tunnel before continuing — the lab phase talks to private IPs that only route over the tunnel.",
  });
}
