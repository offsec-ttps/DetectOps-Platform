# Community Content Expansion

Status of the multi-phase plan to integrate every remaining core community
detection repository into the platform's "Community Content" section.

## Phases

| Phase | Scope | Status |
|---|---|---|
| **0 — Discovery** | Map existing repo adapters / tables / API routes / pages | ✅ Done |
| **1 — Foundation** | `CommunityRule` table, source adapter interface, registry, feature flags | ✅ Done |
| **2a — MITRE CAR** | Adapter, API routes, dedicated UI page, registry strip on /community | ✅ Done |
| **2b — Microsoft Sentinel** | `Azure/Azure-Sentinel` Detections + Hunting Queries | 📋 Planned |
| **2c — Defender XDR** | Advanced Hunting query samples | 📋 Planned |
| **3a — Google SecOps** | `chronicle/detection-rules` (YARA-L) | 📋 Planned |
| **3b — Panther** | `panther-labs/panther-analysis` (rules, policies, correlations) | 📋 Planned |
| **4a — Falco** | `falcosecurity/rules` (Falco YAML) | 📋 Planned |
| **4b — Wazuh** | Wazuh ruleset references / ruleset-as-code | 📋 Planned |
| **5 — Unified search** | Cross-source filters, comparison view, bookmarking | 📋 Planned |
| **6 — Sigma conversion** | Sigma CLI / pySigma in Rule Workspace | ✅ Spike done (UI + API + audit log) |
| **7 — PR workflow** | Drafts → GitHub PR → production promote | 📋 Planned |
| **8 — Hardening** | Caching, observability, rollback | 📋 Planned |

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│                     /community  (UI hub)                     │
│                                                              │
│  ┌──────────────────┐  ┌────────────────────────────────┐    │
│  │  Source Registry │  │ Existing 3-card grid (intact)  │    │
│  │  Strip (NEW)     │  │  • SigmaHQ                     │    │
│  │                  │  │  • Splunk Security Content     │    │
│  │  • MITRE CAR     │  │  • Elastic Detection Rules     │    │
│  │  • Sentinel*     │  └────────────────────────────────┘    │
│  │  • Defender*     │                                         │
│  │  • SecOps*       │  Existing rule list (intact, untouched)│
│  │  • Panther*      │                                         │
│  │  • Falco*        │                                         │
│  │  • Wazuh*        │  * = future phases, gated by flags     │
│  └──────────────────┘                                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│         GET /api/community/registry  (NEW)                   │
│         Returns all adapter metadata + flags                 │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│        src/lib/community-sources/registry.ts (NEW)           │
│                                                              │
│  Wraps EXISTING bespoke syncs (zero change to them):         │
│    • sigmaHqAdapter   → calls existing syncSigmaHQ()         │
│    • elasticAdapter   → calls existing syncElasticRules()    │
│    • splunkAdapter    → calls existing syncSplunkDetections()│
│                                                              │
│  Loads NEW adapters dynamically (gated by feature flag):     │
│    • mitreCarAdapter  → src/lib/community-sources/adapters/  │
│    • sentinel*  defenderXdr*  googleSecops*  panther*        │
│    • falco*  wazuh*                                          │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Storage:                                                    │
│   ┌────────────────────────────────┐ ┌──────────────────────┐│
│   │ LEGACY (untouched):            │ │ NEW (Phase 1+):      ││
│   │  • CommunitySigmaRule          │ │  • CommunityRule     ││
│   │  • CommunityElasticRule        │ │    (unified for all  ││
│   │  • SplunkDetection             │ │     new sources)     ││
│   │  • AtomicTest                  │ │  • SigmaConversion   ││
│   └────────────────────────────────┘ └──────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

## What was added

### Database (additive only)
- **`CommunityRule`** — unified normalized table for any new source
- **`SigmaConversion`** — audit log for Sigma CLI conversion attempts
- `CommunitySource.unifiedRules` back-relation

### Library — `src/lib/community-sources/`
- `types.ts` — `ICommunitySourceAdapter`, `NormalizedRule`, `SourceStatus`
- `flags.ts` — feature flag wiring with master `expansion` switch
- `registry.ts` — wraps existing syncs + dynamically loads new adapters
- `sigma-cli.ts` — finds Sigma CLI on disk, lists backends, runs conversions
- `adapters/mitre-car.ts` — full implementation (Phase 2a)

### API routes (additive)
- `GET  /api/community/registry` — unified source list + flags
- `GET  /api/community/mitre-car/sync` — last sync info
- `POST /api/community/mitre-car/sync` — pull from upstream
- `GET  /api/community/mitre-car/rules` — list with filters
- `GET  /api/community/mitre-car/rules/[id]` — single analytic
- `GET  /api/community/mitre-car/summary` — quick stats
- `GET  /api/rule-workspace/sigma-convert` — Sigma CLI status + backends
- `POST /api/rule-workspace/sigma-convert` — convert YAML → target backend

### UI pages
- `/community/mitre-car` — full browser with filters, drawer, implementations view
- `/community` — added `<SourceRegistryStrip />` (additional sources only — does not touch existing 3-card grid)
- `/rule-workspace` — replaced placeholder with working editor + Sigma CLI integration

## Backward compatibility

- **Zero changes** to: existing community syncs, sigmahq/elastic/splunk pages, sidebar nav, existing API routes
- **Additive schema only** — no fields removed or renamed from any existing table
- **Master kill switch**: `ENABLE_COMMUNITY_CONTENT_EXPANSION=false` makes the registry endpoint return only legacy sources and the strip renders nothing
- **Per-source flags** disable individual new sources independently

## Feature flags

```bash
# Master kill switch — turn off the entire expansion
ENABLE_COMMUNITY_CONTENT_EXPANSION=true

# Per-source (Phase 2-4)
ENABLE_MITRE_CAR_SOURCE=true
ENABLE_MICROSOFT_SENTINEL_SOURCE=false
ENABLE_DEFENDER_XDR_SOURCE=false
ENABLE_GOOGLE_SECOPS_SOURCE=false
ENABLE_PANTHER_SOURCE=false
ENABLE_FALCO_SOURCE=false
ENABLE_WAZUH_SOURCE=false

# Sigma CLI conversion in Rule Workspace
ENABLE_SIGMA_WORKSPACE_CONVERSION=true
SIGMA_CLI_PATH=/path/to/sigma  # optional override
```

## Adding a new source (template for Phase 2b–4b)

Each remaining source follows the same recipe:

1. **Create adapter** at `src/lib/community-sources/adapters/<source>.ts`:
   - Implement `ICommunitySourceAdapter` (`meta()`, `sync()`)
   - Use `prisma.communityRule.upsert(...)` to write into the unified table
   - Map source-specific YAML/JSON/TOML/XML into `NormalizedRule` shape

2. **Register in `registry.ts`**:
   - Add `if (isSourceEnabled("<key>")) out.push((await import("./adapters/<source>")).<source>Adapter);`

3. **Add API routes** under `src/app/api/community/<source>/`:
   - `sync/route.ts` — POST trigger
   - `rules/route.ts` — GET list with filters
   - `rules/[id]/route.ts` — GET single

4. **Add UI page** at `src/app/(dashboard)/community/<source>/page.tsx`
   - Copy `mitre-car/page.tsx` as a template — same layout, swap source-specific fields

5. **Add feature flag** in `flags.ts`:
   - `ENABLE_<SOURCE>_SOURCE=true|false`

6. **Test the registry endpoint** picks it up:
   ```
   curl http://localhost:3000/api/community/registry
   ```

Everything else (sidebar discovery, registry strip rendering, registry status
panels) flows automatically.

## Source mapping cheat sheet

| Source | Repo | Format | Primary `ruleLanguage` | Convertible? |
|---|---|---|---|---|
| **MITRE CAR** ✅ | mitre-attack/car | YAML (analytics/) | `pseudocode` / `spl` / `eql` | No |
| Microsoft Sentinel | Azure/Azure-Sentinel | YAML (Detections/, Hunting Queries/) | `kql` | No |
| Defender XDR | Microsoft docs / hunting samples | KQL | `kql` | No |
| Google SecOps | chronicle/detection-rules | YARA-L | `yara-l` | No |
| Panther | panther-labs/panther-analysis | Python + YAML | `python` | Via Sigma → Panther backend |
| Falco | falcosecurity/rules | Falco YAML | `falco-yaml` | No |
| Wazuh | wazuh/wazuh-ruleset | XML | `wazuh-xml` | No |

## Sigma CLI installation (for Rule Workspace conversion)

The Rule Workspace detects Sigma CLI in this order:
1. `$SIGMA_CLI_PATH` env var
2. `<project>/backend/.venv/bin/sigma`
3. `~/.local/bin/sigma`
4. `which sigma`

If none are present, the UI shows a banner with the install hint:

```bash
pip install sigma-cli pysigma-backend-splunk pysigma-backend-elasticsearch pysigma-backend-panther
```

Or into the project's backend venv:

```bash
cd backend
.venv/bin/pip install sigma-cli pysigma-backend-splunk pysigma-backend-elasticsearch
```

After installation the converter works immediately — no app restart needed,
the detection runs on every request and is cached for the process lifetime.
