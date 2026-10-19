/**
 * Credential helpers for OS-image cloud/VPS deploys.
 *
 * Reuses the platform vault (CloudCredential + AES-GCM credential-vault): cloud
 * API keys and VPS SSH keys are stored encrypted and decrypted here only into a
 * subprocess env (cloud) or a 0600 temp keyfile (ssh) — never logged, never
 * written into Terraform files or state. Mirrors src/lib/stratus/runner.ts.
 */

import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/credential-vault";

/** Decrypt a CloudCredential into provider env vars for Terraform/CLI subprocesses. */
export async function cloudCredentialEnv(credentialId: string, ownerId?: string): Promise<Record<string, string>> {
  if (!ownerId) throw new Error("owner required for credential access");
  const cred = await prisma.cloudCredential.findFirst({ where: { id: credentialId, ownerId } });
  if (!cred) throw new Error("cloud credential not found or not owned by caller");
  await prisma.cloudCredential.update({ where: { id: cred.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  const cfg = (() => { try { return JSON.parse(cred.configJson || "{}"); } catch { return {}; } })();
  const env: Record<string, string> = {};
  switch (cred.provider) {
    case "aws":
      if (cred.accessKeyId) env.AWS_ACCESS_KEY_ID = decrypt(cred.accessKeyId);
      if (cred.secretKey) env.AWS_SECRET_ACCESS_KEY = decrypt(cred.secretKey);
      if (cred.sessionToken) env.AWS_SESSION_TOKEN = decrypt(cred.sessionToken);
      if (cfg.region) env.AWS_REGION = String(cfg.region);
      break;
    case "azure":
      if (cred.accessKeyId) env.ARM_CLIENT_ID = decrypt(cred.accessKeyId);
      if (cred.secretKey) env.ARM_CLIENT_SECRET = decrypt(cred.secretKey);
      if (cfg.tenantId) env.ARM_TENANT_ID = String(cfg.tenantId);
      if (cfg.subscription) env.ARM_SUBSCRIPTION_ID = String(cfg.subscription);
      break;
    case "gcp":
      if (cfg.projectId) env.GOOGLE_PROJECT = String(cfg.projectId);
      // GOOGLE_APPLICATION_CREDENTIALS (a file) is expected in the server env for GCP.
      break;
  }
  return env;
}

/** Look up the default SSH user hint saved alongside a VPS SSH-key credential. */
export async function vpsCredentialMeta(credentialId: string, ownerId?: string): Promise<{ defaultUser?: string }> {
  if (!ownerId) throw new Error("owner required for credential access");
  const cred = await prisma.cloudCredential.findFirst({ where: { id: credentialId, ownerId } });
  if (!cred) throw new Error("ssh credential not found or not owned by caller");
  try { const cfg = JSON.parse(cred.configJson || "{}"); return { defaultUser: cfg.defaultUser }; } catch { return {}; }
}

/**
 * Materialise a vaulted SSH private key (CloudCredential provider:"ssh",
 * secretKey=encrypted PEM) to a 0600 temp file. Caller MUST call the returned
 * cleanup() when done. Returns the key path.
 */
export async function materializeSshKey(credentialId: string, ownerId?: string): Promise<{ keyPath: string; cleanup: () => Promise<void> }> {
  if (!ownerId) throw new Error("owner required for credential access");
  const cred = await prisma.cloudCredential.findFirst({ where: { id: credentialId, ownerId } });
  if (!cred) throw new Error("ssh credential not found or not owned by caller");
  const pem = decrypt(cred.secretKey || "");
  if (!pem) throw new Error("ssh credential has no key material");
  const dir = path.join(tmpdir(), `hbl-ssh-${randomBytes(6).toString("hex")}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dir, "id_key");
  await writeFile(keyPath, pem.endsWith("\n") ? pem : pem + "\n", { mode: 0o600 });
  return { keyPath, cleanup: async () => { await rm(dir, { recursive: true, force: true }).catch(() => {}); } };
}
