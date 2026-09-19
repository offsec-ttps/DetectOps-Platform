"""Splunk Attack Range (SAR) REST API client.

SAR v5.0+ exposes a REST API on port 4000 for managing attack range
environments and triggering Atomic Red Team simulations.

Endpoints used:
  POST /attack-range/create        — provision a new range
  GET  /attack-range/status/<id>   — poll environment / simulation status
  POST /attack-range/simulate      — trigger ART simulation
  POST /attack-range/destroy       — tear down a range
  GET  /attack-range/list          — list all ranges
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class SARClient:
    """Async HTTP client for the Splunk Attack Range REST API."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 60.0,
    ) -> None:
        self.base_url = (base_url or settings.sar_api_url).rstrip("/")
        self.api_key = api_key or settings.sar_api_key
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        json: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.request(
                method, url, headers=self._headers(), json=json, params=params
            )
            resp.raise_for_status()
            return resp.json()

    # ── Environment lifecycle ──

    async def create_range(
        self,
        provider: str = "local",
        config: Optional[dict] = None,
    ) -> dict[str, Any]:
        """Provision a new attack range environment.

        Args:
            provider: "local" (Docker), "aws", "azure", or "gcp".
            config: Optional SAR configuration overrides (template, region, etc.).

        Returns:
            {"attack_range_id": "...", "status": "creating", ...}
        """
        payload: dict[str, Any] = {"provider": provider}
        if config:
            payload["config"] = config
        logger.info("Creating attack range: provider=%s", provider)
        return await self._request("POST", "/attack-range/create", json=payload)

    async def get_status(self, attack_range_id: str) -> dict[str, Any]:
        """Poll the status of an attack range or running simulation.

        Returns:
            {"attack_range_id": "...", "status": "running"|"ready"|"simulating"|..., ...}
        """
        return await self._request("GET", f"/attack-range/status/{attack_range_id}")

    async def destroy_range(self, attack_range_id: str) -> dict[str, Any]:
        """Tear down an attack range environment."""
        logger.info("Destroying attack range: %s", attack_range_id)
        return await self._request(
            "POST", "/attack-range/destroy", json={"attack_range_id": attack_range_id}
        )

    async def list_ranges(self) -> list[dict[str, Any]]:
        """List all attack range environments."""
        result = await self._request("GET", "/attack-range/list")
        return result.get("ranges", [])

    # ── Simulation ──

    async def trigger_simulation(
        self,
        attack_range_id: str,
        target: str,
        techniques: list[str],
    ) -> dict[str, Any]:
        """Trigger Atomic Red Team simulation on a target within the range.

        Args:
            attack_range_id: ID of the provisioned attack range.
            target: Target server hostname (e.g. "ar-win-dc-default-pc-1").
            techniques: List of MITRE ATT&CK technique IDs.

        Returns:
            {"simulation_id": "...", "status": "running", ...}
        """
        payload = {
            "attack_range_id": attack_range_id,
            "target": target,
            "simulation_techniques": ",".join(techniques),
        }
        logger.info(
            "Triggering simulation: range=%s, target=%s, techniques=%s",
            attack_range_id,
            target,
            techniques,
        )
        return await self._request("POST", "/attack-range/simulate", json=payload)


sar_client = SARClient()
