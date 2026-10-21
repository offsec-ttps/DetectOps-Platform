/**
 * GET  /api/llm-providers/configs — list user-managed provider configs
 * POST /api/llm-providers/configs — create a new config (API key AES-GCM encrypted at rest)
 *
 * Responses NEVER include the plaintext API key. They return `hasApiKey: boolean`
 * and `apiKeyMasked: "****" | ""` so the UI can show "configured / not configured".
 *
 * The kind enum matches src/lib/llm/test-connection.ts::ProviderKind plus the
 * registry-backed vendors. `kind="custom"` allows arbitrary auth header style
 * via authHeaderName + authHeaderValue (template; {{key}} substituted).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto/credential-vault";
import { invalidateConfigCache } from "@/lib/llm/db-config";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";
import { requireRole } from "@/lib/auth-guard";
import { invalidHttpUrl } from "@/lib/net/ssrf";

const KINDS = new Set([
  "anthropic", "openai", "openrouter", "nvidia", "ollama",
  "openai-compatible", "custom",
]);

export async function GET() {
  const rows = await prisma.llmProviderConfig.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      label: r.label,
      kind: r.kind,
      baseUrl: r.baseUrl,
      hasApiKey: r.apiKeyEnc.length > 0,
      apiKeyMasked: r.apiKeyEnc.length > 0 ? "••••" : "",
      defaultModel: r.defaultModel,
      authHeaderName: r.authHeaderName,
      authHeaderValue: r.authHeaderValue,
      modelsPath: r.modelsPath,
      enabled: r.enabled,
      isDefault: r.isDefault,
      lastTestedAt: r.lastTestedAt,
      lastTestOk: r.lastTestOk,
      lastTestLatency: r.lastTestLatency,
      lastTestMessage: r.lastTestMessage,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  // Provider configs are global (shared by every user's generation calls) → admin only.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const label = String(body.label || "").trim();
  const kind = String(body.kind || "").trim();
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: `kind must be one of ${[...KINDS].join("|")}` }, { status: 400 });
  }
  if ((kind === "openai-compatible" || kind === "custom") && !body.baseUrl) {
    return NextResponse.json({ error: `baseUrl is required for kind="${kind}"` }, { status: 400 });
  }
  const badUrl = invalidHttpUrl(body.baseUrl, "baseUrl");
  if (badUrl) return NextResponse.json({ error: badUrl }, { status: 400 });

  let apiKeyEnc = "";
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    try { apiKeyEnc = encrypt(body.apiKey.trim()); }
    catch (err: any) {
      return NextResponse.json({ error: `key encryption failed: ${err?.message || err}` }, { status: 500 });
    }
  }

  // ≤1 default per kind — unset previous default-of-this-kind before flipping
  if (body.isDefault === true) {
    await prisma.llmProviderConfig.updateMany({
      where: { kind, isDefault: true },
      data: { isDefault: false },
    });
  }

  const row = await prisma.llmProviderConfig.create({
    data: {
      label: label.slice(0, 240),
      kind,
      baseUrl: String(body.baseUrl || "").slice(0, 1024),
      apiKeyEnc,
      defaultModel: String(body.defaultModel || "").slice(0, 240),
      authHeaderName: String(body.authHeaderName || "Authorization").slice(0, 120),
      authHeaderValue: String(body.authHeaderValue || "Bearer {{key}}").slice(0, 240),
      modelsPath: String(body.modelsPath || "").slice(0, 240),
      enabled: body.enabled !== false,
      isDefault: body.isDefault === true,
    },
  });

  invalidateConfigCache();

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "system",
    action: "llm-providers.config.create",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "LlmProviderConfig",
    targetId: row.id,
    message: `${label} · kind=${kind}${row.isDefault ? " · default" : ""}`,
    details: { kind, label, hasKey: !!apiKeyEnc, baseUrl: row.baseUrl },
  });

  return NextResponse.json({
    id: row.id, label: row.label, kind: row.kind, enabled: row.enabled, isDefault: row.isDefault,
  });
}
