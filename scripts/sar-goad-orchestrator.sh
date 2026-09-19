#!/usr/bin/env bash
# =============================================================================
# SAR + GOAD Unified Deployment Orchestrator
# =============================================================================
# Automates the full lifecycle:
#   1. Deploy SAR Splunk server (Vagrant/VirtualBox)
#   2. Deploy GOAD MINILAB (load existing instance or create new)
#   3. Install Splunk Forwarder extension on GOAD Windows machines
#   4. Verify connectivity and log flow
#
# Usage:
#   ./sar-goad-orchestrator.sh deploy      # Full deployment
#   ./sar-goad-orchestrator.sh start       # Start existing VMs
#   ./sar-goad-orchestrator.sh stop        # Stop all VMs
#   ./sar-goad-orchestrator.sh status      # Check status of all components
#   ./sar-goad-orchestrator.sh forwarder   # Install/reinstall Splunk Forwarder only
#   ./sar-goad-orchestrator.sh destroy     # Tear down everything
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment or .env file)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.sar-goad"

if [[ -f "$ENV_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$ENV_FILE"
fi

# Paths
SAR_PATH="${SAR_PATH:-/media/nested/SamsungEvo/Simulation/attack_range_local}"
GOAD_PATH="${GOAD_PATH:-/media/nested/SamsungEvo/Projects/GOAD/GOAD}"
GOAD_INSTANCE_ID="${GOAD_INSTANCE_ID:-d86a4c-minilab-virtualbox}"

# Network (must match both SAR and GOAD configs)
SUBNET="${SUBNET:-10.0.1}"
SPLUNK_IP="${SPLUNK_IP:-${SUBNET}.12}"
GOAD_DC01_IP="${GOAD_DC01_IP:-${SUBNET}.30}"
GOAD_WS01_IP="${GOAD_WS01_IP:-${SUBNET}.31}"

# Splunk
SPLUNK_RECV_PORT="${SPLUNK_RECV_PORT:-9997}"
SPLUNK_MGMT_PORT="${SPLUNK_MGMT_PORT:-8089}"
SPLUNK_WEB_PORT="${SPLUNK_WEB_PORT:-8000}"
SPLUNK_ADMIN_PASSWORD="${SPLUNK_ADMIN_PASSWORD:-I-l1ke-Attack-Range!}"

# GOAD
GOAD_LAB="${GOAD_LAB:-MINILAB}"
GOAD_DOMAIN="${GOAD_DOMAIN:-mini.lab}"
GOAD_ADMIN_USER="${GOAD_ADMIN_USER:-administrator@mini.lab}"
GOAD_ADMIN_PASSWORD="${GOAD_ADMIN_PASSWORD:-8dCT-DJjgScp}"

# Timeouts
VM_BOOT_TIMEOUT="${VM_BOOT_TIMEOUT:-300}"
PING_TIMEOUT="${PING_TIMEOUT:-5}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_FILE="${SCRIPT_DIR}/sar-goad-deploy.log"

log() {
    local level="$1"
    shift
    local msg="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${msg}" | tee -a "$LOG_FILE"
}

info()    { log "${BLUE}INFO${NC}" "$@"; }
success() { log "${GREEN}OK${NC}" "$@"; }
warn()    { log "${YELLOW}WARN${NC}" "$@"; }
error()   { log "${RED}ERROR${NC}" "$@"; }
header()  { echo -e "\n${CYAN}========== $* ==========${NC}" | tee -a "$LOG_FILE"; }

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
validate_prerequisites() {
    header "Validating Prerequisites"

    local missing=()

    command -v VBoxManage &>/dev/null || missing+=("VBoxManage (VirtualBox)")
    command -v vagrant &>/dev/null    || missing+=("vagrant")
    command -v ansible &>/dev/null    || missing+=("ansible")
    command -v python3 &>/dev/null    || missing+=("python3")

    [[ -d "$SAR_PATH" ]] || missing+=("SAR directory: $SAR_PATH")
    [[ -d "$GOAD_PATH" ]] || missing+=("GOAD directory: $GOAD_PATH")

    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Missing prerequisites:"
        for m in "${missing[@]}"; do
            echo "  - $m"
        done
        exit 1
    fi

    success "All prerequisites found"
}

# ---------------------------------------------------------------------------
# Network Helpers
# ---------------------------------------------------------------------------
wait_for_host() {
    local ip="$1"
    local name="$2"
    local timeout="${3:-$VM_BOOT_TIMEOUT}"
    local elapsed=0

    info "Waiting for ${name} (${ip}) to become reachable..."
    while ! ping -c 1 -W "$PING_TIMEOUT" "$ip" &>/dev/null; do
        elapsed=$((elapsed + PING_TIMEOUT))
        if [[ $elapsed -ge $timeout ]]; then
            error "${name} (${ip}) did not respond within ${timeout}s"
            return 1
        fi
        sleep 2
    done
    success "${name} (${ip}) is reachable"
}

check_splunk_port() {
    local ip="$1"
    local port="$2"
    if timeout 5 bash -c "echo >/dev/tcp/${ip}/${port}" 2>/dev/null; then
        success "Splunk port ${port} on ${ip} is open"
        return 0
    else
        warn "Splunk port ${port} on ${ip} is not reachable"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# SAR Functions
# ---------------------------------------------------------------------------
sar_status() {
    local sar_vagrant_dir="${SAR_PATH}/vagrant"
    if [[ -d "$sar_vagrant_dir" ]]; then
        cd "$sar_vagrant_dir"
        vagrant status 2>/dev/null || echo "SAR vagrant status unavailable"
        cd - >/dev/null
    else
        warn "SAR vagrant directory not found"
    fi
}

sar_deploy() {
    header "Deploying SAR Splunk Server"

    cd "$SAR_PATH"

    # Check if Splunk server VM already exists
    if VBoxManage list vms 2>/dev/null | grep -q "intack_range_local_splunk"; then
        info "SAR Splunk VM already exists, checking state..."
        local state
        state=$(VBoxManage showvminfo "intack_range_local_splunk" --machinereadable 2>/dev/null | grep "VMState=" | cut -d'"' -f2 || echo "unknown")

        if [[ "$state" == "running" ]]; then
            success "SAR Splunk server is already running"
            cd - >/dev/null
            return 0
        fi
    fi

    info "Starting SAR via vagrant..."
    cd "${SAR_PATH}/vagrant"

    # Only bring up the splunk server (not the SAR DC which conflicts with GOAD)
    if [[ -d "splunk_server" ]]; then
        cd splunk_server
        vagrant up --provider=virtualbox 2>&1 | tee -a "$LOG_FILE"
        cd ..
    else
        vagrant up 2>&1 | tee -a "$LOG_FILE"
    fi

    cd - >/dev/null

    wait_for_host "$SPLUNK_IP" "SAR Splunk Server"
    check_splunk_port "$SPLUNK_IP" "$SPLUNK_RECV_PORT"
    check_splunk_port "$SPLUNK_IP" "$SPLUNK_WEB_PORT"

    success "SAR Splunk server deployed and ready"
}

sar_start() {
    header "Starting SAR Splunk Server"

    if VBoxManage list vms 2>/dev/null | grep -q "splunk"; then
        local vm_name
        vm_name=$(VBoxManage list vms 2>/dev/null | grep -o '"[^"]*splunk[^"]*"' | head -1 | tr -d '"')
        if [[ -n "$vm_name" ]]; then
            local state
            state=$(VBoxManage showvminfo "$vm_name" --machinereadable 2>/dev/null | grep "VMState=" | cut -d'"' -f2 || echo "unknown")
            if [[ "$state" == "running" ]]; then
                success "SAR Splunk server already running"
                return 0
            fi
            info "Starting VM: $vm_name"
            VBoxManage startvm "$vm_name" --type headless 2>&1 | tee -a "$LOG_FILE"
            wait_for_host "$SPLUNK_IP" "SAR Splunk Server"
            return 0
        fi
    fi

    warn "SAR Splunk VM not found - run 'deploy' first"
    return 1
}

sar_stop() {
    header "Stopping SAR"
    cd "${SAR_PATH}/vagrant"
    vagrant halt 2>&1 | tee -a "$LOG_FILE" || true
    cd - >/dev/null
    success "SAR stopped"
}

# ---------------------------------------------------------------------------
# GOAD Functions
# ---------------------------------------------------------------------------
goad_instance_dir() {
    echo "${GOAD_PATH}/workspace/${GOAD_INSTANCE_ID}"
}

goad_status() {
    local instance_dir
    instance_dir=$(goad_instance_dir)

    if [[ -f "${instance_dir}/instance.json" ]]; then
        info "GOAD Instance: ${GOAD_INSTANCE_ID}"
        cat "${instance_dir}/instance.json"
        echo ""

        # Check VM states
        for vm in DC01 WS01; do
            if VBoxManage list runningvms 2>/dev/null | grep -q "$vm"; then
                success "  ${vm}: running"
            elif VBoxManage list vms 2>/dev/null | grep -q "$vm"; then
                warn "  ${vm}: stopped"
            else
                error "  ${vm}: not found"
            fi
        done
    else
        warn "GOAD instance ${GOAD_INSTANCE_ID} not found"
    fi
}

goad_start() {
    header "Starting GOAD MINILAB"

    local instance_dir
    instance_dir=$(goad_instance_dir)

    if [[ ! -d "$instance_dir" ]]; then
        error "GOAD instance ${GOAD_INSTANCE_ID} not found at ${instance_dir}"
        info "Run 'deploy' to create a new instance or check GOAD_INSTANCE_ID"
        return 1
    fi

    # Start VMs via VBoxManage (faster than vagrant up for existing VMs)
    for vm in DC01 WS01; do
        if VBoxManage list runningvms 2>/dev/null | grep -q "$vm"; then
            info "${vm} is already running"
        elif VBoxManage list vms 2>/dev/null | grep -q "$vm"; then
            info "Starting ${vm}..."
            VBoxManage startvm "$vm" --type headless 2>&1 | tee -a "$LOG_FILE"
        else
            error "${vm} VM not found in VirtualBox"
            return 1
        fi
    done

    wait_for_host "$GOAD_DC01_IP" "GOAD DC01"
    wait_for_host "$GOAD_WS01_IP" "GOAD WS01"

    success "GOAD MINILAB started"
}

goad_deploy() {
    header "Deploying GOAD MINILAB"

    local instance_dir
    instance_dir=$(goad_instance_dir)

    if [[ -d "$instance_dir" ]]; then
        info "GOAD instance ${GOAD_INSTANCE_ID} already exists"
        goad_start
        return $?
    fi

    # Fresh deployment via goad.sh
    info "Creating new GOAD MINILAB instance..."
    cd "$GOAD_PATH"

    # Use GOAD CLI to create and provision
    echo -e "set_lab MINILAB\nset_provider virtualbox\nset_provisioner local\nset_ip_range ${SUBNET}\nprovide\nexit" | \
        bash goad.sh 2>&1 | tee -a "$LOG_FILE"

    cd - >/dev/null

    wait_for_host "$GOAD_DC01_IP" "GOAD DC01"
    wait_for_host "$GOAD_WS01_IP" "GOAD WS01"

    success "GOAD MINILAB deployed"
}

goad_stop() {
    header "Stopping GOAD MINILAB"

    for vm in DC01 WS01; do
        if VBoxManage list runningvms 2>/dev/null | grep -q "$vm"; then
            info "Stopping ${vm}..."
            VBoxManage controlvm "$vm" acpipowerbutton 2>/dev/null || \
                VBoxManage controlvm "$vm" poweroff 2>/dev/null || true
        fi
    done

    success "GOAD stopped"
}

# ---------------------------------------------------------------------------
# Splunk Forwarder Extension
# ---------------------------------------------------------------------------
install_splunk_forwarder() {
    header "Installing Splunk Forwarder Extension on GOAD"

    local instance_dir
    instance_dir=$(goad_instance_dir)
    local inventory="${instance_dir}/inventory_disable_vagrant"
    local extension_dir="${GOAD_PATH}/extensions/splunk_forwarder"
    local extension_ansible="${extension_dir}/ansible"

    # Validate
    if [[ ! -f "$inventory" ]]; then
        error "GOAD inventory not found at ${inventory}"
        error "Ensure GOAD is deployed and provisioned first"
        return 1
    fi

    if [[ ! -d "$extension_ansible" ]]; then
        error "Splunk forwarder extension not found at ${extension_ansible}"
        return 1
    fi

    # Verify SAR Splunk is reachable before installing forwarders
    info "Verifying SAR Splunk server connectivity..."
    if ! wait_for_host "$SPLUNK_IP" "SAR Splunk Server" 30; then
        error "SAR Splunk server at ${SPLUNK_IP} is not reachable"
        error "Start SAR first: $0 start"
        return 1
    fi

    if ! check_splunk_port "$SPLUNK_IP" "$SPLUNK_RECV_PORT"; then
        error "Splunk receiving port ${SPLUNK_RECV_PORT} is not open on ${SPLUNK_IP}"
        return 1
    fi

    # Verify GOAD machines are reachable
    wait_for_host "$GOAD_DC01_IP" "GOAD DC01" 60
    wait_for_host "$GOAD_WS01_IP" "GOAD WS01" 60

    # Build merged inventory with extension groups
    local merged_inventory
    merged_inventory=$(mktemp)
    cat "$inventory" > "$merged_inventory"
    cat >> "$merged_inventory" << 'EXTINV'

; Splunk Forwarder Extension groups
[splunk_forwarder_targets]
dc01

[wef_sources]
ws01

[sysmon_targets]
dc01
ws01
EXTINV

    # Run the Ansible playbook (use GOAD's venv which has working dependencies)
    local ansible_bin="${HOME}/.goad/.venv/bin/ansible-playbook"
    if [[ ! -x "$ansible_bin" ]]; then
        ansible_bin="ansible-playbook"
        warn "GOAD venv ansible not found, falling back to system ansible"
    fi

    info "Running Splunk Forwarder installation playbook..."
    cd "$extension_ansible"

    ANSIBLE_HOST_KEY_CHECKING=False "$ansible_bin" \
        -i "$merged_inventory" \
        install.yml \
        --extra-vars "splunk_server_ip=${SPLUNK_IP} \
                      splunk_server_port=${SPLUNK_RECV_PORT} \
                      splunk_server_mgmt_port=${SPLUNK_MGMT_PORT} \
                      splunk_uf_password=${SPLUNK_ADMIN_PASSWORD} \
                      sysmon_download_url=https://download.sysinternals.com/files/Sysmon.zip" \
        -v 2>&1 | tee -a "$LOG_FILE"

    local rc=${PIPESTATUS[0]}
    rm -f "$merged_inventory"
    cd - >/dev/null

    if [[ $rc -eq 0 ]]; then
        success "Splunk Forwarder extension installed on all GOAD machines"
    else
        error "Splunk Forwarder installation failed (exit code: ${rc})"
        return 1
    fi
}

verify_log_flow() {
    header "Verifying Log Flow: GOAD -> SAR Splunk"

    # Check Splunk receiving port
    if ! check_splunk_port "$SPLUNK_IP" "$SPLUNK_RECV_PORT"; then
        error "Splunk receiving port not available"
        return 1
    fi

    # Check for forwarded data via Splunk REST API
    info "Checking Splunk for GOAD host data..."
    local search_result
    search_result=$(curl -sk -u "admin:${SPLUNK_ADMIN_PASSWORD}" \
        "https://${SPLUNK_IP}:${SPLUNK_MGMT_PORT}/services/search/jobs/export" \
        -d "search=search index=win host=dc* OR host=ws* | stats count by host | head 10" \
        -d "output_mode=json" \
        -d "earliest_time=-15m" \
        2>/dev/null || echo "")

    if [[ -n "$search_result" ]] && echo "$search_result" | grep -q "dc\|ws"; then
        success "GOAD logs are flowing into SAR Splunk!"
        echo "$search_result" | python3 -m json.tool 2>/dev/null || echo "$search_result"
    else
        warn "No GOAD logs found in Splunk yet (this may take a few minutes after forwarder install)"
        info "Check manually: https://${SPLUNK_IP}:${SPLUNK_WEB_PORT} -> Search: index=win host=dc* OR host=ws*"
    fi
}

# ---------------------------------------------------------------------------
# Composite Commands
# ---------------------------------------------------------------------------
deploy_all() {
    validate_prerequisites

    header "Full SAR + GOAD Deployment"
    info "SAR Path:          ${SAR_PATH}"
    info "GOAD Path:         ${GOAD_PATH}"
    info "GOAD Instance:     ${GOAD_INSTANCE_ID}"
    info "Subnet:            ${SUBNET}.0/24"
    info "Splunk Server:     ${SPLUNK_IP}"
    info "GOAD DC01:         ${GOAD_DC01_IP}"
    info "GOAD WS01:         ${GOAD_WS01_IP}"
    echo ""

    # Step 1: Deploy SAR
    sar_deploy

    # Step 2: Deploy GOAD
    goad_deploy

    # Step 3: Install Splunk Forwarder on GOAD
    install_splunk_forwarder

    # Step 4: Verify
    verify_log_flow

    header "Deployment Complete"
    echo ""
    echo -e "  ${GREEN}SAR Splunk Web:${NC}  https://${SPLUNK_IP}:${SPLUNK_WEB_PORT}"
    echo -e "  ${GREEN}Splunk Creds:${NC}    admin / ${SPLUNK_ADMIN_PASSWORD}"
    echo -e "  ${GREEN}GOAD DC01:${NC}       ${GOAD_DC01_IP} (${GOAD_DOMAIN})"
    echo -e "  ${GREEN}GOAD WS01:${NC}       ${GOAD_WS01_IP}"
    echo -e "  ${GREEN}GOAD Admin:${NC}      ${GOAD_ADMIN_USER} / ${GOAD_ADMIN_PASSWORD}"
    echo ""
    echo -e "  ${CYAN}Search for GOAD logs:${NC} index=win host=dc* OR host=ws*"
    echo ""
}

start_all() {
    validate_prerequisites
    sar_start
    goad_start
    info "Waiting 30s for services to initialize..."
    sleep 30
    verify_log_flow
}

stop_all() {
    goad_stop
    sar_stop
}

status_all() {
    header "SAR Status"
    sar_status
    echo ""
    header "GOAD Status"
    goad_status
    echo ""
    header "Connectivity"
    for ip_name in "${SPLUNK_IP}:SAR_Splunk" "${GOAD_DC01_IP}:GOAD_DC01" "${GOAD_WS01_IP}:GOAD_WS01"; do
        local ip="${ip_name%%:*}"
        local name="${ip_name##*:}"
        if ping -c 1 -W 2 "$ip" &>/dev/null; then
            success "  ${name} (${ip}): reachable"
        else
            warn "  ${name} (${ip}): unreachable"
        fi
    done
}

destroy_all() {
    header "Destroying SAR + GOAD Environment"
    warn "This will destroy ALL VMs. Press Ctrl+C within 10s to cancel."
    sleep 10

    goad_stop
    sar_stop

    # Let VMs shut down gracefully
    sleep 5

    info "Destroying GOAD VMs..."
    for vm in DC01 WS01; do
        VBoxManage unregistervm "$vm" --delete 2>/dev/null || true
    done

    info "Destroying SAR VMs..."
    cd "${SAR_PATH}/vagrant"
    vagrant destroy -f 2>/dev/null || true
    cd - >/dev/null

    success "All VMs destroyed"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
usage() {
    echo "SAR + GOAD Unified Deployment Orchestrator"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  deploy      Full deployment (SAR + GOAD + Splunk Forwarder)"
    echo "  start       Start existing SAR + GOAD VMs"
    echo "  stop        Stop all VMs"
    echo "  status      Check status of all components"
    echo "  forwarder   Install/reinstall Splunk Forwarder extension on GOAD"
    echo "  verify      Verify log flow from GOAD to SAR Splunk"
    echo "  destroy     Tear down everything (destructive!)"
    echo ""
    echo "Environment:"
    echo "  SAR_PATH=${SAR_PATH}"
    echo "  GOAD_PATH=${GOAD_PATH}"
    echo "  GOAD_INSTANCE_ID=${GOAD_INSTANCE_ID}"
    echo "  SPLUNK_IP=${SPLUNK_IP}"
    echo ""
    echo "Override settings via: ${ENV_FILE}"
}

case "${1:-}" in
    deploy)    deploy_all ;;
    start)     start_all ;;
    stop)      stop_all ;;
    status)    status_all ;;
    forwarder) install_splunk_forwarder ;;
    verify)    verify_log_flow ;;
    destroy)   destroy_all ;;
    -h|--help) usage ;;
    *)         usage; exit 1 ;;
esac
