#!/usr/bin/env tsx
/**
 * Seeds Build Forge's BuildRepo table with curated open-source offensive tools.
 *
 * Reads `labs/offensive-tools-manifest.yml`, then for each tool:
 *   - Resolves the repo metadata (gitUrl, defaultBranch, etc.)
 *   - Computes build targets from its `language` (reuses the same logic the
 *     Build Forge repos route uses — duplicated here intentionally to avoid
 *     importing from a Next.js route file)
 *   - Upserts by `gitUrl` (unique key used by the repos route) so re-runs are
 *     idempotent
 *
 * Usage:
 *   npm run seed:offensive-tools
 *
 * The script is SAFE TO RE-RUN. Existing non-offensive repos in the table are
 * untouched — we only upsert rows whose gitUrl matches a manifest entry.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { readFileSync } from "fs";
import path from "path";
import { load as yamlLoad } from "js-yaml";

// Same adapter setup as src/lib/prisma.ts so we hit the same SQLite DB.
const dbPath = path.join(process.cwd(), "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

interface ManifestTool {
  owner: string;
  repo: string;
  language: string;
  description: string;
  category: string;
  mitre_techniques: string[];
  risk_level: "low" | "medium" | "high";
  default_branch?: string;
  /**
   * True if the repo itself is a distribution of precompiled binaries
   * (e.g. Flangvik/SharpCollection, r3motecontrol/Ghostpack-CompiledBinaries).
   * Short-circuits the GitHub Releases probe.
   */
  prebuilt_meta_repo?: boolean;
}

interface Manifest {
  tools: ManifestTool[];
}

/**
 * Summary of a repo's prebuilt-binary availability. Written to the BuildRepo
 * row so the UI can render a badge + switch between Download/Build buttons
 * without re-hitting GitHub on every page load.
 */
interface PrebuiltInfo {
  /** Is there at least one precompiled binary ready to download? */
  available: boolean;
  /**
   * How those binaries are delivered:
   *   release-assets  → GitHub Release with real binary assets
   *   meta-repo       → repo is itself a bag of compiled binaries (zip the default branch)
   *   branch-zip      → falls back to the default-branch zip (source, not binaries — kept as last resort)
   *   none            → nothing is downloadable without building
   */
  kind: "release-assets" | "meta-repo" | "branch-zip" | "none";
  tag?: string;
  assetCount?: number;
  /** The one-click default the UI should offer as "Download prebuilt" */
  primaryAssetName?: string;
  primaryAssetUrl?: string;
  primaryAssetSize?: number;
  /** ISO timestamp — callers can refresh when stale */
  lastChecked: string;
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "detection-platform/build-forge-seed",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

// Module-level flags populated by probePrebuilt so the final summary can warn
// the user about rate-limiting instead of silently marking everything as
// "no-prebuilt".
let probeRateLimited = false;
let probeTransportErrors = 0;

async function probePrebuilt(t: ManifestTool): Promise<PrebuiltInfo> {
  const now = new Date().toISOString();

  // 1. Meta-repos: the repo itself is the binaries distribution. Surface the
  // default-branch zip as the "primary asset" so clicking Download grabs
  // everything at once.
  if (t.prebuilt_meta_repo) {
    const branch = t.default_branch || "master";
    return {
      available: true,
      kind: "meta-repo",
      primaryAssetName: `${t.repo}-${branch}.zip`,
      primaryAssetUrl: `https://github.com/${t.owner}/${t.repo}/archive/refs/heads/${branch}.zip`,
      lastChecked: now,
    };
  }

  // 2. Probe GitHub Releases
  try {
    const res = await fetch(`https://api.github.com/repos/${t.owner}/${t.repo}/releases/latest`, {
      headers: ghHeaders(),
    });
    if (res.status === 403 || res.status === 429) {
      probeRateLimited = true;
    }
    if (res.ok) {
      const rel = await res.json() as { tag_name: string; assets: Array<{ name: string; size: number; browser_download_url: string; content_type: string }> };
      const binaryAssets = (rel.assets || []).filter((a) => {
        // Exclude signatures and checksums — users want the binary itself.
        return !/\.(minisig|asc|sig|sha256|sha512|txt)$/i.test(a.name);
      });
      if (binaryAssets.length > 0) {
        // Prefer a platform-neutral asset, else pick the first by size (usually the full binary).
        const preferred = binaryAssets.find((a) => /linux.*x64|amd64/i.test(a.name) && !/signed|sig/i.test(a.name))
          || binaryAssets[0];
        return {
          available: true,
          kind: "release-assets",
          tag: rel.tag_name,
          assetCount: binaryAssets.length,
          primaryAssetName: preferred.name,
          primaryAssetUrl: preferred.browser_download_url,
          primaryAssetSize: preferred.size,
          lastChecked: now,
        };
      }
      // Release exists but no binary assets — source-only; caller can still grab the source zip.
      return {
        available: false,
        kind: "none",
        tag: rel.tag_name,
        assetCount: 0,
        lastChecked: now,
      };
    }
    // 404 / 403 / rate-limited — skip, leave "none"
  } catch {
    probeTransportErrors += 1;
  }

  return { available: false, kind: "none", lastChecked: now };
}

// Mirror of `buildDefaultTargets()` in src/app/api/build-forge/repos/route.ts.
// Keep in sync when new languages are added. Adding the "powershell" case here
// that the route gets in the same phase.
function buildDefaultTargets(language: string, name: string): any[] {
  const lang = language.toLowerCase();
  const safeName = name.replace(/\//g, "-");

  if (lang === "go") {
    return [
      { name: "linux-x64",  description: "Linux amd64 binary",                         framework: "custom", supported_environments: ["linux","docker","k8s"], supported_architectures: ["x64"],   build_command: `cd {{working_dir}} && GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o {{artifact_dir}}/${safeName}-linux-x64 .`,    artifact_patterns: [`${safeName}-linux-*`] },
      { name: "win-x64",    description: "Windows amd64 binary (cross-compiled)",      framework: "custom", supported_environments: ["windows"],               supported_architectures: ["x64"],   build_command: `cd {{working_dir}} && GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o {{artifact_dir}}/${safeName}-win-x64.exe .`, artifact_patterns: ["*.exe"] },
      { name: "macos-arm64",description: "macOS ARM64 binary (cross-compiled)",        framework: "custom", supported_environments: ["macos"],                 supported_architectures: ["arm64"], build_command: `cd {{working_dir}} && GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o {{artifact_dir}}/${safeName}-macos-arm64 .`, artifact_patterns: [`${safeName}-macos-*`] },
    ];
  }
  if (lang === "rust") {
    return [
      { name: "linux-x64", description: "Linux amd64 binary", framework: "custom", supported_environments: ["linux","docker"], supported_architectures: ["x64"], build_command: `cd {{working_dir}} && cargo build --release && cp target/release/* {{artifact_dir}}/ 2>/dev/null || true`, artifact_patterns: ["*"] },
    ];
  }
  if (lang === "c#" || lang === "csharp") {
    const scriptPath = path.resolve(process.cwd(), "..", "MCP-DetecOps", "scripts", "build-dotnet.sh");
    return [
      { name: "win-x64",   description: "Windows x64 executable (.exe) — self-contained",   framework: "custom", supported_environments: ["windows"],               supported_architectures: ["x64"],   build_command: `bash "${scriptPath}" "{{working_dir}}" "{{artifact_dir}}" win-x64 Release`,   artifact_patterns: ["*.exe"] },
      { name: "win-arm64", description: "Windows ARM64 executable (.exe) — self-contained", framework: "custom", supported_environments: ["windows"],               supported_architectures: ["arm64"], build_command: `bash "${scriptPath}" "{{working_dir}}" "{{artifact_dir}}" win-arm64 Release`, artifact_patterns: ["*.exe"] },
      { name: "linux-x64", description: "Linux x64 self-contained binary",                  framework: "custom", supported_environments: ["linux","docker","k8s"], supported_architectures: ["x64"],   build_command: `bash "${scriptPath}" "{{working_dir}}" "{{artifact_dir}}" linux-x64 Release`, artifact_patterns: ["*"] },
    ];
  }
  if (lang === "python") {
    return [
      { name: "wheel", description: "Python wheel package", framework: "custom", supported_environments: ["linux","macos","windows"], supported_architectures: ["x64","arm64"], build_command: `cd {{working_dir}} && pip wheel . -w {{artifact_dir}}/ 2>/dev/null || pip install --target={{artifact_dir}}/ . 2>/dev/null || cp -r . {{artifact_dir}}/`, artifact_patterns: ["*"] },
    ];
  }
  if (lang === "powershell") {
    // PowerShell tools don't "build" — copy scripts/modules into the artifact dir.
    return [
      { name: "windows-ps1", description: "PowerShell scripts/modules (no compile)", framework: "custom", supported_environments: ["windows"], supported_architectures: ["any"], build_command: `cd {{working_dir}} && cp -r . {{artifact_dir}}/`, artifact_patterns: ["*"] },
    ];
  }
  // Generic fallback (custom / c / unknown)
  return [
    { name: "default", description: "Default build", framework: "custom", supported_environments: ["linux"], supported_architectures: ["x64"], build_command: `cd {{working_dir}} && (make 2>/dev/null || true) && (cp -r dist/* {{artifact_dir}}/ 2>/dev/null || cp -r . {{artifact_dir}}/)`, artifact_patterns: ["*"] },
  ];
}

function inferBuildSystem(language: string): string {
  const l = language.toLowerCase();
  if (l === "go") return "go";
  if (l === "rust") return "cargo";
  if (l === "python") return "pip";
  if (l === "c#" || l === "csharp") return "msbuild";
  if (l === "powershell") return "none";
  return "make";
}

async function main() {
  const manifestPath = path.join(process.cwd(), "labs", "offensive-tools-manifest.yml");
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = yamlLoad(raw) as Manifest;
  if (!manifest?.tools?.length) {
    console.error("ERROR: offensive-tools-manifest.yml has no `tools:` entries.");
    process.exit(1);
  }

  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (const t of manifest.tools) {
    const gitUrl = `https://github.com/${t.owner}/${t.repo}.git`;
    const name = `${t.owner}/${t.repo}`;
    const defaultBranch = t.default_branch || "main";
    const targets = buildDefaultTargets(t.language, name);

    // Probe GitHub Releases (or skip for meta-repos) to populate prebuiltInfo.
    const prebuilt = await probePrebuilt(t);
    const prebuiltTag = prebuilt.kind === "meta-repo" ? "META"
                      : prebuilt.available ? prebuilt.tag?.slice(0, 12) || "RELEASE"
                      : "no-prebuilt";

    const payload = {
      name,
      owner: t.owner,
      repoName: t.repo,
      gitUrl,
      visibility: "public",
      description: t.description,
      language: t.language,
      buildSystem: inferBuildSystem(t.language),
      defaultBranch,
      allowedBranches: JSON.stringify(["main", "master", defaultBranch]),
      targets: JSON.stringify(targets),
      defaultEnvironment: t.language === "python" || t.language === "go" ? "linux" : "windows",
      defaultArch: "x64",
      framework: "custom",
      enabled: true,
      category: t.category,
      mitreTechniques: JSON.stringify(t.mitre_techniques || []),
      riskLevel: t.risk_level || "low",
      prebuiltInfo: JSON.stringify(prebuilt),
    };

    try {
      // Prisma needs a unique field for upsert. gitUrl isn't unique in the
      // schema, but `name` is — use that.
      const existing = await prisma.buildRepo.findUnique({ where: { name } });
      if (existing) {
        await prisma.buildRepo.update({ where: { name }, data: payload });
        updated += 1;
      } else {
        await prisma.buildRepo.create({ data: payload });
        inserted += 1;
      }
      console.log(`  ✓ ${name.padEnd(40)} [${t.category.padEnd(20)}] ${t.risk_level.padEnd(6)} prebuilt=${prebuiltTag}`);
    } catch (e: any) {
      failed += 1;
      console.error(`  ✗ ${name.padEnd(40)} — ${e?.message || e}`);
    }
  }

  console.log();
  console.log(`upserted ${inserted + updated} offensive tool repos (inserted: ${inserted}, updated: ${updated}${failed ? `, failed: ${failed}` : ""})`);
  if (probeRateLimited) {
    console.warn(
      "\n⚠  GitHub API rate-limited during release probing — many repos show `no-prebuilt` that actually HAVE releases.\n" +
      "   Set GITHUB_TOKEN env var (5000 req/hr authenticated) and re-run:\n" +
      "     GITHUB_TOKEN=ghp_xxx npm run seed:offensive-tools\n" +
      "   Or just wait ~1h for the 60 req/hr unauthenticated budget to reset.\n"
    );
  }
  if (probeTransportErrors > 0) {
    console.warn(`⚠  ${probeTransportErrors} network errors during release probing — those repos will show as "no-prebuilt" until re-seeded.\n`);
  }
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("seed failed:", e);
  process.exit(1);
});
