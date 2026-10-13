/**
 * POST /api/ti-watcher/scan — run one TI → Simulation-Library watcher scan now.
 * GET  /api/ti-watcher/scan — last run + pending-contribution counts.
 *
 * AuthZ: a reviewer (admin) session, OR a bearer token matching WATCHER_TOKEN
 * (for the optional GitHub Action cron on deployed instances). A scan both
 * creates DB rows and can spend LLM tokens, so it is admin-gated rather than
 * open to any authenticated user. GET (read-only status) needs only a session.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { runWatcherScan } from "@/lib/ti-watcher/scan";

export const maxDuration = 300;

async function authorize(req: NextRequest): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const token = process.env.WATCHER_TOKEN;
  if (token) {
    const hdr = req.headers.get("authorization") || "";
    if (hdr === `Bearer ${token}`) return { ok: true };
  }
  const auth = await requireRole("admin");
  if (auth.ok) return { ok: true };
  return { ok: false, response: auth.response };
}

export async function POST(req: NextRequest) {
  const authed = await authorize(req);
  if (!authed.ok) return authed.response;
  const body = await req.json().catch(() => ({} as any));
  const since = body?.since ? new Date(body.since) : undefined;
  const cap = typeof body?.cap === "number" ? body.cap : undefined;
  try {
    const result = await runWatcherScan({ since, cap });
    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const busy = msg.includes("already running");
    return NextResponse.json({ ok: false, error: msg }, { status: busy ? 409 : 500 });
  }
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const [lastRun, pending, unrouted] = await Promise.all([
    prisma.simWatcherRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.simLibraryContribution.count({ where: { status: "pending" } }),
    prisma.simLibraryContribution.count({ where: { status: "unrouted" } }),
  ]);
  return NextResponse.json({ lastRun, counts: { pending, unrouted } });
}
