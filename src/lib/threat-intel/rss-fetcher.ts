/**
 * RSS/Atom Feed Fetcher
 *
 * Fetches and parses RSS/Atom feeds using a lightweight XML parser.
 * Extracts articles with title, URL, date, author, and content.
 */

import https from "https";
import http from "http";
import { safeLookup, syncUrlBlockReason, type OutboundPolicy } from "@/lib/net/ssrf";

const FEED_POLICY: OutboundPolicy = { allowPrivate: false, allowLoopback: false };

export interface FeedArticle {
  title: string;
  url: string;
  author: string;
  publishedAt: string;
  content: string;
  summary: string;
  tags: string[];
}

export async function fetchRssFeed(feedUrl: string): Promise<FeedArticle[]> {
  const xml = await fetchUrl(feedUrl);
  if (!xml || xml.length < 50) return [];
  return parseRssFeed(xml, feedUrl);
}

const FEED_MAX_BYTES = 10 * 1024 * 1024;
const FEED_MAX_REDIRECTS = 5;

/**
 * Feed URLs can be user-added, so this is SSRF surface: public internet only
 * (no private/loopback/link-local/metadata), checked on every redirect hop and
 * on the IP actually connected to (safeLookup). Bounded size + redirect count.
 */
function fetchUrl(url: string, hops = 0): Promise<string> {
  return new Promise((resolve) => {
    if (hops > FEED_MAX_REDIRECTS || syncUrlBlockReason(url, FEED_POLICY)) { resolve(""); return; }
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {
          "User-Agent": "DetectOps-TI-Aggregator/1.0",
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
        rejectUnauthorized: false,
        timeout: 15000,
        lookup: safeLookup(FEED_POLICY) as any,
      },
      (res) => {
        // Follow redirects (bounded, each hop re-validated)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          let next = "";
          try { next = new URL(res.headers.location, url).toString(); } catch { resolve(""); return; }
          fetchUrl(next, hops + 1).then(resolve).catch(() => resolve(""));
          return;
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > FEED_MAX_BYTES) { res.destroy(); resolve(data.slice(0, FEED_MAX_BYTES)); }
        });
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", () => resolve(""));
    req.setTimeout(15000, () => { req.destroy(); resolve(""); });
    req.end();
  });
}

function parseRssFeed(xml: string, sourceUrl: string): FeedArticle[] {
  const articles: FeedArticle[] = [];

  // Try RSS 2.0 format
  const items = extractTags(xml, "item");
  if (items.length > 0) {
    for (const item of items) {
      articles.push({
        title: extractTagContent(item, "title") || "Untitled",
        url: extractTagContent(item, "link") || extractAttr(item, "link", "href") || sourceUrl,
        author: extractTagContent(item, "dc:creator") || extractTagContent(item, "author") || "",
        publishedAt: extractTagContent(item, "pubDate") || extractTagContent(item, "dc:date") || "",
        content: extractTagContent(item, "content:encoded") || extractTagContent(item, "description") || "",
        summary: stripHtml(extractTagContent(item, "description") || "").slice(0, 500),
        tags: extractAllTagContents(item, "category"),
      });
    }
    return articles;
  }

  // Try Atom format
  const entries = extractTags(xml, "entry");
  for (const entry of entries) {
    articles.push({
      title: extractTagContent(entry, "title") || "Untitled",
      url: extractAttr(entry, "link", "href") || extractTagContent(entry, "link") || sourceUrl,
      author: extractTagContent(entry, "name") || extractTagContent(entry, "author") || "",
      publishedAt: extractTagContent(entry, "published") || extractTagContent(entry, "updated") || "",
      content: extractTagContent(entry, "content") || extractTagContent(entry, "summary") || "",
      summary: stripHtml(extractTagContent(entry, "summary") || extractTagContent(entry, "content") || "").slice(0, 500),
      tags: extractAllTagContents(entry, "category").concat(
        extractAllAttrs(entry, "category", "term")
      ),
    });
  }

  return articles;
}

// ── XML helpers (lightweight, no dependency) ──

function extractTags(xml: string, tagName: string): string[] {
  const results: string[] = [];
  const openPattern = new RegExp(`<${tagName}[\\s>]`, "gi");
  const closeTag = `</${tagName}>`;
  let match;
  while ((match = openPattern.exec(xml)) !== null) {
    const closeIdx = xml.indexOf(closeTag, match.index);
    if (closeIdx > -1) {
      results.push(xml.slice(match.index, closeIdx + closeTag.length));
    }
  }
  return results;
}

function extractTagContent(xml: string, tagName: string): string {
  // Handle CDATA
  const cdataPattern = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tagName}>`, "i");
  const cdataMatch = xml.match(cdataPattern);
  if (cdataMatch) return cdataMatch[1].trim();

  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const m = xml.match(pattern);
  return m ? m[1].trim() : "";
}

function extractAllTagContents(xml: string, tagName: string): string[] {
  const results: string[] = [];
  const pattern = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "gi");
  let m;
  while ((m = pattern.exec(xml)) !== null) {
    if (m[1].trim()) results.push(m[1].trim());
  }
  return results;
}

function extractAttr(xml: string, tagName: string, attrName: string): string {
  const pattern = new RegExp(`<${tagName}[^>]*${attrName}="([^"]*)"`, "i");
  const m = xml.match(pattern);
  return m ? m[1] : "";
}

function extractAllAttrs(xml: string, tagName: string, attrName: string): string[] {
  const results: string[] = [];
  const pattern = new RegExp(`<${tagName}[^>]*${attrName}="([^"]*)"`, "gi");
  let m;
  while ((m = pattern.exec(xml)) !== null) {
    if (m[1].trim()) results.push(m[1].trim());
  }
  return results;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
