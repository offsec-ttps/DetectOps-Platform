/**
 * Module package signing + integrity.
 *
 * Reuses the platform's ed25519 key from src/lib/bas/signing.ts (signMessageB64
 * + signingPublicKeyB64). bas/signing exposes no verify, so we add one here via
 * node:crypto. The signed message is the canonical content hash, so a signature
 * binds to the EXACT bytes of a module package.
 *
 * Trust model (v1): a single platform-held key proves INTEGRITY (untampered),
 * not third-party publisher identity. Auto-approve therefore requires a verified
 * signature AND treats unsigned/third-party modules as needs-human (see worker).
 */

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { signMessageB64, signingPublicKeyB64 } from "@/lib/bas/signing";

/** Byte-stable canonical serialization of a module package (mirror canonicalBundle). */
export function canonicalModulePackage(pkg: { manifest: unknown; scenarios?: unknown }): string {
  // Stable key order; manifest first, scenarios second.
  return JSON.stringify({ manifest: pkg.manifest, scenarios: pkg.scenarios ?? null });
}

export function moduleContentHash(pkg: { manifest: unknown; scenarios?: unknown }): string {
  return createHash("sha256").update(canonicalModulePackage(pkg), "utf8").digest("hex");
}

/** Sign a module by its content hash; returns the base64 ed25519 signature. */
export function signModule(contentHash: string): string {
  return signMessageB64(contentHash);
}

/** Public verifying key (raw 32-byte ed25519, base64) — same key bas uses. */
export function moduleSigningPublicKeyB64(): string {
  return signingPublicKeyB64();
}

/**
 * Verify a module signature against its content hash, using the platform key.
 * Returns true only when the signature was produced by our key over this hash.
 */
export function verifyModuleSignature(contentHash: string, signatureB64: string): boolean {
  if (!contentHash || !signatureB64) return false;
  try {
    const raw = Buffer.from(moduleSigningPublicKeyB64(), "base64");
    // Rebuild a KeyObject from the raw 32-byte ed25519 public key via JWK.
    const pub = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") } as any,
      format: "jwk",
    });
    return edVerify(null, Buffer.from(contentHash, "utf8"), pub, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
