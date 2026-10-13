/**
 * GET /api/ti-watcher/contributions?status=&library=
 *
 * Lists SimLibraryContribution rows for the review panel. Defaults to the
 * review queue (pending + unrouted). Grouped/sorted newest-first.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { LIBRARY_TARGETS } from "@/lib/ti-watcher/targets";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const status = (sp.get("status") || "").trim();           // "", "pending", "approved", "rejected", "unrouted", "queue"
  const library = (sp.get("library") || "").trim();

  const where: any = {};
  if (status && status !== "queue") where.status = status;
  else if (!status || status === "queue") where.status = { in: ["pending", "unrouted"] };
  if (library) where.libraryKey = library === "unrouted" ? null : library;

  const items = await prisma.simLibraryContribution.findMany({
    where, orderBy: { createdAt: "desc" }, take: 500,
  });

  const counts = {
    pending: await prisma.simLibraryContribution.count({ where: { status: "pending" } }),
    unrouted: await prisma.simLibraryContribution.count({ where: { status: "unrouted" } }),
    approved: await prisma.simLibraryContribution.count({ where: { status: "approved" } }),
    rejected: await prisma.simLibraryContribution.count({ where: { status: "rejected" } }),
  };

  const targets = LIBRARY_TARGETS.map((t) => ({ libraryKey: t.libraryKey, displayName: t.displayName, moduleId: t.moduleId }));
  return NextResponse.json({ items, counts, targets });
}
