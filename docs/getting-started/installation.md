# Installation

The fastest path is the bootstrap script, which performs a full preflight and starts the dev server. There's also a manual path and Docker options.

## Option A — Bootstrap script (recommended)

`start-server.sh` is a one-shot, idempotent bootstrap. It runs a 9-step preflight and then launches the app.

```bash
./start-server.sh            # full preflight + start on :3000
./start-server.sh --foreground   # run in the foreground (don't detach)
./start-server.sh --skip-checks  # skip the preflight (faster restarts)
./stop-server.sh             # stop the dev server, free port 3000
```

What the preflight does:

1. **Required tools** — verifies `node`/`npm`/`npx`, enforces **Node ≥ 22** (hard fail otherwise).
2. **Optional tools** — probes `sqlite3`, `VBoxManage`, `vagrant`, `python3` (≥3.10 for the Sigma venv), `gh`, and the Docker daemon (warn-only).
3. **Environment** — creates `.env` with a default `DATABASE_URL` if missing; reports on `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `CREDENTIAL_VAULT_KEY`.
4. **Dependencies** — runs `npm install` if `node_modules` is incomplete.
5. **Database** — `npx prisma generate` (if the client is missing) then `npx prisma db push` (syncs the schema to `dev.db`).
6. **Sigma CLI** — creates `backend/.venv` and `pip install -r backend/requirements.txt` (one-time) so Sigma conversion works.
7. **Stratus CLI** — checks for the cloud-detonation CLI (never auto-installed).
8. **LLM providers** — reports which providers are configured.
9. **Boot** — frees port 3000 and starts `next dev --webpack --port 3000`.

The app is then available at **http://localhost:3000** (log at `$TMPDIR/detection-platform-dev.log`, PID at `.next-dev.pid`).

## Option B — Manual

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env          # then edit — see Configuration

# 3. Initialize the database (schema → dev.db)
npx prisma generate
npx prisma db push

# 4. (Optional) Sigma CLI for rule conversion
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# 5. Run
npm run dev                   # dev server at http://localhost:3000
```

!!! info "Dev server uses webpack"
    The bootstrap starts Next.js with `--webpack` because Turbopack panics with this repo's parent-lockfile layout (see `next.config.ts`). `npm run dev` works too.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the dev server. |
| `npm run build` | Production build. Runs the docs-agent on `postbuild`. |
| `npm run start` | Run the production server (serves the app **and** the MCP endpoint at `/api/mcp`). |
| `npm run lint` | Lint the codebase. |
| `npm run docs:generate` | Regenerate the in-app auto-docs under `docs/generated/`. |
| `npm run seed:offensive-tools` | Optional DB seeder for offensive-tool catalog. |

## Production

```bash
npm run build
npm run start        # http://localhost:3000  (+ /api/mcp)
```

## Database notes

- Schema is applied with **`npx prisma db push`** (there is no `migrate deploy` / seed hook wired in `prisma.config.ts`).
- The shipped `dev.db` already contains the 14,000+ community rules, ~98k IOCs, and threat-intel reports — self-hosters use it directly rather than re-seeding.
- `DATABASE_URL` defaults to `file:./dev.db`.

## Docker

Three compose/Dockerfile setups exist:

=== "Full app (frontend + backend)"

    ```bash
    docker compose up --build
    ```
    Brings up `frontend` (Next.js, :3000) and `backend` (FastAPI "SentinelFlow", :8000, health at `/health`). The frontend reads `SENTINELFLOW_API_URL=http://backend:8000`.

=== "MCP server only"

    ```bash
    docker compose -f docker-compose.mcp.yml up --build
    ```
    Builds the app image, mounts `./dev.db:/data/dev.db`, and honors `ENABLE_MCP_SERVER`, `MCP_PUBLIC_BASE_URL`, `AUTH_ENFORCED`. See the [MCP Deploy Guide](../mcp/DEPLOY.md).

The primary `Dockerfile` is a multi-stage build (`node:22-bookworm-slim`) that installs `python3 make g++` for the `better-sqlite3` native addon, runs `npx prisma generate` + `npm run build`, and starts with `npm run start`. The database is supplied at runtime via a bind mount (not baked into the image).

Next: [Configuration](configuration.md) for the full environment-variable reference.
