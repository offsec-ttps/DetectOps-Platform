/**
 * POST /api/detection-packs/[id]/github-push
 *
 * Body: {
 *   repo: "owner/repo",
 *   token?: string,              // overrides GITHUB_TOKEN env
 *   labels?: string[],            // overrides status-derived defaults
 *   updateIfExists?: boolean     // default true; false to always create new
 * }
 *
 * Returns:
 *   { action: "created"|"commented", issueUrl, issueNumber }
 *
 * Errors:
 *   400 — bad repo / missing repo
 *   404 — pack not found
 *   503 — missing GitHub token (env + body both empty)
 *   500 — GitHub API failure
 */

import { NextRequest, NextResponse } from "next/server";
import { pushPackToGithub } from "@/lib/detection-packs/github-export";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const repo = String(body.repo || "").trim();
  if (!repo) {
    return NextResponse.json({ error: "repo is required (owner/repo format)" }, { status: 400 });
  }
  const labels = Array.isArray(body.labels) ? body.labels.map(String).slice(0, 12) : undefined;
  const token = typeof body.token === "string" && body.token ? body.token : undefined;
  const updateIfExists = body.updateIfExists !== false;
  const sessionUser = await getSessionUser().catch(() => null);

  try {
    const result = await pushPackToGithub(id, {
      repo, token, labels, updateIfExists,
      actor: sessionUser?.email || "anonymous",
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const code = err?.code as string | undefined;
    const status = code === "missing_token" ? 503
                 : code === "bad_repo" ? 400
                 : code === "not_found" ? 404
                 : 500;
    return NextResponse.json({ error: err?.message || String(err), code }, { status });
  }
}
