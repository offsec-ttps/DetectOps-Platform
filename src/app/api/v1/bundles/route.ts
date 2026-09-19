/**
 * GET /api/v1/bundles?hash=&technique=&testIndex=   (AGENT-FACING)
 *
 * Serve the curated bundle for a job. The agent passes the bundle_hash it was
 * told to run, plus the technique/test-index hint to locate the source row.
 * We rebuild the bundle, verify the recomputed hash matches the requested one
 * (integrity), and return the canonical string the agent re-hashes before
 * executing.
 *
 * Auth: X-Node-Key header (per-node api_key).
 *
 * Returns: { bundleHash, canonical }  — `canonical` is the exact byte-stable
 * string that was hashed; the agent computes sha256(canonical) and refuses to
 * run on a mismatch.
 */

import { NextRequest, NextResponse } from "next/server";
import { authNode } from "@/lib/bas/agent-auth";
import { resolveBundle, canonicalBundle, bundleHash } from "@/lib/bas/bundle-catalog";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const hash = sp.get("hash") || "";
  const technique = sp.get("technique") || undefined;
  const testIndexRaw = sp.get("testIndex");
  const testIndex = testIndexRaw != null ? parseInt(testIndexRaw, 10) : undefined;
  const nodeId = req.headers.get("x-node-id") || "";
  const key = req.headers.get("x-node-key") || "";

  const node = await authNode(nodeId, key);
  if (!node) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hash) return NextResponse.json({ error: "hash required" }, { status: 400 });

  const bundle = await resolveBundle({ hash, technique, testIndex });
  if (!bundle) return NextResponse.json({ error: "bundle not found or hash mismatch" }, { status: 404 });

  // Integrity: the recomputed hash must equal the requested one.
  const computed = bundleHash(bundle);
  if (computed !== hash) return NextResponse.json({ error: "bundle hash mismatch" }, { status: 409 });

  return NextResponse.json({ bundleHash: computed, canonical: canonicalBundle(bundle) });
}
