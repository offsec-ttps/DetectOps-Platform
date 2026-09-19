#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DetectOps — start-server.sh
#
# One-shot bootstrap that verifies every dependency the web app needs, fixes
# what it can (install Node modules, regenerate Prisma client, sync schema,
# free port 3000), warns about what it can't (Docker daemon, VBox, Vagrant,
# GitHub token), then launches the Next.js dev server in the background.
#
# Safe to re-run any time. Idempotent.
#
# Usage:
#   ./start-server.sh                   # check + start
#   ./start-server.sh --skip-checks     # start fast (assume deps fine)
#   ./start-server.sh --foreground      # don't background; tail log inline
#   ./start-server.sh --help
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# ── Config ──
PORT="${PORT:-3000}"
LOG_FILE="${TMPDIR:-/tmp}/detection-platform-dev.log"
PID_FILE="$PROJECT_ROOT/.next-dev.pid"
READY_TIMEOUT_S=60                 # max seconds to wait for dev server to answer
NODE_MIN_MAJOR=22                  # Next.js 16 needs Node 18+, we target 22
SKIP_CHECKS=0
FOREGROUND=0
NO_CLOUD=0                         # --no-cloud / CLOUD_CONTROLLER=0 skips the cloud-lab-app

# ── Args ──
for a in "$@"; do
  case "$a" in
    --skip-checks) SKIP_CHECKS=1 ;;
    --foreground)  FOREGROUND=1 ;;
    --no-cloud)    NO_CLOUD=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $a" >&2; exit 2 ;;
  esac
done

# ── Color helpers ──
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'
  C_DIM=$'\033[2m';  C_BLD=$'\033[1m';  C_RST=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YLW=""; C_BLU=""; C_DIM=""; C_BLD=""; C_RST=""
fi
ok()    { printf "  %s✓%s %s\n"   "$C_GRN" "$C_RST" "$*"; }
warn()  { printf "  %s!%s %s\n"   "$C_YLW" "$C_RST" "$*"; }
err()   { printf "  %s✗%s %s\n"   "$C_RED" "$C_RST" "$*" >&2; }
step()  { printf "%s▸%s %s\n"     "$C_BLU" "$C_RST" "$*"; }
header(){ printf "\n%s%s%s\n"     "$C_BLD" "$*" "$C_RST"; }

# ── Verbose error trap ──
trap 'err "start-server.sh failed at line $LINENO (exit $?)."' ERR

# ── Required deps (hard fail if absent) ──
check_required() {
  step "Checking required tools"
  local missing=()
  for bin in node npm npx; do
    command -v "$bin" >/dev/null || missing+=("$bin")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    err "Missing required tools: ${missing[*]}"
    err "Install Node.js ${NODE_MIN_MAJOR}+ (https://nodejs.org/) and retry."
    exit 1
  fi
  local node_major
  node_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "$node_major" -lt "$NODE_MIN_MAJOR" ]; then
    err "Node.js v$node_major is too old. Need v${NODE_MIN_MAJOR}+."
    exit 1
  fi
  ok "Node.js $(node -v) · npm $(npm -v)"
}

# ── Optional deps (warn only) ──
check_optional() {
  step "Checking optional tools (warn-only)"
  command -v sqlite3   >/dev/null && ok "sqlite3 present"             || warn "sqlite3 not found — DB inspection scripts won't run"
  command -v VBoxManage >/dev/null && ok "VirtualBox present"         || warn "VirtualBox not found — on-prem Vagrant labs disabled"
  command -v vagrant   >/dev/null && ok "Vagrant present"             || warn "Vagrant not found — on-prem labs disabled"
  command -v python3   >/dev/null && ok "python3 present"             || warn "python3 not found — SAR/ART simulations disabled"
  command -v gh        >/dev/null && ok "gh CLI present"              || warn "gh CLI not found — some report flows degrade"

  # Pick a usable Python ≥ 3.10 for the Sigma CLI venv.
  PYTHON_BIN=""
  for p in python3.13 python3.12 python3.11 python3.10; do
    if command -v "$p" >/dev/null && "$p" -c "import venv,subprocess" >/dev/null 2>&1; then
      PYTHON_BIN="$p"; break
    fi
  done
  if [ -n "$PYTHON_BIN" ]; then
    ok "$PYTHON_BIN present (used for Sigma CLI venv)"
  else
    warn "No usable Python ≥ 3.10 — Sigma CLI cannot be installed (Rule Workspace conversion disabled)"
  fi

  if command -v docker >/dev/null; then
    if docker info >/dev/null 2>&1; then
      ok "Docker daemon running"
    else
      warn "Docker installed but daemon not running — start it for 'SAR Cloud Deployment Docker' template"
    fi
  else
    warn "Docker not found — SAR Cloud Deployment Docker template disabled"
  fi
}

# ── Sigma CLI (Rule Workspace conversion) ──
# The Rule Workspace page calls /api/rule-workspace/sigma-convert which looks
# for a `sigma` binary at backend/.venv/bin/sigma (priority 2 in
# src/lib/community-sources/sigma-cli.ts). Without it the UI banner reads
# "Sigma CLI not installed" and the convert button is disabled.
check_sigma_cli() {
  step "Checking Sigma CLI (Rule Workspace conversion)"
  local SIGMA_BIN="backend/.venv/bin/sigma"
  if [ -x "$SIGMA_BIN" ]; then
    local ver
    ver="$("$SIGMA_BIN" version 2>/dev/null | head -1 || true)"
    if [ -n "$ver" ]; then
      ok "Sigma CLI present (${ver})"
      return 0
    fi
  fi
  if [ -z "${PYTHON_BIN:-}" ]; then
    warn "Skipping Sigma CLI install — no Python ≥ 3.10 available"
    return 0
  fi
  warn "Sigma CLI not installed — installing into backend/.venv (one-time, ~60s)"
  if [ ! -d backend/.venv ]; then
    if ! "$PYTHON_BIN" -m venv backend/.venv 2>&1 | tail -3 | sed "s/^/    /"; then
      warn "venv creation failed — Rule Workspace conversion will stay disabled"
      return 0
    fi
  fi
  # Quiet pip; show only tails on error
  backend/.venv/bin/pip install --quiet --upgrade pip >/dev/null 2>&1 || true
  if ! backend/.venv/bin/pip install --quiet -r backend/requirements.txt > /tmp/dp-pip.log 2>&1; then
    warn "pip install failed. Tail of /tmp/dp-pip.log:"
    tail -10 /tmp/dp-pip.log | sed "s/^/    /" >&2
    warn "Rule Workspace conversion will stay disabled until this is fixed."
    return 0
  fi
  if [ -x "$SIGMA_BIN" ] && "$SIGMA_BIN" version >/dev/null 2>&1; then
    ok "Sigma CLI installed ($("$SIGMA_BIN" version 2>/dev/null | head -1))"
  else
    warn "Install reported success but $SIGMA_BIN doesn't run. Inspect backend/.venv."
  fi
}

# ── Stratus CLI (Phase 4 — cloud execution runtime) ──
# Stratus is a Go binary; the platform never installs it automatically (the
# tradeoff: a Go toolchain isn't always available). When missing, the canvas
# + upload + dry-run flows still work; only live cloud detonation is gated.
check_stratus_cli() {
  step "Checking Stratus CLI (Phase 4 cloud execution)"
  # Check candidates in order:  $STRATUS_BIN  →  /usr/local/bin/stratus  →
  #                              ~/go/bin/stratus  →  which stratus
  local candidates=()
  [ -n "${STRATUS_BIN:-}" ] && candidates+=("$STRATUS_BIN")
  candidates+=("/usr/local/bin/stratus" "$HOME/go/bin/stratus")
  local found=""
  for c in "${candidates[@]}"; do
    if [ -x "$c" ]; then found="$c"; break; fi
  done
  if [ -z "$found" ]; then
    if command -v stratus >/dev/null; then found="$(command -v stratus)"; fi
  fi
  if [ -n "$found" ]; then
    local ver
    ver="$("$found" version 2>/dev/null | head -1 || "$found" --version 2>/dev/null | head -1 || true)"
    ok "Stratus CLI present (${ver:-version unknown}) at $found"
  else
    warn "Stratus CLI not found. Live cloud detonation disabled (dry-run still works)."
    warn "  Install: brew install stratus-red-team  |  go install github.com/datadog/stratus-red-team/v2/cmd/stratus@latest"
    warn "  Or set STRATUS_BIN to the binary path."
  fi
}

# ── LLM providers (Phase 2 — Detection Pack multi-provider backbone) ──
# Lists which AI providers have keys present in .env. No keys are echoed.
check_llm_providers() {
  step "Checking LLM providers"
  local default_provider="${LLM_PROVIDER_DEFAULT:-anthropic}"
  ok "Default provider: $default_provider"
  local any=0
  if grep -qE '^ANTHROPIC_API_KEY=.+$' .env 2>/dev/null && ! grep -qE '^ANTHROPIC_API_KEY=$' .env 2>/dev/null; then
    ok "  Anthropic        configured"
    any=1
  else
    warn "  Anthropic        not configured (ANTHROPIC_API_KEY)"
  fi
  if grep -qE '^OPENAI_API_KEY=.+$' .env 2>/dev/null && ! grep -qE '^OPENAI_API_KEY=$' .env 2>/dev/null; then
    ok "  OpenAI           configured"
    any=1
  else
    warn "  OpenAI           not configured (OPENAI_API_KEY)"
  fi
  if grep -qE '^OPENROUTER_API_KEY=.+$' .env 2>/dev/null && ! grep -qE '^OPENROUTER_API_KEY=$' .env 2>/dev/null; then
    ok "  OpenRouter       configured"
    any=1
  else
    warn "  OpenRouter       not configured (OPENROUTER_API_KEY)"
  fi
  if grep -qE '^NVIDIA_API_KEY=.+$' .env 2>/dev/null && ! grep -qE '^NVIDIA_API_KEY=$' .env 2>/dev/null; then
    ok "  NVIDIA NIM       configured"
    any=1
  else
    warn "  NVIDIA NIM       not configured (NVIDIA_API_KEY)"
  fi
  local ollama_host="${OLLAMA_HOST:-http://127.0.0.1:11434}"
  if curl -s -m 1 -o /dev/null -w "%{http_code}" "$ollama_host/api/tags" 2>/dev/null | grep -q "^200$"; then
    ok "  Ollama           reachable at $ollama_host"
    any=1
  else
    warn "  Ollama           not reachable at $ollama_host (OLLAMA_HOST)"
  fi
  if grep -qE '^MCP_SERVERS=.+$' .env 2>/dev/null && ! grep -qE '^MCP_SERVERS=$' .env 2>/dev/null; then
    ok "  MCP servers      defined in .env"
  fi
  if [ "$any" -eq 0 ]; then
    warn "No LLM providers configured. Detection Pack generation will fail with 503 until you set at least one API key."
  fi
  # Phase 3 auto-pipeline — enqueue + manual/cron-driven worker
  local budget="${DETECTION_PACK_DAILY_TOKEN_BUDGET:-500000}"
  ok "  Auto-pipeline    enqueue hooks live · budget ${budget} tok/day"
  ok "                   tick:   POST /api/detection-packs/jobs/tick (queue UI auto-ticks while open)"
}

# ── .env presence + GITHUB_TOKEN sanity ──
check_env() {
  step "Checking environment file"
  if [ ! -f .env ]; then
    warn ".env missing — creating with DATABASE_URL only (Build Forge GitHub probes will be rate-limited)"
    cat > .env <<EOF
# Auto-generated by start-server.sh on $(date -u +%FT%TZ)
DATABASE_URL="file:./dev.db"
# GITHUB_TOKEN="ghp_xxx"  # uncomment + paste a classic PAT with public_repo scope
EOF
  fi
  ok ".env present"
  # Don't print the token. Just say whether it's there.
  if grep -qE '^GITHUB_TOKEN="ghp_[A-Za-z0-9_]+"' .env; then
    ok "GITHUB_TOKEN set in .env (Build Forge probes will use authenticated 5000/hr)"
  else
    warn "GITHUB_TOKEN not set in .env (Build Forge probes capped at 60/hr unauthenticated)"
  fi
  # AI generators (Phase 2 / Phase 3)
  if grep -qE '^ANTHROPIC_API_KEY=.+$' .env && ! grep -qE '^ANTHROPIC_API_KEY=$' .env; then
    ok "ANTHROPIC_API_KEY set in .env (AI generators enabled)"
  else
    warn "ANTHROPIC_API_KEY empty in .env — AI generators (atomic-from-prompt, ti-to-playbook, from-rule) will return 503"
  fi
  # Credential vault (Phase 4)
  if grep -qE '^CREDENTIAL_VAULT_KEY=.{16,}' .env; then
    ok "CREDENTIAL_VAULT_KEY set in .env (cloud credentials persist across restarts)"
  else
    warn "CREDENTIAL_VAULT_KEY empty in .env — cloud creds use a process-local ephemeral key (lost on restart). Set 32+ random chars for durable storage."
  fi
}

# ── Node modules ──
check_node_modules() {
  step "Checking node_modules"
  if [ ! -d node_modules ] || [ ! -d node_modules/next ] || [ ! -d node_modules/@prisma/client ]; then
    warn "node_modules missing/incomplete — running npm install (this may take a minute)"
    npm install --no-audit --no-fund
    ok "npm install complete"
  else
    ok "node_modules present (next: $(node -e "console.log(require('./node_modules/next/package.json').version)" 2>/dev/null || echo '?'))"
  fi
}

# ── Prisma client + DB sync ──
check_prisma() {
  step "Checking Prisma client + schema sync"
  # The generated client lives directly under src/generated/prisma in this repo
  # (per generator.client.output in prisma/schema.prisma).
  if [ ! -f src/generated/prisma/client.ts ] && [ ! -d src/generated/prisma/client ]; then
    warn "Generated Prisma client missing — running 'prisma generate'"
    npx prisma generate >/dev/null
  fi
  # db push is cheap when nothing changed and additive when it isn't. Prisma 7
  # in this repo doesn't accept --skip-generate, so we let it regenerate.
  # Capture stderr+stdout to log; abort with helpful message on failure.
  local out
  if out="$(npx prisma db push 2>&1)"; then
    printf "%s\n" "$out" | tail -2 | sed "s/^/    /"
    ok "Prisma client + dev.db in sync"
  else
    err "prisma db push failed:"
    printf "%s\n" "$out" | tail -20 | sed "s/^/    /" >&2
    err "Fix the schema and rerun, or run 'npx prisma db push --accept-data-loss' manually."
    return 1
  fi
}

# ── Port 3000 ──
free_port() {
  step "Checking port $PORT"
  local pids=""
  if command -v lsof >/dev/null; then
    pids="$(lsof -ti :"$PORT" 2>/dev/null || true)"
  elif command -v fuser >/dev/null; then
    pids="$(fuser "$PORT"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -v '^$' || true)"
  fi
  if [ -n "$pids" ]; then
    warn "Port $PORT in use by PID(s): $pids — running stop-server.sh first"
    ./stop-server.sh --quiet || true
    sleep 2
  else
    ok "Port $PORT free"
  fi
}

# ── Boot dev server ──
boot_server() {
  step "Starting Next.js dev server (Turbopack, port $PORT)"
  # Turbopack — far faster on-demand route compilation than webpack (heavy pages
  # like /detections & /rule-workspace compiled in ~8s under webpack on first
  # visit, which made switching sidebar sections feel slow). The old parent-
  # lockfile panic is resolved by `turbopack.root` in next.config.ts. To force
  # the legacy engine, set DEV_ENGINE=webpack.
  local ENGINE="--turbopack"; [ "${DEV_ENGINE:-}" = "webpack" ] && ENGINE="--webpack"
  : > "$LOG_FILE"
  if [ "$FOREGROUND" = "1" ]; then
    ok "Dev server logs streaming below (Ctrl-C to stop)…"
    exec npx next dev $ENGINE --port "$PORT"
  fi

  nohup npx next dev $ENGINE --port "$PORT" >"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  disown "$pid" 2>/dev/null || true
  ok "Spawned PID $pid"

  # Poll for readiness via HTTP
  local waited=0
  while [ "$waited" -lt "$READY_TIMEOUT_S" ]; do
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" 2>/dev/null | grep -qE "^(200|307)$"; then
      ok "Dev server is ready (waited ${waited}s)"
      return 0
    fi
    # Detect early death
    if ! kill -0 "$pid" 2>/dev/null; then
      err "Dev server died before becoming ready. Last log lines:"
      tail -25 "$LOG_FILE" >&2 || true
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  err "Dev server did not respond within ${READY_TIMEOUT_S}s. Tail of log:"
  tail -25 "$LOG_FILE" >&2 || true
  return 1
}

# ── Cloud controller (extracted SAR Cloud app in cloud-lab-app/) ──────────────
# The web app extracted from the "SAR Cloud Deployment Docker" container, now run
# LOCALLY: a Flask API (:4000) + an Astro UI (:4321). Launched alongside the main
# web server so the Cloud Lab page's templates panel — and the full controller UI
# — work in dev. This is a local web service; it does NOT boot any VM/lab/Docker
# stack. Opt out with --no-cloud or CLOUD_CONTROLLER=0.
CLOUD_DIR="$PROJECT_ROOT/cloud-lab-app"
CLOUD_API_PORT="${CLOUD_API_PORT:-4000}"
CLOUD_APP_PORT="${CLOUD_APP_PORT:-4321}"

_kill_port() {
  local p="$1" pids=""
  if command -v lsof >/dev/null; then pids="$(lsof -ti :"$p" 2>/dev/null || true)"
  elif command -v fuser >/dev/null; then pids="$(fuser "$p"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -v '^$' || true)"; fi
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
}

boot_cloud_controller() {
  step "Starting Cloud controller (cloud-lab-app: API :$CLOUD_API_PORT + UI :$CLOUD_APP_PORT)"
  if [ "${CLOUD_CONTROLLER:-1}" = "0" ] || [ "$NO_CLOUD" = "1" ]; then
    warn "Skipped (--no-cloud / CLOUD_CONTROLLER=0)"; return 0
  fi
  if [ ! -d "$CLOUD_DIR" ]; then warn "cloud-lab-app/ not found — skipping cloud controller"; return 0; fi
  if [ ! -x "$CLOUD_DIR/.venv/bin/python" ]; then
    warn "cloud-lab-app/.venv missing — set it up once:"
    warn "  python3.11 -m venv cloud-lab-app/.venv && cloud-lab-app/.venv/bin/pip install -r cloud-lab-app/requirements.txt"
    return 0
  fi
  if [ ! -d "$CLOUD_DIR/app/node_modules" ]; then
    warn "cloud-lab-app/app/node_modules missing — run: (cd cloud-lab-app/app && npm install)"; return 0
  fi

  # Free stale ports from a previous run, then launch both (detached).
  _kill_port "$CLOUD_API_PORT"; _kill_port "$CLOUD_APP_PORT"; sleep 1
  # The controller runs with TMPDIR=$CLOUD_DIR/.tmp; it MUST exist or terraform
  # fails provider downloads with "failed to open temporary file ... no such file
  # or directory" (easy to hit after a disk cleanup removes the cache dirs).
  mkdir -p "$CLOUD_DIR/.tmp"
  # Prepend the venv bin to PATH so the controller's subprocess calls to
  # ansible-galaxy / ansible-playbook / terraform resolve to the venv's working
  # copies — NOT the broken system /usr/bin/ansible-galaxy (no `ansible` module),
  # which fails SAR cloud builds at the role-install step.
  # ANSIBLE_GALAXY_SERVER: /etc/ansible/ansible.cfg points galaxy at the dead
  # `old-galaxy.ansible.com`, so any role install at build time 404s. Override it.
  ( cd "$CLOUD_DIR"     && TMPDIR="$CLOUD_DIR/.tmp" PATH="$CLOUD_DIR/.venv/bin:$PATH" ANSIBLE_GALAXY_SERVER="https://galaxy.ansible.com" nohup .venv/bin/python api/app.py > "$CLOUD_DIR/.cloud-api.log" 2>&1 & echo $! > "$CLOUD_DIR/.cloud-api.pid" )
  ( cd "$CLOUD_DIR/app" && nohup npm run dev                                         > "$CLOUD_DIR/.cloud-app.log" 2>&1 & echo $! > "$CLOUD_DIR/.cloud-app.pid" )

  # Readiness — warn-only; the controller must never fail the whole bootstrap.
  local waited=0 api_ok=0 app_ok=0
  while [ "$waited" -lt 45 ]; do
    if [ "$api_ok" = "0" ] && curl -s -o /dev/null -m 3 "http://localhost:$CLOUD_API_PORT/templates" 2>/dev/null; then api_ok=1; fi
    if [ "$app_ok" = "0" ] && curl -s -o /dev/null -m 3 "http://localhost:$CLOUD_APP_PORT/" 2>/dev/null; then app_ok=1; fi
    [ "$api_ok" = "1" ] && [ "$app_ok" = "1" ] && break
    sleep 2; waited=$((waited + 2))
  done
  if [ "$api_ok" = "1" ]; then ok "Cloud API ready → http://localhost:$CLOUD_API_PORT"; else warn "Cloud API not ready yet — see cloud-lab-app/.cloud-api.log"; fi
  if [ "$app_ok" = "1" ]; then ok "Cloud UI ready  → http://localhost:$CLOUD_APP_PORT"; else warn "Cloud UI not ready yet — see cloud-lab-app/.cloud-app.log"; fi
}

# ── Main ──
header "DetectOps · start-server"
printf "%sproject:%s %s\n"  "$C_DIM" "$C_RST" "$PROJECT_ROOT"
printf "%sport:%s    %s\n"  "$C_DIM" "$C_RST" "$PORT"
printf "%slog:%s     %s\n"  "$C_DIM" "$C_RST" "$LOG_FILE"

if [ "$SKIP_CHECKS" = "0" ]; then
  header "1/9  Required tools";  check_required
  header "2/9  Optional tools";  check_optional
  header "3/9  Environment";     check_env
  header "4/9  Node modules";    check_node_modules
  header "5/9  Database";        check_prisma
  header "6/9  Sigma CLI";       check_sigma_cli
  header "7/9  Stratus CLI";     check_stratus_cli
  header "8/9  LLM providers";   check_llm_providers
fi
# Cloud controller first — in --foreground mode boot_server execs and never returns.
header "9/10  Cloud controller"; boot_cloud_controller || true
header "10/10 Server";           free_port; boot_server

cat <<EOF

${C_GRN}${C_BLD}✓ DetectOps is up.${C_RST}
   ${C_BLD}Console URL${C_RST}    http://localhost:${PORT}
   ${C_BLD}Landing page${C_RST}   http://localhost:${PORT}/         (public)
   ${C_BLD}Sign in${C_RST}        http://localhost:${PORT}/login
   ${C_BLD}Sign up${C_RST}        http://localhost:${PORT}/signup
   ${C_BLD}Dashboard${C_RST}      http://localhost:${PORT}/overview
   ${C_BLD}Cloud UI${C_RST}       http://localhost:${CLOUD_APP_PORT}      (SAR Cloud Controller)
   ${C_BLD}Cloud API${C_RST}      http://localhost:${CLOUD_API_PORT}
   ${C_BLD}Log${C_RST}            tail -f ${LOG_FILE}
   ${C_BLD}Stop${C_RST}           ./stop-server.sh

   ${C_DIM}This script starts the web server AND the local Cloud Controller web
   app (cloud-lab-app: Astro UI + Flask API) so both come up together. Use
   --no-cloud to skip the controller. It still never boots your labs, VMs,
   Docker stacks, or the Caldera C2 — start/stop those yourself under
   Deploy → Manage Labs and /caldera, so they don't hog memory/disk.
   ./stop-server.sh stops the web server + the Cloud Controller, not your labs.${C_RST}
EOF
