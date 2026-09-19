/**
 * Dispatch policy for the native BAS fleet (M5): allowed-scope enforcement +
 * consent gating. Evaluated control-plane-side before a job is signed and
 * handed to an agent; the agent re-checks scope independently as defense in
 * depth.
 *
 * Scope: a bundle's scope is its ATT&CK tactic (e.g. "execution",
 * "credential-access"). A node may only run scopes within its enrolled scope,
 * and the fleet's allowed scope. An EMPTY scope list means "unrestricted" — so
 * fleets/nodes created without scopes keep working (dev-friendly), while a
 * non-empty list is a hard allow-list.
 *
 * Consent: a Fleet may reference a signed Consent with a validity window
 * (validFrom..validTo) and an authorized scope set. When a consent is attached
 * its window is always enforced. When AUTH_ENFORCE=1 (production) a valid
 * consent is REQUIRED to run anything; in dev a missing consent is allowed but
 * surfaced as a warning by the UI.
 */

import { prisma } from "@/lib/prisma";
import { authEnforced } from "@/lib/auth-guard";
import type { Fleet, FleetNode } from "@/generated/prisma/client";

export function normalizeScope(tactic: string): string {
  return (tactic || "").toLowerCase().trim().replace(/\s+/g, "-") || "unspecified";
}

function safeArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
function safeObj(s: string): any {
  try { return JSON.parse(s) || {}; } catch { return {}; }
}

export type PolicyResult =
  | { ok: true; consentRef: string }
  | { ok: false; reason: string };

export async function evaluateDispatchPolicy(opts: {
  bundleScope: string;
  node: Pick<FleetNode, "enrolledScope">;
  fleet: Pick<Fleet, "allowedScope" | "consentId">;
}): Promise<PolicyResult> {
  const scope = normalizeScope(opts.bundleScope);

  // 1. Allowed-scope (node + fleet allow-lists; empty = unrestricted).
  const nodeScope = safeArr(opts.node.enrolledScope);
  const fleetScope = safeArr(opts.fleet.allowedScope);
  if (nodeScope.length && !nodeScope.includes(scope)) {
    return { ok: false, reason: `scope "${scope}" not in node's enrolled scope [${nodeScope.join(",")}]` };
  }
  if (fleetScope.length && !fleetScope.includes(scope)) {
    return { ok: false, reason: `scope "${scope}" not in fleet's allowed scope [${fleetScope.join(",")}]` };
  }

  // 2. Consent.
  if (opts.fleet.consentId) {
    const consent = await prisma.consent.findUnique({ where: { id: opts.fleet.consentId } });
    if (!consent) return { ok: false, reason: "fleet's consent record is missing" };
    const now = Date.now();
    if (consent.validFrom && new Date(consent.validFrom).getTime() > now) {
      return { ok: false, reason: "consent is not yet valid (before its window)" };
    }
    if (consent.validTo && new Date(consent.validTo).getTime() < now) {
      return { ok: false, reason: "consent has expired (outside its authorized window)" };
    }
    // Consent may restrict scopes too.
    const cScopes: string[] = (() => {
      const o = safeObj(consent.scope);
      if (Array.isArray(o)) return o.map(String);
      if (Array.isArray(o.scopes)) return o.scopes.map(String);
      return [];
    })();
    if (cScopes.length && !cScopes.includes(scope)) {
      return { ok: false, reason: `scope "${scope}" not covered by consent` };
    }
    return { ok: true, consentRef: consent.id };
  }

  // No consent attached.
  if (authEnforced()) {
    return { ok: false, reason: "no consent attached to fleet (required when enforcing)" };
  }
  return { ok: true, consentRef: "" };   // dev: allowed, flagged in UI
}
