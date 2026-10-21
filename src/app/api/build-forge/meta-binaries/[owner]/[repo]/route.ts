/**
 * GET /api/build-forge/meta-binaries/[owner]/[repo]?branch=<branch>
 *
 * Lists every individual precompiled binary file inside a "meta-binaries" repo
 * (e.g. Flangvik/SharpCollection, r3motecontrol/Ghostpack-CompiledBinaries) so
 * the UI can show a per-file picker instead of "download whole zip".
 *
 * Uses GitHub's Trees API (recursive) then filters the tree down to
 * interesting binary/script extensions. Returns each file's raw download URL
 * (raw.githubusercontent.com) so the existing /releases/download endpoint
 * can fetch a single file.
 *
 * Caches upstream for 10 min — the tree rarely changes per hour.
 */

import { NextRequest, NextResponse } from "next/server";
import { isSafeBranch } from "@/lib/build-forge/validate";

// Extensions that users actually want to grab. Keep this curated so we don't
// flood the UI with source files, READMEs, signature files, etc.
const INTERESTING_EXT = new Set([
  "exe", "dll",
  "ps1", "psm1", "psd1",
  "py",
  "zip", "7z", "tar", "gz",
  "sh", "bat",
  "jar",
]);

// Noise we always exclude regardless of extension
const EXCLUDE_PATTERNS = [
  /\.minisig$/i, /\.asc$/i, /\.sig$/i, /\.sha256$/i, /\.sha512$/i,
  /README/i, /LICENSE/i, /\.md$/i,
  /\.git/i, /node_modules/,
];

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "detection-platform/build-forge-meta",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

interface GhTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url: string;
}

interface GhTreeResponse {
  sha: string;
  tree: GhTreeEntry[];
  truncated: boolean;
  message?: string;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await ctx.params;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    return NextResponse.json({ error: "invalid owner/repo" }, { status: 400 });
  }
  const branch = req.nextUrl.searchParams.get("branch") || "";
  if (branch && !isSafeBranch(branch)) {
    return NextResponse.json({ error: "invalid branch" }, { status: 400 });
  }

  // Resolve default branch if not provided
  let effectiveBranch = branch;
  if (!effectiveBranch) {
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: ghHeaders(),
        next: { revalidate: 3600 },
      });
      if (r.ok) {
        const j = await r.json();
        effectiveBranch = j.default_branch || "main";
      } else {
        effectiveBranch = "main";
      }
    } catch { effectiveBranch = "main"; }
  }

  // Fetch recursive tree
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${effectiveBranch}?recursive=1`;
  let tr: GhTreeResponse;
  try {
    const res = await fetch(treeUrl, { headers: ghHeaders(), next: { revalidate: 600 } });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({
        error: `GitHub Trees API returned HTTP ${res.status}`,
        hint: res.status === 403
          ? "GitHub rate limit likely hit. Set GITHUB_TOKEN env var (5000 req/hr) to authenticate."
          : "Repo may be private, archived, or branch name is wrong.",
        upstream: body.slice(0, 300),
      }, { status: 502 });
    }
    tr = await res.json();
  } catch (e: any) {
    return NextResponse.json({ error: `fetch failed: ${e?.message || e}` }, { status: 502 });
  }

  if (tr.truncated) {
    // Very large repos (>100k entries) may be truncated. We still return what we got plus a flag.
  }

  const files = (tr.tree || [])
    .filter((t) => t.type === "blob")
    .filter((t) => !EXCLUDE_PATTERNS.some((p) => p.test(t.path)))
    .filter((t) => {
      const ext = t.path.split(".").pop()?.toLowerCase() || "";
      return INTERESTING_EXT.has(ext);
    })
    .map((t) => {
      const segments = t.path.split("/");
      const name = segments.pop() || t.path;
      const subdir = segments.join("/") || "(root)";
      const ext = name.split(".").pop()?.toLowerCase() || "";
      return {
        path: t.path,
        name,
        subdir,
        ext,
        size: t.size || 0,
        // Raw download URL — hitting this directly returns the file contents.
        download_url: `https://raw.githubusercontent.com/${owner}/${repo}/${effectiveBranch}/${t.path}`,
      };
    });

  // Group by subdir so the UI can render collapsible sections
  const groups: Record<string, typeof files> = {};
  for (const f of files) {
    if (!groups[f.subdir]) groups[f.subdir] = [];
    groups[f.subdir].push(f);
  }
  // Sort each group by name
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => a.name.localeCompare(b.name));
  }

  return NextResponse.json({
    owner, repo,
    branch: effectiveBranch,
    total: files.length,
    truncated: tr.truncated,
    groups,
  });
}
