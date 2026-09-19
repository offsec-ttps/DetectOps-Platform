# Local Lab

**Route:** `/deploy` → Local Lab · **Component:** `src/components/deploy/LocalDeployFlow.tsx`

The Local Lab spins up **VirtualBox / Vagrant** virtual machines directly on the host running DetectOps — a self-contained Splunk Attack Range (SAR), optionally combined with GOAD (Game of Active Directory). Best for self-hosted installs and local evaluation.

!!! note "Self-hosted only"
    Local Lab requires `PLATFORM_MODE=self-hosted`. Otherwise the card is disabled in the Deploy hub.

## Prerequisites

Checked live via `GET /api/detection-lab/system-info`:

- **VirtualBox** and **Vagrant** are required (hard gate).
- **Ansible** (via the GOAD venv `~/.goad/.venv`) and **Docker** are optional depending on the template.
- Sufficient host RAM / CPU / free disk for the chosen template (enforced by `canRunTemplate()`).

See [Prerequisites](../getting-started/prerequisites.md) for versions and the [SAR + GOAD Integration guide](../sar-goad-integration/README.md) for the authoritative resource table.

## Using it

1. **Open** Deploy → Local Lab. The panel shows a **Host prerequisites & resources** check (RAM, CPU, free disk, and detected tooling) with a Refresh button.
2. **Pick a template.** Templates come from `config/lab-templates/` (e.g. *SAR Minimal*, *SAR Standard*, *SAR + GOAD Minimal/Standard/Full*, *SAR Cloud Deployment Docker*). Each lists its VM definitions (role, OS, IP, vCPU, RAM, disk, services) and required resources. Infeasible templates are flagged before you can deploy.
3. **Deploy in phases.** The flow drives `POST /api/detection-lab/deploy` through phases (`prepare` → `sar` → `goad`/`tools`), polling for live status. A SAR+GOAD deploy prepares sources, builds Splunk + DC, verifies Splunk Web + receiver, then stands up the AD lab with Splunk Forwarder + Sysmon.
4. **Auto-register.** When every phase succeeds, the lab registers into the simulation pipeline (`POST /api/deploy/register`) and appears as a target in the [Campaign Designer](../simulation/campaign-designer.md).

## Installed labs on this host

Below the deploy flow, the **Installed on this host** panel lists labs already deployed locally, deduplicated against live VirtualBox state so a VM never shows twice. Each row shows:

- Status (running / stopped / partial / installed / missing) and VM count
- The **template** used to deploy it
- **Resource consumption** (vCPU / RAM / disk) read from VirtualBox
- Start / Stop controls and an Access link

## How execution works

Once deployed, simulations run against Local Lab VMs one of two ways:

- **Splunk Attack Range path** — `POST /api/sar/simulate` spawns the SAR CLI, which uses **Ansible over WinRM** to run `Invoke-AtomicTest` (Atomic Red Team) on the Windows host, then the Splunk Universal Forwarder ships telemetry back to Splunk for scoring.
- **SSH path** — for template-deployed environments registered as `our-template-deployed`, the [enterprise runner](../simulation/enterprise-use-cases.md) executes ART commands over SSH.

## Lifecycle scripts

For headless / scripted management, `scripts/sar-goad-orchestrator.sh` supports `deploy | start | stop | status | forwarder | verify | destroy` (reads `scripts/.env.sar-goad`).

## Advanced console

The **Detection Lab (advanced)** page (`/detection-lab`) is the power-user console behind the hub: raw blueprint/config editing, template registry, direct VM control (`/api/detection-lab/vm`), and validation (`/api/detection-lab/validate`).

## Tearing down

Use [Manage Labs → Local Labs](manage-labs.md) to safely destroy VMs and remove the deployment (real `vagrant destroy` / SAR destroy + registry cleanup), or to remove source-tree installs by deleting their VMs.
