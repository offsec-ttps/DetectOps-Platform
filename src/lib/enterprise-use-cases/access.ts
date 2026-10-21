/**
 * One-call ownership gate for /api/enterprise-use-cases/[id]/* sub-routes.
 *
 * The global proxy guarantees a session in production, but NOT that the caller
 * owns the use case: without this, any authenticated user could read/edit
 * another tenant's detection logic, scenarios, runs, reports and comments, or
 * promote / validate / re-generate them, just by knowing the id.
 *
 * Returns a ready 401/404 response on failure, or null when allowed. Dev mode
 * (auth not enforced) always passes, matching the rest of the app.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

export async function guardUseCase(id: string): Promise<NextResponse | null> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const uc = await prisma.enterpriseUseCase.findUnique({ where: { id }, select: { uploadedBy: true } });
  if (!uc) return NextResponse.json({ error: "use case not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, uc.uploadedBy);
  return owns.ok ? null : owns.response;
}
