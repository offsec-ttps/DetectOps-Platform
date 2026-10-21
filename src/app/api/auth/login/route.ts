import { NextRequest, NextResponse } from "next/server";
import { rateLimit, resetRateLimit, peekRateLimited } from "@/lib/rate-limit";
import { policyRole } from "@/lib/auth-policy";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  isValidEmail,
  createSession,
  setSessionCookie,
  createVerification,
} from "@/lib/auth";
import { devEscapeHatchAllowed } from "@/lib/auth-guard";
import { clientIp } from "@/lib/client-ip";
import { logEvent } from "@/lib/event-log";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!isValidEmail(email) || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  // Brute-force / credential-stuffing throttle. The per-account counter is keyed
  // on account+IP so a remote attacker cannot lock a victim's account out from a
  // single source by burning its attempts; the per-IP counter caps spraying.
  const ipKey = clientIp(req);
  // Spray pre-gate: cap TOTAL attempts from one source IP. A legitimate user
  // stays well under this; it bounds single-source brute force without ever
  // being keyed on a victim's account (so it can't be used to lock someone out).
  const byIp = rateLimit(`login:ip:${ipKey}`, 50, 15 * 60_000);
  if (!byIp.ok) {
    return NextResponse.json({ error: "Too many sign-in attempts. Try again in a few minutes." }, { status: 429, headers: { "Retry-After": String(Math.ceil((byIp.retryAfterMs || 0) / 1000) || 60) } });
  }
  const failUserKey = `login:fail:${email}:${ipKey}`;
  const failAcctKey = `login:fail:acct:${email}`;
  // Account-wide lockout gate: once FAILURES for this account cross a high
  // threshold (only failures increment it, below), refuse EVERY further attempt
  // identically — correct or not — so a (possibly distributed) brute force is
  // genuinely bounded and the response never reveals whether a guess was right.
  // The threshold is high + the window short (15 min, auto-resets) so ordinary
  // mistyping never trips it; a successful login clears it immediately.
  const ACCT_LOCK_MAX = 50;
  const lock = peekRateLimited(failAcctKey, ACCT_LOCK_MAX);
  if (lock.limited) {
    return NextResponse.json({ error: "Too many failed sign-in attempts for this account. Try again in a few minutes." }, { status: 429, headers: { "Retry-After": String(Math.ceil(lock.retryAfterMs / 1000) || 60) } });
  }

  const user = await prisma.authUser.findUnique({ where: { email } });
  // Always run a hash compare even when user is missing — keeps response time
  // close to constant and prevents trivial enumeration via timing.
  const ok = user ? verifyPassword(password, user.passwordHash)
                  : verifyPassword(password, "AAAAAAAA:AAAAAAAA");
  if (!user || !ok) {
    // Count the FAILURE (not every attempt). Once failures exceed the window
    // threshold we throttle further wrong guesses — bounding brute force — but a
    // subsequent correct password is still accepted (checked before these keys).
    const fUser = rateLimit(failUserKey, 10, 15 * 60_000);
    const fAcct = rateLimit(failAcctKey, ACCT_LOCK_MAX, 15 * 60_000);
    void logEvent({
      category: "auth", action: "auth.login.fail",
      actor: email, status: "warn",
      message: "bad password or unknown email",
    });
    if (!fUser.ok || !fAcct.ok) {
      const retry = Math.max(fUser.retryAfterMs || 0, fAcct.retryAfterMs || 0);
      return NextResponse.json({ error: "Too many failed sign-in attempts. Try again in a few minutes." }, { status: 429, headers: { "Retry-After": String(Math.ceil(retry / 1000) || 60) } });
    }
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

  // Successful login clears the failure counters for this account.
  resetRateLimit(failUserKey);
  resetRateLimit(failAcctKey);
  // Keep the admin role in sync with ADMIN_EMAILS (only ever promotes).
  const wanted = policyRole(user.email, user.role);
  if (wanted !== user.role) await prisma.authUser.update({ where: { id: user.id }, data: { role: wanted } }).catch(() => {});

  const userAgent = req.headers.get("user-agent") || "";
  const ip = ipKey === "unknown" ? "" : ipKey;
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
