/**
 * Reference extractor.
 *
 * Pulls URLs from a TI report or community rule and tags them with a type
 * (report / blog / advisory / community / vendor / other) based on host
 * heuristics. The LLM gets the deduped list as seed references; it may add
 * MITRE technique URLs etc. in the emitted pack.
 */

export type ReferenceType = "report" | "blog" | "advisory" | "community" | "vendor" | "other";

export interface ReferenceItem {
  title: string;
  url: string;
  type: ReferenceType;
}

const URL_RE = /\bhttps?:\/\/[^\s<>'"]+/gi;

const TYPE_PATTERNS: Array<[ReferenceType, RegExp]> = [
  ["advisory",  /cisa\.gov|cve\.mitre\.org|nvd\.nist|us-cert|securityadvisories|psirt|kb\.cert\.org/i],
  ["vendor",    /microsoft\.com|cloud\.google\.com|aws\.amazon\.com|crowdstrike\.com|mandiant\.com|fireeye\.com|paloaltonetworks\.com|sentinelone\.com|cisco\.com|fortinet\.com/i],
  ["report",    /talosintelligence\.com|trendmicro\.com|kaspersky\.com|checkpoint\.com|virustotal|recorded ?future|flashpoint/i],
  ["community", /github\.com|sigmahq|attack\.mitre\.org|otx\.alienvault|reddit\.com|stackexchange/i],
  ["blog",      /\.medium\.com|substack|hashnode|wordpress|blogspot|krebsonsecurity|isc\.sans|0patch/i],
];

export function extractReferences(...sources: Array<string | null | undefined>): ReferenceItem[] {
  const seen = new Set<string>();
  const out: ReferenceItem[] = [];
  for (const s of sources) {
    if (!s) continue;
    const matches = s.match(URL_RE) || [];
    for (const raw of matches) {
      // Strip trailing punctuation that often clings to URLs in prose
      const url = raw.replace(/[.,;:)\]>'"]+$/, "");
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({
        title: titleFromUrl(url),
        url,
        type: detectType(url),
      });
      if (out.length >= 40) break;
    }
    if (out.length >= 40) break;
  }
  return out;
}

function detectType(url: string): ReferenceType {
  for (const [type, re] of TYPE_PATTERNS) {
    if (re.test(url)) return type;
  }
  return "other";
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "").split("/").filter(Boolean).slice(-2).join(" › ");
    return path ? `${u.hostname} — ${path}` : u.hostname;
  } catch {
    return url;
  }
}
