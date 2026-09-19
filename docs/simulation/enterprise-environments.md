# Enterprise Environments

**Route:** `/detections/enterprise/environments` · **Sidebar:** Simulation → Enterprise Environments

Enterprise Environments is CRUD for the **targets** that Enterprise use-case scenarios execute against. Each `EnvironmentTarget` records how to reach a target and which execution transport to use.

## Environment kinds

| Kind | Transport | Notes |
|------|-----------|-------|
| `our-template-deployed` | **SSH** | A template-deployed lab VM (OpenSSH). Runs ART commands directly. |
| `user-cloud` | **Stratus Red Team** | Cloud-native attack techniques against your cloud creds. Destructive detonation is gated by `confirmDestructive`. |
| `agent` | **Caldera** or **native fleet** | BYO C2 (Caldera) executes real ATT&CK abilities; native-fleet agents run via their own signed job-poll pipeline. |
| `shell` | reverse/bind shell | Stub in the current runner. |

Managed through the form `src/components/enterprise-use-cases/EnvironmentForm.tsx`; APIs under `/api/environment-targets` (+ `/[id]`, `/[id]/test`, `/[id]/payload`, `/[id]/caldera-test`). Use **Test** to probe reachability before running scenarios.

## Sub-pages

### Fleet
`/detections/enterprise/environments/fleet` — the Remote Fleet console (also embedded in the Deploy hub). Create fleets, mint enrollment tokens, enroll signed agents, manage consent/scope, and run node tests. See [Fleet Server](../labs/fleet-server.md) for the full architecture and APIs.

### Campaigns
`/detections/enterprise/environments/campaigns` — a fleet-wide campaign builder that fans a selection of atomic tests (`/api/atomic-tests/tree`) across chosen fleet nodes.

## Auto-registration

Environments deployed through the [Deploy hub](../labs/deploy-hub.md) auto-register here, so a freshly deployed Local/Cloud lab is immediately usable as a scenario target.
