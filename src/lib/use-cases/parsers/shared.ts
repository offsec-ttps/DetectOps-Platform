/**
 * Common shape produced by every detection-rule parser before it reaches the
 * LLM. Generators consume `summary` + structured fields; the raw `body` is
 * always carried for reproducibility but is the LLM's last-resort context.
 */

export interface RuleContext {
  // Provenance
  sourceTable: string;            // CommunityRule | CommunitySigmaRule | …
  ruleId: string;                  // the row id
  upstreamRuleId: string;          // source-native id (UUID, GUID, sigma_id)
  upstreamUrl: string;             // direct link to upstream rule when available

  // Identity
  title: string;
  description: string;

  // Detection logic
  ruleLanguage: string;            // sigma | spl | kql | eql | toml | yara-l | …
  detectionLogic: string;          // body (trimmed to <8k for LLM)

  // ATT&CK
  mitreTechniques: string[];
  mitreTactics: string[];

  // Targeting
  logSources: string[];            // sigma category/product/service, SPL sourcetypes, KQL tables, Elastic indices
  platforms: string[];
  products: string[];

  // Context
  severity: string;
  references: string[];
  falsePositives: string[];

  // Pre-built one-paragraph summary the LLM sees as context
  summary: string;
}

export function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

/** Best-effort technique extractor for free-text descriptions / tags. */
export function extractTechniqueIds(...sources: string[]): string[] {
  const found = new Set<string>();
  const re = /\bT\d{4}(?:\.\d{3})?\b/gi;
  for (const s of sources) {
    if (!s) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      found.add(m[0].toUpperCase());
    }
  }
  return [...found];
}

/** Truncate a raw detection body to a budget that fits in our prompt. */
export function truncateBody(body: string, max = 8000): string {
  if (!body) return "";
  if (body.length <= max) return body;
  return body.slice(0, max) + `\n# … truncated (${body.length - max} chars)`;
}
