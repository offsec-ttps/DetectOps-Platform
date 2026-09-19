# Agentic Sync

**Route:** `/agentic-sync` · **Sidebar:** GitHub Operations → Agentic Sync

Automated repository and detection synchronization workflows — keep the platform's detection inventory aligned with your upstream detection repositories without manual copying.

## What it does

- Runs sync workflows that reconcile detections between the platform and your Git repos.
- Complements [PR Management](pr-management.md) (the review side) and the [OpenTide Orchestrator](orchestrator.md) (the reconcile loop for deployed detections).

## Related

- [Detections](../engineering/detections.md) — the inventory being synced.
- [CI/CD](cicd.md) — pipeline status for the sync/deploy flow.
