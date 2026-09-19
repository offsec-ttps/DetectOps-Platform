/**
 * Minimal local auth used by the public landing page (login/signup/verify).
 *
 * - Passwords: scrypt(N=2^15) → "saltB64:hashB64"
 * - Sessions:  random 256-bit token in an HTTP-only "do_session" cookie;
 *              looked up against AuthSession table; 30-day expiry.
 * - Verification codes: 6-digit numeric, hashed (scrypt) with 10-min expiry.
 *
 * SMTP isn't wired in this environment, so signup returns the verification
 * code under `__devCode` so the dev workflow can show it on /verify. Strip
 * that response field before shipping to a real environment.
 */

import { prisma } from "@/lib/prisma";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "do_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;       // 30 days
const VERIFY_TTL_MS = 10 * 60 * 1000;                  // 10 minutes
const SCRYPT_N = 1 << 15;
const SCRYPT_KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, maxmem: 64 * 1024 * 1024 });
  return `${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  try {
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const got = scryptSync(plain.normalize("NFKC"), salt, expected.length, { N: SCRYPT_N, maxmem: 64 * 1024 * 1024 });
    return expected.length === got.length && timingSafeEqual(expected, got);
  } catch { return false; }
}

export function generateCode(): string {
  // 6 digits, zero-padded. Cryptographically random; avoid Math.random.
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

export function hashCode(code: string): string {
  // Reuse password hash format for storage parity.
  return hashPassword(code);
}

export function verifyCode(code: string, stored: string): boolean {
  return verifyPassword(code, stored);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: string;
}

export async function createSession(userId: string, userAgent = "", ip = ""): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.authSession.create({
    data: { token, userId, expiresAt, userAgent: userAgent.slice(0, 240), ip: ip.slice(0, 64) },
  });
  return token;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const u = session.user;
  return { id: u.id, email: u.email, name: u.name, emailVerified: u.emailVerified, role: u.role };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter.";
  if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter.";
  if (!/\d/.test(pw)) return "Password must contain a number.";
  return null;
}

export async function createVerification(userId: string): Promise<{ code: string }> {
  const code = generateCode();
  await prisma.emailVerification.create({
    data: {
      userId,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });
  return { code };
}

export async function consumeVerification(userId: string, code: string): Promise<boolean> {
  const recent = await prisma.emailVerification.findFirst({
    where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!recent) return false;
  if (!verifyCode(code, recent.codeHash)) return false;
  await prisma.emailVerification.update({
    where: { id: recent.id },
    data: { consumedAt: new Date() },
  });
  await prisma.authUser.update({
    where: { id: userId },
    data: { emailVerified: true, emailVerifiedAt: new Date() },
  });
  return true;
}
