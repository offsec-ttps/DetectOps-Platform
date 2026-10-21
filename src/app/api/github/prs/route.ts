import { NextRequest, NextResponse } from "next/server";
import {
  getGitHubCredentials,
  listPullRequests,
  getPRReviews,
  mergePR,
  githubRequest,
} from "@/lib/github";
import { requireRole, requireUser } from "@/lib/auth-guard";
import { isSafeSegment } from "@/lib/build-forge/validate";

/** GET — list PRs from configured GitHub repo */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const owner = searchParams.get("owner") || "";
  const repo = searchParams.get("repo") || "detection-reports";
  const state = (searchParams.get("state") || "all") as "open" | "closed" | "all";
  if ((owner && !isSafeSegment(owner)) || !isSafeSegment(repo)) {
    return NextResponse.json({ error: "invalid owner / repo", items: [] }, { status: 400 });
  }

  const creds = await getGitHubCredentials();
  if (!creds) {
    return NextResponse.json({ error: "GitHub integration not configured", items: [] });
  }

  if (!owner) {
    // Try to get the authenticated user
    const userRes = await githubRequest(creds.token, "GET", "/user");
    if (userRes.status !== 200) {
      return NextResponse.json({ error: "Cannot determine GitHub owner", items: [] });
    }
    return NextResponse.json({
      items: await listPullRequests(creds.token, userRes.data.login, repo, state),
      owner: userRes.data.login,
    });
  }

  const prs = await listPullRequests(creds.token, owner, repo, state);

  // Enrich with reviews
  const enriched = await Promise.all(
    prs.map(async (pr: any) => {
      const reviews = await getPRReviews(creds.token, owner, repo, pr.number);
      const approved = reviews.some((r: any) => r.state === "APPROVED");
      const changesRequested = reviews.some((r: any) => r.state === "CHANGES_REQUESTED");
      const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        draft: pr.draft,
        merged: pr.merged_at !== null,
        mergeable: pr.mergeable,
        url: pr.html_url,
        branch: pr.head?.ref,
        baseBranch: pr.base?.ref,
        author: pr.user?.login,
        authorAvatar: pr.user?.avatar_url,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        mergedAt: pr.merged_at,
        closedAt: pr.closed_at,
        labels: (pr.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
        reviewCount: reviews.length,
        approved,
        changesRequested,
        latestReviewState: latestReview?.state || null,
        latestReviewUser: latestReview?.user?.login || null,
        latestReviewBody: latestReview?.body || null,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
      };
    })
  );

  return NextResponse.json({ items: enriched, owner, repo });
}

/** POST — merge or review a PR */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { owner, repo, action } = body;
  const prNumber = Number(body.prNumber);

  // Merging with the platform's GitHub token is a privileged action.
  const auth = action === "merge" ? await requireRole("admin") : await requireUser();
  if (!auth.ok) return auth.response;

  const creds = await getGitHubCredentials();
  if (!creds) return NextResponse.json({ error: "GitHub not configured" }, { status: 400 });
  if (!owner || !repo || !prNumber) return NextResponse.json({ error: "owner, repo, prNumber required" }, { status: 400 });
  // Interpolated into GitHub API paths with the server token.
  if (!isSafeSegment(owner) || !isSafeSegment(repo) || !Number.isInteger(prNumber) || prNumber <= 0) {
    return NextResponse.json({ error: "invalid owner / repo / prNumber" }, { status: 400 });
  }

  if (action === "merge") {
    const result = await mergePR(creds.token, owner, repo, prNumber, "squash");
    return NextResponse.json(result);
  }

  if (action === "approve") {
    const result = await githubRequest(creds.token, "POST", `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      event: "APPROVE",
      body: "Reviewed and approved via DetectOps.",
    });
    return NextResponse.json({ success: result.status === 200, message: result.data?.message || "Approved" });
  }

  if (action === "request_changes") {
    const result = await githubRequest(creds.token, "POST", `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      event: "REQUEST_CHANGES",
      body: body.reviewComment || "Changes requested via DetectOps.",
    });
    return NextResponse.json({ success: result.status === 200, message: result.data?.message || "Changes requested" });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
