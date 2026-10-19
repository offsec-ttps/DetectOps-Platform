# LOTL Libraries + Marketplace Cleanup — Deployment Plan

Status: proposed · Date: 2026-10-06 · Target view: Attack Simulations → Living-off-the-Land Simulation

This plan covers two independent pieces of work:

- **Part A** — Marketplace clarity: remove the redundant "Simulation Modules" sidebar section; installed modules stay reachable via Preparation → Attack Simulations.
- **Part B** — Living-off-the-Land libraries: add a browsable, selectable library per LOTL reference project (LOLBAS, GTFOBins, LOLDrivers, LOLRMM, LOOBins, LOLAPI, LOTTunnels, Persistence-Info, LOAS, Sysinternals), modelled on the existing Atomic Test Library, with analyst-created technique groups that feed the existing simulation + detection runner.

---

## Current state (verified)

- The sidebar is a config array in `src/components/layout/sidebar.tsx`. "Attack Simulations" (Preparation) links to `/simulations`. "Module Marketplace" links to `/marketplace`.
- The "Simulation Modules" section is NOT in the static config. It is appended dynamically at render (sidebar.tsx ~L183-188) from `GET /api/modules/nav` → `getModuleNav()` in `src/lib/modules/registry.ts`. It is a second entry point to the same live modules already shown on the `/simulations` grid.
- LOTL is a first-party simulation module (`detectops.lotl-sim`, view `technique-catalog`) seeded by `src/lib/modules/seed-simulations.ts` into the `SimulationModule` prisma model, rendered by `src/components/modules/views/TechniqueCatalogView.tsx`.
- The "3 LOTL" visible today are 3 hard-coded MITRE technique groups in that manifest. There is **no** LOLBAS/GTFOBins/etc. dataset, model, or ingestion anywhere yet.
- Atomic Test Library: page `src/app/(dashboard)/atomic-tests/page.tsx`, model `AtomicTest` (`prisma/schema.prisma` L281), synced from `redcanaryco/atomic-red-team` by `src/lib/atomic-red-team/sync.ts`. It has browse / search / filter / sort / paginate / detail, but **no multi-select, no saved group**.
- Run path: `/api/simulations/run` → `inferSimulations()` (`src/lib/detection-packs/infer-sims.ts`) → `ScenarioStep[]` → `materializeAdhoc()` (`src/lib/modules/materialize.ts`) → `runScenario()` (`src/lib/enterprise-use-cases/runner.ts` L299). Detection scoring via `validateCoverage()` (`src/lib/enterprise-use-cases/validate-coverage.ts`) when `mode: "simulate-and-validate"`.
- Saved-selection precedent: `FleetCampaign.testSelection` JSON (`prisma/schema.prisma` L1742).

---

## Part A — Remove the "Simulation Modules" sidebar section

Single-file change, no DB impact.

1. In `src/components/layout/sidebar.tsx`, replace the dynamic `allSections` composition (~L183-188) with `const allSections = navSections;`.
2. Remove now-dead code: `moduleNav` state, its `useEffect` fetch of `/api/modules/nav`, the `MODULE_ICONS` map, and the `ModuleNavItem` interface.
3. Leave untouched: `/api/modules/nav`, `registry.ts`, `/api/simulations`, the Preparation "Attack Simulations" and "Module Marketplace" items, and the `/modules/[moduleId]/[[...sub]]` route.

Result: installed modules remain fully accessible as tiles on `/simulations` → `/modules/<id>`; only the duplicate sidebar section disappears. Deployed features are untouched.

**Marketplace clarity (minor):** confirm `/marketplace` lists every module with an install / uninstall control driven by `SimulationModule.enabled` + `installedAt` (install route already exists at `src/app/api/modules/[moduleId]/install/route.ts`). Add an explicit uninstall action if missing (set `enabled: false`), so install state round-trips. Installed modules continue to surface under Attack Simulations exactly as today.

---

## Part B — LOTL reference-project libraries

Goal: under Living-off-the-Land Simulation, present one library per LOTL project the same way the Atomic Test Library is presented, let the analyst select techniques and save a named **group**, then simulate only that group with runtime detection. Atomic Red Team is already wired; these are additive.

### Sources (from magicsword-io/Magic-Atomics, fetched from each upstream)

| Library | Upstream | Platform | Approx |
|---|---|---|---|
| LOLBAS | LOLBAS-Project/LOLBAS | Windows | ~450 |
| GTFOBins | GTFOBins/GTFOBins.github.io | Linux | ~820 |
| LOLDrivers | magicsword-io/LOLDrivers | Windows | ~900 |
| LOLRMM | magicsword-io/LOLRMM | Multi | ~300 |
| LOOBins | infosecB/LOOBins | macOS | ~180 |
| LOLAPI | (Magic-Atomics ingestor) | Multi | ~55 |
| LOTTunnels | (Magic-Atomics ingestor) | Multi | ~145 |
| Persistence-Info | (Magic-Atomics ingestor) | Windows | ~36 |
| LOAS | (Magic-Atomics ingestor) | macOS | ~185 |
| Sysinternals | live.sysinternals.com | Windows | 80 |

Magic-Atomics normalises every source to one schema: `name, description, command, executor (cmd|powershell|bash|manual), technique_id, binary_path, elevation_required, risk_level, platforms, cleanup_command, metadata`. That schema is the contract for our model and runner.

### B1. Data model (`prisma/schema.prisma`)

Add one polymorphic model (discriminated by `library`) rather than ten models:

```
model LotlTechnique {
  id                String  @id @default(cuid())
  library           String  // "lolbas" | "gtfobins" | "loldrivers" | ...
  sourceRef         String  // stable upstream id (filename / slug)
  name              String
  description       String  @default("")
  command           String
  executor          String  @default("manual") // cmd|powershell|bash|manual
  cleanupCommand    String?
  techniqueId       String? // MITRE, nullable (not all sources map cleanly)
  techniqueName     String?
  tactic            String?
  binaryPath        String?
  elevationRequired Boolean @default(false)
  riskLevel         String  @default("medium")
  platforms         String  @default("[]") // JSON
  metadata          String  @default("{}") // JSON, source-specific
  contentHash       String
  sourceUrl         String  @default("")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@unique([library, sourceRef])
  @@index([library]); @@index([techniqueId]); @@index([executor]); @@index([platforms])
}

model LotlSyncMeta { // one row per library, mirrors AtomicSyncMeta
  id String @id @default(cuid())
  library String @unique
  status String; newCount Int; updatedCount Int; removedCount Int
  commitSha String?; startedAt DateTime?; completedAt DateTime?
}

model LotlGroup { // analyst-created selection, reusable for future simulation
  id String @id @default(cuid())
  name String
  library String          // group is scoped to one library
  description String @default("")
  entries String @default("[]") // JSON array of LotlTechnique ids / sourceRefs
  createdBy String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Migration via `prisma generate` + `prisma db push` (SQLite `dev.db`). **Note the known gotcha: restart the dev server after `prisma generate`.**

### B2. Ingestion / sync engine

New `src/lib/lotl/sync.ts`, modelled on `src/lib/atomic-red-team/sync.ts` (git-tree walk → concurrent raw fetch via `pMap` → parse → content-hash upsert → delete-missing). Because each upstream has its own format, use a per-source parser registry mirroring Magic-Atomics' `ingestion/*`:

- `src/lib/lotl/sources/<library>.ts` — one parser per library, each exporting `{ library, repoUrl, platform, fetchAndParse(): Promise<NormalizedEntry[]> }`.
- `src/lib/lotl/registry.ts` — registers all source parsers.
- `syncLotl(library?)` — syncs one or all libraries into `LotlTechnique`, writes `LotlSyncMeta`. Honors `GITHUB_TOKEN`.
- API: `POST /api/lotl/[library]/sync`, `GET /api/lotl/[library]/updates` (SHA compare), `maxDuration = 300`.

Parsers to port from Magic-Atomics ingestors (Python → TS): lolbas, gtfobins, loldrivers, lolrmm, loobins, lolapi, loltunnels, persistence_info, loas, sysinternals. Start with LOLBAS + GTFOBins (highest value, well-structured YAML/MD).

### B3. Library browse UI

Shared component `src/components/lotl/LotlLibraryBrowser.tsx`, factored from `atomic-tests/page.tsx` (stats cards, debounced search, filter bar, sortable paginated table, detail panel). Backed by `GET /api/lotl/[library]` (pagination/filter/sort/stats — same shape as `/api/atomic-tests`).

Surfaced under the LOTL module, not as a top-level route, so it lives inside "Living-off-the-Land Simulation":

- Extend `TechniqueCatalogView.tsx` (the `detectops.lotl-sim` view) to show a card per LOTL library (count, platform, last-synced, Sync button) alongside the existing Atomic Red Team groups.
- Each card opens the browser via the module shell sub-route `/modules/detectops.lotl-sim/library/<library>` (route already supports `[[...sub]]`).

### B4. Group creation + simulation

Add to `LotlLibraryBrowser`:

- Row multi-select (checkboxes) + a selection tray showing count.
- "Save as group" → `POST /api/lotl/groups` (creates `LotlGroup`). "My groups" list to load / edit / delete.
- "Simulate group" → new bridge `POST /api/lotl/simulate` that:
  1. Loads the group's `LotlTechnique` rows.
  2. Maps each to a `ScenarioStep` carrying the entry's own `command`/`executor`/`cleanupCommand` inline (see decision below), plus `techniqueId` for scoring.
  3. Calls `materializeAdhoc()` → `runScenario(..., mode: "simulate-and-validate")`.
  4. Detection scoring comes free via `validateCoverage()` keyed on `techniqueId` over the run window.

This reuses the entire existing execution + scoring pipeline; only step construction is new.

### Key design decision — how LOTL entries become executable steps

The current runner's `buildAtomicCommand()` resolves an `AtomicTest` by `refId = testGuid`. LOTL entries carry their own command and are not `AtomicTest` rows.

**Recommended:** add a `framework: "lotl"` branch to `ScenarioStep` and `buildAtomicCommand()`/`dispatchStep()` in `runner.ts` that executes the step's inline `command` (reusing the existing `SHELL_INJECTION` guard and executor wrapping). Steps are stored as JSON, so the inline command/executor/cleanup travel with the step. Contained change, keeps LOTL data in its own model.

**Alternative (not recommended):** ingest LOTL entries as `AtomicTest` rows (`source="lotl-<library>"`). Reuses the runner untouched, but pollutes the Atomic Red Team library and fights `AtomicTest`'s `[techniqueId, testNumber]` unique key for entries with no clean MITRE mapping.

---

## Phased rollout

1. **Phase 1 — Marketplace cleanup (Part A).** Sidebar edit + uninstall round-trip. Low risk, ship first.
2. **Phase 2 — Data layer.** Add `LotlTechnique` / `LotlSyncMeta` / `LotlGroup`, `prisma db push`, restart dev server.
3. **Phase 3 — Sync (LOLBAS + GTFOBins).** `src/lib/lotl/sync.ts` + two source parsers + sync/updates APIs. Verify row counts.
4. **Phase 4 — Browse UI.** `LotlLibraryBrowser` + `GET /api/lotl/[library]` + library cards in `TechniqueCatalogView` + module sub-route.
5. **Phase 5 — Groups + simulation.** `LotlGroup` API, multi-select + save-group UI, `POST /api/lotl/simulate`, `framework:"lotl"` in the runner, end-to-end simulate-and-validate test.
6. **Phase 6 — Remaining sources.** Port the other 8 parsers (loldrivers, lolrmm, loobins, lolapi, loltunnels, persistence_info, loas, sysinternals).

## Risks / notes

- **Live-fire safety:** several libraries (LOLDrivers BYOVD, LOTTunnels, Sysinternals download/exec) are genuinely dangerous on real hosts. Keep the existing consent/approval + `simulate-only` default and audit logging; gate real execution behind the same guards as Atomic Red Team. Default new groups to simulate-only.
- **Disk:** root volume is chronically ~99%. Ingesting ~3,000 entries is small, but run syncs with the dev server's `.next` cache in a healthy state.
- **MITRE mapping:** some sources (GTFOBins, Sysinternals) map loosely to ATT&CK; `techniqueId` is nullable, and scoring simply reports `n/a` where unmapped. That is acceptable and already how stubbed steps behave.
- **Content size:** store commands as-is; no need to chunk.

## Open question for sign-off

Confirm the recommended execution model (`framework:"lotl"` inline command in the runner) vs ingesting LOTL entries as `AtomicTest` rows. Everything else follows the Atomic Test Library pattern and needs no decision.
