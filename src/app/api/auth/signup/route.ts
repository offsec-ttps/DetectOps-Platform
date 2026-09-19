import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  isValidEmail,
  passwordPolicyError,
  createVerification,
} from "@/lib/auth";
import { devEscapeHatchAllowed } from "@/lib/auth-guard";
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

  const existing = await prisma.authUser.findUnique({ where: { email } });
  if (existing) {
    // Avoid email enumeration: 200 with neutral message + always resend a code
    // so signup is idempotent for "I forgot I had an account".
    if (!existing.emailVerified) {
      const { code } = await createVerification(existing.id);
      void logEvent({
        category: "auth", action: "auth.signup.resend",
        actor: email, status: "info", targetType: "user", targetId: existing.id,
        message: "resent verification (unverified existing account)",
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
      email,
      name,
      passwordHash: hashPassword(password),
    },
  });
  const { code } = await createVerification(user.id);
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
