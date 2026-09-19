/**
 * AWS Security Group sync helpers for cloud attack ranges.
 *
 * Why this exists: residential ISPs rotate public IPs. SAR's builder locks the
 * router's security group to the user's IP at build time, so when the ISP
 * rotates, WireGuard handshakes silently drop at the VPC edge (rx_bytes=0) and
 * the tunnel looks connected but traffic stalls.
 *
 * This module:
 *   - Fetches the user's current public IP
 *   - Looks up the range's router instance + its security group(s)
 *   - Compares allowed CIDRs vs current IP
 *   - Can add the current IP to the SG (idempotent) and optionally revoke stale ones
 *
 * Uses the AWS CLI via `execFile` because the host already has creds at
 * ~/.aws (same ones SAR mounts into its containers) and the CLI output is
 * easier to reason about than managing @aws-sdk/client-ec2 here.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

const WG_PORT = 51820;
const SSH_PORT = 22;

export interface SgSyncStatus {
  rangeId: string;
  routerInstanceId: string | null;
  region: string | null;
  sgId: string | null;
  currentIp: string | null;
  /** All CIDRs currently allowed on 51820/udp */
  allowedUdpCidrs: string[];
  /** All CIDRs currently allowed on 22/tcp */
  allowedTcpCidrs: string[];
  /** true when currentIp/32 is in BOTH udp and tcp lists */
  inSync: boolean;
  /** CIDRs in SG that don't match current IP — candidates for revoke */
  staleCidrs: string[];
  error?: string;
}

async function fetchCurrentIp(): Promise<string | null> {
  // Primary: ipify. Fallback: AWS's own 169.254 metadata (won't work from a
  // residential box, just fine — the primary almost always succeeds).
  try {
    const res = await fetch("https://api.ipify.org?format=text", { cache: "no-store" });
    if (!res.ok) return null;
    const txt = (await res.text()).trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(txt)) return null;
    return txt;
  } catch { return null; }
}

async function getRangeRegion(rangeId: string): Promise<string | null> {
  // Ask SAR for the range's config to learn the region/location.
  try {
    const res = await fetch(`http://localhost:4000/configs/${rangeId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    const c = body?.content || {};
    return c?.aws?.region || c?.azure?.location || c?.gcp?.region || null;
  } catch { return null; }
}

async function describeInstances(region: string, rangeId: string) {
  // SAR doesn't set an `attack_range_id` tag. The range ID is embedded in the
  // Name tag: `ar-{role}-{uuid}`. Filter on Name pattern instead.
  const { stdout } = await exec("aws", [
    "ec2", "describe-instances",
    "--region", region,
    "--filters",
      `Name=tag:Name,Values=ar-router-${rangeId},ar-splunk-${rangeId},ar-win-${rangeId},ar-*-${rangeId}`,
      "Name=instance-state-name,Values=running,pending,stopping,stopped",
    "--query", "Reservations[].Instances[].[InstanceId,Tags[?Key==`Name`].Value|[0],SecurityGroups[].GroupId,State.Name]",
    "--output", "json",
  ], { timeout: 20_000, maxBuffer: 5 * 1024 * 1024 });
  return JSON.parse(stdout) as Array<[string, string | null, string[] | null, string]>;
}

async function describeSecurityGroup(region: string, sgId: string) {
  const { stdout } = await exec("aws", [
    "ec2", "describe-security-groups",
    "--region", region,
    "--group-ids", sgId,
    "--query", "SecurityGroups[].IpPermissions",
    "--output", "json",
  ], { timeout: 20_000, maxBuffer: 5 * 1024 * 1024 });
  return JSON.parse(stdout) as Array<Array<{ IpProtocol: string; FromPort?: number; ToPort?: number; IpRanges: Array<{ CidrIp: string; Description?: string }> }>>;
}

function cidrsFor(perms: any[][], proto: string, port: number): string[] {
  const out: string[] = [];
  for (const group of perms) {
    for (const rule of group) {
      if (rule.IpProtocol === proto && rule.FromPort === port && rule.ToPort === port) {
        for (const r of rule.IpRanges || []) out.push(r.CidrIp);
      }
    }
  }
  return [...new Set(out)];
}

export async function getSgStatus(rangeId: string): Promise<SgSyncStatus> {
  const base: SgSyncStatus = {
    rangeId, routerInstanceId: null, region: null, sgId: null,
    currentIp: null, allowedUdpCidrs: [], allowedTcpCidrs: [],
    inSync: false, staleCidrs: [],
  };

  const [currentIp, region] = await Promise.all([fetchCurrentIp(), getRangeRegion(rangeId)]);
  base.currentIp = currentIp;
  base.region = region;

  if (!region) return { ...base, error: "Range config or region could not be loaded from SAR." };

  try {
    const instances = await describeInstances(region, rangeId);
    const router = instances.find((r) => (r[1] || "").toLowerCase().includes("router"));
    if (!router) return { ...base, error: `No router instance tagged attack_range_id=${rangeId}.` };
    const sgId = (router[2] || [])[0];
    if (!sgId) return { ...base, error: "Router has no security group." };
    base.routerInstanceId = router[0];
    base.sgId = sgId;

    const perms = await describeSecurityGroup(region, sgId);
    base.allowedUdpCidrs = cidrsFor(perms, "udp", WG_PORT);
    base.allowedTcpCidrs = cidrsFor(perms, "tcp", SSH_PORT);

    const targetCidr = currentIp ? `${currentIp}/32` : null;
    base.inSync = !!targetCidr
      && base.allowedUdpCidrs.includes(targetCidr)
      && base.allowedTcpCidrs.includes(targetCidr);

    // "Stale" = in SG but not our current IP. We won't touch 0.0.0.0/0 style
    // wildcards — those are intentional user choices.
    const union = [...new Set([...base.allowedUdpCidrs, ...base.allowedTcpCidrs])];
    base.staleCidrs = union.filter((c) => c !== targetCidr && !c.endsWith("/0"));

    return base;
  } catch (e: any) {
    return { ...base, error: e?.message || String(e) };
  }
}

export async function addCurrentIpToSg(rangeId: string, opts?: { revokeStale?: boolean }): Promise<{ ok: true; sgId: string; addedCidr: string; revoked: string[] } | { ok: false; error: string }> {
  const status = await getSgStatus(rangeId);
  if (status.error) return { ok: false, error: status.error };
  if (!status.region) return { ok: false, error: "region unknown" };
  if (!status.sgId) return { ok: false, error: "sg not found" };
  if (!status.currentIp) return { ok: false, error: "could not determine current public IP" };

  const cidr = `${status.currentIp}/32`;
  const desc = `detection-platform sync ${new Date().toISOString().slice(0, 10)}`;

  try {
    // authorize-security-group-ingress is idempotent-ish: it errors on duplicate
    // rules but we filter beforehand. We only add what's missing.
    const needUdp = !status.allowedUdpCidrs.includes(cidr);
    const needTcp = !status.allowedTcpCidrs.includes(cidr);
    if (needUdp || needTcp) {
      const partial: any[] = [];
      if (needUdp) partial.push({ IpProtocol: "udp", FromPort: WG_PORT, ToPort: WG_PORT, IpRanges: [{ CidrIp: cidr, Description: desc }] });
      if (needTcp) partial.push({ IpProtocol: "tcp", FromPort: SSH_PORT, ToPort: SSH_PORT, IpRanges: [{ CidrIp: cidr, Description: desc }] });
      await exec("aws", [
        "ec2", "authorize-security-group-ingress",
        "--region", status.region,
        "--group-id", status.sgId,
        "--ip-permissions", JSON.stringify(partial),
      ], { timeout: 20_000 });
    }

    // Optional: revoke stale IPs so the SG doesn't grow unbounded over months.
    const revoked: string[] = [];
    if (opts?.revokeStale) {
      for (const stale of status.staleCidrs) {
        try {
          const revPerms: any[] = [];
          if (status.allowedUdpCidrs.includes(stale)) {
            revPerms.push({ IpProtocol: "udp", FromPort: WG_PORT, ToPort: WG_PORT, IpRanges: [{ CidrIp: stale }] });
          }
          if (status.allowedTcpCidrs.includes(stale)) {
            revPerms.push({ IpProtocol: "tcp", FromPort: SSH_PORT, ToPort: SSH_PORT, IpRanges: [{ CidrIp: stale }] });
          }
          if (revPerms.length > 0) {
            await exec("aws", [
              "ec2", "revoke-security-group-ingress",
              "--region", status.region,
              "--group-id", status.sgId,
              "--ip-permissions", JSON.stringify(revPerms),
            ], { timeout: 20_000 });
            revoked.push(stale);
          }
        } catch { /* skip */ }
      }
    }

    return { ok: true, sgId: status.sgId, addedCidr: cidr, revoked };
  } catch (e: any) {
    return { ok: false, error: e?.stderr?.toString?.() || e?.message || String(e) };
  }
}
