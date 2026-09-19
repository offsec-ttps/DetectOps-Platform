/**
 * GET /api/c2/interfaces — the host's IPv4 addresses, so the user can choose
 * which network a managed C2 advertises to beacons (e.g. a VirtualBox host-only
 * net like 192.168.56.1 vs the LAN 192.168.1.x). Caldera binds 0.0.0.0 anyway;
 * this only decides the address baked into the beacon one-liner + console URL.
 */

import { NextResponse } from "next/server";
import { networkInterfaces } from "node:os";
import { requireUser } from "@/lib/auth-guard";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const out: Array<{ name: string; address: string; internal: boolean; hint: string }> = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4") continue;
      let hint = "";
      if (a.internal) hint = "loopback — same host only";
      else if (/^192\.168\.56\./.test(a.address) || /^vbox|vmnet|host/i.test(name)) hint = "host-only / hypervisor net (VMs)";
      else if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) hint = "private LAN";
      else hint = "public / routed";
      out.push({ name, address: a.address, internal: !!a.internal, hint });
    }
  }
  // Non-internal first, then loopback.
  out.sort((x, y) => Number(x.internal) - Number(y.internal));
  return NextResponse.json({ interfaces: out });
}
