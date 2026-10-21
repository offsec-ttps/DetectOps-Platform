/**
 * POST /api/build-forge/releases/download
 *
 * Downloads a GitHub Release asset (or branch-zip archive) onto the host and
 * saves a row into `BinaryCollection` so it shows up in the existing
 * "Binary Collection" page + can be reused by other flows (Research VMs tool
 * install, Campaign Designer etc.).
 *
 * Body:
 *   {
 *     owner, repo, assetUrl, assetName, assetSize?, kind,
 *     description?, tags?
 *   }
 *
 * Validates that `assetUrl` points at github.com / api.github.com / objects.githubusercontent.com
 * — we do NOT fetch arbitrary URLs.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createWriteStream, mkdirSync, existsSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { join, resolve, sep } from "node:path";
import { isSafeSegment } from "@/lib/build-forge/validate";
import { BINARY_COLLECTION_DIR as COLLECTION_DIR } from "../../../_shared/safe-file";

// Hard ceiling on a single downloaded asset (bytes); override via env.
const MAX_ASSET_BYTES = Number(process.env.BUILD_FORGE_MAX_ASSET_BYTES) || 2 * 1024 * 1024 * 1024;

const ALLOWED_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
  // Added for per-file downloads from meta-binary repos (SharpCollection etc.).
  // Raw GitHub blobs (raw.githubusercontent.com) and media CDN (media.githubusercontent.com).
  "raw.githubusercontent.com",
  "media.githubusercontent.com",
]);

function ghHeaders(accept: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: accept,
    "User-Agent": "detection-platform/build-forge",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export async function POST(req: NextRequest) {
  // Admin-only, matching the sibling Build Forge routes: this writes a fetched
  // asset to the host and records a BinaryCollection row.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { owner, repo, assetUrl, assetName, kind } = body;
  const description: string = body.description || "";
  const tags: string[] = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 50) : [];

  if (!owner || !repo || !assetUrl || !assetName) {
    return NextResponse.json({ error: "owner, repo, assetUrl, assetName required" }, { status: 400 });
  }
  // owner/repo are interpolated into the on-disk filename — reject anything
  // that isn't a plain GitHub name segment (blocks ../ path traversal writes).
  if (!isSafeSegment(owner) || !isSafeSegment(repo) || typeof assetName !== "string" || typeof assetUrl !== "string") {
    return NextResponse.json({ error: "invalid owner/repo/assetName" }, { status: 400 });
  }

  // Validate URL host is in the allowlist
  let url: URL;
  try { url = new URL(assetUrl); }
  catch { return NextResponse.json({ error: "invalid URL" }, { status: 400 }); }
  if (url.protocol !== "https:" || url.username || url.password || !ALLOWED_HOSTS.has(url.hostname)) {
    return NextResponse.json({ error: `host ${url.hostname} not in allowlist` }, { status: 400 });
  }

  // Pick the right Accept header: the /zipball/* endpoint returns a binary
  // archive when asked with application/octet-stream.
  const accept = url.pathname.includes("/zipball/") || url.pathname.includes("/tarball/")
    ? "application/octet-stream"
    : "application/octet-stream";

  // Fetch the asset
  let res: Response;
  try {
    res = await fetch(assetUrl, { headers: ghHeaders(accept), redirect: "follow" });
  } catch (e: any) {
    return NextResponse.json({ error: `fetch failed: ${e?.message || e}` }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: `upstream HTTP ${res.status}` }, { status: 502 });
  }
  // Redirects (e.g. to the release CDN) must also land on an allowlisted host.
  try {
    const finalHost = new URL(res.url || assetUrl).hostname;
    if (!ALLOWED_HOSTS.has(finalHost) && !finalHost.endsWith(".githubusercontent.com")) {
      return NextResponse.json({ error: `redirected to non-allowlisted host ${finalHost}` }, { status: 400 });
    }
  } catch { /* keep original URL */ }
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: `asset too large (${declared} bytes)` }, { status: 413 });
  }

  mkdirSync(COLLECTION_DIR, { recursive: true });
  // Prefix the filename so we don't collide across different repos/versions
  const safeName = assetName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const stamp = Date.now().toString(36);
  const finalName = `${owner}-${repo}-${stamp}-${safeName}`;
  const destPath = join(COLLECTION_DIR, finalName);
  if (!resolve(destPath).startsWith(COLLECTION_DIR + sep)) {
    return NextResponse.json({ error: "invalid destination" }, { status: 400 });
  }

  // Stream download to disk while hashing
  try {
    const hash = createHash("sha256");
    const out = createWriteStream(destPath);
    const reader = Readable.fromWeb(res.body as any);
    let received = 0;
    reader.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_ASSET_BYTES) reader.destroy(new Error("asset exceeds size limit"));
      else hash.update(chunk);
    });
    await pipeline(reader, out);
    const fileSize = existsSync(destPath) ? statSync(destPath).size : 0;
    const sha256 = hash.digest("hex");

    const item = await prisma.binaryCollection.create({
      data: {
        name: `${owner}/${repo} · prebuilt · ${assetName}`,
        binaryName: assetName,
        repoName: `${owner}/${repo}`,
        repoOwner: owner,
        language: "",
        target: kind || "prebuilt",
        environment: "prebuilt",
        architecture: "any",
        framework: "custom",
        branch: "",
        commitSha: "",
        buildProfile: "prebuilt",
        filePath: destPath,
        fileSize,
        sha256,
        description: description || `Downloaded from GitHub release asset (${kind || "asset"})`,
        tags: JSON.stringify([...tags, "prebuilt", owner, repo]),
      },
    });

    return NextResponse.json({
      status: "ok",
      message: `Downloaded ${assetName} (${(fileSize / 1024 / 1024).toFixed(1)} MB) to Binary Collection.`,
      item: { ...item, tags: JSON.parse(item.tags) },
    });
  } catch (e: any) {
    // Cleanup partial file on error
    try { if (existsSync(destPath)) require("fs").unlinkSync(destPath); } catch { /* ignore */ }
    return NextResponse.json({ error: `write failed: ${e?.message || e}` }, { status: 500 });
  }
}
