# OpenTide Orchestrator

**Route:** `/orchestrator` · **Sidebar:** Infrastructure → OpenTide Orchestrator

Orchestrates the **OpenTide** detection-as-code lifecycle and reconciliation. The reconcile loop keeps deployed detections in sync with their source-of-truth definitions.

## What it does

- Drives the detection-as-code lifecycle across environments.
- Reconciles deployed state against desired state (`/api/v1`, `/api/v1/reconcile`).

## Related

- [Agentic Sync](agentic-sync.md) — repo-side synchronization.
- [CI/CD](cicd.md) — pipeline status feeding the deploy step.
