import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { safeLookup, labOutboundPolicy, syncUrlBlockReason } from "@/lib/net/ssrf";

/**
 * Minimal fetch-like client for lab appliances with self-signed certificates
 * (Splunk mgmt/HEC on a SAR range). TLS verification is disabled PER REQUEST via
 * `rejectUnauthorized: false` — never by flipping the process-wide
 * NODE_TLS_REJECT_UNAUTHORIZED, which silently disabled certificate checks for
 * every concurrent outbound request in the server. The lab outbound policy is
 * enforced on the connected address (metadata/link-local always blocked).
 * Production: set LAB_TLS_CA_FILE to the lab CA bundle to turn verification ON.
 */
let labCa: Buffer | null | undefined;
function labCaBundle(): Buffer | null {
  if (labCa === undefined) {
    try { labCa = process.env.LAB_TLS_CA_FILE ? readFileSync(process.env.LAB_TLS_CA_FILE) : null; } catch { labCa = null; }
  }
  return labCa;
}
export interface LabResponse { ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }

export function labFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | Buffer; timeoutMs?: number; maxBytes?: number } = {},
): Promise<LabResponse> {
  const policy = labOutboundPolicy();
  const blocked = syncUrlBlockReason(url, policy);
  if (blocked) return Promise.reject(new Error(blocked));
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const maxBytes = init.maxBytes ?? 32 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      {
        hostname: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search, method: init.method || "GET", headers: init.headers,
        ...(labCaBundle() ? { ca: labCaBundle()!, rejectUnauthorized: true } : { rejectUnauthorized: false }), lookup: safeLookup(policy) as any,
        timeout: init.timeoutMs ?? 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) { req.destroy(new Error("response too large")); return; }
          chunks.push(c);
        });
        res.on("end", () => {
          const buf = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 0;
          resolve({ ok: status >= 200 && status < 300, status, text: async () => buf, json: async () => JSON.parse(buf) });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
