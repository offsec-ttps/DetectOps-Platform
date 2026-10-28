#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DetectOps — start-docs.sh
#
# One-shot bootstrap for the documentation site (MkDocs Material):
#   1. Ensures the docs virtualenv (.venv-docs) exists.
#   2. Checks for / pulls dependency updates from docs/requirements.txt.
#   3. Builds the site with `mkdocs build --strict` (fails fast on broken links).
#   4. Launches `mkdocs serve` in the background and waits until it answers.
#
# Serves ONLY the docs (default http://127.0.0.1:8000) — separate from the web
# app (:3000) and the Cloud Controller (:4321/:4000). Safe to re-run; idempotent.
#
# Usage:
#   ./start-docs.sh                 # update deps, build, serve (background)
#   ./start-docs.sh --foreground    # serve in the foreground (Ctrl-C to stop)
#   ./start-docs.sh --build-only    # update + build, don't serve
#   ./start-docs.sh --no-build      # skip the strict build, just serve
#   ./start-docs.sh --skip-install  # don't touch the venv / deps
#   ./start-docs.sh --port 8123     # serve on a different port
#   ./start-docs.sh --host 0.0.0.0  # reachable from other devices on the LAN
#   ./start-docs.sh --stop          # stop a running docs server
#   ./start-docs.sh --help
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# ── Config ──
VENV="$PROJECT_ROOT/.venv-docs"
REQ="$PROJECT_ROOT/docs/requirements.txt"
# Bind 127.0.0.1 by default (not reachable off-box). Set DOCS_HOST=0.0.0.0 (or use
# --host 0.0.0.0) to expose the docs on the LAN / server IP.
HOST="${DOCS_HOST:-127.0.0.1}"
PORT="${DOCS_PORT:-8000}"
PID_FILE="$PROJECT_ROOT/.mkdocs-serve.pid"
LOG_FILE="$PROJECT_ROOT/.mkdocs-serve.log"
READY_TIMEOUT_S=40
# Root disk can be full; keep pip build temp + cache on this (larger) volume.
export TMPDIR="$VENV/.tmp"
export PIP_CACHE_DIR="$VENV/.pipcache"

FOREGROUND=0; BUILD_ONLY=0; NO_BUILD=0; SKIP_INSTALL=0; DO_STOP=0

# ── Args ──
while [ $# -gt 0 ]; do
  case "$1" in
    --foreground)   FOREGROUND=1 ;;
    --build-only)   BUILD_ONLY=1 ;;
    --no-build)     NO_BUILD=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --stop)         DO_STOP=1 ;;
    --port)         shift; PORT="${1:?--port needs a value}" ;;
    --host)         shift; HOST="${1:?--host needs a value}" ;;
    -h|--help)      sed -n '2,34p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# ── Color helpers ──
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'
  C_DIM=$'\033[2m';  C_BLD=$'\033[1m';  C_RST=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YLW=""; C_BLU=""; C_DIM=""; C_BLD=""; C_RST=""
fi
ok()    { printf "  %s✓%s %s\n" "$C_GRN" "$C_RST" "$*"; }
warn()  { printf "  %s!%s %s\n" "$C_YLW" "$C_RST" "$*"; }
err()   { printf "  %s✗%s %s\n" "$C_RED" "$C_RST" "$*" >&2; }
step()  { printf "%s▸%s %s\n"   "$C_BLU" "$C_RST" "$*"; }
header(){ printf "\n%s%s%s\n"   "$C_BLD" "$*" "$C_RST"; }
trap 'err "start-docs.sh failed at line $LINENO (exit $?)."' ERR

# ── Free the docs port (from PID file, else whatever listens) ──
free_port() {
  local pids=""
  if [ -f "$PID_FILE" ]; then
    local pid; pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && pids="$pid"
  fi
  if command -v lsof >/dev/null; then
    pids="$pids $(lsof -ti :"$PORT" 2>/dev/null || true)"
  elif command -v fuser >/dev/null; then
    pids="$pids $(fuser "$PORT"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -v '^$' || true)"
  fi
  pids="$(printf "%s\n" $pids | sort -u | grep -v '^$' || true)"
  if [ -n "$pids" ]; then
    for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done
    sleep 2
    for p in $pids; do kill -0 "$p" 2>/dev/null && kill -KILL "$p" 2>/dev/null || true; done
  fi
  rm -f "$PID_FILE"
}

# ── --stop ──
if [ "$DO_STOP" = "1" ]; then
  header "DetectOps · docs — stop"
  free_port
  ok "Docs server on :$PORT stopped."
  exit 0
fi

# ── Locate a Python for a fresh venv (≥3.8 for mkdocs-material) ──
pick_python() {
  for p in python3.12 python3.11 python3.10 python3.9 python3.8 python3; do
    if command -v "$p" >/dev/null && "$p" -c "import sys,venv; raise SystemExit(0 if sys.version_info[:2]>=(3,8) else 1)" 2>/dev/null; then
      echo "$p"; return 0
    fi
  done
  return 1
}

# ── venv + deps ──
ensure_env() {
  step "Checking docs virtualenv + dependencies"
  if [ "$SKIP_INSTALL" = "1" ]; then
    [ -x "$VENV/bin/mkdocs" ] || { err "--skip-install but $VENV has no mkdocs. Run once without it."; exit 1; }
    ok "Skipping dependency install (--skip-install)"
    return 0
  fi
  mkdir -p "$TMPDIR" "$PIP_CACHE_DIR"
  if [ ! -x "$VENV/bin/python" ]; then
    local py; py="$(pick_python || true)"
    [ -n "$py" ] || { err "No Python ≥3.8 found (need it to build the docs venv)."; exit 1; }
    warn "$VENV missing — creating with $py"
    "$py" -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 || true
  fi
  [ -f "$REQ" ] || { err "Missing $REQ"; exit 1; }
  # "Check for updates": (re)install to satisfy the >= constraints, upgrading if newer.
  step "Checking for documentation-toolchain updates"
  local before after
  before="$("$VENV/bin/pip" freeze 2>/dev/null | grep -iE '^(mkdocs|mkdocs-material|pymdown-extensions)==' || true)"
  if "$VENV/bin/pip" install --quiet --upgrade -r "$REQ" > "$TMPDIR/pip.log" 2>&1; then
    after="$("$VENV/bin/pip" freeze 2>/dev/null | grep -iE '^(mkdocs|mkdocs-material|pymdown-extensions)==' || true)"
    if [ "$before" = "$after" ]; then ok "Docs toolchain already up to date"; else
      ok "Docs toolchain updated:"; (diff <(printf "%s\n" "$before") <(printf "%s\n" "$after") || true) | grep '^>' | sed 's/^> /    now /' || true
    fi
  else
    warn "pip install had issues — tail of $TMPDIR/pip.log:"; tail -8 "$TMPDIR/pip.log" | sed 's/^/    /' >&2
    [ -x "$VENV/bin/mkdocs" ] || { err "mkdocs not available and install failed."; exit 1; }
    warn "Continuing with the currently-installed toolchain."
  fi
  ok "mkdocs $("$VENV/bin/mkdocs" --version 2>/dev/null | sed -E 's/.*version ([0-9.]+).*/\1/')"
}

# ── Strict build (catches broken links / anchors) ──
build_docs() {
  [ "$NO_BUILD" = "1" ] && { warn "Skipping build (--no-build)"; return 0; }
  step "Building docs (mkdocs build --strict)"
  local out
  if out="$("$VENV/bin/mkdocs" build --strict 2>&1)"; then
    ok "Build OK → site/"
  else
    err "mkdocs build --strict failed:"; printf "%s\n" "$out" | grep -iE "warn|error|abort" | tail -15 | sed 's/^/    /' >&2
    exit 1
  fi
}

# ── Serve ──
serve_docs() {
  free_port
  if [ "$FOREGROUND" = "1" ]; then
    step "Serving docs in the foreground on http://$HOST:$PORT  (Ctrl-C to stop)"
    exec "$VENV/bin/mkdocs" serve --dev-addr "$HOST:$PORT"
  fi
  step "Starting docs server on http://$HOST:$PORT"
  : > "$LOG_FILE"
  nohup "$VENV/bin/mkdocs" serve --dev-addr "$HOST:$PORT" > "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  disown "$pid" 2>/dev/null || true
  local url_host="$HOST"; [ "$HOST" = "0.0.0.0" ] && url_host="localhost"
  local waited=0
  while [ "$waited" -lt "$READY_TIMEOUT_S" ]; do
    if curl -s -o /dev/null -m 3 "http://$url_host:$PORT/" 2>/dev/null; then
      ok "Docs are live → http://$url_host:$PORT  (PID $pid, live-reloads on edits)"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      err "Docs server died before it was ready. Last log lines:"; tail -15 "$LOG_FILE" >&2 || true; return 1
    fi
    sleep 1; waited=$((waited + 1))
  done
  warn "Docs server didn't answer within ${READY_TIMEOUT_S}s — tail of $LOG_FILE:"; tail -15 "$LOG_FILE" >&2 || true
}

# ── Main ──
header "DetectOps · docs — start"
printf "%sproject:%s %s\n" "$C_DIM" "$C_RST" "$PROJECT_ROOT"
printf "%sserve:%s   http://%s:%s\n" "$C_DIM" "$C_RST" "$HOST" "$PORT"

ensure_env
build_docs
if [ "$BUILD_ONLY" = "1" ]; then
  header "Done (build only)."
  ok "Static site in ./site — or run without --build-only to serve it."
  exit 0
fi
serve_docs

cat <<EOF

${C_GRN}${C_BLD}✓ DetectOps docs are up.${C_RST}
   ${C_BLD}Docs URL${C_RST}   http://$([ "$HOST" = "0.0.0.0" ] && echo localhost || echo "$HOST"):${PORT}
   ${C_BLD}Log${C_RST}        tail -f ${LOG_FILE}
   ${C_BLD}Stop${C_RST}       ./start-docs.sh --stop
EOF
