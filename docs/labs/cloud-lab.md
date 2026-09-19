# Cloud Lab

**Route:** `/deploy` → Cloud Lab · **Components:** `src/components/detection-lab/cloud/CloudTab.tsx`, `deploy/CloudReadinessPanel.tsx`, `deploy/CloudRegisterPanel.tsx`

The Cloud Lab deploys a **Splunk Attack Range (SAR)** — optionally with **GOAD** — into **your own cloud account** (AWS, Azure, or GCP) using your credentials and the official SAR templates. It scales per tenant and keeps the VMs off your host.

## How it works

Cloud provisioning is brokered by the **Cloud Controller** — the Splunk Attack Range v3 controller (a **Flask API** on `:4000` + an **Astro UI** on `:4321`). The controller source is extracted into **`cloud-lab-app/`** in the repo and runs **locally** (Python venv + Node); `start-server.sh` launches it alongside the web app (opt out with `--no-cloud`). Its origin was the *"SAR Cloud Deployment Docker"* template. DetectOps talks to it through proxies:

- Browser → `src/lib/sar-client.ts` → `/api/detection-lab/cloud/[...path]` (proxy) → controller.
- Build, status, list, destroy, share, and rename operations map to controller endpoints.
- Terminal output streams back over SSE (`/api/detection-lab/cloud/terminal/...`).

### Cloud lab templates on the page

Directly below the **Pre-deploy readiness** panel, the **Cloud lab templates** panel (`deploy/CloudTemplatesPanel.tsx`) lists every template the controller offers (AWS/Azure/GCP) — name, description, host count, and per-provider CLI availability. It reads them live through `GET /api/cloud-lab/templates`, a same-origin proxy to the controller's `/templates`; if the controller isn't running it degrades to a short hint. Open any template in the full Cloud Controller UI (`:4321`) to configure and launch it.

## Prerequisites

1. **Cloud credentials** — store AWS/Azure/GCP creds in [Settings → Cloud Credentials](../system/settings.md). They are encrypted at rest with `CREDENTIAL_VAULT_KEY` (`src/lib/crypto/credential-vault.ts`).
2. **SAR controller reachable** — the readiness panel checks provider CLIs are installed and authenticated in the controller and that the controller responds.

## Using it

1. **Open** Deploy → Cloud Lab. The **Cloud Readiness** panel reports controller health and provider availability.
2. **Pick a template** — e.g. *AWS SAR Minimal* (Splunk + Windows DC), *AWS SAR + GOAD* (Splunk + nested GOAD MINILAB), *Azure SAR*, *GCP SAR*. Templates come from `config/lab-templates/` (cloud set) and the controller's own template list.
3. **Build** — the range provisions in your cloud. Progress streams to the terminal panel; the range appears in the list with a status (`queued` → `build_vpn` → `wait_for_vpn` → `build_lab` → `running`).
4. **Activate the WireGuard tunnel** — see below. The build **stops** at `wait_for_vpn` and cannot continue until you do this.
5. **Connect** — running ranges expose a WireGuard config and (for RDP/SSH targets) Guacamole access details.
6. **Register** — `CloudRegisterPanel` / `POST /api/deploy/register` makes the range a selectable target in the [Campaign Designer](../simulation/campaign-designer.md).

## The WireGuard step (required — builds fail without it)

A cloud build runs in **two phases** with a deliberate pause between them:

| Phase | What happens | Reaches hosts via |
| --- | --- | --- |
| `build_vpn` | Terraform creates the VPC and the WireGuard **router** | router's public IP |
| `wait_for_vpn` | **Paused — waiting for you** | — |
| `build_lab` | Ansible installs Splunk / Windows / Kali | the lab's **private** IPs (`10.0.2.x`) |

The lab phase talks to private IPs that are only routable **through the tunnel**, and the tunnel runs on your host — the controller never brings it up (its Docker image ships without `NET_ADMIN` or the WireGuard package, so this has always been a manual step).

Continuing past the pause without an active tunnel is the single most common cause of a "stuck" build: Ansible retries unreachable hosts for ~45 minutes, logs `unreachable=1`, and the build thread dies — while the EC2 instances keep running and billing.

**Activate and resume in one step:**

```bash
scripts/cloud-lab-connect.sh            # verifies, then resumes the build
scripts/cloud-lab-connect.sh --status   # tunnel + range + reachability
scripts/cloud-lab-connect.sh --down     # tear the tunnel down
```

It activates the tunnel (`sudo` is needed only for `wg-quick`, which creates a network interface), **proves** a lab host answers on `:22`, and only then resumes the build — refusing to start the phase otherwise. It also restarts the controller automatically if a previous dead build left stale state behind.

In the UI the equivalent button is **"Verify tunnel & continue"**, which runs the same server-side reachability check via `/api/detection-lab/cloud/vpn-check/[range_id]`.

!!! warning "Route conflict with the local lab network"
    The cloud VPC uses `10.0.1.0/24` for its VPN subnet and `10.0.2.0/24` for lab hosts — and the local VirtualBox lab (`vboxnet4`) also uses **`10.0.1.0/24`**. `wg-quick` installs a route per `AllowedIPs` entry and treats one failure as fatal, so it aborts the whole tunnel with `RTNETLINK answers: File exists` and rolls it back.

    `cloud-lab-connect.sh` handles this: it sets `Table = off` on the config and installs the routes itself, skipping any subnet a local interface already owns. Only `10.0.2.0/24` is actually required for the build, so the local lab keeps `10.0.1.0/24` and both work side by side. The trade-off is that the cloud **router's** internal address (`10.0.1.10`) is not reachable while `vboxnet4` is up — harmless, since Ansible and Splunk both live on `10.0.2.x`.

    Also note the interface name comes from the config **filename**, capped at 15 characters — the controller's `<uuid>.conf` (36) is rejected outright, which is why the script works from a short-named copy (`wg-<short-id>.conf`).

!!! warning "If the tunnel connects but hosts stay unreachable"
    The router's security group is pinned to the public IP recorded at build time (`general.ip_whitelist`). If your public IP changed since the build, `wg` will show no handshake. Compare `curl -s https://api.ipify.org` against the range config and re-sync the security group.

## Running simulations against a cloud range

In the Campaign Designer, cloud targets are dispatched through the SAR controller's `/attack-range/simulate` endpoint (`POST /api/detection-lab/cloud/attack-range/simulate`). Target the **server name** from the range's architecture (e.g. `win`, `splunk`), not its IP. The first run installs Atomic Red Team / tooling and can take 1–3 minutes.

## Tearing down

Cloud ranges cost money while running — destroy them when done. Use [Manage Labs → Cloud Labs](manage-labs.md), which lists ranges via `sarListRanges()` and calls `sarDestroyRange()` (or `sarAbortRange()` for an in-progress build) to release cloud resources.
