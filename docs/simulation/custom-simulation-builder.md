# Custom Simulation Builder

**Route:** `/use-cases` · **Sidebar:** Simulation → Custom Simulation Builder

The Custom Simulation Builder lets you compose your own adversary simulations (use cases) and export them as playbooks the [enterprise runner](enterprise-use-cases.md) can execute. Three composition modes cover hand-authoring, structured playbooks, and visual chaining.

## Composition modes

Pick a mode from `/use-cases/new`:

| Mode | Route | What you build |
|------|-------|----------------|
| **Atomic (ART YAML)** | `/use-cases/atomic` | Author or adapt Atomic Red Team test YAML with a technique picker, repo loader, and an AI assistant. |
| **PurpleSharp playbook** | `/use-cases/purplesharp` | Compose a PurpleSharp playbook JSON (54 techniques / 64 variations) for Windows AD. |
| **Canvas (visual DAG)** | `/use-cases/canvas` | Drag-and-drop a directed graph of steps, then compile it to an ordered `ScenarioStep[]`. |

The canvas compiles (`/api/use-cases/[id]/canvas/compile`) and exports (`/api/use-cases/[id]/export`) to **ART YAML**, **PurpleSharp JSON**, or **Stratus**.

## AI helpers

- `POST /api/use-cases/ai/atomic-test` — draft an atomic test from a prompt.
- `POST /api/use-cases/ai/from-rule` — derive a simulation from a detection rule.
- `POST /api/use-cases/ai/from-ti` — derive a simulation from threat intel.

## Importing existing content

- `/use-cases/upload` and `/api/uploaded-detections` (+ `/[id]/to-use-case`) turn uploaded detections into use cases.
- PurpleSharp catalogs are kept fresh via `/api/purplesharp-templates` and `/api/purplesharp-variations` (each with a `/sync`).

## Output

A saved `UseCase` plus an exportable playbook. Because the output is `ScenarioStep[]`, it plugs directly into [Enterprise Use-Case Validation](enterprise-use-cases.md) for scored, repeatable runs, and into the [Campaign Designer](campaign-designer.md) for ad-hoc execution.

Builder libs/components live in `src/lib/use-cases/` and `src/components/use-cases/` (`AtomicBuilder`, `TechniquePicker`, `RepoLoader`, `AiAssistantBar`, `yaml-merge.ts`).
