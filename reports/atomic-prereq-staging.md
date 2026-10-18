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
