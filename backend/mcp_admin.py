"""
MCP admin helpers for JODA.

- Reload the in-process MCP client (re-read configs, re-import Codex servers if enabled).
- (Optional) Add MCP servers to Codex config via `codex mcp add`.
"""

from __future__ import annotations

import os
import subprocess
from typing import Any

try:
    from mcp_client import get_mcp_client, shutdown_mcp_client
except ModuleNotFoundError:  # pragma: no cover
    from .mcp_client import get_mcp_client, shutdown_mcp_client  # type: ignore


async def reload_mcp_client() -> dict[str, Any]:
    """
    Reload the global MCP client:
    - Stops all running MCP server processes (stdio)
    - Re-reads config (backend/mcp_servers.json + optional Codex import)
    - Re-discovers tools
    """
    await shutdown_mcp_client()
    client = await get_mcp_client()
    return {"success": True, "servers": len(client.servers), "tools": len(client.tools)}


def _require_codex_cli() -> str:
    exe = subprocess.run(["bash", "-lc", "command -v codex"], capture_output=True, text=True)
    path = (exe.stdout or "").strip()
    if exe.returncode != 0 or not path:
        raise RuntimeError("codex CLI not found in PATH")
    return path


def codex_mcp_add_stdio(
    name: str,
    command: list[str],
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Add a stdio MCP server to Codex via `codex mcp add <name> [--env ...] -- <command...>`.

    Security: This is inherently powerful. JODA should only expose this behind explicit
    user approval and/or shell expert mode.
    """
    name = (name or "").strip()
    if not name:
        raise ValueError("Missing name")
    if not command or not all(isinstance(x, str) and x.strip() for x in command):
        raise ValueError("Missing/invalid command")

    _require_codex_cli()

    # We need to build a single shell string so Codex is resolved in login shell.
    cmd = ["codex", "mcp", "add", name]
    if env:
        for k, v in env.items():
            cmd += ["--env", f"{k}={v}"]
    cmd += ["--", *command]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()[:2000])
    return {"success": True, "stdout": (proc.stdout or "").strip()}


def codex_mcp_add_url(name: str, url: str) -> dict[str, Any]:
    name = (name or "").strip()
    url = (url or "").strip()
    if not name:
        raise ValueError("Missing name")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError("url must start with http:// or https://")

    _require_codex_cli()
    proc = subprocess.run(["codex", "mcp", "add", name, "--url", url], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()[:2000])
    return {"success": True, "stdout": (proc.stdout or "").strip()}
