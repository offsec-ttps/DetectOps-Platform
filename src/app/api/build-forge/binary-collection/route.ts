import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/build-forge/binary-collection — list all saved binaries
 */
export async function GET(req: NextRequest) {
  const environment = req.nextUrl.searchParams.get("environment");
  const framework = req.nextUrl.searchParams.get("framework");
  const language = req.nextUrl.searchParams.get("language");
  const search = req.nextUrl.searchParams.get("q");

  const where: any = {};
  if (environment) where.environment = environment;
  if (framework) where.framework = framework;
  if (language) where.language = language;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { repoName: { contains: search } },
      { binaryName: { contains: search } },
      { description: { contains: search } },
    ];
  }

  const items = await prisma.binaryCollection.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  const parsed = items.map((i) => ({
    ...i,
    tags: JSON.parse(i.tags),
  }));

  return NextResponse.json({ items: parsed, total: parsed.length });
}
