"""Validation Agent — SIEM detection verification via pySigma.

Workflow per technique:
  1. Load the Sigma rule (from file path or inline content).
  2. Translate to SPL (Splunk) or KQL (MDE) using pySigma backends.
  3. Execute the translated query against the target SIEM.
  4. Check raw telemetry to distinguish "no_telemetry" from "not_triggered".
  5. Return the validation verdict.

Verdict logic:
  - Validated:      result_count > 0 within detection window.
  - No Telemetry:   Attack succeeded but 0 raw logs found (pipeline failure).
  - Not Triggered:  Raw logs found, but detection query returned 0 (logic error).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import yaml

from app.clients.mde import mde_client
from app.clients.splunk import splunk_client
from app.config import settings
from app.models import SimulationResult, SimulationStatus, ValidationResult, ValidationVerdict

logger = logging.getLogger(__name__)

# Lazy-loaded pySigma components
_sigma_backends: dict = {}


def _get_splunk_backend():
    """Lazy-load pySigma Splunk backend with Sysmon + Windows pipelines."""
    if "splunk" not in _sigma_backends:
        from sigma.backends.splunk import SplunkBackend
        from sigma.pipelines.sysmon import sysmon_pipeline
        from sigma.pipelines.windows import windows_pipeline
        from sigma.processing.pipeline import ProcessingPipeline

        combined = ProcessingPipeline()
        combined += sysmon_pipeline()
        combined += windows_pipeline()
        _sigma_backends["splunk"] = SplunkBackend(combined)
    return _sigma_backends["splunk"]


def _get_mde_backend():
    """Lazy-load pySigma Microsoft 365 Defender backend."""
    if "mde" not in _sigma_backends:
        from sigma.backends.microsoft365defender import Microsoft365DefenderBackend

        _sigma_backends["mde"] = Microsoft365DefenderBackend()
    return _sigma_backends["mde"]


def _load_sigma_rule(
    rule_path: Optional[str] = None,
    rule_content: Optional[str] = None,
):
    """Load a Sigma rule from file path or inline YAML content."""
    from sigma.collection import SigmaCollection

    if rule_content:
        return SigmaCollection.from_yaml(rule_content)
    elif rule_path:
        path = Path(rule_path)
        if not path.exists():
            raise FileNotFoundError(f"Sigma rule not found: {rule_path}")
        return SigmaCollection.from_yaml(path.read_text())
    else:
        raise ValueError("Either rule_path or rule_content must be provided")


def translate_to_spl(
    rule_path: Optional[str] = None,
    rule_content: Optional[str] = None,
) -> list[str]:
    """Translate a Sigma rule to Splunk SPL query strings."""
    backend = _get_splunk_backend()
    collection = _load_sigma_rule(rule_path, rule_content)
    return backend.convert(collection)


def translate_to_kql(
    rule_path: Optional[str] = None,
    rule_content: Optional[str] = None,
) -> list[str]:
    """Translate a Sigma rule to Microsoft Defender KQL query strings."""
    backend = _get_mde_backend()
    collection = _load_sigma_rule(rule_path, rule_content)
    return backend.convert(collection)


# Map technique IDs to telemetry search keywords for raw log verification
TECHNIQUE_KEYWORDS: dict[str, list[str]] = {
    "T1059.001": ["powershell.exe", "PowerShell"],
    "T1003.001": ["lsass.exe", "procdump", "mimikatz"],
    "T1053.005": ["schtasks.exe", "ScheduledTask"],
    "T1547.001": ["CurrentVersion\\Run", "reg.exe"],
    "T1071.004": ["dns", "nslookup", "TXT"],
    "T1021.002": ["net use", "IPC$", "ADMIN$"],
    "T1105": ["certutil", "bitsadmin", "wget"],
    "T1047": ["wmic", "WMI"],
    "T1543.003": ["sc.exe", "New-Service"],
    "T1204.002": ["winword.exe", "excel.exe", "macro"],
    "T1068": ["exploit", "privilege"],
    "T1486": ["encrypt", "ransom"],
    "T1082": ["systeminfo", "hostname", "whoami"],
    "T1083": ["dir ", "Get-ChildItem", "ls "],
    "T1119": ["collect", "archive"],
    "T1560.001": ["rar.exe", "7z.exe", "zip"],
    "T1567.002": ["upload", "cloud", "OneDrive"],
    "T1546.003": ["WMI", "EventSubscription"],
    "T1566.001": ["phish", "attachment"],
    "T1048.003": ["ftp", "http", "exfil"],
    "T1570": ["copy", "lateral"],
    "T1021.001": ["mstsc", "rdp", "3389"],
    "T1021.006": ["winrm", "5985", "5986"],
}


class ValidationAgent:
    """Validates detection rules against SIEM data post-simulation."""

    async def validate_technique(
        self,
        technique_id: str,
        siem: str,
        simulation_result: SimulationResult,
        sigma_rule_path: Optional[str] = None,
        sigma_rule_content: Optional[str] = None,
        detection_window_minutes: Optional[int] = None,
    ) -> ValidationResult:
        """Validate a single technique against a SIEM.

        Args:
            technique_id: MITRE ATT&CK technique ID.
            siem: "splunk" or "mde".
            simulation_result: Result from the simulation agent.
            sigma_rule_path: Path to Sigma YAML rule.
            sigma_rule_content: Inline Sigma rule YAML.
            detection_window_minutes: Override detection time window.

        Returns:
            ValidationResult with verdict and query details.
        """
        window = detection_window_minutes or settings.detection_window_minutes
        result = ValidationResult(technique_id=technique_id, siem=siem)

        # Skip if simulation failed
        if simulation_result.status != SimulationStatus.SUCCESS:
            result.verdict = ValidationVerdict.ERROR
            result.error = f"Simulation did not succeed: {simulation_result.status}"
            return result

        # Step 1: Translate Sigma rule to target SIEM query
        try:
            if siem == "splunk":
                queries = translate_to_spl(sigma_rule_path, sigma_rule_content)
            elif siem == "mde":
                queries = translate_to_kql(sigma_rule_path, sigma_rule_content)
            else:
                result.verdict = ValidationVerdict.ERROR
                result.error = f"Unknown SIEM target: {siem}"
                return result

            if not queries:
                result.verdict = ValidationVerdict.ERROR
                result.error = "pySigma returned no queries for this rule"
                return result

            result.translated_query = queries[0]
            logger.info(
                "Translated %s for %s: %s",
                technique_id, siem, result.translated_query[:100]
            )
        except Exception as e:
            result.verdict = ValidationVerdict.ERROR
            result.error = f"Translation failed: {e}"
            return result

        # Step 2: Execute detection query
        try:
            if siem == "splunk":
                search_result = await splunk_client.search_and_wait(
                    result.translated_query,
                    earliest_time=f"-{window}m",
                    latest_time="now",
                )
                result.result_count = search_result["result_count"]
                result.query_time_seconds = search_result["run_duration"]
            elif siem == "mde":
                query_with_time = (
                    result.translated_query.rstrip()
                    + f"\n| where Timestamp > ago({window}m)"
                )
                hunt_result = await mde_client.run_hunting_query(query_with_time)
                result.result_count = hunt_result["result_count"]
        except Exception as e:
            result.verdict = ValidationVerdict.ERROR
            result.error = f"Query execution failed: {e}"
            return result

        # Step 3: If detection query returned results → Validated
        if result.result_count > 0:
            result.verdict = ValidationVerdict.VALIDATED
            return result

        # Step 4: Check raw telemetry to classify failure
        try:
            keywords = TECHNIQUE_KEYWORDS.get(
                technique_id,
                TECHNIQUE_KEYWORDS.get(technique_id.split(".")[0], [technique_id])
            )

            if siem == "splunk":
                result.raw_log_count = await splunk_client.check_raw_telemetry(
                    index="sysmon",
                    technique_keywords=keywords,
                    earliest_time=f"-{window}m",
                )
            elif siem == "mde":
                result.raw_log_count = await mde_client.check_raw_telemetry(
                    table="DeviceProcessEvents",
                    technique_keywords=keywords,
                    time_window_minutes=window,
                )
        except Exception as e:
            logger.warning("Raw telemetry check failed for %s: %s", technique_id, e)
            result.raw_log_count = -1  # Unknown

        # Step 5: Classify failure
        if result.raw_log_count > 0:
            result.verdict = ValidationVerdict.NOT_TRIGGERED
        elif result.raw_log_count == 0:
            result.verdict = ValidationVerdict.NO_TELEMETRY
        else:
            # raw_log_count == -1, telemetry check itself failed
            result.verdict = ValidationVerdict.NO_TELEMETRY
            result.error = "Could not verify raw telemetry"

        return result

    async def validate_batch(
        self,
        techniques: list[dict],
        simulations: list[SimulationResult],
        siem_targets: str = "splunk",
    ) -> list[ValidationResult]:
        """Validate a batch of techniques.

        Args:
            techniques: List of {"technique_id", "sigma_rule_path", "sigma_rule_content"}.
            simulations: Corresponding simulation results.
            siem_targets: "splunk", "mde", or "both".

        Returns:
            List of ValidationResult.
        """
        sim_by_id = {s.technique_id: s for s in simulations}
        all_results: list[ValidationResult] = []

        siems = ["splunk", "mde"] if siem_targets == "both" else [siem_targets]

        for tech in techniques:
            tid = tech["technique_id"]
            sim = sim_by_id.get(tid)
            if not sim:
                for siem in siems:
                    all_results.append(ValidationResult(
                        technique_id=tid,
                        siem=siem,
                        verdict=ValidationVerdict.ERROR,
                        error="No simulation result found",
                    ))
                continue

            for siem in siems:
                result = await self.validate_technique(
                    technique_id=tid,
                    siem=siem,
                    simulation_result=sim,
                    sigma_rule_path=tech.get("sigma_rule_path"),
                    sigma_rule_content=tech.get("sigma_rule_content"),
                )
                all_results.append(result)

        return all_results


validation_agent = ValidationAgent()
