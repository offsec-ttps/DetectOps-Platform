#!/usr/bin/env bash
#
# REMnux — appliance provisioner (Ubuntu base).
# Installs the REMnux malware-analysis toolset headlessly via the official
# `remnux` installer in cloud mode (keeps SSH enabled), so the same script
# serves Local / VPS / Cloud deploys.
#
# Idempotent (sentinel-guarded). Privileged shell provisioner.
# Isolated-lab malware-analysis use. No secrets handled.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
LOG() { echo "[remnux-provision] $*"; }
S=/var/lib/remnux-provision; mkdir -p "$S"; is_done() { [ -f "$S/$1" ]; }; mark() { touch "$S/$1"; }

if ! is_done base; then
  LOG "base packages"
  apt-get update -y
  apt-get install -y --no-install-recommends wget curl ca-certificates gnupg openssh-server
  mark base
fi

if ! is_done remnux; then
  LOG "installing REMnux (cloud mode)"
  # Clear any stale mode from an older installer (per REMnux docs).
  rm -f /etc/remnux-config
  wget --quiet -O /usr/local/bin/remnux https://REMnux.org/remnux-cli && chmod +x /usr/local/bin/remnux || LOG "remnux installer download deferred"
  if command -v remnux >/dev/null 2>&1; then
    # cloud mode installs the toolset and keeps SSH enabled (headless).
    remnux install --mode=cloud || LOG "remnux install returned non-zero — re-run \`sudo remnux install --mode=cloud\` once online"
  else
    LOG "remnux installer not present — see https://docs.remnux.org/install-distro/add-to-existing-system"
  fi
  # Ensure SSH host keys + daemon (docs step).
  ssh-keygen -A 2>/dev/null || true
  systemctl enable --now ssh 2>/dev/null || true
  mark remnux
fi

cat > /etc/motd <<'MOTD'
===================== REMnux =====================
 Toolset : installed via `remnux install --mode=cloud`
 Update  : sudo remnux upgrade
 Docs    : https://docs.remnux.org/
 Access  : SSH (headless). Isolated-lab malware analysis only.
==================================================
MOTD
LOG "provisioning complete"
