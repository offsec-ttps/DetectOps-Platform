# DetectOps Platform — Setup

Get the web platform running locally, then (optionally) stand up a detection lab
to simulate against. See `README.md` for what the platform does and
`openwiki/quickstart.md` for the architecture tour.

## Prerequisites

- **Node.js 20+** and npm
- A POSIX shell (Linux/macOS; WSL on Windows)
- Optional, per feature:
  - **VirtualBox + Vagrant** — local SAR/GOAD labs
  - **Python 3** with `pywinrm` — driving atomics on Windows lab hosts over WinRM
  - **pandoc** + **libreoffice** — DOCX/PDF report rendering
  - An LLM API key (OpenAI / Anthropic / OpenRouter / NVIDIA, or local Ollama) — AI-assisted features

## 1. Install & configure

```bash
npm install
cp .env.example .env
# edit .env — at minimum set CREDENTIAL_VAULT_KEY (openssl rand -hex 32)
# and, for production, ADMIN_EMAILS.
```

## 2. Database

The default datasource is SQLite (`dev.db`). Create/sync the schema and client:

```bash
npx prisma db push      # create/sync schema to the DB
npx prisma generate     # generate the client
```

## 3. Run

```bash
npm run dev             # http://localhost:3000  (webpack dev server)
```

> The dev script uses `next dev --webpack` on purpose: the webpack watcher is
> configured (in `next.config.ts`) to ignore `dev.db`, `labs/deployments/`,
> `reports/`, and logs. Those files change constantly at runtime (DB writes, live
> VM disks) and would otherwise trigger an endless hot-reload loop. If you host
> lab deployments outside the repo via `LAB_DEPLOY_ROOTS`, that churn leaves the
> watched tree entirely.

For production:

```bash
npm run build
NODE_ENV=production npm run start
```

## 4. First admin user

With auth enforced (production, or `AUTH_ENFORCE=1`):

1. Put the admin email in `ADMIN_EMAILS` **before** first run.
2. Sign up at `/signup`; the account is created unverified with the password
   staged against the emailed 6-digit code.
3. Verify at `/verify`; the password becomes active and the `ADMIN_EMAILS` match
   grants the admin role. (In local dev with no SMTP, the code is returned in the
   signup/verify response so the loop works offline.)

In plain dev (auth not enforced) a synthetic admin user is assumed — no signup
needed.

## 5. Labs (optional)

Lab deployments live under `./labs/deployments/` (or `LAB_DEPLOY_ROOTS`) and are
**gitignored** — you deploy your own from the bundled blueprints via the Deploy
section (Local VirtualBox / Cloud / Fleet). Start/stop is manual; nothing
auto-starts a lab. See `openwiki/` for the lab workflows.

## Security / deployment notes

- Set `TRUSTED_PROXY_HOPS` to the number of reverse-proxy hops in front of the
  app so rate-limiting reads the real client IP (don't leave it trusting a
  client-settable `X-Forwarded-For`).
- Set a strong, persistent `CREDENTIAL_VAULT_KEY`; rotating it invalidates all
  stored encrypted credentials.
- Provide `LAB_TLS_CA_FILE` to verify self-signed lab TLS instead of skipping
  verification.
- Keep real secrets in `.env` only (gitignored). `.env.example` documents every
  supported variable.
