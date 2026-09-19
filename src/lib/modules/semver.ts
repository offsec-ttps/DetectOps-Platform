/**
 * Minimal semver — parse, compare, and range satisfaction for ^ ~ >= <= > < and
 * exact. No npm `semver` dependency in this repo, so we keep this small and
 * self-contained. Used for module versions, compatibleCoreVersion, and
 * dependency resolution.
 */

export interface SemVer { major: number; minor: number; patch: number; pre: string }

export function parse(v: string): SemVer | null {
  const m = String(v).trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || "" };
}

export function isValid(v: string): boolean {
  return parse(v) !== null;
}

/** -1 | 0 | 1 (a<b | a==b | a>b). A version with a prerelease is < its release. */
export function compare(a: string, b: string): number {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;          // release > prerelease
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/**
 * Does `version` satisfy `range`?
 *   exact: "1.2.3"
 *   caret: "^1.2.3"  → >=1.2.3 <2.0.0   (^0.2.3 → >=0.2.3 <0.3.0)
 *   tilde: "~1.2.3"  → >=1.2.3 <1.3.0
 *   ops:   ">=1.2.0", ">1.0.0", "<=2.0.0", "<2.0.0"
 *   "*" / "" / "x"   → any
 */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  if (!v) return false;
  const r = String(range).trim();
  if (r === "" || r === "*" || r === "x") return true;

  if (r.startsWith("^") || r.startsWith("~")) {
    const base = parse(r.slice(1));
    if (!base) return false;
    if (compare(version, `${base.major}.${base.minor}.${base.patch}`) < 0) return false;
    let upper: SemVer;
    if (r[0] === "^") {
      upper = base.major > 0 ? { ...base, major: base.major + 1, minor: 0, patch: 0, pre: "" }
            : base.minor > 0 ? { ...base, minor: base.minor + 1, patch: 0, pre: "" }
            : { ...base, patch: base.patch + 1, pre: "" };
    } else {
      upper = { ...base, minor: base.minor + 1, patch: 0, pre: "" };
    }
    return compare(version, `${upper.major}.${upper.minor}.${upper.patch}`) < 0;
  }

  const op = r.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!op) return false;
  const cmp = compare(version, op[2].trim());
  switch (op[1]) {
    case ">":  return cmp > 0;
    case ">=": return cmp >= 0;
    case "<":  return cmp < 0;
    case "<=": return cmp <= 0;
    default:   return cmp === 0;   // "=" or bare exact
  }
}

/** Highest version (from a list) that satisfies the range, or null. */
export function maxSatisfying(versions: string[], range: string): string | null {
  const ok = versions.filter((v) => isValid(v) && satisfies(v, range));
  if (!ok.length) return null;
  return ok.sort((a, b) => compare(b, a))[0];
}
