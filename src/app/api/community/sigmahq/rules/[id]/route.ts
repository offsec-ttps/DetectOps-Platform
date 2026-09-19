import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rule = await prisma.communitySigmaRule.findUnique({
    where: { id },
  });

  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...rule,
    tags: JSON.parse(rule.tags),
    mitreTechniques: JSON.parse(rule.mitreTechniques),
    falsepositives: JSON.parse(rule.falsepositives),
    references: JSON.parse(rule.references),
  });
}
