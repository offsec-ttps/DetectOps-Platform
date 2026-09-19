"""SentinelFlow backend configuration via environment variables."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Splunk Attack Range (SAR) ──
    sar_api_url: str = "http://localhost:4000"
    sar_api_key: str = ""

    # ── GOAD (Game of Active Directory) ──
    goad_path: str = "/media/nested/SamsungEvo/Projects/GOAD/GOAD"
    goad_instance_id: str = "d86a4c-minilab-virtualbox"
    goad_splunk_ip: str = "10.0.1.12"

    # ── Splunk REST API ──
    splunk_url: str = "https://localhost:8089"
    splunk_token: str = ""
    splunk_verify_ssl: bool = False

    # ── Microsoft Defender for Endpoint (Graph API) ──
    mde_tenant_id: str = ""
    mde_client_id: str = ""
    mde_client_secret: str = ""
    mde_authority: str = "https://login.microsoftonline.com"

    # ── GitHub ──
    github_token: str = ""
    github_repo: str = "acme-corp/detection-rules"
    github_default_branch: str = "main"
    github_reviewer: str = ""

    # ── Pipeline defaults ──
    detection_window_minutes: int = 10
    polling_interval_seconds: int = 15
    polling_timeout_seconds: int = 600

    # ── Server ──
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    log_level: str = "info"


settings = Settings()
