import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { listLibraries } from "@/lib/coverage-assessment/scope";

// GET /api/coverage-assessments/options — form data: environments to sweep
// against, SIEM connections to observe with, and the scopeable libraries.
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // Only offer the caller environments / SIEM connections they own (admins/dev
  // see all) — so the form can't be used to reference another tenant's resources.
  const ownerScope = auth.enforced && auth.user.role !== "admin" ? { ownerId: auth.user.id } : {};
  const [environments, siemConnections, libraries] = await Promise.all([
    prisma.environmentTarget.findMany({
      where: { enabled: true, ...ownerScope },
      select: { id: true, name: true, kind: true, shellMode: true, hostname: true },
      orderBy: { name: "asc" },
    }),
    prisma.siemConnection.findMany({ where: ownerScope, select: { id: true, name: true, kind: true, isDefault: true }, orderBy: { name: "asc" } }),
    listLibraries(),
  ]);
  return NextResponse.json({ environments, siemConnections, libraries });
}
