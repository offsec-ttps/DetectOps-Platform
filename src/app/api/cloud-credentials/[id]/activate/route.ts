/**
 * POST /api/cloud-credentials/[id]/activate
 *
 * Bridges a stored (encrypted) cloud credential to the SAR Cloud Controller.
 * The controller shells out to the AWS CLI / terraform, which read `~/.aws`
 * — NOT the platform vault — so adding a credential in the UI alone never
 * reaches a cloud build. This materializes the selected AWS credential into
 * `~/.aws/{credentials,config}` (mode 600) and validates it with STS, so the
 * next Cloud Lab build uses the creds the user actually added.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/credential-vault";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import os from "os";
import { logEvent } from "@/lib/event-log";

const exec = promisify(execFile);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const cred = await prisma.cloudCredential.findUnique({ where: { id } });
  if (!cred) return NextResponse.json({ error: "credential not found" }, { status: 404 });
  const owns = ownsOr404(auth, cred.ownerId);
  if (!owns.ok) return owns.response;

  if (cred.provider !== "aws") {
    return NextResponse.json({ error: `Activation currently supports AWS only (this is '${cred.provider}'). The controller reads ~/.aws.` }, { status: 400 });
  }

  const accessKeyId = decrypt(cred.accessKeyId);
  const secretKey = decrypt(cred.secretKey);
  const sessionToken = cred.sessionToken ? decrypt(cred.sessionToken) : "";
  // Region: the credential's own configJson wins; else keep whatever region the
  // host's ~/.aws is already set to (don't silently move the user's deploy region);
  // else a sane default.
  let region = "";
  try { region = JSON.parse(cred.configJson || "{}").region || ""; } catch { /* ignore */ }
  if (!region) { try { const { stdout } = await exec("aws", ["configure", "get", "region"], { timeout: 5000 }); region = stdout.trim(); } catch { /* none set */ } }
  if (!region) region = "us-east-1";
  if (!accessKeyId || !secretKey) {
    return NextResponse.json({ error: "credential is missing an access key or secret" }, { status: 400 });
  }

  // Write ~/.aws/credentials + config (default profile), 0600.
  const awsDir = path.join(os.homedir(), ".aws");
  await mkdir(awsDir, { recursive: true });
  const credFile =
    `[default]\naws_access_key_id = ${accessKeyId}\naws_secret_access_key = ${secretKey}\n` +
    (sessionToken ? `aws_session_token = ${sessionToken}\n` : "");
  await writeFile(path.join(awsDir, "credentials"), credFile, { mode: 0o600 });
  await writeFile(path.join(awsDir, "config"), `[default]\nregion = ${region}\noutput = json\n`, { mode: 0o600 });

  // Validate against STS so the user gets an immediate, honest verdict.
  let valid = false; let identity = ""; let account = ""; let stsError = "";
  try {
    const { stdout } = await exec("aws", ["sts", "get-caller-identity", "--output", "json"],
      { timeout: 15000, env: { ...process.env, AWS_PROFILE: "default", AWS_DEFAULT_REGION: region } });
    const j = JSON.parse(stdout); identity = j.Arn || ""; account = j.Account || ""; valid = true;
  } catch (e: any) {
    stsError = String(e?.stderr || e?.message || "").split("\n").filter(Boolean).pop() || "STS validation failed";
  }

  await prisma.cloudCredential.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  void logEvent({
    category: "integration", action: "cloud-credential.activate",
    actor: auth.user.email, status: valid ? "ok" : "error",
    targetType: "cloud-credential", targetId: id,
    message: valid ? `AWS ~/.aws set → ${identity}` : `AWS creds rejected: ${stsError}`,
    details: { provider: "aws", region, account }, errorMessage: valid ? null : stsError,
  });

  if (!valid) {
    return NextResponse.json({
      ok: false, provider: "aws", region,
      error: `AWS rejected these credentials — ${stsError}. Fix the key/secret (or add a session token for temporary creds), then activate again.`,
    }, { status: 400 });
  }
  return NextResponse.json({ ok: true, provider: "aws", region, identity, account });
}
