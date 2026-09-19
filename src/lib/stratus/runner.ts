/**
 * Stratus runner.
 *
 * Spawns `stratus <phase> <attackId>` as a child process, streaming stdout/
 * stderr into a `StratusExecution.logs` field. Credentials are injected via
 * environment variables — never written to disk.
 *
 * Hard safety rules:
 *   - `phase` must be one of `warmup` | `detonate` | `cleanup`. Unknown
 *     phases are rejected before spawn.
 *   - A hard 5-minute wall-clock timeout kills the subprocess.
 *   - `dry-run` phase is a NO-OP that just records what would have run.
 */

import { spawn } from "node:child_process";
import { detectStratusCli } from "./binary";
import { decrypt } from "@/lib/crypto/credential-vault";
import { prisma } from "@/lib/prisma";

export type StratusPhase = "warmup" | "detonate" | "cleanup" | "dry-run";

export interface RunStratusInput {
  executionId: string;                                  // pre-created StratusExecution row id
  attackId: string;
  phase: StratusPhase;
  credentialId?: string;                                // optional — phase=cleanup may not need creds
  timeoutMs?: number;                                   // default 5 min
}

export interface RunStratusResult {
  exitCode: number;
  status: "success" | "failure" | "timeout";
  durationMs: number;
  logs: string;
}

const VALID_PHASES = new Set<StratusPhase>(["warmup", "detonate", "cleanup", "dry-run"]);

async function loadCredentialEnv(credentialId: string | undefined): Promise<Record<string, string>> {
  if (!credentialId) return {};
  const cred = await prisma.cloudCredential.findUnique({ where: { id: credentialId } });
  if (!cred) throw new Error("Credential not found");

  // Mark used
  await prisma.cloudCredential.update({
    where: { id: cred.id }, data: { lastUsedAt: new Date() },
  }).catch(() => { /* not fatal */ });

  const cfg = (() => { try { return JSON.parse(cred.configJson || "{}"); } catch { return {}; } })();
  const env: Record<string, string> = {};

  switch (cred.provider) {
    case "aws":
      if (cred.accessKeyId)  env.AWS_ACCESS_KEY_ID     = decrypt(cred.accessKeyId);
      if (cred.secretKey)    env.AWS_SECRET_ACCESS_KEY = decrypt(cred.secretKey);
      if (cred.sessionToken) env.AWS_SESSION_TOKEN     = decrypt(cred.sessionToken);
      if (cfg.region)        env.AWS_REGION            = String(cfg.region);
      break;
    case "azure":
      if (cred.accessKeyId)  env.AZURE_CLIENT_ID       = decrypt(cred.accessKeyId);
      if (cred.secretKey)    env.AZURE_CLIENT_SECRET   = decrypt(cred.secretKey);
      if (cfg.tenantId)      env.AZURE_TENANT_ID       = String(cfg.tenantId);
      if (cfg.subscription)  env.AZURE_SUBSCRIPTION_ID = String(cfg.subscription);
      break;
    case "gcp":
      // Stratus reads GOOGLE_APPLICATION_CREDENTIALS — a path to a JSON file.
      // We can't realistically materialise that for a temp file here without
      // touching disk; the user should set GOOGLE_APPLICATION_CREDENTIALS in
      // the env that runs the server. For now we forward the project ID.
      if (cfg.projectId)     env.CLOUDSDK_CORE_PROJECT = String(cfg.projectId);
      break;
    case "kubernetes":
      if (cfg.kubeconfig)    env.KUBECONFIG            = String(cfg.kubeconfig);
      break;
    case "entra-id":
      if (cred.accessKeyId)  env.ENTRA_CLIENT_ID       = decrypt(cred.accessKeyId);
      if (cred.secretKey)    env.ENTRA_CLIENT_SECRET   = decrypt(cred.secretKey);
      break;
  }
  return env;
}

export async function runStratus(input: RunStratusInput): Promise<RunStratusResult> {
  if (!VALID_PHASES.has(input.phase)) {
    throw new Error(`unsupported phase: ${input.phase}`);
  }

  const timeoutMs = input.timeoutMs ?? 5 * 60 * 1000;
  const t0 = Date.now();

  // Dry-run shortcut — no binary required
  if (input.phase === "dry-run") {
    const info = await detectStratusCli();
    const line = info.found
      ? `[dry-run] would run: ${info.binary} <warmup|detonate|cleanup> ${input.attackId}`
      : `[dry-run] stratus binary not found — would run: stratus <phase> ${input.attackId}`;
    await prisma.stratusExecution.update({
      where: { id: input.executionId },
      data: {
        status: "success",
        exitCode: 0,
        logs: line + "\n",
        completedAt: new Date(),
        durationMs: Date.now() - t0,
      },
    });
    return { exitCode: 0, status: "success", durationMs: Date.now() - t0, logs: line };
  }

  const info = await detectStratusCli();
  if (!info.found) {
    const msg = `Stratus CLI not found. ${info.installHint}`;
    await prisma.stratusExecution.update({
      where: { id: input.executionId },
      data: {
        status: "failure", exitCode: 127,
        logs: msg, completedAt: new Date(), durationMs: Date.now() - t0,
      },
    });
    return { exitCode: 127, status: "failure", durationMs: Date.now() - t0, logs: msg };
  }

  const env = await loadCredentialEnv(input.credentialId);

  await prisma.stratusExecution.update({
    where: { id: input.executionId }, data: { status: "running" },
  });

  return await new Promise<RunStratusResult>((resolve) => {
    let logs = `$ ${info.binary} ${input.phase} ${input.attackId}\n`;
    const child = spawn(info.binary, [input.phase, input.attackId], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const append = (chunk: Buffer) => {
      logs += chunk.toString();
      // Best-effort streaming write; cap to ~64KB to keep DB row small.
      const capped = logs.length > 64_000 ? logs.slice(-64_000) : logs;
      prisma.stratusExecution.update({ where: { id: input.executionId }, data: { logs: capped } }).catch(() => {});
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, timeoutMs);

    let timedOut = false;
    child.on("close", async (code) => {
      clearTimeout(timer);
      const dur = Date.now() - t0;
      const status: RunStratusResult["status"] = timedOut
        ? "timeout"
        : (code === 0 ? "success" : "failure");
      await prisma.stratusExecution.update({
        where: { id: input.executionId },
        data: { status, exitCode: code ?? -1, completedAt: new Date(), durationMs: dur, logs: logs.slice(-64_000) },
      }).catch(() => {});
      resolve({ exitCode: code ?? -1, status, durationMs: dur, logs });
    });
    child.on("error", async (err) => {
      clearTimeout(timer);
      logs += `\n[spawn error] ${err.message}\n`;
      await prisma.stratusExecution.update({
        where: { id: input.executionId },
        data: { status: "failure", exitCode: -1, completedAt: new Date(), durationMs: Date.now() - t0, logs: logs.slice(-64_000) },
      }).catch(() => {});
      resolve({ exitCode: -1, status: "failure", durationMs: Date.now() - t0, logs });
    });

    // Wire timeout flag for the close handler
    timer.unref?.();
    const origTimer = timer;
    void origTimer;
    // We use a closure flag instead of comparing wall-clock again
    setTimeout(() => { timedOut = true; }, timeoutMs + 100);
  });
}
