from __future__ import annotations

import os
import re
import base64
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


def _utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _workspace_root() -> Path:
    return Path(os.getenv("JODA_PROJECT_ROOT", "/home/yoda_external_storage_server/biz_automate")).resolve()


def _pipeline_dir() -> Path:
    d = _workspace_root() / ".joda" / "pipelines" / "daily_ads" / _utc_day()
    d.mkdir(parents=True, exist_ok=True)
    return d


async def _fetch_text(client: httpx.AsyncClient, url: str, *, headers: dict[str, str] | None = None) -> str:
    resp = await client.get(url, headers=headers)
    resp.raise_for_status()
    return resp.text


async def _fetch_json(client: httpx.AsyncClient, url: str, *, headers: dict[str, str] | None = None) -> Any:
    resp = await client.get(url, headers=headers)
    resp.raise_for_status()
    return resp.json()


def _extract_from_google_trends_rss(xml: str, limit: int = 30) -> list[str]:
    # Simple RSS extraction without external deps.
    titles = re.findall(r"<title><!\\[CDATA\\[(.*?)\\]\\]></title>", xml, flags=re.I)
    # First title is feed title.
    titles = [t.strip() for t in titles[1:]]
    return titles[:limit]


def _keywords_from_titles(titles: list[str], limit: int = 25) -> list[str]:
    stop = {
        "the",
        "a",
        "an",
        "and",
        "or",
        "to",
        "of",
        "in",
        "for",
        "on",
        "with",
        "at",
        "is",
        "are",
        "from",
        "by",
        "as",
        "after",
        "vs",
        "how",
        "why",
        "what",
        "who",
        "when",
        "where",
        "new",
        "live",
        "2025",
        "2026",
    }
    words: list[str] = []
    for t in titles:
        w = re.findall(r"[A-Za-z0-9][A-Za-z0-9\\-]{2,}", t.lower())
        words.extend([x for x in w if x not in stop])
    counts = Counter(words)
    return [w for w, _ in counts.most_common(limit)]


async def collect_daily_trends() -> dict[str, Any]:
    """
    Collect a broad set of trends without requiring any API keys.
    For platforms that require keys (TikTok/X/Meta/etc), we include placeholders in output.
    """
    trends: dict[str, Any] = {"date_utc": _utc_day(), "sources": {}, "skipped": []}
    headers = {"User-Agent": "JODA/1.0 (daily trends pipeline)"}
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
        # Google Trends daily RSS (US)
        try:
            xml = await _fetch_text(
                client,
                "https://trends.google.com/trends/trendingsearches/daily/rss?geo=US",
                headers=headers,
            )
            titles = _extract_from_google_trends_rss(xml, limit=40)
            trends["sources"]["google_trends_daily_us"] = titles
        except Exception as e:
            trends["skipped"].append({"source": "google_trends_daily_us", "reason": str(e)[:200]})

        # Reddit /r/popular (public JSON)
        try:
            data = await _fetch_json(client, "https://www.reddit.com/r/popular.json?limit=25", headers=headers)
            posts = []
            for child in (data.get("data") or {}).get("children") or []:
                d = (child or {}).get("data") or {}
                title = (d.get("title") or "").strip()
                url = (d.get("url") or "").strip()
                score = d.get("score")
                if title:
                    posts.append({"title": title, "url": url, "score": score})
            trends["sources"]["reddit_popular"] = posts[:25]
        except Exception as e:
            trends["skipped"].append({"source": "reddit_popular", "reason": str(e)[:200]})

        # Hacker News top stories (public API)
        try:
            ids = await _fetch_json(client, "https://hacker-news.firebaseio.com/v0/topstories.json", headers=headers)
            items = []
            for story_id in (ids or [])[:15]:
                item = await _fetch_json(
                    client, f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json", headers=headers
                )
                if not isinstance(item, dict):
                    continue
                title = (item.get("title") or "").strip()
                url = (item.get("url") or "").strip()
                score = item.get("score")
                if title:
                    items.append({"title": title, "url": url, "score": score})
            trends["sources"]["hackernews_top"] = items
        except Exception as e:
            trends["skipped"].append({"source": "hackernews_top", "reason": str(e)[:200]})

    # Platforms requiring credentials / limited APIs.
    trends["needs_keys"] = [
        {"platform": "tiktok", "env": ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN"]},
        {"platform": "instagram", "env": ["META_APP_ID", "META_APP_SECRET", "IG_BUSINESS_ACCOUNT_ID", "META_PAGE_TOKEN"]},
        {"platform": "facebook", "env": ["META_APP_ID", "META_APP_SECRET", "META_PAGE_ID", "META_PAGE_TOKEN"]},
        {"platform": "x", "env": ["X_API_KEY", "X_API_SECRET", "X_BEARER_TOKEN", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"]},
        {"platform": "youtube", "env": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "YOUTUBE_CHANNEL_ID"]},
        {"platform": "linkedin", "env": ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REFRESH_TOKEN", "LINKEDIN_ORG_ID"]},
    ]
    return trends


def build_ad_refresh_prompt(trends: dict[str, Any]) -> str:
    titles: list[str] = []
    titles.extend(trends.get("sources", {}).get("google_trends_daily_us") or [])
    titles.extend([p.get("title") for p in (trends.get("sources", {}).get("reddit_popular") or []) if p.get("title")])
    titles.extend([p.get("title") for p in (trends.get("sources", {}).get("hackernews_top") or []) if p.get("title")])
    keywords = _keywords_from_titles([t for t in titles if isinstance(t, str)], limit=25)
    return (
        "Daily Ad Refresh Brief:\n"
        f"- Date (UTC): {trends.get('date_utc')}\n"
        f"- Candidate keywords: {', '.join(keywords[:20])}\n\n"
        "Task:\n"
        "1) Identify 3-5 winning creatives today (Meta Ads Library + TikTok Creative Center + YouTube Ads + Google Ads Transparency).\n"
        "2) For each, summarize the hook, offer, CTA, and visual structure.\n"
        "3) Generate 3 variants per winning creative using NanoBanana Pro (image edit), preserving the proven structure but adapting to today's trends.\n"
        "4) Output assets and a posting plan for TikTok/IG Reels/X/FB/YT Shorts/LinkedIn.\n"
        "Use {{USERNAME}}/{{PASSWORD}} placeholders if any login is required.\n"
    )


async def post_to_automation(
    trends: dict[str, Any],
    *,
    prompt: str,
    stage: str,
    extra: dict[str, Any] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    Send the daily brief + trends to n8n/zapier for downstream generation/posting.
    Prefer n8n webhook; Zapier webhook is optional.
    """
    payload = {"kind": "daily_ads", "stage": stage, "trends": trends, "prompt": prompt, **(extra or {})}
    out: dict[str, Any] = {"sent": [], "errors": [], "responses": {}}

    n8n_url = (os.getenv("N8N_WEBHOOK_URL") or "").strip()
    zapier_url = (os.getenv("ZAPIER_WEBHOOK_URL") or "").strip()

    if dry_run:
        return {"sent": ["dry_run"], "payload_preview": payload}

    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
        if n8n_url:
            try:
                r = await client.post(n8n_url, json=payload)
                r.raise_for_status()
                out["sent"].append({"target": "n8n", "status": r.status_code})
                try:
                    out["responses"]["n8n"] = r.json()
                except Exception:
                    out["responses"]["n8n"] = r.text[:2000]
            except Exception as e:
                out["errors"].append({"target": "n8n", "error": str(e)[:300]})
        if zapier_url:
            try:
                r = await client.post(zapier_url, json=payload)
                r.raise_for_status()
                out["sent"].append({"target": "zapier", "status": r.status_code})
                try:
                    out["responses"]["zapier"] = r.json()
                except Exception:
                    out["responses"]["zapier"] = r.text[:2000]
            except Exception as e:
                out["errors"].append({"target": "zapier", "error": str(e)[:300]})

    return out


def _nanobanana_models() -> tuple[str, str]:
    base = (os.getenv("NANOBANANA_MODEL") or "gemini-2.5-flash-image").strip()
    pro = (os.getenv("NANOBANANA_PRO_MODEL") or "gemini-3-pro-image-preview").strip()
    return base, pro


async def _download_image_bytes(url: str) -> tuple[bytes, str]:
    headers = {"User-Agent": "JODA/1.0 (image download)"}
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
        r = await client.get(url, headers=headers)
        r.raise_for_status()
        content_type = r.headers.get("content-type") or "image/jpeg"
        data = r.content
    return data, content_type.split(";", 1)[0].strip()


async def generate_image_variants(
    *,
    creative_image_url: str,
    brief: str,
    variants: int = 3,
    use_pro: bool = True,
) -> list[dict[str, Any]]:
    """
    Best-effort NanoBanana variant generator.

    Input: a URL to an image (winning creative) + the daily brief.
    Output: list of dicts containing {mime_type, bytes, note}.
    """
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    img_bytes, mime_type = await _download_image_bytes(creative_image_url)
    base_model, pro_model = _nanobanana_models()
    model = pro_model if use_pro else base_model

    # Optional dependency; if not installed in this environment, caller can fall back to n8n-side generation.
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore
    except Exception as e:
        raise RuntimeError(f"google-genai not available for NanoBanana generation: {e}")

    client = genai.Client(http_options={"api_version": "v1beta"}, api_key=api_key)

    prompt = (
        "You are generating ad creative image variants.\n"
        "Goal: Preserve the proven structure of the winning creative, but adapt the messaging and visuals to align "
        "with today's trends and the brief.\n"
        "Return the edited image.\n\n"
        f"Brief:\n{brief}\n"
        f"Variants needed: {variants}\n"
    )

    results: list[dict[str, Any]] = []
    for i in range(int(variants)):
        resp = client.models.generate_content(
            model=model,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(f"{prompt}\nVariant #{i+1}: Generate a distinct, high-performing option."),
                        types.Part.from_bytes(data=img_bytes, mime_type=mime_type),
                    ],
                )
            ],
        )

        # Extract first image bytes returned (SDK returns parts with inline_data).
        out_bytes = None
        out_mime = None
        for cand in (getattr(resp, "candidates", None) or []):
            for part in (getattr(getattr(cand, "content", None), "parts", None) or []):
                inline = getattr(part, "inline_data", None)
                if inline and getattr(inline, "data", None):
                    out_bytes = inline.data
                    out_mime = getattr(inline, "mime_type", None) or "image/png"
                    break
            if out_bytes:
                break
        if not out_bytes:
            # Fallback: nothing returned.
            continue
        results.append({"mime_type": out_mime, "bytes": out_bytes, "note": f"variant_{i+1}"})

    return results


async def run_daily_ads_pipeline(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Minimal “daily trends -> brief -> send to automation” pipeline.
    The downstream n8n/Zapier workflow can:
      - pull winning creatives (ads libraries)
      - run NanoBanana Pro image edits via Gemini API
      - post via platform OAuth integrations
    """
    cfg = dict(config or {})
    dry_run = bool(cfg.get("dry_run", False))
    max_creatives = int(cfg.get("max_creatives", 3) or 3)
    variants_per_creative = int(cfg.get("variants_per_creative", 3) or 3)
    use_pro = bool(cfg.get("use_pro", True))
    enable_local_generation = bool(cfg.get("enable_local_generation", True))

    trends = await collect_daily_trends()
    brief = build_ad_refresh_prompt(trends)

    # Stage 1: send trends+brief to automation (n8n/zapier). If your workflow can, return a list of
    # winning creatives to process, in the response JSON:
    #   { "creatives": [ { "image_url": "https://...", "platform": "...", "note": "..." } ] }
    stage1 = await post_to_automation(trends, prompt=brief, stage="collect", dry_run=dry_run)

    creatives = []
    if isinstance(cfg.get("creatives"), list):
        creatives = cfg["creatives"]
    else:
        for k in ("n8n", "zapier"):
            resp = (stage1.get("responses") or {}).get(k)
            if isinstance(resp, dict) and isinstance(resp.get("creatives"), list):
                creatives = resp["creatives"]
                break

    generated: list[dict[str, Any]] = []
    if creatives and enable_local_generation and not dry_run:
        d = _pipeline_dir()
        for idx, c in enumerate(creatives[:max_creatives]):
            if not isinstance(c, dict):
                continue
            image_url = str(c.get("image_url") or "").strip()
            if not image_url:
                continue
            try:
                vars_out = await generate_image_variants(
                    creative_image_url=image_url,
                    brief=brief,
                    variants=variants_per_creative,
                    use_pro=use_pro,
                )
                for v in vars_out:
                    b = v.get("bytes")
                    if not isinstance(b, (bytes, bytearray)):
                        continue
                    mime = str(v.get("mime_type") or "image/png")
                    name = f"creative_{idx+1}_{v.get('note','variant')}"
                    ext = "png" if "png" in mime else "jpg"
                    path = d / f"{name}.{ext}"
                    path.write_bytes(b)
                    generated.append(
                        {
                            "source_image_url": image_url,
                            "mime_type": mime,
                            "file_path": str(path),
                            "base64": base64.b64encode(b).decode("ascii"),
                            "note": v.get("note"),
                            "creative": c,
                        }
                    )
            except Exception as e:
                generated.append({"source_image_url": image_url, "error": str(e)[:300], "creative": c})

    # Stage 2: send generated assets (if any) back to automation for posting.
    stage2: dict[str, Any] | None = None
    if generated or dry_run:
        stage2 = await post_to_automation(
            trends,
            prompt=(
                "Posting payload:\n"
                "- Use the attached generated_variants to post across TikTok/IG Reels/X/FB/YT Shorts/LinkedIn.\n"
                "- If OAuth integrations exist, use them; avoid password-based posting.\n"
            ),
            stage="post",
            extra={"generated_variants": generated},
            dry_run=dry_run,
        )

    # Save an artifact locally for auditability.
    d = _pipeline_dir()
    (d / "brief.txt").write_text(brief, encoding="utf-8")
    (d / "stage1.json").write_text(str(stage1), encoding="utf-8")
    (d / "generated.json").write_text(str(generated), encoding="utf-8")
    if stage2 is not None:
        (d / "stage2.json").write_text(str(stage2), encoding="utf-8")

    return {
        "trends": trends,
        "brief_path": str(d / "brief.txt"),
        "stage1": stage1,
        "generated_variants": generated,
        "stage2": stage2,
    }
