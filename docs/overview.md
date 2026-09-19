# Overview

**Route:** `/overview` · **Sidebar:** Overview (top level)

The Overview is the dashboard landing page — a detection-engineering cockpit that summarizes posture at a glance: detection counts, ATT&CK coverage, recent simulation activity, and validation outcomes.

## What you see

- **KPI tiles** — total detections, coverage %, recent runs, and validation status.
- **Recent activity** — the latest simulations, packs, and syncs.
- **Coverage snapshot** — a quick read on ATT&CK blind spots (full heatmaps live under [Intelligence → Analytics](operations/analytics.md)).

Data is aggregated by `GET /api/overview`.

## Where to go next

This documentation is organized to mirror the dashboard sidebar exactly, so you can jump straight to the area you care about:

| If you want to… | Go to |
|-----------------|-------|
| Author or generate detections | [Engineering](engineering/index.md) |
| Stand up a lab or fleet | [Preparation](preparation/index.md) |
| Run attacks and validate coverage | [Simulation](simulation/index.md) |
| Manage detection inventory | [Detection](detection/index.md) |
| Detection-as-code / repos | [GitHub Operations](operations/github-operations.md) |
| Pipelines & data lakes | [Infrastructure](operations/infrastructure.md) |
| Reporting & analytics | [Intelligence](operations/intelligence.md) |
| MCP, integrations, settings | [System](system/index.md) |
| Tear down environments | [Manage Labs](labs/manage-labs.md) |
