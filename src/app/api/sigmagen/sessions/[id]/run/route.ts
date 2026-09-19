/**
 * POST /api/sigmagen/sessions/[id]/run
 *
 * Ingest an input (multipart file OR JSON {url|text|kind}), append a user
 * message + an assistant placeholder, create a SigmaGenRun, and kick off the
 * multi-agent pipeline in the background. Returns { runId } immediately; the
 * client polls GET /api/sigmagen/runs/[runId] for progress.
 *
 * Body (JSON): { url?, text?, kind?, provider?, enableRetrieval? }
 * Body (multipart): file=<File>, provider?, enableRetrieval?
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { assertPublicHttpUrl } from "@/lib/net/ssrf";
import { normalizeInput, iocCount, type IngestRequest } from "@/lib/sigmagen/ingest";
import { runSigmaGenPipeline } from "@/lib/sigmagen/pipeline";
import { PROVIDERS, type ProviderId } from "@/lib/llm";
import { smartDefaultProvider } from "@/lib/llm/providers/registry";
import { listConfiguredKinds } from "@/lib/llm/db-config";
import { wouldExceedBudget } from "@/lib/detection-packs/budget";

const VALID_PROVIDERS = new Set(["anthropic", "openai", "openrouter", "nvidia", "ollama"]);
const REMOTE_PROVIDERS: ProviderId[] = ["anthropic", "openai", "openrouter", "nvidia"];
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** A SigmaGen run chains intel + map + use-case + detection + IRP — reserve ~4x a single pack job. */
function snapshotEstimate(): number {
  const perJob = parseInt(process.env.DETECTION_PACK_PER_JOB_ESTIMATE || "8000", 10) || 8000;
  return perJob * 4;
}

/**
 * Decide whether the LLM provider that will actually run is usable, and return
 * a clear error if not. `anyProviderConfigured()` is unreliable here because
 * Ollama always reports configured — so when the effective provider resolves
 * to Ollama (i.e. no cloud key is set), verify the local daemon is reachable
 * instead of letting the pipeline fail later with a cryptic "fetch failed".
 */
async function providerReadiness(explicit?: ProviderId): Promise<{ ok: true } | { ok: false; error: string }> {
  const dbKinds = await listConfiguredKinds().catch(() => new Set<string>());
  const hasRemote = REMOTE_PROVIDERS.some((id) => PROVIDERS[id].isConfigured() || dbKinds.has(id));
  const effective = explicit || (await smartDefaultProvider());

  if (effective !== "ollama") return { ok: true };

  // Effective provider is Ollama. If the user didn't explicitly pick it and no
  // cloud key exists, this is the silent-fallback case — verify it's actually up.
  const host = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
  const up = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok).catch(() => false);
  if (up) return { ok: true };

  return {
    ok: false,
    error: hasRemote
      ? `Selected provider "ollama" is not reachable at ${host}. Start Ollama, or choose a configured cloud provider.`
      : `No LLM provider is ready. ANTHROPIC_API_KEY (and other cloud keys) are unset, and the local Ollama fallback at ${host} is not reachable. Set a key in .env (then restart the dev server) or add one at /settings/llm-providers.`,
  };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: sessionId } = await ctx.params;

  const session = await prisma.sigmaGenSession.findUnique({ where: { id: sessionId } });
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  // Ownership (IDOR guard) when enforcing — 404 to avoid leaking existence.
  if (auth.enforced && session.createdBy && session.createdBy !== auth.user.email) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // Parse input (multipart or JSON)
  let ingestReq: IngestRequest;
  let provider: ProviderId | undefined;
  let enableRetrieval = true;
  try {
    const ctype = (req.headers.get("content-type") || "").toLowerCase();
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "No file in form field 'file'." }, { status: 400 });
      if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File too large (max 12 MB)." }, { status: 413 });
      ingestReq = { fileBuffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type };
      const p = String(form.get("provider") || "");
      if (VALID_PROVIDERS.has(p)) provider = p as ProviderId;
      enableRetrieval = String(form.get("enableRetrieval") || "true") !== "false";
    } else {
      const body = await req.json().catch(() => ({}));
      ingestReq = { kind: body.kind, url: typeof body.url === "string" ? body.url : undefined, text: typeof body.text === "string" ? body.text : undefined };
      if (typeof body.provider === "string" && VALID_PROVIDERS.has(body.provider)) provider = body.provider;
      enableRetrieval = body.enableRetrieval !== false;
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "bad request" }, { status: 400 });
  }

  // SSRF guard: validate any user-supplied URL before the server fetches it.
  if (ingestReq.url) {
    const check = await assertPublicHttpUrl(ingestReq.url);
    if (!check.ok) return NextResponse.json({ error: `URL rejected: ${check.error}`, code: "ssrf-blocked" }, { status: 400 });
    ingestReq.url = check.url;
  }

  // Provider readiness — fail fast with a clear message rather than a cryptic
  // "fetch failed" run when no usable LLM provider is available.
  const readiness = await providerReadiness(provider);
  if (!readiness.ok) {
    return NextResponse.json({ error: readiness.error, code: "provider-unavailable" }, { status: 503 });
  }

  // Daily token-budget guard (shared with the detection-pack pipeline; SigmaGen
  // runs are estimated heavier since they chain several agents).
  const { exceed, snapshot } = await wouldExceedBudget(snapshotEstimate()).catch(() => ({ exceed: false, snapshot: null as any }));
  if (exceed) {
    return NextResponse.json(
      { error: `Daily LLM token budget reached (${snapshot.usedTokens}/${snapshot.budget}). Resets at ${snapshot.resetsAt}.`, code: "budget-exceeded" },
      { status: 429 },
    );
  }

  // Ingest synchronously so parse errors surface to the user immediately.
  let norm;
  try {
    norm = await normalizeInput(ingestReq);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "ingestion failed" }, { status: 400 });
  }

  const actor = auth.user.email;

  // User message: a concise description of what was submitted.
  const userContent =
    norm.kind === "url" ? `Analyse: ${(norm.meta?.sourceUrl as string) || norm.title}`
    : norm.kind === "pdf" || norm.kind === "docx" ? `Analyse uploaded ${norm.kind.toUpperCase()}: ${norm.title}`
    : norm.kind === "ioc" ? `Analyse ${iocCount(norm.iocs)} IOC(s)`
    : `Analyse: ${norm.title}`;

  await prisma.sigmaGenMessage.create({
    data: { sessionId, role: "user", content: userContent.slice(0, 2000), inputKind: norm.kind, attachmentName: (norm.meta?.fileName as string) || "" },
  });

  const run = await prisma.sigmaGenRun.create({
    data: { sessionId, status: "queued", inputKind: norm.kind, inputTitle: norm.title.slice(0, 240) },
  });

  await prisma.sigmaGenMessage.create({
    data: { sessionId, role: "assistant", content: "Running multi-agent pipeline…", inputKind: norm.kind, runId: run.id },
  });

  // Keep the session title fresh + bump updatedAt.
  await prisma.sigmaGenSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date(), ...(session.title === "Untitled session" ? { title: norm.title.slice(0, 200) } : {}) },
  });

  // Fire the pipeline in the background (long-running Node server). The pipeline
  // persists its own success/failure state; we just log if the promise rejects.
  void runSigmaGenPipeline({ runId: run.id, normalizedInput: norm, provider, enableRetrieval, actor })
    .catch((err) => { console.error(`[sigmagen] pipeline failed for run ${run.id}:`, err?.message || err); });

  return NextResponse.json({ runId: run.id, sessionId }, { status: 202 });
}
