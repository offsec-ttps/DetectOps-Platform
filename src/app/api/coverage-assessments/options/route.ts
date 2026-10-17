import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { listLibraries } from "@/lib/coverage-assessment/scope";

// GET /api/coverage-assessments/options — form data: environments to sweep
// against, SIEM connections to observe with, and the scopeable libraries.
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const [environments, siemConnections, libraries] = await Promise.all([
    prisma.environmentTarget.findMany({
      where: { enabled: true },
      select: { id: true, name: true, kind: true, shellMode: true, hostname: true },
      orderBy: { name: "asc" },
    }),
    prisma.siemConnection.findMany({ select: { id: true, name: true, kind: true, isDefault: true }, orderBy: { name: "asc" } }),
    listLibraries(),
  ]);
  return NextResponse.json({ environments, siemConnections, libraries });
}
