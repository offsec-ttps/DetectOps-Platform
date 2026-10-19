#!/usr/bin/env bash
#
# Behavior Analysis Workstation — full appliance provisioner.
#
# Installs EVERYTHING the analyze -> simulate -> detect -> tune loop needs, so
# the deployed VM works end-to-end out of the box:
#
#   * CAPEv2              dynamic sandbox (KVM analysis guest; needs nested virt)
#   * mandiant capa       static capability -> ATT&CK mapping
#   * REA (reverse anything)  MCP-based AI reverse-engineering toolkit
#   * Ollama + code model local AI (so rule generation works with no external GPU)
#   * Falco + Tetragon    Linux eBPF behavioral telemetry
#   * hacktool-behavior-lab (hbl)  the pipeline + FastAPI server + CLI
#   * sigma-cli/pySigma    detect/tune bench (validate + convert rules offline)
#
# SAFETY / ISOLATION: DEFENSIVE detection lab. Runs on an isolated/host-only
# network; CAPE analysis guests get NO internet egress (route=none). Ships NO
# malware or hacktool binaries — the student supplies them inside the isolated
# VM for authorized analysis only.
#
# The pipeline source is synced into the guest at /vagrant/provision/hbl-src
# (copied from the local repo by the deploy engine); no external git remote is
# required. Idempotent: re-running skips completed stages via /var/lib/hbl-provision.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

LOG() { echo "[hbl-provision] $*"; }
S=/var/lib/hbl-provision; mkdir -p "$S"
done() { [ -f "$S/$1" ]; }; mark() { touch "$S/$1"; }

HBL_DIR=/opt/hacktool-behavior-lab
# Local deploy syncs source to /vagrant/provision/hbl-src; cloud/VPS deploy scp's
# it and sets HBL_SRC_DIR. Honour HBL_SRC_DIR first so one script serves both.
SYNC_SRC="${HBL_SRC_DIR:-/vagrant/provision/hbl-src}"
HBL_REPO="${HBL_REPO:-}"          # optional git fallback if no synced source
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5-coder:7b}"   # CPU-friendly; 32b for a GPU host
CAPE_USER=cape

# ── 1. Base + Python 3.11 ───────────────────────────────────────────────────
if ! done base; then
  LOG "base packages"
  apt-get update -y
  apt-get install -y --no-install-recommends git curl wget ca-certificates jq unzip \
    build-essential pkg-config software-properties-common uuid-runtime \
    python3 python3-venv python3-pip
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update -y
  apt-get install -y python3.11 python3.11-venv python3.11-dev
  mark base
fi

# ── 2. KVM / libvirt + detonation mode ──────────────────────────────────────
if ! done kvm; then
  if grep -Eq 'vmx|svm' /proc/cpuinfo; then
    LOG "nested virt present -> CAPE full mode"
    apt-get install -y qemu-kvm libvirt-daemon-system libvirt-clients bridge-utils virtinst tcpdump
    adduser vagrant kvm || true; adduser vagrant libvirt || true
    echo full > "$S/detonation-mode"
  else
    LOG "no nested virt -> Sysmon in-guest fallback mode"
    echo sysmon-fallback > "$S/detonation-mode"
  fi
  mark kvm
fi
MODE="$(cat "$S/detonation-mode" 2>/dev/null || echo unknown)"

# ── 3. Node.js + REA (Reverse Engineer Anything) ────────────────────────────
if ! done rea; then
  LOG "installing Node.js + REA (reverse anything)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || true
  apt-get install -y nodejs || LOG "node install skipped"
  # REA is the MCP-based AI reverse-engineering toolkit (native/.NET/JS/Electron).
  npm install -g rea-agents || LOG "rea-agents npm install skipped (install manually: npm i -g rea-agents)"
  # Source clone too, so the full toolkit + examples are present offline.
  [ -d /opt/rea/.git ] || git clone --depth 1 https://github.com/morluto/rea.git /opt/rea || true
  mark rea
fi

# ── 4. Ollama + local code model (AI integration that works offline) ────────
if ! done ollama; then
  LOG "installing Ollama (local AI) + model $OLLAMA_MODEL"
  curl -fsSL https://ollama.com/install.sh | sh || LOG "ollama install skipped"
  systemctl enable --now ollama 2>/dev/null || (nohup ollama serve >/var/log/ollama.log 2>&1 &) || true
  sleep 5
  ollama pull "$OLLAMA_MODEL" || LOG "model pull deferred (pull manually once online: ollama pull $OLLAMA_MODEL)"
  mark ollama
fi

# ── 5. hbl pipeline (from synced local source; git fallback) ────────────────
if ! done hbl; then
  LOG "installing hacktool-behavior-lab"
  if [ -d "$SYNC_SRC" ] && [ -f "$SYNC_SRC/pyproject.toml" ]; then
    LOG "using synced source $SYNC_SRC"
    rm -rf "$HBL_DIR"; cp -r "$SYNC_SRC" "$HBL_DIR"
  elif [ -n "$HBL_REPO" ]; then
    git clone --depth 1 "$HBL_REPO" "$HBL_DIR" || mkdir -p "$HBL_DIR"
  else
    LOG "no synced source and no HBL_REPO — skipping hbl install (place source and re-run)"
  fi
  if [ -f "$HBL_DIR/pyproject.toml" ]; then
    python3.11 -m venv "$HBL_DIR/.venv"
    "$HBL_DIR/.venv/bin/pip" install --upgrade pip wheel
    # Full extras: capa (static), intel (URL/PDF/YouTube channel), dev (tests).
    "$HBL_DIR/.venv/bin/pip" install -e "$HBL_DIR[capa,intel,dev]" \
      || "$HBL_DIR/.venv/bin/pip" install -e "$HBL_DIR[capa,dev]" \
      || "$HBL_DIR/.venv/bin/pip" install -e "$HBL_DIR"
    ln -sf "$HBL_DIR/.venv/bin/hbl" /usr/local/bin/hbl
  fi
  mark hbl
fi

# ── 6. capa standalone (static capability mapping) ──────────────────────────
if ! done capa; then
  LOG "installing capa"
  CAPA_VER="$(curl -fsSL https://api.github.com/repos/mandiant/capa/releases/latest | jq -r .tag_name 2>/dev/null || echo '')"
  if [ -n "$CAPA_VER" ]; then
    curl -fsSL -o /tmp/capa.zip "https://github.com/mandiant/capa/releases/download/${CAPA_VER}/capa-${CAPA_VER}-linux.zip" \
      && unzip -o /tmp/capa.zip -d /usr/local/bin/ && chmod +x /usr/local/bin/capa || LOG "capa binary deferred"
  fi
  mark capa
fi

# ── 7. CAPEv2 (full mode only) ──────────────────────────────────────────────
if ! done cape && [ "$MODE" = "full" ]; then
  LOG "preparing CAPEv2"
  id "$CAPE_USER" &>/dev/null || adduser --disabled-password --gecos "" "$CAPE_USER"
  [ -d /opt/CAPEv2/.git ] || { git clone https://github.com/kevoreilly/CAPEv2.git /opt/CAPEv2 && chown -R "$CAPE_USER":"$CAPE_USER" /opt/CAPEv2; } || true
  install -m 0755 /vagrant/provision/cape-setup.sh /usr/local/bin/cape-setup.sh 2>/dev/null || true
  mark cape
fi

# ── 8. eBPF telemetry (Falco + Tetragon) for Linux tool behaviors ───────────
if ! done ebpf; then
  LOG "installing Falco + Tetragon (eBPF)"
  curl -fsSL https://falco.org/repo/falcosecurity-packages.asc | gpg --dearmor -o /usr/share/keyrings/falco-archive-keyring.gpg || true
  echo "deb [signed-by=/usr/share/keyrings/falco-archive-keyring.gpg] https://download.falco.org/packages/deb stable main" > /etc/apt/sources.list.d/falcosecurity.list
  apt-get update -y || true
  apt-get install -y falco || LOG "falco deferred (needs kernel headers/eBPF)"
  # Tetragon static install (cilium/tetragon) — best-effort.
  TG_VER="$(curl -fsSL https://api.github.com/repos/cilium/tetragon/releases/latest | jq -r .tag_name 2>/dev/null || echo '')"
  [ -n "$TG_VER" ] && curl -fsSL "https://github.com/cilium/tetragon/releases/download/${TG_VER}/tetra-linux-amd64.tar.gz" -o /tmp/tetra.tgz \
    && tar -C /usr/local/bin -xzf /tmp/tetra.tgz 2>/dev/null || LOG "tetragon deferred"
  mark ebpf
fi

# ── 9. Lab config + hbl server service ──────────────────────────────────────
install -d -m 0755 /etc/hbl
if [ ! -f /etc/hbl/llm.yaml ]; then
  cat > /etc/hbl/llm.yaml <<YAML
# AI integration: defaults to the LOCAL Ollama on this appliance so generation
# works with no external dependency. Point base_url at your GPU server
# (e.g. http://192.168.1.9:11434/v1) to use a bigger open-weight model.
provider: openai-compatible
base_url: http://127.0.0.1:11434/v1
model: $OLLAMA_MODEL
api_key_env: HBL_LLM_KEY
allow_template_fallback: true
YAML
fi

# Run the hbl FastAPI server (the appliance UI/API) on boot.
if [ -x "$HBL_DIR/.venv/bin/hbl" ] && [ ! -f /etc/systemd/system/hbl.service ]; then
  cat > /etc/systemd/system/hbl.service <<UNIT
[Unit]
Description=Hacktool Behavior Lab server
After=network.target ollama.service
[Service]
ExecStart=$HBL_DIR/.venv/bin/hbl serve --host 127.0.0.1 --port 8888
WorkingDirectory=$HBL_DIR
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload && systemctl enable --now hbl.service 2>/dev/null || LOG "hbl.service deferred (check \`hbl serve\`)"
fi

cat > /etc/motd <<MOTD
=============== Behavior Analysis Workstation (hbl) ===============
 Detonation mode : $MODE
 CAPE web UI      : http://localhost:8000   (full mode, after: sudo cape-setup.sh)
 hbl server       : http://localhost:8888
 Local AI (Ollama): http://localhost:11434  model: $OLLAMA_MODEL
 Reverse anything : rea  (MCP toolkit; /opt/rea)  — drive with local Ollama
 Pipeline / CLI   : hbl --help      source: $HBL_DIR
 AI config        : /etc/hbl/llm.yaml
 SAFETY           : isolated/host-only net; analysis guests have NO egress.
===================================================================
MOTD

LOG "provisioning complete (mode: $MODE, ai-model: $OLLAMA_MODEL)"
