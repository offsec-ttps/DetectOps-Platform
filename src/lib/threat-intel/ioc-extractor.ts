/**
 * IoC (Indicator of Compromise) Extractor
 *
 * Extracts indicators from raw text content using regex patterns.
 * Supports: IPv4, IPv6, domains, URLs, SHA256, SHA1, MD5, emails, CVEs, filenames, registry keys
 */

export interface ExtractedIoC {
  type: string;
  value: string;
  context: string;
}

// Defanged notation patterns
const DEFANG_MAP: [RegExp, string][] = [
  [/hxxp/gi, "http"],
  [/\[:\]/g, ":"],
  [/\[\.\]/g, "."],
  [/\[dot\]/gi, "."],
  [/\[at\]/gi, "@"],
  [/\(\.\)/g, "."],
];

function refang(text: string): string {
  let result = text;
  for (const [pattern, replacement] of DEFANG_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// Whitelist of known-benign domains to filter out
const DOMAIN_WHITELIST = new Set([
  "example.com", "example.org", "example.net", "localhost", "google.com",
  "github.com", "microsoft.com", "twitter.com", "facebook.com", "linkedin.com",
  "youtube.com", "wikipedia.org", "w3.org", "schema.org", "googleapis.com",
  "cloudflare.com", "amazon.com", "amazonaws.com", "wordpress.com",
  "wp.com", "gravatar.com", "feedburner.com", "bit.ly", "t.co", "goo.gl",
]);

const IOC_PATTERNS: { type: string; pattern: RegExp; validate?: (v: string) => boolean }[] = [
  {
    type: "ipv4",
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.|\[\.\])){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    validate: (v) => {
      const parts = v.replace(/\[\.\]/g, ".").split(".");
      if (parts.length !== 4) return false;
      const first = parseInt(parts[0]);
      // Skip private/reserved ranges
      if (first === 10 || first === 127 || first === 0) return false;
      if (first === 172 && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) return false;
      if (first === 192 && parseInt(parts[1]) === 168) return false;
      return true;
    },
  },
  {
    type: "sha256",
    pattern: /\b[a-fA-F0-9]{64}\b/g,
  },
  {
    type: "sha1",
    pattern: /\b[a-fA-F0-9]{40}\b/g,
    validate: (v) => !/^[a-fA-F0-9]{64}$/.test(v), // Not a SHA256
  },
  {
    type: "md5",
    pattern: /\b[a-fA-F0-9]{32}\b/g,
    validate: (v) => !/^[a-fA-F0-9]{40,}$/.test(v), // Not a longer hash
  },
  {
    type: "cve",
    pattern: /CVE-\d{4}-\d{4,}/gi,
  },
  {
    type: "url",
    pattern: /(?:hxxps?|https?):\/\/[^\s<>"')\]]+/gi,
  },
  {
    type: "domain",
    pattern: /(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\[\.\]|\.))+(?:com|net|org|io|co|ru|cn|tk|xyz|top|info|biz|cc|pw|ws|su|ua|ir|kp|onion)\b/gi,
    validate: (v) => {
      const clean = v.replace(/\[\.\]/g, ".").toLowerCase();
      return !DOMAIN_WHITELIST.has(clean) && clean.length > 4;
    },
  },
  {
    type: "email",
    pattern: /[a-zA-Z0-9._%+-]+(?:@|\[at\])[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
  },
  {
    type: "registry",
    pattern: /(?:HKLM|HKCU|HKCR|HKU|HKCC)\\[^\s<>"']+/gi,
  },
  {
    type: "filename",
    pattern: /(?:[a-zA-Z0-9_-]+\.(?:exe|dll|bat|ps1|vbs|js|msi|scr|com|pif|cmd|hta|wsf|lnk|jar|py|sh|elf|bin|iso|img|vhd|vhdx))\b/gi,
    validate: (v) => v.length > 4,
  },
  {
    type: "mitre_technique",
    pattern: /T\d{4}(?:\.\d{3})?/g,
  },
];

export function extractIoCs(text: string): ExtractedIoC[] {
  const refanged = refang(text);
  const seen = new Set<string>();
  const results: ExtractedIoC[] = [];

  for (const { type, pattern, validate } of IOC_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(refanged)) !== null) {
      const value = refang(match[0].trim());
      const key = `${type}:${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      if (validate && !validate(value)) continue;
      seen.add(key);

      // Extract surrounding context (±50 chars)
      const start = Math.max(0, match.index - 50);
      const end = Math.min(refanged.length, match.index + match[0].length + 50);
      const context = refanged.slice(start, end).replace(/\s+/g, " ").trim();

      results.push({ type, value, context });
    }
  }

  return results;
}

// ── MITRE ATT&CK extraction ──

export function extractMitreTechniques(text: string): string[] {
  const pattern = /T\d{4}(?:\.\d{3})?/g;
  const techniques = new Set<string>();
  let match;
  while ((match = pattern.exec(text)) !== null) {
    techniques.add(match[0]);
  }
  return Array.from(techniques);
}

// ── Threat actor extraction (basic keyword matching) ──

const KNOWN_ACTORS = [
  "APT28", "APT29", "APT41", "APT32", "APT33", "APT34", "APT35", "APT37", "APT38", "APT40",
  "Lazarus", "Kimsuky", "Turla", "Sandworm", "Fancy Bear", "Cozy Bear", "Charming Kitten",
  "MuddyWater", "OilRig", "Equation Group", "DarkSide", "REvil", "Conti", "LockBit",
  "BlackCat", "ALPHV", "Cl0p", "LAPSUS", "FIN7", "FIN11", "FIN12", "Carbanak",
  "Wizard Spider", "Evil Corp", "TA505", "TA551", "UNC2452", "UNC1878", "UNC2447",
  "Hafnium", "Nobelium", "Storm-0558", "Volt Typhoon", "Salt Typhoon", "Flax Typhoon",
  "Pawn Storm", "Sofacy", "Sednit", "BlueDelta", "Forest Blizzard", "Midnight Blizzard",
  "Scattered Spider", "Star Blizzard", "Aqua Blizzard", "Ember Bear", "Cadet Blizzard",
  "UNC1069", "UNC3886", "UNC5221", "Mustang Panda", "Stately Taurus",
  "Silver Fox", "Lotus Blossom", "Void Manticore", "Handala",
];

export function extractThreatActors(text: string): string[] {
  const found: string[] = [];
  const textLower = text.toLowerCase();
  for (const actor of KNOWN_ACTORS) {
    if (textLower.includes(actor.toLowerCase())) {
      found.push(actor);
    }
  }
  return found;
}
