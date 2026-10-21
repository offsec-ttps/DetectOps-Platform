import { NextRequest, NextResponse } from "next/server";
import { signupAllowed, policyRole } from "@/lib/auth-policy";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  isValidEmail,
  passwordPolicyError,
  createVerification,
} from "@/lib/auth";
import { devEscapeHatchAllowed } from "@/lib/auth-guard";
import { clientIp } from "@/lib/client-ip";
import { logEvent } from "@/lib/event-log";

/** Include the verification code in the response ONLY in dev (no SMTP). */
function devCode(code: string): Record<string, string> {
  return devEscapeHatchAllowed() ? { __devCode: code } : {};
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim().slice(0, 80);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const pwErr = passwordPolicyError(password);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  // Throttle registration / code-resend abuse (each call can send an email).
  // Per-IP caps spraying; per-email caps hammering one address (email bombing),
  // which the per-IP limit alone misses when the source rotates IPs.
  const ip = clientIp(req);
  const byIp = rateLimit(`signup:ip:${ip}`, 10, 60 * 60_000);
  const byEmail = rateLimit(`signup:email:${email}`, 5, 60 * 60_000);
  if (!byIp.ok || !byEmail.ok) return NextResponse.json({ error: "Too many sign-up attempts. Try again later." }, { status: 429 });

  // Production: self-registration is invite/domain-gated (see lib/auth-policy.ts).
  if (!signupAllowed(email)) {
    return NextResponse.json({ error: "Registration is by invitation only. Ask an administrator for access." }, { status: 403 });
  }

  const existing = await prisma.authUser.findUnique({ where: { email } });
  if (existing) {
    // Avoid email enumeration: 200 with neutral message + always resend a code
    // so signup is idempotent for "I forgot I had an account".
    if (!existing.emailVerified) {
      // Anti account-pre-hijacking: an UNVERIFIED account has never proven email
      // ownership, so we do NOT touch the live passwordHash from this
      // unauthenticated request. The new password is STAGED with this code and
      // becomes live only when this specific code is verified (consumeVerification).
      const { code } = await createVerification(existing.id, hashPassword(password));
      void logEvent({
        category: "auth", action: "auth.signup.resend",
        actor: email, status: "info", targetType: "user", targetId: existing.id,
        message: "resent verification + reset credentials (unverified existing account)",
      });
      return NextResponse.json({
        status: "verification_sent",
        userId: existing.id,
        email,
        ...devCode(code),
      });
    }
    void logEvent({
      category: "auth", action: "auth.signup.duplicate",
      actor: email, status: "warn", targetType: "user", targetId: existing.id,
      message: "duplicate signup blocked",
    });
    return NextResponse.json({
      error: "An account with this email already exists. Try signing in instead.",
    }, { status: 409 });
  }

  const user = await prisma.authUser.create({
    data: {
      role: policyRole(email, "engineer"),
      email,
      name,
      // No usable password until the email is verified: a non-matchable
      // placeholder now, the real hash staged with the code and applied on verify.
      passwordHash: "unset:unset",
    },
  });
  const { code } = await createVerification(user.id, hashPassword(password));
  void logEvent({
    category: "auth", action: "auth.signup",
    actor: email, status: "ok", targetType: "user", targetId: user.id,
    message: `new account: ${email}`,
  });

  // __devCode is surfaced ONLY in dev (no SMTP wired) so the local verify loop
  // works; in enforced/production mode it is omitted and the code must be
  // delivered out-of-band.
  return NextResponse.json({
    status: "verification_sent",
    userId: user.id,
    email,
    ...devCode(code),
  });
}
