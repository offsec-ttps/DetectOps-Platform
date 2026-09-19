import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createVerification } from "@/lib/auth";
import { devEscapeHatchAllowed } from "@/lib/auth-guard";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || "");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const user = await prisma.authUser.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (user.emailVerified) {
    return NextResponse.json({ status: "already_verified" });
  }
  const { code } = await createVerification(userId);
  // Code returned only in dev (no SMTP); delivered out-of-band when enforcing.
  return NextResponse.json({ status: "sent", ...(devEscapeHatchAllowed() ? { __devCode: code } : {}) });
}
