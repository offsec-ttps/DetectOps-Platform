/**
 * Related-intel retrieval (self-hosted).
 *
 * Given a normalized input, pull additional context the intel-extract agent can
 * use, from three sources, each best-effort and individually fault-tolerant:
 *
 *   (a) Reference-follow — fetch the most relevant outbound links discovered in
 *       the source (honouring robots.txt + a per-host rate limit + caps).
 *   (b) Platform feeds — keyword-match the platform's own ingested TI
 *       (ThreatIntelReport + TiArticle). No network; reuses existing data.
 *   (c) Web search — OPTIONAL. Enabled only when SIGMAGEN_SEARCH_PROVIDER +
 *       the matching API key env are set (Brave / SearXNG). Falls back to (a)+(b).
 *
 * Total fetched docs and chars are capped so a noisy source can't blow up cost.
 */

import { prisma } from "@/lib/prisma";
import { fetchAndExtract } from "./url";
import { assertPublicHttpUrl } from "@/lib/net/ssrf";
import { type NormalizedInput, type NormalizedReference } from "./types";

const MAX_FOLLOW = 3;            // outbound links to fetch
const MAX_SEARCH = 3;            // web-search results to fetch
const MAX_FEED_HITS = 4;         // local TI matches
const EXCERPT_CHARS = 1800;
const PER_HOST_MIN_GAP_MS = 1200;

export interface RelatedDoc { title: string; url: string; excerpt: string; }
export interface RetrieveResult { docs: RelatedDoc[]; references: NormalizedReference[]; }

const lastHostFetch = new Map<string, number>();

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ""; }
}

async function rateLimit(host: string) {
  const last = lastHostFetch.get(host) || 0;
  const wait = PER_HOST_MIN_GAP_MS - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHostFetch.set(host, Date.now());
}

/** Best-effort robots.txt check — disallow only when an explicit rule blocks our UA path. */
async function allowedByRobots(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const robotsUrl = `${u.origin}/robots.txt`;
    // Same SSRF guard as the page fetch — don't let an attacker-supplied link
    // point robots.txt resolution at an internal/metadata address.
    const guard = await assertPublicHttpUrl(robotsUrl);
    if (!guard.ok) return false;
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    if (!res.ok) return true; // no robots → allowed
    const body = await res.text();
    // Parse the `*` user-agent group's Disallow rules (simplified).
    const lines = body.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
    let inStar = false;
    const disallows: string[] = [];
    for (const line of lines) {
      const [rawK, ...rest] = line.split(":");
      if (!rawK) continue;
      const k = rawK.toLowerCase().trim();
      const v = rest.join(":").trim();
      if (k === "user-agent") inStar = v === "*";
      else if (inStar && k === "disallow" && v) disallows.push(v);
    }
    return !disallows.some((d) => u.pathname.startsWith(d));
  } catch {
    return true; // robots unreachable → don't block
  }
}

function keyTerms(input: NormalizedInput): string[] {
  const text = `${input.title} ${input.text.slice(0, 4000)}`.toLowerCase();
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "are", "was", "has", "have", "which", "their", "été"]);
  const counts = new Map<string, number>();
  for (const tok of text.replace(/[^a-z0-9._-]+/g, " ").split(/\s+/)) {
    if (tok.length < 4 || stop.has(tok) || /^\d+$/.test(tok)) continue;
    counts.set(tok, (counts.get(tok) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
}

// ─── (a) reference follow ────────────────────────────────────────────────────

async function followReferences(input: NormalizedInput): Promise<RelatedDoc[]> {
  const sourceHost = hostOf((input.meta?.sourceUrl as string) || "");
  // Prefer cross-domain report/blog/advisory links over same-site nav.
  const candidates = input.references
    .filter((r) => /^https?:\/\//i.test(r.url))
    .filter((r) => hostOf(r.url) !== sourceHost)
    .slice(0, 12);

  const out: RelatedDoc[] = [];
  for (const ref of candidates) {
    if (out.length >= MAX_FOLLOW) break;
    const host = hostOf(ref.url);
    if (!host) continue;
    if (!(await allowedByRobots(ref.url))) continue;
    await rateLimit(host);
    try {
      const doc = await fetchAndExtract(ref.url);
      if (doc.text.trim().length > 200) out.push({ title: doc.title, url: doc.finalUrl, excerpt: doc.text.slice(0, EXCERPT_CHARS) });
    } catch { /* skip unreachable */ }
  }
  return out;
}

// ─── (b) platform feeds ──────────────────────────────────────────────────────

async function searchPlatformFeeds(terms: string[]): Promise<RelatedDoc[]> {
  if (!terms.length) return [];
  const out: RelatedDoc[] = [];

  // Match ingested reports by title/summary/actor overlap (SQLite has no full-text;
  // OR a handful of contains() on the top terms).
  const orTerms = terms.slice(0, 5);
  try {
    const reports = await prisma.threatIntelReport.findMany({
      where: { OR: orTerms.flatMap((t) => [{ title: { contains: t } }, { summary: { contains: t } }, { threatActor: { contains: t } }]) },
      orderBy: { syncedAt: "desc" },
      take: MAX_FEED_HITS,
      select: { title: true, summary: true, sourceUrl: true, threatActor: true },
    });
    for (const r of reports) {
      out.push({
        title: `[platform TI] ${r.title}`,
        url: r.sourceUrl || "",
        excerpt: `${r.threatActor ? `Actor: ${r.threatActor}. ` : ""}${r.summary || ""}`.slice(0, EXCERPT_CHARS),
      });
    }
  } catch { /* table may be empty */ }

  if (out.length < MAX_FEED_HITS) {
    try {
      const articles = await prisma.tiArticle.findMany({
        where: { OR: orTerms.flatMap((t) => [{ title: { contains: t } }, { summary: { contains: t } }]) },
        orderBy: { publishedAt: "desc" },
        take: MAX_FEED_HITS - out.length,
        select: { title: true, summary: true, rawContent: true, url: true },
      });
      for (const a of articles) {
        out.push({ title: `[platform feed] ${a.title}`, url: a.url, excerpt: (a.summary || a.rawContent || "").slice(0, EXCERPT_CHARS) });
      }
    } catch { /* table may be empty */ }
  }
  return out;
}

// ─── (c) optional web search ─────────────────────────────────────────────────

interface SearchHit { title: string; url: string; }

async function webSearch(terms: string[]): Promise<SearchHit[]> {
  const providerName = process.env.SIGMAGEN_SEARCH_PROVIDER;
  if (!providerName || !terms.length) return [];
  const query = terms.slice(0, 5).join(" ") + " threat intelligence detection";

  try {
    if (providerName === "brave") {
      const key = process.env.BRAVE_SEARCH_API_KEY;
      if (!key) return [];
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_SEARCH}`, {
        headers: { "X-Subscription-Token": key, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data: any = await res.json();
      return (data.web?.results || []).slice(0, MAX_SEARCH).map((r: any) => ({ title: r.title, url: r.url }));
    }
    if (providerName === "searxng") {
      const base = process.env.SEARXNG_URL;
      if (!base) return [];
      const res = await fetch(`${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data: any = await res.json();
      return (data.results || []).slice(0, MAX_SEARCH).map((r: any) => ({ title: r.title, url: r.url }));
    }
  } catch { /* search failed → fall back */ }
  return [];
}

async function fetchSearchHits(hits: SearchHit[]): Promise<RelatedDoc[]> {
  const out: RelatedDoc[] = [];
  for (const hit of hits) {
    if (out.length >= MAX_SEARCH) break;
    const host = hostOf(hit.url);
    if (!host || !(await allowedByRobots(hit.url))) continue;
    await rateLimit(host);
    try {
      const doc = await fetchAndExtract(hit.url);
      if (doc.text.trim().length > 200) out.push({ title: doc.title || hit.title, url: doc.finalUrl, excerpt: doc.text.slice(0, EXCERPT_CHARS) });
    } catch { /* skip */ }
  }
  return out;
}

// ─── orchestrator ────────────────────────────────────────────────────────────

export async function retrieveRelated(input: NormalizedInput): Promise<RetrieveResult> {
  const terms = keyTerms(input);

  const [followed, feeds, searchHits] = await Promise.all([
    followReferences(input).catch(() => []),
    searchPlatformFeeds(terms).catch(() => []),
    webSearch(terms).catch(() => []),
  ]);
  const fromSearch = await fetchSearchHits(searchHits).catch(() => []);

  // De-dupe by URL, cap total.
  const seen = new Set<string>();
  const docs: RelatedDoc[] = [];
  for (const d of [...followed, ...fromSearch, ...feeds]) {
    const key = d.url || d.title;
    if (seen.has(key)) continue;
    seen.add(key);
    docs.push(d);
    if (docs.length >= MAX_FOLLOW + MAX_SEARCH + MAX_FEED_HITS) break;
  }

  const references: NormalizedReference[] = docs
    .filter((d) => /^https?:\/\//i.test(d.url))
    .map((d) => ({ title: d.title, url: d.url, type: "blog" }));

  return { docs, references };
}
