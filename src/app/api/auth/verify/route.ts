import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeVerification, createSession, setSessionCookie } from "@/lib/auth";
import { logEvent } from "@/lib/event-log";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";

// A 6-digit code is a 10^6 space and stays live for 10 minutes; without a cap
// an attacker who knows a userId could exhaust it. Allow a modest number of
// attempts per userId and per source IP per window, then 429.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60_000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || "");
  const code = String(body.code || "").trim();

  if (!userId || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const byUser = rateLimit(`verify:user:${userId}`, MAX_ATTEMPTS, WINDOW_MS);
  const byIp = rateLimit(`verify:ip:${ip}`, MAX_ATTEMPTS * 4, WINDOW_MS);
  if (!byUser.ok || !byIp.ok) {
    const retryAfterMs = Math.max(byUser.retryAfterMs, byIp.retryAfterMs);
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and request a new code." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const user = await prisma.authUser.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const ok = await consumeVerification(userId, code);
  if (!ok) {
    void logEvent({
      category: "auth", action: "auth.verify.fail",
      actor: user.email, status: "warn", targetType: "user", targetId: user.id,
      message: "bad or expired verification code",
    });
    return NextResponse.json({ error: "Code is invalid or expired. Try resending." }, { status: 400 });
  }

  // Auto-login after successful verification
  resetRateLimit(`verify:user:${userId}`);
  const userAgent = req.headers.get("user-agent") || "";
  const token = await createSession(user.id, userAgent, ip === "unknown" ? "" : ip);
  await setSessionCookie(token);
  void logEvent({
    category: "auth", action: "auth.verify",
    actor: user.email, status: "ok", targetType: "user", targetId: user.id,
    message: "email verified + auto-login",
  });

  return NextResponse.json({ status: "ok", redirect: "/overview" });
}
