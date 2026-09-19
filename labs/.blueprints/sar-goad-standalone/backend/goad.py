"""GOAD (Game of Active Directory) management client.

Manages GOAD lab instances via the local filesystem and shell commands.
Unlike SAR which has a REST API, GOAD is controlled through its CLI
and Ansible playbooks, so this client wraps subprocess calls.

Supports:
  - Instance lifecycle (start, stop, status, destroy)
  - Splunk Forwarder extension installation
  - VM state inspection via VBoxManage
  - Connectivity verification
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class GOADInstance:
    """Represents a GOAD lab instance."""
    id: str
    lab: str
    provider: str
    provisioner: str
    ip_range: str
    status: str
    extensions: list[str] = field(default_factory=list)
    is_default: bool = False


@dataclass
class VMStatus:
    """Status of an individual VirtualBox VM."""
    name: str
    state: str  # running, poweroff, aborted, saved, unknown
    ip: str
    reachable: bool = False


class GOADClient:
    """Client for managing GOAD Active Directory lab environments."""

    def __init__(
        self,
        goad_path: Optional[str] = None,
        instance_id: Optional[str] = None,
        splunk_ip: Optional[str] = None,
    ) -> None:
        self.goad_path = Path(goad_path or settings.goad_path)
        self.instance_id = instance_id or settings.goad_instance_id
        self.splunk_ip = splunk_ip or settings.goad_splunk_ip
        self.workspace_path = self.goad_path / "workspace"
        self.extensions_path = self.goad_path / "extensions"

    # ── Instance Management ──

    def get_instance_dir(self, instance_id: Optional[str] = None) -> Path:
        iid = instance_id or self.instance_id
        return self.workspace_path / iid

    def load_instance(self, instance_id: Optional[str] = None) -> Optional[GOADInstance]:
        """Load instance metadata from workspace."""
        instance_dir = self.get_instance_dir(instance_id)
        instance_file = instance_dir / "instance.json"

        if not instance_file.exists():
            logger.warning("Instance file not found: %s", instance_file)
            return None

        with open(instance_file) as f:
            data = json.load(f)

        return GOADInstance(
            id=data["id"],
            lab=data["lab"],
            provider=data["provider"],
            provisioner=data["provisioner"],
            ip_range=data["ip_range"],
            status=data.get("status", "unknown"),
            extensions=data.get("extensions", []),
            is_default=data.get("is_default", False),
        )

    def list_instances(self) -> list[GOADInstance]:
        """List all GOAD instances in workspace."""
        instances = []
        if not self.workspace_path.exists():
            return instances

        for entry in self.workspace_path.iterdir():
            if entry.is_dir() and (entry / "instance.json").exists():
                inst = self.load_instance(entry.name)
                if inst:
                    instances.append(inst)
        return instances

    # ── VM Control ──

    async def _run_cmd(self, cmd: list[str], timeout: int = 60) -> tuple[int, str, str]:
        """Run a shell command asynchronously."""
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            return (
                proc.returncode or 0,
                stdout.decode().strip(),
                stderr.decode().strip(),
            )
        except asyncio.TimeoutError:
            logger.error("Command timed out: %s", " ".join(cmd))
            return 1, "", "timeout"
        except Exception as e:
            logger.error("Command failed: %s — %s", " ".join(cmd), e)
            return 1, "", str(e)

    async def get_vm_state(self, vm_name: str) -> str:
        """Get VirtualBox VM state."""
        rc, stdout, _ = await self._run_cmd(
            ["VBoxManage", "showvminfo", vm_name, "--machinereadable"]
        )
        if rc != 0:
            return "not_found"

        for line in stdout.splitlines():
            if line.startswith("VMState="):
                return line.split('"')[1]
        return "unknown"

    async def start_vm(self, vm_name: str, gui: bool = False) -> bool:
        """Start a VirtualBox VM."""
        vm_type = "gui" if gui else "headless"
        state = await self.get_vm_state(vm_name)

        if state == "running":
            logger.info("VM %s is already running", vm_name)
            return True

        if state == "not_found":
            logger.error("VM %s not found", vm_name)
            return False

        logger.info("Starting VM %s (%s mode)", vm_name, vm_type)
        rc, _, stderr = await self._run_cmd(
            ["VBoxManage", "startvm", vm_name, "--type", vm_type]
        )
        if rc != 0:
            logger.error("Failed to start %s: %s", vm_name, stderr)
            return False
        return True

    async def stop_vm(self, vm_name: str) -> bool:
        """Stop a VirtualBox VM gracefully."""
        state = await self.get_vm_state(vm_name)
        if state != "running":
            return True

        logger.info("Stopping VM %s", vm_name)
        rc, _, _ = await self._run_cmd(
            ["VBoxManage", "controlvm", vm_name, "acpipowerbutton"]
        )
        return rc == 0

    async def get_lab_vms(self) -> list[str]:
        """Get VM names for the current GOAD instance."""
        instance = self.load_instance()
        if not instance:
            return []

        # MINILAB uses DC01 and WS01
        lab_vms = {
            "MINILAB": ["DC01", "WS01"],
            "GOAD": ["DC01", "DC02", "DC03", "SRV02", "SRV03"],
            "GOAD-Light": ["DC01", "DC02", "SRV02"],
        }
        return lab_vms.get(instance.lab, ["DC01", "WS01"])

    # ── Lab Lifecycle ──

    async def start_lab(self, gui: bool = False) -> dict[str, Any]:
        """Start all VMs in the GOAD lab."""
        vms = await self.get_lab_vms()
        results = {}

        for vm in vms:
            ok = await self.start_vm(vm, gui=gui)
            results[vm] = "started" if ok else "failed"

        return {"instance_id": self.instance_id, "vms": results}

    async def stop_lab(self) -> dict[str, Any]:
        """Stop all VMs in the GOAD lab."""
        vms = await self.get_lab_vms()
        results = {}

        for vm in vms:
            ok = await self.stop_vm(vm)
            results[vm] = "stopped" if ok else "failed"

        return {"instance_id": self.instance_id, "vms": results}

    async def get_status(self) -> dict[str, Any]:
        """Get comprehensive status of the GOAD lab."""
        instance = self.load_instance()
        if not instance:
            return {"error": "Instance not found", "instance_id": self.instance_id}

        vms = await self.get_lab_vms()
        vm_statuses = []

        ip_map = self._get_ip_map(instance)

        for vm in vms:
            state = await self.get_vm_state(vm)
            ip = ip_map.get(vm, "unknown")
            reachable = await self._ping(ip) if state == "running" else False

            vm_statuses.append(VMStatus(
                name=vm, state=state, ip=ip, reachable=reachable
            ))

        return {
            "instance_id": instance.id,
            "lab": instance.lab,
            "provider": instance.provider,
            "ip_range": instance.ip_range,
            "status": instance.status,
            "extensions": instance.extensions,
            "vms": [
                {"name": v.name, "state": v.state, "ip": v.ip, "reachable": v.reachable}
                for v in vm_statuses
            ],
            "splunk_forwarder_installed": "splunk_forwarder" in instance.extensions,
        }

    def _get_ip_map(self, instance: GOADInstance) -> dict[str, str]:
        """Build VM name -> IP mapping from instance config."""
        ip_range = instance.ip_range
        # Standard MINILAB IP assignments from Vagrantfile template
        ip_maps = {
            "MINILAB": {"DC01": f"{ip_range}.30", "WS01": f"{ip_range}.31"},
            "GOAD": {
                "DC01": f"{ip_range}.10", "DC02": f"{ip_range}.11",
                "DC03": f"{ip_range}.12", "SRV02": f"{ip_range}.22",
                "SRV03": f"{ip_range}.23",
            },
        }
        return ip_maps.get(instance.lab, {})

    async def _ping(self, ip: str, timeout: int = 3) -> bool:
        """Check if a host is reachable."""
        rc, _, _ = await self._run_cmd(
            ["ping", "-c", "1", "-W", str(timeout), ip], timeout=timeout + 2
        )
        return rc == 0

    # ── Splunk Forwarder Extension ──

    async def install_splunk_forwarder(
        self,
        splunk_ip: Optional[str] = None,
        splunk_port: str = "9997",
        splunk_mgmt_port: str = "8089",
        splunk_password: str = "I-l1ke-Attack-Range!",
    ) -> dict[str, Any]:
        """Install the Splunk Forwarder extension on all GOAD Windows machines.

        This runs the Ansible playbook from the splunk_forwarder extension
        against the GOAD inventory.
        """
        target_splunk_ip = splunk_ip or self.splunk_ip
        instance = self.load_instance()
        if not instance:
            return {"success": False, "error": "Instance not found"}

        instance_dir = self.get_instance_dir()
        inventory = instance_dir / "inventory_disable_vagrant"
        extension_playbook = self.extensions_path / "splunk_forwarder" / "ansible" / "install.yml"

        if not inventory.exists():
            return {"success": False, "error": f"Inventory not found: {inventory}"}
        if not extension_playbook.exists():
            return {"success": False, "error": "Splunk forwarder extension not installed in GOAD"}

        # Build merged inventory with extension groups
        merged_inv = instance_dir / "inventory_splunk_forwarder"
        with open(inventory) as f:
            inv_content = f.read()
        inv_content += "\n; Splunk Forwarder Extension targets (DC only)\n"
        inv_content += "[splunk_forwarder_targets]\ndc01\n"
        with open(merged_inv, "w") as f:
            f.write(inv_content)

        logger.info(
            "Installing Splunk Forwarder: splunk=%s:%s, instance=%s",
            target_splunk_ip, splunk_port, instance.id,
        )

        # Use GOAD's venv ansible (system ansible has broken markupsafe/jinja2)
        goad_ansible = os.path.expanduser("~/.goad/.venv/bin/ansible-playbook")
        ansible_bin = goad_ansible if os.path.isfile(goad_ansible) else "ansible-playbook"

        cmd = [
            ansible_bin,
            "-i", str(merged_inv),
            str(extension_playbook),
            "--extra-vars",
            f"splunk_server_ip={target_splunk_ip} "
            f"splunk_server_port={splunk_port} "
            f"splunk_server_mgmt_port={splunk_mgmt_port} "
            f"splunk_uf_password={splunk_password} "
            f"sysmon_download_url=https://download.sysinternals.com/files/Sysmon.zip",
            "-v",
        ]

        env = os.environ.copy()
        env["ANSIBLE_HOST_KEY_CHECKING"] = "False"

        rc, stdout, stderr = await self._run_cmd(cmd, timeout=600)

        # Update instance extensions list
        if rc == 0 and "splunk_forwarder" not in instance.extensions:
            instance_file = instance_dir / "instance.json"
            with open(instance_file) as f:
                data = json.load(f)
            data.setdefault("extensions", []).append("splunk_forwarder")
            with open(instance_file, "w") as f:
                json.dump(data, f, indent=4)

        # Cleanup temp inventory
        merged_inv.unlink(missing_ok=True)

        return {
            "success": rc == 0,
            "exit_code": rc,
            "stdout_tail": stdout[-2000:] if stdout else "",
            "stderr_tail": stderr[-2000:] if stderr else "",
        }

    async def verify_log_flow(self, splunk_ip: Optional[str] = None) -> dict[str, Any]:
        """Check if GOAD logs are appearing in SAR Splunk."""
        target_splunk_ip = splunk_ip or self.splunk_ip
        instance = self.load_instance()
        if not instance:
            return {"success": False, "error": "Instance not found"}

        # Check Splunk receiving port
        rc, _, _ = await self._run_cmd(
            ["bash", "-c", f"echo >/dev/tcp/{target_splunk_ip}/9997"],
            timeout=10,
        )
        splunk_port_open = rc == 0

        # Check VM reachability
        ip_map = self._get_ip_map(instance)
        vm_reachable = {}
        for vm, ip in ip_map.items():
            vm_reachable[vm] = await self._ping(ip)

        return {
            "splunk_ip": target_splunk_ip,
            "splunk_port_open": splunk_port_open,
            "vms_reachable": vm_reachable,
            "forwarder_installed": "splunk_forwarder" in instance.extensions,
        }


goad_client = GOADClient()
