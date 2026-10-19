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

// SESSION_HIJACK — persistence atomics that GLOBALLY hijack process execution:
// AppInit_DLLs / AppCert_DLLs inject a DLL into every process that loads user32,
// and Image File Execution Options "Debugger" / SilentProcessExit redirect how
// executables launch. Once set, the processes the WinRM shell spawns are affected
// too, so the management session breaks and every subsequent command cascades to a
// (blank) "winrm error" — exactly the CRED_DUMP session-poisoning failure mode,
// confirmed on the SAR DC where T1546.010 wedged the whole sweep. Excluded from the
// WinRM-driven sweep; assess these in an isolated/console context instead.
export const SESSION_HIJACK_TIDS = new Set(["T1546.009", "T1546.010", "T1546.012"]);
export const SESSION_HIJACK = /AppInit_DLLs|AppCertDLLs|Image File Execution Options[\s\S]*\/v\s+Debugger|\bSilentProcessExit\b/i;

export interface ExclusionVerdict { excluded: boolean; reason: string }

/** Decide whether an atomic should be excluded from the sweep. */
export function classifyExclusion(techniqueId: string, tactic: string, command: string): ExclusionVerdict {
  const cmd = command || "";
  const tid = techniqueId.toUpperCase();
  if ((tactic || "").toLowerCase().includes("impact")) return { excluded: true, reason: "impact tactic (destructive)" };
  if (DESTRUCTIVE.test(cmd)) return { excluded: true, reason: "destructive command" };
  if (tid.startsWith("T1003") || CRED_DUMP.test(cmd)) return { excluded: true, reason: "credential dumping (session-poisoning; assessed via tuned-rule sample)" };
  if (SESSION_HIJACK_TIDS.has(tid) || SESSION_HIJACK.test(cmd)) return { excluded: true, reason: "global process-execution hijack (AppInit/AppCert/IFEO) — poisons the WinRM session; assess in isolation" };
  return { excluded: false, reason: "" };
}
