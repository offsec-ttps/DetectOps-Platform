import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rule = await prisma.communitySigmaRule.findUnique({
    where: { id },
    select: { detectionYaml: true, filePath: true },
  });

  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  const filename = rule.filePath.split("/").pop() || "sigma-rule.yml";

  return new NextResponse(rule.detectionYaml, {
    status: 200,
    headers: {
      "Content-Type": "application/x-yaml",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
