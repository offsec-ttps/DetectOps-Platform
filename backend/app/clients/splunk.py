"""Splunk REST API client for search execution and detection validation.

Uses the Splunk REST API (/services/search/jobs) to:
  1. Submit SPL search queries translated by pySigma.
  2. Poll for job completion.
  3. Retrieve result counts and raw events for validation.

Reference: https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTsearch
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class SplunkClient:
    """Async client for Splunk's REST search API."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        verify_ssl: Optional[bool] = None,
    ) -> None:
        self.base_url = (base_url or settings.splunk_url).rstrip("/")
        self.token = token or settings.splunk_token
        self.verify_ssl = verify_ssl if verify_ssl is not None else settings.splunk_verify_ssl

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/x-www-form-urlencoded",
        }

    async def _request(
        self,
        method: str,
        path: str,
        data: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(
            timeout=120.0, verify=self.verify_ssl
        ) as client:
            resp = await client.request(
                method,
                url,
                headers=self._headers(),
                data=data,
                params={**(params or {}), "output_mode": "json"},
            )
            resp.raise_for_status()
            return resp.json()

    async def create_search_job(
        self,
        spl_query: str,
        earliest_time: str = "-15m",
        latest_time: str = "now",
    ) -> str:
        """Submit an SPL search job and return the job SID.

        Args:
            spl_query: The full SPL search string (from pySigma output).
            earliest_time: Splunk time modifier for search window start.
            latest_time: Splunk time modifier for search window end.

        Returns:
            Job SID string.
        """
        data = {
            "search": spl_query if spl_query.startswith("search ") or spl_query.startswith("|") else f"search {spl_query}",
            "earliest_time": earliest_time,
            "latest_time": latest_time,
            "exec_mode": "normal",
        }
        logger.info("Creating Splunk search job: earliest=%s latest=%s", earliest_time, latest_time)
        result = await self._request("POST", "/services/search/jobs", data=data)
        return result["sid"]

    async def get_job_status(self, sid: str) -> dict[str, Any]:
        """Check the status of a search job.

        Returns:
            Job status dict with isDone, resultCount, etc.
        """
        result = await self._request("GET", f"/services/search/jobs/{sid}")
        entry = result.get("entry", [{}])[0].get("content", {})
        return {
            "sid": sid,
            "is_done": entry.get("isDone", False),
            "result_count": int(entry.get("resultCount", 0)),
            "event_count": int(entry.get("eventCount", 0)),
            "scan_count": int(entry.get("scanCount", 0)),
            "run_duration": float(entry.get("runDuration", 0)),
            "dispatch_state": entry.get("dispatchState", "UNKNOWN"),
        }

    async def get_job_results(
        self, sid: str, count: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        """Retrieve results from a completed search job."""
        result = await self._request(
            "GET",
            f"/services/search/jobs/{sid}/results",
            params={"count": str(count), "offset": str(offset)},
        )
        return result.get("results", [])

    async def search_and_wait(
        self,
        spl_query: str,
        earliest_time: str = "-15m",
        latest_time: str = "now",
        poll_interval: float = 2.0,
        timeout: float = 120.0,
    ) -> dict[str, Any]:
        """Submit a search, poll until done, and return result summary.

        Returns:
            {"sid": ..., "result_count": int, "event_count": int, "run_duration": float, "results": [...]}
        """
        sid = await self.create_search_job(spl_query, earliest_time, latest_time)
        start = time.monotonic()

        while True:
            status = await self.get_job_status(sid)
            if status["is_done"]:
                results = []
                if status["result_count"] > 0:
                    results = await self.get_job_results(sid, count=50)
                return {
                    "sid": sid,
                    "result_count": status["result_count"],
                    "event_count": status["event_count"],
                    "run_duration": status["run_duration"],
                    "results": results,
                }
            if time.monotonic() - start > timeout:
                logger.warning("Splunk search timed out: sid=%s", sid)
                return {
                    "sid": sid,
                    "result_count": 0,
                    "event_count": 0,
                    "run_duration": time.monotonic() - start,
                    "results": [],
                    "error": "Search timed out",
                }
            await _async_sleep(poll_interval)

    async def check_raw_telemetry(
        self,
        index: str,
        technique_keywords: list[str],
        earliest_time: str = "-15m",
        latest_time: str = "now",
    ) -> int:
        """Check if raw telemetry events exist for a technique (before rule logic).

        Uses a broad keyword search to confirm data pipeline delivery.

        Returns:
            Count of raw events matching the keyword filter.
        """
        keyword_filter = " OR ".join(f'"{kw}"' for kw in technique_keywords)
        spl = f'search index={index} ({keyword_filter}) | stats count'
        result = await self.search_and_wait(spl, earliest_time, latest_time)
        if result.get("results"):
            return int(result["results"][0].get("count", 0))
        return 0


async def _async_sleep(seconds: float) -> None:
    import asyncio
    await asyncio.sleep(seconds)


splunk_client = SplunkClient()
