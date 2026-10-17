// Distinctive-indicator extraction for telemetry-visibility scoring, ported from
// the validated offline rescore. The point: searching the SIEM for a generic
// shell (powershell.exe / cmd.exe) matches everything and proves nothing, so we
// pick a NON-generic indicator unique to the atomic (a specific tool, script,
// or CamelCase/hyphenated keyword). An atomic whose only token is a generic
// shell is "generic-only" (indeterminate) rather than counted as visible.

const GENERIC = new Set([
  "powershell.exe", "cmd.exe", "conhost.exe", "rundll32.exe", "wscript.exe",
  "cscript.exe", "cmd", "powershell", "pwsh.exe", "mshta.exe", "regsvr32.exe",
  "explorer.exe", "svchost.exe",
]);

const STOP = new Set((
  "the and for with this that from your into run test atomic windows system file files " +
  "path name value true false null echo write output host item get set new invoke start " +
  "exe dll ps1 bat txt tmp temp user users local admin administrator public program " +
  "data microsoft windows http https www com net org function param foreach where object"
).split(/\s+/));

const SUSPICIOUS = new Set([
  "mimikatz", "sekurlsa", "nltest", "adfind", "bloodhound", "sharphound",
  "vssadmin", "wmic", "bitsadmin", "certutil", "nishang", "invoke",
]);

export interface TokenResult { distinctive: string[]; genericOnly: boolean }

/** Extract up to `max` distinctive indicators from an atomic command. */
export function distinctiveTokens(command: string, max = 5): TokenResult {
  const cmd = command || "";
  const exes = new Set<string>();
  for (const m of cmd.matchAll(/\b[\w-]+\.(?:exe|ps1|dll|bat|vbs|js|hta|scr)\b/gi)) exes.add(m[0]);
  const distinctExe = [...exes].filter((e) => !GENERIC.has(e.toLowerCase()));

  const seen = new Set<string>();
  const distinctWords: string[] = [];
  for (const m of cmd.matchAll(/[A-Za-z][A-Za-z0-9_-]{5,}/g)) {
    const w = m[0];
    const lw = w.toLowerCase();
    if (seen.has(lw) || STOP.has(lw)) continue;
    seen.add(lw);
    // CamelCase, hyphenated (cmdlet/flag-ish), or a known suspicious tool name
    if (/[A-Z].*[a-z].*[A-Z]|-/.test(w) || SUSPICIOUS.has(lw)) distinctWords.push(w);
  }
  const distinctive = [...distinctExe, ...distinctWords.slice(0, 3)].slice(0, max);
  return { distinctive, genericOnly: distinctive.length === 0 };
}
