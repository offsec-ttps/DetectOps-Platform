/**
 * Account policy (production hardening).
 *
 *   ADMIN_EMAILS              comma-separated emails that are (and stay) admins.
 *                             Without it nobody can hold the admin role in production.
 *   ALLOW_SIGNUP=1            open self-registration (anyone with a verified email).
 *   SIGNUP_ALLOWED_DOMAINS    comma-separated email domains allowed to self-register
 *                             (e.g. "rusecure.in,example.com").
 *
 * When auth is enforced (production / AUTH_ENFORCE=1) self-registration is CLOSED by
 * default: only ADMIN_EMAILS, allowed domains, or ALLOW_SIGNUP=1 may sign up. This
 * platform drives C2 servers, lab VMs and simulations, so "anyone who registers" must
 * not be the default population of authenticated users. Dev mode is unchanged.
 */
import { authEnforced } from "@/lib/auth-guard";

const list = (v: string | undefined) =>
  String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isAdminEmail(email: string): boolean {
  return list(process.env.ADMIN_EMAILS).includes(email.trim().toLowerCase());
}

export function signupAllowed(email: string): boolean {
  if (!authEnforced()) return true;
  const e = email.trim().toLowerCase();
  if (isAdminEmail(e)) return true;
  if (process.env.ALLOW_SIGNUP === "1") return true;
  const domain = e.split("@")[1] || "";
  return list(process.env.SIGNUP_ALLOWED_DOMAINS).includes(domain);
}

/** Role a user should have given the policy (admin list wins; otherwise keep current). */
export function policyRole(email: string, current: string): string {
  return isAdminEmail(email) ? "admin" : current || "engineer";
}
