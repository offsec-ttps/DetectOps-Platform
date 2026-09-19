import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rule = await prisma.communityElasticRule.findUnique({
    where: { id },
  });

  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...rule,
    tags: JSON.parse(rule.tags),
    mitreTechniques: JSON.parse(rule.mitreTechniques),
    mitreTactics: JSON.parse(rule.mitreTactics),
    threat: JSON.parse(rule.threat),
    author: JSON.parse(rule.author),
    references: JSON.parse(rule.references),
    falsepositives: JSON.parse(rule.falsepositives),
    index: JSON.parse(rule.index),
    integration: JSON.parse(rule.integration),
  });
}
