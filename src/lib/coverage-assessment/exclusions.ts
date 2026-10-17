// Atomics excluded from an in-app coverage sweep, ported from the validated
// offline sweep harness. Two classes:
//   DESTRUCTIVE — wipers / service-stoppers / log-clearers that would damage the
//     lab or blind the very telemetry we measure.
//   CRED_DUMP   — LSASS/SAM/NTDS credential dumping (Mimikatz & friends). These
//     POISON the WinRM session: after LSASS access the Windows LSA rejects the
//     session token and every subsequent command auth-fails, cascading the whole
//     sweep. They are assessed separately via a tuned-rule sample, not swept.
// Also exclude the ATT&CK "impact" tactic wholesale (ransomware/destruction).

export const DESTRUCTIVE = /vssadmin\s+delete|cipher\s+\/w|(^|\s)format\s|bcdedit|wbadmin\s+delete|diskpart|shutdown|restart-computer|remove-item.*-recurse|stop-service.*(splunk|eventlog|winmgmt)|splunkforwarder|wevtutil\s+cl|clear-eventlog|set-mppreference\s+-disable|auditpol.*\/disable|disable-windowsoptionalfeature/i;

export const CRED_DUMP = /mimikatz|sekurlsa|lsass|comsvcs|procdump|ntds|ntdsutil|reg\s+save.*(sam|security|system)|\bwce\b|pwdump|gsecdump|lazagne|out-minidump|rundll32.*minidump|nanodump|dumpert/i;

export interface ExclusionVerdict { excluded: boolean; reason: string }

/** Decide whether an atomic should be excluded from the sweep. */
export function classifyExclusion(techniqueId: string, tactic: string, command: string): ExclusionVerdict {
  const cmd = command || "";
  if ((tactic || "").toLowerCase().includes("impact")) return { excluded: true, reason: "impact tactic (destructive)" };
  if (DESTRUCTIVE.test(cmd)) return { excluded: true, reason: "destructive command" };
  if (techniqueId.toUpperCase().startsWith("T1003") || CRED_DUMP.test(cmd)) return { excluded: true, reason: "credential dumping (session-poisoning; assessed via tuned-rule sample)" };
  return { excluded: false, reason: "" };
}
