/**
 * POST /api/use-cases/ai/atomic-test
 *
 * Body: { prompt, technique?, platforms?, context?, model? }
 * Returns: { yaml, expectedSignal, model, inputTokens, outputTokens, costUsd, generationId }
 *
 * Used by the AtomicBuilder AI assistant to pre-fill the form. Does NOT persist
 * a UseCase — the user is still editing.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateAtomicFromPrompt } from "@/lib/llm/generators/atomic-from-prompt";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt || "").trim();
  if (!prompt || prompt.length < 5) {
    return NextResponse.json({ error: "prompt is required (min 5 chars)" }, { status: 400 });
  }
  const technique = body.technique ? String(body.technique).trim() : undefined;
  if (technique && !/^T\d{4}(\.\d{3})?$/i.test(technique)) {
    return NextResponse.json({ error: "technique must look like T#### or T####.###" }, { status: 400 });
  }
  const platforms = Array.isArray(body.platforms) ? body.platforms.map(String) : undefined;
  const context = typeof body.context === "string" ? body.context : undefined;
  const model = typeof body.model === "string" ? body.model : undefined;

  const sessionUser = await getSessionUser().catch(() => null);

  try {
    const result = await generateAtomicFromPrompt({
      actor: sessionUser?.email || "anonymous",
      inputRefId: sessionUser?.id || "anonymous",
      prompt, technique, platforms, context, model,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const code = err?.code === "missing_api_key" ? 503 : 500;
    return NextResponse.json({ error: err?.message || String(err), code: err?.code || null }, { status: code });
  }
}
