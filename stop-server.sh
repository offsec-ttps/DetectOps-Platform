#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DetectOps — stop-server.sh
#
# Cleanly shuts down the Next.js dev server that start-server.sh booted.
# Tries three strategies, in order:
#   1. PID from .next-dev.pid (written by start-server.sh)
#   2. Any process listening on the configured port (lsof / fuser)
#   3. Any `next dev` / `next-server` process belonging to this project tree
#
# Also stops the local Cloud Controller web app (cloud-lab-app: Flask API :4000
# + Astro UI :4321) that start-server.sh launches alongside it.
#
# Deliberately does NOT touch deployed lab VMs, Docker containers, or other
# external resources — those are managed inside the app.
#
# Usage:
#   ./stop-server.sh                # verbose
#   ./stop-server.sh --quiet        # suppress non-error output (used by start)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

PORT="${PORT:-3000}"
PID_FILE="$PROJECT_ROOT/.next-dev.pid"
CLOUD_DIR="$PROJECT_ROOT/cloud-lab-app"
CLOUD_API_PORT="${CLOUD_API_PORT:-4000}"
CLOUD_APP_PORT="${CLOUD_APP_PORT:-4321}"
QUIET=0
for a in "$@"; do
  case "$a" in
    --quiet) QUIET=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $a" >&2; exit 2 ;;
  esac
done

if [ -t 1 ] && [ "$QUIET" = "0" ]; then
  C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_DIM=$'\033[2m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_GRN=""; C_YLW=""; C_DIM=""; C_BLD=""; C_RST=""
fi
say()   { [ "$QUIET" = "1" ] || printf "  %s\n" "$*"; }
ok()    { [ "$QUIET" = "1" ] || printf "  %s✓%s %s\n" "$C_GRN" "$C_RST" "$*"; }
warn()  { printf "  %s!%s %s\n" "$C_YLW" "$C_RST" "$*" >&2; }
hdr()   { [ "$QUIET" = "1" ] || printf "\n%s%s%s\n" "$C_BLD" "$*" "$C_RST"; }

# Stop the local Cloud Controller (cloud-lab-app: Flask API :4000 + Astro UI :4321)
# that start-server.sh launched. Kills the recorded PIDs + their children, then
# frees the ports (covers detached workers re-parented to init). Labs/VMs/Docker
# are left untouched — same policy as the Next server teardown.
stop_cloud_controller() {
  local any=0
  for f in .cloud-api.pid .cloud-app.pid; do
    local pf="$CLOUD_DIR/$f" pid=""
    [ -f "$pf" ] || continue
    pid="$(cat "$pf" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      for c in $(pgrep -P "$pid" 2>/dev/null || true); do kill -TERM "$c" 2>/dev/null || true; done
      kill -TERM "$pid" 2>/dev/null || true
      any=1
    fi
    rm -f "$pf"
  done
  for port in "$CLOUD_API_PORT" "$CLOUD_APP_PORT"; do
    local pids=""
    if command -v lsof >/dev/null; then pids="$(lsof -ti :"$port" 2>/dev/null || true)"
    elif command -v fuser >/dev/null; then pids="$(fuser "$port"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -v '^$' || true)"; fi
    for p in $pids; do kill -TERM "$p" 2>/dev/null || true; any=1; done
  done
  if [ "$any" = "1" ]; then ok "Cloud controller stopped (API :$CLOUD_API_PORT + UI :$CLOUD_APP_PORT)."; else say "${C_DIM}Cloud controller not running.${C_RST}"; fi
}

PIDS=()

# 1. PID file
if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    PIDS+=("$pid")
    say "Found PID $pid (from $PID_FILE)"
  fi
fi

# 2. Process(es) on port
if command -v lsof >/dev/null; then
  while IFS= read -r p; do [ -n "$p" ] && PIDS+=("$p"); done < <(lsof -ti :"$PORT" 2>/dev/null || true)
elif command -v fuser >/dev/null; then
  for p in $(fuser "$PORT"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -v '^$' || true); do
    PIDS+=("$p")
  done
fi

# 3. Project-scoped `next dev …` process (parent that has $PROJECT_ROOT in cmdline)
PARENTS=()
while IFS= read -r p; do
  [ -n "$p" ] && { PIDS+=("$p"); PARENTS+=("$p"); }
done < <(pgrep -f "next.*$PROJECT_ROOT" 2>/dev/null || true)

# 3b. Walk children of every parent — `next-server` workers have no project
# path in their cmdline (they're just "next-server (vXX.YY.ZZ)") so we have to
# discover them via process lineage.
collect_descendants() {
  local pid="$1"
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for c in $children; do
    PIDS+=("$c")
    collect_descendants "$c"
  done
}
for p in "${PARENTS[@]:-}"; do
  [ -n "$p" ] && collect_descendants "$p"
done

# 3c. Also any orphaned `next-server` re-parented to PID 1 — match by version
# string of next installed in this project.
NEXT_VER="$(node -e "try{console.log(require('./node_modules/next/package.json').version)}catch(e){}" 2>/dev/null || true)"
if [ -n "$NEXT_VER" ]; then
  while IFS= read -r p; do
    [ -n "$p" ] && PIDS+=("$p")
  done < <(pgrep -f "next-server \(v${NEXT_VER}" 2>/dev/null || true)
fi

# Dedupe
if [ "${#PIDS[@]}" -gt 0 ]; then
  UNIQ=($(printf "%s\n" "${PIDS[@]}" | sort -u))
else
  UNIQ=()
fi

hdr "DetectOps · stop-server"

# Stop the Cloud Controller regardless of whether the Next server is running.
stop_cloud_controller

if [ "${#UNIQ[@]}" -eq 0 ]; then
  say "${C_DIM}No running dev-server processes found.${C_RST}"
  rm -f "$PID_FILE"
  exit 0
fi

say "Stopping PID(s): ${UNIQ[*]}"

# Graceful → forceful
for pid in "${UNIQ[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
sleep 2
for pid in "${UNIQ[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    warn "PID $pid didn't exit on TERM, sending KILL"
    kill -KILL "$pid" 2>/dev/null || true
  fi
done
sleep 1

# Confirm
LEFT=()
for pid in "${UNIQ[@]}"; do
  kill -0 "$pid" 2>/dev/null && LEFT+=("$pid")
done
if [ "${#LEFT[@]}" -gt 0 ]; then
  warn "Could not stop: ${LEFT[*]}"
  rm -f "$PID_FILE"
  exit 1
fi

rm -f "$PID_FILE"
ok "All dev-server processes stopped."
