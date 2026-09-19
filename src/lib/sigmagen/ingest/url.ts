/**
 * URL ingestion — fetch a page and extract its main article text with
 * Mozilla Readability (the engine behind Firefox Reader View), which strips
 * nav/ads/boilerplate far better than a raw HTML→text pass.
 *
 * Safeguards: descriptive User-Agent, request timeout, response size cap,
 * content-type gating. PDF URLs are detected and handed to the PDF parser.
 * `robots.txt` is honoured by the auto-crawler in retrieve.ts; a URL the user
 * pasted directly is treated as explicit intent and fetched as-is.
 */

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { type NormalizedInput, type NormalizedReference, MAX_TEXT_CHARS } from "./types";
import { extractIocs } from "./ioc";
import { normalizePdf } from "./pdf";
import { assertPublicHttpUrl } from "@/lib/net/ssrf";

const USER_AGENT =
  "DetectionPlatform-SigmaGen/1.0 (+threat-intel ingestion; respects robots.txt)";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB
const MAX_REDIRECTS = 5;
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/pdf,text/plain,*/*",
};

/**
 * SSRF-safe fetch: re-validates the host against the SSRF guard on the initial
 * request AND on every redirect hop (`redirect: "manual"`). A public URL that
 * 30x-redirects to 169.254.169.254 / localhost / RFC1918 is therefore caught
 * before we connect to the internal address. Returns the response plus the
 * final (post-redirect) URL.
 */
async function ssrfSafeFetch(initialUrl: string, signal: AbortSignal): Promise<{ res: Response; finalUrl: string }> {
  let current = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const guard = await assertPublicHttpUrl(current);
    if (!guard.ok) throw new Error(`Blocked URL (${guard.error}): ${current}`);
    const res = await fetch(current, { signal, redirect: "manual", headers: FETCH_HEADERS });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: current };
      try { current = new URL(loc, current).toString(); }
      catch { throw new Error(`Invalid redirect target from ${current}`); }
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error(`Too many redirects for ${initialUrl}`);
}

export interface FetchedDoc {
  title: string;
  text: string;
  links: NormalizedReference[];
  contentType: string;
  finalUrl: string;
}

/** Low-level fetch + extract. Throws on network / size / type failures. */
export async function fetchAndExtract(url: string): Promise<FetchedDoc> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  let finalUrl: string;
  try {
    ({ res, finalUrl } = await ssrfSafeFetch(url, controller.signal));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Fetch failed (${res.status} ${res.statusText}) for ${url}`);
  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  // Size guard
  const lenHeader = Number(res.headers.get("content-length") || 0);
  if (lenHeader && lenHeader > MAX_BYTES) throw new Error(`Resource too large (${lenHeader} bytes) for ${url}`);

  if (contentType.includes("application/pdf") || /\.pdf($|\?)/i.test(finalUrl)) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error(`PDF too large for ${url}`);
    const pdf = await normalizePdf(buf, finalUrl.split("/").pop() || "remote.pdf");
    return { title: pdf.title, text: pdf.text, links: [], contentType, finalUrl };
  }

  const raw = await res.text();
  if (raw.length > MAX_BYTES) throw new Error(`Response body too large for ${url}`);

  if (contentType.includes("text/plain")) {
    return { title: finalUrl, text: raw.slice(0, MAX_TEXT_CHARS), links: [], contentType, finalUrl };
  }

  // HTML → Readability
  const dom = new JSDOM(raw, { url: finalUrl });
  const doc = dom.window.document;

  // Collect outbound links before Readability mutates the DOM.
  const links: NormalizedReference[] = [];
  const seen = new Set<string>();
  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = (a.getAttribute("href") || "").trim();
    if (!/^https?:\/\//i.test(href) || seen.has(href)) return;
    seen.add(href);
    if (links.length < 40) links.push({ title: (a.textContent || href).trim().slice(0, 120), url: href, type: "other" });
  });

  let title = doc.title || finalUrl;
  let text = "";
  try {
    const article = new Readability(doc).parse();
    if (article) {
      title = article.title || title;
      text = article.textContent || "";
    }
  } catch { /* fall through to body text */ }
  if (!text.trim()) text = doc.body?.textContent || "";

  return {
    title: title.trim().slice(0, 160),
    text: text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT_CHARS),
    links,
    contentType,
    finalUrl,
  };
}

export async function normalizeUrl(url: string): Promise<NormalizedInput> {
  const doc = await fetchAndExtract(url);
  const iocs = extractIocs(doc.text);
  // The source URL itself is the primary reference; discovered links follow.
  const references: NormalizedReference[] = [
    { title: doc.title || doc.finalUrl, url: doc.finalUrl, type: "report" },
    ...doc.links,
  ].slice(0, 40);

  return {
    kind: "url",
    title: doc.title || doc.finalUrl,
    text: doc.text,
    charCount: doc.text.length,
    iocs,
    references,
    meta: { sourceUrl: doc.finalUrl, contentType: doc.contentType, linkCount: doc.links.length },
  };
}
