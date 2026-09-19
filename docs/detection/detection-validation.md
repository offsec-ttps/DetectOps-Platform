# Detection Validation

**Route:** `/detection-validation` · **Sidebar:** Detection → Detection Validation

Detection Validation checks whether your detection logic actually fires against a SIEM backend — the "did it work?" half of the purple-team loop. It shares the coverage-validation concept used by the [Enterprise Use-Case runner](../simulation/enterprise-use-cases.md).

## What it does

- Take a detection's logic and run it against the configured SIEM.
- Report whether it fired, with evidence, over a chosen time window.
- Surface coverage gaps so you know which techniques are blind spots.

## How it relates to simulation

Validation is most powerful right after a simulation: run an attack, then validate that the detection meant to catch it produced results within the run window. The Enterprise runner automates exactly this in `simulate-and-validate` mode via `validateCoverage()`; the standalone Detection Validation page lets you validate detections on demand, independent of a run.

## SIEM connectivity

Validation queries whatever SIEM/integration you've configured under [Integrations](../system/integrations.md) (e.g. Splunk via `SPLUNK_HOST` / HEC settings). Compatibility across backends is summarized in the SIEM-compatibility matrix on the Enterprise Use Cases list page.

## Per-environment SIEM connections

The [Campaign Designer](../simulation/campaign-designer.md)'s **Simulation & Detection** mode binds each environment to its **own** SIEM, so detection works no matter where the attack ran:

| Environment | Default detection source |
|---|---|
| **Local Lab** | the local SAR Splunk — **auto-resolved** from `attack_range_local.conf` (zero setup) |
| **Cloud Lab** | a cloud-scoped Splunk connection |
| **Fleet / C2** | **Microsoft Defender for Endpoint (MDE)** by default; bring-your-own Splunk optional |

**Supported SIEMs (bring-your-own-key):**

- **Splunk** — REST base URL + an auth token (or user/password). Runs SPL through a 5-strategy check (ESCU saved searches, fired alerts, notable index, direct SPL, raw-telemetry).
- **Microsoft Defender for Endpoint (MDE)** — an Azure AD app registration (tenant + client id + client secret) with Graph `ThreatHunting.Read.All` (admin-consented). Runs **KQL** through Microsoft Graph **Advanced Hunting** (`runHuntingQuery`); a non-empty result set = detected.

Connections are created from the "Detection SIEM" banner in the Sim & Detection panel (**Connect a SIEM**). Secrets are **AES-256-GCM encrypted at rest** (credential vault) and never returned by the API.

**Architecture:** a SIEM **provider registry** (`src/lib/siem/`) with `splunk` and `mde` providers; connections stored as `SiemConnection` (`siem_connections`); the unified endpoint `POST /api/siem/[id]/detect` dispatches SPL or KQL; `GET /api/siem/resolve?source=` picks the right connection per environment (auto-provisioning local). The Campaign Designer's real-time retry loop is reused for both.

!!! note "MDE query language"
    MDE runs **KQL**, not SPL. For MDE targets, edit each rule's query to KQL in the results panel (SPL rules won't run on MDE). Automatic SPL→KQL conversion is a planned enhancement.

## Related

- [Enterprise Use-Case Validation](../simulation/enterprise-use-cases.md) — scored, repeatable runs with coverage promotion.
- [Analytics](../operations/intelligence.md) — coverage heatmaps and metrics.
