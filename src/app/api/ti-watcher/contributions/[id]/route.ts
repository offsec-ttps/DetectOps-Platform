/**
 * POST /api/ti-watcher/contributions/[id]
 *   body: { action: "approve" | "reject", libraryKey?, category? }
 *
 * Review-gate control. Approving flips status → "approved" (the library view
 * then merges it) and re-links a vetted AtomicTest if still unlinked. For an
 * *unrouted* contribution, approve may supply `libraryKey`/`category` to route
 * it on acceptance. Rejecting flips status → "rejected".
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { linkAtomic } from "@/lib/ti-watcher/atomics";
import { getTarget } from "@/lib/ti-watcher/targets";
import { logEvent } from "@/lib/event-log";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action || "");
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const row = await prisma.simLibraryContribution.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "reject") {
    const updated = await prisma.simLibraryContribution.update({
      where: { id }, data: { status: "rejected", reviewedBy: auth.user.id, reviewedAt: new Date() },
    });
    void logEvent({ category: "ti-watcher", action: "ti-watcher.contribution.rejected", actor: auth.user.id, status: "info", message: `rejected ${row.name}`, details: { id, libraryKey: row.libraryKey } });
    return NextResponse.json({ ok: true, contribution: updated });
  }

  // approve — allow routing an unrouted entry on acceptance
  const libraryKey = typeof body?.libraryKey === "string" && body.libraryKey ? body.libraryKey : row.libraryKey;
  if (!libraryKey) {
    return NextResponse.json({ error: "cannot approve an unrouted contribution without a target libraryKey" }, { status: 400 });
  }
  const target = getTarget(libraryKey);
  if (!target) return NextResponse.json({ error: `unknown library "${libraryKey}"` }, { status: 400 });

  const primaryId = (() => { try { return (JSON.parse(row.attackTechniques || "[]")[0] || "").toUpperCase(); } catch { return ""; } })();
  const category = typeof body?.category === "string" && body.category
    ? body.category
    : (row.category || (primaryId ? target.categoryFor(primaryId, row.name) : null));

  // re-link an atomic if we still don't have one
  let atomic = { atomicTestId: row.atomicTestId, atomicTestName: row.atomicTestName, atomicTestNumber: row.atomicTestNumber, needsAtomic: row.needsAtomic };
  if (row.needsAtomic && primaryId) {
    const link = await linkAtomic(primaryId);
    if (link.atomicTestId) atomic = link;
  }

  const updated = await prisma.simLibraryContribution.update({
    where: { id },
    data: {
      status: "approved", libraryKey, category,
      reviewedBy: auth.user.id, reviewedAt: new Date(),
      atomicTestId: atomic.atomicTestId, atomicTestName: atomic.atomicTestName, atomicTestNumber: atomic.atomicTestNumber, needsAtomic: atomic.needsAtomic,
    },
  });
  void logEvent({ category: "ti-watcher", action: "ti-watcher.contribution.approved", actor: auth.user.id, status: "info", message: `approved ${row.name} → ${libraryKey}`, details: { id, libraryKey, needsAtomic: atomic.needsAtomic } });
  return NextResponse.json({ ok: true, contribution: updated });
}
