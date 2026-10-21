/**
 * POST /api/replay/hec-config/discover
 *   body: { rangeId: string, splunkPassword?: string }
 *
 * One-click HEC configuration from a running SAR range:
 *   1. Resolve the range's Splunk server IP (10.0.2.{octet} from architecture
 *      OR hostname from guacamole_info.servers).
 *   2. Connect to Splunk's management REST API on :8089 with admin credentials
 *      (default `changeme123!`; caller may override).
 *   3. Ensure HEC is enabled globally (PATCH /services/data/inputs/http/http).
 *   4. Find-or-create a HEC input named "detection-platform-replay" and read
 *      back its token.
 *   5. Save the host + token into our persistent HEC config.
 *
 * Requires an ACTIVE WireGuard tunnel so the server-side fetch can reach
 * Splunk's private IP.
 */

import { NextRequest, NextResponse } from "next/server";
import https from "https";
import { URL } from "url";
import { saveHecConfig } from "@/lib/hec-config";
import { requireRole } from "@/lib/auth-guard";
import { safeLookup, labOutboundPolicy, syncUrlBlockReason } from "@/lib/net/ssrf";

const HEC_NAME = "detection-platform-replay";
const DEFAULT_PASSWORD = "changeme123!";
/**
 * Indexes the replay catalog datasets target. Verified empirically: 100% of
 * 500 catalog rows point at `attack_data`. We also include `main` (existing)
 * so the HEC token works for ad-hoc events. If the catalog grows new indexes,
 * add them here OR call the /ensure-indexes endpoint.
 */
const REQUIRED_INDEXES = ["attack_data"];

interface SarStatus {
  status: string;
  attack_range_id?: string | null;
  template_name?: string | null;
  result?: {
    architecture?: Array<{ name: string; os_type?: string | null; ip_last_octet?: number | null }> | null;
    guacamole_info?: { host_ip?: string; servers?: Array<{ name: string; hostname: string }> | null } | null;
  } | null;
}

function findSplunkIp(status: SarStatus): string | null {
  const guac = status.result?.guacamole_info?.servers || [];
  const byGuac = guac.find((g) => g.name === "splunk");
  if (byGuac?.hostname) return byGuac.hostname;
  const arch = status.result?.architecture || [];
  const byArch = arch.find((a) => a.name === "splunk");
  if (byArch && typeof byArch.ip_last_octet === "number") return `10.0.2.${byArch.ip_last_octet}`;
  return null;
}

/**
 * Low-level HTTPS request against Splunk's management API that bypasses TLS
 * verification (Splunk ships self-signed certs by default). Uses node's
 * `https.request` directly because undici (Node 18+ fetch) does not honor
 * `agent` or `rejectUnauthorized` options.
 */
function splunkFetch(rawUrl: string, init: { method?: string; headers?: Record<string, string>; body?: string; auth?: string; timeoutMs?: number }): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(rawUrl);
    const headers: Record<string, string> = { ...(init.headers || {}) };
    if (init.auth) headers["Authorization"] = `Basic ${Buffer.from(init.auth).toString("base64")}`;
    if (init.body) headers["Content-Length"] = String(Buffer.byteLength(init.body));

    const req = https.request({
      method: init.method || "GET",
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers,
      rejectUnauthorized: false,
      timeout: init.timeoutMs || 15000,
      lookup: safeLookup(labOutboundPolicy("SIEM_ALLOW_LOOPBACK")) as any,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        let body: any;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on("timeout", () => { req.destroy(new Error("request timed out")); });
    req.on("error", (err) => reject(err));
    if (init.body) req.write(init.body);
    req.end();
  });
}

export async function POST(req: NextRequest) {
  // Rewrites the global HEC sink → admin only.
  const session = await requireRole("admin");
  if (!session.ok) return session.response;
  const body = await req.json().catch(() => ({}));
  const rangeId = typeof body.rangeId === "string" ? body.rangeId : "";
  const splunkPassword = typeof body.splunkPassword === "string" && body.splunkPassword.length > 0
    ? body.splunkPassword
    : DEFAULT_PASSWORD;

  if (!rangeId) return NextResponse.json({ status: "error", message: "rangeId required" }, { status: 400 });

  // 1. Fetch range status via SAR (through our proxy or direct — we're server-side so direct is fine)
  let rangeStatus: SarStatus;
  try {
    const r = await fetch(`http://localhost:4000/attack-range/status/${encodeURIComponent(rangeId)}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`SAR status ${r.status}`);
    rangeStatus = await r.json();
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: `SAR unreachable: ${e?.message || e}` }, { status: 503 });
  }
  if (rangeStatus.status !== "running") {
    return NextResponse.json({
      status: "error",
      message: `Range status is "${rangeStatus.status}" — must be "running" to configure HEC.`,
    }, { status: 400 });
  }

  const splunkIp = findSplunkIp(rangeStatus);
  if (!splunkIp) {
    return NextResponse.json({
      status: "error",
      message: "No splunk server found in range architecture. Is this a Splunk-bearing template?",
    }, { status: 400 });
  }

  if (!/^[A-Za-z0-9.\-]+$/.test(splunkIp) || syncUrlBlockReason(`https://${splunkIp}:8089/`, labOutboundPolicy("SIEM_ALLOW_LOOPBACK"))) {
    return NextResponse.json({ status: "error", message: `Refusing Splunk host "${String(splunkIp).slice(0, 80)}" (blocked by outbound policy)` }, { status: 400 });
  }
  const mgmtBase = `https://${splunkIp}:8089`;
  const auth = `admin:${splunkPassword}`;

  // 2. Enable HEC globally
  try {
    const r = await splunkFetch(`${mgmtBase}/services/data/inputs/http/http?output_mode=json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "disabled=0&enableSSL=1",
      auth,
    });
    if (r.status !== 200 && r.status !== 201) {
      const msg = typeof r.body === "object" ? (r.body?.messages?.[0]?.text || JSON.stringify(r.body)) : String(r.body).slice(0, 400);
      return NextResponse.json({
        status: "error",
        message: `Could not enable HEC globally on https://${splunkIp}:8089 (HTTP ${r.status}): ${msg}. ` +
                 `Common causes: WireGuard tunnel down, wrong Splunk admin password, or port 8089 closed by the SG.`,
      }, { status: 502 });
    }
  } catch (e: any) {
    return NextResponse.json({
      status: "error",
      message: `Cannot reach Splunk at ${mgmtBase}: ${e?.message || e}. ` +
               `Ensure the WireGuard tunnel is connected (ping ${splunkIp}) and the range's security group allows your current IP.`,
    }, { status: 502 });
  }

  // 3. Ensure required indexes exist on Splunk. Splunk's POST /services/data/indexes
  // errors with 409 "already exists" — we treat that as success.
  const createdIndexes: string[] = [];
  for (const idx of REQUIRED_INDEXES) {
    const r = await splunkFetch(`${mgmtBase}/services/data/indexes?output_mode=json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: idx, datatype: "event" }).toString(),
      auth,
    });
    if (r.status === 201) createdIndexes.push(idx);
    else if (r.status === 409) { /* already exists — fine */ }
    else {
      const msg = typeof r.body === "object"
        ? (r.body?.messages?.[0]?.text || JSON.stringify(r.body))
        : String(r.body).slice(0, 300);
      return NextResponse.json({
        status: "error",
        message: `Failed to create Splunk index "${idx}" (HTTP ${r.status}): ${msg}`,
      }, { status: 502 });
    }
  }

  // 4. Find-or-create our named HEC input. The `indexes` ACL must include every
  // required index — otherwise Splunk rejects events with "Incorrect index".
  const allowedIndexList = ["main", "history", ...REQUIRED_INDEXES].join(",");
  let token: string | null = null;
  let existingEntry: any = null;

  const listRes = await splunkFetch(`${mgmtBase}/services/data/inputs/http?output_mode=json&count=0`, {
    method: "GET",
    auth,
  });
  if (listRes.status === 200 && listRes.body?.entry) {
    existingEntry = (listRes.body.entry as any[]).find((e) => e.name === HEC_NAME || e.name === `http://${HEC_NAME}`);
    if (existingEntry?.content?.token) token = existingEntry.content.token;
  }

  // If existing input's ACL doesn't include all required indexes, delete it
  // so we can recreate with the full ACL in the next step. (Splunk's
  // PATCH/update semantics for HEC inputs are unreliable — delete+recreate
  // is the canonical way to change the `indexes` field.)
  const existingIndexes: string[] = Array.isArray(existingEntry?.content?.indexes)
    ? existingEntry.content.indexes
    : (typeof existingEntry?.content?.indexes === "string" ? existingEntry.content.indexes.split(",") : []);
  const aclComplete = REQUIRED_INDEXES.every((i) => existingIndexes.includes(i));

  if (existingEntry && !aclComplete) {
    // Splunk's delete URL uses the `http://<name>` path form. encodeURIComponent
    // preserves the `/` in the name so we build the path manually.
    const delPath = `/services/data/inputs/http/${encodeURIComponent(existingEntry.name as string)}`;
    await splunkFetch(`${mgmtBase}${delPath}?output_mode=json`, {
      method: "DELETE",
      auth,
    });
    token = null;         // force recreate below
    existingEntry = null; // fall through to create branch
  }

  if (!token) {
    // Create the input with the full index list from the start.
    const createRes = await splunkFetch(`${mgmtBase}/services/data/inputs/http?output_mode=json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: HEC_NAME,
        index: REQUIRED_INDEXES[0], // default index — attack_data
        indexes: allowedIndexList,  // ACL for all indexes this token may write to
        disabled: "0",
        useAck: "0",
        description: "Created by detection-platform for Replay Catalog",
      }).toString(),
      auth,
    });
    if (createRes.status !== 200 && createRes.status !== 201) {
      const msg = typeof createRes.body === "object"
        ? (createRes.body?.messages?.[0]?.text || JSON.stringify(createRes.body))
        : String(createRes.body).slice(0, 400);
      return NextResponse.json({ status: "error", message: `HEC input create failed (HTTP ${createRes.status}): ${msg}` }, { status: 502 });
    }
    token = createRes.body?.entry?.[0]?.content?.token;
  }

  if (!token) {
    return NextResponse.json({
      status: "error",
      message: "HEC input was created/found but the token wasn't returned by Splunk. Try again or configure manually.",
    }, { status: 502 });
  }

  // 4. Save to persistent config
  const saved = saveHecConfig({
    host: splunkIp,
    port: 8088,
    token,
    label: `Cloud range ${rangeStatus.template_name?.replace(/\.yml$/, "") || "range"} (${rangeId.slice(0, 8)})`,
    rangeId,
    rangeServer: "splunk",
  });

  return NextResponse.json({
    status: "ok",
    message:
      `HEC configured. Host ${saved.host}:${saved.port}, token ${saved.token.slice(0, 6)}…${saved.token.slice(-4)}. ` +
      (createdIndexes.length ? `Created Splunk index(es): ${createdIndexes.join(", ")}.` : "Required Splunk indexes already present."),
    host: saved.host,
    port: saved.port,
    tokenLength: saved.token.length,
    label: saved.label,
    createdIndexes,
    allowedIndexList,
  });
}
