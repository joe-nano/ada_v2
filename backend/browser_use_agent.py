"""
Browser automation wrapper for JODA.

This is designed to support https://docs.browser-use.com/quickstart when the optional
`browser_use` dependency is installed, but it also provides a safe fallback to the
existing Playwright-based `WebAgent` in this repo so the feature works out of the box.
"""

from __future__ import annotations

import os
from typing import Awaitable, Callable, Optional


UpdateCallback = Callable[[str, str], Awaitable[None]]


async def run_task(
    prompt: str,
    update_callback: Optional[UpdateCallback] = None,
    secrets: Optional[dict[str, str]] = None,
) -> str:
    """
    Run a browser task and return a final summary string.

    If the optional `browser_use` package is installed and configured, this function can be
    updated to use it directly. For now, we fall back to the repo's existing `WebAgent`.
    """
    # Optional dependency path (future): browser-use
    try:
        import browser_use  # noqa: F401

        provider = (os.getenv("BROWSER_USE_PROVIDER") or "openai").strip().lower()
        model = (os.getenv("BROWSER_USE_OPENAI_MODEL") or os.getenv("BROWSER_USE_MODEL") or "gpt-o3").strip()

        # The upstream quickstart requires additional deps/providers (e.g. OpenAI/Anthropic)
        # that may not be installed in this environment. We keep a clear message until
        # those are wired in.
        return (
            "browser-use is installed, but direct integration is not configured in this environment yet. "
            f"Requested provider={provider} model={model}. "
            "Install the required provider deps and wire the browser-use Agent per https://docs.browser-use.com/quickstart, "
            "or use the built-in /web agent for now."
        )
    except Exception:
        # Not installed or import error -> fall back.
        pass

    # Fallback: existing WebAgent (Playwright + Gemini computer-use preview model)
    from web_agent import WebAgent

    agent = WebAgent()
    return await agent.run_task(prompt, update_callback=update_callback, secrets=secrets)
