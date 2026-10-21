/**
 * Input validation for Build Forge. Values here end up in filesystem paths, git
 * argv and (for build placeholders) a build shell command, so they are restricted
 * to safe character sets — never trust the request body for these.
 */
const SEG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;            // owner / repo name path segment
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;       // git ref (no spaces/metachars)

export function isSafeSegment(s: unknown): s is string {
  return typeof s === "string" && SEG.test(s) && s !== "." && s !== ".." && !s.includes("..");
}
export function isSafeBranch(s: unknown): s is string {
  return typeof s === "string" && BRANCH.test(s) && !s.includes("..") && !s.endsWith("/") && !s.endsWith(".lock") && !s.includes("//");
}
/** https only, github-style host/owner/repo path, no credentials / options / exotic transports. */
export function isSafeGitUrl(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 300 || s.startsWith("-")) return false;
  let u: URL;
  try { u = new URL(s); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return false;
  return /^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(\.git)?\/?$/.test(u.pathname);
}
export const ENVIRONMENTS = new Set(["linux", "windows", "macos", "docker", "k8s"]);
export const ARCHES = new Set(["x64", "x86", "arm64", "arm", "any"]);
export const PROFILES = new Set(["release", "debug"]);
