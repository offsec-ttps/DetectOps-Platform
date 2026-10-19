#!/usr/bin/env bash
#
# SANS SIFT Workstation — appliance provisioner (Ubuntu base).
# Installs the SIFT DFIR toolset headlessly via the official sift-cli, so the
# same script serves Local (Vagrant), VPS, and Cloud (Terraform) deploys.
#
# Idempotent (sentinel-guarded). Runs as a privileged shell provisioner.
# Authorized lab / investigation use. No secrets handled.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
LOG() { echo "[sift-provision] $*"; }
S=/var/lib/sift-provision; mkdir -p "$S"; is_done() { [ -f "$S/$1" ]; }; mark() { touch "$S/$1"; }

if ! is_done base; then
  LOG "base packages"
  apt-get update -y
  apt-get install -y --no-install-recommends curl ca-certificates openssh-server
  systemctl enable --now ssh 2>/dev/null || true
  mark base
fi

if ! is_done sift; then
  LOG "installing sift-cli + SIFT toolset (server mode)"
  # Official sift-cli release binary (see https://github.com/teamdfir/sift-cli).
  VER="$(curl -fsSL https://api.github.com/repos/teamdfir/sift-cli/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+' || echo '')"
  if [ -n "$VER" ]; then
    curl -fsSL -o /usr/local/bin/sift "https://github.com/teamdfir/sift-cli/releases/download/${VER}/sift-cli-linux" \
      && chmod +x /usr/local/bin/sift || LOG "sift-cli download deferred"
  fi
  if command -v sift >/dev/null 2>&1; then
    # server mode = tools/packages only, no desktop modifications (headless-friendly).
    sift install --mode=server || LOG "sift install returned non-zero — re-run \`sudo sift install --mode=server\` once online"
  else
    LOG "sift-cli not present — install manually: https://github.com/teamdfir/sift-cli"
  fi
  mark sift
fi

cat > /etc/motd <<'MOTD'
================= SANS SIFT Workstation =================
 Toolset   : installed via sift-cli (server mode)
 Re-run    : sudo sift install --mode=server
 Docs      : https://www.sans.org/tools/sift-workstation/
 Access    : SSH (headless). Authorized investigation use only.
========================================================
MOTD
LOG "provisioning complete"
