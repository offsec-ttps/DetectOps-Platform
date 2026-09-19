"""Unified Pipeline Orchestrator — stateful flow from simulation to report.

Ties all agents into a single pipeline:

  1. Lab Orchestrator  → Ensure attack range is ready.
  2. Simulation Agent  → Execute ART techniques in batch.
  3. Validation Agent  → Verify detections in Splunk/MDE via pySigma.
  4. Scoring Agent     → Compute Rd for each technique.
  5. Report Agent      → Generate LOCK docs and open Draft PR.

The orchestrator runs as a background task, updating PipelineRun state
at each stage so the frontend can poll status via GET /pipeline/{run_id}/status.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from app.agents.lab_orchestrator import lab_orchestrator
from app.agents.reporter import report_agent
from app.agents.scoring import scoring_agent
from app.agents.simulation import simulation_agent
from app.agents.validation import validation_agent
from app.models import (
    PipelineRun,
    PipelineStatus,
    TriggerSimulationRequest,
)
from app.state import store

logger = logging.getLogger(__name__)


class PipelineOrchestrator:
    """Runs the full SentinelFlow pipeline as a background task."""

    async def run(self, run_id: str) -> None:
        """Execute the full pipeline for a given run.

        Updates the PipelineRun in the store at each stage.
        On error at any stage, marks the run as FAILED and stops.
        """
        pipeline = store.get(run_id)
        if not pipeline:
            logger.error("Pipeline run %s not found in store", run_id)
            return

        request = pipeline.request

        try:
            # ── Stage 1: Lab Orchestration ──
            await self._stage_provision(pipeline, request)

            # ── Stage 2: Simulation ──
            await self._stage_simulate(pipeline, request)

            # ── Stage 3: Validation ──
            await self._stage_validate(pipeline, request)

            # ── Stage 4: Scoring ──
            await self._stage_score(pipeline)

            # ── Stage 5: Reporting ──
            if request.auto_report:
                await self._stage_report(pipeline)

            # ── Done ──
            store.update(
                run_id,
                status=PipelineStatus.COMPLETED,
                completed_at=datetime.utcnow(),
            )
            logger.info("Pipeline %s completed successfully", run_id)

        except Exception as e:
            logger.error("Pipeline %s failed: %s", run_id, e, exc_info=True)
            store.update(
                run_id,
                status=PipelineStatus.FAILED,
                error=str(e),
                completed_at=datetime.utcnow(),
            )

    async def _stage_provision(
        self, pipeline: PipelineRun, request: TriggerSimulationRequest
    ) -> None:
        """Stage 1: Ensure the attack range is provisioned and ready."""
        store.update(pipeline.run_id, status=PipelineStatus.PROVISIONING)
        logger.info("[%s] Stage 1: Provisioning lab environment", pipeline.run_id)

        attack_range_id = await lab_orchestrator.ensure_range_ready(
            attack_range_id=request.attack_range_id,
            provider=request.lab_provider.value,
        )
        store.update(pipeline.run_id, attack_range_id=attack_range_id)
        logger.info("[%s] Lab ready: %s", pipeline.run_id, attack_range_id)

    async def _stage_simulate(
        self, pipeline: PipelineRun, request: TriggerSimulationRequest
    ) -> None:
        """Stage 2: Execute ART simulations for all techniques."""
        store.update(pipeline.run_id, status=PipelineStatus.SIMULATING)
        logger.info("[%s] Stage 2: Running simulations", pipeline.run_id)

        technique_ids = [t.technique_id for t in request.techniques]
        results = await simulation_agent.execute_batch(
            attack_range_id=pipeline.attack_range_id,
            target_server=request.target_server,
            techniques=technique_ids,
        )
        store.update(pipeline.run_id, simulations=results)
        logger.info(
            "[%s] Simulations complete: %d/%d succeeded",
            pipeline.run_id,
            sum(1 for r in results if r.status.value == "success"),
            len(results),
        )

    async def _stage_validate(
        self, pipeline: PipelineRun, request: TriggerSimulationRequest
    ) -> None:
        """Stage 3: Validate detections in target SIEMs via pySigma."""
        store.update(pipeline.run_id, status=PipelineStatus.VALIDATING)
        logger.info("[%s] Stage 3: Validating detections", pipeline.run_id)

        # Refresh pipeline state to get simulations
        pipeline = store.get(pipeline.run_id)

        techniques = [
            {
                "technique_id": t.technique_id,
                "sigma_rule_path": t.sigma_rule_path,
                "sigma_rule_content": t.sigma_rule_content,
            }
            for t in request.techniques
        ]

        results = await validation_agent.validate_batch(
            techniques=techniques,
            simulations=pipeline.simulations,
            siem_targets=request.siem_targets.value,
        )
        store.update(pipeline.run_id, validations=results)

        validated_count = sum(1 for r in results if r.verdict.value == "validated")
        logger.info(
            "[%s] Validation complete: %d/%d validated",
            pipeline.run_id,
            validated_count,
            len(results),
        )

    async def _stage_score(self, pipeline: PipelineRun) -> None:
        """Stage 4: Compute Rd scores for all techniques."""
        store.update(pipeline.run_id, status=PipelineStatus.SCORING)
        logger.info("[%s] Stage 4: Computing Rd scores", pipeline.run_id)

        # Refresh state
        pipeline = store.get(pipeline.run_id)

        scores = scoring_agent.score_batch(
            simulations=pipeline.simulations,
            validations=pipeline.validations,
        )
        store.update(pipeline.run_id, scores=scores)

        avg_rd = sum(s.rd for s in scores) / len(scores) if scores else 0
        logger.info("[%s] Scoring complete: avg Rd=%.2f", pipeline.run_id, avg_rd)

    async def _stage_report(self, pipeline: PipelineRun) -> None:
        """Stage 5: Generate LOCK reports and open GitHub Draft PR."""
        store.update(pipeline.run_id, status=PipelineStatus.REPORTING)
        logger.info("[%s] Stage 5: Generating LOCK report", pipeline.run_id)

        # Refresh state
        pipeline = store.get(pipeline.run_id)

        report = await report_agent.generate_and_publish(pipeline)
        store.update(pipeline.run_id, report=report)

        if report.pr_url:
            logger.info("[%s] Report published: %s", pipeline.run_id, report.pr_url)
        elif report.error:
            logger.warning("[%s] Report error: %s", pipeline.run_id, report.error)


pipeline_orchestrator = PipelineOrchestrator()


def launch_pipeline_background(run_id: str) -> None:
    """Launch the pipeline orchestrator as a fire-and-forget background task.

    Safe to call from a FastAPI endpoint — creates its own event loop task.
    """
    loop = asyncio.get_event_loop()
    loop.create_task(pipeline_orchestrator.run(run_id))
