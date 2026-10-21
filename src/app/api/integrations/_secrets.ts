/**
 * Secret handling for Integration rows (shared by the /api/integrations routes).
 *
 * Integration secrets are still stored as plaintext columns because other
 * modules (lib/github.ts, fleets/[id]/detect, deploy/register.ts, …) read them
 * directly — encrypting at rest needs a coordinated migration there. Until
 * then the API never RETURNS them: responses carry a fixed mask, and a write
 * that echoes the mask back keeps the stored value.
 */

export const SECRET_MASK = "••••••••";
export const SECRET_FIELDS = ["apiKey", "clientSecret", "password", "ssoCertificate"] as const;

type Row = Record<string, any>;

/** Strip secrets from a row for an API response (+ parse extraConfig). */
export function publicIntegration(row: Row): Row {
  const out: Row = { ...row };
  for (const f of SECRET_FIELDS) {
    const has = typeof row[f] === "string" && row[f].length > 0;
    out[f] = has ? SECRET_MASK : "";
    out[`has${f[0].toUpperCase()}${f.slice(1)}`] = has;
  }
  try { out.extraConfig = typeof row.extraConfig === "string" ? JSON.parse(row.extraConfig || "{}") : row.extraConfig; }
  catch { out.extraConfig = {}; }
  // OIDC state/nonce live in extraConfig — never hand them back to clients.
  if (out.extraConfig && typeof out.extraConfig === "object") {
    delete out.extraConfig.sso_state;
    delete out.extraConfig.sso_nonce;
  }
  return out;
}

/** Resolve an incoming secret field: undefined/mask → keep existing; string → new value. */
export function incomingSecret(v: unknown, existing: string): string {
  if (typeof v !== "string") return existing;
  if (v === SECRET_MASK) return existing;
  return v;
}

/** Resolve an incoming plain string field (ignore non-strings → keep existing). */
export function incomingString(v: unknown, existing: string, max = 2048): string {
  return typeof v === "string" ? v.slice(0, max) : existing;
}

/**
 * Key-exfil guard: moving an integration that holds stored secrets to a new
 * apiUrl / mcpServerUrl / ssoIdpUrl must come with freshly entered secrets,
 * otherwise the next /test would send the stored key to the new host.
 * Returns an error when nothing was re-entered; otherwise the list of stored
 * secret fields that were NOT re-entered and must be cleared.
 */
export function exfilGuard(existing: Row, body: Row): { error?: string; clear: string[] } {
  const live = ["apiKey", "clientSecret", "password"] as const;
  const stored = live.filter((f) => typeof existing[f] === "string" && existing[f]);
  if (stored.length === 0) return { clear: [] };
  const norm = (u: unknown) => String(u ?? "").trim().replace(/\/+$/, "");
  const moved = ["apiUrl", "mcpServerUrl", "ssoIdpUrl"].some(
    (k) => typeof body[k] === "string" && norm(body[k]) !== norm(existing[k]),
  );
  if (!moved) return { clear: [] };
  const fresh = (f: string) => typeof body[f] === "string" && body[f] !== SECRET_MASK && body[f] !== "";
  if (!live.some(fresh)) {
    return { error: "Changing the integration URL requires re-entering its credentials (API key / secret / password).", clear: [] };
  }
  return { clear: stored.filter((f) => !fresh(f)) };
}
