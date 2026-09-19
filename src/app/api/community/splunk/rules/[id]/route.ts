import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const detection = await prisma.splunkDetection.findUnique({
    where: { id },
  });

  if (!detection) {
    return NextResponse.json({ error: "Detection not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...detection,
    dataSource: JSON.parse(detection.dataSource),
    references: JSON.parse(detection.references),
    mitreTechniques: JSON.parse(detection.mitreTechniques),
    mitreTactics: JSON.parse(detection.mitreTactics),
    analyticStories: JSON.parse(detection.analyticStories),
    products: JSON.parse(detection.products),
  });
}
