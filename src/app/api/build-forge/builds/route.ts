import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

const BUILD_BASE = resolve(process.cwd(), "..", "MCP-DetecOps", "tmp");
const BUILD_CACHE = join(BUILD_BASE, "build-cache");
const ARTIFACTS_DIR = join(BUILD_BASE, "artifacts");

/**
 * GET  /api/build-forge/builds?repoId=...&status=...
 * POST /api/build-forge/builds — trigger a new build
 */

export async function GET(req: NextRequest) {
  const repoId = req.nextUrl.searchParams.get("repoId");
  const status = req.nextUrl.searchParams.get("status");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 50), 100);

  const where: any = {};
  if (repoId) where.repoId = repoId;
  if (status) where.status = status;

  const builds = await prisma.buildRecord.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { repo: { select: { name: true, owner: true, repoName: true, language: true } } },
  });

  return NextResponse.json({ builds, total: builds.length });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { repoId, target, branch, environment, architecture, buildProfile } = body;

  if (!repoId || !target) {
    return NextResponse.json({ error: "repoId and target are required" }, { status: 400 });
  }

  const repo = await prisma.buildRepo.findUnique({ where: { id: repoId } });
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const targets: any[] = JSON.parse(repo.targets);
  const targetDef = targets.find((t: any) => t.name === target);
  if (!targetDef) {
    return NextResponse.json({
      error: `Target "${target}" not found`,
      available: targets.map((t: any) => t.name),
    }, { status: 400 });
  }

  const effectiveBranch = branch || repo.defaultBranch;
  const effectiveEnv = environment || repo.defaultEnvironment || "linux";
  const effectiveArch = architecture || repo.defaultArch || "x64";
  const effectiveProfile = buildProfile || "release";

  // Create build record
  const buildId = randomUUID();
  const artifactDir = join(ARTIFACTS_DIR, buildId);
  mkdirSync(artifactDir, { recursive: true });

  const record = await prisma.buildRecord.create({
    data: {
      id: buildId,
      repoId: repo.id,
      target,
      branch: effectiveBranch,
      environment: effectiveEnv,
      architecture: effectiveArch,
      framework: targetDef.framework || repo.framework,
      buildProfile: effectiveProfile,
      status: "running",
      startedAt: new Date(),
    },
  });

  // Run build async — don't block the response
  runBuildAsync(record.id, repo, targetDef, effectiveBranch, artifactDir, effectiveArch, effectiveEnv, effectiveProfile);

  return NextResponse.json({
    build_id: record.id,
    status: "running",
    message: `Build started for ${repo.name} target=${target} branch=${effectiveBranch}`,
  }, { status: 202 });
}

async function runBuildAsync(
  buildId: string,
  repo: any,
  targetDef: any,
  branch: string,
  artifactDir: string,
  arch: string,
  environment: string,
  buildProfile: string
) {
  const startTime = Date.now();

  try {
    // Step 1: Clone or fetch repo
    const repoDir = join(BUILD_CACHE, repo.owner, repo.repoName);
    mkdirSync(join(BUILD_CACHE, repo.owner), { recursive: true });

    if (existsSync(join(repoDir, ".git"))) {
      await exec(`git -C "${repoDir}" fetch origin ${branch} && git -C "${repoDir}" checkout ${branch} && git -C "${repoDir}" reset --hard origin/${branch}`);
    } else {
      await exec(`git clone --depth 1 --branch ${branch} ${repo.gitUrl} "${repoDir}"`);
    }

    // Get commit SHA
    const commitSha = (await exec(`git -C "${repoDir}" rev-parse HEAD`)).trim();

    // Step 2: Create isolated workspace
    const workDir = join(BUILD_CACHE, "_workspaces", buildId);
    mkdirSync(workDir, { recursive: true });
    await exec(`cp -r "${repoDir}/." "${workDir}/"`);

    // Step 3: Resolve and run build command
    let command = targetDef.build_command as string;
    command = command.replace(/\{\{working_dir\}\}/g, workDir);
    command = command.replace(/\{\{artifact_dir\}\}/g, artifactDir);
    command = command.replace(/\{\{branch\}\}/g, branch);
    command = command.replace(/\{\{arch\}\}/g, arch === "x64" ? "amd64" : arch);
    command = command.replace(/\{\{environment\}\}/g, environment);
    command = command.replace(/\{\{build_profile\}\}/g, buildProfile);
    command = command.replace(/\{\{framework\}\}/g, targetDef.framework || "custom");
    command = command.replace(/\{\{framework_backend\}\}/g, targetDef.framework || "custom");

    const output = await exec(command, workDir, 300_000);

    // Step 4: Discover artifacts
    const files = existsSync(artifactDir)
      ? readdirSync(artifactDir).filter((f) => statSync(join(artifactDir, f)).isFile())
      : [];

    const firstArtifact = files[0] || "";
    const artifactPath = firstArtifact ? join(artifactDir, firstArtifact) : "";
    const artifactSize = artifactPath && existsSync(artifactPath) ? statSync(artifactPath).size : 0;
    const artifactHash = artifactPath && existsSync(artifactPath)
      ? createHash("sha256").update(readFileSync(artifactPath)).digest("hex")
      : "";

    const durationMs = Date.now() - startTime;

    await prisma.buildRecord.update({
      where: { id: buildId },
      data: {
        status: "success",
        commitSha,
        artifactPath,
        artifactName: firstArtifact,
        artifactSize,
        artifactHash,
        durationMs,
        logSnippet: output.substring(0, 2000),
        completedAt: new Date(),
      },
    });
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    await prisma.buildRecord.update({
      where: { id: buildId },
      data: {
        status: "failed",
        errorSummary: (err.message || "Unknown error").substring(0, 1000),
        logSnippet: (err.stderr || err.message || "").substring(0, 2000),
        durationMs,
        completedAt: new Date(),
      },
    });
  }
}

function exec(command: string, cwd?: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("bash", ["-c", command], {
      cwd: cwd || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Ensure dotnet, go, cargo etc. are on PATH
        PATH: `${homedir()}/.dotnet:${process.env.PATH}`,
        DOTNET_ROOT: `${homedir()}/.dotnet`,
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      },
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(Object.assign(new Error("Build timed out"), { stderr }));
    }, timeoutMs);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(Object.assign(new Error(`Exit code ${code}: ${stderr.slice(-500)}`), { stderr }));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
