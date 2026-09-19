/**
 * Tiny AEAD wrapper around AES-256-GCM with a scrypt-derived key.
 *
 * Master key comes from `CREDENTIAL_VAULT_KEY` (env). If unset we fall back
 * to a process-local random key — this works for `dev` only and rejects in
 * production (fail-fast). The salt is fixed (`detectops-vault-v1`) since the
 * master key itself is high-entropy; per-record nonces give per-record
 * uniqueness.
 *
 * Encrypted payload layout (base64):
 *   nonce(12) | ciphertext | tag(16)
 *
 * Decryption returns "" for an empty input — callers store empty strings for
 * optional fields without special-casing.
 */

import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const SALT = Buffer.from("detectops-vault-v1");

let cachedKey: Buffer | null = null;
let cachedSource: "env" | "dev-ephemeral" | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDENTIAL_VAULT_KEY;
  if (raw && raw.length >= 16) {
    cachedKey = scryptSync(raw, SALT, KEY_LEN, { N: 1 << 15, maxmem: 64 * 1024 * 1024 });
    cachedSource = "env";
    return cachedKey;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("CREDENTIAL_VAULT_KEY is not set; refusing to use ephemeral key in production. Set a 32+ char random value in .env.");
  }
  cachedKey = randomBytes(KEY_LEN);
  cachedSource = "dev-ephemeral";
  // eslint-disable-next-line no-console
  console.warn("[credential-vault] CREDENTIAL_VAULT_KEY unset — using ephemeral key. Stored creds will become unreadable after restart.");
  return cachedKey;
}

export function vaultSource(): "env" | "dev-ephemeral" | "unconfigured" {
  if (process.env.CREDENTIAL_VAULT_KEY && process.env.CREDENTIAL_VAULT_KEY.length >= 16) return "env";
  if (process.env.NODE_ENV === "production") return "unconfigured";
  return "dev-ephemeral";
}

export function encrypt(plain: string): string {
  if (!plain) return "";
  const key = getMasterKey();
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALGO, key, nonce, { authTagLength: TAG_LEN });
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString("base64");
}

export function decrypt(b64: string): string {
  if (!b64) return "";
  const buf = Buffer.from(b64, "base64");
  if (buf.length < NONCE_LEN + TAG_LEN) {
    throw new Error("ciphertext too short");
  }
  const nonce = buf.subarray(0, NONCE_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(NONCE_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, getMasterKey(), nonce, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Return only the last N characters of a stored secret — for UI hints. */
export function tailHint(b64: string, n = 4): string {
  if (!b64) return "";
  try {
    const dec = decrypt(b64);
    if (!dec) return "";
    return `…${dec.slice(-n)}`;
  } catch { return ""; }
}
