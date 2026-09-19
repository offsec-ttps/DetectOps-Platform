# Attack Simulations

**Route:** `/simulations` · **Sidebar:** Preparation → Attack Simulations

A grid of simulation categories, each mapping real-world adversary tradecraft to atomic tests you can run against your environments. The grid is driven by live `SimulationModule` rows (`GET /api/simulations`); each tile opens that module's rich view at `/modules/{moduleId}`.

## Atomics Execution

The first tile, **Atomics Execution**, links straight to the [Atomic Test Library](../content/atomic-test-library.md) — browse and run the full Atomic Red Team corpus directly against your environments.

## First-party modules

Seeded in `src/lib/modules/seed-simulations.ts`:

### Living off the Land (LOTL) — `detectops.lotl-sim`
LOLBin execution, ingress/proxy execution, and native recon/persistence techniques. Opens a technique-catalog view where you pick techniques and dispatch them as atomic tests.

### Phishing Simulation — `detectops.phishing-sim`
A multi-mode, **authorized, defensive** phishing module: curated training templates, a reference tool catalog, and AI-generated training lures.

- **Approval-gated, audited, consent-required, dummy-data-only**, with a global **kill switch**.
- 50+ built-in templates across 10+ industry verticals (file-based under `packs/phishing/`).
- APIs under `/api/phishing/`: `campaigns` (+ `/[id]/launch`, `/approve`, `/abort`), `ai/generate`, `templates`, `kill-switch`, `tools`.
- Launches map back to ATT&CK phishing techniques for detection scoring.

### Ransomware Simulation — `acme.ransomware-sim`
Self-hosted intel collectors track ransomware gangs and victims; one click turns a gang's known TTPs into an atomic adversary simulation.

- Uses the `ransomware-intel` view. APIs under `/api/ransomware-intel/`: `collect` (+ `/tick`), `gangs` (+ `/[name]`, `/enrich`), `simulate`, `screenshot`, `keys`.
- A key-gated public read API is exposed under `/api/ransomware-intel/v1/` (`groups`, `victims`, `recent`, `stats`, `search`).

## Running a module

`/modules/[moduleId]/[[...sub]]` renders the module's contributed view. A run compiles the module's declarative steps into the platform's `ScenarioStep[]` and executes them (`POST /api/modules/[moduleId]/run`) against a selected environment target (`/api/environment-targets`). Scenarios are available at `/api/modules/[moduleId]/scenarios`.

## Extending

New modules are authored and installed through the [Module Marketplace](../system/module-marketplace.md), which validates a declarative manifest, optionally signs it, and lets it contribute nav entries, a view, and scenarios.
