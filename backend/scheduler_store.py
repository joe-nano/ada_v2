from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4


ScheduleType = Literal["interval_minutes", "cron"]
TaskType = Literal["browse", "web", "mcp", "pipeline"]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_workspace_root() -> Path:
    return Path(os.getenv("JODA_PROJECT_ROOT", "/home/yoda_external_storage_server/biz_automate")).resolve()


@dataclass(frozen=True)
class ScheduledJob:
    id: str
    name: str
    enabled: bool
    schedule_type: ScheduleType
    interval_minutes: int | None
    cron: str | None
    task_type: TaskType
    payload: dict[str, Any]
    created_at: str
    updated_at: str
    last_run_at: str | None = None
    last_status: str | None = None
    last_error: str | None = None

    @staticmethod
    def create(
        *,
        name: str,
        schedule_type: ScheduleType,
        interval_minutes: int | None,
        cron: str | None,
        task_type: TaskType,
        payload: dict[str, Any] | None,
        enabled: bool = True,
    ) -> "ScheduledJob":
        now = _utc_now_iso()
        return ScheduledJob(
            id=str(uuid4()),
            name=name.strip(),
            enabled=bool(enabled),
            schedule_type=schedule_type,
            interval_minutes=interval_minutes,
            cron=cron,
            task_type=task_type,
            payload=dict(payload or {}),
            created_at=now,
            updated_at=now,
        )


class SchedulerStore:
    def __init__(self, root: Path | None = None):
        self.root = (root or _default_workspace_root()).resolve()
        self.path = self.root / ".joda" / "scheduler" / "jobs.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _read_raw(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return []
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        return []

    def _write_raw(self, items: list[dict[str, Any]]) -> None:
        self.path.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def list(self) -> list[ScheduledJob]:
        out: list[ScheduledJob] = []
        for item in self._read_raw():
            try:
                out.append(
                    ScheduledJob(
                        id=str(item.get("id") or ""),
                        name=str(item.get("name") or ""),
                        enabled=bool(item.get("enabled", True)),
                        schedule_type=str(item.get("schedule_type") or "interval_minutes"),  # type: ignore[arg-type]
                        interval_minutes=item.get("interval_minutes"),
                        cron=item.get("cron"),
                        task_type=str(item.get("task_type") or "browse"),  # type: ignore[arg-type]
                        payload=dict(item.get("payload") or {}),
                        created_at=str(item.get("created_at") or ""),
                        updated_at=str(item.get("updated_at") or ""),
                        last_run_at=item.get("last_run_at"),
                        last_status=item.get("last_status"),
                        last_error=item.get("last_error"),
                    )
                )
            except Exception:
                continue
        out = [j for j in out if j.id and j.name]
        return sorted(out, key=lambda j: (j.name.lower(), j.created_at))

    def get(self, job_id: str) -> ScheduledJob | None:
        job_id = (job_id or "").strip()
        if not job_id:
            return None
        for j in self.list():
            if j.id == job_id:
                return j
        return None

    def upsert(self, job: ScheduledJob) -> ScheduledJob:
        items = self._read_raw()
        now = _utc_now_iso()
        updated = ScheduledJob(
            id=job.id,
            name=job.name,
            enabled=job.enabled,
            schedule_type=job.schedule_type,
            interval_minutes=job.interval_minutes,
            cron=job.cron,
            task_type=job.task_type,
            payload=job.payload,
            created_at=job.created_at or now,
            updated_at=now,
            last_run_at=job.last_run_at,
            last_status=job.last_status,
            last_error=job.last_error,
        )
        idx = next((i for i, it in enumerate(items) if str(it.get("id") or "") == job.id), None)
        if idx is None:
            items.append(asdict(updated))
        else:
            items[idx] = asdict(updated)
        self._write_raw(items)
        return updated

    def create(
        self,
        *,
        name: str,
        schedule_type: ScheduleType,
        interval_minutes: int | None = None,
        cron: str | None = None,
        task_type: TaskType,
        payload: dict[str, Any] | None = None,
        enabled: bool = True,
    ) -> ScheduledJob:
        name = (name or "").strip()
        if not name:
            raise ValueError("Missing job name")
        if schedule_type not in ("interval_minutes", "cron"):
            raise ValueError("Invalid schedule_type")
        if task_type not in ("browse", "web", "mcp", "pipeline"):
            raise ValueError("Invalid task_type")
        if schedule_type == "interval_minutes":
            minutes = int(interval_minutes or 0)
            if minutes <= 0:
                raise ValueError("interval_minutes must be > 0")
            interval_minutes = minutes
            cron = None
        else:
            cron = (cron or "").strip()
            if not cron:
                raise ValueError("Missing cron string")
            interval_minutes = None
        job = ScheduledJob.create(
            name=name,
            schedule_type=schedule_type,
            interval_minutes=interval_minutes,
            cron=cron,
            task_type=task_type,
            payload=payload,
            enabled=enabled,
        )
        return self.upsert(job)

    def delete(self, job_id: str) -> bool:
        job_id = (job_id or "").strip()
        if not job_id:
            raise ValueError("Missing job_id")
        items = self._read_raw()
        before = len(items)
        items = [it for it in items if str(it.get("id") or "") != job_id]
        if len(items) == before:
            return False
        self._write_raw(items)
        return True

    def set_enabled(self, job_id: str, enabled: bool) -> ScheduledJob | None:
        job = self.get(job_id)
        if not job:
            return None
        updated = ScheduledJob(
            **{
                **job.__dict__,
                "enabled": bool(enabled),
            }
        )
        return self.upsert(updated)
