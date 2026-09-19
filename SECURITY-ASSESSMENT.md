# Security Assessment — DetectOps

_Authorized white-box review. Date: 2026-09-16. Scope: pending working-tree change + high-risk modules (auth-guard, deploy/simulate engines, SIEM/C2/cloud proxies, credential handling, CLI + creds endpoint). Not an exhaustive audit of all API routes. Findings below are confirmed against the code unless marked "needs verification"._

## Executive summary

- The `.gitattributes` `*.*` LFS rule is **critical**: it breaks builds and turns `.gitignore` into an LFS pointer, which strips the rules keeping `.env` and `.bas-signing-key.pem` out of git — a direct secret-leak path.
- The plaintext-credentials endpoint has a **broken auth gate** (wrong env-var name) that serves lab passwords unauthenticated even in "enforced" deployments.
- Deploy/VM engines are safe from shell injection (`execFile` + array args); network input is validated; secrets use AES-GCM at rest.

**Fix first:** F1 (`.gitattributes`), F2 (creds auth gate), F3 (unvalidated `?deployPath=`).

## Attack surface (relevant slice)

- **HTTP API** `src/app/api/**` — advisory auth: `requireUser()` returns a synthetic admin in dev; enforced only when `AUTH_ENFORCE=1` or `NODE_ENV=production`.
- **Local command execution** — deploy/VM lifecycle (`VBoxManage`, `rsync`, `attack_range_local.py`, ansible) via `execFile`; cloud terminal via `/bin/sh -lc`.
- **Outbound (SSRF-by-design)** — SIEM (Splunk/MDE) and C2 (Caldera) bring-your-own URLs fetched server-side; cloud controller proxy → localhost.
- **Secrets** — `credential-vault` (AES-GCM, key `CREDENTIAL_VAULT_KEY`); lab confs hold plaintext passwords; `.bas-signing-key.pem` (BAS agent signing key).

## Threat model (summary)

- **External unauth attacker** (esp. `AUTH_ENFORCE=1` prod): creds-gate typo (F2) → lab passwords; gutted `.gitignore` (F1) → `.env`/signing key published.
- **Authenticated operator / insider**: conf-injection (F5); arbitrary conf read (F3).
- **Supply chain / repo**: F1 corrupts the repo on next commit/clone.

---

## Findings

### F1 — `.gitattributes` `*.*` routes everything into Git LFS — Critical (A08 / A05, secret exposure)

- **Location:** `.gitattributes:2` — `*.* filter=lfs diff=lfs merge=lfs -text`
- **Confirmed:** `git check-attr filter -- package.json src/lib/github.ts .gitignore` → `filter: lfs`; `git lfs ls-files` already lists `.gitignore`, `.env.example`.
- **Impact:**
  1. On commit / fresh clone without hydrated LFS objects, source/config become ~3-line pointer stubs → `tsc` / `next build` / `cargo` / shell scripts fail.
  2. `.gitignore` becomes a pointer → its rules stop applying. `git check-ignore` confirms it currently ignores `.env` (line 3) and `.bas-signing-key.pem` (line 8); once gutted, a `git add -A` commits the **BAS private signing key and `.env`**.
- **Remediation:** delete line 2. Use LFS only for genuine large binaries by exact path/extension. Prefer gitignoring `dev.db` over LFS-tracking a committed SQLite DB.
- **Verify:** `git check-attr filter -- package.json src/lib/github.ts .gitignore` → `unspecified`; `git lfs ls-files` empty (or only intended binaries).

### F2 — Plaintext-credentials endpoint auth gate never triggers — High (A01 / A07)

- **Location:** `src/app/api/sar/credentials/route.ts:37`
- **Confirmed:** gates on `process.env.AUTH_ENFORCED === "true"`, but `authEnforced()` (`src/lib/auth-guard.ts`) uses **`AUTH_ENFORCE` (=== "1")** / `NODE_ENV==="production"`. In an enforced prod deploy, every other route requires a session but this one does not — it returns Splunk/Windows/Caldera **plaintext passwords** to any caller. It never calls `requireUser()`.
- **Attack scenario:** enforced prod deployment reachable on the network → `GET /api/sar/credentials` with no cookie → lab admin passwords.
- **Remediation:** use the shared guard + ownership:
  ```ts
  import { requireUser } from "@/lib/auth-guard";
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  ```
  Delete the `AUTH_ENFORCED` check.
- **Verify:** with `AUTH_ENFORCE=1`, unauthenticated `GET /api/sar/credentials` → 401.

### F3 — Unvalidated `?deployPath=` → arbitrary conf read — Medium (A01 path traversal) — introduced this session

- **Location:** `src/app/api/sar/credentials/route.ts` (the `deployPath` param)
- **Issue:** `deployPath` is used directly to read `<dp>/sar/attack_range_local.conf` or `<dp>/attack_range_local.conf` with no allow-listing → a caller can point it anywhere (limited to that basename). With F2 it's unauthenticated.
- **Remediation:** validate `deployPath` against known deployments (registry / system-info) before reading:
  ```ts
  // resolve deployPath only if it matches a registered deployment path
  const known = /* labs/.deployments-registry.json → deployPath[] */;
  if (dp && !known.includes(dp)) return NextResponse.json({ available:false, reason:"unknown lab" });
  ```
- **Verify:** `?deployPath=/etc` → `available:false`.

### F4 — Cloud terminal runs `/bin/sh -lc <built command>` — Medium, needs verification (A03 command injection)

- **Location:** `src/lib/terminal-sessions.ts:94`; callers `src/app/api/detection-lab/cloud/terminal/sessions/route.ts:38`, `.../run-tool/route.ts:42` (command built by `buildSshCommand` from user-supplied `rangeId`/`serverName`).
- **Why flagged:** a shell string run via `-lc` that interpolates user-influenced `serverName`/`rangeId` is a classic injection sink **if** those aren't strictly validated/quoted in `buildSshCommand`. Escaping was NOT confirmed — review `buildSshCommand` / `TOOL_RUNNERS`.
- **Remediation:** build the SSH invocation with `execFile("ssh", [args…])` (no shell), or strictly allow-list `serverName`/`rangeId` (`^[A-Za-z0-9._-]+$`).
- **Verify:** `serverName="x;id"` must not execute `id`.

### F5 — `patchSARConf` writes operator input into the conf via `String.replace` — Low (A03 / robustness)

- **Location:** `src/app/api/detection-lab/deploy/route.ts` (`setKey`, ~1323–1344)
- **Issue:** `splunk_admin_password` / `win_password` inserted with `conf.replace(re, "$1"+value)`; a value with a newline could inject an extra conf line, and a literal `$` acts as a regex backref (corruption). Operator-only / self-targeted → low impact.
- **Remediation:** use a replacer function (avoids `$` interpretation) and reject newlines: `conf.replace(re, (_, p1) => p1 + value)` after `if (/[\r\n]/.test(value)) reject`.

## Verified safe (stated explicitly — no hallucinated issues)

- No shell injection in the deploy/VM engine: all calls are `execFile("VBoxManage"|"rsync"|…, [array])`; no `shell:true`.
- `networkBase` is validated (`/^\d+\.\d+\.\d+$/`) before use.
- The cloud-lab templates proxy (`/api/cloud-lab/templates`) targets a fixed `localhost:4000` (env-overridable) — not user-controlled → no SSRF from it.
- Secrets at rest use AES-GCM (`credential-vault`). Note: `CREDENTIAL_VAULT_KEY` unset → ephemeral key (documented) — set it in prod.

## Remediation roadmap

- **Now (minutes):** F1 (remove `*.*`; gitignore `dev.db`; rotate `.bas-signing-key.pem` / `.env` secrets **if ever pushed** with the LFS rule / gutted ignore in effect); F2 (fix env-var + `requireUser`).
- **This week:** F3 (allow-list deployPath); F4 (verify/harden SSH command build).
- **Hardening:** F5; require production to set `AUTH_ENFORCE=1` + `CREDENTIAL_VAULT_KEY`; egress allow-list for SIEM/C2 outbound; API security-header/CORS review.

## Hardening checklist

- [ ] No `*.*` in `.gitattributes`; secrets confirmed git-ignored; `dev.db` ignored.
- [ ] Every plaintext/secret-returning route goes through `requireUser()` + ownership.
- [ ] Single consistent auth flag (`AUTH_ENFORCE`) — grep for stray `AUTH_ENFORCED`.
- [ ] User-supplied paths allow-listed; user values never interpolated into a shell.
- [ ] `CREDENTIAL_VAULT_KEY` set; outbound SIEM/C2 URLs egress-restricted.
