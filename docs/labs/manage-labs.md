# Manage Labs

**Route:** `/manage-labs` · **Sidebar:** Manage Labs

Manage Labs is the safe-teardown console for everything you've stood up. It has three tabs (deep-linkable via `?tab=local|cloud|fleet`), and every destructive action is a **two-step arm → confirm** button that reports exactly what it did. Nothing here merely hides a row — each action calls the real teardown backend.

## Local Labs

Lists installed environments from `GET /api/detection-lab/system-info`, deduplicated against live VirtualBox state. Each card shows the template used, on-disk **path**, VMs, and status.

- **Platform-managed deploys** (created via the Deploy hub) get **Start / Stop** and **Destroy** actions:
    - **Stop / Start** (`POST /api/detection-lab/deploy {action:"stop"|"resume"}`) — power the lab's VMs off/on **without destroying** them, so you run your infra only when you need it (protects memory/disk). This deterministically powers off/on the deploy's VMs **by their exact prefixed names** (from `deployment.json`), so it works even when SAR/vagrant state is stale.
    - **Destroy** (`POST /api/detection-lab/deploy {action:"destroy"}`) — runs `vagrant destroy` / SAR destroy / `docker compose down -v`, then power-offs + `unregistervm --delete`s the VMs by name, removes the deploy directory, and unregisters it.
- **Source-tree installs** (e.g. a standalone SAR/GOAD checkout, no `deployment.json`) get a **Remove VMs** action → deletes each VM from VirtualBox (`POST /api/detection-lab/vm {action:"delete"}` = power off + `unregistervm --delete`). This makes the lab disappear everywhere in the platform. The source directory on disk is left untouched.

## Cloud Labs

Lists SAR ranges via `sarListRanges()`.

- **Terminal ranges** → **Destroy** (`sarDestroyRange`) releases the cloud resources.
- **In-progress builds** → **Abort** (`sarAbortRange`).

If the SAR controller is unreachable, the tab shows a notice rather than an error.

## Remote Fleet

Lists fleets from `GET /api/fleets`; expand a fleet to see its nodes.

- **Revoke node** (`DELETE /api/fleets/{id}/nodes/{nodeId}`) — stops a single agent after its simulation; the endpoint's agent exits on its next heartbeat. History is preserved.
- **Delete fleet** (`DELETE /api/fleets/{id}?cascade=1`) — full teardown: removes every node (stopping each agent), plus tokens, campaigns, operations, and run history, in one transaction.

!!! info "Why deleting a node stops the agent"
    Fleet nodes are keyed by per-node API keys. Removing (or revoking) a node makes the agent's next authenticated poll fail (401), so the agent service stops on its own — the same safety property as an explicit revoke.

The Remote Fleet tab also lists **C2 servers** (Caldera). **Delete** (`DELETE /api/c2/{id}`) tears down a *managed* server (stops its process) or forgets a *connected* one; the backing simulation target is removed either way. Their status reflects a live reachability probe, so a stopped server reads **stopped**, not "running".

!!! note "Local start/stop scripts never touch your labs"
    `./start-server.sh` starts **only** the DetectOps web server, and `./stop-server.sh` stops only the web server — neither boots or halts your lab VMs, Docker stacks, or the Caldera C2. Manage those yourself here and on `/caldera`, so nothing hogs memory/disk unexpectedly.

## Visibility follows real state

Because Local Lab listings and the [Campaign Designer](../simulation/campaign-designer.md) target list are gated on **live VirtualBox presence**, a destroyed lab drops out of the platform immediately — a lab/VM only appears while it actually exists.
