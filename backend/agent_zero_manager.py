from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


def _workspace_root() -> Path:
    return Path(os.getenv("JODA_PROJECT_ROOT", "/home/yoda_external_storage_server/biz_automate")).resolve()


def _state_path() -> Path:
    p = _workspace_root() / ".joda" / "agent_zero" / "instances.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _docker() -> str:
    exe = shutil.which("docker")
    if not exe:
        raise RuntimeError("docker is not installed or not in PATH")
    return exe


def _image() -> str:
    return (os.getenv("AGENT_ZERO_IMAGE") or "agent0ai/agent-zero").strip()


def _base_port() -> int:
    try:
        return int(os.getenv("AGENT_ZERO_BASE_PORT") or 50001)
    except Exception:
        return 50001


def _name_prefix() -> str:
    return (os.getenv("AGENT_ZERO_NAME_PREFIX") or "joda-agent-zero").strip()


@dataclass(frozen=True)
class AgentZeroInstance:
    name: str
    host_port: int
    image: str


class AgentZeroManager:
    """
    Lightweight docker-based controller for Agent Zero.

    - Always runs Agent Zero through docker
    - Supports multiple instances via different host ports
    - Persists intended instances in a small JSON file under $JODA_PROJECT_ROOT/.joda/
    """

    def __init__(self):
        self.state_path = _state_path()

    def _read_state(self) -> list[AgentZeroInstance]:
        if not self.state_path.exists():
            return []
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
        except Exception:
            return []
        out: list[AgentZeroInstance] = []
        for item in (data or []):
            if not isinstance(item, dict):
                continue
            try:
                out.append(
                    AgentZeroInstance(
                        name=str(item.get("name") or ""),
                        host_port=int(item.get("host_port") or 0),
                        image=str(item.get("image") or ""),
                    )
                )
            except Exception:
                continue
        return [i for i in out if i.name and i.host_port > 0 and i.image]

    def _write_state(self, instances: list[AgentZeroInstance]) -> None:
        self.state_path.write_text(
            json.dumps([asdict(i) for i in instances], indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    def _run(self, args: list[str], timeout_sec: int = 120) -> str:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout_sec)
        out = (proc.stdout or "") + (proc.stderr or "")
        if proc.returncode != 0:
            raise RuntimeError(out.strip()[:2000] or f"Command failed: {' '.join(args)}")
        return out.strip()

    def pull_latest(self, image: str | None = None) -> str:
        img = (image or _image()).strip()
        return self._run([_docker(), "pull", img], timeout_sec=600)

    def list_running(self) -> list[dict[str, Any]]:
        # Uses labels so we only return JODA-managed containers.
        out = self._run(
            [
                _docker(),
                "ps",
                "--filter",
                "label=joda.agent=agent-zero",
                "--format",
                "{{.Names}}|{{.Image}}|{{.Ports}}|{{.Status}}",
            ],
            timeout_sec=20,
        )
        rows = []
        for line in (out.splitlines() if out else []):
            name, image, ports, status = (line.split("|", 3) + ["", "", "", ""])[:4]
            rows.append({"name": name, "image": image, "ports": ports, "status": status})
        return rows

    def _next_port(self, reserved: set[int]) -> int:
        port = _base_port()
        while port in reserved:
            port += 1
        return port

    def start(self, *, host_port: int | None = None, image: str | None = None) -> AgentZeroInstance:
        img = (image or _image()).strip()
        reserved = {i.host_port for i in self._read_state()}
        port = int(host_port) if host_port else self._next_port(reserved)
        name = f"{_name_prefix()}-{port}"

        # Ensure state tracks intent even if container already exists.
        instances = [i for i in self._read_state() if i.name != name]
        inst = AgentZeroInstance(name=name, host_port=port, image=img)
        instances.append(inst)
        self._write_state(instances)

        # Run container (detached). Always map host_port -> 80 as requested.
        # Use --restart unless-stopped so it survives reboots if docker is configured.
        self._run(
            [
                _docker(),
                "run",
                "-d",
                "--restart",
                "unless-stopped",
                "--name",
                name,
                "--label",
                "joda.agent=agent-zero",
                "--label",
                f"joda.port={port}",
                "-p",
                f"{port}:80",
                img,
            ],
            timeout_sec=120,
        )
        return inst

    def stop(self, *, name: str) -> bool:
        name = (name or "").strip()
        if not name:
            raise ValueError("Missing container name")
        try:
            self._run([_docker(), "stop", name], timeout_sec=60)
        except Exception:
            return False
        return True

    def scale(self, *, count: int, image: str | None = None) -> list[AgentZeroInstance]:
        desired = max(0, int(count))
        current = self.list_running()
        running_names = {c.get("name") for c in current if c.get("name")}

        # Start new instances until we reach desired count.
        created: list[AgentZeroInstance] = []
        if len(running_names) < desired:
            reserved = {i.host_port for i in self._read_state()}
            while len(running_names) + len(created) < desired:
                port = self._next_port(reserved | {c.host_port for c in created})
                created.append(self.start(host_port=port, image=image))
        return created

