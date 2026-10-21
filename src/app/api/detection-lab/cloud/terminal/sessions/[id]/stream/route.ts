/**
 * GET /api/detection-lab/cloud/terminal/sessions/[id]/stream
 *
 * Server-Sent Events (SSE) stream of process output.
 * Replays buffered history on connect, then streams live events until
 * the client disconnects or the session exits.
 */

import { NextRequest } from "next/server";
import { getSession, subscribe, unsubscribe, canAccessSession } from "@/lib/terminal-sessions";
import { requireUser } from "@/lib/auth-guard";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!canAccessSession(id, auth.user)) return new Response("session not found", { status: 404 });
  const session = getSession(id);
  if (!session) {
    return new Response("session not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const subId = randomBytes(6).toString("hex");

  const stream = new ReadableStream({
    start(controller) {
      const send = (ev: { type: string; [k: string]: unknown }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch { /* already closed */ }
      };

      // Keep-alive ping so proxies don't close the connection
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); }
        catch { clearInterval(keepalive); }
      }, 20_000);

      subscribe(id, { id: subId, send: (ev) => send(ev) });

      // When the underlying process exits, we keep the stream alive briefly so
      // the client can render the exit banner, then close.
      const exitWatch = setInterval(() => {
        if (session.exited) {
          clearInterval(exitWatch);
          clearInterval(keepalive);
          setTimeout(() => {
            try { controller.close(); } catch { /* ignore */ }
          }, 500);
        }
      }, 500);
    },
    cancel() {
      unsubscribe(id, subId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
