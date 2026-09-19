# Detection Lab (advanced)

**Route:** `/detection-lab` · **Sidebar:** Preparation → Detection Lab (advanced)

Detection Lab is the power-user console behind the [Deploy hub](../labs/deploy-hub.md). Where the hub gives a guided, phased deploy, this page exposes the raw building blocks for deep control of on-prem and cloud detection-engineering infrastructure.

## What it does

- **Blueprints & config** — edit the raw lab blueprint and configuration (`/api/detection-lab/blueprint`, `/config`).
- **Template registry** — browse and manage lab templates (`/api/detection-lab/templates`, `/registry`) from `config/lab-templates/`.
- **Host inspection** — live RAM/CPU/disk and prerequisite probes (`/api/detection-lab/system-info`).
- **VM control** — start/stop/poweroff/restart/savestate/delete individual VMs (`/api/detection-lab/vm`).
- **Validation** — validate a deployment/blueprint (`/api/detection-lab/validate`).

## When to use it

Use the [Deploy → Local Lab](../labs/local-lab.md) flow for a normal, guided deployment. Drop to Detection Lab when you need to inspect or tweak the blueprint, drive VMs individually, or debug a deploy.

## APIs

`/api/detection-lab/`: `blueprint`, `config`, `deploy`, `registry`, `system-info`, `templates`, `validate`, `vm`.

## Related

- [Local Lab](../labs/local-lab.md) — the guided deploy flow.
- [Manage Labs](../labs/manage-labs.md) — safe teardown.
