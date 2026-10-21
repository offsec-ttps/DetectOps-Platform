# Updating a Library with a New Technique

**Where:** `Marketplace → Module Builder → Add technique to a library` (`/marketplace/build`)

When you discover a new attack method, you add it to the **existing library** it belongs to as one small, atomic-style YAML record — no code change, no redeploy. Published entries are merged into that library, so they appear everywhere the library is used. This guide covers writing, publishing, updating and pushing entries, and how the docs themselves are kept in sync.

!!! tip "Fastest path"
    Open the builder → pick the library → **New from template** → edit → fix anything the validation panel flags → **Publish to library**. Worked examples you can copy: [technique](examples/library-entry-technique.yaml) · [coverage-only](examples/library-entry-coverage-only.yaml) · [LOTL](examples/library-entry-lotl.yaml) · [bundle](examples/library-entries-bundle.yaml).

## Contents

1. [What an entry is, and where it shows up](#what-an-entry-is-and-where-it-shows-up)
2. [Who can do what](#who-can-do-what)
3. [Write and publish an entry](#write-and-publish-an-entry)
4. [Field reference](#field-reference)
5. [Worked examples](#worked-examples)
6. [Writing good entries](#writing-good-entries)
7. [Update, retire and version an entry](#update-retire-and-version-an-entry)
8. [Push updates (git, other instances)](#push-updates-git-other-instances)
9. [Troubleshooting validation messages](#troubleshooting-validation-messages)
10. [Verify it worked](#verify-it-worked)
11. [How it works (for maintainers)](#how-it-works-for-maintainers)
12. [Keeping this documentation current](#keeping-this-documentation-current)
13. [API reference](#api-reference)

## What an entry is, and where it shows up

An **entry** is a declarative document describing one technique. Like an Atomic Red Team YAML, it is data, not code:

- **`kind: technique`** — knowledge + simulation entry: behaviour, telemetry, detections (SPL/Sigma), mitigations, references. The Simulate leg **links existing, vetted local atomic tests** — it never runs free-form commands. `atomics: []` makes it *coverage-only*.
- **`kind: lotl`** — a Living-off-the-Land technique (a binary + command) added to one of the ten LOTL libraries.

Entries are an **overlay**: they are stored separately and merged into the library when it is read, so first-party libraries are never edited and keep receiving their own upstream updates.

Once published, a technique entry appears in:

| Where | What you see |
|---|---|
| Attack Simulations → the library (list view) | New rows, searchable and filterable, with the linked atomic tests |
| Technique cards (attack-simulation libraries) | Kill-chain, detection queries, mitigations, references |
| Campaign Designer → Step 2 | Selectable in the module picker, filtered to the target server's OS |
| Coverage Assessment | Counted in the library's scope, so library-scoped sweeps include it |
| Reports | Counted in the per-library tables |

A LOTL entry appears as a normal row in its LOTL library (browse, search, group, simulate).

**Libraries you can update:** Active Directory, Privilege Escalation, Lateral Movement, UAC Bypass, User → Admin, User → SYSTEM, Cloud, Container, Hacktools, ClickFix, Process Injection, Shellcode Injection, LOTL-Simulation, and the ten LOTL libraries (LOLBAS, GTFOBins, LOLDrivers, LOLAPI, LOTTunnels, LOLRMM, LOOBins, Persistence-Info, LOAS, Sysinternals). The picker in the builder always shows the live list with technique counts.

## Who can do what

Entries are shared library content, so changing an **existing** entry is restricted:

| Action | Author | Other users | Admin |
|---|---|---|---|
| Create a technique entry (save draft / publish) | ✅ | ✅ (their own) | ✅ |
| Edit, publish or delete **own unpublished** technique entry | ✅ | ❌ | ✅ |
| Change someone else's entry | — | ❌ | ✅ |
| Update, retire or delete a **published** entry | ❌ | ❌ | ✅ |
| Create a **LOTL** entry | ✅ → queued as *pending* | ✅ → *pending* | ✅ → published |
| Approve / change / delete a LOTL entry | ❌ | ❌ | ✅ |

Why LOTL is admin-gated: it carries a `command` that becomes runnable in simulations. A non-admin submission is queued as **pending**; an admin approves it from the entries list. Reusing an existing `key` overwrites that entry, so it follows the same rules. Unauthorized attempts return `403` (and are reported as `forbidden` in bulk import).

## Write and publish an entry

1. **Open the builder** (`/marketplace/build`) and choose the **Add technique to a library** tab.
2. **Pick the target library.** The line under the picker lists the library's existing *groups* and *domains* — reuse them so the entry lands in the right place.
3. Click **New from template** (it loads pre-set for that library; every field is commented) and edit the YAML.
4. **Link the simulation.** In `atomics:`, point at existing local tests: `technique` + `name_includes`. Find the exact test name in **Atomic Test Library** (search the technique id). No match yet? Use `atomics: []`.
5. Watch the **validation panel** (live as you type): structure, target library, ATT&CK ids, and each linked test (e.g. `T1055 [Dirty Vanity] → 1 test`). The *Will appear in the library list as* box previews the rows.
6. **Save draft** to keep work in progress (drafts can be incomplete and are invisible to the library). When valid, click **Publish to library** (non-admin LOTL shows **Submit for approval**).
7. **Verify** (see [below](#verify-it-worked)).

## Field reference

### `kind: technique`

| Field | Required | Rules / notes |
|---|---|---|
| `schema` | ✅ | `1` |
| `kind` | ✅ | `technique` |
| `library` | ✅ | Target module id, e.g. `detectops.ad-attack`. Must be a technique library (not `lotl:*`) |
| `key` | auto | Unique slug in the library: 3–60 chars, `a-z 0-9 -`. Derived from `name` if omitted. **Same library + key = update** |
| `name` | ✅ | 3–120 chars. Warns if the name already exists in the library |
| `group` | – | Catalog group. Defaults from `platforms` (Windows / Linux / macOS / Cloud). **In some libraries (e.g. Active Directory) `group` is shown as the tactic column** — reuse an existing one |
| `domain` | – | Facet inside the library. Default `Analyst-added` |
| `attack_id` | ✅ | Primary ATT&CK id `T####` or `T####.###` |
| `attack_techniques` | – | Extra ATT&CK ids (same format); `attack_id` is always included |
| `tactic` | ✅ | e.g. `defense-evasion`, `credential-access` |
| `platforms` | ✅ | `windows`, `linux`, `macos`, `aws`, `azure`, `gcp`, … |
| `severity` | – | `low` \| `medium` \| `high` \| `critical` (default `medium`) |
| `summary` | ✅ | ≥ 10 chars — the one-liner on the card |
| `description` | ✅ | ≥ 20 chars — what it does, at detection-engineer level |
| `abuse` | – | How attackers use it and why it evades detection |
| `lab_setup` | – | List of lab requirements |
| `chain_narrative` | – | Ordered kill-chain steps (plain language) |
| `atomics` | – | List of `{technique, name_includes[], why}`. **Links existing local tests.** `[]` = coverage-only |
| `simulate_note` | – | Safety / usage note shown on the Simulate tab |
| `detection.summary` / `data_sources` | – | What to correlate and which logs |
| `detection.queries` | ⚠️ warn | List of `{format: spl\|sigma, title, query}`. ≤ 8000 chars each; Sigma must be valid YAML |
| `mitigations` | ⚠️ warn | List of `{title, kind, mitre_id?, detail}`; `kind` ∈ `gpo asr config network awareness edr allowlist` |
| `references` | ⚠️ warn | List of `{title, url}` — `url` must be `http(s)` |
| `changelog` | – | One line recorded with the version |

### `kind: lotl`

`library` (`lotl:<sourceId>`, e.g. `lotl:lolbas`), `name`, `description` (≥ 10), `command` (required, ≤ 4000), `executor` (`cmd powershell bash sh manual`), `cleanup_command`, `attack_id` (recommended), `tactic`, `binary_path`, `elevation_required`, `risk_level` (`low medium high`), `platforms` (≥ 1), `source_url`, `changelog`.

A command that matches the destructive / credential-dumping patterns is **flagged and excluded from coverage sweeps**, like every other atomic.

## Worked examples

All of these validate against the live platform (see [Keeping this documentation current](#keeping-this-documentation-current)).

| File | Shows |
|---|---|
| [`library-entry-technique.yaml`](examples/library-entry-technique.yaml) | A technique that **links a vetted atomic** (Shellcode Injection library) |
| [`library-entry-coverage-only.yaml`](examples/library-entry-coverage-only.yaml) | A **coverage-only** technique (`atomics: []`) in Active Directory, including how `group`/`domain` work there |
| [`library-entry-lotl.yaml`](examples/library-entry-lotl.yaml) | A **LOTL** entry with a harmless lab-marker command |
| [`library-entries-bundle.yaml`](examples/library-entries-bundle.yaml) | A **bundle** for export / bulk import |

The core of the first example:

```yaml
schema: 1
kind: technique
library: detectops.shellcode-injection-sim
key: dirty-vanity-fork-injection
name: Dirty Vanity (fork-based process injection)
group: Windows
domain: Process Lifecycle & Syscall Evasion
attack_id: T1055
tactic: defense-evasion
platforms: [windows]
atomics:
  - technique: T1055
    name_includes: [Dirty Vanity]     # → resolves to exactly one vetted test
detection:
  queries:
    - { format: spl, title: "…", query: "index=* …" }
```

## Writing good entries

- **Describe, don't instruct.** Cover what the behaviour is, the telemetry it produces, and how to detect/mitigate it. Do not include payloads, working loaders, or step-by-step procedures.
- **Link, don't write, the simulation.** Use `name_includes` to pin the entry to the specific test(s). Leaving it empty claims *all* local tests for that technique and can duplicate other rows (the validator warns).
- **Detections correlate stages.** Prefer "allocate/write → execute" over a single API name. Provide both SPL and Sigma when you can; keep queries copy-pasteable.
- **Name the telemetry.** In `data_sources`, name the log source and event id (Sysmon EID 8/10/25, Security 5136, auditd syscalls, macOS Endpoint Security events) so the SOC knows what must be collected.
- **Cite the source.** Add the report/blog/ATT&CK page that documented the method under `references`.
- **Use lab markers.** For LOTL commands, use a benign marker (e.g. `echo lab-marker`), never live infrastructure.
- **Reuse groups/domains.** Match the library's existing structure (shown under the picker) so the entry sits with related techniques.

## Update, retire and version an entry

Open the library in the builder; analyst-added entries are listed under the editor.

| Task | How |
|---|---|
| **Update** | **Edit** → change the YAML → **Publish**. Keeping the same `key` creates the next version (`v2`, `v3`, …); earlier versions are kept in history |
| **Take it out of the library temporarily** | **Retire** (record kept). **Restore** returns it to draft |
| **Remove** | **Delete** (also removes the LOTL row) |
| **Approve a LOTL submission** (admin) | **Approve** on the pending entry |

Notes: a *published* entry can only be updated or retired by an admin (see [permissions](#who-can-do-what)). Use `changelog` to say *why* each version changed.

## Push updates (git, other instances)

Treat your additions as source-controlled content:

1. **Export** — in the builder choose **Export YAML bundle** (or `GET /api/library-entries/export?library=<id>`). Add `&drafts=1` to include drafts.
2. **Commit** the bundle (e.g. `docs/` or a content repo) and review it in a pull request like any other change.
3. **Import** on any instance — **Bulk import → paste/upload → Dry run → Apply** (or `POST /api/library-entries/import`).
   - Each entry is validated **independently**: valid ones are applied, invalid ones are reported and skipped, so one bad entry never blocks the rest.
   - Same `library` + `key` updates the existing entry (a new version); new keys create entries.
   - Import respects the [permission rules](#who-can-do-what); LOTL entries imported by a non-admin land as *pending*.

Dry run results read `would-create`, `would-update` or `invalid` (with the reason).

## Troubleshooting validation messages

| Message | Meaning → fix |
|---|---|
| `library: "…" is not an updatable library` | The library id is wrong or not a technique library. Pick it from the builder's list |
| `kind: library "…" accepts technique entries, not lotl` (or reverse) | Use `kind: lotl` with a `lotl:*` library, otherwise `kind: technique` |
| `attack_id: "…" is not a valid ATT&CK id` | Use `T####` or `T####.###` |
| `atomics: no local atomic tests exist for T…` | The technique has no tests locally. Sync the atomic library, or set `atomics: []` |
| `atomics: none of the N local T… tests match name_includes […]` | The name terms don't match any test. Check the exact name in the Atomic Test Library |
| `atomics[i]: no name_includes — links ALL local tests…` *(warning)* | Add `name_includes` to avoid duplicating other entries' tests |
| `key: 3–60 chars, lowercase letters/digits/hyphens` | Fix the slug (or remove `key` to auto-derive it) |
| `summary: at least 10 characters` / `description: at least 20 characters` | Write a fuller summary/description |
| `detection.queries[i].format: must be "sigma" or "spl"` | Fix the format value |
| `mitigations[i].kind: must be one of …` | Use one of the listed kinds |
| `references[i]: title and an http(s) url are required` | Add a title and a full URL |
| `YAML/JSON parse error: …` | Indentation or quoting problem — compare with the template |
| `name: "…" already exists in this library` *(warning)* | Use a distinct name, or keep the same `key` to update your own entry |
| `command: … excluded from coverage sweeps` *(warning)* | Expected for destructive / credential-dumping commands |
| `403 only the entry's author or an admin can change it` | You don't own that entry — ask an admin or create your own with a new `key` |
| `403 a published entry can only be … by an admin` | Ask an admin to update/retire it |

## Verify it worked

After publishing, check each place the entry should appear:

- [ ] **Attack Simulations → the library**: search the technique id or name; the row(s) show with their linked tests (or *coverage only*).
- [ ] **Technique card** (attack-simulation libraries): detections, mitigations and references render.
- [ ] **Campaign Designer → Step 2**: select a server of the right OS, open the module picker, find the entry.
- [ ] **Coverage Assessment → New → scope by library**: the library's technique count went up.
- [ ] **Run it** on a lab target and confirm the telemetry/detection behaves as the entry describes.

## How it works (for maintainers)

| Piece | Location |
|---|---|
| Table `LibraryEntry` (`library_entries`) | `prisma/schema.prisma` |
| Document schema, normalization, structural checks, template | `src/lib/library-entries/schema.ts` |
| Store: targets, DB-backed validation, upsert/versioning, publish workflow, **authorization (`assertCanModify`)**, merge helpers, LOTL materialization, export | `src/lib/library-entries/store.ts` |
| API routes | `src/app/api/library-entries/**` |
| Builder UI | `src/components/marketplace/LibraryEntryBuilder.tsx` (tab in `src/app/(dashboard)/marketplace/build/page.tsx`) |

**Read-time merge points** (published entries are overlaid here — add any new consumer of library contents to this list):
`/api/modules/[moduleId]` (feeds the list view and Campaign Designer picker) · `/api/attack-sim/libraries` and `/api/attack-sim/atomics` (cards + simulate resolver) · `/api/simulations` (library counts) · `src/lib/coverage-assessment/scope.ts` (sweep scoping) · `scripts/generate_assessment_report.py` (per-library report tables).

**List-view contract:** catalog items may carry `uid` and `match` so several named entries share one ATT&CK id. Ids are requested most-specific-first so a parent id (e.g. `T1055`) does not absorb sub-technique atomics. `match: []` = coverage-only; `match` omitted = all tests.

**LOTL:** entries are materialised as `lotl_techniques` rows with `sourceRef: custom:<key>`; `src/lib/lotl/sync.ts` never prunes `custom:` rows.

**Scope:** APT Simulation, Phishing Simulation and Ransomware Intelligence use their own data models (groups, templates, gangs) and are not updated this way.

## Keeping this documentation current

The guide, the examples and the in-app templates all describe the same schema, so they are checked together:

```bash
npm run docs:check-entries
```

This validates every file in `docs/simulation/examples/` **and** the technique/LOTL templates the builder serves, using the exact validator that runs at publish time. Run it (and fix the docs or examples) whenever you:

- change `src/lib/library-entries/schema.ts` (fields, rules, template) or `store.ts` (validation, permissions);
- add or rename a target library, group or domain referenced by an example;
- change what happens to an entry at read time (add a merge point → also update [How it works](#how-it-works-for-maintainers)).

When the schema changes, update in this order: **`schema.ts` → example YAMLs → this page's [field reference](#field-reference) and [troubleshooting](#troubleshooting-validation-messages) → run the check.** The check is safe to wire into CI (exit code `1` on any invalid document).

## API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/library-entries/targets` | Libraries you can update (with groups/domains and counts) |
| GET | `/api/library-entries/template?kind=&library=&group=&domain=` | Starter YAML |
| POST | `/api/library-entries/validate` `{yaml}` | Dry-run: structure + library + linked-test resolution (writes nothing) |
| POST | `/api/library-entries` `{yaml, publish}` | Create or update (same library+key ⇒ new version) |
| GET | `/api/library-entries?library=&status=` | List entries |
| GET / PATCH / DELETE | `/api/library-entries/:id` | Read (YAML + history) / `{status: published\|retired\|draft}` / delete |
| GET | `/api/library-entries/export?library=&format=yaml\|json&drafts=1` | Bundle |
| POST | `/api/library-entries/import` `{yaml, dryRun}` | Push a bundle (per-entry validation) |

Back to [Simulation](index.md) · see also [Module Marketplace](../system/module-marketplace.md) and [Custom Simulation Builder](custom-simulation-builder.md).
