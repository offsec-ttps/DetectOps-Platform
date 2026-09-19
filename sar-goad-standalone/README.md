# SAR + GOAD Standalone Integration Kit

Self-contained copy of all SAR + GOAD integration code for independent testing.
This directory is isolated from the main detection-platform — safe to modify, experiment, and break.

## Directory Structure

```
sar-goad-standalone/
├── README.md                          # This file
├── docs/
│   └── README.md                      # Full step-by-step installation guide
├── goad-extension/                    # GOAD Splunk Forwarder Extension
│   ├── extension.json                 # Extension metadata
│   ├── inventory                      # Ansible inventory targeting DC01
│   ├── ansible/
│   │   ├── install.yml                # Main install playbook (Sysmon + Splunk UF)
│   │   ├── uninstall.yml              # Uninstall playbook
│   │   └── roles/
│   │       └── splunk_uf_windows/     # Splunk UF Ansible role
│   │           ├── tasks/
│   │           │   ├── main.yml
│   │           │   ├── install_splunk_uf.yml
│   │           │   ├── configure_outputs.yml
│   │           │   ├── configure_deployment_client.yml
│   │           │   └── configure_inputs.yml
│   │           ├── templates/
│   │           │   ├── outputs.conf.j2
│   │           │   └── deploymentclient.conf.j2
│   │           ├── files/
│   │           │   ├── win_event_log_inputs.conf
│   │           │   ├── sysmon_inputs.conf
│   │           │   ├── powershell_inputs.conf
│   │           │   └── sysmonconfig.xml
│   │           ├── defaults/main.yml
│   │           └── handlers/main.yml
├── scripts/
│   ├── sar-goad-orchestrator.sh       # Full lifecycle orchestration script
│   └── .env.sar-goad                  # Environment configuration
├── backend/
│   ├── goad.py                        # Python GOAD management client (FastAPI)
│   └── config.py                      # Backend settings (with GOAD config added)
└── frontend-api/
    ├── goad-panel.tsx                  # React UI component for GOAD management
    └── goad/
        ├── status/route.ts            # GET  /api/goad/status
        ├── start/route.ts             # POST /api/goad/start
        ├── stop/route.ts              # POST /api/goad/stop
        ├── forwarder/route.ts         # POST /api/goad/forwarder
        └── instances/route.ts         # GET  /api/goad/instances
```

## Quick Start

### 1. Install the GOAD extension into your GOAD installation

```bash
cp -r goad-extension/ /path/to/GOAD/extensions/splunk_forwarder/
```

### 2. Run the forwarder installation on DC01

```bash
# Edit scripts/.env.sar-goad with your paths and IPs, then:
cd scripts
chmod +x sar-goad-orchestrator.sh
./sar-goad-orchestrator.sh forwarder
```

### 3. Verify logs in Splunk

```bash
./scripts/sar-goad-orchestrator.sh verify
# Or open Splunk Web and search: index=win host=dc*
```

## Configuration

Edit `scripts/.env.sar-goad` to match your environment:

| Variable | Default | Description |
|----------|---------|-------------|
| SAR_PATH | /media/nested/.../attack_range_local | Path to SAR installation |
| GOAD_PATH | /media/nested/.../GOAD | Path to GOAD installation |
| GOAD_INSTANCE_ID | d86a4c-minilab-virtualbox | GOAD workspace instance |
| SPLUNK_IP | 10.0.1.12 | SAR Splunk server IP |
| GOAD_DC01_IP | 10.0.1.30 | GOAD Domain Controller IP |
| GOAD_WS01_IP | 10.0.1.31 | GOAD Workstation IP |

## Key Notes

- Uses GOAD's own Ansible venv (`~/.goad/.venv/bin/ansible-playbook`) to avoid system dependency issues
- Targets only DC01 for forwarder installation (all AD logs centralize there)
- Forwarder sends to SAR Splunk on port 9997 (standard splunktcp)
- Collects: Windows Events, Sysmon, PowerShell, AD, DNS, DHCP logs
- All data lands in `index=win` (except DNS in `index=dns`)
