#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DetectOps — setup.sh
#
# Installs the tools/dependencies the platform needs, THEN bootstraps the app
# (.env, npm install, Prisma, Sigma CLI). Toggle what you want below by setting
# a flag to 1 (install) or 0 (skip) — comment a line out to skip it entirely.
# Re-runnable / idempotent: already-present tools are detected and skipped.
#
# Usage:
#   ./setup.sh            # install enabled tools + bootstrap the app
#   ./setup.sh --check    # only report what's present/missing (installs nothing)
#   ./setup.sh --yes      # don't prompt before using sudo for system packages
#   ./setup.sh --help
#
# System packages need a supported package manager (apt / dnf / pacman / brew)
# and sudo. Nothing is installed for a tool whose flag is 0 or already present.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$PROJECT_ROOT"

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  TOGGLE DEPENDENCIES — 1 = install, 0 = skip. Comment/uncomment as needed. ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
# ── Required to run the web platform ──
ENABLE_NODE=1            # Node.js 22 + npm         (REQUIRED — Next.js 16 runtime)
ENABLE_GIT=1             # git                      (REQUIRED — repo + Build Forge)
# ── Strongly recommended (features degrade without them) ──
ENABLE_GIT_LFS=1         # git-lfs                  (Replay Catalog datasets)
ENABLE_PYTHON=1          # python3 + venv + pip     (WinRM exec, Sigma CLI, reports)
ENABLE_PYWINRM=1         # pywinrm (pip, user)      (drive atomics on Windows labs over WinRM)
ENABLE_PANDOC=1          # pandoc                   (DOCX/PPTX report rendering)
ENABLE_LIBREOFFICE=1     # libreoffice              (PDF report rendering)
ENABLE_CHROME=1          # chromium / google-chrome (branded-report PDF rendering)
ENABLE_SQLITE=1          # sqlite3 CLI              (DB inspection helpers)
ENABLE_JQ=1              # jq                       (JSON in helper scripts)
# ── Optional (lab engines / cloud — off by default; flip to 1 to install) ──
ENABLE_DOCKER=0          # Docker                   (SAR Cloud Deployment Docker template)
ENABLE_VIRTUALBOX=0      # VirtualBox               (local VM labs)
ENABLE_VAGRANT=0         # Vagrant                  (local VM labs)
ENABLE_STRATUS=0         # Stratus CLI (needs Go)   (live cloud detonation)
# ── App bootstrap steps (run after tools) ──
ENABLE_ENV=1             # create .env from .env.example if missing
ENABLE_NPM_INSTALL=1     # npm install
ENABLE_PRISMA=1          # prisma generate + db push
ENABLE_SIGMA_VENV=1      # backend/.venv with sigma-cli (Rule Workspace conversion)
# ╚═══════════════════════════════════════════════════════════════════════════╝

CHECK_ONLY=0; ASSUME_YES=0
for a in "$@"; do case "$a" in
  --check) CHECK_ONLY=1 ;; --yes|-y) ASSUME_YES=1 ;;
  -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
  *) echo "Unknown arg: $a" >&2; exit 2 ;;
esac; done

if [ -t 1 ]; then C_R=$'\033[31m';C_G=$'\033[32m';C_Y=$'\033[33m';C_B=$'\033[34m';C_D=$'\033[2m';C_W=$'\033[1m';C_0=$'\033[0m'
else C_R=;C_G=;C_Y=;C_B=;C_D=;C_W=;C_0=; fi
ok(){ printf "  ${C_G}✓${C_0} %s\n" "$*"; }
warn(){ printf "  ${C_Y}!${C_0} %s\n" "$*"; }
err(){ printf "  ${C_R}✗${C_0} %s\n" "$*" >&2; }
step(){ printf "${C_B}▸${C_0} %s\n" "$*"; }
header(){ printf "\n${C_W}%s${C_0}\n" "$*"; }

# ── Package-manager abstraction ──
PM=""; SUDO=""
detect_pm(){
  if   command -v apt-get >/dev/null; then PM=apt
  elif command -v dnf     >/dev/null; then PM=dnf
  elif command -v pacman  >/dev/null; then PM=pacman
  elif command -v brew    >/dev/null; then PM=brew
  fi
  if [ "$PM" != "brew" ] && [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null && SUDO="sudo" || SUDO=""
  fi
}
APT_UPDATED=0
pm_install(){ # pm_install <display> <apt pkgs> [dnf pkgs] [pacman pkgs] [brew pkgs]
  local name="$1" apt="$2" dnf="${3:-$2}" pac="${4:-$2}" brew="${5:-$2}"
  [ "$CHECK_ONLY" = "1" ] && { warn "$name would be installed (--check: skipped)"; return 0; }
  [ -z "$PM" ] && { err "No supported package manager — install $name manually ($apt)"; return 1; }
  if [ "$SUDO" = "sudo" ] && [ "$ASSUME_YES" = "0" ]; then
    printf "    ${C_D}(sudo needed to install %s)${C_0}\n" "$name"
  fi
  case "$PM" in
    apt)    [ "$APT_UPDATED" = "0" ] && { $SUDO apt-get update -y >/dev/null 2>&1 || true; APT_UPDATED=1; }
            $SUDO apt-get install -y $apt ;;
    dnf)    $SUDO dnf install -y $dnf ;;
    pacman) $SUDO pacman -S --noconfirm $pac ;;
    brew)   brew install $brew ;;
  esac
}
have(){ command -v "$1" >/dev/null 2>&1; }

# ── Individual tool installers (each gated by its flag + a presence check) ──
ins_node(){ [ "${ENABLE_NODE:-0}" = 1 ] || return 0
  if have node && [ "$(node -v | sed -E 's/^v([0-9]+).*/\1/')" -ge 22 ]; then ok "Node.js $(node -v) present"; return 0; fi
  step "Installing Node.js 22"
  if [ "$PM" = "apt" ] && [ "$CHECK_ONLY" = "0" ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - >/dev/null 2>&1 || warn "NodeSource setup failed; falling back to distro node"
    pm_install "Node.js" "nodejs" && ok "Node.js $(node -v 2>/dev/null) installed" || err "Node install failed"
  else pm_install "Node.js 22" "nodejs npm" "nodejs npm" "nodejs npm" "node@22"; fi
}
ins_simple(){ # ins_simple FLAG bin "display" "apt" [dnf] [pac] [brew]
  local flag="$1" bin="$2" disp="$3" apt="$4"
  [ "${!flag:-0}" = 1 ] || return 0
  if have "$bin"; then ok "$disp present"; return 0; fi
  step "Installing $disp"; pm_install "$disp" "$apt" "${5:-$apt}" "${6:-$apt}" "${7:-$apt}" && ok "$disp installed" || warn "$disp install failed"
}

install_tools(){
  header "Installing enabled tools"
  detect_pm; [ -n "$PM" ] && ok "Package manager: $PM${SUDO:+ (via sudo)}" || warn "No package manager detected — system installs will be skipped"
  ins_node
  ins_simple ENABLE_GIT        git         "git"          "git"
  ins_simple ENABLE_GIT_LFS    git-lfs     "git-lfs"      "git-lfs"
  ins_simple ENABLE_PYTHON     python3     "python3"      "python3 python3-venv python3-pip" "python3 python3-pip" "python python-pip" "python@3.12"
  ins_simple ENABLE_PANDOC     pandoc      "pandoc"       "pandoc"
  ins_simple ENABLE_LIBREOFFICE libreoffice "libreoffice" "libreoffice" "libreoffice" "libreoffice" "--cask libreoffice"
  ins_simple ENABLE_SQLITE     sqlite3     "sqlite3"      "sqlite3"
  ins_simple ENABLE_JQ         jq          "jq"           "jq"
  # Chrome/Chromium: prefer an existing chrome/chromium; else install chromium.
  if [ "${ENABLE_CHROME:-0}" = 1 ]; then
    if have google-chrome || have google-chrome-stable || have chromium || have chromium-browser; then ok "Chrome/Chromium present"
    else step "Installing Chromium"; pm_install "Chromium" "chromium-browser" "chromium" "chromium" "--cask chromium" || pm_install "Chromium" "chromium" || warn "Chromium install failed"; fi
  fi
  # git-lfs needs a one-time init
  if [ "${ENABLE_GIT_LFS:-0}" = 1 ] && have git-lfs && [ "$CHECK_ONLY" = "0" ]; then git lfs install --skip-repo >/dev/null 2>&1 || true; fi
  # pywinrm into the user site (no venv needed for the WinRM helper)
  if [ "${ENABLE_PYWINRM:-0}" = 1 ]; then
    if python3 -c "import winrm" >/dev/null 2>&1; then ok "pywinrm present"
    elif [ "$CHECK_ONLY" = "1" ]; then warn "pywinrm would be installed (pip --user pywinrm)"
    else step "Installing pywinrm (pip --user)"; python3 -m pip install --user --quiet pywinrm >/dev/null 2>&1 && ok "pywinrm installed" || warn "pywinrm install failed (pip)"; fi
  fi
  # Optional lab/cloud engines
  ins_simple ENABLE_DOCKER     docker      "Docker"       "docker.io" "docker" "docker" "--cask docker"
  ins_simple ENABLE_VIRTUALBOX VBoxManage  "VirtualBox"   "virtualbox" "VirtualBox" "virtualbox" "--cask virtualbox"
  ins_simple ENABLE_VAGRANT    vagrant     "Vagrant"      "vagrant"
  if [ "${ENABLE_STRATUS:-0}" = 1 ]; then
    if have stratus; then ok "Stratus CLI present"
    elif have go && [ "$CHECK_ONLY" = "0" ]; then step "Installing Stratus (go install)"; go install github.com/datadog/stratus-red-team/v2/cmd/stratus@latest >/dev/null 2>&1 && ok "Stratus installed (~/go/bin)" || warn "stratus go install failed"
    else warn "Stratus skipped — needs Go toolchain (set ENABLE_STRATUS=0 to silence)"; fi
  fi
}

# ── App bootstrap (after tools) ──
bootstrap_app(){
  header "Bootstrapping the app"
  if [ "${ENABLE_ENV:-0}" = 1 ]; then
    if [ -f .env ]; then ok ".env present"
    elif [ "$CHECK_ONLY" = "1" ]; then warn ".env would be created from .env.example"
    elif [ -f .env.example ]; then cp .env.example .env; ok ".env created from .env.example — EDIT IT (set CREDENTIAL_VAULT_KEY, ADMIN_EMAILS)"
    else warn ".env.example missing — cannot seed .env"; fi
    # Seed a persistent vault key if still a placeholder (so creds survive restarts).
    if [ -f .env ] && [ "$CHECK_ONLY" = "0" ] && grep -q '^CREDENTIAL_VAULT_KEY="change-me' .env 2>/dev/null && have openssl; then
      local key; key="$(openssl rand -hex 32)"; sed -i "s|^CREDENTIAL_VAULT_KEY=.*|CREDENTIAL_VAULT_KEY=\"$key\"|" .env; ok "Generated a random CREDENTIAL_VAULT_KEY"
    fi
  fi
  if [ "${ENABLE_NPM_INSTALL:-0}" = 1 ]; then
    if [ "$CHECK_ONLY" = "1" ]; then [ -d node_modules ] && ok "node_modules present" || warn "npm install would run"
    elif [ ! -d node_modules ] || [ ! -d node_modules/next ]; then step "npm install"; npm install --no-audit --no-fund && ok "npm install complete"
    else ok "node_modules present"; fi
  fi
  if [ "${ENABLE_PRISMA:-0}" = 1 ] && [ "$CHECK_ONLY" = "0" ]; then
    step "Prisma generate + db push"; npx prisma generate >/dev/null 2>&1 || true; npx prisma db push >/dev/null 2>&1 && ok "Prisma client + DB in sync" || warn "prisma db push failed — run it manually"
  fi
  if [ "${ENABLE_SIGMA_VENV:-0}" = 1 ] && [ "$CHECK_ONLY" = "0" ]; then
    if [ -x backend/.venv/bin/sigma ]; then ok "Sigma CLI present"
    elif have python3 && [ -f backend/requirements.txt ]; then step "Installing Sigma CLI (backend/.venv)"; python3 -m venv backend/.venv >/dev/null 2>&1 && backend/.venv/bin/pip install --quiet -r backend/requirements.txt >/dev/null 2>&1 && ok "Sigma CLI installed" || warn "Sigma CLI venv install failed"
    fi
  fi
}

# ── Final requirements check (shared gate used by start-server.sh too) ──
REQUIREMENTS_OK=1
check_requirements(){
  header "Dependency check"
  local hard_missing=()
  have node && [ "$(node -v | sed -E 's/^v([0-9]+).*/\1/')" -ge 22 ] && ok "node $(node -v)" || { err "node 22+ missing"; hard_missing+=(node); }
  have npm && ok "npm $(npm -v)" || { err "npm missing"; hard_missing+=(npm); }
  have git && ok "git present" || { err "git missing"; hard_missing+=(git); }
  [ -d node_modules/next ] && ok "node_modules installed" || { warn "node_modules not installed (run setup or npm install)"; }
  [ -f .env ] && ok ".env present" || { warn ".env missing (copy .env.example)"; }
  # Soft/optional
  for t in git-lfs python3 pandoc libreoffice sqlite3 jq; do have "$t" && ok "$t present" || warn "$t not found (optional)"; done
  python3 -c "import winrm" >/dev/null 2>&1 && ok "pywinrm present" || warn "pywinrm not found (WinRM labs)"
  (have google-chrome || have google-chrome-stable || have chromium || have chromium-browser) && ok "chrome/chromium present" || warn "chrome/chromium not found (branded PDF)"
  if [ "${#hard_missing[@]}" -gt 0 ]; then REQUIREMENTS_OK=0; err "Required missing: ${hard_missing[*]} — run ./setup.sh"; fi
}

header "DetectOps · setup"
printf "${C_D}project:${C_0} %s\n" "$PROJECT_ROOT"
[ "$CHECK_ONLY" = "1" ] && printf "${C_D}mode:${C_0} check-only (no installs)\n"
[ "$CHECK_ONLY" = "0" ] && install_tools
[ "$CHECK_ONLY" = "0" ] && bootstrap_app
check_requirements
if [ "$REQUIREMENTS_OK" = "1" ]; then
  printf "\n${C_G}${C_W}✓ Requirements met.${C_0} Start the server with: ${C_W}./start-server.sh${C_0}\n"
else
  printf "\n${C_R}${C_W}✗ Requirements NOT met.${C_0} Enable the missing tools above (flags at top) and re-run ./setup.sh\n"; exit 1
fi
