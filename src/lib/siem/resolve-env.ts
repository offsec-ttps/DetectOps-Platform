/**
 * Resolve which SIEM connection a simulation target should validate against.
 *
 *   local → auto-provision (once) a Splunk connection from the active SAR lab's
 *           attack_range_local.conf, so local detection "just works".
 *   cloud → a cloud-scoped connection (user-registered from the range's Splunk).
 *   fleet/c2 → the user's default connection for that scope (MDE preferred).
 *
 * Returns the SiemConnection row to use, or null when the user must connect one.
 */

import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto/credential-vault";
import { getActiveLab } from "@/lib/active-lab";
import type { SiemConnection } from "@/generated/prisma/client";

function parseConf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let section = "";
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const sec = t.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1]; continue; }
    const kv = t.match(/^([\w.]+)\s*=\s*(.*)$/);
    if (kv) out[`${section}.${kv[1]}`] = kv[2].trim();
  }
  return out;
}

/** Build/refresh the auto local-Splunk connection from the active SAR lab. */
async function ensureLocalSplunk(ownerId: string): Promise<SiemConnection | null> {
  let config: Record<string, string> = {};
  try {
    const lab = getActiveLab();
    config = parseConf(await readFile(`${lab.sarPath}/attack_range_local.conf`, "utf-8"));
  } catch { return null; }
  const ip = config["splunk_server.splunk_server_private_ip"] || "10.0.1.12";
  const password = config["splunk_settings.splunk_admin_password"] || "";
  if (!password) return null;
  const url = `https://${ip}:8089`;
  const data = {
    kind: "splunk", scope: "local", url, authMode: "basic", username: "admin",
    secretsEnc: encrypt(JSON.stringify({ password })), status: "unknown", ownerId, isDefault: true,
  };
  return prisma.siemConnection.upsert({
    where: { name: "Local Lab Splunk (auto)" },
    create: { name: "Local Lab Splunk (auto)", ...data },
    update: { url, secretsEnc: data.secretsEnc },   // refresh endpoint/password if the lab changed
  });
}

export async function resolveEnvSiemConnection(
  source: string, ownerId: string, targetRef?: string,
): Promise<SiemConnection | null> {
  // Exact target binding wins.
  if (targetRef) {
    const bound = await prisma.siemConnection.findFirst({ where: { targetRef } });
    if (bound) return bound;
  }
  if (source === "local" || source === "sar" || source === "deployed-lab") {
    return ensureLocalSplunk(ownerId);
  }
  // cloud / fleet / c2 → a scoped connection, preferring the default; fleet/c2
  // prefer MDE (the endpoint-native detection source).
  const scoped = await prisma.siemConnection.findMany({
    where: { scope: { in: [source, "any"] } },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (!scoped.length) return null;
  if (source === "fleet" || source === "c2") {
    return scoped.find((s) => s.kind === "mde") || scoped[0];
  }
  return scoped[0];
}
