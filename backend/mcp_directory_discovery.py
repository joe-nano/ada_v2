from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from web_agent import WebAgent


@dataclass(frozen=True)
class DirectoryDiscoveryConfig:
    url: str
    max_servers_total: int = 200
    max_servers_per_category: int = 50


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _runs_root() -> Path:
    return _project_root() / "projects" / "mcp_directory_catalog" / "runs"


def _slugify(text: str) -> str:
    t = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").strip().lower()).strip("-")
    return t[:60] if t else "run"


def _extract_json_block(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    m = re.search(r"```json\\s*(\\{.*?\\})\\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _prompt(cfg: DirectoryDiscoveryConfig) -> str:
    return f"""
You are collecting a catalog of MCP servers from this directory page:
{cfg.url}

Goal:
- Visit the page and enumerate categories and listed MCP servers.
- For each server, capture the best available install/config instructions (prefer commands like `codex mcp add ...`, `npx ...`, `uvx ...`, or HTTP MCP URLs).
- Output a structured JSON catalog that we can review and then manually add vetted servers into Codex.

Safety:
- Do NOT install anything.
- Do NOT invent details. Only record what you can cite from the directory listing and linked pages.

Limits:
- Max servers total: {cfg.max_servers_total}
- Max servers per category: {cfg.max_servers_per_category}

Output:
Return ONLY one JSON object in a fenced codeblock labeled json:

```json
{{
  \"generated_at\": \"<iso8601>\",
  \"source\": \"{cfg.url}\",
  \"categories\": [
    {{
      \"name\": \"<category>\",
      \"url\": \"https://...\",
      \"servers\": [
        {{
          \"name\": \"<server name>\",
          \"homepage\": \"https://...\",
          \"repo\": \"https://... (if found)\",
          \"evidence\": \"<short quote indicating it is MCP>\",
          \"install_hints\": [\"...\"] ,
          \"suggested_codex_add\": {{
            \"name\": \"<codex server name>\",
            \"transport\": \"stdio|http|unknown\",
            \"command\": [\"...\"],
            \"url\": \"https://...\",\n            \"env\": {{\"KEY\": \"VALUE\"}}\n          }}\n        }}\n      ]\n    }}\n  ],\n  \"notes\": [\"...\"],\n  \"open_questions\": [\"...\"]\n}}\n+```\n+
Make sure the JSON is valid.
""".strip()


async def run_mcp_directory_discovery(
    *,
    url: str = "https://mcp.so/categories",
    max_servers_total: int = 200,
    max_servers_per_category: int = 50,
) -> dict[str, Any]:
    cfg = DirectoryDiscoveryConfig(
        url=url,
        max_servers_total=int(max_servers_total),
        max_servers_per_category=int(max_servers_per_category),
    )

    run_id = f"{int(time.time())}_{_slugify('mcp-directory')}"
    run_dir = _runs_root() / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    prompt = _prompt(cfg)
    (run_dir / "prompt.txt").write_text(prompt + "\n", encoding="utf-8")

    agent = WebAgent()
    final = await agent.run_task(prompt)

    (run_dir / "raw_output.txt").write_text(str(final) + "\n", encoding="utf-8")

    parsed = _extract_json_block(str(final))
    parse_ok = parsed is not None
    if not parse_ok:
        parsed = {
            "generated_at": None,
            "source": cfg.url,
            "categories": [],
            "notes": [],
            "open_questions": ["Web agent did not return a parseable JSON block; see raw_output.txt"],
        }

    (run_dir / "catalog.json").write_text(json.dumps(parsed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    summary = {
        "success": True,
        "parse_ok": parse_ok,
        "run_id": run_id,
        "run_dir": str(run_dir),
        "catalog_path": str(run_dir / "catalog.json"),
        "raw_output_path": str(run_dir / "raw_output.txt"),
        "source": cfg.url,
    }
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary

