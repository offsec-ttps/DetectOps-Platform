# Detection Improvement Recommendations

Prepared by **RuSecure** · Engagement: **UnicornSecrets** · Lab: **Splunk SAR (Attack Range)**

These recommendations accompany the coverage assessment. For each technique that
executed but was not detected, they state what the current detection logic / telemetry
missed and the concrete logic to add. Field names below assume Sysmon + Windows Security
Event Log forwarded to Splunk.

## Cross-cutting findings (highest priority)

1. **Enable a comprehensive Sysmon configuration.** The lab's Sysmon is not emitting
   **Event ID 8 (CreateRemoteThread)** or **Event ID 10 (ProcessAccess)** — both returned
   zero events during testing. This blinds an entire class of detections: process
   injection and credential access to LSASS by handle. Deploy a vetted config
   (SwiftOnSecurity or Olaf Hartong `sysmon-modular`) that enables EID 8, 10, and 25
   (ProcessTampering), with LSASS as a watched target image.
2. **Enable command-line process auditing.** Ensure Security **4688** logs the full
   command line (GPO: *Include command line in process creation events*), and that Sysmon
   **EID 1** is collected. Most discovery and execution detections depend on command-line
   content.

## Per-technique recommendations

### Discovery

Domain account, trust and remote-system discovery (T1087.002, T1482, T1018) **were
detected** — the net/nltest command lines were logged and matched. The gap is:

- **T1201 — Password Policy Discovery.** Missed. Add a detection for `net accounts` and
  `Get-ADDefaultDomainPasswordPolicy`, and confirm command-line auditing (Security 4688
  with command line) is enabled. Rare from endpoints; alert when seen off a DC.
  To strengthen the ones that fired, baseline legitimate admin discovery and alert on a
  burst of discovery commands from a single non-admin host/user.

### Credential Access

- **T1003.001 — LSASS Credential Dumping.** The command-line path (procdump, comsvcs
  MiniDump, rundll32) is detectable, but the strongest signal — **Sysmon EID 10
  ProcessAccess to `lsass.exe`** with `GrantedAccess` of `0x1010`/`0x1410`/`0x143a` — is
  blind because EID 10 is disabled. Enable EID 10 and add the handle-access detection;
  also alert on EID 11 file-writes of `*.dmp`.

### Privilege Escalation / Execution

- **T1055 — Process Injection.** Missed entirely: no CreateRemoteThread/ProcessAccess
  telemetry. After enabling Sysmon EID 8/10/25, add detections for CreateRemoteThread into
  a non-child process, `mavinject.exe * /INJECTRUNNING`, and suspicious `VirtualAllocEx` +
  `WriteProcessMemory` sequences.

### Privilege Escalation via weak service configuration

- **T1574.011 — Service Registry Permissions Weakness.** Missed. Add a detection for
  modification of a service's `ImagePath` or `FailureCommand` registry value under
  `HKLM\SYSTEM\CurrentControlSet\Services\*` (Security 4657 with registry auditing, or
  Sysmon EID 13). Pair with service restart (7045/7036) to catch the payload executing.

### Token impersonation (sustain / strengthen)

- **T1134.001 — Token Impersonation ("Potato").** Detected this run via the tool image
  name, but the signal was weak (a single event). Strengthen it with named-pipe creation
  (Sysmon EID 17/18) paired with a `SeImpersonatePrivilege` logon (Security 4672/4624
  type 3). A service account spawning `cmd.exe`/`powershell.exe` as `NT AUTHORITY\SYSTEM`
  shortly after a pipe connection is a high-fidelity indicator.

## Techniques with working detections (sustain)

Service creation (Security 7045), scheduled-task creation (Security 4698), WMI execution
(WmiPrvSE parent / `wmic process call create`), SMB admin-share access (Security 5140),
UAC-bypass auto-elevate binaries (fodhelper/eventvwr/computerdefaults), run-key
persistence (Sysmon EID 13 on `...\CurrentVersion\Run`), and service-registry weakness
(`ImagePath`/`FailureCommand` modification) all fired. Keep these rules and baseline their
legitimate usage to control false positives.

## How to use this with your own detection content

Load your Sigma rules into the platform's Rule Workspace, run each Attack Simulation
library through the Campaign Designer in `simulate-and-validate` mode against this SAR
environment, and the platform converts each rule to SPL and checks whether it fired in the
run window. The coverage report then shows, per library, which techniques your rules catch
and which remain gaps — repeat after each rule change to track improvement.
