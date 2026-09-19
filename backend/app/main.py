"""SentinelFlow Pipeline — FastAPI Backend.

Exposes the core pipeline endpoints:
  POST /pipeline/trigger          — Start a new simulation→validation→report pipeline.
  GET  /pipeline/{run_id}/status  — Poll pipeline progress and results.
  POST /pipeline/{run_id}/report  — (Re)generate LOCK report for a completed run.
  GET  /pipeline/runs             — List all pipeline runs.

Supporting endpoints:
  GET  /health                    — Service health and connectivity.
  GET  /lab/ranges                — List attack range environments.
  POST /lab/ranges                — Provision a new attack range.
  DELETE /lab/ranges/{id}         — Destroy an attack range.
  POST /translate                 — Translate a Sigma rule to SPL/KQL.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.agents.lab_orchestrator import lab_orchestrator
from app.agents.reporter import report_agent
from app.agents.validation import translate_to_kql, translate_to_spl
from app.config import settings
from app.models import (
    GenerateReportRequest,
    HealthResponse,
    PipelineRun,
    PipelineStatus,
    PipelineStatusResponse,
    ReportResponse,
    TriggerSimulationRequest,
    TriggerSimulationResponse,
)
from app.pipeline.orchestrator import pipeline_orchestrator
from app.state import store

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("SentinelFlow backend starting on %s:%s", settings.backend_host, settings.backend_port)
    yield
    logger.info("SentinelFlow backend shutting down")


app = FastAPI(
    title="SentinelFlow Pipeline API",
    description=(
        "Backend orchestration engine for SentinelFlow — automates the detection "
        "engineering lifecycle from adversary simulation to SIEM validation and "
        "LOCK report generation."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ──


@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Check backend health and upstream service connectivity."""
    services = {}

    # Check SAR
    try:
        ranges = await lab_orchestrator.list_ranges()
        services["sar"] = f"connected ({len(ranges)} ranges)"
    except Exception:
        services["sar"] = "unreachable"

    # Check Splunk
    services["splunk"] = "configured" if settings.splunk_token else "not_configured"

    # Check MDE
    services["mde"] = "configured" if settings.mde_client_id else "not_configured"

    # Check GitHub
    services["github"] = "configured" if settings.github_token else "not_configured"

    return HealthResponse(
        status="ok",
        version="1.0.0",
        services=services,
    )


# ── Pipeline endpoints ──


@app.post(
    "/pipeline/trigger",
    response_model=TriggerSimulationResponse,
    status_code=202,
    tags=["Pipeline"],
)
async def trigger_simulation(
    request: TriggerSimulationRequest,
    background_tasks: BackgroundTasks,
):
    """Trigger a new simulation→validation→report pipeline.

    Accepts a list of MITRE ATT&CK techniques with optional Sigma rules.
    The pipeline runs asynchronously — poll GET /pipeline/{run_id}/status
    to track progress.
    """
    run_id = f"run-{uuid.uuid4().hex[:12]}"

    pipeline_run = PipelineRun(
        run_id=run_id,
        status=PipelineStatus.QUEUED,
        request=request,
        attack_range_id=request.attack_range_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    store.create(pipeline_run)

    # Launch pipeline as background task
    background_tasks.add_task(pipeline_orchestrator.run, run_id)

    logger.info(
        "Pipeline triggered: run_id=%s, techniques=%d, siem=%s",
        run_id,
        len(request.techniques),
        request.siem_targets.value,
    )

    return TriggerSimulationResponse(
        run_id=run_id,
        status=PipelineStatus.QUEUED,
        message=f"Pipeline queued with {len(request.techniques)} technique(s)",
        techniques_count=len(request.techniques),
    )


@app.get(
    "/pipeline/{run_id}/status",
    response_model=PipelineStatusResponse,
    tags=["Pipeline"],
)
async def check_status(run_id: str):
    """Check the current status and results of a pipeline run."""
    pipeline = store.get(run_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline run {run_id} not found")

    # Compute progress summary
    total_techniques = len(pipeline.request.techniques)
    progress = {
        "techniques_total": total_techniques,
        "simulations_done": sum(
            1 for s in pipeline.simulations if s.status.value not in ("pending", "running")
        ),
        "validations_done": sum(
            1 for v in pipeline.validations if v.verdict.value != "pending"
        ),
        "scores_done": len(pipeline.scores),
    }

    return PipelineStatusResponse(
        run_id=pipeline.run_id,
        status=pipeline.status,
        attack_range_id=pipeline.attack_range_id,
        progress=progress,
        simulations=pipeline.simulations,
        validations=pipeline.validations,
        scores=pipeline.scores,
        report=pipeline.report,
        created_at=pipeline.created_at,
        updated_at=pipeline.updated_at,
        completed_at=pipeline.completed_at,
        error=pipeline.error,
    )


@app.post(
    "/pipeline/{run_id}/report",
    response_model=ReportResponse,
    tags=["Pipeline"],
)
async def generate_report(run_id: str, body: Optional[GenerateReportRequest] = None):
    """(Re)generate LOCK report for a completed pipeline run.

    Useful for regenerating reports or for runs where auto_report was disabled.
    """
    pipeline = store.get(run_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline run {run_id} not found")

    if pipeline.status not in (PipelineStatus.COMPLETED, PipelineStatus.FAILED):
        if pipeline.status != PipelineStatus.SCORING:
            raise HTTPException(
                status_code=409,
                detail=f"Pipeline is still {pipeline.status.value}. Wait for scoring to complete.",
            )

    report = await report_agent.generate_and_publish(pipeline)
    store.update(run_id, report=report)

    return ReportResponse(run_id=run_id, report=report)


@app.get("/pipeline/runs", tags=["Pipeline"])
async def list_runs(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """List all pipeline runs, optionally filtered by status."""
    runs = store.list_all()
    if status:
        runs = [r for r in runs if r.status.value == status]
    # Sort by created_at descending
    runs.sort(key=lambda r: r.created_at, reverse=True)
    return {
        "total": len(runs),
        "runs": [
            {
                "run_id": r.run_id,
                "status": r.status.value,
                "techniques_count": len(r.request.techniques),
                "created_at": r.created_at.isoformat(),
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "error": r.error,
            }
            for r in runs[offset : offset + limit]
        ],
    }


# ── Lab management endpoints ──


@app.get("/lab/ranges", tags=["Lab"])
async def list_ranges():
    """List all Splunk Attack Range environments."""
    try:
        ranges = await lab_orchestrator.list_ranges()
        return {"ranges": ranges}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SAR API error: {e}")


@app.post("/lab/ranges", status_code=201, tags=["Lab"])
async def provision_range(
    provider: str = "local",
    config: Optional[dict] = None,
):
    """Provision a new Splunk Attack Range environment."""
    try:
        from app.clients.sar import sar_client

        result = await sar_client.create_range(provider=provider, config=config)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SAR provisioning failed: {e}")


@app.delete("/lab/ranges/{attack_range_id}", tags=["Lab"])
async def destroy_range(attack_range_id: str):
    """Destroy a Splunk Attack Range environment."""
    try:
        result = await lab_orchestrator.destroy(attack_range_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SAR destroy failed: {e}")


# ── Utility endpoints ──


@app.post("/translate", tags=["Utility"])
async def translate_sigma(
    sigma_yaml: str,
    target: str = "splunk",
):
    """Translate a Sigma YAML rule to SPL or KQL.

    Useful for debugging rule translation before running the full pipeline.
    """
    try:
        if target == "splunk":
            queries = translate_to_spl(rule_content=sigma_yaml)
        elif target in ("mde", "kql"):
            queries = translate_to_kql(rule_content=sigma_yaml)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown target: {target}")

        return {"target": target, "queries": queries, "count": len(queries)}
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Translation failed: {e}")


# ── Entrypoint ──

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=True,
        log_level=settings.log_level,
    )
