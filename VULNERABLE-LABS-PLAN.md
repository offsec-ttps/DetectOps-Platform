# Vulnerable Lab Platform — End-to-End Implementation Plan

**Source of truth for the catalog:** `Detection_Engineering_Lab_Catalog.docx` (v1.0, 2026-09-30) — 12 domains, ~212 catalogued labs, 18 SIEM/detection stacks, an ATT&CK↔Sigma mapping table, and an 8-step CLI flow.

**Goal:** click-to-deploy *intentionally vulnerable* labs into the operator's **existing** infrastructure (local / remote / cloud), on the **same isolated network** as their running VMs, with **log forwarding to the central Splunk configured automatically** — so a SOC analyst can observe vulnerability identification and exploitation, then build and test detection logic against real telemetry.

Two lab shapes are in scope:
1. **Full labs** — VM or multi-container environments (GOAD, Kubernetes Goat, AWSGoat, Juice Shop…).
2. **Service-level CVE labs** — one app at one version (Apache 2.4.49, Tomcat 9.0.30…) in a disposable container, for focused CVE→detection work.

---

## 1. What already exists (verified reuse inventory)

This plan deliberately adds **one new deploy category** and **one telemetry pipeline**; almost everything else is already built. Verified in-repo:

| Capability | Where | Reuse |
| --- | --- | --- |
| Deploy hub with 4 peer categories (local / cloud / fleet / osimages) | `src/app/(dashboard)/deploy/page.tsx` (`View` union + chooser cards) | Add a 5th `vulnlabs` view |
| Catalog + detail + deploy pattern | `src/config/c2-catalog`, `src/config/os-images`, `C2Catalog.tsx`, `C2TemplateDetail.tsx` | Mirror for the lab catalog |
| Container deploy engine pattern | `src/lib/c2/deploy-generic.ts` + `adapters/` (clone → compose → health-check → start/stop/teardown) | Mirror for compose labs |
| VM deploy engine pattern | `src/lib/os-images/deploy.ts` (Vagrantfile → `vagrant up/halt/destroy`) | Mirror for VM labs |
| JSON deployment registry (no migration) | `src/lib/os-images/registry.ts` (`labs/.os-images-registry.json`, live VBox state) | Mirror for lab deployments |
| Local network topology | host-only `vboxnet0` = `192.168.56.0/24`, `vboxnet4` = `10.0.1.0/24` | Same-network placement |
| Running-lab / network resolution | `src/lib/active-lab.ts` (`findLatestDeployment`, `networkBase`, `splunkIp`) | Pick the target network + Splunk |
| **Splunk UF forwarding configs** | `labs/.blueprints/sar-local/ansible/roles/windows_universal_forwarder/files/` — `win_event_log_inputs.conf`, `sysmon_inputs.conf`, `powershell_inputs.conf`, `atomic_red_team_execution_inputs.conf`, `nxlog*.conf` | Reuse **verbatim** for Windows labs |
| Splunk index definitions | `…/roles/search_head/files/indexes.conf` (`main`, `test`, `network`, `summary`, …) | Extend with lab indexes |
| SIEM connection model | `SiemConnection` (`kind` splunk\|mde, **`scope`** local\|cloud\|fleet\|c2\|any, **`targetRef`**, `secretsEnc`) | Add scope `vulnlab`; bind per lab via `targetRef` |
| Splunk query layer | `src/lib/siem/providers/splunk.ts` | **Must change** — see §4.3 |
| Cloud provisioning | `cloud-lab-app/` controller (Terraform/ansible), AWS creds via `POST /api/cloud-credentials/[id]/activate` → `~/.aws` | Cloud goats |
| Attack simulators | Atomic Red Team (1,878 tests), **Stratus Red Team** (`stratus_attacks`/`stratus_executions`, `/api/stratus/execute`), Caldera + C2 catalog (25 frameworks) | docx step 6 — already done |
| Detection authoring + scoring | Rule Workspace (sigma-cli, 14,592 rules), Campaign Designer "Simulation & Detection" | docx step 5/7 — already done |
| Gating / audit / secrets | `localDeployAvailable()`, `logEvent`, `credential-vault.encrypt` | Unchanged guardrails |
| Host prerequisites | Docker 28.1.1 + Compose v5.1.2, VirtualBox 6.1.50, Vagrant 2.2.19, Terraform | Confirmed present |

**Consequence:** the simulator and detection-authoring layers the docx asks for (steps 5–7) are already shipped. The net-new work is the **vulnerable-lab catalog, its deploy engines, network placement, and the automatic log-forwarding pipeline.**

---

## 2. Architecture

Three planes, one isolated network per lab tenant.

```
┌─ CONTROL PLANE (DetectOps, existing) ───────────────────────────────┐
│  Lab Catalog (docx-generated) → Wizard → Orchestrator → Registry    │
│  /deploy?view=vulnlabs        /api/vuln-labs        labs/.vuln-*    │
└───────────────┬──────────────────────────────────┬─────────────────┘
                │ provision                        │ auto-configure shipper
                ▼                                  ▼
┌─ LAB PLANE (isolated) ──────────┐   ┌─ TELEMETRY PLANE (existing) ──┐
│ local : docker net bound to     │   │ Splunk (SAR lab or BYO)        │
│         vboxnetX  /  Vagrant VM │──▶│  HEC :8088  ·  UF :9997        │
│ cloud : same VPC/subnet as the  │   │  indexes: lab_<domain>         │
│         running SAR cloud range │   │  SiemConnection(scope=vulnlab) │
│ remote: over WireGuard / SSH    │   └───────────────┬───────────────┘
│ + egress default-deny, no       │                   │
│   public bind, TTL reaper       │                   ▼
└─────────────────────────────────┘        Rule Workspace + Campaign
                                            Designer detection scoring
```

### 2.1 Deploy engines (by lab shape, from the docx `Environment` column)

| Engine | Covers | Basis |
| --- | --- | --- |
| **`compose`** | Web/API, LLM/MCP, CI/CD, identity, service-CVE labs | `docker compose up -d` — mirrors `deploy-generic.ts` |
| **`k8s`** | Kubernetes/container labs (Kubernetes Goat, EKS Goat) | `kind`/`minikube` cluster + `kubectl apply` / `helm` |
| **`vm`** | AD/Windows + Linux privesc labs (GOAD, VulnAD) | Vagrant — mirrors `os-images/deploy.ts` |
| **`terraform`** | Cloud goats (AWSGoat, AzureGoat, CloudGoat, TerraGoat) | Existing Terraform + activated cloud creds |
| **`pcap`** | Network/PCAP labs | Replay into Zeek/Suricata, no live target |

### 2.2 Network isolation (the "same network, no public exposure" requirement)

- **Local** — create a dedicated Docker bridge per lab and **publish ports only on the chosen host-only interface IP**, never `0.0.0.0`:
  `ports: ["192.168.56.1:8080:80"]`. Labs that need no inbound from the host get `internal: true`. VM labs attach a host-only adapter on the selected `networkBase` (reuses `active-lab.ts`).
- **Cloud** — provision into the **same VPC/subnet** as the operator's running SAR range; security group allows only the range CIDR plus the existing `ip_whitelist`; **no public IP** unless the lab inherently needs one (cloud goats do — flagged per entry).
- **Remote** — reachable over the existing WireGuard tunnel / SSH host; bind to the tunnel interface only.
- **Egress default-deny** where the lab doesn't need the internet, so a deliberately vulnerable box can't be used as a pivot outward.
- **TTL auto-teardown** (docx step 8: 1h / 4h / 24h / manual) via a scheduled reaper — vulnerable infra should not outlive the exercise.

---

## 3. Catalog — generated from the docx

The docx tables are uniform (`# | Lab Name | Repository | Environment [| Notes]`) across all 12 domain sections and machine-parseable (236 URL rows verified).

**Approach:** a generator keeps the document authoritative.

- `scripts/gen-vuln-lab-catalog.mjs` — parses `word/document.xml`, emits `src/config/vuln-labs/catalog.generated.ts`.
- `src/config/vuln-labs/index.ts` — hand-maintained **overlay** adding what the docx can't know: engine, ports, resources, index/sourcetype, ATT&CK tactics (docx §17), Sigma path, deployability tier, isolation notes.

```ts
export type LabDomain = "cloud" | "k8s" | "web" | "llm" | "ad" | "linux"
  | "cicd" | "iac" | "mobile" | "network" | "identity" | "ot";
export type LabEngine = "compose" | "k8s" | "vm" | "terraform" | "pcap";

export interface VulnLabEntry {
  id: string; name: string; domain: LabDomain;
  description: string; repo?: string; docsUrl?: string;
  environments: ("local" | "remote" | "cloud")[];
  engine: LabEngine;
  resources: { cpus: number; memoryMB: number; diskGB: number };
  services: { name: string; port: number; protocol: "http" | "https" | "tcp" }[];
  telemetry: { index: string; sourcetypes: string[]; shipper: ShipperKind[] };
  attack: { tactics: string[]; techniques: string[] };   // docx §17
  sigmaPath?: string;                                     // docx §17
  isolation: { requiresEgress: boolean; requiresPublicIp: boolean };
  deploy: { available: boolean; guidedSteps?: string[] };  // false → template-only
  seeded: true;
}
```

**Deployability tiers** (same honest pattern used for the C2 and OS-image catalogs): catalog **all** ~212 labs immediately; wire **automated deploy** for a validated first wave; everything else renders as a template with prerequisites, guided steps, and the upstream repo link.

---

## 4. Log integration — the crux

### 4.1 Shipper matrix

| Lab shape | Shipper | Mechanism |
| --- | --- | --- |
| Containers / compose | **Splunk HEC** | Docker `splunk` log driver per service (no sidecar); Fluent Bit sidecar only where app files/multiline need it |
| Windows VM | **Universal Forwarder** | Reuse SAR's `win_event_log_inputs.conf` + `sysmon_inputs.conf` + `powershell_inputs.conf` verbatim; generated `outputs.conf` → `<splunkIp>:9997` |
| Linux VM | **Universal Forwarder** | `/var/log`, `auditd`, app logs |
| Kubernetes | **HEC DaemonSet** | OTel Collector / Splunk Connect for K8s + Falco → HEC |
| Network/PCAP | UF or HEC | Zeek/Suricata JSON |
| Cloud goats | cloud-native | CloudTrail→S3/SQS (Splunk Add-on for AWS); Azure Activity→Event Hub; GCP→Pub/Sub — **Phase 3**, heaviest |

### 4.2 Index design

One index per domain, one sourcetype per lab, with lab metadata stamped on every event so the SOC can correlate and scope:

```
lab_web · lab_api · lab_llm · lab_k8s · lab_cloud · lab_ad · lab_linux
lab_network · lab_identity · lab_cicd · lab_iac · lab_ot
fields: lab_id, lab_name, domain, deployment_id, owner, tenant
```

Provisioned automatically at deploy time: ensure index exists → mint a scoped **HEC token** → inject token/endpoint into the lab's shipper config → verify first event lands before reporting "ready".

### 4.3 Required changes to the detection layer ⚠️

Verified in `src/lib/siem/providers/splunk.ts`, the scorer runs five strategies: `saved_searches`, `fired_alerts`, `notable_index`, **`direct_spl`** (the rule's own `searchQuery`), and `telemetry_check`. Two distinct issues — neither is "the verdict is broken":

**(a) The `telemetry_check` diagnostic is Windows-hardcoded (low risk, high annoyance).** Line ~129 runs
`search (index=sysmon OR index=wineventlog OR index=win OR index=main)` and, on zero results, reports
*"No telemetry — check Sysmon/WinEventLog forwarding."* It is explicitly **excluded from the detected verdict**
(`r.strategy !== "telemetry_check"`), so scoring still works — but for a web/k8s/cloud lab whose events land in
`lab_web` it will **always** claim no telemetry, which is a false signal for the operator. Fix: derive the probed
index set from the target environment / lab entry (default to today's set, union the lab's index).

**(b) The substantive work is Sigma pipeline + sourcetype alignment (the real risk).** Because `direct_spl`
executes the rule's own query, a rule converted with the Windows pipeline (`sysmon` / `wineventlog` macros, per
`DEFAULT_PIPELINE` in `src/lib/community-sources/sigma-cli.ts`) will never match `lab_web` / `lab_k8s` data no
matter how the index list is configured. Fix: give each catalog entry a **domain-appropriate Sigma pipeline**
(e.g. web/apache, k8s, cloud) and stamp **consistent sourcetypes** at ingest (§4.2) so converted rules line up
with what the shippers actually write. This — not the index list — is what determines whether the loop closes.

### 4.4 Splunk prerequisites

HEC must be enabled on the Splunk instance (`:8088`) and `9997` receiving must be on for UF labs. The existing SAR Splunk needs both enabled + a token minted; a BYO Splunk is configured through `SiemConnection`. Ship a one-shot `scripts/splunk-prepare-lab-ingest.sh` that enables HEC, creates the `lab_*` indexes, and prints the token.

---

## 5. Service-level CVE labs (Apache / Tomcat / … by version)

**Backing corpus: [vulhub](https://github.com/vulhub/vulhub)** — already structured exactly as required: `<app>/<CVE-or-version>/docker-compose.yml`. This answers "select the application, choose the version, deploy isolated and disposable" without authoring per-CVE environments.

- `src/config/vuln-labs/services.ts` — curated index: app → versions → CVE id, severity, affected version range, exposed port, ATT&CK technique, expected telemetry, and the vulhub path.
- Deploy: shallow-clone/refresh a pinned vulhub revision → `docker compose up -d` in the selected app/CVE dir → attach the isolated network → HEC log driver → TTL.
- UI: cascading selects (**App → Version/CVE → Network → SIEM → TTL**), then *Deploy*.
- Every service lab is **egress-denied and host-only bound by default** — these are knowingly exploitable services.

---

## 6. Deployment workflow (maps 1:1 to the docx 8-step CLI)

A wizard in the new Deploy category, reusing the existing component patterns:

1. **Environment** — local / remote / cloud (filtered by the entry's `environments`).
2. **Target network** — pick from *already-deployed* infrastructure: running local labs (`active-lab.ts` → `networkBase`), a cloud range's VPC/subnet, or a remote host. This is what satisfies "spun up in the same network".
3. **Lab** — searchable catalog by domain (fuzzy, 212 entries).
4. **SIEM sink** — defaults to the environment's `SiemConnection`; Splunk first, others per the docx list later.
5. **Simulator** *(optional)* — ART / Stratus / Caldera, all already wired.
6. **TTL** — 1h / 4h / 24h / manual.
7. **Deploy** — phased, streamed logs (mirrors the existing deploy-log UI): `provision → network attach → telemetry wire → verify first event → ready`, with the lab's access URL.
8. **Manage/teardown** — start / stop / destroy, plus the TTL reaper.

---

## 7. Detection engineering workflow (closing the loop)

Per lab, the catalog carries its ATT&CK tactics/techniques and Sigma namespace from docx §17, enabling:

1. Deploy lab → access its UI/service inside the isolated network.
2. Exploit manually, or run the mapped simulator (ART/Stratus/Caldera).
3. Telemetry lands in `lab_<domain>` with `lab_id` stamped.
4. **Rule Workspace** — author/convert Sigma for the lab's mapped techniques (existing).
5. **Campaign Designer → Simulation & Detection** — score detected / not-detected against that lab's index (needs §4.3).
6. Export to the detection repo; coverage rolls into the existing ATT&CK coverage metrics.

---

## 8. Files

**New**
- `scripts/gen-vuln-lab-catalog.mjs` · `src/config/vuln-labs/{index.ts,catalog.generated.ts,services.ts}`
- `src/lib/vuln-labs/{deploy-compose.ts,deploy-vm.ts,deploy-k8s.ts,deploy-terraform.ts,registry.ts,network.ts,telemetry.ts}`
- `src/app/api/vuln-labs/route.ts` · `src/app/api/vuln-labs/[id]/route.ts` · `src/app/api/vuln-labs/reaper/route.ts`
- `src/components/deploy/vuln-labs/{VulnLabsHub,VulnLabCatalog,VulnLabDetail,DeployWizard}.tsx`
- `scripts/splunk-prepare-lab-ingest.sh`

**Modified**
- `src/app/(dashboard)/deploy/page.tsx` — `View` += `"vulnlabs"`, chooser card, deep-link
- `src/lib/siem/providers/splunk.ts` — derive the `telemetry_check` index set from the target env (§4.3a)
- `src/lib/community-sources/sigma-cli.ts` — per-domain Sigma pipeline selection (§4.3b)
- `labs/.blueprints/.../search_head/files/indexes.conf` — add `lab_*` indexes
- `prisma/schema.prisma` — **only if** DB-backed deployments are preferred over the JSON registry (see Decisions)

---

## 9. Phased roadmap

| Phase | Scope | Why first |
| --- | --- | --- |
| **1** | Catalog generator + full 212-entry catalog + new Deploy category + browse/detail UI (all template-only) | Immediate value, zero deploy risk, unblocks everything |
| **2** | `compose` engine + **service-CVE labs (vulhub)** + HEC pipeline + index provisioning + §4.3a/b fixes + isolation + TTL | Highest value / lowest risk; directly answers the service-level ask; proves the telemetry loop end-to-end |
| **3** | First-wave full labs: Juice Shop, DVWA, crAPI, Kubernetes Goat (`compose`/`k8s`) | Broadens domains on a proven pipeline |
| **4** | `vm` engine (GOAD/AD + Linux) with UF forwarding reusing SAR configs | Windows telemetry is the richest for detection work |
| **5** | `terraform` cloud goats + cloud-native log ingestion | Heaviest; needs per-cloud ingestion plumbing |
| **6** | Remaining SIEM sinks (Elastic/Sentinel/Loki/Wazuh), PCAP replay, docx §19 gap labs | Breadth once the core is solid |

---

## 10. Verification

1. `npx tsc --noEmit` stays at the **16-error baseline**.
2. Generator: `node scripts/gen-vuln-lab-catalog.mjs` → entry count matches the docx summary table (12 domains); re-running is idempotent.
3. `GET /api/vuln-labs` → full catalog, correct `available` flags; `/deploy?view=vulnlabs` renders; template-only entries expose no Deploy button.
4. **Isolation:** deploy a service-CVE lab → confirm the port is bound to the host-only IP only (`ss -ltnp` shows `192.168.56.1:PORT`, **not** `0.0.0.0`), and that egress-denied labs cannot reach the internet.
5. **Telemetry (the real proof):** deploy → exploit → `index=lab_web lab_id=<id>` returns events in Splunk within the ingest window.
6. **Loop:** Rule Workspace rule for the lab's mapped technique, converted with the lab's **domain pipeline** (§4.3b), → Campaign Designer `direct_spl` scores **detected**; the `telemetry_check` diagnostic reports the lab's own index, not "check Sysmon forwarding" (§4.3a).
7. TTL reaper destroys an expired lab; teardown removes containers/VM + registry row; `logEvent` rows exist for deploy/teardown.
8. Guardrails: managed deploy refused when `PLATFORM_MODE=cloud`; template-only and unknown ids rejected 400.

---

## 11. Decisions needed before Phase 2

1. **Catalog persistence** — JSON registry (mirrors os-images, no migration, dodges the `prisma generate` dev-restart gotcha) **[recommended]** vs a Prisma `VulnLabDeployment` model (better multi-tenant querying).
2. **Cloud-goat public exposure** — cloud goats (AWSGoat/AzureGoat) intentionally expose public endpoints, which conflicts with "no direct public exposure". Options: allow with the SG locked to `ip_whitelist` **[recommended]**, or restrict cloud goats to Phase 5 behind an explicit acknowledgement.
3. **vulhub pinning** — pin a reviewed vulhub revision **[recommended]** vs track upstream `main`. Pinning is reproducible and avoids surprise upstream changes to exploitable images.
4. **Default TTL** — recommend **4 hours** default with explicit opt-in for 24h/manual, since these are deliberately vulnerable systems.

---

## 12. Security posture

Unchanged from the rest of the platform, and stricter where it matters:

- Deploy gated behind `PLATFORM_MODE=self-hosted` (`localDeployAvailable()`), owner-scoped, `logEvent`-audited; credentials via the existing AES-GCM vault.
- Vulnerable labs are **host-only bound, egress-denied by default, TTL-reaped**, and never published on `0.0.0.0`.
- The platform orchestrates **upstream public** lab projects (clone/compose/terraform) and links their docs — it authors no exploit code.
- Intended for an operator's own authorized lab network for detection engineering; the isolation model exists precisely so a knowingly vulnerable box cannot become a pivot.
