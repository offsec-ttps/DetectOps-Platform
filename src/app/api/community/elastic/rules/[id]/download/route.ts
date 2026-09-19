import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rule = await prisma.communityElasticRule.findUnique({
    where: { id },
    select: { ruleContent: true, filePath: true },
  });

  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  const filename = rule.filePath.split("/").pop() || "elastic-rule.toml";

  return new NextResponse(rule.ruleContent, {
    status: 200,
    headers: {
      "Content-Type": "application/toml",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
