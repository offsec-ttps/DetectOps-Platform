# DetectOps Detection-Content MCP Server

A production **Model Context Protocol (MCP)** server that exposes DetectOps' curated
security-detection repository — **14,000+ detection rules**, **90,000+ IOCs**, and
**6,000+ threat-intel reports** — to any MCP-compatible client (Claude Desktop, Cursor,
custom agents) through issued, rate-limited API keys.

- **Transport:** Streamable HTTP (JSON-RPC 2.0) at `POST /api/mcp`
- **Auth:** per-user API keys (`dmcp_…`), sha256-hashed at rest, scoped, rate-limited, quota'd, revocable
- **Access:** read-only over already-aggregated community detection content

## Sources aggregated

SigmaHQ · Elastic Security · Splunk Security Content · Microsoft Sentinel · Microsoft
Defender XDR · Wazuh · Panther · Falco · MITRE CAR · Google SecOps — normalized into one
searchable shape. IOCs and threat-actor/CVE intel come from the platform's threat-intel store.

## Tools

| Tool | Scope | Purpose |
|------|-------|---------|
| `search_detections` | detections:read | Full-text + technique/tactic/platform/severity/language/type search across all sources |
| `get_detection` | detections:read | One rule in full, incl. native detection logic (Sigma YAML / SPL / KQL / EQL) |
| `search_sigma_rules` | detections:read | Search SigmaHQ rules specifically |
| `list_by_mitre` | detections:read | Rules mapped to a MITRE technique (T1059) or tactic (TA0002 / Execution) |
| `list_by_platform` | detections:read | Rules for a platform/product (windows, linux, azure, m365, k8s…) |
| `list_sources` | detections:read | All sources/vendors + rule counts |
| `list_by_vendor` | detections:read | Rules from a specific vendor/source |
| `latest_detections` | detections:read | Most recently added/updated rules |
| `get_stats` | detections:read | Repository statistics |
| `search_iocs` | intel:read | IOCs by type (ip/domain/url/hash/cve/…) and/or value |
| `search_by_cve` | intel:read | IOCs + reports referencing a CVE |
| `search_threat_actors` | intel:read | Threat-intel reports by actor / APT group / alias |
| `search_by_malware_family` | intel:read | Reports mentioning a malware family (best-effort) |

Tools are registered **per key scope** — a key without `intel:read` won't see the intel tools
in `tools/list` and cannot call them.

## Authentication

Send the key on every request via either header:

```
Authorization: Bearer dmcp_<prefix>_<secret>
X-API-Key: dmcp_<prefix>_<secret>
```

Keys carry a **tier** (`free` 60/min·200/day, `pro` 240/min·10k/day, `admin`), scopes, a
per-minute rate limit, and a durable daily quota. Exceeding limits returns `429` with
`Retry-After`; an invalid/revoked key returns `401`; a missing scope returns `403`.

Mint/list/revoke keys from the **MCP Server** console at `/mcp-registry` (admin) or via the
admin API:

```bash
# mint
curl -X POST http://localhost:3000/api/mcp/keys -H 'content-type: application/json' \
  -d '{"label":"research-bot","tier":"pro"}'
# -> { "key": "dmcp_...", "note": "shown once" }

# list / revoke
curl http://localhost:3000/api/mcp/keys
curl -X DELETE http://localhost:3000/api/mcp/keys/<id>
```

## Quick start

```bash
# 1. mint a key (see above), then:
export KEY=dmcp_...   ENDPOINT=http://localhost:3000/api/mcp
./examples/mcp-client/try.sh
```

Or wire it into a client with [`examples/mcp-client/mcp.json`](../../examples/mcp-client/mcp.json)
/ [`claude_desktop_config.json`](../../examples/mcp-client/claude_desktop_config.json).

## Protocol notes

- JSON-RPC methods: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`.
- Stateless: no session is required; every request is independent (no `Mcp-Session-Id`).
- Clients must send `Accept: application/json, text/event-stream`. The server replies with a
  single JSON response (`enableJsonResponse`).
- CORS is open (`*`) with an `OPTIONS` preflight, so browser-based MCP clients work.

See [DEPLOY.md](./DEPLOY.md) for Docker + reverse-proxy/TLS deployment.
