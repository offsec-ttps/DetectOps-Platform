# MCP Server

**Route:** `/mcp-registry` (management) · **Endpoint:** `/api/mcp` · **Sidebar:** System → MCP Registry

DetectOps ships a production **Model Context Protocol (MCP) server** that exposes its detection content — 14,000+ rules, ~98k IOCs, and thousands of threat-intel reports — to any MCP client (Claude Desktop, IDEs, agents) over a web-standard **streamable-HTTP** transport.

## The server

`src/app/api/mcp/route.ts` — a stateless JSON-RPC endpoint supporting `initialize`, `tools/list`, and `tools/call`.

- **POST only** (GET → 405; OPTIONS → CORS).
- Gated by `ENABLE_MCP_SERVER`.
- Every call is **API-key authenticated** with a `dmcp_` key: `src/lib/mcp/auth.ts` (`requireMcpApiKey`) enforces the key plus **rate limits, durable daily quotas, tier, and scopes**.
- Tool definitions are built in `src/lib/mcp/server.ts` (`buildMcpServer`) — 13 tools for search, lookup, and enrichment across rules, IOCs, and intel.

## Managing access

The MCP Registry console (`/mcp-registry`):

- Mint and revoke `dmcp_` API keys (`/api/mcp/keys`, `/api/mcp/keys/[id]`).
- View usage stats (`/api/mcp/stats`).

`MCP_PUBLIC_BASE_URL` controls the base URL advertised to clients.

## Connecting a client

Point any MCP client at `<MCP_PUBLIC_BASE_URL>/api/mcp` with an `Authorization: Bearer dmcp_...` header. Example client configs live in `examples/mcp-client/` (`claude_desktop_config.json`, `mcp.json`, `try.sh`).

## Deployment

For standalone deployment (Node or Docker) with an nginx reverse proxy and health checks, see the [MCP Deploy Guide](../mcp/DEPLOY.md), or run:

```bash
docker compose -f docker-compose.mcp.yml up --build
```

## Outbound MCP (enrichment)

Separately, the platform can **connect out** to other MCP servers for enrichment during detection-pack generation — configured under [Settings → MCP Servers](settings.md) (or the `MCP_SERVERS` env var). That's distinct from the server documented here.
