"""Simulation Agent — Atomic Red Team batch execution via SAR.

Accepts a list of MITRE ATT&CK technique IDs, triggers ART simulations
through the SAR API, and polls until each technique completes.

Execution flow:
  1. Accept YAML/JSON technique list from pipeline request.
  2. POST /attack-range/simulate with comma-separated techniques.
  3. Poll GET /attack-range/status/<id> until simulation completes.
  4. Capture per-technique success/failure and ART stdout/stderr.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

from app.clients.sar import sar_client
from app.config import settings
from app.models import SimulationResult, SimulationStatus

logger = logging.getLogger(__name__)


class SimulationAgent:
    """Runs ART simulations against a provisioned attack range."""

    async def execute_batch(
        self,
        attack_range_id: str,
        target_server: str,
        techniques: list[str],
        poll_interval: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> list[SimulationResult]:
        """Execute a batch of ART techniques and return per-technique results.

        Args:
            attack_range_id: ID of the ready attack range.
            target_server: Target hostname within the range.
            techniques: List of MITRE ATT&CK technique IDs.
            poll_interval: Override polling interval (seconds).
            timeout: Override max wait time (seconds).

        Returns:
            List of SimulationResult, one per technique.
        """
        interval = poll_interval or settings.polling_interval_seconds
        max_wait = timeout or settings.polling_timeout_seconds

        # Initialize results
        results = [
            SimulationResult(
                technique_id=tid,
                status=SimulationStatus.PENDING,
            )
            for tid in techniques
        ]

        # Trigger the batch simulation via SAR
        try:
            sim_response = await sar_client.trigger_simulation(
                attack_range_id=attack_range_id,
                target=target_server,
                techniques=techniques,
            )
        except Exception as e:
            logger.error("Failed to trigger simulation: %s", e)
            for r in results:
                r.status = SimulationStatus.FAILURE
                r.error = f"Failed to trigger: {e}"
            return results

        simulation_id = sim_response.get("simulation_id", attack_range_id)
        logger.info(
            "Simulation triggered: id=%s, techniques=%s", simulation_id, techniques
        )

        # Mark all as running
        now = datetime.utcnow()
        for r in results:
            r.status = SimulationStatus.RUNNING
            r.started_at = now

        # Poll until completion
        elapsed = 0.0
        while elapsed < max_wait:
            try:
                status = await sar_client.get_status(simulation_id)
            except Exception as e:
                logger.warning("Poll error (will retry): %s", e)
                await asyncio.sleep(interval)
                elapsed += interval
                continue

            sim_state = status.get("status", "unknown")
            logger.debug("Simulation %s state: %s (%.0fs)", simulation_id, sim_state, elapsed)

            if sim_state in ("completed", "finished", "done"):
                # Extract per-technique results from SAR response
                self._parse_technique_results(results, status)
                return results

            if sim_state in ("error", "failed"):
                error_msg = status.get("error", "Simulation failed")
                for r in results:
                    if r.status == SimulationStatus.RUNNING:
                        r.status = SimulationStatus.FAILURE
                        r.error = error_msg
                        r.finished_at = datetime.utcnow()
                return results

            await asyncio.sleep(interval)
            elapsed += interval

        # Timeout
        for r in results:
            if r.status == SimulationStatus.RUNNING:
                r.status = SimulationStatus.TIMEOUT
                r.error = f"Timed out after {max_wait}s"
                r.finished_at = datetime.utcnow()
        return results

    def _parse_technique_results(
        self,
        results: list[SimulationResult],
        status: dict,
    ) -> None:
        """Parse SAR status response into per-technique results.

        SAR returns technique execution data in status.techniques[] or
        status.simulation_results[].
        """
        finished_at = datetime.utcnow()
        technique_data = status.get("techniques", status.get("simulation_results", []))

        # Build lookup by technique_id
        data_by_id: dict[str, dict] = {}
        for td in technique_data:
            tid = td.get("technique_id", td.get("technique", ""))
            if tid:
                data_by_id[tid] = td

        for result in results:
            if result.technique_id in data_by_id:
                td = data_by_id[result.technique_id]
                td_status = td.get("status", "unknown").lower()
                if td_status in ("success", "passed"):
                    result.status = SimulationStatus.SUCCESS
                else:
                    result.status = SimulationStatus.FAILURE
                result.art_output = td.get("output", td.get("stdout", ""))
                result.error = td.get("error", td.get("stderr", None))
            else:
                # Technique not in response — assume success if overall passed
                overall = status.get("status", "").lower()
                if overall in ("completed", "finished", "done"):
                    result.status = SimulationStatus.SUCCESS
                else:
                    result.status = SimulationStatus.FAILURE
                    result.error = "No per-technique result returned by SAR"
            result.finished_at = finished_at

    async def execute_single(
        self,
        attack_range_id: str,
        target_server: str,
        technique_id: str,
    ) -> SimulationResult:
        """Execute a single technique. Convenience wrapper."""
        results = await self.execute_batch(
            attack_range_id, target_server, [technique_id]
        )
        return results[0]


simulation_agent = SimulationAgent()
