/**
 * GET    /api/llm-providers/configs/[id] — detail (never returns plaintext key)
 * PATCH  /api/llm-providers/configs/[id] — partial update; re-encrypts apiKey if supplied
 * DELETE /api/llm-providers/configs/[id] — remove
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto/credential-vault";
import { invalidateConfigCache } from "@/lib/llm/db-config";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const PATCHABLE = new Set([
  "label", "baseUrl", "defaultModel",
  "apiKey",
  "authHeaderName", "authHeaderValue", "modelsPath",
  "enabled", "isDefault",
]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await prisma.llmProviderConfig.findUnique({ where: { id } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
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
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const existing = await prisma.llmProviderConfig.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    if (k === "apiKey" && typeof v === "string") {
      if (v.length === 0) { data.apiKeyEnc = ""; continue; }   // explicit clear
      try { data.apiKeyEnc = encrypt(v); } catch (err: any) {
        return NextResponse.json({ error: `key encryption failed: ${err?.message || err}` }, { status: 500 });
      }
      continue;
    }
    if (k === "enabled" || k === "isDefault") { data[k] = v === true; continue; }
    data[k] = v;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no patchable fields supplied" }, { status: 400 });
  }

  // ≤1 default per kind
  if (data.isDefault === true) {
    await prisma.llmProviderConfig.updateMany({
      where: { kind: existing.kind, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.llmProviderConfig.update({ where: { id }, data: data as any });
  invalidateConfigCache();

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "system",
    action: "llm-providers.config.update",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "LlmProviderConfig",
    targetId: id,
    message: `Updated ${Object.keys(data).filter((k) => k !== "apiKeyEnc").join(", ") || "encrypted fields"}`,
    details: { fields: Object.keys(data) },
  });

  return NextResponse.json({ id: updated.id, updated: Object.keys(data) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await prisma.llmProviderConfig.delete({ where: { id } });
    invalidateConfigCache();
    const sessionUser = await getSessionUser().catch(() => null);
    void logEvent({
      category: "system",
      action: "llm-providers.config.delete",
      actor: sessionUser?.email || "anonymous",
      status: "ok",
      targetType: "LlmProviderConfig",
      targetId: id,
      message: "deleted",
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "P2025") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
