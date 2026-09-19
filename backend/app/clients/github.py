"""GitHub client for detection-as-code workflows.

Uses `gh` CLI for branch creation, commit, and Draft PR orchestration.
Falls back to GitHub REST API via httpx when gh CLI is unavailable.

Workflow:
  1. Create branch from default branch.
  2. Commit LOCK report markdown.
  3. Open Draft Pull Request for team review.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GH_CLI = shutil.which("gh")


class GitHubClient:
    """Git/GitHub operations for LOCK report publishing."""

    def __init__(
        self,
        token: Optional[str] = None,
        repo: Optional[str] = None,
        default_branch: Optional[str] = None,
        reviewer: Optional[str] = None,
    ) -> None:
        self.token = token or settings.github_token
        self.repo = repo or settings.github_repo
        self.default_branch = default_branch or settings.github_default_branch
        self.reviewer = reviewer or settings.github_reviewer

    def _api_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    # ── gh CLI methods (preferred) ──

    async def _run_gh(self, args: list[str]) -> str:
        """Execute a gh CLI command and return stdout."""
        cmd = ["gh"] + args + ["--repo", self.repo]
        logger.info("Running: gh %s", " ".join(args))
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={
                **__import__("os").environ,
                "GH_TOKEN": self.token,
            },
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            error_msg = stderr.decode().strip()
            logger.error("gh CLI error: %s", error_msg)
            raise RuntimeError(f"gh CLI failed: {error_msg}")
        return stdout.decode().strip()

    # ── API fallback methods ──

    async def _api_request(
        self,
        method: str,
        path: str,
        json: Optional[dict] = None,
    ) -> dict[str, Any]:
        url = f"https://api.github.com/repos/{self.repo}{path}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(
                method, url, headers=self._api_headers(), json=json
            )
            resp.raise_for_status()
            return resp.json()

    # ── Public workflow methods ──

    async def create_branch(self, branch_name: str) -> str:
        """Create a new branch from the default branch.

        Returns:
            The branch name (confirmed created).
        """
        if GH_CLI:
            # Use gh api to create ref
            await self._run_gh([
                "api", f"repos/{self.repo}/git/refs",
                "-f", f"ref=refs/heads/{branch_name}",
                "-f", f"sha=$(gh api repos/{self.repo}/git/ref/heads/{self.default_branch} --jq .object.sha)",
            ])
            return branch_name

        # REST API fallback: get SHA of default branch, create ref
        ref_data = await self._api_request(
            "GET", f"/git/ref/heads/{self.default_branch}"
        )
        sha = ref_data["object"]["sha"]
        await self._api_request(
            "POST",
            "/git/refs",
            json={"ref": f"refs/heads/{branch_name}", "sha": sha},
        )
        logger.info("Created branch: %s (from %s)", branch_name, sha[:8])
        return branch_name

    async def commit_file(
        self,
        branch: str,
        file_path: str,
        content: str,
        message: str,
    ) -> dict[str, Any]:
        """Create or update a file on a branch via the Contents API.

        Args:
            branch: Target branch name.
            file_path: Path within the repo (e.g. "docs/lock/T1059.001.md").
            content: File content (will be base64-encoded).
            message: Commit message.

        Returns:
            Commit data from the API.
        """
        import base64

        encoded = base64.b64encode(content.encode()).decode()

        # Check if file exists to get its SHA (needed for updates)
        sha: Optional[str] = None
        try:
            existing = await self._api_request(
                "GET", f"/contents/{file_path}?ref={branch}"
            )
            sha = existing.get("sha")
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 404:
                raise

        payload: dict[str, Any] = {
            "message": message,
            "content": encoded,
            "branch": branch,
        }
        if sha:
            payload["sha"] = sha

        result = await self._api_request("PUT", f"/contents/{file_path}", json=payload)
        logger.info("Committed file: %s on branch %s", file_path, branch)
        return result.get("commit", {})

    async def create_draft_pr(
        self,
        branch: str,
        title: str,
        body: str,
    ) -> dict[str, Any]:
        """Open a Draft Pull Request for team review.

        Args:
            branch: Source branch with LOCK report commits.
            title: PR title.
            body: PR body (markdown).

        Returns:
            {"pr_number": int, "pr_url": str, "html_url": str}
        """
        if GH_CLI:
            output = await self._run_gh([
                "pr", "create",
                "--head", branch,
                "--base", self.default_branch,
                "--title", title,
                "--body", body,
                "--draft",
                *(["--reviewer", self.reviewer] if self.reviewer else []),
            ])
            # gh pr create returns the PR URL
            return {"pr_url": output, "pr_number": int(output.rstrip("/").split("/")[-1])}

        # REST API fallback
        payload: dict[str, Any] = {
            "title": title,
            "body": body,
            "head": branch,
            "base": self.default_branch,
            "draft": True,
        }
        result = await self._api_request("POST", "/pulls", json=payload)
        pr_url = result.get("html_url", "")
        pr_number = result.get("number", 0)

        if self.reviewer and pr_number:
            try:
                await self._api_request(
                    "POST",
                    f"/pulls/{pr_number}/requested_reviewers",
                    json={"reviewers": [self.reviewer]},
                )
            except Exception:
                logger.warning("Failed to assign reviewer %s", self.reviewer)

        logger.info("Created Draft PR #%d: %s", pr_number, pr_url)
        return {"pr_url": pr_url, "pr_number": pr_number}


github_client = GitHubClient()
