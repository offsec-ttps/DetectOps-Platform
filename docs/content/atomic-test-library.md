# Atomic Test Library (~2,000 Tests)

**Route:** `/atomic-tests` · **Sidebar:** Engineering → Atomic Test Library

A browsable, searchable mirror of Red Canary's **Atomic Red Team** (`redcanaryco/atomic-red-team`) test corpus — roughly **2,000 tests** across the ATT&CK matrix — plus a path to author your own custom tests. This is the catalog the simulation runners resolve ART `testGuid`s against, and the destination of the **Atomics Execution** tile in [Attack Simulations](../simulation/attack-simulations.md).

## Data model

- `AtomicTest` — one atomic test: `techniqueId`, `techniqueName`, `testNumber`, `testGuid`, `testName` / `testDescription`, `platforms`, `elevationRequired`, `executorName` (`command_prompt` / `powershell` / `bash` / `sh` / `manual`), `command`, `cleanupCommand`, `inputArguments`, `dependencies`, `tactic`, `sourceUrl`, `contentHash`, `source` (`upstream` | `custom`), `createdBy`. Unique on `[techniqueId, testNumber]`.
- `AtomicSyncMeta` — a sync run record: status, new/updated/removed counts, `totalTechniques`, **`totalTests`**, `commitSha`.

## Sync

`src/lib/atomic-red-team/sync.ts` (`syncAtomicRedTeam`):

1. Fetch the GitHub tree (filter `atomics/T*/T*.yaml`), the latest commit SHA, and the tactic-map CSV.
2. Fetch all YAMLs concurrently, parse each technique's `atomic_tests[]`.
3. Per test, compute a 16-char sha256 `contentHash` and upsert by `[techniqueId:testNumber]`.
4. Delete tests no longer present upstream.
5. Record totals to `AtomicSyncMeta` (`totalTests = AtomicTest.count()`).

`checkForUpdates()` compares the stored `commitSha` against upstream HEAD so you know when a resync is due.

!!! note "The ~2,000 figure is a live count"
    `totalTests` is `AtomicTest.count()` after sync, surfaced as `stats.totalTests` by `GET /api/atomic-tests` and on the page's stat cards. The real ART corpus is ~1,500–2,000+ tests and grows over time.

## Browsing & searching

`GET /api/atomic-tests` supports pagination (max 200/page) and filters: `search`, `technique_id`, `tactic`, `platform`, `executor`, `elevation`, with sorting. On page 1 it also returns aggregate `stats` (total tests, total techniques, tactic/platform/executor facets, last sync + commit). A tree view is available at `/api/atomic-tests/tree`.

## Custom tests

`POST /api/atomic-tests` (authenticated) validates the technique ID (`T####[.###]`), picks the next free `testNumber`, and stores the test with `source="custom"` and `createdBy`. Custom tests coexist with upstream tests under the same technique ID. Authoring UI: `src/components/use-cases/atomic/AtomicBuilder.tsx` (also used by the [Custom Simulation Builder](../simulation/custom-simulation-builder.md)).

## How tests execute

When a test runs, the executor + command are applied on the target: `powershell` → `pwsh -NoProfile -Command`, `command_prompt` → `cmd /c`, `bash`/`sh` accordingly. Input arguments are interpolated into the command; the [enterprise runner](../simulation/enterprise-use-cases.md) rejects argument values containing shell metacharacters as a safety measure.

## APIs

`/api/atomic-tests` (GET browse / POST custom), `/api/atomic-tests/tree`, `/api/atomic-tests/sync`, `/api/atomic-tests/updates`.
