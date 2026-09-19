"""Pydantic models for SentinelFlow pipeline requests, responses, and state."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Enums ──


class PipelineStatus(str, Enum):
    QUEUED = "queued"
    PROVISIONING = "provisioning"
    SIMULATING = "simulating"
    VALIDATING = "validating"
    SCORING = "scoring"
    REPORTING = "reporting"
    COMPLETED = "completed"
    FAILED = "failed"


class SimulationStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILURE = "failure"
    TIMEOUT = "timeout"


class ValidationVerdict(str, Enum):
    VALIDATED = "validated"
    NO_TELEMETRY = "no_telemetry"
    NOT_TRIGGERED = "not_triggered"
    PENDING = "pending"
    ERROR = "error"


class SIEMTarget(str, Enum):
    SPLUNK = "splunk"
    MDE = "mde"
    BOTH = "both"


class LabProvider(str, Enum):
    LOCAL = "local"
    AWS = "aws"
    AZURE = "azure"
    GCP = "gcp"


# ── Request models ──


class TechniqueInput(BaseModel):
    """A single technique to simulate and validate."""

    technique_id: str = Field(..., description="MITRE ATT&CK technique ID, e.g. T1059.001")
    sigma_rule_path: Optional[str] = Field(None, description="Path to Sigma YAML rule file for this technique")
    sigma_rule_content: Optional[str] = Field(None, description="Inline Sigma YAML rule content")


class TriggerSimulationRequest(BaseModel):
    """Request body for POST /pipeline/trigger."""

    techniques: list[TechniqueInput] = Field(..., min_length=1)
    attack_range_id: Optional[str] = Field(None, description="Existing SAR environment ID. If omitted, auto-provision.")
    target_server: str = Field("ar-win-dc-default-pc-1", description="Target hostname within the attack range")
    siem_targets: SIEMTarget = Field(SIEMTarget.SPLUNK, description="Which SIEM(s) to validate against")
    lab_provider: LabProvider = Field(LabProvider.LOCAL, description="Infrastructure provider for new ranges")
    auto_report: bool = Field(True, description="Auto-generate LOCK report and open Draft PR on completion")
    detection_window_minutes: Optional[int] = Field(None, description="Override default detection window")


class GenerateReportRequest(BaseModel):
    """Request body for POST /pipeline/{run_id}/report."""

    pipeline_run_id: str
    force_regenerate: bool = Field(False)


# ── Result / state models ──


class SimulationResult(BaseModel):
    """Result for a single technique simulation."""

    technique_id: str
    status: SimulationStatus = SimulationStatus.PENDING
    art_output: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error: Optional[str] = None


class ValidationResult(BaseModel):
    """Validation result for a single technique against a SIEM."""

    technique_id: str
    siem: str
    translated_query: Optional[str] = None
    result_count: int = 0
    raw_log_count: int = 0
    verdict: ValidationVerdict = ValidationVerdict.PENDING
    query_time_seconds: Optional[float] = None
    error: Optional[str] = None


class ReliabilityScore(BaseModel):
    """Detection Reliability Metric (Rd) for a single technique."""

    technique_id: str
    p_data: float = Field(0.0, description="P(Data) — probability telemetry was ingested")
    p_logic: float = Field(0.0, description="P(Logic) — probability detection logic matched")
    p_ingest: float = Field(0.0, description="P(Ingest) — probability data pipeline delivered")
    rd: float = Field(0.0, description="Rd = P(Data) * P(Logic) * P(Ingest)")
    failure_class: Optional[str] = Field(None, description="no_telemetry | not_triggered | none")


class ReportResult(BaseModel):
    """Result of LOCK report generation and GitHub PR."""

    lock_markdown: Optional[str] = None
    branch_name: Optional[str] = None
    pr_url: Optional[str] = None
    pr_number: Optional[int] = None
    error: Optional[str] = None


class PipelineRun(BaseModel):
    """Full state of a pipeline run."""

    run_id: str
    status: PipelineStatus = PipelineStatus.QUEUED
    request: TriggerSimulationRequest
    attack_range_id: Optional[str] = None
    simulations: list[SimulationResult] = []
    validations: list[ValidationResult] = []
    scores: list[ReliabilityScore] = []
    report: Optional[ReportResult] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    error: Optional[str] = None


# ── Response models ──


class TriggerSimulationResponse(BaseModel):
    """Response for POST /pipeline/trigger."""

    run_id: str
    status: PipelineStatus
    message: str
    techniques_count: int


class PipelineStatusResponse(BaseModel):
    """Response for GET /pipeline/{run_id}/status."""

    run_id: str
    status: PipelineStatus
    attack_range_id: Optional[str] = None
    progress: dict[str, int] = Field(default_factory=dict)
    simulations: list[SimulationResult] = []
    validations: list[ValidationResult] = []
    scores: list[ReliabilityScore] = []
    report: Optional[ReportResult] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    error: Optional[str] = None


class ReportResponse(BaseModel):
    """Response for POST /pipeline/{run_id}/report."""

    run_id: str
    report: ReportResult


class HealthResponse(BaseModel):
    """Response for GET /health."""

    status: str
    version: str
    services: dict[str, str]
