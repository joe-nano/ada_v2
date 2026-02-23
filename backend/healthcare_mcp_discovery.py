from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from web_agent import WebAgent


DEFAULT_TARGETS: list[str] = [
    "FHIR",
    "DICOMweb / DICOM viewers",
    "SNOMED CT",
    "Epic (SMART on FHIR)",
    "Cerner / Oracle Health (SMART on FHIR)",
    "Doctors worklist / tasking",
    "WHO datasets",
    "DSM (licensing-aware; references only)",
]


@dataclass(frozen=True)
class DiscoveryRunConfig:
    targets: list[str]
    max_candidates_per_target: int = 8
    model_turn_budget: int = 20


def _project_root() -> Path:
    # backend/ is one level down from the repo root
    return Path(__file__).resolve().parent.parent


def _runs_root() -> Path:
    return _project_root() / "projects" / "healthcare_mcp_catalog" / "runs"


def _slugify(text: str) -> str:
    t = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").strip().lower()).strip("-")
    return t[:60] if t else "run"


def _extract_json_block(text: str) -> dict[str, Any] | None:
    """
    Extract the first fenced ```json block and parse it.
    """
    if not text:
        return None
    m = re.search(r"```json\\s*(\\{.*?\\})\\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _discovery_prompt(cfg: DiscoveryRunConfig) -> str:
    targets = cfg.targets or DEFAULT_TARGETS
    max_per = int(cfg.max_candidates_per_target or 8)
    return f"""
You are doing web research to find *real* MCP (Model Context Protocol) servers for healthcare-adjacent integrations.

Goal:
- For each target in the list, find up to {max_per} MCP servers (or MCP-adjacent projects) that clearly claim to be an MCP server.
- Prefer repos/projects with installation instructions for Claude/Codex MCP config (e.g. `npx ... mcp`, `uvx ...`, or an HTTP MCP URL).
- For each candidate, capture enough info so we can later build our own MCP server if needed.

Targets:
{chr(10).join([f"- {t}" for t in targets])}

Rules:
- Do NOT invent servers. Every candidate must have a URL to a repo/homepage and a short quote or evidence that it is MCP.
- Separate \"existing MCP servers\" vs \"references for later MCP server development\" when no MCP server exists.
- If you cannot find an MCP server for a target, return an empty list for that target and include the best reference sources (official docs, SDKs).

Output:
Return ONLY a single JSON object in a fenced codeblock labeled json:

```json
{{
  \"generated_at\": \"<iso8601>\",
  \"targets\": [ ... ],
  \"results\": [
    {{
      \"target\": \"FHIR\",
      \"mcp_servers\": [
        {{
          \"name\": \"<server name>\",
          \"repo_or_homepage\": \"https://...\",
          \"evidence\": \"<short quote proving MCP>\",
          \"install\": {{
            \"transport\": \"stdio|http\",
            \"codex_mcp_add\": \"<exact command if known>\",
            \"env\": {{ \"KEY\": \"VALUE\" }}
          }},
          \"notes\": \"<auth, scopes, capabilities>\"
        }}
      ],
      \"references\": [
        {{ \"title\": \"...\", \"url\": \"https://...\", \"why\": \"...\" }}
      ]
    }}
  ],
  \"open_questions\": [\"...\"]
}}
```

Make sure the JSON is valid.
""".strip()


async def run_healthcare_mcp_discovery(
    *,
    targets: list[str] | None = None,
    max_candidates_per_target: int = 8,
) -> dict[str, Any]:
    """
    Runs a web-agent driven discovery pass and writes a run folder under:
    projects/healthcare_mcp_catalog/runs/<timestamp>_healthcare-mcp-discovery/
    """
    cfg = DiscoveryRunConfig(
        targets=targets or DEFAULT_TARGETS,
        max_candidates_per_target=max_candidates_per_target,
    )

    run_id = f"{int(time.time())}_{_slugify('healthcare-mcp-discovery')}"
    run_dir = _runs_root() / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    prompt = _discovery_prompt(cfg)
    (run_dir / "prompt.txt").write_text(prompt + "\n", encoding="utf-8")

    agent = WebAgent()
    final = await agent.run_task(prompt)

    (run_dir / "raw_output.txt").write_text(str(final) + "\n", encoding="utf-8")

    parsed = _extract_json_block(str(final))
    if parsed is None:
        parsed = {
            "generated_at": None,
            "targets": cfg.targets,
            "results": [],
            "open_questions": ["Web agent did not return a parseable JSON block; see raw_output.txt"],
        }
        ok = False
    else:
        ok = True

    (run_dir / "catalog.json").write_text(json.dumps(parsed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    summary = {
        "success": True,
        "parse_ok": ok,
        "run_id": run_id,
        "run_dir": str(run_dir),
        "catalog_path": str(run_dir / "catalog.json"),
        "raw_output_path": str(run_dir / "raw_output.txt"),
    }
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary

