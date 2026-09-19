# Detection Packs

**Route:** `/detections/packs` · **Sidebar:** Detection → Detection Packs

A Detection Pack is an **AI-generated bundle of Sigma rules plus an incident-response playbook**, produced from a single detection rule or a threat-intel report. Packs are the shared output format that [SigmaGen AI](../content/sigmagen-ai.md), the [Threat Aggregator](../content/threat-aggregator.md), and manual generation all converge on.

## What it does

- **Generate from a rule** (`/api/detection-packs/generate-from-rule`) or **from threat intel** (`/api/detection-packs/generate-from-ti`).
- Produce Sigma-first `DetectionRule` rows plus an IR playbook (`/[id]/ir-playbook`).
- **Bulk regenerate** and **push to GitHub** (`/bulk-regenerate`, `/[id]/github-push`).
- Run as an **async job queue** with retry and a tick worker (`/jobs`, `/jobs/[id]/retry`, `/jobs/tick`); a queue view lives at `/detections/packs/queue`.

## Generator

`src/lib/detection-packs/`:

- `generator.ts` (`generateDetectionPack`) — the core generation flow.
- `infer-sims.ts` (`inferSimulations`) — maps techniques to ART / PurpleSharp / Stratus simulations.
- `github-export.ts` — detection-as-code export.
- `budget.ts` — enforces `DETECTION_PACK_DAILY_TOKEN_BUDGET` / `DETECTION_PACK_PER_JOB_ESTIMATE`.

## APIs

`/api/detection-packs` (+ `/[id]`, `/[id]/github-push`, `/[id]/ir-playbook`), `/generate-from-rule`, `/generate-from-ti`, `/bulk-regenerate`, `/jobs` (+ `/[id]/retry`, `/tick`).

## Related

Detection Packs are queued automatically when the [Threat Aggregator](../content/threat-aggregator.md) ingests a new report, and are one of the artifacts a [SigmaGen AI](../content/sigmagen-ai.md) run produces.
