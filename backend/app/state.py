"""In-memory pipeline state store.

For production, replace with Redis or a database-backed store.
"""

from __future__ import annotations

import threading
from datetime import datetime
from typing import Optional

from app.models import PipelineRun, PipelineStatus


class PipelineStore:
    """Thread-safe in-memory store for pipeline runs."""

    def __init__(self) -> None:
        self._runs: dict[str, PipelineRun] = {}
        self._lock = threading.Lock()

    def create(self, run: PipelineRun) -> PipelineRun:
        with self._lock:
            self._runs[run.run_id] = run
        return run

    def get(self, run_id: str) -> Optional[PipelineRun]:
        with self._lock:
            return self._runs.get(run_id)

    def update(self, run_id: str, **kwargs) -> Optional[PipelineRun]:
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                return None
            for key, value in kwargs.items():
                setattr(run, key, value)
            run.updated_at = datetime.utcnow()
            return run

    def list_all(self) -> list[PipelineRun]:
        with self._lock:
            return list(self._runs.values())


store = PipelineStore()
