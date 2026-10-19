#!/usr/bin/env bash
#
# Kali Linux — appliance provisioner.
# Local deploy uses the official kalilinux/rolling box (already complete), so
# this is a near no-op there. For VPS / Cloud (Ubuntu base) it adds the Kali
# rolling repo + installs the headless Kali toolset.
#
# Idempotent (sentinel-guarded). Privileged shell provisioner.
# Authorized security-testing use only.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
LOG() { echo "[kali-provision] $*"; }
S=/var/lib/kali-provision; mkdir -p "$S"; is_done() { [ -f "$S/$1" ]; }; mark() { touch "$S/$1"; }

. /etc/os-release 2>/dev/null || true

if ! is_done base; then
  apt-get update -y
  apt-get install -y --no-install-recommends curl ca-certificates gnupg openssh-server
  systemctl enable --now ssh 2>/dev/null || true
  mark base
fi

if ! is_done kali; then
  if [ "${ID:-}" = "kali" ]; then
    LOG "already Kali — ensuring headless toolset present"
    apt-get update -y && apt-get install -y kali-linux-headless || LOG "metapackage install deferred"
  else
    LOG "adding Kali rolling repo on ${ID:-unknown} (best-effort) + headless toolset"
    # Kali archive keyring + rolling repo. On a non-Kali base this can surface
    # package conflicts; it is best-effort and pinned to the Kali metapackage.
    curl -fsSL https://archive.kali.org/archive-key.asc | gpg --dearmor -o /usr/share/keyrings/kali-archive-keyring.gpg || LOG "key fetch deferred"
    echo "deb [signed-by=/usr/share/keyrings/kali-archive-keyring.gpg] http://http.kali.org/kali kali-rolling main contrib non-free non-free-firmware" > /etc/apt/sources.list.d/kali.list
    apt-get update -y || LOG "apt update after kali repo had warnings"
    apt-get install -y kali-linux-headless || LOG "kali-linux-headless install deferred — resolve apt conflicts, then \`apt install kali-linux-headless\`"
  fi
  mark kali
fi

cat > /etc/motd <<'MOTD'
================= Kali Linux =================
 Toolset : kali-linux-headless
 Docs    : https://www.kali.org/docs/
 Access  : SSH. Authorized penetration-testing use only.
=============================================
MOTD
LOG "provisioning complete"
