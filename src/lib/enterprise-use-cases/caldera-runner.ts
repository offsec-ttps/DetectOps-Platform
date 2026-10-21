/**
 * Caldera backend adapter (Phase 4 — optional bring-your-own-C2).
 *
 * When an EnvironmentTarget has kind="agent" + agentBackend="caldera", ATT&CK
 * steps are executed through the USER's own MITRE Caldera server instead of the
 * native BAS fleet. This is the deferred, optional path: the native fleet stays
 * the default engine; Caldera is for teams that already run it.
 *
 * Targets the Caldera v2 REST API (header `KEY: <api_key>`). Execution flow:
 *   1. resolve an ability for the step's technique (+ platform)
 *   2. create a one-ability adversary
 *   3. start an operation against the configured group
 *   4. poll until the link finishes (or timeout)
 *   5. pull agent output from the operation report
 *   6. best-effort cleanup of the throwaway operation + adversary
 *
 * Every network call is guarded — a misconfigured/unreachable Caldera returns a
 * diagnostic StepRunResult, never throws into the scenario runner.
 *
 * NOTE: not validated against a live Caldera here; the v2 contract + default
 * planner/source IDs below are Caldera's documented defaults and may need
 * per-deployment adjustment.
 */

import type { EnvironmentTarget } from "@/generated/prisma/client";
import { decrypt } from "@/lib/crypto/credential-vault";
import { checkC2Url } from "@/lib/c2/url-guard";
import { assertSafeOutboundUrl, labOutboundPolicy } from "@/lib/net/ssrf";

export interface StepRunResult {
  status: "ok" | "failure" | "stubbed" | "skipped";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  notes: string;
}

// Caldera built-in defaults (stock install)
const ATOMIC_PLANNER_ID = "aaa7c857-37a0-4c4a-85f7-4e9f7f30e31a";
const BASIC_SOURCE_ID = "ed32b9c3-9593-4c33-b0db-e2007315096b";

export interface CalderaConfig { baseUrl: string; apiKey: string; group: string; platform: string }

/**
 * Resolve a CalderaConfig from any source that carries a base URL, an encrypted
 * API key, a group, and an optional platform. Both an EnvironmentTarget
 * (agentBackend="caldera") and a C2Server (provider="caldera") map onto this
 * shape, so the health/run logic below is written once and shared.
 */
export function resolveCalderaConfig(src: {
  calderaUrl?: string | null; url?: string | null;
  calderaApiKeyEnc?: string | null; apiKeyEnc?: string | null;
  calderaGroup?: string | null; group?: string | null;
  agentPlatform?: string | null;
}): { ok: true; cfg: CalderaConfig } | { ok: false; reason: string } {
  const rawUrl = ((src.calderaUrl ?? src.url) || "").trim().replace(/\/+$/, "");
  if (!rawUrl) return { ok: false, reason: "Caldera URL not set" };
  // SSRF guard: only http(s), no embedded creds, never cloud-metadata hosts.
  const checked = checkC2Url(rawUrl);
  if (!checked.ok) return { ok: false, reason: `Caldera URL rejected: ${checked.error}` };
  const baseUrl = checked.url;
  const enc = src.calderaApiKeyEnc ?? src.apiKeyEnc ?? "";
  if (!enc) return { ok: false, reason: "Caldera API key not set" };
  let apiKey: string;
  try { apiKey = decrypt(enc); }
  catch (e: any) { return { ok: false, reason: `Caldera API key decrypt failed: ${e?.message || e}` }; }
  return { ok: true, cfg: { baseUrl, apiKey, group: (src.calderaGroup ?? src.group) || "red", platform: src.agentPlatform || "" } };
}

function loadConfig(env: EnvironmentTarget): { ok: true; cfg: CalderaConfig } | { ok: false; reason: string } {
  return resolveCalderaConfig(env);
}

async function cReq(cfg: CalderaConfig, method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<any> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Connect-time SSRF guard: resolve the Caldera URL and validate EVERY
    // resolved address (blocks DNS rebinding to a metadata/link-local endpoint
    // that the save-time string guard can't catch). LAN/private stays allowed.
    const safe = await assertSafeOutboundUrl(`${cfg.baseUrl}${path}`, labOutboundPolicy());
    if (!safe.ok) throw new Error(`refusing Caldera request: ${safe.error}`);
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: { KEY: cfg.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      // Never follow redirects: a redirect could bounce the request (and the
      // KEY header) to an internal/metadata endpoint past the URL guard.
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) throw new Error(`${method} ${path} → HTTP ${res.status} redirect refused (point the Caldera URL at the final address)`);
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    return json;
  } finally { clearTimeout(to); }
}

/** Lightweight connectivity/health check from a resolved config. */
export async function calderaHealthCfg(cfg: CalderaConfig): Promise<{ ok: boolean; agents?: number; version?: string; error?: string }> {
  try {
    // /api/v2/health is unauthenticated on most builds; agents proves the KEY works.
    let version: string | undefined;
    try { const h = await cReq(cfg, "GET", "/api/v2/health", undefined, 8_000); version = h?.version; } catch { /* optional */ }
    const agents = await cReq(cfg, "GET", "/api/v2/agents", undefined, 8_000);
    return { ok: true, agents: Array.isArray(agents) ? agents.length : 0, version };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** List the C2 beacons (Caldera agents) currently checked in. */
export async function listCalderaAgents(cfg: CalderaConfig): Promise<any[]> {
  const agents = await cReq(cfg, "GET", "/api/v2/agents", undefined, 8_000);
  return Array.isArray(agents) ? agents : [];
}

/** Lightweight connectivity/health check — used by the env "Test Caldera" action. */
export async function calderaHealth(env: EnvironmentTarget): Promise<{ ok: boolean; agents?: number; version?: string; error?: string }> {
  const c = loadConfig(env);
  if (!c.ok) return { ok: false, error: c.reason };
  return calderaHealthCfg(c.cfg);
}

function pickAbility(abilities: any[], techniqueId: string, platform: string): any | null {
  const matches = (abilities || []).filter((a) => (a?.technique_id || a?.technique?.attack_id) === techniqueId);
  if (!matches.length) return null;
  if (platform) {
    const onPlatform = matches.find((a) => (a?.executors || []).some((ex: any) => ex?.platform === platform));
    if (onPlatform) return onPlatform;
  }
  return matches[0];
}

/** Execute one ATT&CK step against a Caldera server described by env fields. */
export async function runCaldera(env: EnvironmentTarget, step: { techniqueId?: string; refId?: string; displayName?: string }, timeoutMs: number): Promise<StepRunResult> {
  const c = loadConfig(env);
  if (!c.ok) return { status: "stubbed", exitCode: -1, stdout: "", stderr: "", durationMs: 0, notes: `Caldera not configured: ${c.reason}` };
  return runCalderaCfg(c.cfg, step, timeoutMs);
}

/** Execute one ATT&CK step against a Caldera server from a resolved config. */
export async function runCalderaCfg(cfg: CalderaConfig, step: { techniqueId?: string; refId?: string; displayName?: string }, timeoutMs: number): Promise<StepRunResult> {
  const t0 = Date.now();
  const fail = (notes: string, stderr = "", status: StepRunResult["status"] = "failure"): StepRunResult =>
    ({ status, exitCode: -1, stdout: "", stderr, durationMs: Date.now() - t0, notes });

  const techniqueId = step.techniqueId || "";
  if (!techniqueId) return fail("step has no techniqueId to map to a Caldera ability", "", "stubbed");

  let adversaryId: string | null = null;
  let operationId: string | null = null;
  try {
    // 1. resolve ability
    const abilities = await cReq(cfg, "GET", "/api/v2/abilities");
    const ability = pickAbility(abilities, techniqueId, cfg.platform);
    if (!ability) return fail(`no Caldera ability found for ${techniqueId}${cfg.platform ? ` (platform ${cfg.platform})` : ""}`, "", "stubbed");
    const abilityId = ability.ability_id;

    // 2. throwaway adversary with just this ability
    const adv = await cReq(cfg, "POST", "/api/v2/adversaries", {
      name: `detops-${techniqueId}-${step.refId || "step"}`.slice(0, 60),
      description: "Auto-created by detection-platform (Caldera adapter)",
      atomic_ordering: [abilityId],
    });
    adversaryId = adv?.adversary_id || adv?.id;
    if (!adversaryId) return fail("Caldera adversary creation returned no id");

    // 3. start operation against the configured group
    const op = await cReq(cfg, "POST", "/api/v2/operations", {
      name: `detops-${techniqueId}-${Date.now().toString(36)}`.slice(0, 60),
      adversary: { adversary_id: adversaryId },
      group: cfg.group,
      auto_close: true,
      state: "running",
      planner: { id: ATOMIC_PLANNER_ID },
      source: { id: BASIC_SOURCE_ID },
    });
    operationId = op?.id;
    if (!operationId) return fail("Caldera operation creation returned no id");

    // 4. poll links until our ability finishes or we time out
    const deadline = t0 + Math.max(20_000, timeoutMs);
    let link: any = null;
    while (Date.now() < deadline) {
      const links = await cReq(cfg, "GET", `/api/v2/operations/${operationId}/links`, undefined, 10_000);
      link = (links || []).find((l: any) => (l?.ability?.ability_id || l?.ability_id) === abilityId);
      // A finished link has a 'finish' timestamp; status 0 = success in Caldera.
      if (link && (link.finish || (typeof link.status === "number" && link.status !== -3))) break;
      await new Promise((r) => setTimeout(r, 3_000));
    }
    if (!link) return fail("operation started but no link for the ability was scheduled (is an agent in the group?)", "", "stubbed");

    // 5. pull agent output from the report
    let output = "";
    try {
      const report = await cReq(cfg, "POST", `/api/v2/operations/${operationId}/report`, { enable_agent_output: true }, 15_000);
      const steps = report?.steps?.[Object.keys(report?.steps || {})[0]]?.steps || [];
      const match = steps.find((s: any) => s?.ability_id === abilityId || s?.link_id === link.id);
      output = match?.output || link?.output || "";
      if (output && typeof output === "object") output = JSON.stringify(output);
    } catch { output = link?.output || ""; }

    const success = typeof link.status === "number" ? link.status === 0 : !!link.finish;
    return {
      status: success ? "ok" : "failure",
      exitCode: typeof link.status === "number" ? link.status : (success ? 0 : 1),
      stdout: String(output || "").slice(-16_000),
      stderr: "",
      durationMs: Date.now() - t0,
      notes: `caldera op=${operationId} ability=${abilityId} status=${link.status}`,
    };
  } catch (e: any) {
    return fail(`Caldera adapter error: ${e?.message || String(e)}`, String(e?.message || e));
  } finally {
    // 6. best-effort cleanup
    if (operationId) cReq(cfg, "DELETE", `/api/v2/operations/${operationId}`, undefined, 8_000).catch(() => {});
    if (adversaryId) cReq(cfg, "DELETE", `/api/v2/adversaries/${adversaryId}`, undefined, 8_000).catch(() => {});
  }
}
