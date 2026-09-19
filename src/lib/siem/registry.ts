/** SIEM provider registry + connection→config resolver (decrypts secrets). */

import type { SiemConnection } from "@/generated/prisma/client";
import { decrypt } from "@/lib/crypto/credential-vault";
import type { SiemProvider, SiemConfig, SiemKind } from "./types";
import { splunkProvider } from "./providers/splunk";
import { mdeProvider } from "./providers/mde";

const PROVIDERS: Record<SiemKind, SiemProvider> = {
  splunk: splunkProvider,
  mde: mdeProvider,
};

export function getSiemProvider(kind: string): SiemProvider | null {
  return (PROVIDERS as Record<string, SiemProvider>)[kind] || null;
}

export function listSiemProviders(): Array<Pick<SiemProvider, "kind" | "displayName" | "language">> {
  return Object.values(PROVIDERS).map((p) => ({ kind: p.kind, displayName: p.displayName, language: p.language }));
}

/** Decrypt a stored connection into a provider-ready config. */
export function resolveSiemConfig(row: SiemConnection): { ok: true; cfg: SiemConfig } | { ok: false; reason: string } {
  let secrets: Record<string, string> = {};
  if (row.secretsEnc) {
    try { secrets = JSON.parse(decrypt(row.secretsEnc)); }
    catch (e: any) { return { ok: false, reason: `secret decrypt failed: ${e?.message || e}` }; }
  }
  if (row.kind === "splunk") {
    if (!row.url) return { ok: false, reason: "Splunk URL not set" };
    const authMode = row.authMode === "basic" ? "basic" : "token";
    if (authMode === "token" && !secrets.token) return { ok: false, reason: "Splunk token not set" };
    if (authMode === "basic" && !secrets.password) return { ok: false, reason: "Splunk password not set" };
    return { ok: true, cfg: { kind: "splunk", url: row.url, authMode, username: row.username || "admin", token: secrets.token, password: secrets.password } };
  }
  if (row.kind === "mde") {
    if (!row.tenantId || !row.clientId) return { ok: false, reason: "MDE tenantId/clientId not set" };
    if (!secrets.clientSecret) return { ok: false, reason: "MDE client secret not set" };
    return { ok: true, cfg: { kind: "mde", tenantId: row.tenantId, clientId: row.clientId, clientSecret: secrets.clientSecret } };
  }
  return { ok: false, reason: `unknown SIEM kind "${row.kind}"` };
}
