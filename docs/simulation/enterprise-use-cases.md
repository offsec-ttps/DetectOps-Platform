# Enterprise Use-Case Validation

**Route:** `/detections/enterprise` · **Sidebar:** Simulation → Enterprise Use Cases

Enterprise Use Cases turn a detection into a **repeatable, scored validation**: define scenarios (attack steps), run them against an environment, and — in validate mode — automatically check whether the detection logic actually fired in your SIEM. The result walks the use case toward a sticky `validated` status.

## Pages

- **List** (`/detections/enterprise`) — all use cases plus a validation / SIEM-compatibility matrix.
- **Detail** (`/detections/enterprise/[id]`) — scenarios, detection logic (original / recommended / edited variants), run history, reports, and comments.
- **Upload** (`/detections/enterprise/upload`) — bulk import (≤ 5 MB) with a commit step.

## The runner

The core is `runScenario()` in `src/lib/enterprise-use-cases/runner.ts`. Lifecycle of one run:

1. Validate scenario, environment, mode, and the selected detection-logic variant.
2. Insert an `EnterpriseUseCaseRun` (status `running`).
3. Execute steps sequentially (per-step budget ~60s; overall cap `ENTERPRISE_UC_RUN_TIMEOUT_MS`, default 300s).
4. In validate mode, run coverage validation against your SIEM.
5. Persist step results, logs, detection results, and the coverage outcome.

### Two modes

| Mode | Behavior |
|------|----------|
| `simulate-only` | Executes the attack steps only. |
| `simulate-and-validate` | Also calls `validateCoverage()` against the user's SIEM within the run's time window, recording `detectionResults` + `validationOutcome`. |

### Dispatch matrix

Each step is routed by `dispatchStep(env.kind × step.framework)`:

| Environment kind | Framework | Executor |
|------------------|-----------|----------|
| `our-template-deployed` | `atomic` | **SSH-exec** the resolved ART command (real). The ART `testGuid` is looked up in the `AtomicTest` catalog; input-argument values that contain shell metacharacters are rejected by a `SHELL_INJECTION` guard. |
| `our-template-deployed` | `manual` | SSH-exec `parameters.command`. |
| `user-cloud` | `stratus` | **Stratus Red Team** (`src/lib/stratus/runner.ts`); creates a `StratusExecution`, defaulting to a safe **dry-run** phase. |
| `agent` (caldera) | atomic/manual/agent | **Caldera** (`caldera-runner.ts`). |
| `agent` (native fleet) | — | Runs via the [fleet](../labs/fleet-server.md) signed job-poll pipeline. |
| other combos (purplesharp, shell, unsupported) | — | Stub runners (`stub-runners.ts`). |

### Coverage scoring

`validateCoverage()` (`src/lib/enterprise-use-cases/validate-coverage.ts`) queries the configured SIEM for the run's time window and returns a `CoverageOutcome` (e.g. `matched`, `n/a`, `error`).

- A run whose steps are **all stubbed** is forced to `n/a` (stubs never count as matched).
- A `matched` result in `simulate-and-validate` with non-stub steps **sticky-promotes** the use case to `validated`.

### Safety gate

Destructive environment kinds (`user-cloud`, `shell`) in validate mode require `confirmDestructive=true` before the run proceeds.

## APIs

Under `/api/enterprise-use-cases/`: base list; per-id `route`, `scenarios` (+ `/[sid]`, `/auto-suggest`), `runs` (+ `/[runId]`, `/report`, `/github-push`), `validate`, `preflight`, `promote`, `recommend`, `status`, `comments`, `community-matches`, `selected-logic`, `multi-format-logic`, `generate-multi-format`; `upload` (+ `/[batchId]/commit`); and the background worker `runs/tick`.

## Where scenarios come from

Scenarios are `ScenarioStep[]` — the same shape produced by the [Custom Simulation Builder](custom-simulation-builder.md), module compilation, and `auto-suggest`. Environments are managed in [Enterprise Environments](enterprise-environments.md).
