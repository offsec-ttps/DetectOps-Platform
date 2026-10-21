import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedFeedSources } from "@/lib/threat-intel/aggregator";
import { requireRole } from "@/lib/auth-guard";
import { invalidHttpUrl } from "@/lib/net/ssrf";

/** GET — list all feed sources */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const category = searchParams.get("category") || "";

  const where: Record<string, unknown> = {};
  if (category) where.category = category;

  const sources = await prisma.tiFeedSource.findMany({
    where: where as any,
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ items: sources, total: sources.length });
}

/** POST — seed sources from config or add a custom source */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || body.action === "seed") {
    const count = await seedFeedSources();
    return NextResponse.json({ seeded: count, message: `${count} new sources added from config` });
  }

  // Add custom source
  if (body.name && body.feedUrl) {
    // Global feed list polled server-side → admin only, http(s) only.
    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;
    const bad = invalidHttpUrl(body.feedUrl, "feedUrl") || invalidHttpUrl(body.blogUrl, "blogUrl");
    if (bad || typeof body.feedUrl !== "string" || typeof body.name !== "string") {
      return NextResponse.json({ error: bad || "name and feedUrl must be strings" }, { status: 400 });
    }
    const source = await prisma.tiFeedSource.create({
      data: {
        name: body.name.slice(0, 240),
        type: typeof body.type === "string" ? body.type.slice(0, 40) : "rss",
        category: typeof body.category === "string" ? body.category.slice(0, 80) : "independent",
        blogUrl: typeof body.blogUrl === "string" ? body.blogUrl.slice(0, 1024) : "",
        feedUrl: body.feedUrl.slice(0, 1024),
        active: true,
      },
    });
    return NextResponse.json(source, { status: 201 });
  }

  return NextResponse.json({ error: "Provide name and feedUrl, or use action: 'seed'" }, { status: 400 });
}
