import { NextRequest, NextResponse } from "next/server";
import { rateLimit, resetRateLimit, peekCount } from "@/lib/rate-limit";
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
  // Progressive per-account delay (NOT a hard lock): recent failures for this
  // account slow EVERY attempt, which bounds a (possibly distributed) brute
  // force, but a CORRECT password is never rejected — so there is no
  // account-lockout DoS. The delay grows with the failure count and is capped;
  // ordinary mistyping (a few fails) adds no meaningful delay, and a successful
  // login clears the counter. Single-IP flooding is still hard-capped by byIp
  // and the per-account+IP failure limit below.
  const acctFails = peekCount(failAcctKey);
  if (acctFails > 10) {
    await new Promise((r) => setTimeout(r, Math.min((acctFails - 10) * 500, 5000)));
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
    // Per-account+IP failures are hard-capped (bounds a single source's brute
    // force). The account-wide counter is incremented purely to drive the
    // progressive delay above — it never hard-denies, so a correct password from
    // a legitimate user is never locked out.
    const fUser = rateLimit(failUserKey, 10, 15 * 60_000);
    rateLimit(failAcctKey, 100_000, 15 * 60_000);
    void logEvent({
      category: "auth", action: "auth.login.fail",
      actor: email, status: "warn",
      message: "bad password or unknown email",
    });
    if (!fUser.ok) {
      return NextResponse.json({ error: "Too many failed sign-in attempts from this device. Try again in a few minutes." }, { status: 429, headers: { "Retry-After": String(Math.ceil((fUser.retryAfterMs || 0) / 1000) || 60) } });
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
