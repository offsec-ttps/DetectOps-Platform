# Prerequisites

DetectOps runs as a single Next.js application. The **core app** has a small set of hard requirements; the **lab / simulation** features add optional host tooling you only need when you actually stand up local VMs, cloud ranges, or fleet agents.

## Core (required)

| Requirement | Version | Why |
|-------------|---------|-----|
| **Node.js** | **22+** | Enforced by `start-server.sh` and the Docker images (`node:22-*`). The dev server runs in webpack mode. |
| **npm** | bundled with Node | Dependency install and scripts. |
| **Python** | **3.10+** | Creates the Sigma CLI virtualenv (`backend/.venv`) used by the [Rule Workspace](../engineering/rule-workspace.md) and SigmaGen validation. Optional if you never convert Sigma rules. |

The database is **SQLite** (via Prisma 7). A pre-populated `dev.db` ships in the repo (~500 MB, containing the community rules, IOCs, and threat-intel corpus), so there's no external database server to run.

## Optional — LLM providers

AI features (SigmaGen AI, Detection Packs, AI assistants, module AI-validation) call an LLM. Configure at least one provider via [Settings → LLM Providers](../system/settings.md) or environment variables. Supported: **Anthropic, OpenAI, OpenRouter, NVIDIA, Ollama** (local). Provider selection precedence is documented in [Configuration](configuration.md).

## Optional — Lab & simulation host tooling

These are probed at runtime by `GET /api/detection-lab/system-info` and reported as warnings (not hard failures) by `start-server.sh`. Install only what the lab type you want requires.

| Tool | Needed for | Check |
|------|-----------|-------|
| **VirtualBox** (6.1+) | [Local Lab](../labs/local-lab.md) VMs | `VBoxManage --version` |
| **Vagrant** (2.2+) | Local Lab provisioning | `vagrant --version` |
| **Ansible** (2.9+) | GOAD/SAR provisioning (via the GOAD venv `~/.goad/.venv`) | `~/.goad/.venv/bin/ansible --version` |
| **Docker + Compose** | SAR "Cloud Deployment Docker" controller, containerized deploys | `docker --version` / `docker compose version` |
| **`gh` (GitHub CLI)** | PR creation, detection-as-code sync, FastAPI backend | `gh --version` |
| **Stratus Red Team CLI** | [Cloud detonation](../simulation/enterprise-use-cases.md) of cloud attack techniques | `stratus version` (or set `STRATUS_BIN`) |

!!! note "Local Lab is self-hosted only"
    The Local Lab option is gated to self-hosted installs. Set `PLATFORM_MODE=self-hosted` so `/api/deploy/capabilities` reports `localAvailable: true`.

### Local Lab resource guidance (SAR + GOAD)

Standing up a full SAR + GOAD range on the host is resource-heavy. As a baseline (see the [SAR + GOAD Integration](../sar-goad-integration/README.md) guide for the authoritative table):

- **RAM:** 12 GB+ (16 GB+ recommended for SAR + GOAD Minimal)
- **Disk:** 60 GB+ free
- **CPU:** 6+ cores

Per-template requirements are enforced by `canRunTemplate()` (`config/lab-templates/`) before a deploy is allowed.

## Cloud & Fleet

- **Cloud Lab** needs cloud provider credentials (AWS / Azure / GCP) stored in [Settings → Cloud Credentials](../system/settings.md) (encrypted at rest) and, for the SAR-in-cloud controller, the SAR Docker controller running.
- **Fleet Server** needs the lightweight signed agent installed on the target endpoints — no inbound ports are required on the endpoint (the agent polls out). See [Fleet Server](../labs/fleet-server.md).

Next: [Installation](installation.md).
