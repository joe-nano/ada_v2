import sys
import asyncio

# Fix for asyncio subprocess support on Windows
# MUST BE SET BEFORE OTHER IMPORTS
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from dotenv import load_dotenv
load_dotenv(dotenv_path=__file__ and __import__('pathlib').Path(__file__).resolve().parent.parent / '.env')

import socketio
import uvicorn
from fastapi import FastAPI
import asyncio
import threading
import sys
import os
import json
import argparse
import shutil
import subprocess
import shlex
from datetime import datetime
from pathlib import Path
import time
import struct
import httpx
import sys
from array import array
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException
from scheduler_store import SchedulerStore, ScheduledJob
from ad_pipeline import run_daily_ads_pipeline



# Ensure we can import joda
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from authenticator import FaceAuthenticator
from kasa_agent import KasaAgent
from agent_manager import get_agent_manager
from browser_skills import BrowserSkillsStore

# Create a Socket.IO server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()
app_socketio = socketio.ASGIApp(sio, app)

# Allow the Vite frontend (port 5173) to call backend HTTP endpoints like /heygen/token.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/heygen/token")
async def heygen_token():
    """
    Returns a short-lived HeyGen streaming token for the browser SDK.
    Prefers LIVE_AVATAR_API_KEY but also supports HEYGEN_API_KEY.
    """
    # HeyGen StreamingAvatar token creation uses the HeyGen API key (Trial Token / Enterprise key).
    # The SDK docs use header: `x-api-key: <api-key>`.
    api_key = os.getenv("LIVE_AVATAR_API_KEY") or os.getenv("HEYGEN_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Missing HeyGen API key. Set LIVE_AVATAR_API_KEY (preferred) or HEYGEN_API_KEY.",
        )

    # HeyGen Streaming token endpoint
    url = "https://api.heygen.com/v1/streaming.create_token"
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(
                url,
                headers={"X-Api-Key": api_key, "Content-Type": "application/json"},
                json={},
            )
        if resp.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"HeyGen token request failed ({resp.status_code}): {resp.text[:300]}",
            )
        data = resp.json()
        # Typical response: { "data": { "token": "..." }, ... }
        token = ((data.get("data") or {}).get("token")) or data.get("token")
        if not token:
            raise HTTPException(status_code=502, detail="HeyGen did not return a token.")
        return {"token": token}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"HeyGen exception: {e}")

import signal

# --- SHUTDOWN HANDLER ---
def signal_handler(sig, frame):
    print(f"\n[SERVER] Caught signal {sig}. Exiting gracefully...")
    # Clean up audio loop
    if audio_loop:
        try:
            print("[SERVER] Stopping Audio Loop...")
            audio_loop.stop() 
        except:
            pass
    # Force kill
    print("[SERVER] Force exiting...")
    os._exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Global state
audio_loop = None
loop_task = None
authenticator = None
kasa_agent = KasaAgent()
SETTINGS_FILE = "settings.json"

# --- Telegram relay (Option 2: JODA speaks via Clawdbot into Telegram) ---
# Enable by setting in .env:
#   JODA_TELEGRAM_ENABLED=1
#   JODA_TELEGRAM_TARGET=<telegram chat id or @username>
# This keeps a single Telegram bot identity; messages are prefixed with "Joda:".
_clawdbot_cmd_cache: list[str] | None = None
_clawdbot_cmd_missing_warned = False


def _get_clawdbot_cmd() -> list[str] | None:
    """
    Returns the command used to invoke clawdbot, or None if not available.

    Resolution order:
    1) $CLAWDBOT_CMD (shlex-split)
    2) `clawdbot` on PATH
    3) Local checkout at /root/clawdbot/dist/entry.js (invoked via node)
    """
    global _clawdbot_cmd_cache
    if _clawdbot_cmd_cache is not None:
        return _clawdbot_cmd_cache

    env_cmd = (os.getenv("CLAWDBOT_CMD") or "").strip()
    if env_cmd:
        _clawdbot_cmd_cache = shlex.split(env_cmd)
        return _clawdbot_cmd_cache

    if shutil.which("clawdbot"):
        _clawdbot_cmd_cache = ["clawdbot"]
        return _clawdbot_cmd_cache

    local_entry = "/root/clawdbot/dist/entry.js"
    if os.path.isfile(local_entry) and shutil.which("node"):
        _clawdbot_cmd_cache = ["node", local_entry]
        return _clawdbot_cmd_cache

    _clawdbot_cmd_cache = None
    return None


async def _relay_to_telegram_via_clawdbot(text: str):
    try:
        if not text:
            return
        if os.getenv("JODA_TELEGRAM_ENABLED", "0") not in ("1", "true", "yes", "on"):
            return
        target = os.getenv("JODA_TELEGRAM_TARGET")
        if not target:
            return

        # Keep it single-line-ish to avoid Telegram formatting surprises.
        msg = f"Joda: {text}".strip()

        async def _run():
            global _clawdbot_cmd_missing_warned

            clawdbot_cmd = _get_clawdbot_cmd()
            if not clawdbot_cmd:
                if not _clawdbot_cmd_missing_warned:
                    _clawdbot_cmd_missing_warned = True
                    print(
                        "[TELEGRAM] clawdbot not found. Set CLAWDBOT_CMD or install clawdbot on PATH."
                    )
                return

            # Use the local clawdbot CLI to deliver into Telegram.
            # Note: this assumes the gateway already has Telegram configured.
            subprocess.run(
                [
                    *clawdbot_cmd,
                    "message",
                    "send",
                    "--channel",
                    "telegram",
                    "--target",
                    str(target),
                    "--message",
                    msg,
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )

        await asyncio.to_thread(_run)
    except Exception:
        # Never let relay failures break the main JODA loop.
        return

# Fallback chat state (per-socket)
_openai_histories = {}
_mic_debug_seen: set[str] = set()
_mic_resample_state: dict[str, float] = {}
_mic_sample_rates: dict[str, int] = {}  # per-session sample rate from browser
_mic_bytes_counter: dict[str, list] = {}  # per-session [bytes_count, last_log_time]
_browser_secrets: dict[str, dict[str, str]] = {}
_browser_skills = BrowserSkillsStore()
_scheduler_store = SchedulerStore()
_scheduler_tasks: dict[str, asyncio.Task] = {}


def _parse_cron(expr: str) -> dict[str, str]:
    """
    Minimal cron parser: 'min hour dom mon dow' (5-field).
    Returns kwargs compatible with APScheduler CronTrigger-like semantics (best-effort).
    """
    parts = (expr or "").strip().split()
    if len(parts) != 5:
        raise ValueError("cron must have 5 fields: min hour dom mon dow")
    minute, hour, day, month, day_of_week = parts
    return {
        "minute": minute,
        "hour": hour,
        "day": day,
        "month": month,
        "day_of_week": day_of_week,
    }


async def _run_scheduled_job(job: ScheduledJob) -> None:
    """
    Execute a scheduled job once.
    For safety: only supports browse/web/mcp/mcp_reload/pipeline and uses existing backend agents.
    """
    job_start = datetime.utcnow().isoformat()
    try:
        # Emit to any connected UIs
        await sio.emit("status", {"msg": f"[Scheduler] Running: {job.name} ({job.id})"})
    except Exception:
        pass

    try:
        if job.task_type == "browse":
            prompt = str(job.payload.get("prompt") or "").strip()
            if not prompt:
                raise ValueError("Missing payload.prompt")
            if not audio_loop:
                raise RuntimeError("JODA not started; cannot run /browse (Gemini session required)")
            secrets = None
            # Scheduler runs without a specific sid; use no credentials unless explicitly provided in payload.
            if isinstance(job.payload.get("secrets"), dict):
                secrets = {str(k): str(v) for k, v in job.payload["secrets"].items()}
            asyncio.create_task(audio_loop.handle_browser_use_request(prompt, secrets=secrets))

        elif job.task_type == "web":
            prompt = str(job.payload.get("prompt") or "").strip()
            if not prompt:
                raise ValueError("Missing payload.prompt")
            if not audio_loop:
                raise RuntimeError("JODA not started; cannot run /web (Gemini session required)")
            secrets = None
            if isinstance(job.payload.get("secrets"), dict):
                secrets = {str(k): str(v) for k, v in job.payload["secrets"].items()}
            asyncio.create_task(audio_loop.handle_web_agent_request(prompt, secrets=secrets))

        elif job.task_type == "mcp":
            tool_name = str(job.payload.get("tool_name") or "").strip()
            arguments = job.payload.get("arguments")
            if not tool_name or not isinstance(arguments, dict):
                raise ValueError("Missing payload.tool_name or payload.arguments")
            # Prefer direct MCP call (works even if Gemini is down).
            from mcp_client import get_mcp_client

            client = await get_mcp_client()
            res = await client.call_tool(tool_name=tool_name, arguments=arguments, agent_id="scheduler")
            if not res.get("success"):
                raise RuntimeError(res.get("error") or "MCP tool call failed")

        elif job.task_type == "mcp_reload":
            # Reload MCP client: re-read config, restart processes, re-discover tools.
            from mcp_admin import reload_mcp_client

            res = await reload_mcp_client()
            await sio.emit("status", {"msg": f"[MCP] Reloaded: {res.get('servers')} servers, {res.get('tools')} tools"})

        elif job.task_type == "healthcare_mcp_discovery":
            from healthcare_mcp_discovery import run_healthcare_mcp_discovery

            targets = job.payload.get("targets")
            if targets is not None and not isinstance(targets, list):
                raise ValueError("payload.targets must be a list of strings")
            max_candidates = int(job.payload.get("max_candidates_per_target") or 8)
            res = await run_healthcare_mcp_discovery(
                targets=[str(t) for t in (targets or [])] if targets else None,
                max_candidates_per_target=max_candidates,
            )
            await sio.emit(
                "status",
                {
                    "msg": (
                        f"[Healthcare MCP] Discovery complete (parse_ok={res.get('parse_ok')}): "
                        f"{res.get('catalog_path')}"
                    )
                },
            )

        elif job.task_type == "mcp_directory_discovery":
            from mcp_directory_discovery import run_mcp_directory_discovery

            url = str(job.payload.get("url") or "https://mcp.so/categories").strip()
            max_total = int(job.payload.get("max_servers_total") or 200)
            max_per_cat = int(job.payload.get("max_servers_per_category") or 50)
            res = await run_mcp_directory_discovery(
                url=url,
                max_servers_total=max_total,
                max_servers_per_category=max_per_cat,
            )
            await sio.emit(
                "status",
                {
                    "msg": (
                        f"[MCP Directory] Discovery complete (parse_ok={res.get('parse_ok')}): "
                        f"{res.get('catalog_path')}"
                    )
                },
            )

        elif job.task_type == "pipeline":
            pipeline = str(job.payload.get("pipeline") or "daily_ads").strip()
            if pipeline != "daily_ads":
                raise ValueError("Unsupported pipeline (only 'daily_ads' is available right now)")
            cfg = dict(job.payload or {})
            # allow config under "config" key as well
            if isinstance(cfg.get("config"), dict):
                merged = dict(cfg.get("config") or {})
                await run_daily_ads_pipeline(merged)
            else:
                await run_daily_ads_pipeline(cfg)
        else:
            raise ValueError(f"Unsupported task_type: {job.task_type}")

        updated = ScheduledJob(
            **{
                **job.__dict__,
                "last_run_at": job_start,
                "last_status": "started",
                "last_error": None,
            }
        )
        _scheduler_store.upsert(updated)
    except Exception as e:
        updated = ScheduledJob(
            **{
                **job.__dict__,
                "last_run_at": job_start,
                "last_status": "error",
                "last_error": str(e)[:500],
            }
        )
        _scheduler_store.upsert(updated)
        try:
            await sio.emit("error", {"msg": f"[Scheduler] Job '{job.name}' failed: {e}"})
        except Exception:
            pass


def _cancel_job_task(job_id: str) -> None:
    t = _scheduler_tasks.pop(job_id, None)
    if t and not t.done():
        t.cancel()


def _schedule_loop(job: ScheduledJob) -> asyncio.Task:
    async def runner():
        # Simple loop scheduler (no external deps).
        if job.schedule_type == "interval_minutes":
            while True:
                if job.enabled:
                    await _run_scheduled_job(job)
                await asyncio.sleep(int(job.interval_minutes or 1) * 60)
        else:
            # Minimal cron support: evaluate every minute.
            cron = _parse_cron(job.cron or "")
            while True:
                now = datetime.now()
                minute = str(now.minute)
                hour = str(now.hour)
                dom = str(now.day)
                mon = str(now.month)
                dow = str(now.weekday())  # 0=Mon..6=Sun (note: cron is often 0/7=Sun)

                def _match(field: str, value: str) -> bool:
                    if field == "*":
                        return True
                    return value in field.split(",")

                if job.enabled and all(
                    [
                        _match(cron["minute"], minute),
                        _match(cron["hour"], hour),
                        _match(cron["day"], dom),
                        _match(cron["month"], mon),
                        _match(cron["day_of_week"], dow),
                    ]
                ):
                    await _run_scheduled_job(job)
                # sleep until next minute boundary
                await asyncio.sleep(60 - datetime.now().second)

    return asyncio.create_task(runner())


def _refresh_scheduler() -> None:
    # Cancel removed jobs, update existing.
    jobs = _scheduler_store.list()
    active = {j.id for j in jobs}
    for job_id in list(_scheduler_tasks.keys()):
        if job_id not in active:
            _cancel_job_task(job_id)
    for j in jobs:
        # always restart task on refresh to pick up edits (simpler than diffing)
        _cancel_job_task(j.id)
        _scheduler_tasks[j.id] = _schedule_loop(j)


@sio.event
async def scheduler_list(sid, data=None):
    jobs = [
        {
            "id": j.id,
            "name": j.name,
            "enabled": j.enabled,
            "schedule_type": j.schedule_type,
            "interval_minutes": j.interval_minutes,
            "cron": j.cron,
            "task_type": j.task_type,
            "payload": j.payload,
            "last_run_at": j.last_run_at,
            "last_status": j.last_status,
            "last_error": j.last_error,
        }
        for j in _scheduler_store.list()
    ]
    await sio.emit("scheduler_jobs", {"jobs": jobs}, room=sid)


@sio.event
async def scheduler_create(sid, data):
    payload = data or {}
    try:
        job = _scheduler_store.create(
            name=str(payload.get("name") or "").strip(),
            schedule_type=str(payload.get("schedule_type") or "interval_minutes"),  # type: ignore[arg-type]
            interval_minutes=payload.get("interval_minutes"),
            cron=payload.get("cron"),
            task_type=str(payload.get("task_type") or "browse"),  # type: ignore[arg-type]
            payload=dict(payload.get("payload") or {}),
            enabled=bool(payload.get("enabled", True)),
        )
        _refresh_scheduler()
        await sio.emit("status", {"msg": f"[Scheduler] Saved job: {job.name} ({job.id})"}, room=sid)
        await scheduler_list(sid)
    except Exception as e:
        await sio.emit("error", {"msg": f"[Scheduler] Failed to create job: {e}"}, room=sid)


@sio.event
async def scheduler_delete(sid, data):
    payload = data or {}
    job_id = str(payload.get("id") or "").strip()
    try:
        ok = _scheduler_store.delete(job_id)
        _refresh_scheduler()
        await sio.emit(
            "status",
            {"msg": f"[Scheduler] Deleted job {job_id}" if ok else f"[Scheduler] Job not found: {job_id}"},
            room=sid,
        )
        await scheduler_list(sid)
    except Exception as e:
        await sio.emit("error", {"msg": f"[Scheduler] Failed to delete job: {e}"}, room=sid)


@sio.event
async def scheduler_run_now(sid, data):
    payload = data or {}
    job_id = str(payload.get("id") or "").strip()
    job = _scheduler_store.get(job_id)
    if not job:
        await sio.emit("error", {"msg": f"[Scheduler] Job not found: {job_id}"}, room=sid)
        return
    asyncio.create_task(_run_scheduled_job(job))
    await sio.emit("status", {"msg": f"[Scheduler] Triggered now: {job.name}"}, room=sid)


@sio.event
async def scheduler_set_enabled(sid, data):
    payload = data or {}
    job_id = str(payload.get("id") or "").strip()
    enabled = bool(payload.get("enabled", True))
    try:
        updated = _scheduler_store.set_enabled(job_id, enabled)
        if not updated:
            await sio.emit("error", {"msg": f"[Scheduler] Job not found: {job_id}"}, room=sid)
            return
        _refresh_scheduler()
        await sio.emit(
            "status",
            {"msg": f"[Scheduler] {'Enabled' if enabled else 'Disabled'}: {updated.name} ({updated.id})"},
            room=sid,
        )
        await scheduler_list(sid)
    except Exception as e:
        await sio.emit("error", {"msg": f"[Scheduler] Failed to update job: {e}"}, room=sid)


def _resample_s16le_mono(pcm: bytes, src_rate: int, dst_rate: int, state_pos: float) -> tuple[bytes, float]:
    """
    Very small, dependency-free mono PCM16 resampler.
    Keeps continuity across chunks via `state_pos` (fractional source index at start of this chunk).
    """
    if src_rate <= 0 or dst_rate <= 0 or src_rate == dst_rate:
        return pcm, state_pos

    src = array("h")
    src.frombytes(pcm)
    if sys.byteorder == "big":
        src.byteswap()

    n = len(src)
    if n < 2:
        return b"", state_pos

    # Fast path for integer decimation.
    if src_rate % dst_rate == 0:
        step = src_rate // dst_rate
        if step <= 1:
            return pcm, state_pos
        start = int(max(0, state_pos))
        out = array("h", src[start:n:step])
        # Store remainder offset for next chunk.
        # We consumed samples up to an index aligned to `step`.
        consumed = (start + (len(out) * step))
        next_pos = float(consumed - n)
        if sys.byteorder == "big":
            out.byteswap()
        return out.tobytes(), next_pos

    ratio = src_rate / dst_rate  # source samples per output sample
    pos = state_pos
    out = array("h")

    # Linear interpolation.
    while pos < (n - 1):
        i = int(pos)
        frac = pos - i
        s0 = src[i]
        s1 = src[i + 1]
        sample = (s0 * (1.0 - frac)) + (s1 * frac)
        out.append(int(max(-32768, min(32767, round(sample)))))
        pos += ratio

    next_pos = pos - n
    if sys.byteorder == "big":
        out.byteswap()
    return out.tobytes(), next_pos


def _get_openai_model() -> str:
    return os.getenv("OPENAI_MODEL") or "gpt-5"


def _openai_enabled() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def _claude_enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _get_claude_model() -> str:
    return os.getenv("CLAUDE_MODEL") or "claude-sonnet-4-20250514"


async def _claude_respond(sid: str, user_text: str) -> str:
    """Generate a text response via Anthropic Claude API."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    model = _get_claude_model()
    history = _openai_histories.setdefault(sid, [])
    history.append({"role": "user", "content": user_text})
    history[:] = history[-12:]

    system_text = (
        "You are JODA (pronounced YUODA), an Advanced Depiction Architect. "
        "Be concise and practical. If you don't know something, ask a clarifying question."
    )

    # Build messages for Claude API (alternating user/assistant)
    messages = [{"role": m["role"], "content": m["content"]} for m in history]

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model=model,
            max_tokens=1024,
            system=system_text,
            messages=messages,
        )
        out = response.content[0].text.strip()
        if not out:
            raise RuntimeError("Claude returned empty content")
        history.append({"role": "assistant", "content": out})
        history[:] = history[-12:]
        return out
    except Exception as e:
        raise RuntimeError(f"Claude API error: {e}")


def _ollama_base_url() -> str:
    return os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434"


def _ollama_models() -> list[str]:
    raw = (os.getenv("OLLAMA_MODELS") or "").strip()
    if raw:
        return [m.strip() for m in raw.split(",") if m.strip()]
    # Default to gpt-oss only (no deepseek).
    return ["gpt-oss"]


async def _ollama_list_models() -> list[str]:
    """Return locally available Ollama model names (best-effort)."""
    base_url = _ollama_base_url().rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(f"{base_url}/api/tags")
        if resp.status_code >= 400:
            return []
        data = resp.json()
        models = []
        for m in (data.get("models") or []):
            name = (m or {}).get("name")
            if name:
                models.append(str(name))
        return models
    except Exception:
        return []


async def _ollama_respond(sid: str, user_text: str) -> str:
    """Generate a text response via local Ollama (no network)."""
    base_url = _ollama_base_url().rstrip("/")
    history = _openai_histories.setdefault(sid, [])
    history.append({"role": "user", "content": user_text})
    history[:] = history[-12:]

    system_text = (
        "You are JODA (pronounced YUODA), an Advanced Depiction Architect. "
        "Be concise and practical. If you don't know something, ask a clarifying question."
    )
    messages = [{"role": "system", "content": system_text}] + [
        {"role": m["role"], "content": m["content"]} for m in history
    ]

    available = set(await _ollama_list_models())
    candidates = _ollama_models()
    if available:
        # Prefer installed models; keep order from candidates.
        expanded = []
        for c in candidates:
            if c in available:
                expanded.append(c)
                continue
            # If user provided "foo" but only "foo:latest" is installed (or vice versa), try to match.
            if ":" not in c and f"{c}:latest" in available:
                expanded.append(f"{c}:latest")
                continue
            # If user provided "foo" but an alternate tag exists (e.g., foo:20b-cloud), pick the first match.
            if ":" not in c:
                tagged = sorted([m for m in available if m.startswith(f"{c}:")])
                if tagged:
                    expanded.append(tagged[0])
                    continue
            if ":" in c and c.split(":", 1)[0] in available:
                expanded.append(c.split(":", 1)[0])
                continue
        # If none match, fall back to first available model.
        candidates = expanded or list(available)

    last_err: Exception | None = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for model in candidates:
            try:
                resp = await client.post(
                    f"{base_url}/api/chat",
                    json={"model": model, "messages": messages, "stream": False},
                )
                if resp.status_code >= 400:
                    raise RuntimeError(f"Ollama error {resp.status_code}: {resp.text[:200]}")
                data = resp.json()
                out = ((data.get("message") or {}).get("content") or "").strip()
                if not out:
                    raise RuntimeError("Ollama returned empty content")
                history.append({"role": "assistant", "content": out})
                history[:] = history[-12:]
                return out
            except Exception as e:
                last_err = e
                continue

    if available:
        raise RuntimeError(
            f"Ollama fallback failed: {last_err}. Available models: {', '.join(sorted(available))}"
        )
    raise RuntimeError(f"Ollama fallback failed: {last_err}. No models found (try `ollama list`).")


async def _openai_respond(sid: str, user_text: str) -> str:
    """Generate a text response via OpenAI Responses API."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    model = _get_openai_model()
    history = _openai_histories.setdefault(sid, [])
    history.append({"role": "user", "content": user_text})
    # Keep small history window
    history[:] = history[-12:]

    system_text = (
        "You are JODA (pronounced YUODA), an Advanced Depiction Architect. "
        "Be concise and practical. If you don't know something, ask a clarifying question."
    )

    # Responses API schema
    payload_input = [
        {
            "role": "system",
            "content": [{"type": "input_text", "text": system_text}],
        }
    ]
    for msg in history:
        payload_input.append(
            {"role": msg["role"], "content": [{"type": "input_text", "text": msg["content"]}]}
        )

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "input": payload_input,
                "max_output_tokens": 600,
            },
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"OpenAI error {resp.status_code}: {resp.text[:200]}")
        data = resp.json()

    text_parts = []
    for item in data.get("output", []) or []:
        for c in item.get("content", []) or []:
            if c.get("type") == "output_text" and c.get("text"):
                text_parts.append(c["text"])
    out_text = "\n".join(text_parts).strip()
    if not out_text:
        out_text = "(No response text returned.)"

    history.append({"role": "assistant", "content": out_text})
    history[:] = history[-12:]
    return out_text

async def _text_fallback_chain(sid: str, text: str, context: str = "") -> str | None:
    """Try Claude → OpenAI → Ollama (gpt-oss) for text-only responses.

    Returns the response text, or None if all providers failed (errors are
    emitted to the client via Socket.IO).
    """
    prefix = f"{context}; " if context else ""

    # 1. Claude (preferred text fallback)
    if _claude_enabled():
        await sio.emit(
            'status',
            {'msg': f'{prefix}Using Claude ({_get_claude_model()}; text-only)'},
            room=sid,
        )
        try:
            return await _claude_respond(sid, text)
        except Exception as e:
            print(f"[FALLBACK] Claude failed: {e}")
            await sio.emit('status', {'msg': f'Claude failed; trying next provider...'}, room=sid)

    # 2. OpenAI (if configured)
    if _openai_enabled():
        await sio.emit(
            'status',
            {'msg': f'{prefix}Using OpenAI ({_get_openai_model()}; text-only)'},
            room=sid,
        )
        try:
            return await _openai_respond(sid, text)
        except Exception as e:
            print(f"[FALLBACK] OpenAI failed: {e}")
            await sio.emit('status', {'msg': f'OpenAI failed; trying Ollama...'}, room=sid)

    # 3. Ollama (gpt-oss, final fallback)
    await sio.emit(
        'status',
        {'msg': f'{prefix}Using Ollama ({", ".join(_ollama_models())}; text-only)'},
        room=sid,
    )
    try:
        return await _ollama_respond(sid, text)
    except Exception as e:
        await sio.emit('error', {'msg': f'All text providers failed. Last error: {e}'}, room=sid)
        return None


DEFAULT_SETTINGS = {
    "face_auth_enabled": False, # Default OFF as requested
    "tool_permissions": {
        "generate_cad": True,
        "run_web_agent": True,
        "run_browser_use": True,
        "write_file": True,
        "read_directory": True,
        "read_file": True,
        "create_project": True,
        "switch_project": True,
        "list_projects": True
    },
    "printers": [], # List of {host, port, name, type}
    "kasa_devices": [], # List of {ip, alias, model}
    "camera_flipped": False # Invert cursor horizontal direction
}

SETTINGS = DEFAULT_SETTINGS.copy()

# Default to the larger gdrive-backed workspace for orchestration runs.
JODA_PROJECT_ROOT = Path(
    os.getenv("JODA_PROJECT_ROOT", "/home/yoda_external_storage_server/biz_automate")
).resolve()

def _list_ralph_projects(root: Path) -> list[str]:
    """List candidate project folders under root (top-level only)."""
    try:
        items = []
        for p in root.iterdir():
            if not p.is_dir():
                continue
            name = p.name
            if name.startswith("."):
                continue
            items.append(name)
        return sorted(items)
    except Exception:
        return []

def _read_text_snippet(path: Path, limit: int = 6000) -> str:
    try:
        if not path.exists() or not path.is_file():
            return ""
        text = path.read_text(encoding="utf-8", errors="replace")
        text = text.strip()
        if len(text) <= limit:
            return text
        return text[:limit] + "\n\n...[truncated]..."
    except Exception:
        return ""

def _default_ralph_prompt(project_dir: Path, mode: str) -> str:
    prompt_md = _read_text_snippet(project_dir / "PROMPT.md")
    context_md = _read_text_snippet(project_dir / "CONTEXT.md")
    todo_exists = (project_dir / "TODO.md").exists()

    if mode == "todo":
        goal = (
            "Create or update TODO.md for this project based on PROMPT.md and CONTEXT.md. "
            "Do NOT implement tasks; only produce a high-quality TODO.md with actionable, ordered steps."
        )
    else:
        goal = (
            "Create or update TODO.md for this project based on PROMPT.md and CONTEXT.md, "
            "then start implementing tasks from TODO.md in order until you hit limits."
        )

    parts = [
        f"# JODA → Ralph Orchestrator\n\nProject: {project_dir}\nMode: {mode}\n",
        "## Goal\n" + goal + "\n",
        "## Constraints\n"
        "- Work only inside this project directory.\n"
        "- Keep changes small and focused.\n"
        "- Prefer running existing tests/commands for this project when available.\n"
        "- If PROMPT.md/CONTEXT.md are missing, infer reasonable TODOs from the repo structure.\n",
        f"## Existing Files\n- TODO.md exists: {todo_exists}\n",
    ]

    if prompt_md:
        parts.append("## PROMPT.md\n" + prompt_md + "\n")
    if context_md:
        parts.append("## CONTEXT.md\n" + context_md + "\n")

    parts.append(
        "## Output Requirements\n"
        "- Always write TODO.md at the project root.\n"
        "- If implementing tasks (mode=build), update TODO.md as tasks complete.\n"
    )

    return "\n".join(parts)

def _resolve_under_root(root: Path, relative_path: str) -> Path:
    """Resolve a relative path safely under a root directory."""
    rel = (relative_path or "").strip()
    # Treat empty as root
    candidate = (root / rel) if rel else root
    resolved = candidate.resolve()
    root_resolved = root.resolve()
    if resolved == root_resolved:
        return resolved
    # Python 3.9 compat for is_relative_to
    if not str(resolved).startswith(str(root_resolved) + os.sep):
        raise ValueError(f"Path '{relative_path}' is outside allowed root '{root_resolved}'")
    return resolved

def _find_ralph_command() -> list[str] | None:
    """Return argv prefix to invoke ralph, or None if not found."""
    ralph_bin = shutil.which("ralph")
    if ralph_bin:
        return [ralph_bin]

    # Prefer ralph-orchestrator venv if present.
    for venv_dir in (".venv", ".venv2"):
        candidate = JODA_PROJECT_ROOT / "ralph-orchestrator" / venv_dir / "bin" / "ralph"
        if candidate.exists():
            return [str(candidate)]

    # Fallback: python -m ralph_orchestrator from ralph-orchestrator venv.
    for venv_dir in (".venv", ".venv2"):
        py = JODA_PROJECT_ROOT / "ralph-orchestrator" / venv_dir / "bin" / "python"
        if py.exists():
            return [str(py), "-m", "ralph_orchestrator"]

    return None

def _ensure_ralph_workspace(project_dir: Path) -> None:
    """Create a minimal Ralph workspace without initializing a nested git repo."""
    (project_dir / ".agent" / "prompts").mkdir(parents=True, exist_ok=True)
    (project_dir / ".agent" / "checkpoints").mkdir(parents=True, exist_ok=True)
    (project_dir / ".agent" / "metrics").mkdir(parents=True, exist_ok=True)
    (project_dir / ".agent" / "plans").mkdir(parents=True, exist_ok=True)
    (project_dir / ".agent" / "memory").mkdir(parents=True, exist_ok=True)
    (project_dir / ".agent" / "cache").mkdir(parents=True, exist_ok=True)

    prompt_file = project_dir / "PROMPT.md"
    if not prompt_file.exists():
        prompt_file.write_text(
            "# Task: [Describe your task here]\n\n## Requirements\n- [ ] Requirement 1\n\n## Success Criteria\n- Tests pass\n",
            encoding="utf-8",
        )

    config_file = project_dir / "ralph.yml"
    if not config_file.exists():
        config_file.write_text(
            "agent: auto\nprompt_file: PROMPT.md\nmax_iterations: 50\nmax_runtime: 3600\nverbose: false\n",
            encoding="utf-8",
        )

async def _stream_process_output(proc: asyncio.subprocess.Process, sid: str, event: str) -> None:
    if not proc.stdout:
        return
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        try:
            await sio.emit(event, {"line": line.decode(errors="replace")}, room=sid)
        except Exception:
            # Don't crash the runner on emit errors
            pass

async def _run_ralph_job(sid: str, project_dir: Path, prompt_text: str | None, args: dict) -> None:
    cmd_prefix = _find_ralph_command()
    if not cmd_prefix:
        await sio.emit(
            "error",
            {"msg": f"Ralph not found. Expected in PATH or under {JODA_PROJECT_ROOT / 'ralph-orchestrator'}"},
            room=sid,
        )
        return

    _ensure_ralph_workspace(project_dir)

    agent = (args.get("agent") or "").strip() or "auto"
    max_iterations = int(args.get("max_iterations") or 50)
    max_runtime = int(args.get("max_runtime") or 3600)
    config_path = (args.get("config") or "ralph.yml").strip()
    mode = (args.get("mode") or "").strip().lower() or "build"

    # If no explicit prompt was supplied, generate one.
    if not prompt_text:
        prompt_text = _default_ralph_prompt(project_dir, mode="todo" if mode == "todo" else "build")

    # Run: ralph run -a <agent> -i <iters> -t <seconds> -c <config>
    cmd = [*cmd_prefix, "run", "-a", agent, "-i", str(max_iterations), "-t", str(max_runtime), "-c", config_path]

    # Optional: codex via ACP (if available)
    if args.get("codex"):
        cmd.append("--codex")
        if args.get("codex_permission_mode"):
            cmd.extend(["--codex-permission-mode", str(args["codex_permission_mode"])])
        if args.get("codex_model"):
            cmd.extend(["--codex-model", str(args["codex_model"])])
        if args.get("codex_reasoning_effort"):
            cmd.extend(["--codex-reasoning-effort", str(args["codex_reasoning_effort"])])

    # Use prompt-text to avoid overwriting project PROMPT.md unless user chooses to.
    if prompt_text:
        cmd.extend(["-p", prompt_text])

    await sio.emit(
        "ralph_status",
        {"status": "starting", "project": str(project_dir), "cmd": " ".join(cmd)},
        room=sid,
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(project_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except Exception as e:
        await sio.emit("error", {"msg": f"Failed to start Ralph: {e}"}, room=sid)
        return

    await _stream_process_output(proc, sid, "ralph_log")
    code = await proc.wait()
    await sio.emit(
        "ralph_status",
        {"status": "finished", "project": str(project_dir), "exit_code": code},
        room=sid,
    )

def load_settings():
    global SETTINGS
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r') as f:
                loaded = json.load(f)
                # Merge with defaults to ensure new keys exist
                # Deep merge for tool_permissions would be better but shallow merge of top keys + tool_permissions check is okay for now
                for k, v in loaded.items():
                    if k == "tool_permissions" and isinstance(v, dict):
                         SETTINGS["tool_permissions"].update(v)
                    else:
                        SETTINGS[k] = v
            print(f"Loaded settings: {SETTINGS}")
        except Exception as e:
            print(f"Error loading settings: {e}")

def save_settings():
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(SETTINGS, f, indent=4)
        print("Settings saved.")
    except Exception as e:
        print(f"Error saving settings: {e}")

# Load on startup
load_settings()

authenticator = None
kasa_agent = KasaAgent(known_devices=SETTINGS.get("kasa_devices"))
# tool_permissions is now SETTINGS["tool_permissions"]

@app.on_event("startup")
async def startup_event():
    import sys
    print(f"[SERVER DEBUG] Startup Event Triggered")
    print(f"[SERVER DEBUG] Python Version: {sys.version}")
    try:
        loop = asyncio.get_running_loop()
        print(f"[SERVER DEBUG] Running Loop: {type(loop)}")
        policy = asyncio.get_event_loop_policy()
        print(f"[SERVER DEBUG] Current Policy: {type(policy)}")
    except Exception as e:
        print(f"[SERVER DEBUG] Error checking loop: {e}")

    print("[SERVER] Startup: Initializing Kasa Agent...")
    await kasa_agent.initialize()

    # Register Agent Zero endpoints
    print("[AGENT ZERO] Registering Agent Zero communication endpoints...")
    try:
        from agent_zero_endpoints import register_agent_zero_endpoints
        register_agent_zero_endpoints(app, sio)
    except Exception as e:
        print(f"[AGENT ZERO] Warning: Failed to register endpoints: {e}")

@app.get("/status")
async def status():
    return {"status": "running", "service": "JODA Backend"}

# --- Option 3: On-demand "ask Joda" endpoint (for Clawdbot relay) ---
# Simple text-only route. Uses OpenAI fallback if configured; else Ollama.
# This avoids entangling with the realtime audio session.
@app.post("/relay/ask")
async def relay_ask(payload: dict):
    text = (payload or {}).get("text")
    if not text or not str(text).strip():
        raise HTTPException(status_code=400, detail="Missing 'text'.")

    sid = "telegram-relay"
    try:
        # Fallback chain: Claude → OpenAI → Ollama
        out = await _text_fallback_chain(sid, str(text), context="Relay")
        if out is None:
            raise RuntimeError("All text providers failed")

        # Keep frontend UI in sync too (optional):
        try:
            await sio.emit('transcription', {'sender': 'JODA', 'text': out})
        except Exception:
            pass

        return {"ok": True, "text": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"relay_ask failed: {e}")

@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")
    await sio.emit('status', {'msg': 'Connected to JODA Backend'}, room=sid)
    _openai_histories.setdefault(sid, [])
    # Kick scheduler (best-effort) so recurring jobs run even without further UI interaction.
    try:
        _refresh_scheduler()
    except Exception:
        pass

    global authenticator
    
    # Callback for Auth Status
    async def on_auth_status(is_auth):
        print(f"[SERVER] Auth status change: {is_auth}")
        await sio.emit('auth_status', {'authenticated': is_auth})

    # Callback for Auth Camera Frames
    async def on_auth_frame(frame_b64):
        await sio.emit('auth_frame', {'image': frame_b64})

    # Initialize Authenticator if not already done
    if authenticator is None:
        authenticator = FaceAuthenticator(
            reference_image_path="reference.jpg",
            on_status_change=on_auth_status,
            on_frame=on_auth_frame
        )
    
    # Check if already authenticated or needs to start
    if authenticator.authenticated:
        await sio.emit('auth_status', {'authenticated': True})
    else:
        # Check Settings for Auth
        if SETTINGS.get("face_auth_enabled", False):
            await sio.emit('auth_status', {'authenticated': False})
            # Start the auth loop in background
            asyncio.create_task(authenticator.start_authentication_loop())
        else:
            # Bypass Auth
            print("Face Auth Disabled. Auto-authenticating.")
            # We don't change authenticator state to true to avoid confusion if re-enabled? 
            # Or we should just tell client it's auth'd.
            await sio.emit('auth_status', {'authenticated': True})

@sio.event
async def disconnect(sid):
    print(f"Client disconnected: {sid}")
    _openai_histories.pop(sid, None)
    _mic_debug_seen.discard(sid)
    _mic_resample_state.pop(sid, None)
    _mic_sample_rates.pop(sid, None)
    _mic_bytes_counter.pop(sid, None)
    _browser_secrets.pop(sid, None)


@sio.event
async def set_browser_secrets(sid, data):
    """
    Store per-session credentials for browser automation.
    These are held in memory only and are never written to disk.
    """
    payload = data or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    if not username and not password:
        _browser_secrets.pop(sid, None)
        if audio_loop:
            try:
                audio_loop.set_browser_secrets(None)
            except Exception:
                pass
        await sio.emit("status", {"msg": "Browser credentials cleared."}, room=sid)
        return
    _browser_secrets[sid] = {"USERNAME": username, "PASSWORD": password}
    if audio_loop:
        try:
            audio_loop.set_browser_secrets(_browser_secrets[sid])
        except Exception:
            pass
    await sio.emit("status", {"msg": "Browser credentials saved for this session (memory-only)."}, room=sid)


@sio.event
async def clear_browser_secrets(sid):
    _browser_secrets.pop(sid, None)
    if audio_loop:
        try:
            audio_loop.set_browser_secrets(None)
        except Exception:
            pass
    await sio.emit("status", {"msg": "Browser credentials cleared."}, room=sid)

@sio.event
async def start_audio(sid, data=None):
    global audio_loop, loop_task
    
    # Optional: Block if not authenticated
    # Only block if auth is ENABLED and not authenticated
    if SETTINGS.get("face_auth_enabled", False):
        if authenticator and not authenticator.authenticated:
            print("Blocked start_audio: Not authenticated.")
            await sio.emit('error', {'msg': 'Authentication Required'})
            return

    print("Starting Audio Loop...")

    # If Gemini isn't configured, keep the UI usable via Claude/OpenAI/Ollama text fallback.
    if not os.getenv("GEMINI_API_KEY"):
        if _claude_enabled():
            await sio.emit(
                'status',
                {'msg': f'JODA Started (Claude Fallback: {_get_claude_model()} text-only)'},
                room=sid,
            )
        elif _openai_enabled():
            await sio.emit(
                'status',
                {'msg': f'JODA Started (OpenAI Fallback: {_get_openai_model()} text-only)'},
                room=sid,
            )
        else:
            # Ollama is local; try to detect availability quickly.
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    await client.get(f"{_ollama_base_url().rstrip('/')}/api/tags")
                await sio.emit(
                    'status',
                    {'msg': f'JODA Started (Ollama Fallback: {", ".join(_ollama_models())} text-only)'},
                    room=sid,
                )
            except Exception:
                await sio.emit(
                    'status',
                    {'msg': 'JODA Started (No GEMINI_API_KEY; set ANTHROPIC_API_KEY, OPENAI_API_KEY, or run Ollama)'},
                    room=sid,
                )
        return
    
    device_index = None
    device_name = None
    if data:
        if 'device_index' in data:
            device_index = data['device_index']
        if 'device_name' in data:
            device_name = data['device_name']
        audio_source = data.get('audio_source')
            
    print(f"Using input device: Name='{device_name}', Index={device_index}")
    
    if audio_loop:
        if loop_task and (loop_task.done() or loop_task.cancelled()):
             print("Audio loop task appeared finished/cancelled. Clearing and restarting...")
             audio_loop = None
             loop_task = None
        else:
             print("Audio loop already running. Re-connecting client to session.")
             # Apply requested web-audio mode even on reconnects.
             if data and data.get("audio_source") == "browser":
                 try:
                     audio_loop.enable_external_audio(True)
                     print("[SERVER] Enabling external (browser) audio input.")
                 except Exception as e:
                     print(f"[SERVER] Failed to enable external audio: {e}")
             # Apply mute state for this client.
             if data and "muted" in data:
                 try:
                     audio_loop.set_paused(bool(data.get("muted")))
                 except Exception:
                     pass
             await sio.emit('status', {'msg': 'JODA Already Running'})
             return


    # Callback to send audio data to frontend
    def on_audio_data(data_bytes):
        # We need to schedule this on the event loop
        # This is high frequency, so we might want to downsample or batch if it's too much
        asyncio.create_task(sio.emit('audio_data', {'data': list(data_bytes)}))

    # Callback to send CAL data to frontend
    def on_cad_data(data):
        info = f"{len(data.get('vertices', []))} vertices" if 'vertices' in data else f"{len(data.get('data', ''))} bytes (STL)"
        print(f"Sending CAD data to frontend: {info}")
        asyncio.create_task(sio.emit('cad_data', data))

    # Callback to send Browser data to frontend
    def on_web_data(data):
        print(f"Sending Browser data to frontend: {len(data.get('log', ''))} chars logs")
        asyncio.create_task(sio.emit('browser_frame', data))
        
    # Callback to send Transcription data to frontend
    def on_transcription(data):
        # data = {"sender": "User"|"JODA", "text": "..."}
        asyncio.create_task(sio.emit('transcription', data))

        # Option 2: also relay JODA's final text into Telegram (single-bot identity).
        try:
            if isinstance(data, dict) and data.get('sender') == 'JODA':
                txt = data.get('text')
                if txt:
                    asyncio.create_task(_relay_to_telegram_via_clawdbot(str(txt)))
        except Exception:
            pass

    # Callback to send Confirmation Request to frontend
    def on_tool_confirmation(data):
        # data = {"id": "uuid", "tool": "tool_name", "args": {...}}
        print(f"Requesting confirmation for tool: {data.get('tool')}")
        asyncio.create_task(sio.emit('tool_confirmation_request', data))

    # Callback to send CAD status to frontend
    def on_cad_status(status):
        # status can be: 
        # - a string like "generating" (from joda.py handle_cad_request)
        # - a dict with {status, attempt, max_attempts, error} (from CadAgent)
        if isinstance(status, dict):
            print(f"Sending CAD Status: {status.get('status')} (attempt {status.get('attempt')}/{status.get('max_attempts')})")
            asyncio.create_task(sio.emit('cad_status', status))
        else:
            # Legacy: simple string
            print(f"Sending CAD Status: {status}")
            asyncio.create_task(sio.emit('cad_status', {'status': status}))

    # Callback to send CAD thoughts to frontend (streaming)
    def on_cad_thought(thought_text):
        asyncio.create_task(sio.emit('cad_thought', {'text': thought_text}))

    # Callback to send Project Update to frontend
    def on_project_update(project_name):
        print(f"Sending Project Update: {project_name}")
        asyncio.create_task(sio.emit('project_update', {'project': project_name}))

    # Callback to send Device Update to frontend
    def on_device_update(devices):
        # devices is a list of dicts
        print(f"Sending Kasa Device Update: {len(devices)} devices")
        asyncio.create_task(sio.emit('kasa_devices', devices))

    # Callback to send image generation status updates to frontend
    def on_image_status(data):
        print(f"Sending image_status to frontend: {data.get('status', '?')}")
        asyncio.create_task(sio.emit('image_status', data))

    # Callback to send Media Asset (generated images, etc.) to frontend
    def on_media_asset(asset):
        print(f"Sending Media Asset to frontend: {asset.get('filename', 'unknown')}")
        asyncio.create_task(sio.emit('media_asset', asset))

    # Callback to send Error to frontend
    def on_error(msg):
        print(f"Sending Error to frontend: {msg}")
        asyncio.create_task(sio.emit('error', {'msg': msg}))

    # Initialize JODA (import lazily; this import is heavy and can hang in some environments)
    try:
        import joda
        print(f"Initializing AudioLoop with device_index={device_index}")
        audio_loop = joda.AudioLoop(
            video_mode="none",
            on_audio_data=on_audio_data,
            on_cad_data=on_cad_data,
            on_web_data=on_web_data,
            on_transcription=on_transcription,
            on_tool_confirmation=on_tool_confirmation,
            on_cad_status=on_cad_status,
            on_cad_thought=on_cad_thought,
            on_project_update=on_project_update,
            on_device_update=on_device_update,
            on_error=on_error,
            on_media_asset=on_media_asset,
            on_image_status=on_image_status,

            input_device_index=device_index,
            input_device_name=device_name,
            kasa_agent=kasa_agent
        )
        print("AudioLoop initialized successfully.")

        # If the user saved browser credentials before starting, apply them now.
        try:
            audio_loop.set_browser_secrets(_browser_secrets.get(sid))
        except Exception:
            pass

        # If requested, accept mic audio from the web client instead of server-side PyAudio.
        if data and data.get("audio_source") == "browser":
            print("[SERVER] Enabling external (browser) audio input.")
            audio_loop.enable_external_audio(True)

        # Apply current permissions
        audio_loop.update_permissions(SETTINGS["tool_permissions"])
        
        # Check initial mute state
        if data and data.get('muted', False):
            print("Starting with Audio Paused")
            audio_loop.set_paused(True)

        print("Creating asyncio task for AudioLoop.run()")
        start_message = (
            'Introduce yourself by saying exactly: "I am Joda, the conversational AI running this show, '
            'created by Dr Joseph Davids." When speaking aloud, pronounce '
            '"Joda" as "YUODA" (pronounced "YOO-DA"). '
            "You can browse the filesystem: projects are real folders on disk and can be listed/read; you are "
            "not limited to abstract contexts."
        )
        loop_task = asyncio.create_task(audio_loop.run(start_message=start_message))
        
        # Add a done callback to catch silent failures in the loop
        def handle_loop_exit(task):
            try:
                task.result()
            except asyncio.CancelledError:
                print("Audio Loop Cancelled")
            except Exception as e:
                print(f"Audio Loop Crashed: {e}")
                # If Gemini is unavailable (quota/network), fall back to text-only mode.
                try:
                    msg = str(e)
                    gemini_unavailable = any(
                        s in msg.lower()
                        for s in (
                            "resource_exhausted",
                            "quota exceeded",
                            "too many requests",
                            "429",
                            "deadline expired",
                        )
                    )
                    if gemini_unavailable:
                        # Stop the loop to avoid hot reconnect retries.
                        try:
                            audio_loop.stop()
                        except Exception:
                            pass
                        # Clear global so user_input routes into Claude/OpenAI/Ollama fallback.
                        globals()["audio_loop"] = None
                        if _claude_enabled():
                            fallback = f"Gemini unavailable; using Claude fallback ({_get_claude_model()}; text-only)"
                        elif _openai_enabled():
                            fallback = f"Gemini unavailable; using OpenAI fallback ({_get_openai_model()}; text-only)"
                        else:
                            fallback = f"Gemini unavailable; using Ollama fallback ({', '.join(_ollama_models())}; text-only)"
                        asyncio.create_task(sio.emit("status", {"msg": fallback}))
                except Exception:
                    pass
        
        loop_task.add_done_callback(handle_loop_exit)
        
        print("Emitting 'JODA Started'")
        await sio.emit('status', {'msg': 'JODA Started'})

        # Load saved printers
        saved_printers = SETTINGS.get("printers", [])
        if saved_printers and audio_loop.printer_agent:
            print(f"[SERVER] Loading {len(saved_printers)} saved printers...")
            for p in saved_printers:
                audio_loop.printer_agent.add_printer_manually(
                    name=p.get("name", p["host"]),
                    host=p["host"],
                    port=p.get("port", 80),
                    printer_type=p.get("type", "moonraker"),
                    camera_url=p.get("camera_url")
                )
        
        # Start Printer Monitor
        asyncio.create_task(monitor_printers_loop())
    except Exception as e:
        audio_loop = None
        msg = f"Failed to start Gemini audio loop: {e}"
        print(f"[SERVER] {msg}")
        await sio.emit("status", {"msg": msg}, room=sid)
        # Keep UI usable via text-only fallback.
        if _claude_enabled():
            await sio.emit(
                "status",
                {"msg": f"Using Claude fallback ({_get_claude_model()}; text-only)"},
                room=sid,
            )
        elif _openai_enabled():
            await sio.emit(
                "status",
                {"msg": f"Using OpenAI fallback ({_get_openai_model()}; text-only)"},
                room=sid,
            )
        else:
            await sio.emit("status", {"msg": "Gemini unavailable; set ANTHROPIC_API_KEY, OPENAI_API_KEY, or run Ollama"}, room=sid)
        return
        
    except Exception as e:
        print(f"CRITICAL ERROR STARTING JODA: {e}")
        import traceback
        traceback.print_exc()
        await sio.emit('error', {'msg': f"Failed to start: {str(e)}"})
        audio_loop = None # Ensure we can try again


async def monitor_printers_loop():
    """Background task to query printer status periodically."""
    print("[SERVER] Starting Printer Monitor Loop")
    while audio_loop and audio_loop.printer_agent:
        try:
            agent = audio_loop.printer_agent
            if not agent.printers:
                await asyncio.sleep(5)
                continue
                
            tasks = []
            for host, printer in agent.printers.items():
                if printer.printer_type.value != "unknown":
                    tasks.append(agent.get_print_status(host))
            
            if tasks:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for res in results:
                    if isinstance(res, Exception):
                        pass # Ignore errors for now
                    elif res:
                        # res is PrintStatus object
                        await sio.emit('print_status_update', res.to_dict())
                        
        except asyncio.CancelledError:
            print("[SERVER] Printer Monitor Cancelled")
            break
        except Exception as e:
            print(f"[SERVER] Monitor Loop Error: {e}")
            
        await asyncio.sleep(2) # Update every 2 seconds for responsiveness

@sio.event
async def stop_audio(sid):
    global audio_loop
    if audio_loop:
        audio_loop.stop() 
        print("Stopping Audio Loop")
        audio_loop = None
        await sio.emit('status', {'msg': 'JODA Stopped'})

@sio.event
async def pause_audio(sid):
    global audio_loop
    if audio_loop:
        audio_loop.set_paused(True)
        print("Pausing Audio")
        await sio.emit('status', {'msg': 'Audio Paused'})

@sio.event
async def resume_audio(sid):
    global audio_loop
    if audio_loop:
        audio_loop.set_paused(False)
        print("Resuming Audio")
        await sio.emit('status', {'msg': 'Audio Resumed'})

@sio.event
async def run_web_agent(sid, data):
    """Directly run the web agent without requiring a model tool call."""
    global audio_loop
    if not audio_loop:
        await sio.emit('error', {'msg': 'JODA not started. Turn power on first.'}, room=sid)
        return
    prompt = (data or {}).get('prompt', '').strip()
    if not prompt:
        await sio.emit('error', {'msg': 'Missing web agent prompt.'}, room=sid)
        return
    print(f"[SERVER] Direct web agent request: {prompt}")
    secrets = _browser_secrets.get(sid)
    asyncio.create_task(audio_loop.handle_web_agent_request(prompt, secrets=secrets))
    await sio.emit('status', {'msg': 'Web agent started'}, room=sid)

@sio.event
async def run_browser_use(sid, data):
    """
    Directly run a browser task (browser-use wrapper) without requiring a model tool call.
    Falls back to the existing Playwright web agent if browser-use isn't installed/configured.
    """
    global audio_loop
    if not audio_loop:
        await sio.emit('error', {'msg': 'JODA not started. Turn power on first.'}, room=sid)
        return
    if not SETTINGS.get("tool_permissions", {}).get("run_browser_use", True):
        await sio.emit('error', {'msg': 'Browser task tool is disabled in settings.'}, room=sid)
        return
    prompt = (data or {}).get('prompt', '').strip()
    if not prompt:
        await sio.emit('error', {'msg': 'Missing browser task prompt.'}, room=sid)
        return
    print(f"[SERVER] Direct browser task request: {prompt}")
    secrets = _browser_secrets.get(sid)
    asyncio.create_task(audio_loop.handle_browser_use_request(prompt, secrets=secrets))
    await sio.emit('status', {'msg': 'Browser task started'}, room=sid)

@sio.event
async def generate_cad(sid, data):
    """Directly run CAD generation without requiring a model tool call."""
    global audio_loop
    if not audio_loop:
        await sio.emit('error', {'msg': 'JODA not started. Turn power on first.'}, room=sid)
        return
    prompt = (data or {}).get('prompt', '').strip()
    if not prompt:
        await sio.emit('error', {'msg': 'Missing CAD prompt.'}, room=sid)
        return
    print(f"[SERVER] Direct CAD request: {prompt}")
    asyncio.create_task(audio_loop.handle_cad_request(prompt))
    await sio.emit('status', {'msg': 'CAD generation started'}, room=sid)

@sio.event
async def ralph_run(sid, data):
    """Run Ralph Orchestrator against a project folder inside the workspace."""
    try:
        payload = data or {}
        project = payload.get("project") or ""
        prompt_text = payload.get("prompt")
        if not project.strip():
            await sio.emit(
                "ralph_projects",
                {"root": str(JODA_PROJECT_ROOT), "projects": _list_ralph_projects(JODA_PROJECT_ROOT)},
                room=sid,
            )
            await sio.emit("error", {"msg": "Choose a project folder to run Ralph against."}, room=sid)
            return
        project_dir = _resolve_under_root(JODA_PROJECT_ROOT, project)
        if not project_dir.exists() or not project_dir.is_dir():
            await sio.emit("error", {"msg": f"Project folder not found: {project_dir}"}, room=sid)
            return
        asyncio.create_task(_run_ralph_job(sid, project_dir, prompt_text, payload))
    except Exception as e:
        await sio.emit("error", {"msg": f"ralph_run failed: {e}"}, room=sid)

@sio.event
async def ralph_list_projects(sid, data=None):
    """List candidate project folders under the configured root."""
    await sio.emit(
        "ralph_projects",
        {"root": str(JODA_PROJECT_ROOT), "projects": _list_ralph_projects(JODA_PROJECT_ROOT)},
        room=sid,
    )

@sio.event
async def list_joda_projects(sid, data=None):
    """List JODA's internal project folders (backend ProjectManager)."""
    global audio_loop
    if not audio_loop or not getattr(audio_loop, "project_manager", None):
        await sio.emit("error", {"msg": "JODA not started. Turn power on first."}, room=sid)
        return
    pm = audio_loop.project_manager
    projects = []
    try:
        projects = sorted(pm.list_projects())
    except Exception:
        projects = []
    root = str(getattr(pm, "projects_dir", "")) if getattr(pm, "projects_dir", None) else ""
    await sio.emit("joda_projects", {"root": root, "projects": projects}, room=sid)

@sio.event
async def confirm_tool(sid, data):
    # data: { "id": "...", "confirmed": True/False }
    request_id = data.get('id')
    confirmed = data.get('confirmed', False)
    
    print(f"[SERVER DEBUG] Received confirmation response for {request_id}: {confirmed}")
    
    if audio_loop:
        audio_loop.resolve_tool_confirmation(request_id, confirmed)
    else:
        print("Audio loop not active, cannot resolve confirmation.")

@sio.event
async def shutdown(sid, data=None):
    """Gracefully shutdown the server when the application closes."""
    global audio_loop, loop_task, authenticator
    
    print("[SERVER] ========================================")
    print("[SERVER] SHUTDOWN SIGNAL RECEIVED FROM FRONTEND")
    print("[SERVER] ========================================")
    
    # Stop audio loop
    if audio_loop:
        print("[SERVER] Stopping Audio Loop...")
        audio_loop.stop()
        audio_loop = None
    
    # Cancel the loop task if running
    if loop_task and not loop_task.done():
        print("[SERVER] Cancelling loop task...")
        loop_task.cancel()
        loop_task = None
    
    # Stop authenticator if running
    if authenticator:
        print("[SERVER] Stopping Authenticator...")
        authenticator.stop()
    
    print("[SERVER] Graceful shutdown complete. Terminating process...")
    
    # Force exit immediately - os._exit bypasses cleanup but ensures termination
    os._exit(0)

@sio.event
async def user_input(sid, data):
    text = (data.get('text') or "").strip()
    print(f"[SERVER DEBUG] User input received: '{text}'")

    # Server-side slash commands (work even if the model session is down)
    if text.lower() == "/projects":
        await list_joda_projects(sid)
        return
    if text.lower() == "/ralph":
        await ralph_list_projects(sid)
        return
    if text.lower() == "/skills":
        try:
            skills = _browser_skills.list()
            if not skills:
                await sio.emit("status", {"msg": "No browser skills saved yet."}, room=sid)
                return
            msg = ["Browser skills (local):"]
            for s in skills[:30]:
                msg.append(f"- {s.name} ({s.id})")
            await sio.emit("status", {"msg": "\n".join(msg)}, room=sid)
        except Exception as e:
            await sio.emit("error", {"msg": f"Failed to list skills: {e}"}, room=sid)
        return
    if text.lower() == "/scheduler":
        await scheduler_list(sid)
        await sio.emit(
            "status",
            {
                "msg": (
                    "Scheduler:\n"
                    "- /scheduler (list jobs)\n"
                    "- Create: emit scheduler_create {name,schedule_type,interval_minutes|cron,task_type,payload}\n"
                    "- Run now: emit scheduler_run_now {id}\n"
                    "- Delete: emit scheduler_delete {id}\n"
                    "- Enable/disable: emit scheduler_set_enabled {id,enabled}"
                )
            },
            room=sid,
        )
        return
    if text.lower().startswith("/schedule"):
        # Convenience chat commands:
        # - /schedule list
        # - /schedule every <minutes> <browse|web> <name> :: <prompt>
        # - /schedule cron "<min hour dom mon dow>" <browse|web> <name> :: <prompt>
        # - /schedule run <id>
        # - /schedule del <id>
        # - /schedule on <id> | /schedule off <id>
        parts = text.split(maxsplit=3)
        if len(parts) == 1 or (len(parts) >= 2 and parts[1].lower() == "list"):
            await scheduler_list(sid)
            return
        if len(parts) >= 3 and parts[1].lower() in ("run", "del", "on", "off"):
            cmd = parts[1].lower()
            job_id = parts[2].strip()
            if cmd == "run":
                await scheduler_run_now(sid, {"id": job_id})
            elif cmd == "del":
                await scheduler_delete(sid, {"id": job_id})
            elif cmd in ("on", "off"):
                await scheduler_set_enabled(sid, {"id": job_id, "enabled": cmd == "on"})
            return

        if len(parts) >= 4 and parts[1].lower() in ("every", "cron"):
            mode = parts[1].lower()
            rest = parts[3].strip()
            # Format: <type> <name> :: <prompt>
            if "::" not in rest:
                await sio.emit(
                    "error",
                    {
                        "msg": (
                            "Invalid /schedule format. Use:\n"
                            "- /schedule every <minutes> <browse|web> <name> :: <prompt>\n"
                            "- /schedule cron \"0 9 * * *\" <browse|web> <name> :: <prompt>"
                        )
                    },
                    room=sid,
                )
                return
            left, prompt = [s.strip() for s in rest.split("::", 1)]
            left_parts = left.split(maxsplit=1)
            if len(left_parts) != 2:
                await sio.emit("error", {"msg": "Missing task type or name in /schedule."}, room=sid)
                return
            task_type = left_parts[0].strip().lower()
            name = left_parts[1].strip()
            if task_type not in ("browse", "web", "pipeline"):
                await sio.emit("error", {"msg": "task_type must be 'browse', 'web', or 'pipeline' in /schedule."}, room=sid)
                return

            if mode == "every":
                try:
                    minutes = int(parts[2])
                except Exception:
                    await sio.emit("error", {"msg": "Invalid minutes for /schedule every."}, room=sid)
                    return
                await scheduler_create(
                    sid,
                    {
                        "name": name,
                        "schedule_type": "interval_minutes",
                        "interval_minutes": minutes,
                        "task_type": task_type,
                        "payload": {"prompt": prompt} if task_type != "pipeline" else {"pipeline": "daily_ads", **({"config_prompt": prompt} if prompt else {})},
                        "enabled": True,
                    },
                )
                return

            # cron
            cron_expr = parts[2].strip()
            if cron_expr.startswith('"') and cron_expr.endswith('"'):
                cron_expr = cron_expr[1:-1]
            await scheduler_create(
                sid,
                {
                    "name": name,
                    "schedule_type": "cron",
                    "cron": cron_expr,
                    "task_type": task_type,
                    "payload": {"prompt": prompt} if task_type != "pipeline" else {"pipeline": "daily_ads", **({"config_prompt": prompt} if prompt else {})},
                    "enabled": True,
                },
            )
            return

        await sio.emit(
            "error",
            {"msg": "Unknown /schedule command. Try /schedule list."},
            room=sid,
        )
        return
    if text.lower().startswith("/expert"):
        if not audio_loop:
            await sio.emit("error", {"msg": "JODA not started. Turn power on first."}, room=sid)
            return
        parts = text.split()
        if len(parts) < 2:
            await sio.emit("status", {"msg": f"Shell expert mode is {'ON' if audio_loop.shell_expert_mode else 'OFF'}"}, room=sid)
            return
        val = parts[1].lower()
        enabled = val in ("on", "true", "1", "yes", "enable", "enabled")
        audio_loop.set_shell_expert_mode(enabled)
        await sio.emit("status", {"msg": f"Shell expert mode set to {'ON' if enabled else 'OFF'}"}, room=sid)
        return
    if text.lower() == "/agent0":
        await sio.emit(
            "status",
            {
                "msg": (
                    "Agent Zero (docker):\n"
                    "- Type /agent0 <action> (e.g. '/agent0 pull', '/agent0 start 50001', '/agent0 list')\n"
                    "- JODA will route this into tool calls (requires /expert on + confirmation)."
                )
            },
            room=sid,
        )
        return

    if not audio_loop:
        # Text-only fallback (no audio loop)
        if text:
            out = await _text_fallback_chain(sid, text, context="No audio loop")
            if out is None:
                return
            await sio.emit('transcription', {'sender': 'JODA', 'text': out})
            await sio.emit('tts_text', {'text': out})
        else:
            print("[SERVER DEBUG] [Error] Audio loop is None. Cannot send text.")
        return

    if not audio_loop.session:
        # Text-only fallback (Gemini session down)
        if text:
            out = await _text_fallback_chain(sid, text, context="Gemini unavailable")
            if out is None:
                return
            await sio.emit('transcription', {'sender': 'JODA', 'text': out})
            await sio.emit('tts_text', {'text': out})
            return
        print("[SERVER DEBUG] [Error] Session is None. Cannot send text.")
        return

    if text:
        print(f"[SERVER DEBUG] Sending message to model: '{text}'")
        
        # Log User Input to Project History
        if audio_loop and audio_loop.project_manager:
            audio_loop.project_manager.log_chat("User", text)
            
        # Use the same 'send' method that worked for audio, as 'send_realtime_input' and 'send_client_content' seem unstable in this env
        # INJECT VIDEO FRAME IF AVAILABLE (VAD-style logic for Text Input)
        if audio_loop and audio_loop._latest_image_payload:
            print(f"[SERVER DEBUG] Piggybacking video frame with text input.")
            try:
                # Send frame first
                await audio_loop.session.send(input=audio_loop._latest_image_payload, end_of_turn=False)
            except Exception as e:
                print(f"[SERVER DEBUG] Failed to send piggyback frame: {e}")
                
        await audio_loop.session.send(input=text, end_of_turn=True)
        print(f"[SERVER DEBUG] Message sent to model successfully.")

import json
from datetime import datetime
from pathlib import Path

# ... (imports)

@sio.event
async def video_frame(sid, data):
    # data should contain 'image' which is binary (blob) or base64 encoded
    image_data = data.get('image')
    if image_data and audio_loop:
        # We don't await this because we don't want to block the socket handler
        # But send_frame is async, so we create a task
        asyncio.create_task(audio_loop.send_frame(image_data))

@sio.event
async def save_memory(sid, data):
    try:
        messages = data.get('messages', [])
        if not messages:
            print("No messages to save.")
            return

        # Ensure directory exists
        memory_dir = Path("long_term_memory")
        memory_dir.mkdir(exist_ok=True)

        # Generate filename
        # Use provided filename if available, else timestamp
        provided_name = data.get('filename')
        
        if provided_name:
            # Simple sanitization
            if not provided_name.endswith('.txt'):
                provided_name += '.txt'
            # Prevent directory traversal
            filename = memory_dir / Path(provided_name).name 
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = memory_dir / f"memory_{timestamp}.txt"

        # Write to file
        with open(filename, 'w', encoding='utf-8') as f:
            for msg in messages:
                sender = msg.get('sender', 'Unknown')
                text = msg.get('text', '')
        print(f"Conversation saved to {filename}")
        await sio.emit('status', {'msg': 'Memory Saved Successfully'})

    except Exception as e:
        print(f"Error saving memory: {e}")
        await sio.emit('error', {'msg': f"Failed to save memory: {str(e)}"})

@sio.event
async def upload_memory(sid, data):
    print(f"Received memory upload request")
    try:
        memory_text = data.get('memory', '')
        if not memory_text:
            print("No memory data provided.")
            return

        if not audio_loop:
             print("[SERVER DEBUG] [Error] Audio loop is None. Cannot load memory.")
             await sio.emit('error', {'msg': "System not ready (Audio Loop inactive)"})
             return
        
        if not audio_loop.session:
             print("[SERVER DEBUG] [Error] Session is None. Cannot load memory.")
             await sio.emit('error', {'msg': "System not ready (No active session)"})
             return

        # Send to model
        print("Sending memory context to model...")
        context_msg = f"System Notification: The user has uploaded a long-term memory file. Please load the following context into your understanding. The format is a text log of previous conversations:\n\n{memory_text}"
        
        await audio_loop.session.send(input=context_msg, end_of_turn=True)
        print("Memory context sent successfully.")
        await sio.emit('status', {'msg': 'Memory Loaded into Context'})

    except Exception as e:
        print(f"Error uploading memory: {e}")
        await sio.emit('error', {'msg': f"Failed to upload memory: {str(e)}"})

@sio.event
async def discover_kasa(sid):
    print(f"Received discover_kasa request")
    try:
        devices = await kasa_agent.discover_devices()
        await sio.emit('kasa_devices', devices)
        await sio.emit('status', {'msg': f"Found {len(devices)} Kasa devices"})
        
        # Save to settings
        # devices is a list of full device info dicts. minimizing for storage.
        saved_devices = []
        for d in devices:
            saved_devices.append({
                "ip": d["ip"],
                "alias": d["alias"],
                "model": d["model"]
            })
        
        # Merge with existing to preserve any manual overrides? 
        # For now, just overwrite with latest scan result + previously known if we want to be fancy,
        # but user asked for "Any new devices that are scanned are added there".
        # A simple full persistence of current state is safest.
        SETTINGS["kasa_devices"] = saved_devices
        save_settings()
        print(f"[SERVER] Saved {len(saved_devices)} Kasa devices to settings.")
        
    except Exception as e:
        print(f"Error discovering kasa: {e}")
        await sio.emit('error', {'msg': f"Kasa Discovery Failed: {str(e)}"})

@sio.event
async def iterate_cad(sid, data):
    # data: { prompt: "make it bigger" }
    prompt = data.get('prompt')
    print(f"Received iterate_cad request: '{prompt}'")
    
    if not audio_loop or not audio_loop.cad_agent:
        await sio.emit('error', {'msg': "CAD Agent not available"})
        return

    try:
        # Notify user work has started
        await sio.emit('status', {'msg': 'Iterating design...'})
        await sio.emit('cad_status', {'status': 'generating'})
        
        # Call the agent with project path
        cad_output_dir = str(audio_loop.project_manager.get_current_project_path() / "cad")
        result = await audio_loop.cad_agent.iterate_prototype(prompt, output_dir=cad_output_dir)
        
        if result:
            info = f"{len(result.get('data', ''))} bytes (STL)"
            print(f"Sending updated CAD data: {info}")
            await sio.emit('cad_data', result)
            # Save to Project
            if 'file_path' in result:
                saved_path = audio_loop.project_manager.save_cad_artifact(result['file_path'], prompt)
                if saved_path:
                    print(f"[SERVER] Saved iterated CAD to {saved_path}")

            await sio.emit('status', {'msg': 'Design updated'})
        else:
            await sio.emit('error', {'msg': 'Failed to update design'})
            
    except Exception as e:
        print(f"Error iterating CAD: {e}")
        await sio.emit('error', {'msg': f"Iteration Error: {str(e)}"})

@sio.event
async def generate_cad(sid, data):
    # data: { prompt: "make a cube", provider: "build123d" | "tripo" }
    prompt = data.get('prompt')
    provider = data.get('provider', 'build123d')
    print(f"Received generate_cad request: '{prompt}' (provider={provider})")

    try:
        cad_output_dir = str(audio_loop.project_manager.get_current_project_path() / "cad") if audio_loop and audio_loop.project_manager else None

        if provider == 'tripo':
            # Tripo AI generation (returns GLB)
            from tripo_agent import TripoAgent

            def tripo_status(s):
                asyncio.create_task(sio.emit('cad_status', s))

            agent = TripoAgent(on_status=tripo_status)
            await sio.emit('status', {'msg': 'Generating 3D model via Tripo AI...'})
            await sio.emit('cad_status', {'status': 'generating', 'provider': 'tripo'})
            result = await agent.generate_model(prompt, output_dir=cad_output_dir)
        else:
            # Default: build123d (returns STL)
            if not audio_loop or not audio_loop.cad_agent:
                await sio.emit('error', {'msg': "CAD Agent not available"})
                return
            await sio.emit('status', {'msg': 'Generating new design...'})
            await sio.emit('cad_status', {'status': 'generating'})
            result = await audio_loop.cad_agent.generate_prototype(prompt, output_dir=cad_output_dir)

        if result:
            fmt = result.get('format', 'stl').upper()
            info = f"{len(result.get('data', ''))} bytes ({fmt})"
            print(f"Sending newly generated CAD data: {info}")
            await sio.emit('cad_data', result)

            # Save to Project
            if 'file_path' in result and audio_loop and audio_loop.project_manager:
                saved_path = audio_loop.project_manager.save_cad_artifact(result['file_path'], prompt)
                if saved_path:
                    print(f"[SERVER] Saved generated CAD to {saved_path}")

            await sio.emit('status', {'msg': f'Design generated ({fmt})'})
        else:
            await sio.emit('error', {'msg': 'Failed to generate design'})

    except Exception as e:
        print(f"Error generating CAD: {e}")
        await sio.emit('error', {'msg': f"Generation Error: {str(e)}"})

@sio.event
async def prompt_web_agent(sid, data):
    # data: { prompt: "find xyz" }
    prompt = data.get('prompt')
    print(f"Received web agent prompt: '{prompt}'")
    
    if not SETTINGS.get("tool_permissions", {}).get("run_web_agent", True):
        await sio.emit('error', {'msg': "Web Agent is disabled in Settings"})
        return

    try:
        await sio.emit('status', {'msg': 'Web Agent starting...'})

        # Prefer the JODA-integrated web agent if audio loop is running (it reports back into Gemini Live session).
        if audio_loop and getattr(audio_loop, "web_agent", None):
            asyncio.create_task(audio_loop.handle_web_agent_request(prompt))
            await sio.emit('status', {'msg': 'Web Agent started (JODA session)'})
            return

        # Otherwise, run a standalone WebAgent so web mode works without starting audio.
        from web_agent import WebAgent

        async def update_frontend(image_b64, log_text):
            await sio.emit('browser_frame', {'image': image_b64, 'log': log_text})

        async def run_standalone():
            agent = WebAgent()
            result = await agent.run_task(prompt, update_callback=update_frontend)
            await sio.emit('status', {'msg': f'Web Agent finished: {result}'})

        asyncio.create_task(run_standalone())
        await sio.emit('status', {'msg': 'Web Agent started'})
        
    except Exception as e:
        print(f"Error running Web Agent: {e}")
        await sio.emit('error', {'msg': f"Web Agent Error: {str(e)}"})

@sio.event
async def mic_sample_rate(sid, data):
    """Browser tells us the actual AudioContext sample rate before streaming."""
    sr = data.get("sample_rate") if isinstance(data, dict) else None
    if sr and isinstance(sr, (int, float)) and sr > 0:
        _mic_sample_rates[sid] = int(sr)
        print(f"[SERVER] mic_sample_rate from {sid}: {int(sr)} Hz")

@sio.event
async def mic_audio_chunk(sid, data):
    """
    Receives raw PCM s16le audio chunks from the web client and forwards them into the Gemini Live session.
    """
    global audio_loop
    if not audio_loop:
        print(f"[SERVER] mic_audio_chunk from {sid[:8]}… but audio_loop is None — dropping")
        return
    try:
        # Track how many packets we've seen from this session
        if sid not in _mic_bytes_counter:
            _mic_bytes_counter[sid] = [0, time.monotonic(), 0]  # [bytes, last_log_time, packet_count]
        counter = _mic_bytes_counter[sid]
        # Migrate old 2-element counters from previous code
        if len(counter) < 3:
            counter.append(0)
        counter[2] += 1
        pkt_num = counter[2]

        if sid not in _mic_debug_seen:
            # Verbose first-packet debug
            try:
                dtype = type(data).__name__
                dlen = len(data) if hasattr(data, "__len__") else None
                sr = None
                dict_keys = None
                pcm_preview = None
                if isinstance(data, dict):
                    sr = data.get("sample_rate") or data.get("sr")
                    dict_keys = list(data.keys())
                    if "pcm" in data and isinstance(data["pcm"], list):
                        pcm_preview = data["pcm"][:5]
                elif isinstance(data, (bytes, bytearray)) and len(data) >= 10:
                    pcm_preview = list(data[:10])
                print(
                    f"[SERVER] ========== FIRST MIC PACKET ==========\n"
                    f"  sid:          {sid}\n"
                    f"  type:         {dtype}\n"
                    f"  len:          {dlen}\n"
                    f"  dict_keys:    {dict_keys}\n"
                    f"  sample_rate:  {sr}\n"
                    f"  stored_sr:    {_mic_sample_rates.get(sid)}\n"
                    f"  pcm_preview:  {pcm_preview}\n"
                    f"  external:     {getattr(audio_loop, 'use_external_audio', None)}\n"
                    f"  paused:       {getattr(audio_loop, 'paused', None)}\n"
                    f"  out_queue:    {audio_loop.out_queue is not None if hasattr(audio_loop, 'out_queue') else '?'}\n"
                    f"  queue_size:   {audio_loop.external_audio_queue.qsize() if hasattr(audio_loop, 'external_audio_queue') else '?'}\n"
                    f"  ============================================"
                )
            except Exception as ex:
                print(f"[SERVER] mic_audio_chunk first packet: (failed to introspect: {ex})")
            _mic_debug_seen.add(sid)

        def _feed(pcm: bytes, sample_rate: int | None = None) -> None:
            # Gemini expects 16kHz PCM s16le mono; many browsers actually run 48k.
            # Default to 48kHz if unknown — feeding raw 48k to Gemini (expects 16k)
            # makes speech 3x fast and unintelligible.
            if not sample_rate or not isinstance(sample_rate, int) or sample_rate <= 0:
                sample_rate = 48000
            target_rate = 16000
            pre_len = len(pcm)
            if sample_rate and isinstance(sample_rate, int) and sample_rate > 0 and sample_rate != target_rate:
                try:
                    state_pos = float(_mic_resample_state.get(sid, 0.0))
                    pcm, next_pos = _resample_s16le_mono(pcm, sample_rate, target_rate, state_pos)
                    _mic_resample_state[sid] = float(next_pos)
                    if pkt_num <= 3:
                        print(f"[SERVER] mic pkt#{pkt_num} resampled {sample_rate}→{target_rate}: {pre_len}B → {len(pcm)}B")
                except Exception as e:
                    print(f"[SERVER] mic_audio_chunk resample FAILED (sr={sample_rate}): {e}")
                    import traceback; traceback.print_exc()
                    return  # Don't feed bad data
            if pkt_num <= 3:
                # Check if audio is all-zero
                is_silent = all(b == 0 for b in pcm[:100]) if len(pcm) >= 100 else all(b == 0 for b in pcm)
                print(f"[SERVER] mic pkt#{pkt_num} → feed_external_audio({len(pcm)}B, sr={sample_rate}), silent={is_silent}, qsize={audio_loop.external_audio_queue.qsize()}")
            audio_loop.feed_external_audio(pcm)

        # Diagnostic: log effective sample rate every 5 seconds
        now = time.monotonic()
        counter[0] = counter[0] + 0  # ensure counter[0] exists

        def _track_bytes(n: int) -> None:
            counter[0] += n
            if now - counter[1] >= 5.0:
                elapsed = now - counter[1]
                bps = counter[0] / elapsed
                sr_eff = _mic_sample_rates.get(sid, "?")
                qsize = audio_loop.external_audio_queue.qsize() if hasattr(audio_loop, 'external_audio_queue') else '?'
                drops = getattr(audio_loop, '_external_audio_drops', 0)
                print(f"[SERVER] mic {sid[:8]}… {bps:.0f} B/s, sr={sr_eff}, qsize={qsize}, drops={drops}, pkts={pkt_num}")
                counter[0] = 0
                counter[1] = now

        # Look up stored sample rate for raw binary payloads (Safari sends raw ArrayBuffer).
        stored_sr = _mic_sample_rates.get(sid)

        # Safari JSON path: { sr: <number>, pcm: [int, …] }
        if isinstance(data, dict) and "pcm" in data:
            sr = data.get("sr")
            pcm_list = data["pcm"]
            # pcm is a list of signed int16 values — convert to s16le bytes
            payload = struct.pack(f"<{len(pcm_list)}h", *pcm_list)
            effective_sr = int(sr) if sr else stored_sr
            if sr:
                _mic_sample_rates[sid] = int(sr)
            _track_bytes(len(payload))
            _feed(payload, effective_sr)
            return

        # python-socketio delivers binary payloads as `bytes`.
        if isinstance(data, (bytes, bytearray)):
            _track_bytes(len(data))
            _feed(bytes(data), stored_sr)
            return

        if isinstance(data, memoryview):
            _track_bytes(len(data))
            _feed(data.tobytes(), stored_sr)
            return

        # Fallback: { data: <bytes> }
        if isinstance(data, dict) and "data" in data:
            sr = data.get("sample_rate")
            payload = data["data"]
            if isinstance(payload, (bytes, bytearray)):
                _track_bytes(len(payload))
                _feed(bytes(payload), int(sr) if isinstance(sr, (int, float)) else None)
                return
            if isinstance(payload, memoryview):
                _track_bytes(len(payload))
                _feed(payload.tobytes(), int(sr) if isinstance(sr, (int, float)) else None)
                return
            return

        # Fallback: list/tuple of ints (0-255)
        if isinstance(data, (list, tuple)) and data and isinstance(data[0], int):
            _track_bytes(len(data))
            _feed(bytes(data), None)
            return
    except Exception as e:
        print(f"[SERVER] mic_audio_chunk error: {e}")

@sio.event
async def discover_printers(sid):
    print("Received discover_printers request")
    
    # If audio_loop isn't ready yet, return saved printers from settings
    if not audio_loop or not audio_loop.printer_agent:
        saved_printers = SETTINGS.get("printers", [])
        if saved_printers:
            # Convert saved printers to the expected format
            printer_list = []
            for p in saved_printers:
                printer_list.append({
                    "name": p.get("name", p["host"]),
                    "host": p["host"],
                    "port": p.get("port", 80),
                    "printer_type": p.get("type", "unknown"),
                    "camera_url": p.get("camera_url")
                })
            print(f"[SERVER] Returning {len(printer_list)} saved printers (audio_loop not ready)")
            await sio.emit('printer_list', printer_list)
            return
        else:
            await sio.emit('printer_list', [])
            await sio.emit('status', {'msg': "Connect to JODA to enable printer discovery"})
            return
        
    try:
        printers = await audio_loop.printer_agent.discover_printers()
        await sio.emit('printer_list', printers)
        await sio.emit('status', {'msg': f"Found {len(printers)} printers"})
    except Exception as e:
        print(f"Error discovering printers: {e}")
        await sio.emit('error', {'msg': f"Printer Discovery Failed: {str(e)}"})

@sio.event
async def add_printer(sid, data):
    # data: { host: "192.168.1.50", name: "My Printer", type: "moonraker" }
    raw_host = data.get('host')
    name = data.get('name') or raw_host
    ptype = data.get('type', "moonraker")
    
    # Parse port if present
    if ":" in raw_host:
        host, port_str = raw_host.split(":")
        port = int(port_str)
    else:
        host = raw_host
        port = 80
    
    print(f"Received add_printer request: {host}:{port} ({ptype})")
    
    if not audio_loop or not audio_loop.printer_agent:
        await sio.emit('error', {'msg': "Printer Agent not available"})
        return
        
    try:
        # Add manually
        camera_url = data.get('camera_url')
        printer = audio_loop.printer_agent.add_printer_manually(name, host, port=port, printer_type=ptype, camera_url=camera_url)
        
        # Save to settings
        new_printer_config = {
            "name": name,
            "host": host,
            "port": port,
            "type": ptype,
            "camera_url": camera_url
        }
        
        # Check if already exists to avoid duplicates
        exists = False
        for p in SETTINGS.get("printers", []):
            if p["host"] == host and p["port"] == port:
                exists = True
                break
        
        if not exists:
            if "printers" not in SETTINGS:
                SETTINGS["printers"] = []
            SETTINGS["printers"].append(new_printer_config)
            save_settings()
            print(f"[SERVER] Saved printer {name} to settings.")
        
        # Probe to confirm/correct type
        print(f"Probing {host} to confirm type...")
        # Try port 7125 (Moonraker) and 4408 (Fluidd/K1) 
        ports_to_try = [80, 7125, 4408]
        
        actual_type = "unknown"
        for port in ports_to_try:
             found_type = await audio_loop.printer_agent._probe_printer_type(host, port)
             if found_type.value != "unknown":
                 actual_type = found_type
                 # Update port if different
                 if port != 80:
                     printer.port = port
                 break
        
        if actual_type != "unknown" and actual_type != printer.printer_type:
             printer.printer_type = actual_type
             print(f"Corrected type to {actual_type.value} on port {printer.port}")
             
        # Refresh list for everyone
        printers = [p.to_dict() for p in audio_loop.printer_agent.printers.values()]
        await sio.emit('printer_list', printers)
        await sio.emit('status', {'msg': f"Added printer: {name}"})
        
    except Exception as e:
        print(f"Error adding printer: {e}")
        await sio.emit('error', {'msg': f"Failed to add printer: {str(e)}"})

@sio.event
async def print_stl(sid, data):
    print(f"Received print_stl request: {data}")
    # data: { stl_path: "path/to.stl" | "current", printer: "name_or_ip", profile: "optional" }
    
    if not audio_loop or not audio_loop.printer_agent:
        await sio.emit('error', {'msg': "Printer Agent not available"})
        return
        
    try:
        stl_path = data.get('stl_path', 'current')
        printer_name = data.get('printer')
        profile = data.get('profile')
        
        if not printer_name:
             await sio.emit('error', {'msg': "No printer specified"})
             return
             
        await sio.emit('status', {'msg': f"Preparing print for {printer_name}..."})
        
        # Get current project path for resolution
        current_project_path = None
        if audio_loop and audio_loop.project_manager:
            current_project_path = str(audio_loop.project_manager.get_current_project_path())
            print(f"[SERVER DEBUG] Using project path: {current_project_path}")

        # Resolve STL path before slicing so we can preview it
        resolved_stl = audio_loop.printer_agent._resolve_file_path(stl_path, current_project_path)
        
        if resolved_stl and os.path.exists(resolved_stl):
            # Open the STL in the CAD module for preview
            try:
                import base64
                with open(resolved_stl, 'rb') as f:
                    stl_data = f.read()
                stl_b64 = base64.b64encode(stl_data).decode('utf-8')
                stl_filename = os.path.basename(resolved_stl)
                
                print(f"[SERVER] Opening STL in CAD module: {stl_filename}")
                await sio.emit('cad_data', {
                    'format': 'stl',
                    'data': stl_b64,
                    'filename': stl_filename
                })
            except Exception as e:
                print(f"[SERVER] Warning: Could not preview STL: {e}")
        
        # Progress Callback
        async def on_slicing_progress(percent, message):
            await sio.emit('slicing_progress', {
                'printer': printer_name,
                'percent': percent,
                'message': message
            })
            if percent < 100:
                 await sio.emit('status', {'msg': f"Slicing: {percent}%"})

        result = await audio_loop.printer_agent.print_stl(
            stl_path, 
            printer_name, 
            profile,
            progress_callback=on_slicing_progress,
            root_path=current_project_path
        )
        
        await sio.emit('print_result', result)
        await sio.emit('status', {'msg': f"Print Job: {result.get('status', 'unknown')}"})
        
    except Exception as e:
        print(f"Error printing STL: {e}")
        await sio.emit('error', {'msg': f"Print Failed: {str(e)}"})

@sio.event
async def get_slicer_profiles(sid):
    """Get available OrcaSlicer profiles for manual selection."""
    print("Received get_slicer_profiles request")
    if not audio_loop or not audio_loop.printer_agent:
        await sio.emit('error', {'msg': "Printer Agent not available"})
        return
    
    try:
        profiles = audio_loop.printer_agent.get_available_profiles()
        await sio.emit('slicer_profiles', profiles)
    except Exception as e:
        print(f"Error getting slicer profiles: {e}")
        await sio.emit('error', {'msg': f"Failed to get profiles: {str(e)}"})

@sio.event
async def control_kasa(sid, data):
    # data: { ip, action: "on"|"off"|"brightness"|"color", value: ... }
    ip = data.get('ip')
    action = data.get('action')
    print(f"Kasa Control: {ip} -> {action}")
    
    try:
        success = False
        if action == "on":
            success = await kasa_agent.turn_on(ip)
        elif action == "off":
            success = await kasa_agent.turn_off(ip)
        elif action == "brightness":
            val = data.get('value')
            success = await kasa_agent.set_brightness(ip, val)
        elif action == "color":
            # value is {h, s, v} - convert to tuple for set_color
            h = data.get('value', {}).get('h', 0)
            s = data.get('value', {}).get('s', 100)
            v = data.get('value', {}).get('v', 100)
            success = await kasa_agent.set_color(ip, (h, s, v))
        
        if success:
            await sio.emit('kasa_update', {
                'ip': ip,
                'is_on': True if action == "on" else (False if action == "off" else None),
                'brightness': data.get('value') if action == "brightness" else None,
            })
 
        else:
             await sio.emit('error', {'msg': f"Failed to control device {ip}"})

    except Exception as e:
         print(f"Error controlling kasa: {e}")
         await sio.emit('error', {'msg': f"Kasa Control Error: {str(e)}"})

@sio.event
async def get_settings(sid):
    await sio.emit('settings', SETTINGS)

@sio.event
async def update_settings(sid, data):
    # Generic update
    print(f"Updating settings: {data}")
    
    # Handle specific keys if needed
    if "tool_permissions" in data:
        SETTINGS["tool_permissions"].update(data["tool_permissions"])
        if audio_loop:
            audio_loop.update_permissions(SETTINGS["tool_permissions"])
            
    if "face_auth_enabled" in data:
        SETTINGS["face_auth_enabled"] = data["face_auth_enabled"]
        # If turned OFF, maybe emit auth status true?
        if not data["face_auth_enabled"]:
             await sio.emit('auth_status', {'authenticated': True})
             # Stop auth loop if running?
             if authenticator:
                 authenticator.stop() 

    if "camera_flipped" in data:
        SETTINGS["camera_flipped"] = data["camera_flipped"]
        print(f"[SERVER] Camera flip set to: {data['camera_flipped']}")

    save_settings()
    # Broadcast new full settings
    await sio.emit('settings', SETTINGS)


# Deprecated/Mapped for compatibility if frontend still uses specific events
@sio.event
async def get_tool_permissions(sid):
    await sio.emit('tool_permissions', SETTINGS["tool_permissions"])

@sio.event
async def update_tool_permissions(sid, data):
    print(f"Updating permissions (legacy event): {data}")
    SETTINGS["tool_permissions"].update(data)
    save_settings()

    if audio_loop:
        audio_loop.update_permissions(SETTINGS["tool_permissions"])
    # Broadcast update to all
    await sio.emit('tool_permissions', SETTINGS["tool_permissions"])


# ==================== AGENT MANAGEMENT ENDPOINTS ====================

# Get agent manager instance
agent_manager = get_agent_manager()

# Set up feedback callback to emit to frontend
def agent_feedback_callback(feedback):
    """Called when agents send feedback to JODA"""
    asyncio.create_task(sio.emit('agent_feedback', feedback))

agent_manager.set_feedback_callback(agent_feedback_callback)

# Initialize MCP client on startup
@app.on_event("startup")
async def startup_event():
    """Initialize MCP client when server starts"""
    print("[MCP] Initializing MCP client for agent tool support...")
    try:
        await agent_manager.initialize_mcp()
        print(f"[MCP] MCP client initialized successfully")

        # Start agent monitoring
        agent_manager.start_monitoring()
        print("[AGENT] Agent monitoring started")
    except Exception as e:
        print(f"[MCP] Error initializing MCP: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Shutdown MCP client when server stops"""
    print("[MCP] Shutting down MCP client...")
    try:
        await agent_manager.shutdown_mcp()
        agent_manager.stop_monitoring()
        print("[MCP] MCP client shut down successfully")
    except Exception as e:
        print(f"[MCP] Error shutting down MCP: {e}")


@sio.event
async def deploy_agent(sid, data):
    """
    Deploy a new agent
    data: {
        "type": "freqtrade" | "hummingbot" | "rl_trading" | "arbitrage" | "data_collector",
        "name": "Agent Name",
        "config": { ... agent-specific config ... }
    }
    """
    try:
        agent_type = data.get("type")
        name = data.get("name", f"Agent-{int(time.time())}")
        config = data.get("config", {})

        print(f"[AGENT] Deploying {agent_type} agent: {name}")

        if agent_type == "freqtrade":
            agent_id = agent_manager.deploy_freqtrade_agent(name, config)
        elif agent_type == "hummingbot":
            agent_id = agent_manager.deploy_hummingbot_agent(name, config)
        elif agent_type == "rl_trading":
            agent_id = agent_manager.deploy_rl_trading_agent(name, config)
        elif agent_type == "arbitrage":
            agent_id = agent_manager.deploy_arbitrage_agent(name, config)
        elif agent_type == "data_collector":
            agent_id = agent_manager.deploy_data_collector_agent(name, config)
        else:
            await sio.emit('error', {'msg': f"Unknown agent type: {agent_type}"})
            return

        # Get agent details
        agent_info = agent_manager.get_agent(agent_id)

        await sio.emit('agent_deployed', {
            'agent_id': agent_id,
            'agent': agent_info
        })

        await sio.emit('status', {'msg': f"Agent '{name}' deployed successfully"})

    except Exception as e:
        print(f"[AGENT] Error deploying agent: {e}")
        import traceback
        traceback.print_exc()
        await sio.emit('error', {'msg': f"Failed to deploy agent: {str(e)}"})


@sio.event
async def list_agents(sid, data=None):
    """List all agents with optional status filter"""
    try:
        status_filter = data.get("status") if data else None
        agents = agent_manager.list_agents(status_filter)

        await sio.emit('agents_list', {
            'agents': agents,
            'count': len(agents)
        })

    except Exception as e:
        print(f"[AGENT] Error listing agents: {e}")
        await sio.emit('error', {'msg': f"Failed to list agents: {str(e)}"})


@sio.event
async def get_agent_status(sid, data):
    """Get status of a specific agent"""
    try:
        agent_id = data.get("agent_id")
        agent_info = agent_manager.get_agent(agent_id)

        if agent_info:
            await sio.emit('agent_status', agent_info)
        else:
            await sio.emit('error', {'msg': f"Agent not found: {agent_id}"})

    except Exception as e:
        print(f"[AGENT] Error getting agent status: {e}")
        await sio.emit('error', {'msg': f"Failed to get agent status: {str(e)}"})


@sio.event
async def stop_agent(sid, data):
    """Stop a running agent"""
    try:
        agent_id = data.get("agent_id")
        success = agent_manager.stop_agent(agent_id)

        if success:
            await sio.emit('agent_stopped', {'agent_id': agent_id})
            await sio.emit('status', {'msg': f"Agent {agent_id} stopped"})
        else:
            await sio.emit('error', {'msg': f"Failed to stop agent: {agent_id}"})

    except Exception as e:
        print(f"[AGENT] Error stopping agent: {e}")
        await sio.emit('error', {'msg': f"Failed to stop agent: {str(e)}"})


@sio.event
async def pause_agent(sid, data):
    """Pause a running agent"""
    try:
        agent_id = data.get("agent_id")
        success = agent_manager.pause_agent(agent_id)

        if success:
            await sio.emit('agent_paused', {'agent_id': agent_id})
        else:
            await sio.emit('error', {'msg': f"Failed to pause agent: {agent_id}"})

    except Exception as e:
        print(f"[AGENT] Error pausing agent: {e}")
        await sio.emit('error', {'msg': f"Failed to pause agent: {str(e)}"})


@sio.event
async def resume_agent(sid, data):
    """Resume a paused agent"""
    try:
        agent_id = data.get("agent_id")
        success = agent_manager.resume_agent(agent_id)

        if success:
            await sio.emit('agent_resumed', {'agent_id': agent_id})
        else:
            await sio.emit('error', {'msg': f"Failed to resume agent: {agent_id}"})

    except Exception as e:
        print(f"[AGENT] Error resuming agent: {e}")
        await sio.emit('error', {'msg': f"Failed to resume agent: {str(e)}"})


@sio.event
async def restart_agent(sid, data):
    """Restart an agent"""
    try:
        agent_id = data.get("agent_id")
        success = agent_manager.restart_agent(agent_id)

        if success:
            await sio.emit('agent_restarted', {'agent_id': agent_id})
            await sio.emit('status', {'msg': f"Agent {agent_id} restarted"})
        else:
            await sio.emit('error', {'msg': f"Failed to restart agent: {agent_id}"})

    except Exception as e:
        print(f"[AGENT] Error restarting agent: {e}")
        await sio.emit('error', {'msg': f"Failed to restart agent: {str(e)}"})


@sio.event
async def get_agent_stats(sid):
    """Get overall agent statistics"""
    try:
        stats = agent_manager.get_agent_stats()
        await sio.emit('agent_stats', stats)

    except Exception as e:
        print(f"[AGENT] Error getting agent stats: {e}")
        await sio.emit('error', {'msg': f"Failed to get agent stats: {str(e)}"})


@sio.event
async def get_consolidated_report(sid):
    """Get consolidated report from all agents"""
    try:
        report = agent_manager.get_consolidated_report()
        await sio.emit('consolidated_report', report)

    except Exception as e:
        print(f"[AGENT] Error getting consolidated report: {e}")
        await sio.emit('error', {'msg': f"Failed to get consolidated report: {str(e)}"})


# ==================== MCP TOOL ENDPOINTS ====================

@sio.event
async def list_mcp_tools(sid, data=None):
    """
    List all available MCP tools
    Optionally filter by agent_type
    data: { "agent_type": "freqtrade" } (optional)
    """
    try:
        if agent_manager.mcp_client:
            all_tools = agent_manager.mcp_client.list_tools()

            # Filter by agent type if specified
            agent_type = data.get("agent_type") if data else None
            if agent_type:
                recommended = agent_manager.mcp_client.get_tools_for_agent(agent_type)
                filtered_tools = [
                    t for t in all_tools
                    if any(t["name"].endswith(rec.split(".")[-1]) for rec in recommended)
                ]
                await sio.emit('mcp_tools_list', {
                    'tools': filtered_tools,
                    'agent_type': agent_type
                })
            else:
                await sio.emit('mcp_tools_list', {'tools': all_tools})
        else:
            await sio.emit('error', {'msg': "MCP client not initialized"})

    except Exception as e:
        print(f"[MCP] Error listing tools: {e}")
        await sio.emit('error', {'msg': f"Failed to list MCP tools: {str(e)}"})


@sio.event
async def call_mcp_tool(sid, data):
    """
    Call an MCP tool from an agent
    data: {
        "agent_id": "agent_id",
        "tool_name": "filesystem.read_file",
        "arguments": { "path": "/path/to/file" }
    }
    """
    try:
        agent_id = data.get("agent_id")
        tool_name = data.get("tool_name")
        arguments = data.get("arguments", {})

        if not agent_id or not tool_name:
            await sio.emit('error', {'msg': "agent_id and tool_name are required"})
            return

        # Get the agent
        agent = agent_manager.agents.get(agent_id)
        if not agent:
            await sio.emit('error', {'msg': f"Agent not found: {agent_id}"})
            return

        print(f"[MCP] Agent {agent_id} calling tool {tool_name}")

        # Call the tool through the agent
        result = await agent.call_tool(tool_name, arguments)

        # Emit result
        await sio.emit('mcp_tool_result', {
            'agent_id': agent_id,
            'tool_name': tool_name,
            'result': result
        })

        if result.get("success"):
            await sio.emit('status', {'msg': f"Tool {tool_name} executed successfully"})
        else:
            await sio.emit('error', {'msg': f"Tool {tool_name} failed: {result.get('error')}"})

    except Exception as e:
        print(f"[MCP] Error calling tool: {e}")
        await sio.emit('error', {'msg': f"Failed to call MCP tool: {str(e)}"})


@sio.event
async def get_agent_tools(sid, data):
    """
    Get available tools for a specific agent
    data: { "agent_id": "agent_id" }
    """
    try:
        agent_id = data.get("agent_id")
        if not agent_id:
            await sio.emit('error', {'msg': "agent_id is required"})
            return

        agent = agent_manager.agents.get(agent_id)
        if not agent:
            await sio.emit('error', {'msg': f"Agent not found: {agent_id}"})
            return

        tools = agent.get_available_tools()

        await sio.emit('agent_tools', {
            'agent_id': agent_id,
            'tools': tools
        })

    except Exception as e:
        print(f"[MCP] Error getting agent tools: {e}")
        await sio.emit('error', {'msg': f"Failed to get agent tools: {str(e)}"})


@sio.event
async def get_mcp_servers(sid):
    """Get list of connected MCP servers"""
    try:
        if agent_manager.mcp_client:
            servers = [
                {
                    'name': name,
                    'enabled': server.enabled,
                    'transport': server.transport,
                    'description': getattr(server, 'description', '')
                }
                for name, server in agent_manager.mcp_client.servers.items()
            ]

            await sio.emit('mcp_servers', {'servers': servers})
        else:
            await sio.emit('error', {'msg': "MCP client not initialized"})

    except Exception as e:
        print(f"[MCP] Error getting MCP servers: {e}")
        await sio.emit('error', {'msg': f"Failed to get MCP servers: {str(e)}"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JODA backend server (FastAPI + Socket.IO)")
    parser.add_argument("--host", default=os.getenv("JODA_BACKEND_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("JODA_BACKEND_PORT", "8765")))
    args = parser.parse_args()

    uvicorn.run(
        "server:app_socketio",
        host=args.host,
        port=args.port,
        reload=False, # Reload enabled causes spawn of worker which might miss the event loop policy patch
        loop="asyncio",
        reload_excludes=["temp_cad_gen.py", "output.stl", "*.stl"]
    )
