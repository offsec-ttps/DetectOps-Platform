import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET — List custom detections with optional filters */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") || "50", 10)));
  const search = searchParams.get("search") || "";
  const source = searchParams.get("source") || "";
  const verified = searchParams.get("verified");

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { search: { contains: search } },
    ];
  }
  if (source) where.source = source;
  if (verified === "true") where.verified = true;
  if (verified === "false") where.verified = false;

  const [items, total] = await Promise.all([
    prisma.customDetection.findMany({
      where: where as any,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.customDetection.count({ where: where as any }),
  ]);

  const parsed = items.map((d) => ({
    ...d,
    mitreTechniques: JSON.parse(d.mitreTechniques),
    mitreTactics: JSON.parse(d.mitreTactics),
    tags: JSON.parse(d.tags),
  }));

  return NextResponse.json({ items: parsed, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

/** POST — Create a new custom detection */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    name, description, author, search, source, sourceDetectionId,
    mitreTechniques, mitreTactics, type, category, securityDomain,
    verified, verifiedTechnique, tags,
  } = body;

  if (!name || !search) {
    return NextResponse.json({ error: "name and search are required" }, { status: 400 });
  }

  const detection = await prisma.customDetection.create({
    data: {
      name,
      description: description || "",
      author: author || "Detection Engineer",
      search,
      source: source || "custom",
      sourceDetectionId: sourceDetectionId || null,
      mitreTechniques: JSON.stringify(mitreTechniques || []),
      mitreTactics: JSON.stringify(mitreTactics || []),
      type: type || "Custom",
      category: category || "",
      securityDomain: securityDomain || "",
      verified: verified || false,
      verifiedAt: verified ? new Date() : null,
      verifiedTechnique: verifiedTechnique || "",
      tags: JSON.stringify(tags || []),
    },
  });

  return NextResponse.json(detection, { status: 201 });
}
