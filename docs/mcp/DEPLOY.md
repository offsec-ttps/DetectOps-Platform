# Deploying the Detection-Content MCP Server

The MCP server is an endpoint (`/api/mcp`) inside the DetectOps Next.js app, so deploying it
means deploying the app with the SQLite detection database available.

## Prerequisites

- Node.js 22+ (or Docker)
- The detection database `dev.db` (community rules, IOCs, threat intel). The `mcp_api_keys`
  table lives in the same DB — create it once if starting from a bare DB:
  ```sql
  -- see prisma/schema.prisma model McpApiKey; the table is mcp_api_keys.
  ```
  (In this repo it is created already; `npx prisma db push` regenerates it from the schema.)

## Option A — Node

```bash
cp .env.example .env          # set DATABASE_URL, MCP_PUBLIC_BASE_URL, AUTH_ENFORCED
npm ci
npx prisma generate
npm run build
npm run start                 # serves the app + MCP at :3000/api/mcp
```

## Option B — Docker

```bash
# builds the app image and mounts your dev.db at /data/dev.db
MCP_PUBLIC_BASE_URL=https://mcp.example.com \
docker compose -f docker-compose.mcp.yml up --build -d

# health
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS http://localhost:3000/api/mcp   # 204
```

The `Dockerfile` is multi-stage (installs a toolchain for the `better-sqlite3` native addon,
runs `prisma generate` + `next build`, then `next start`). The DB is supplied at runtime via a
bind mount so the ~400 MB database is never baked into the image.

## Reverse proxy + TLS (production)

Put the app behind nginx/Caddy terminating TLS. MCP clients connect over HTTPS.

```nginx
location /api/mcp {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   Authorization $http_authorization;   # pass the API key through
    proxy_read_timeout 300s;                                 # long tool calls
    proxy_buffering    off;                                  # stream responses
}
```

Set `MCP_PUBLIC_BASE_URL=https://mcp.example.com` so the console/docs advertise the right URL.

## Operations

- **Keys:** mint/revoke at `/mcp-registry` (admin) or the `/api/mcp/keys` admin API. Set
  `AUTH_ENFORCED=true` in production so those routes require an admin session (the public
  `/api/mcp` endpoint is always key-gated regardless).
- **Usage/audit:** every `tools/call`, mint, and revoke is written to `event_log`
  (category `mcp`) and the JSONL logs under `logs/`. Per-key `requestCount`/`dailyCount` live
  on `mcp_api_keys`.
- **Rate limiting** is in-process (per instance). For multi-instance/HA, front with a shared
  limiter (e.g. Redis) or rely on the durable per-key daily quota (DB counter) as the hard cap.
- **Scaling:** the server is stateless — run N replicas behind the proxy; each authenticates
  independently against the shared DB.
