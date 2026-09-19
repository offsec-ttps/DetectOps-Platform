# Threat Modeling

**Route:** `/threat-modeling` · **Sidebar:** Engineering → Threat Modeling

Threat Modeling & ATT&CK Mapping lets you build and store threat models and map them onto the MITRE ATT&CK matrix, giving you a technique-level picture of what an adversary might do against your environment.

## What it does

- Create `ThreatModel` records describing an adversary, campaign, or asset.
- Map each model onto ATT&CK tactics/techniques.
- Use the mapping to drive downstream work — the same technique IDs connect to [Attack Simulations](../simulation/attack-simulations.md), the [Detection Library](../content/community-content.md), and [coverage analytics](../operations/intelligence.md).

## API

`/api/threat-models` (backing store `ThreatModel`).

## Where it fits

Threat models are the "why" at the top of the loop: they justify which techniques to simulate and which detections to prioritize. Pair with [SigmaGen AI](../content/sigmagen-ai.md) to turn a modeled threat into concrete detections, and with [Detection Validation](../detection/detection-validation.md) to prove coverage.
