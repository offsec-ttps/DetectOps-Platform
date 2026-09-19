/**
 * Per-node authentication for agent-facing /api/v1 routes.
 *
 * Agents hold no browser session — their credential is the per-node api_key
 * issued at enrollment (stored AES-GCM-encrypted). GET routes present it via
 * the `X-Node-Key` header; POST routes may also carry it in the body. This
 * verifies the key and returns the node, or null on any mismatch.
 */

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/credential-vault";
import type { FleetNode } from "@/generated/prisma/client";

/**
 * Base URL the agent actually reached us at — from the Host header, not
 * `req.nextUrl.origin` (which can resolve to localhost on the dev server even
 * when reached over the LAN). Used only to build advisory callback URLs.
 */
export function baseUrlFromRequest(req: NextRequest): string {
  const host = req.headers.get("host");
  if (!host) return req.nextUrl.origin;
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "") || "http";
  return `${proto}://${host}`;
}

/** Constant-time string compare — avoids leaking key length/content via timing. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);   // keep the branch doing equal work, then fail
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/**
 * Verify a presented per-node api_key against the stored (encrypted) one in
 * constant time. Returns the node (regardless of status — callers decide how to
 * treat `revoked`), or null when unknown / key mismatch.
 */
export async function authNode(nodeId: string, presentedKey: string): Promise<FleetNode | null> {
  if (!nodeId || !presentedKey) return null;
  const node = await prisma.fleetNode.findUnique({ where: { id: nodeId } });
  if (!node) return null;
  let stored = "";
  try { stored = decrypt(node.apiKeyEnc); } catch { stored = ""; }
  if (!stored || !safeEqual(stored, presentedKey)) return null;
  return node;
}
