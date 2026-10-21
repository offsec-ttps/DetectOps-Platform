import { NextRequest, NextResponse } from "next/server";
import { resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { requireRole, requireUser } from "@/lib/auth-guard";
import { isSafeBranch, isSafeSegment, isSafeGitUrl } from "@/lib/build-forge/validate";

/**
 * GET    /api/build-forge/repos — list all registered build repos
 * POST   /api/build-forge/repos — add a GitHub repo to the build list
 * DELETE /api/build-forge/repos?id=<id> — remove a repo and its builds
 * PATCH  /api/build-forge/repos?id=<id>&regenerate=true — regenerate targets
 */

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const framework = req.nextUrl.searchParams.get("framework");
  const language = req.nextUrl.searchParams.get("language");
  const enabled = req.nextUrl.searchParams.get("enabled");

  const where: any = {};
  if (framework) where.framework = framework;
  if (language) where.language = language;
  if (enabled !== null && enabled !== undefined) where.enabled = enabled === "true";

  const repos = await prisma.buildRepo.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { builds: { orderBy: { startedAt: "desc" }, take: 3 } },
  });

  const parsed = repos.map((r) => ({
    ...r,
    allowedBranches: JSON.parse(r.allowedBranches),
    targets: JSON.parse(r.targets),
    // Additive: expose the seeded prebuilt snapshot to the UI so it can show
    // a "Prebuilt available" badge and switch the primary action.
    prebuiltInfo: (() => {
      try { return r.prebuiltInfo ? JSON.parse(r.prebuiltInfo) : null; }
      catch { return null; }
    })(),
  }));

  return NextResponse.json({ repos: parsed, total: parsed.length });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { owner, repoName, gitUrl, description, language, defaultBranch, visibility, avatarUrl, stars } = body;

  if (!owner || !repoName) {
    return NextResponse.json({ error: "owner and repoName are required" }, { status: 400 });
  }
  // owner/repoName become filesystem path segments and build-command text; branch and
  // url reach git — restrict them to safe forms.
  if (!isSafeSegment(owner) || !isSafeSegment(repoName)) return NextResponse.json({ error: "owner/repoName may contain only letters, digits, . _ -" }, { status: 400 });
  if (defaultBranch && !isSafeBranch(defaultBranch)) return NextResponse.json({ error: "invalid defaultBranch" }, { status: 400 });
  const effectiveUrl = gitUrl || `https://github.com/${owner}/${repoName}.git`;
  if (!isSafeGitUrl(effectiveUrl)) return NextResponse.json({ error: "gitUrl must be an https URL of the form https://host/owner/repo(.git)" }, { status: 400 });

  const name = `${owner}/${repoName}`;

  // Default targets based on language
  const targets = buildDefaultTargets(language || "", name);

  const existing = await prisma.buildRepo.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json({ error: "Repository already added", repo: { ...existing, targets: JSON.parse(existing.targets), allowedBranches: JSON.parse(existing.allowedBranches) } }, { status: 409 });
  }

  const repo = await prisma.buildRepo.create({
    data: {
      name,
      owner: owner || "",
      repoName: repoName || "",
      gitUrl: effectiveUrl,
      description: description || "",
      language: (language || "").toLowerCase(),
      buildSystem: inferBuildSystem(language || ""),
      defaultBranch: defaultBranch || "main",
      allowedBranches: JSON.stringify([defaultBranch || "main"]),
      visibility: visibility || "public",
      framework: "custom",
      avatarUrl: avatarUrl || "",
      stars: Number.isFinite(Number(stars)) ? Number(stars) : 0,
      targets: JSON.stringify(targets),
    },
  });

  return NextResponse.json({
    ...repo,
    targets: JSON.parse(repo.targets),
    allowedBranches: JSON.parse(repo.allowedBranches),
  }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Delete builds first, then repo
  await prisma.buildRecord.deleteMany({ where: { repoId: id } });
  await prisma.buildRepo.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ deleted: true });
}

export async function PATCH(req: NextRequest) {
  // targets carry build commands that run on this host — admin only.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const id = req.nextUrl.searchParams.get("id");
  const regenerate = req.nextUrl.searchParams.get("regenerate") === "true";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const repo = await prisma.buildRepo.findUnique({ where: { id } });
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  if (regenerate) {
    const targets = buildDefaultTargets(repo.language, repo.name);
    const updated = await prisma.buildRepo.update({
      where: { id },
      data: {
        targets: JSON.stringify(targets),
        buildSystem: inferBuildSystem(repo.language),
      },
    });
    return NextResponse.json({
      ...updated,
      targets: JSON.parse(updated.targets),
      allowedBranches: JSON.parse(updated.allowedBranches),
    });
  }

  // Generic patch from body
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  if (body.targets) {
    if (!Array.isArray(body.targets) || body.targets.some((t: any) => typeof t?.name !== "string" || typeof t?.build_command !== "string")) {
      return NextResponse.json({ error: "targets must be an array of {name, build_command, …}" }, { status: 400 });
    }
    data.targets = JSON.stringify(body.targets);
  }
  if (body.defaultBranch) {
    if (!isSafeBranch(body.defaultBranch)) return NextResponse.json({ error: "invalid defaultBranch" }, { status: 400 });
    data.defaultBranch = body.defaultBranch;
  }
  if (body.framework) data.framework = body.framework;

  const updated = await prisma.buildRepo.update({ where: { id }, data });
  return NextResponse.json({
    ...updated,
    targets: JSON.parse(updated.targets),
    allowedBranches: JSON.parse(updated.allowedBranches),
  });
}

function inferBuildSystem(language: string): string {
  const map: Record<string, string> = {
    go: "go", rust: "cargo", python: "pip", c: "make", "c++": "cmake",
    cpp: "cmake", typescript: "npm", javascript: "npm", java: "maven",
    "c#": "dotnet", csharp: "dotnet",
  };
  return map[language.toLowerCase()] || "make";
}

function buildDefaultTargets(language: string, name: string): any[] {
  const lang = language.toLowerCase();
  const safeName = name.replace(/\//g, "-");

  if (lang === "go") {
    return [
      {
        name: "linux-x64",
        description: `Linux amd64 binary`,
        framework: "custom",
        supported_environments: ["linux", "docker", "k8s"],
        supported_architectures: ["x64"],
        build_command: `cd {{working_dir}} && GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o {{artifact_dir}}/${safeName}-linux-x64 .`,
        artifact_patterns: [`${safeName}-linux-*`],
      },
      {
        name: "win-x64",
        description: `Windows amd64 binary (cross-compiled)`,
        framework: "custom",
        supported_environments: ["windows"],
        supported_architectures: ["x64"],
        build_command: `cd {{working_dir}} && GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o {{artifact_dir}}/${safeName}-win-x64.exe .`,
        artifact_patterns: ["*.exe"],
      },
      {
        name: "macos-arm64",
        description: `macOS ARM64 binary (cross-compiled)`,
        framework: "custom",
        supported_environments: ["macos"],
        supported_architectures: ["arm64"],
        build_command: `cd {{working_dir}} && GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o {{artifact_dir}}/${safeName}-macos-arm64 .`,
        artifact_patterns: [`${safeName}-macos-*`],
      },
    ];
  }

  if (lang === "rust") {
    return [
      {
        name: "linux-x64",
        description: `Linux amd64 binary`,
        framework: "custom",
        supported_environments: ["linux", "docker"],
        supported_architectures: ["x64"],
        build_command: `cd {{working_dir}} && cargo build --release && cp target/release/* {{artifact_dir}}/ 2>/dev/null || true`,
        artifact_patterns: ["*"],
      },
    ];
  }

  if (lang === "c#" || lang === "csharp") {
    // .NET / .NET Framework — uses build-dotnet.sh adapter for cross-compilation
    const scriptPath = resolve(process.cwd(), "..", "MCP-DetecOps", "scripts", "build-dotnet.sh");
    return [
      {
        name: "win-x64",
        description: `Windows x64 executable (.exe) — self-contained`,
        framework: "custom",
        supported_environments: ["windows"],
        supported_architectures: ["x64"],
        build_command: `bash "${scriptPath}" "{{working_dir}}" "{{artifact_dir}}" win-x64 Release`,
        artifact_patterns: ["*.exe"],
      },
      {
        name: "win-arm64",
        description: `Windows ARM64 executable (.exe) — self-contained`,
        framework: "custom",
        supported_environments: ["windows"],
        supported_architectures: ["arm64"],
        build_command: `bash "${scriptPath}" "{{working_dir}}" "{{artifact_dir}}" win-arm64 Release`,
        artifact_patterns: ["*.exe"],
      },
      {
        name: "linux-x64",
        description: `Linux x64 self-contained binary`,
        framework: "custom",
        supported_environments: ["linux", "docker", "k8s"],
        supported_architectures: ["x64"],
        build_command: `bash "${scriptPath}" "{{working_dir}}" "{{artifact_dir}}" linux-x64 Release`,
        artifact_patterns: ["*"],
      },
    ];
  }

  if (lang === "python") {
    return [
      {
        name: "wheel",
        description: `Python wheel package`,
        framework: "custom",
        supported_environments: ["linux", "macos", "windows"],
        supported_architectures: ["x64", "arm64"],
        build_command: `cd {{working_dir}} && pip wheel . -w {{artifact_dir}}/`,
        artifact_patterns: ["*.whl"],
      },
    ];
  }

  if (lang === "powershell") {
    // PowerShell tools don't "build" — copy scripts/modules into the artifact dir.
    // Keeps Invoke-Obfuscation, PowerSploit, ADRecon, etc. queryable and "buildable"
    // from Build Forge without a compiler toolchain.
    return [
      {
        name: "windows-ps1",
        description: `PowerShell scripts/modules (no compile — raw copy)`,
        framework: "custom",
        supported_environments: ["windows"],
        supported_architectures: ["any"],
        build_command: `cd {{working_dir}} && cp -r . {{artifact_dir}}/`,
        artifact_patterns: ["*"],
      },
    ];
  }

  // Generic fallback
  return [
    {
      name: "default",
      description: `Default build`,
      framework: "custom",
      supported_environments: ["linux"],
      supported_architectures: ["x64"],
      build_command: `cd {{working_dir}} && make && cp -r dist/* {{artifact_dir}}/ 2>/dev/null || true`,
      artifact_patterns: ["*"],
    },
  ];
}
