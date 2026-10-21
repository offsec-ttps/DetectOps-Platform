# Ransomware Emulation Plans

**Attack Simulations → Ransomware Intelligence** carries a curated, source-cited
**emulation plan** for each well-documented ransomware group. A plan is the group's
observed attack chain (initial access → … → impact), built from MITRE ATT&CK, CISA
#StopRansomware advisories and vendor research. Each step is mapped to existing
Atomic Red Team tests in the local library.

Plans never add new commands or payloads. A step with no suitable local atomic is
shown as a **coverage gap**, together with the reason.

## Where to find it

| Place | What you get |
|---|---|
| Ransomware Intelligence directory | A **Plan** badge on gangs that have a plan, and an "Only gangs with a validated emulation plan" filter |
| Gang page → **Emulation plan** tab | The ordered chain. Each step shows its procedure, tools, sources, and every mapped atomic with its fidelity and state |
| Gang page → **Simulate this gang** | Runs the plan's runnable atomics in kill-chain order. It falls back to inferring atomics from known TTPs only if no plan exists |
| Reporting → Coverage Assessment → Scope **Ransomware groups** | A detonate-and-observe sweep of one or more gangs' chains, with a SIEM visibility report labelled `Ransomware · <gang>` |

## Step states

| State | Meaning |
|---|---|
| **Runnable** | At least one mapped atomic is in the local library, runs on Windows, and is safe to detonate |
| **Mapped · not detonated** | Mapped, but every mapped test is excluded automatically: impact/recovery inhibition (T1486, T1490 …), credential dumping, or global execution hijack. Validate these in an isolated console snapshot or with a tuned-rule sample |
| **Gap · no atomic** | No local atomic reproduces the procedure, e.g. exploiting a specific edge-device CVE. Covered by detection review, not detonation |

**Fidelity** ranks each mapping:

- `exact`: reproduces the reported procedure.
- `close`: same technique and tooling class.
- `proxy`: same technique, different implementation.

**Group-specific** marks a step that sets the group apart from generic ransomware
tradecraft, such as a particular RMM tool, a BYOVD driver, ESXi targeting, or custom
exfiltration tooling.

## Adding or updating a plan

1. Create or edit `config/ransomware-emulation/plans/<slug>.json`, following
   [`config/ransomware-emulation/SCHEMA.md`](https://github.com/offsec-ttps/DetectOps-Platform/blob/main/config/ransomware-emulation/SCHEMA.md).
   `gang` must be the exact gang name in the directory.
2. Cite every step in `sourceRefs`. Choose atomics only from the local library
   (Atomic tests page, or the `atomic_tests` table).
3. Validate:

   ```bash
   python3 scripts/validate-ransomware-plans.py
   ```

   This checks that the JSON parses, the gang exists, every step cites a source, and
   every `testGuid` is in the local library and runs on Windows. It also writes
   `config/ransomware-emulation/VALIDATION.md`. A non-zero exit means errors.
4. The app picks up changed plans on the next request; no restart is needed.

## Running a lab validation (Phase 2)

1. Take a VM snapshot first. The coverage-assessment form offers to do this.
2. Reporting → Coverage Assessment → **New** → scope **Ransomware groups**, then tick
   the gangs and pick the lab environment and SIEM.
3. When the sweep completes, download **Ransomware Group Coverage** (md/docx/pdf/pptx).
   It maps each result back onto every group's chain. A multi-group sweep runs each
   shared atomic only once. For each step the report gives:
   - the outcome: Visible, Generic only, Absent (blind spot), Failed, Not run (missing
     from the host's Atomic Red Team install), Not detonated (policy) or Gap;
   - the Event IDs and sourcetypes observed;
   - a visible-% score per group;
   - the blind spots that affect the most groups;
   - SPL recommendations and a starter Sigma rule.

   You can regenerate it at any time:
   `python3 scripts/ransomware_emulation_report.py <assessmentId>`.
