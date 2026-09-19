/**
 * ed25519 job signing for the native BAS fleet (M5).
 *
 * Every job handed to an agent is signed by the control plane over a canonical
 * message binding operation_id + node_id + bundle_hash + scope + consent + an
 * expiry. The agent verifies the signature with the CP's public key (received
 * at enrollment) before executing — so a forged, replayed, tampered, or
 * cross-node job is rejected even if the transport is compromised. This is
 * per-command integrity, beyond channel TLS.
 *
 * Key persistence: BAS_SIGNING_KEY (base64 of a PKCS8 PEM) if set, else a
 * generated key persisted to .bas-signing-key.pem (gitignored) so it's stable
 * across dev restarts — agents enrolled earlier keep verifying.
 */

import { generateKeyPairSync, createPrivateKey, createPublicKey, sign as edSign, type KeyObject } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

let cached: { priv: KeyObject; pubRawB64: string } | null = null;

function keyFilePath(): string {
  return process.env.BAS_SIGNING_KEY_FILE || path.join(process.cwd(), ".bas-signing-key.pem");
}

function load(): { priv: KeyObject; pubRawB64: string } {
  if (cached) return cached;
  let pem: string;
  if (process.env.BAS_SIGNING_KEY) {
    pem = Buffer.from(process.env.BAS_SIGNING_KEY, "base64").toString("utf8");
  } else if (existsSync(keyFilePath())) {
    pem = readFileSync(keyFilePath(), "utf8");
  } else {
    const { privateKey } = generateKeyPairSync("ed25519");
    pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    try { writeFileSync(keyFilePath(), pem, { mode: 0o600 }); } catch { /* read-only fs — stays in-memory for this process */ }
  }
  const priv = createPrivateKey(pem);
  const pub = createPublicKey(priv);
  // jwk.x is the raw 32-byte ed25519 public key (base64url) — what the agent's
  // ed25519-dalek VerifyingKey expects.
  const jwk = pub.export({ format: "jwk" }) as { x: string };
  const pubRawB64 = Buffer.from(jwk.x, "base64url").toString("base64");
  cached = { priv, pubRawB64 };
  return cached;
}

/** Raw 32-byte ed25519 public key, base64. Handed to agents at enrollment. */
export function signingPublicKeyB64(): string {
  return load().pubRawB64;
}

/** Sign a UTF-8 message; returns the raw 64-byte ed25519 signature, base64. */
export function signMessageB64(message: string): string {
  const { priv } = load();
  return edSign(null, Buffer.from(message, "utf8"), priv).toString("base64");
}

/**
 * Canonical signed-job message. The agent reconstructs this EXACT string from
 * the job fields (using its OWN node_id) and verifies the signature against it,
 * so a job signed for node A can't be replayed to node B.
 */
export function jobSigningMessage(p: {
  operationId: string;
  nodeId: string;
  technique: string;
  testIndex: number | string;
  bundleHash: string;
  scope: string;
  consentRef: string;
  notAfter: number;     // unix seconds
}): string {
  return [
    p.operationId, p.nodeId, p.technique, String(p.testIndex),
    p.bundleHash, p.scope, p.consentRef, String(p.notAfter),
  ].join("\n");
}
