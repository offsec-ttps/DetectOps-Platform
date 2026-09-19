#!/usr/bin/env bash
#
# cloud-lab-connect.sh — bring up the WireGuard tunnel to a cloud range and
# resume/continue its lab build.
#
# WHY THIS EXISTS
#   A SAR cloud build runs in two phases:
#       build_vpn  -> terraform creates the VPC + WireGuard router (public IP)
#       build_lab  -> ansible configures Splunk/Windows over the range's
#                     PRIVATE IPs (10.0.2.x)
#   Between them the build parks at `wait_for_vpn`, because those private IPs
#   are only routable once the operator activates the WireGuard tunnel on THIS
#   host. Neither the controller nor its Docker image ever did that: the image
#   has no NET_ADMIN and no wireguard package. It has always been a manual step.
#
#   Continuing past that gate without the tunnel makes ansible fail with
#   "unreachable=1" after a long timeout, killing the build thread while the
#   EC2 instances keep running and billing.
#
#   This script makes the step explicit and verified: activate, PROVE the lab
#   is reachable, and only then resume the build.
#
# USAGE
#   scripts/cloud-lab-connect.sh [RANGE_ID]     # connect + resume the build
#   scripts/cloud-lab-connect.sh --status       # show tunnel + range status
#   scripts/cloud-lab-connect.sh --down [ID]    # tear the tunnel down
#
#   Run as your normal user. Only `wg-quick` is invoked through sudo, so you
#   will be prompted once for your password.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLOUD_DIR="$REPO/cloud-lab-app"
API="http://127.0.0.1:4000"
WG_DIR="$CLOUD_DIR/wireguard_config"

C_RST=$'\033[0m'; C_BLD=$'\033[1m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'
info() { printf '%s==>%s %s\n' "$C_BLD" "$C_RST" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%swarn%s %s\n' "$C_YLW" "$C_RST" "$*"; }
die()  { printf '%s fail%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }
need curl; need python3; need wg-quick; need ip

api_up() { curl -sf --max-time 5 "$API/health" >/dev/null 2>&1; }

# Find a range to act on: the argument, else the single range awaiting VPN.
resolve_range() {
  local want="${1:-}"
  curl -sf --max-time 10 "$API/attack-range/list" 2>/dev/null | python3 -c "
import sys, json
want = sys.argv[1] if len(sys.argv) > 1 else ''
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
rs = d.get('attack_ranges') or d.get('ranges') or (d if isinstance(d, list) else [])
if want:
    for r in rs:
        if r.get('attack_range_id','').startswith(want):
            print(r['attack_range_id'], r.get('status',''), r.get('router_public_ip',''))
            sys.exit(0)
    sys.exit(1)
c = [r for r in rs if r.get('status') in ('wait_for_vpn','build_lab','running')]
if len(c) == 1:
    print(c[0]['attack_range_id'], c[0].get('status',''), c[0].get('router_public_ip',''))
    sys.exit(0)
sys.exit(1)
" "$want"
}

range_status() {
  curl -sf --max-time 10 "$API/attack-range/status/$1" 2>/dev/null \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('status','?'))" 2>/dev/null
}

# Private lab IPs for the range, from the controller's architecture info.
lab_ips() {
  curl -sf --max-time 10 "$API/attack-range/status/$1" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
ips = set()
for h in (d.get('architecture') or {}).get('hosts') or []:
    ip = h.get('private_ip') or ''
    if ip.startswith('10.0.2.'):
        ips.add(ip)
print('\n'.join(sorted(ips)) if ips else '10.0.2.10')
" 2>/dev/null || echo "10.0.2.10"
}

tcp_ok() { timeout 5 bash -c "cat < /dev/null > /dev/tcp/$1/22" 2>/dev/null; }
wg_iface() { ip -brief link show type wireguard 2>/dev/null | awk '{print $1}' | head -1; }

# wg-quick derives the network interface name from the config's BASENAME, and
# the kernel caps that at 15 chars (wg-quick enforces ^[a-zA-Z0-9_=+.-]{1,15}$).
# The controller names its configs "<uuid>.conf" — 36 chars — which wg-quick
# refuses outright. So we always operate on a short-named copy.
iface_name() { printf 'wg-%s' "${1:0:8}"; }          # e.g. wg-2caa6fcb (11 chars)
conf_path()  { printf '%s/%s.conf' "$WG_DIR" "$(iface_name "$1")"; }

# Make sure a short-named config exists: prefer the controller's copy on disk
# (written as <uuid>.conf), else fetch it from the API.
ensure_conf() {
  local id="$1" conf uuid_conf
  conf="$(conf_path "$id")"
  uuid_conf="$WG_DIR/$id.conf"
  mkdir -p "$WG_DIR"
  if [ ! -s "$conf" ]; then
    if [ -s "$uuid_conf" ]; then
      cp "$uuid_conf" "$conf"
    else
      info "fetching WireGuard config from controller"
      curl -sf --max-time 10 "$API/attack-range/status/$id" \
        | python3 -c "import sys,json;c=json.load(sys.stdin).get('wireguard_config');print(c) if c else sys.exit(1)" \
        > "$conf" 2>/dev/null || { rm -f "$conf"; die "controller has no WireGuard config for $id"; }
    fi
  fi
  # wg-quick installs a route for EVERY AllowedIPs entry and treats a single
  # failure as fatal — it rolls the whole tunnel back. That happens on this host
  # because the local VirtualBox lab network (vboxnet4) already owns
  # 10.0.1.0/24, the same range the cloud VPC uses for its VPN subnet:
  #     ip -4 route add 10.0.1.0/24 dev wg-... -> RTNETLINK answers: File exists
  # "Table = off" stops wg-quick managing routes; install_routes() then adds the
  # ones we need and skips the collisions. AllowedIPs is left untouched, so
  # cryptokey routing still accepts the peer's whole range.
  grep -qiE '^[[:space:]]*Table[[:space:]]*=' "$conf" || \
    sed -i '/^\[Interface\]/a Table = off' "$conf"
  chmod 600 "$conf"
  printf '%s' "$conf"
}

# Add the tunnel's routes by hand, skipping any subnet a local interface already
# owns. Returns non-zero only if the LAB subnet (10.0.2.x) could not be routed,
# since that is the one the build actually needs.
install_routes() {
  local iface="$1" conf="$2" cidr owner lab_ok=1
  for cidr in $(sed -nE 's/^[[:space:]]*AllowedIPs[[:space:]]*=[[:space:]]*//p' "$conf" | tr ',' ' '); do
    cidr="$(printf '%s' "$cidr" | tr -d '[:space:]')"
    [ -n "$cidr" ] || continue
    owner="$(ip route show "$cidr" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -1)"
    if [ -n "$owner" ] && [ "$owner" != "$iface" ]; then
      warn "$cidr is already owned locally by $owner — leaving it alone"
      case "$cidr" in 10.0.2.*) lab_ok=0 ;; esac
    elif [ "$owner" = "$iface" ]; then
      ok "route $cidr already via $iface"
    elif sudo ip route add "$cidr" dev "$iface" 2>/dev/null; then
      ok "route $cidr -> $iface"
    else
      warn "could not add route $cidr"
      case "$cidr" in 10.0.2.*) lab_ok=0 ;; esac
    fi
  done
  [ "$lab_ok" = "1" ]
}

# Restart the controller API. Needed when a build thread died: the process keeps
# the dead build's status in memory ("build_lab") and refuses to resume, even
# though the config file on disk says "wait_for_vpn". A restart reloads state
# from disk. Safe whenever no build is actually in flight.
restart_api() {
  info "restarting controller API (clears stale in-memory build state)"
  local pids; pids="$(lsof -ti :4000 2>/dev/null)"
  [ -n "$pids" ] && { kill $pids 2>/dev/null; sleep 3; }
  mkdir -p "$CLOUD_DIR/.tmp"
  (
    cd "$CLOUD_DIR" || exit 1
    TMPDIR="$CLOUD_DIR/.tmp" \
    PATH="$CLOUD_DIR/.venv/bin:$PATH" \
    ANSIBLE_GALAXY_SERVER="https://galaxy.ansible.com" \
    nohup .venv/bin/python api/app.py > .cloud-api.log 2>&1 &
    echo $! > .cloud-api.pid
  )
  local i
  for i in $(seq 1 15); do
    api_up && { ok "controller API back up"; return 0; }
    sleep 1
  done
  die "controller API did not come back — see $CLOUD_DIR/.cloud-api.log"
}

cmd_status() {
  local iface; iface="$(wg_iface)"
  if [ -n "$iface" ]; then ok "tunnel up: $iface"; else warn "no WireGuard interface is up"; fi
  api_up && ok "controller API reachable" || warn "controller API not reachable at $API"
  local r; r="$(resolve_range "${1:-}")" || { warn "no range found"; return 0; }
  set -- $r
  info "range $1  status=$2  router=$3"
  for ip in $(lab_ips "$1"); do
    tcp_ok "$ip" && ok "lab $ip:22 reachable" || warn "lab $ip:22 UNREACHABLE"
  done
}

cmd_down() {
  local r id conf; r="$(resolve_range "${1:-}")" || die "no range found"
  set -- $r; id="$1"
  conf="$(conf_path "$id")"
  [ -s "$conf" ] || die "no config at $conf"
  info "bringing tunnel down"
  sudo wg-quick down "$conf" && ok "tunnel down" || die "wg-quick down failed"
}

cmd_connect() {
  local r id status conf
  api_up || die "controller API is not running at $API — start it with ./start-server.sh"
  r="$(resolve_range "${1:-}")" || die "no range awaiting VPN. Run --status to see what exists."
  set -- $r; id="$1"; status="$2"
  info "range $id (status: $status)"

  conf="$(ensure_conf "$id")"

  # 1) Activate the tunnel (idempotent).
  if [ -n "$(wg_iface)" ]; then
    ok "a WireGuard interface is already up"
    # Table=off means routes are ours to maintain, so re-assert them.
    install_routes "$(wg_iface)" "$conf" || \
      die "the lab subnet (10.0.2.0/24) is not routed over the existing tunnel."
  else
    info "activating tunnel as $(iface_name "$id") (sudo required — creates a network interface)"
    local wg_err
    wg_err="$(sudo wg-quick up "$conf" 2>&1)" || die "wg-quick up failed:
$wg_err"
    ok "tunnel activated"
    install_routes "$(iface_name "$id")" "$conf" || \
      die "the lab subnet (10.0.2.0/24) could not be routed over the tunnel.
  A local interface is already using it — shut that network down, or rebuild the
  range on a non-overlapping CIDR."
  fi

  # 2) PROVE the lab is reachable before spending a build on it.
  info "verifying the lab's private IPs are routable"
  local reachable=0 ip
  for ip in $(lab_ips "$id"); do
    for _ in 1 2 3 4 5 6; do
      if tcp_ok "$ip"; then ok "lab $ip:22 reachable"; reachable=1; break; fi
      sleep 5
    done
  done
  [ "$reachable" = "1" ] || die "tunnel is up but no lab host answered on :22.
  Check that the router security group allows your current public IP
  (curl -s https://api.ipify.org) and that AllowedIPs covers 10.0.2.0/24.
  NOT resuming the build — that is what wasted the previous run."

  # 3) Resume only now.
  status="$(range_status "$id")"
  if [ "$status" = "running" ]; then ok "range is already running — nothing to resume"; return 0; fi
  info "resuming lab build"
  local out code
  resume_call() {
    out="$(curl -s --max-time 30 -w '\n%{http_code}' -X POST "$API/attack-range/build" \
          -H 'Content-Type: application/json' -d "{\"attack_range_id\":\"$id\"}")"
    code="$(printf '%s' "$out" | tail -1)"
  }
  resume_call
  # A dead build thread leaves stale in-memory status behind, so the controller
  # rejects the resume while the config on disk says wait_for_vpn. One restart
  # reloads from disk; the tunnel is already verified above, so retrying is safe.
  if [ "$code" != "200" ] && [ "$code" != "202" ] && printf '%s' "$out" | grep -q "not waiting for VPN"; then
    warn "controller is holding stale build state — restarting it and retrying"
    restart_api
    resume_call
  fi
  if [ "$code" != "200" ] && [ "$code" != "202" ]; then
    printf '%s\n' "$out" | head -5
    die "controller refused the resume (HTTP $code)"
  fi
  ok "build resumed"

  # 4) Follow it, so a silent death is visible immediately.
  info "watching status (Ctrl-C to stop watching; the build keeps running)"
  local last=""
  while true; do
    status="$(range_status "$id")"
    [ "$status" != "$last" ] && { printf '    %s  %s\n' "$(date +%H:%M:%S)" "$status"; last="$status"; }
    case "$status" in
      running)       ok "range is up"; break ;;
      failed|error|aborted) die "build ended: $status — see $CLOUD_DIR/attack_range.log" ;;
    esac
    sleep 20
  done
}

case "${1:-}" in
  --status|-s) shift; cmd_status "${1:-}" ;;
  --down|-d)   shift; cmd_down "${1:-}" ;;
  -h|--help)   sed -n '2,32p' "$0" ;;
  *)           cmd_connect "${1:-}" ;;
esac
