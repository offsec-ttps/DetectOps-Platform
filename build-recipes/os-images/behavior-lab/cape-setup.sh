#!/usr/bin/env bash
#
# CAPEv2 full-mode setup helper (run by the student as root INSIDE the appliance,
# only when nested virtualization is available).
#
# This wraps the upstream CAPE installer and enforces the lab's isolation posture:
# analysis guests get NO network route (route = none) so detonated samples can't
# reach the internet. It does NOT download any Windows image or any hacktool —
# the student imports their own licensed Windows analysis guest and supplies the
# binaries to analyze, inside the isolated VM, for authorized work only.
set -euo pipefail

echo "[cape-setup] running CAPEv2 installer (this is long)…"
cd /opt/CAPEv2

# Upstream installer handles PostgreSQL, the poetry venv, systemd services, and
# tcpdump capabilities. See https://capev2.readthedocs.io/ for the full guide.
if [ -f installer/cape2.sh ]; then
  sudo bash installer/cape2.sh base cape || true
else
  echo "[cape-setup] installer/cape2.sh not found — follow https://capev2.readthedocs.io/ manually"
fi

# Enforce no-egress for analysis guests: set routing to 'none' in CAPE's config.
CONF=/opt/CAPEv2/conf/routing.conf
if [ -f "$CONF" ]; then
  sed -i 's/^route = .*/route = none/' "$CONF" || true
  sed -i 's/^internet = .*/internet = none/' "$CONF" || true
  echo "[cape-setup] routing pinned to none (no guest internet egress)."
fi

cat <<'NEXT'
[cape-setup] Next steps (student, inside the isolated VM):
  1. Import your own licensed Windows 10 analysis guest into KVM (virt-manager).
  2. Install Sysmon (SwiftOnSecurity config) + the CAPE agent in the guest; snapshot it clean.
  3. Register the guest in /opt/CAPEv2/conf/<machinery>.conf.
  4. Start CAPE:  sudo systemctl start cape cape-processor cape-web
  5. Open http://localhost:8000 and submit a sample, or drive it via `hbl detonate`.
NEXT
