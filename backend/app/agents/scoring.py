"""Scoring Agent — Detection Reliability Metric (Rd) calculation.

Computes Rd for every technique based on simulation and validation results:

    Rd = P(Data) x P(Logic) x P(Ingest)

Where:
  P(Data)   = 1.0 if raw telemetry was found, 0.0 if not.
  P(Logic)  = 1.0 if detection query matched, 0.0 if not.
  P(Ingest) = 1.0 if data pipeline delivered logs, 0.0 if not.

Failure classification:
  - no_telemetry: P(Ingest) = 0 → data never reached SIEM.
  - not_triggered: P(Data) = 1, P(Ingest) = 1, P(Logic) = 0 → rule logic issue.
  - none: All pass → detection validated.
"""

from __future__ import annotations

import logging

from app.models import (
    ReliabilityScore,
    SimulationResult,
    SimulationStatus,
    ValidationResult,
    ValidationVerdict,
)

logger = logging.getLogger(__name__)


class ScoringAgent:
    """Calculates Detection Reliability Metric (Rd) for each technique."""

    def score_technique(
        self,
        technique_id: str,
        simulation: SimulationResult,
        validations: list[ValidationResult],
    ) -> ReliabilityScore:
        """Compute Rd for a single technique across all SIEM validations.

        When multiple SIEMs are tested, P(Data)/P(Logic)/P(Ingest) are the
        max across all SIEMs (best-case scenario per dimension).

        Args:
            technique_id: MITRE ATT&CK technique ID.
            simulation: Simulation result for this technique.
            validations: Validation results (one per SIEM target).

        Returns:
            ReliabilityScore with Rd and failure classification.
        """
        score = ReliabilityScore(technique_id=technique_id)

        # If simulation failed, Rd = 0 — cannot assess detection
        if simulation.status != SimulationStatus.SUCCESS:
            score.failure_class = "simulation_failed"
            return score

        if not validations:
            score.failure_class = "no_validation"
            return score

        # Compute per-SIEM factors, take best across SIEMs
        best_p_data = 0.0
        best_p_logic = 0.0
        best_p_ingest = 0.0
        failure_classes: set[str] = set()

        for v in validations:
            if v.verdict == ValidationVerdict.VALIDATED:
                best_p_data = 1.0
                best_p_logic = 1.0
                best_p_ingest = 1.0
            elif v.verdict == ValidationVerdict.NOT_TRIGGERED:
                # Raw telemetry present, detection logic didn't fire
                best_p_data = max(best_p_data, 1.0)
                best_p_ingest = max(best_p_ingest, 1.0)
                # P(Logic) stays 0 for this SIEM
                failure_classes.add("not_triggered")
            elif v.verdict == ValidationVerdict.NO_TELEMETRY:
                # No raw logs at all — pipeline failure
                failure_classes.add("no_telemetry")
            elif v.verdict == ValidationVerdict.ERROR:
                failure_classes.add("error")

        score.p_data = best_p_data
        score.p_logic = best_p_logic
        score.p_ingest = best_p_ingest
        score.rd = score.p_data * score.p_logic * score.p_ingest

        # Determine primary failure class
        if score.rd == 1.0:
            score.failure_class = None  # No failure
        elif "no_telemetry" in failure_classes:
            score.failure_class = "no_telemetry"
        elif "not_triggered" in failure_classes:
            score.failure_class = "not_triggered"
        elif "error" in failure_classes:
            score.failure_class = "error"
        else:
            score.failure_class = "unknown"

        logger.info(
            "Rd(%s) = %.2f [P(D)=%.1f, P(L)=%.1f, P(I)=%.1f] — %s",
            technique_id,
            score.rd,
            score.p_data,
            score.p_logic,
            score.p_ingest,
            score.failure_class or "validated",
        )
        return score

    def score_batch(
        self,
        simulations: list[SimulationResult],
        validations: list[ValidationResult],
    ) -> list[ReliabilityScore]:
        """Compute Rd scores for a batch of techniques.

        Args:
            simulations: All simulation results.
            validations: All validation results.

        Returns:
            List of ReliabilityScore, one per unique technique.
        """
        sim_by_id = {s.technique_id: s for s in simulations}
        val_by_id: dict[str, list[ValidationResult]] = {}
        for v in validations:
            val_by_id.setdefault(v.technique_id, []).append(v)

        scores = []
        for tid, sim in sim_by_id.items():
            technique_vals = val_by_id.get(tid, [])
            score = self.score_technique(tid, sim, technique_vals)
            scores.append(score)

        # Summary stats
        total = len(scores)
        validated = sum(1 for s in scores if s.rd == 1.0)
        avg_rd = sum(s.rd for s in scores) / total if total else 0
        logger.info(
            "Batch scoring complete: %d/%d validated, avg Rd=%.2f",
            validated, total, avg_rd,
        )
        return scores


scoring_agent = ScoringAgent()
