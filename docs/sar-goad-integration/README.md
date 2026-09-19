# SAR + GOAD Integration Guide

Complete step-by-step notes for deploying Splunk Attack Range (SAR) alongside GOAD Active Directory lab, installing the Splunk Universal Forwarder on the GOAD Domain Controller, and joining both environments on the same network for unified detection engineering.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Network Layout](#3-network-layout)
4. [Step 1: Deploy Splunk Attack Range](#step-1-deploy-splunk-attack-range)
5. [Step 2: Deploy GOAD MINILAB](#step-2-deploy-goad-minilab)
6. [Step 3: Verify Network Connectivity](#step-3-verify-network-connectivity)
7. [Step 4: Install Sysmon on DC01](#step-4-install-sysmon-on-dc01)
8. [Step 5: Install Splunk Universal Forwarder on DC01](#step-5-install-splunk-universal-forwarder-on-dc01)
9. [Step 6: Configure Forwarder Inputs](#step-6-configure-forwarder-inputs)
10. [Step 7: Verify Log Flow in Splunk](#step-7-verify-log-flow-in-splunk)
11. [Automated Deployment](#automated-deployment)
12. [Troubleshooting](#troubleshooting)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                   VirtualBox Host (10.0.1.0/24)              │
│                                                              │
│  ┌─────────────────┐    ┌──────────────┐   ┌──────────────┐ │
│  │  SAR Splunk      │    │  GOAD DC01   │   │  GOAD WS01   │ │
│  │  10.0.1.12       │◄───│  10.0.1.30   │   │  10.0.1.31   │ │
│  │                  │    │              │   │              │ │
│  │  - Splunk 8.x    │    │  - Win 2019  │   │  - Win 10    │ │
│  │  - Port 9997 rcv │    │  - AD DS     │   │  - Joined    │ │
│  │  - Port 8000 web │    │  - DNS       │   │    to DC     │ │
│  │  - Port 8089 mgmt│    │  - Sysmon    │   │              │ │
│  │  - ESCU/CIM/TA   │    │  - Splunk UF │   │              │ │
│  └─────────────────┘    └──────────────┘   └──────────────┘ │
│         ▲                       │                            │
│         │    Logs forwarded     │                            │
│         └───────────────────────┘                            │
│           TCP 9997 (splunktcp)                               │
└──────────────────────────────────────────────────────────────┘
```

**What gets forwarded from DC01 to SAR Splunk:**
- Windows Security, Application, System event logs
- Active Directory logs (Directory Service, DFS, File Replication, KMS)
- DNS Server logs
- DHCP logs
- Sysmon operational logs (process creation, network, file, registry events)
- PowerShell ScriptBlock and Module logs

---

## 2. Prerequisites

| Requirement | Version | Notes |
|------------|---------|-------|
| VirtualBox | 6.1+ | Host provider for both SAR and GOAD |
| Vagrant | 2.2+ | VM provisioning |
| Ansible | 2.9+ | Configuration management (GOAD ships its own venv) |
| Python | 3.8+ | For GOAD CLI |
| RAM | 12GB+ free | SAR Splunk (6GB) + DC01 (4GB) + WS01 (4GB) |
| Disk | 60GB+ free | VM images and logs |

**Paths used in this guide:**
```
SAR:  /media/nested/SamsungEvo/Simulation/attack_range_local
GOAD: /media/nested/SamsungEvo/Projects/GOAD/GOAD
```

---

## 3. Network Layout

Both SAR and GOAD must be on the **same VirtualBox private network** subnet.

| Host | IP | Role |
|------|----|------|
| SAR Splunk Server | 10.0.1.12 | Splunk indexer + search head |
| SAR Windows DC | 10.0.1.14 | SAR's own domain controller (optional) |
| GOAD DC01 | 10.0.1.30 | GOAD domain controller (mini.lab) |
| GOAD WS01 | 10.0.1.31 | GOAD domain-joined workstation |

**Key ports on SAR Splunk (10.0.1.12):**
- `9997` — Splunk TCP receiving (forwarders send here)
- `8089` — Splunk management/REST API (deployment server)
- `8000` — Splunk Web UI

---

## Step 1: Deploy Splunk Attack Range

```bash
cd /media/nested/SamsungEvo/Simulation/attack_range_local

# Verify config has correct IPs
grep "splunk_server_private_ip" attack_range_local.conf
# Should show: splunk_server_private_ip = 10.0.1.12

# Start SAR (Splunk server + optionally the SAR DC)
cd vagrant
vagrant up --provider=virtualbox

# Verify Splunk is reachable
ping -c 3 10.0.1.12

# Verify Splunk web UI
curl -sk https://10.0.1.12:8089/services/server/info -u admin:I-l1ke-Attack-Range!
```

**SAR Credentials:**
- Splunk Web: `http://10.0.1.12:8000` — `admin` / `I-l1ke-Attack-Range!`
- Windows: `Administrator` / `I-l1ke-Attack-Range!`

---

## Step 2: Deploy GOAD MINILAB

### Option A: Start existing instance (recommended)

```bash
# Instance ID: d86a4c-minilab-virtualbox (already on 10.0.1.x subnet)

# Start headless
VBoxManage startvm "DC01" --type headless
VBoxManage startvm "WS01" --type headless

# Or start with GUI for easier interaction
VBoxManage startvm "DC01" --type gui
VBoxManage startvm "WS01" --type gui
```

### Option B: Load via GOAD CLI

```bash
cd /media/nested/SamsungEvo/Projects/GOAD/GOAD
bash goad.sh
# In the GOAD CLI:
#   load d86a4c-minilab-virtualbox
#   start
#   exit
```

### Option C: Create a new MINILAB instance

```bash
cd /media/nested/SamsungEvo/Projects/GOAD/GOAD
bash goad.sh
# In the GOAD CLI:
#   set_lab MINILAB
#   set_provider virtualbox
#   set_provisioner local
#   set_ip_range 10.0.1
#   provide
#   exit
```

**GOAD Credentials:**
- Domain: `mini.lab` (NetBIOS: `MINILAB`)
- Admin: `administrator@mini.lab` / `8dCT-DJjgScp`
- Domain users: `alice:spongebob`, `bob:superman`, `carol:123456789`, `dave:rockyou`

---

## Step 3: Verify Network Connectivity

```bash
# From your host, verify all machines are reachable
ping -c 1 10.0.1.12   # SAR Splunk
ping -c 1 10.0.1.30   # GOAD DC01
ping -c 1 10.0.1.31   # GOAD WS01

# Verify Splunk receiving port is open
echo >/dev/tcp/10.0.1.12/9997 && echo "Port 9997 OPEN" || echo "Port 9997 CLOSED"

# Verify WinRM is accessible on DC01 (used by Ansible)
echo >/dev/tcp/10.0.1.30/5985 && echo "WinRM OPEN" || echo "WinRM CLOSED"

# From DC01 (via WinRM/RDP), verify it can reach Splunk
# PowerShell on DC01:
#   Test-NetConnection -ComputerName 10.0.1.12 -Port 9997
```

---

## Step 4: Install Sysmon on DC01

Sysmon provides deep visibility into process creation, network connections, file changes, and registry modifications — critical for detection engineering.

### Using Ansible (recommended)

```bash
# Use GOAD's own Ansible venv (system Ansible may have broken dependencies)
ANSIBLE_BIN=~/.goad/.venv/bin/ansible-playbook

# Create a minimal playbook for Sysmon
cat > /tmp/install_sysmon.yml << 'PLAYBOOK'
- name: Install Sysmon on DC01
  hosts: dc01
  tasks:
    - name: Create working directory
      win_file:
        path: 'c:\Program Files\ansible'
        state: directory

    - name: Download Sysmon
      win_get_url:
        url: "https://download.sysinternals.com/files/Sysmon.zip"
        dest: 'c:\Program Files\ansible\Sysmon.zip'
        timeout: 120

    - name: Extract Sysmon
      win_unzip:
        src: 'c:\Program Files\ansible\Sysmon.zip'
        dest: 'c:\Program Files\ansible\sysmon'
        creates: 'c:\Program Files\ansible\sysmon\Sysmon64.exe'

    - name: Copy Sysmon config
      win_copy:
        src: sysmonconfig.xml
        dest: 'c:\Program Files\ansible\sysmonconfig.xml'

    - name: Install Sysmon
      win_command: '"c:\Program Files\ansible\sysmon\Sysmon64.exe" -accepteula -i "c:\Program Files\ansible\sysmonconfig.xml"'
      register: result
      failed_when: result.rc not in [0, 1]

    - name: Configure Sysmon event log size (300MB)
      win_regedit:
        key: "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WINEVT\\Channels\\Microsoft-Windows-Sysmon/Operational"
        value: MaxSize
        datatype: dword
        data: 315801600

    - name: Enable PowerShell ScriptBlock logging
      win_regedit:
        key: "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging"
        value: EnableScriptBlockLogging
        datatype: dword
        data: 1

    - name: Enable PowerShell Module logging
      win_regedit:
        key: "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ModuleLogging"
        value: EnableModuleLogging
        datatype: dword
        data: 1
PLAYBOOK

# Run it against the GOAD inventory
ANSIBLE_HOST_KEY_CHECKING=False $ANSIBLE_BIN \
  -i /media/nested/SamsungEvo/Projects/GOAD/GOAD/workspace/d86a4c-minilab-virtualbox/inventory_disable_vagrant \
  /tmp/install_sysmon.yml -v
```

### Manual (via RDP/WinRM to DC01)

```powershell
# On DC01 as Administrator:

# Download Sysmon
Invoke-WebRequest -Uri "https://download.sysinternals.com/files/Sysmon.zip" -OutFile "C:\Sysmon.zip"
Expand-Archive -Path "C:\Sysmon.zip" -DestinationPath "C:\Sysmon"

# Download SwiftOnSecurity Sysmon config
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/SwiftOnSecurity/sysmon-config/master/sysmonconfig-export.xml" -OutFile "C:\Sysmon\sysmonconfig.xml"

# Install
C:\Sysmon\Sysmon64.exe -accepteula -i C:\Sysmon\sysmonconfig.xml

# Verify
Get-Service Sysmon64
Get-WinEvent -LogName "Microsoft-Windows-Sysmon/Operational" -MaxEvents 5
```

---

## Step 5: Install Splunk Universal Forwarder on DC01

### Using Ansible (recommended)

```bash
ANSIBLE_BIN=~/.goad/.venv/bin/ansible-playbook
GOAD_WORKSPACE=/media/nested/SamsungEvo/Projects/GOAD/GOAD/workspace/d86a4c-minilab-virtualbox

# Create merged inventory targeting only DC01
cat $GOAD_WORKSPACE/inventory_disable_vagrant > /tmp/goad_splunk_inv.ini
cat >> /tmp/goad_splunk_inv.ini << 'EOF'

[splunk_forwarder_targets]
dc01
EOF

# Run the Splunk Forwarder extension playbook
cd /media/nested/SamsungEvo/Projects/GOAD/GOAD/extensions/splunk_forwarder/ansible

ANSIBLE_HOST_KEY_CHECKING=False $ANSIBLE_BIN \
  -i /tmp/goad_splunk_inv.ini \
  install.yml \
  --extra-vars "splunk_server_ip=10.0.1.12 \
                splunk_server_port=9997 \
                splunk_server_mgmt_port=8089 \
                splunk_uf_password=I-l1ke-Attack-Range! \
                sysmon_download_url=https://download.sysinternals.com/files/Sysmon.zip" \
  -v
```

### Manual (via RDP/WinRM to DC01)

```powershell
# On DC01 as Administrator:

# 1. Download Splunk Universal Forwarder
[Net.ServicePointManager]::SecurityProtocol = "tls12, tls11, tls"
$url = "https://download.splunk.com/products/universalforwarder/releases/9.1.2/windows/splunkforwarder-9.1.2-b6b9c8185839-x64-release.msi"
(New-Object System.Net.WebClient).DownloadFile($url, "C:\splunkuf.msi")

# 2. Install silently
Start-Process msiexec.exe -ArgumentList '/i C:\splunkuf.msi WINEVENTLOG_SEC_ENABLE=0 WINEVENTLOG_SYS_ENABLE=0 WINEVENTLOG_APP_ENABLE=0 SPLUNKPASSWORD=I-l1ke-Attack-Range! AGREETOLICENSE=YES /quiet' -Wait

# 3. Configure outputs (forward to SAR Splunk)
$outputsDir = "C:\Program Files\SplunkUniversalForwarder\etc\apps\sar_outputs\local"
New-Item -ItemType Directory -Path $outputsDir -Force
@"
[tcpout]
defaultGroup=sar_indexers

[tcpout:sar_indexers]
server=10.0.1.12:9997
"@ | Out-File -FilePath "$outputsDir\outputs.conf" -Encoding ASCII

# 4. Configure deployment client
$dClientDir = "C:\Program Files\SplunkUniversalForwarder\etc\apps\sar_deploymentclient\local"
New-Item -ItemType Directory -Path $dClientDir -Force
@"
[deployment-client]

[target-broker:deploymentServer]
targetUri=10.0.1.12:8089
"@ | Out-File -FilePath "$dClientDir\deploymentclient.conf" -Encoding ASCII

# 5. Restart forwarder
& "C:\Program Files\SplunkUniversalForwarder\bin\splunk.exe" restart
```

---

## Step 6: Configure Forwarder Inputs

These input configs tell the Splunk UF which logs to collect and forward.

### Using Ansible

The extension playbook (Step 5) already deploys all input configs. If you need to add them manually:

### Manual (on DC01)

```powershell
# Windows Event Log inputs
$inputsDir = "C:\Program Files\SplunkUniversalForwarder\etc\apps\sar_inputs\local"
New-Item -ItemType Directory -Path $inputsDir -Force
@"
[WinEventLog://Application]
disabled = 0
start_from = oldest
current_only = 0
checkpointInterval = 5
renderXml=true
index = win

[WinEventLog://Security]
disabled = 0
start_from = oldest
current_only = 0
evt_resolve_ad_obj = 1
checkpointInterval = 5
renderXml=true
index = win

[WinEventLog://System]
disabled = 0
start_from = oldest
current_only = 0
checkpointInterval = 5
renderXml=true
index = win

[WinEventLog://DFS Replication]
disabled = 0
renderXml=true
index = win

[WinEventLog://Directory Service]
disabled = 0
renderXml=true
index = win

[WinEventLog://DNS Server]
disabled = 0
renderXml=true
index = dns
"@ | Out-File -FilePath "$inputsDir\inputs.conf" -Encoding ASCII

# Sysmon inputs
$sysmonDir = "C:\Program Files\SplunkUniversalForwarder\etc\apps\sar_sysmon_inputs\local"
New-Item -ItemType Directory -Path $sysmonDir -Force
@"
[WinEventLog://Microsoft-Windows-Sysmon/Operational]
disabled = false
renderXml = 1
index = win
source = XmlWinEventLog:Microsoft-Windows-Sysmon/Operational
"@ | Out-File -FilePath "$sysmonDir\inputs.conf" -Encoding ASCII

# PowerShell inputs
$psDir = "C:\Program Files\SplunkUniversalForwarder\etc\apps\sar_powershell_inputs\local"
New-Item -ItemType Directory -Path $psDir -Force
@"
[WinEventLog://Microsoft-Windows-PowerShell/Operational]
disabled = false
index = win

[WinEventLog://Windows PowerShell]
disabled = false
index = win
"@ | Out-File -FilePath "$psDir\inputs.conf" -Encoding ASCII

# Restart forwarder to pick up new inputs
& "C:\Program Files\SplunkUniversalForwarder\bin\splunk.exe" restart
```

---

## Step 7: Verify Log Flow in Splunk

### Via Splunk Web UI

1. Open `http://10.0.1.12:8000` in your browser
2. Login with `admin` / `I-l1ke-Attack-Range!`
3. Go to **Search & Reporting**
4. Run these searches:

```spl
# Check if DC01 logs are arriving
index=win host=dc* | stats count by host, sourcetype | sort -count

# Check Sysmon events specifically
index=win sourcetype="XmlWinEventLog:Microsoft-Windows-Sysmon/Operational" | head 20

# Check Windows Security events (logon, privilege use, etc.)
index=win sourcetype="XmlWinEventLog:Security" | stats count by EventCode | sort -count | head 20

# Check PowerShell logs
index=win sourcetype="XmlWinEventLog:Microsoft-Windows-PowerShell/Operational" | head 10

# Check Active Directory logs
index=win source="WinEventLog:Directory Service" | head 10

# Check DNS logs
index=dns host=dc* | head 10

# Check connected forwarders
| rest /services/deployment/server/clients | table hostname, ip, lastPhoneHomeTime
```

### Via CLI (from host)

```bash
# Quick check via Splunk REST API
curl -sk -u admin:I-l1ke-Attack-Range! \
  "https://10.0.1.12:8089/services/search/jobs/export" \
  -d 'search=search index=win host=dc* | stats count by host, sourcetype | head 20' \
  -d 'output_mode=json' \
  -d 'earliest_time=-15m'
```

---

## Automated Deployment

For fully automated deployment, use the orchestrator script:

```bash
# Full deployment (SAR + GOAD + Splunk Forwarder)
./scripts/sar-goad-orchestrator.sh deploy

# Install/reinstall forwarder only
./scripts/sar-goad-orchestrator.sh forwarder

# Check status of everything
./scripts/sar-goad-orchestrator.sh status

# Verify log flow
./scripts/sar-goad-orchestrator.sh verify

# Start/stop all VMs
./scripts/sar-goad-orchestrator.sh start
./scripts/sar-goad-orchestrator.sh stop
```

Or via the Detection Platform UI:
1. Navigate to **Environment Manager** > **GOAD Active Directory** tab
2. Click **Start Headless** or **Start GUI**
3. Click **Install Splunk Universal Forwarder on GOAD Machines**

---

## Troubleshooting

### Ansible fails with ImportError (markupsafe/jinja2)

The system Ansible may have broken Python dependencies. Use GOAD's own venv:

```bash
# Instead of: ansible-playbook ...
# Use:        ~/.goad/.venv/bin/ansible-playbook ...
```

### DC01 can't reach Splunk (10.0.1.12)

Verify both VMs are on the same VirtualBox host-only network:

```bash
# Check VirtualBox network adapters
VBoxManage showvminfo "DC01" | grep "NIC"
VBoxManage showvminfo "intack_range_local_splunk" | grep "NIC"

# Both should show the same host-only adapter (e.g., vboxnet0)
```

If they're on different adapters, configure them to use the same one:

```bash
VBoxManage modifyvm "DC01" --nic2 hostonly --hostonlyadapter2 vboxnet0
```

### Splunk UF not forwarding (port 9997 unreachable from DC01)

```powershell
# On DC01, test connectivity
Test-NetConnection -ComputerName 10.0.1.12 -Port 9997

# Check if SplunkForwarder service is running
Get-Service SplunkForwarder

# Check forwarder logs
Get-Content "C:\Program Files\SplunkUniversalForwarder\var\log\splunk\splunkd.log" -Tail 50
```

### WinRM connection refused (Ansible can't reach DC01)

```bash
# Verify WinRM is listening
echo >/dev/tcp/10.0.1.30/5985

# Test with Ansible ping
~/.goad/.venv/bin/ansible dc01 -i inventory_disable_vagrant -m win_ping
```

### No logs appearing in Splunk after install

1. Wait 2-3 minutes — the forwarder batches events before sending
2. Check the `win` index exists on Splunk: `| eventcount index=win`
3. Check forwarder internal logs: `index=_internal source=*metrics.log host=dc* group=tcpout_connections`
4. Ensure the `win` and `dns` indexes exist (SAR creates these during provisioning)

### GOAD instance on wrong subnet

If your GOAD instance uses `192.168.56.x` instead of `10.0.1.x`:

```bash
# Create a new instance on the correct subnet
cd /media/nested/SamsungEvo/Projects/GOAD/GOAD
bash goad.sh
# set_lab MINILAB
# set_provider virtualbox
# set_ip_range 10.0.1
# provide
```

---

## File Reference

| File | Purpose |
|------|---------|
| `extensions/splunk_forwarder/extension.json` | GOAD extension metadata |
| `extensions/splunk_forwarder/inventory` | Extension host targeting (DC only) |
| `extensions/splunk_forwarder/ansible/install.yml` | Main Ansible playbook |
| `extensions/splunk_forwarder/ansible/roles/splunk_uf_windows/` | Splunk UF Ansible role |
| `scripts/sar-goad-orchestrator.sh` | Automated deployment script |
| `scripts/.env.sar-goad` | Environment configuration |
| `src/app/api/goad/` | Platform API endpoints |
| `src/app/(dashboard)/environment-manager/goad-panel.tsx` | Platform UI component |
| `backend/app/clients/goad.py` | Backend GOAD management client |
