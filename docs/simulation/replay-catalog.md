# Replay Catalog

**Route:** `/replay-catalog` · **Sidebar:** Simulation → Replay Catalog

The Replay Catalog lets analysts browse **pre-recorded attack datasets** and replay them into Splunk via **HEC (HTTP Event Collector)** — validating detections against realistic telemetry without running a live attack.

## What it does

- Browse a local Splunk `attack_data` repository of labeled datasets (`ATTACK_DATA_ROOT`).
- **Save** datasets of interest and assemble **replay plans**.
- **Replay** a plan into Splunk over HEC so detections fire against recorded events.
- Keep a **history** of replays.

## Configuration

| Variable | Purpose |
|----------|---------|
| `ATTACK_DATA_ROOT` | Path to the local attack-data repo. |
| `ENABLE_ATTACK_DATA_REPLAY` | Master switch. |
| `ENABLE_REPLAY_BUILD`, `ENABLE_REPLAY_SAVE_FOR_LATER` | Feature toggles for building plans and saving datasets. |
| `SPLUNK_HEC_PORT`, `SPLUNK_HEC_TOKEN` | Splunk HEC endpoint used for replay. |

HEC settings can also be discovered/tested in-app via `/api/replay/hec-config` (+ `/discover`, `/test`).

## APIs

`/api/replay/`: `catalog`, `saved`, `plans`, `execute`, `history`, `refresh`, `hec-config`.

## When to use it

Replay is **additive** to live simulation: use it to regression-test detections against known-good telemetry, or when you can't (or don't want to) detonate a technique live. For live execution against real targets, use the [Campaign Designer](campaign-designer.md) or [Enterprise Use-Case Validation](enterprise-use-cases.md).
