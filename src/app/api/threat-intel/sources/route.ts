import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedFeedSources } from "@/lib/threat-intel/aggregator";

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
    const source = await prisma.tiFeedSource.create({
      data: {
        name: body.name,
        type: body.type || "rss",
        category: body.category || "independent",
        blogUrl: body.blogUrl || "",
        feedUrl: body.feedUrl,
        active: true,
      },
    });
    return NextResponse.json(source, { status: 201 });
  }

  return NextResponse.json({ error: "Provide name and feedUrl, or use action: 'seed'" }, { status: 400 });
}
