"""Microsoft Defender for Endpoint (MDE) client via Microsoft Graph API.

Uses the Advanced Hunting API to execute KQL queries translated by pySigma,
and the Security Alerts API for supplementary validation.

Auth: OAuth2 client_credentials flow against Azure AD.
Endpoints:
  POST https://graph.microsoft.com/v1.0/security/runHuntingQuery
  POST https://api.securitycenter.microsoft.com/api/advancedqueries/run
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class MDEClient:
    """Async client for Microsoft Defender for Endpoint Graph API."""

    def __init__(
        self,
        tenant_id: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
    ) -> None:
        self.tenant_id = tenant_id or settings.mde_tenant_id
        self.client_id = client_id or settings.mde_client_id
        self.client_secret = client_secret or settings.mde_client_secret
        self.authority = settings.mde_authority
        self._access_token: Optional[str] = None

    async def _acquire_token(self) -> str:
        """Acquire an OAuth2 access token via client_credentials flow."""
        if self._access_token:
            return self._access_token

        token_url = f"{self.authority}/{self.tenant_id}/oauth2/v2.0/token"
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(token_url, data=data)
            resp.raise_for_status()
            token_data = resp.json()
            self._access_token = token_data["access_token"]
            logger.info("Acquired MDE access token")
            return self._access_token

    async def _request(
        self,
        method: str,
        url: str,
        json: Optional[dict] = None,
    ) -> dict[str, Any]:
        token = await self._acquire_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.request(method, url, headers=headers, json=json)
            if resp.status_code == 401:
                # Token expired, retry once
                self._access_token = None
                token = await self._acquire_token()
                headers["Authorization"] = f"Bearer {token}"
                resp = await client.request(method, url, headers=headers, json=json)
            resp.raise_for_status()
            return resp.json()

    async def run_hunting_query(self, kql_query: str) -> dict[str, Any]:
        """Execute an Advanced Hunting KQL query via Graph Security API.

        Args:
            kql_query: The full KQL query string (from pySigma output).

        Returns:
            {"result_count": int, "results": [...], "stats": {...}}
        """
        url = "https://graph.microsoft.com/v1.0/security/runHuntingQuery"
        payload = {"Query": kql_query}
        logger.info("Executing MDE hunting query (length=%d chars)", len(kql_query))

        result = await self._request("POST", url, json=payload)
        results = result.get("results", [])
        return {
            "result_count": len(results),
            "results": results[:50],  # Cap returned results
            "schema": result.get("schema", []),
            "stats": result.get("stats", {}),
        }

    async def run_advanced_query(self, kql_query: str) -> dict[str, Any]:
        """Execute via the MDE-specific Advanced Queries endpoint.

        Falls back to this if Graph Security API is unavailable.
        """
        url = "https://api.securitycenter.microsoft.com/api/advancedqueries/run"
        payload = {"Query": kql_query}
        logger.info("Executing MDE advanced query (length=%d chars)", len(kql_query))

        result = await self._request("POST", url, json=payload)
        results = result.get("Results", [])
        return {
            "result_count": len(results),
            "results": results[:50],
            "schema": result.get("Schema", []),
            "stats": result.get("Stats", {}),
        }

    async def check_raw_telemetry(
        self,
        table: str,
        technique_keywords: list[str],
        time_window_minutes: int = 15,
    ) -> int:
        """Check if raw telemetry events exist in MDE tables.

        Uses a broad KQL search to confirm data pipeline delivery.

        Args:
            table: MDE table name (e.g. "DeviceProcessEvents").
            technique_keywords: Keywords to search for in process/file fields.
            time_window_minutes: How far back to look.

        Returns:
            Count of matching events.
        """
        keyword_filters = " or ".join(
            f'ProcessCommandLine contains "{kw}" or FileName contains "{kw}"'
            for kw in technique_keywords
        )
        kql = (
            f"{table}\n"
            f"| where Timestamp > ago({time_window_minutes}m)\n"
            f"| where {keyword_filters}\n"
            f"| count"
        )
        result = await self.run_hunting_query(kql)
        if result["results"]:
            return int(result["results"][0].get("Count", 0))
        return 0


mde_client = MDEClient()
