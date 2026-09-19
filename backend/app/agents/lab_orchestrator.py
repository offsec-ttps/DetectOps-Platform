"""Lab Environment Orchestration Agent.

Manages Splunk Attack Range (SAR) environments:
  - Provisions new ranges via SAR REST API (Docker local or cloud IaC).
  - Polls until the environment is ready.
  - Ensures MDE is installed and log forwarding is active on Windows targets.
  - Provides the attack_range_id for downstream simulation.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from app.clients.sar import sar_client
from app.config import settings

logger = logging.getLogger(__name__)


class LabOrchestrator:
    """Provisions and manages SAR lab environments."""

    async def ensure_range_ready(
        self,
        attack_range_id: Optional[str] = None,
        provider: str = "local",
        config: Optional[dict] = None,
        poll_interval: float = 15.0,
        timeout: float = 600.0,
    ) -> str:
        """Ensure an attack range is ready for simulation.

        If attack_range_id is provided, checks its status and waits until ready.
        If None, provisions a new range and waits.

        Args:
            attack_range_id: Existing range ID, or None to create a new one.
            provider: "local" (Docker), "aws", "azure", "gcp".
            config: Optional SAR config overrides.
            poll_interval: Seconds between status polls.
            timeout: Max seconds to wait for readiness.

        Returns:
            The attack_range_id of the ready environment.

        Raises:
            TimeoutError: If the range doesn't become ready within timeout.
            RuntimeError: If the range enters an error state.
        """
        if attack_range_id is None:
            result = await sar_client.create_range(provider=provider, config=config)
            attack_range_id = result["attack_range_id"]
            logger.info("Provisioned new range: %s", attack_range_id)

        # Poll until ready
        elapsed = 0.0
        while elapsed < timeout:
            status = await sar_client.get_status(attack_range_id)
            state = status.get("status", "unknown")

            if state == "ready":
                logger.info("Range %s is ready", attack_range_id)
                return attack_range_id
            elif state in ("error", "failed", "destroyed"):
                raise RuntimeError(
                    f"Attack range {attack_range_id} entered state: {state}. "
                    f"Details: {status.get('error', 'unknown')}"
                )

            logger.debug(
                "Range %s status: %s (elapsed %.0fs)", attack_range_id, state, elapsed
            )
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(
            f"Attack range {attack_range_id} did not become ready within {timeout}s"
        )

    async def verify_mde_enrollment(self, attack_range_id: str) -> dict:
        """Verify MDE is installed and reporting on Windows targets.

        Checks the range status for MDE enrollment indicators.

        Returns:
            {"enrolled": bool, "targets": [...], "forwarding_active": bool}
        """
        status = await sar_client.get_status(attack_range_id)
        targets = status.get("targets", [])
        enrolled_targets = []

        for target in targets:
            if target.get("os", "").lower().startswith("windows"):
                mde_status = target.get("mde_status", "unknown")
                if mde_status in ("active", "enrolled"):
                    enrolled_targets.append(target)

        forwarding = status.get("log_forwarding", {})
        return {
            "enrolled": len(enrolled_targets) > 0,
            "targets": enrolled_targets,
            "forwarding_active": forwarding.get("splunk", False),
            "forwarding_details": forwarding,
        }

    async def destroy(self, attack_range_id: str) -> dict:
        """Tear down an attack range environment."""
        return await sar_client.destroy_range(attack_range_id)

    async def list_ranges(self) -> list[dict]:
        """List all available attack ranges."""
        return await sar_client.list_ranges()


lab_orchestrator = LabOrchestrator()
