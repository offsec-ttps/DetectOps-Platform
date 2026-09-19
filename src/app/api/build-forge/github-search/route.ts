import { NextRequest, NextResponse } from "next/server";
import { getGitHubCredentials, githubRequest } from "@/lib/github";

/**
 * GET /api/build-forge/github-search?q=<query>&language=<go|rust|python>
 *
 * Searches public GitHub repositories matching a query.
 * Uses the configured GitHub token from Integrations if available,
 * otherwise falls back to unauthenticated (60 req/hr limit).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  const language = req.nextUrl.searchParams.get("language") || "";
  const perPage = Math.min(Number(req.nextUrl.searchParams.get("per_page") || 20), 30);

  // Build GitHub search query
  let searchQuery = q;
  if (language) searchQuery += ` language:${language}`;

  try {
    const creds = await getGitHubCredentials();
    let data: any;

    if (creds) {
      const res = await githubRequest(
        creds.token,
        "GET",
        `/search/repositories?q=${encodeURIComponent(searchQuery)}&per_page=${perPage}&sort=stars&order=desc`,
        undefined,
        creds.apiUrl
      );
      data = res.data;
    } else {
      // Unauthenticated fallback
      const res = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&per_page=${perPage}&sort=stars&order=desc`,
        { headers: { Accept: "application/vnd.github+v3+json", "User-Agent": "DetectOps/1.0" } }
      );
      data = await res.json();
    }

    const repos = (data.items || []).map((r: any) => ({
      full_name: r.full_name,
      owner: r.owner?.login || "",
      name: r.name,
      description: r.description || "",
      html_url: r.html_url,
      clone_url: r.clone_url,
      default_branch: r.default_branch || "main",
      language: (r.language || "").toLowerCase(),
      stars: r.stargazers_count || 0,
      visibility: r.private ? "private" : "public",
      avatar_url: r.owner?.avatar_url || "",
      topics: r.topics || [],
    }));

    return NextResponse.json({ total: data.total_count || 0, repos });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "GitHub search failed" }, { status: 502 });
  }
}
