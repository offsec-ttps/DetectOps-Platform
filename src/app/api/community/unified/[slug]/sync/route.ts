/**
 * POST /api/community/unified/[slug]/sync
 *
 * Generic sync endpoint for ANY new community source.
 * Looks up the adapter by id slug and calls its sync() method.
 *
 * Slugs supported: mitre-car, sentinel, defender-xdr, google-secops, panther, falco, wazuh
 * (whatever the registry exposes — adapters with `legacy: true` are forwarded
 * to their dedicated routes for backward compatibility.)
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdapter } from "@/lib/community-sources/registry";
import { requireRole } from "@/lib/auth-guard";

export const maxDuration = 600;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  // Internet-fetching / bulk-rewriting maintenance op: admin only (dev: open).
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { slug } = await ctx.params;

  const adapter = await getAdapter(slug);
  if (!adapter) {
    return NextResponse.json({ error: `Unknown source: ${slug}` }, { status: 404 });
  }

  const meta = adapter.meta();
  if (meta.legacy) {
    return NextResponse.json({
      error: `${slug} is a legacy source — use its dedicated /api/community/${slug}/sync route`,
    }, { status: 400 });
  }

  try {
    const result = await adapter.sync();
    return NextResponse.json({ status: "completed", source: slug, ...result });
  } catch (err: any) {
    return NextResponse.json({ status: "failed", source: slug, error: err.message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const adapter = await getAdapter(slug);
  if (!adapter) return NextResponse.json({ enabled: false });

  const meta = adapter.meta();
  const { prisma } = await import("@/lib/prisma");
  const source = await prisma.communitySource.findUnique({ where: { name: meta.name } });

  return NextResponse.json({
    enabled: true,
    registered: !!source,
    name: meta.name,
    type: meta.type,
    totalRules: source?.totalRules ?? 0,
    lastSyncAt: source?.lastSyncAt?.toISOString() ?? null,
  });
}
