# Rule Workspace

**Route:** `/rule-workspace` · **Sidebar:** Engineering → Rule Workspace

The Rule Workspace is a Sigma authoring environment: edit draft rules, convert them to SIEM backends with pySigma / the Sigma CLI, and open a GitHub pull request straight from a draft.

## What it does

- **Author / edit** draft Sigma rules.
- **Convert** a rule to a target backend (Splunk SPL, Elastic, KQL, etc.) via `POST /api/rule-workspace/sigma-convert` — this uses the Sigma CLI in `backend/.venv` (`SIGMA_CLI_PATH`).
- **Promote candidates** — surface conversion candidates (`/api/rule-workspace/candidates`).
- **Open a PR** — turn a draft into a GitHub PR (`/api/rule-workspace/drafts/[id]/create-pr`), enabling detection-as-code review.

Every action is written to a workspace audit log (`src/lib/rule-workspace/audit.ts`).

## Prerequisites

Sigma conversion needs the Python Sigma CLI venv created during [installation](../getting-started/installation.md) (`backend/.venv`, from `backend/requirements.txt`). If the CLI isn't present, conversion degrades gracefully and rules stay unvalidated.

## APIs

`/api/rule-workspace/`: `candidates`, `drafts` (+ `/[id]`, `/[id]/create-pr`), `sigma-convert`.

## Related

- [Community Content](../content/community-content.md) — many community rules are Sigma and can be converted here.
- [SigmaGen AI](../content/sigmagen-ai.md) — generates Sigma rules that you can refine in the workspace.
- [Detection Packs](../detection/detection-packs.md) — bundles of generated Sigma rules + IR playbooks.
