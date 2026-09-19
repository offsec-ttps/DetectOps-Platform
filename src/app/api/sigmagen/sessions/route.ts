/**
 * GET  /api/sigmagen/sessions   — list sessions (most recent first)
 * POST /api/sigmagen/sessions   — create a session  { title? }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // Scope the list to the caller's own sessions when enforcing.
  const where = auth.enforced ? { createdBy: auth.user.email } : {};
  const sessions = await prisma.sigmaGenSession.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { _count: { select: { messages: true, runs: true } } },
  });
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      messageCount: s._count.messages,
      runCount: s._count.runs,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const session = await prisma.sigmaGenSession.create({
    data: {
      title: (typeof body.title === "string" && body.title.trim()) ? body.title.trim().slice(0, 200) : "Untitled session",
      createdBy: auth.user.email,
    },
  });
  return NextResponse.json({ session }, { status: 201 });
}
