/**
 * GET /api/build-forge/releases/[owner]/[repo]
 *
 * Proxies GitHub's Releases API so the Build Forge UI can show "already
 * compiled" binaries and source zips alongside the Build button. Three cases
 * collapse into one uniform response:
 *
 *   1. Repo has latest release with binary assets → returns assets[] + zipball.
 *   2. Repo has release but only source archive → returns empty assets[] + zipball.
 *   3. Repo has NO releases at all → returns a synthesized "branch zip" asset
 *      pointing at https://github.com/{o}/{r}/archive/refs/heads/{branch}.zip
 *      so users still get a one-click "grab the current source as a zip".
 *
 * No authentication — uses unauthenticated GitHub API (rate limit: 60 req/hr).
 * If `GITHUB_TOKEN` is set we include it to bump the limit to 5000/hr.
 */

import { NextRequest, NextResponse } from "next/server";

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
  updated_at: string;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  published_at: string;
  html_url: string;
  body?: string;
  zipball_url: string;
  tarball_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: GithubAsset[];
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "detection-platform/build-forge",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await ctx.params;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    return NextResponse.json({ error: "invalid owner/repo" }, { status: 400 });
  }

  // Try latest release first, then fall back to /releases (lists pre-releases too).
  const latestRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: ghHeaders(),
    // cache for 5 minutes — releases don't change often, keeps under rate limit
    next: { revalidate: 300 },
  }).catch(() => null);

  let release: GithubRelease | null = null;
  let hasRelease = false;

  if (latestRes && latestRes.ok) {
    release = await latestRes.json();
    hasRelease = true;
  } else if (latestRes && latestRes.status === 404) {
    // No "latest" but may have draft/prerelease — try listing
    const listRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`, {
      headers: ghHeaders(),
      next: { revalidate: 300 },
    }).catch(() => null);
    if (listRes && listRes.ok) {
      const arr = (await listRes.json()) as GithubRelease[];
      if (Array.isArray(arr) && arr.length > 0) {
        release = arr[0];
        hasRelease = true;
      }
    }
  }

  // Get the default branch for the fallback "archive" asset.
  let defaultBranch = "main";
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: ghHeaders(),
      next: { revalidate: 3600 },
    });
    if (repoRes.ok) {
      const r = await repoRes.json();
      defaultBranch = r.default_branch || "main";
    }
  } catch { /* keep default */ }

  // Normalize asset list — always include a zipball/tarball + branch-archive as fallbacks.
  const assets: Array<{
    name: string;
    size: number;
    url: string;
    kind: "binary" | "source-zip" | "source-tar" | "branch-zip";
    content_type?: string;
    updated_at?: string;
  }> = [];

  if (release) {
    for (const a of release.assets || []) {
      assets.push({
        name: a.name,
        size: a.size,
        url: a.browser_download_url,
        kind: "binary",
        content_type: a.content_type,
        updated_at: a.updated_at,
      });
    }
    if (release.zipball_url) {
      assets.push({
        name: `${repo}-${release.tag_name}-source.zip`,
        size: 0,
        url: release.zipball_url,
        kind: "source-zip",
      });
    }
  }

  // Always add a branch-archive fallback so tools without releases still get a download.
  assets.push({
    name: `${repo}-${defaultBranch}.zip`,
    size: 0,
    url: `https://github.com/${owner}/${repo}/archive/refs/heads/${defaultBranch}.zip`,
    kind: "branch-zip",
  });

  return NextResponse.json({
    owner,
    repo,
    hasRelease,
    release: release ? {
      tag: release.tag_name,
      name: release.name,
      published_at: release.published_at,
      html_url: release.html_url,
      prerelease: release.prerelease,
    } : null,
    defaultBranch,
    assets,
  });
}
