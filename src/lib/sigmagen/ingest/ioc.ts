/**
 * IOC extractor — pulls indicators out of any text blob.
 *
 * Handles common defanging (hxxp, [.], (.), [at]) so indicators copied from
 * threat reports are recognised. De-dupes and caps each bucket so a noisy
 * report can't blow up the downstream prompt.
 */

import { type ExtractedIocs, emptyIocs } from "./types";

const CAP_PER_BUCKET = 200;

/** Undo common defanging so regexes match real indicators. */
export function refang(input: string): string {
  return input
    .replace(/h[xX]{2}ps?:\/\//gi, (m) => (m.toLowerCase().includes("s") ? "https://" : "http://"))
    .replace(/\[\.\]|\(\.\)|\{\.\}/g, ".")
    .replace(/\[:\]/g, ":")
    .replace(/\[at\]|\(at\)|\s+at\s+(?=[\w.-]+\.[a-z]{2,})/gi, "@")
    .replace(/\[dot\]|\(dot\)/gi, ".");
}

const RE = {
  // Order matters: sha256 before sha1 before md5 (longest first).
  sha256: /\b[a-fA-F0-9]{64}\b/g,
  sha1: /\b[a-fA-F0-9]{40}\b/g,
  md5: /\b[a-fA-F0-9]{32}\b/g,
  cve: /\bCVE-\d{4}-\d{4,7}\b/gi,
  email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  url: /\bhttps?:\/\/[^\s<>"')\]]+/gi,
  ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g,
  ipv6: /\b(?:[a-fA-F0-9]{1,4}:){2,7}[a-fA-F0-9]{0,4}\b/g,
  domain: /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,24}\b/g,
};

// Domains that are almost always noise (vendor/report hosts), not IOCs.
const DOMAIN_NOISE = /\b(?:github\.com|microsoft\.com|mitre\.org|virustotal\.com|twitter\.com|x\.com|google\.com|wikipedia\.org|schema\.org|w3\.org|example\.com)$/i;

// File extensions that the broad domain regex misreads as TLDs (e.g. "ngrok.exe").
const FILE_EXT_TLD = /\.(?:exe|dll|ps1|bat|cmd|vbs|js|jse|hta|scr|sys|tmp|dat|bin|doc|docx|xls|xlsx|ppt|pptx|pdf|zip|rar|7z|gz|tar|lnk|iso|img|msi|jar|py|sh|php|asp|aspx|jsp|html?|txt|log|conf|ini|yaml|yml|json|xml)$/i;

/** Strip trailing punctuation a greedy match drags in (e.g. "url," or "domain)."). */
function trimTrailing(s: string): string {
  return s.replace(/[.,;:!?)\]}'"<>]+$/, "");
}

function dedupeCap(matches: string[] | null, lower = true): string[] {
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const v = lower ? raw.toLowerCase() : raw;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= CAP_PER_BUCKET) break;
  }
  return out;
}

export function extractIocs(rawText: string): ExtractedIocs {
  const out = emptyIocs();
  if (!rawText) return out;
  const text = refang(rawText);

  out.sha256 = dedupeCap(text.match(RE.sha256));
  // Exclude sha256/sha1 substrings from md5/sha1 buckets by removing hashes already captured.
  const sha256Set = new Set(out.sha256);
  out.sha1 = dedupeCap(text.match(RE.sha1)).filter((h) => !sha256Set.has(h));
  const sha1Set = new Set(out.sha1);
  out.md5 = dedupeCap(text.match(RE.md5)).filter((h) => !sha256Set.has(h) && !sha1Set.has(h));

  out.cve = dedupeCap(text.match(RE.cve));
  out.email = dedupeCap(text.match(RE.email));
  out.url = dedupeCap((text.match(RE.url) || []).map(trimTrailing), false);
  out.ipv4 = dedupeCap(text.match(RE.ipv4));
  // ipv6 regex is greedy/noisy — require at least two colons and a hex group already enforced.
  out.ipv6 = dedupeCap(text.match(RE.ipv6)).filter((v) => v.includes("::") || v.split(":").length >= 4);

  // Domains: drop ones that are part of an extracted email or URL host, plus known noise.
  const emailHosts = new Set(out.email.map((e) => e.split("@")[1]).filter(Boolean));
  out.domain = dedupeCap(text.match(RE.domain)).filter(
    (d) => !DOMAIN_NOISE.test(d) && !emailHosts.has(d) && !FILE_EXT_TLD.test(d),
  );

  return out;
}

/** A flat one-line summary for digests / logging. */
export function summariseIocs(i: ExtractedIocs): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(i)) if (v.length) parts.push(`${k}: ${v.length}`);
  return parts.length ? parts.join(", ") : "none";
}
