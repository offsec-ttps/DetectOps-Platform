import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  isValidEmail,
  createSession,
  setSessionCookie,
  createVerification,
} from "@/lib/auth";
import { devEscapeHatchAllowed } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!isValidEmail(email) || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const user = await prisma.authUser.findUnique({ where: { email } });
  // Always run a hash compare even when user is missing — keeps response time
  // close to constant and prevents trivial enumeration via timing.
  const ok = user ? verifyPassword(password, user.passwordHash)
                  : verifyPassword(password, "AAAAAAAA:AAAAAAAA");
  if (!user || !ok) {
    void logEvent({
      category: "auth", action: "auth.login.fail",
      actor: email, status: "warn",
      message: "bad password or unknown email",
    });
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  if (!user.emailVerified) {
    // Re-issue a verification code and route the client to /verify.
    const { code } = await createVerification(user.id);
    void logEvent({
      category: "auth", action: "auth.login.unverified",
      actor: email, status: "warn", targetType: "user", targetId: user.id,
      message: "login blocked — email not verified, code re-sent",
    });
    return NextResponse.json({
      status: "verification_required",
      userId: user.id,
      email: user.email,
      ...(devEscapeHatchAllowed() ? { __devCode: code } : {}),
    }, { status: 403 });
  }

  const userAgent = req.headers.get("user-agent") || "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const token = await createSession(user.id, userAgent, ip);
  await setSessionCookie(token);
  void logEvent({
    category: "auth", action: "auth.login",
    actor: user.email, status: "ok", targetType: "user", targetId: user.id,
    message: "login ok",
    details: { ip, userAgent: userAgent.slice(0, 120) },
  });

  return NextResponse.json({
    status: "ok",
    redirect: "/overview",
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}
