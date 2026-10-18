# Atomic Red Team — Windows dependency staging

_Generated 2026-10-17T20:07:09 against env `b66351e8-26d6-4ee2-8b1b-c3a12a5a0033`._

| Status | Count |
|---|---|
| satisfied (staged/present) | 367 |
| missing (still unmet) | 89 |
| n/a (not on host) | 0 |
| failed | 5 |
| **total** | **461** |

## What "satisfied" means

367 Windows atomics now have their external payloads downloaded and cached on
the DC (`C:\AtomicRedTeam\ExternalPayloads` + per-technique `bin/` folders) via
`Invoke-AtomicTest -GetPrereqs`. These persist on disk, so those techniques are
runnable offline — no further download needed.

## Why the 89 "missing" remain (by root cause)

These are **not** download failures. `-GetPrereqs` ran but `-CheckPrereqs` still
reports unmet, because the prerequisite is something ART cannot fetch
automatically — a locally-installed/licensed tool, an Office/AD environment, or
a precondition that must be created on the host:

| Count | Root cause | Resolution |
|---|---|---|
| 27 | 3rd-party / licensed tool ART won't auto-download (hashcat, nmap, tshark, Rar/7zip, DiskCryptor, Radmin, PDQ Deploy, NetSupport, MSP360, SubInAcl, CrackMapExec, Evil-WinRM, AutoHotKey, sqlcmd/scp/sftp, PowerCLI, Portable VirtualBox…) | Manually place the binary at the atomic's expected path, or install the tool, on the DC |
| 26 | MS Office / VBA (Word/Excel/Outlook COM, XLL/WLL/XLAM/PPAM, maldoc) | Requires Microsoft Office installed on the target |
| 23 | Other / env-specific precondition | Case-by-case (see JSON `tail`) |
| 8 | AD/domain precondition (password-policy checks, domain user list) | Needs the domain populated / a user list supplied |
| 4 | Needs a pre-created VSS snapshot | Create a Volume Shadow Copy of C:\ first |
| 1 | Needs PowerShell v2 engine feature | Enable the PSv2 optional feature |

## The 5 "failed"

`T1057 #8`, `T1072 #3`, `T1555.003 #5`, `T1569.002 #8`, `T1659 #2` returned no
output within the per-item budget (WinRM round-trip timeout). Transient —
re-run those five with a larger `--budget`.

---

## Follow-up staging (2026-10-18) — resolver + re-stage

After installing the prerequisites `-GetPrereqs` cannot place on its own
(`scripts/stage_windows_prereq_tools.ps1`: OpenSSH client capability, curl into
System32, Sysmon, PSGallery modules, the T1098 DPAPI credential file and the
T1110.003 user list) and re-running the platform's GetPrereqs across the
previously-unsatisfied set, the tally moved to:

| Status | Count |
|---|---|
| **satisfied** | **392** |
| unsatisfied | 69 |
| failed | 0 |
| **total** | **461** |

The remaining 69 break down as:

| Count | Bucket | Note |
|---|---|---|
| 31 | **Microsoft Office / VBA / COM** | Resolve once `scripts/install_office_dc.ps1` (ODT, Word/Excel/PPT/Outlook) completes on the DC |
| 23 | **Interactive/GUI installer over WinRM** | WinRAR, 7-Zip, hashcat, AutoHotKey, Process Hacker, TightVNC, DiskCryptor, Opera, Edge, Chocolatey, Ruby/Evil-WinRM, PowerCLI, SubInAcl, .NET SDK, pyasn1… — their silent installers need an interactive session; place by hand or run the installer on the box |
| 11 | **Commercial / absent-on-DC** | Radmin, PDQ Deploy, NetSupport, MSP360, CrackMapExec, Telnet C2, OneDrive updater, SoftPerfect Netscan, Windows Terminal (n/a on Server 2016), MpCmdRun (Defender not installed), LSASS-dump `.NET5` (excluded — credential-dump poisons WinRM) |
| 4 | **VSS snapshot** | `T1003.003#2`, `T1490#1/#2/#13` — their CheckPrereq creates a shadow copy of C:\ interactively; a manually created shadow does not satisfy them over a non-interactive WinRM session |

A pre-launch **dependency chooser** is now wired into the Campaign Designer
(`/api/atomic-prereqs/preview` + `components/campaign/DependencyPrompt`): before
atomics run, the analyst selects which of these tool dependencies to install
(auto-installable pre-ticked, commercial/manual flagged), and only the selected
ones are staged.
