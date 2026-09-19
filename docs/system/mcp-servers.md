# MCP Servers (outbound)

**Route:** `/settings/mcp-servers` · **Sidebar:** System → MCP Servers

Register **outbound** MCP servers that the platform connects to for enrichment during detection-pack generation. This is distinct from the platform's own [MCP server](mcp-server.md) (which other clients connect *to*).

## What it does

- Add/edit/test outbound MCP servers (stdio or http).
- Tokens are encrypted at rest; DB-managed servers win over the `MCP_SERVERS` env var on name collision.

## APIs

`/api/mcp/servers` (+ `/[id]`, `/[id]/test`).

## Config-as-code fallback

Self-hosters can seed servers via the `MCP_SERVERS` env var (semicolon-separated `name=transport:address[|option=value]`) — see [Configuration → MCP](../getting-started/configuration.md#mcp-server). The Settings UI is preferred.

## Related

- [MCP Registry](mcp-server.md) — the platform's own inbound MCP server.
- [Detection Packs](../detection/detection-packs.md) — where outbound enrichment is used.
