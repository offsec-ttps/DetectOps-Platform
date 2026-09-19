# Configuration

DetectOps is configured through environment variables in `.env` (copy from `.env.example`). Most keys are optional and gate a specific feature. Many integrations are **also** configurable at runtime through the Settings UI (which stores secrets encrypted at rest and wins over env vars on name collision).

!!! warning "`.env.example` is a subset"
    `.env.example` documents only a handful of variables, but the codebase reads ~80. The full reference below is grouped by feature. In particular, `SAR_PATH`, `GOAD_PATH`, and `PLATFORM_MODE` are used by the code but are **not** in `.env.example` — set them explicitly for lab features.

## Database

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `file:./dev.db` | SQLite database (community rules, IOCs, threat intel, MCP API keys). |

## Auth & security

| Variable | Purpose |
|----------|---------|
| `AUTH_ENFORCED` / `AUTH_ENFORCE` | When true, dashboard/admin routes require a real session; when false (dev) a synthetic admin is used. The public `/api/mcp` endpoint is **always** key-gated regardless. |
| `CREDENTIAL_VAULT_KEY` | 32+ char key used to durably encrypt cloud credentials and integration tokens at rest (`src/lib/crypto/credential-vault.ts`). Set this before storing cloud creds you want to survive restarts. |
| `INTERNAL_WORKER_TOKEN` | Shared secret for internal background-worker endpoints (`*/tick`). |
| `PLATFORM_MODE` | Set to `self-hosted` to enable the Local Lab option. |

## MCP server

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENABLE_MCP_SERVER` | `true` | Master switch for the `/api/mcp` endpoint. |
| `MCP_PUBLIC_BASE_URL` | `http://localhost:3000` | Base URL advertised to MCP clients in the registry console. |
| `MCP_SERVERS` | — | Outbound MCP servers to query for enrichment (config-as-code fallback; the [Settings UI](../system/settings.md) is preferred). Format: `name=transport:address[|option=value,...]`. |

## LLM providers

Configure at least one for AI features. The default provider resolves via `LLM_PROVIDER_DEFAULT` if set, otherwise priority order **Anthropic → OpenAI → OpenRouter → NVIDIA → Ollama** (Ollama last so a local daemon isn't silently chosen).

| Variable | Purpose |
|----------|---------|
| `LLM_PROVIDER_DEFAULT` | Force a default provider. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_DEFAULT` | Anthropic. |
| `OPENAI_API_KEY`, `OPENAI_MODEL_DEFAULT` | OpenAI. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_DEFAULT`, `OPENROUTER_APP_NAME`, `OPENROUTER_APP_URL` | OpenRouter. |
| `NVIDIA_API_KEY`, `NVIDIA_MODEL_DEFAULT` | NVIDIA NIM. |
| `OLLAMA_HOST`, `OLLAMA_MODEL_DEFAULT` | Local Ollama. |

## SigmaGen search & Sigma CLI

| Variable | Purpose |
|----------|---------|
| `SIGMAGEN_SEARCH_PROVIDER` | Which web-search backend SigmaGen's retrieval step uses. |
| `BRAVE_SEARCH_API_KEY` | Brave Search API key (if selected). |
| `SEARXNG_URL` | Self-hosted SearXNG endpoint (if selected). |
| `SIGMA_CLI_PATH` | Override the Sigma CLI binary path (defaults to `backend/.venv/bin/sigma`). |

## Detection-pack pipeline

| Variable | Purpose |
|----------|---------|
| `DETECTION_PACK_DAILY_TOKEN_BUDGET` | Daily LLM token budget guard for pack/SigmaGen generation. |
| `DETECTION_PACK_PER_JOB_ESTIMATE` | Per-job token estimate used by the budget guard. |

## Community-source feature flags

Master switch plus per-source toggles (all default on). Gate which corpora sync into the [unified catalog](../content/community-content.md).

`ENABLE_COMMUNITY_CONTENT_EXPANSION`, `ENABLE_MITRE_CAR_SOURCE`, `ENABLE_MICROSOFT_SENTINEL_SOURCE`, `ENABLE_DEFENDER_XDR_SOURCE`, `ENABLE_GOOGLE_SECOPS_SOURCE`, `ENABLE_PANTHER_SOURCE`, `ENABLE_FALCO_SOURCE`, `ENABLE_WAZUH_SOURCE`, `ENABLE_SIGMA_WORKSPACE_CONVERSION`

## Module Marketplace

| Variable | Purpose |
|----------|---------|
| `ENABLE_MODULE_MARKETPLACE` | Enable the marketplace. |
| `ENABLE_MODULE_AUTO_APPROVE` | Auto-approve installed modules (dev). |
| `ENABLE_MODULE_SIGNING` | Require signed module packages. |

## Ransomware & threat intel

`ENABLE_RANSOMWARE_INTEL`, `ENABLE_COLLECTOR_RANSOMWARE_LIVE`, `ENABLE_COLLECTOR_RANSOMWATCH`, `RANSOMWARE_LIVE_API_KEY`, `RANSOMWARE_LIVE_BASE`, `RANSOMWATCH_RAW_BASE`, `RANSOMWATCH_SCREENSHOT_BASE`, `RANSOMWATCH_POST_CAP`, `ENABLE_TOR_COLLECTOR`, `TOR_HTTP_PROXY`, `TOR_SOCKS_PROXY`, `TOR_CRAWL_CAP`

## Attack-data replay

`ATTACK_DATA_ROOT`, `ENABLE_ATTACK_DATA_REPLAY`, `ENABLE_REPLAY_BUILD`, `ENABLE_REPLAY_SAVE_FOR_LATER` — see [Replay Catalog](../simulation/replay-catalog.md).

## BAS agent (Remote Fleet)

| Variable | Purpose |
|----------|---------|
| `BAS_AGENT_VERSION` | Published agent version advertised to fleet nodes. |
| `BAS_AGENT_ARTIFACTS_DIR` | Where built agent binaries are served from. |
| `BAS_SIGNING_KEY` / `BAS_SIGNING_KEY_FILE` | ed25519 key used to sign fleet jobs. |

## Enterprise use-case runner

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENTERPRISE_UC_RUN_TIMEOUT_MS` | `300000` | Wall-clock cap per scenario run. |

## Cloud detonation (Stratus)

| Variable | Purpose |
|----------|---------|
| `STRATUS_BIN` | Path to the Stratus Red Team CLI. |
| `TARGET` | Default cloud target passed through to Stratus. |

## Detection lab (SAR / GOAD / Splunk)

| Variable | Purpose |
|----------|---------|
| `SAR_PATH` | Path to the Splunk Attack Range source install (default `/media/nested/SamsungEvo/Simulation/attack_range_local`). |
| `SAR_API_URL` | SAR controller REST API URL (cloud Docker controller). |
| `GOAD_PATH` | Path to the GOAD source tree (default `/media/nested/SamsungEvo/Projects/GOAD/GOAD`). |
| `GOAD_INSTANCE_ID` | GOAD instance identifier. |
| `SPLUNK_HOST`, `SPLUNK_IP` | Splunk server address for detection validation. |
| `SPLUNK_HEC_PORT`, `SPLUNK_HEC_TOKEN` | Splunk HEC endpoint used by [Replay Catalog](../simulation/replay-catalog.md). |

Lab lifecycle scripts (`scripts/sar-goad-orchestrator.sh`) read their own `scripts/.env.sar-goad` for SAR/GOAD subnet, Splunk IP/ports, and passwords.

## GitHub / detection-as-code

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Auth for PR creation, community sync, and detection-as-code push. |
| `LINKSEC_BRANCH`, `CORE_VERSION` | Repo/branch context for sync workflows. |

## Reports

| Variable | Purpose |
|----------|---------|
| `REPORTS_LOCAL_DIR` | Directory where **Save Report Locally** writes the rendered Markdown report. If set, reports are saved there; otherwise they default to `<cwd>/reports/local`. Accepts an absolute path or `~` for the home directory (e.g. `~/DetectOps-Reports`). The GitHub-push flow is unaffected. |
