"""
Multi-provider image & video generation with automatic fallback.

Each provider function returns a standardized dict:
{
    "success": bool,
    "data_url": str,        # base64 data URL for frontend
    "raw_bytes": bytes,     # raw file bytes for saving
    "filename": str,
    "mime_type": str,
    "provider": str,
    "error": str,
}

Image fallback order:  Gemini NanoBanana → Fireworks.ai FLUX → Together.ai FLUX → Fal.ai FLUX → Replicate FLUX → HF Inference → Z-Image (local)
Video fallback order:  Seedance (AI/ML API) → Fal.ai Wan 2.1 → Replicate Wan 2.1 → HF Inference
"""

import os
import base64
import time
import asyncio
import logging
from typing import Callable, Optional

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _provider_available(name: str) -> bool:
    """Check if required env var is set for a provider."""
    mapping = {
        "gemini": "GEMINI_API_KEY",
        "fireworks": "FIREWORKS_API_KEY",
        "seedance": "AIML_API_KEY",
        "together": "TOGETHER_API_KEY",
        "fal": "FAL_KEY",
        "replicate": "REPLICATE_API_TOKEN",
        "huggingface": None,  # works without token for public models
        "zimage": None,  # local, always "available" (may fail at runtime)
    }
    env_var = mapping.get(name)
    if env_var is None:
        return True
    return bool((os.getenv(env_var) or "").strip())


def _ok(data_url: str, raw_bytes: bytes, filename: str, mime_type: str, provider: str) -> dict:
    return {
        "success": True,
        "data_url": data_url,
        "raw_bytes": raw_bytes,
        "filename": filename,
        "mime_type": mime_type,
        "provider": provider,
        "error": "",
    }


def _fail(provider: str, error: str) -> dict:
    return {
        "success": False,
        "data_url": "",
        "raw_bytes": b"",
        "filename": "",
        "mime_type": "",
        "provider": provider,
        "error": error,
    }


def _bytes_to_data_url(raw: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('utf-8')}"


# ---------------------------------------------------------------------------
# IMAGE PROVIDERS
# ---------------------------------------------------------------------------

async def generate_image_gemini(prompt: str) -> dict:
    """Provider 1: Gemini NanoBanana via google-genai SDK."""
    provider = "gemini-nanobanana"
    try:
        api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
        if not api_key:
            return _fail(provider, "GEMINI_API_KEY not set")

        from google import genai
        from google.genai import types as genai_types

        model_name = (os.getenv("NANOBANANA_MODEL") or "gemini-2.5-flash-image").strip()
        client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})

        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )

        image_data = None
        image_mime = "image/png"
        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                image_data = part.inline_data.data
                image_mime = part.inline_data.mime_type or "image/png"

        if not image_data:
            return _fail(provider, "No image returned by Gemini")

        ext = "png" if "png" in image_mime else "jpg"
        filename = f"generated_{int(time.time())}.{ext}"
        data_url = _bytes_to_data_url(image_data, image_mime)
        return _ok(data_url, image_data, filename, image_mime, provider)

    except Exception as e:
        return _fail(provider, str(e))


async def generate_image_fireworks(prompt: str) -> dict:
    """Provider 2: Fireworks.ai FLUX Schnell. Returns raw image bytes directly."""
    provider = "fireworks-flux"
    try:
        key = (os.getenv("FIREWORKS_API_KEY") or "").strip()
        if not key:
            return _fail(provider, "FIREWORKS_API_KEY not set")

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                "https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models/flux-1-schnell-fp8/text_to_image",
                headers=headers,
                json={"prompt": prompt, "width": 1024, "height": 768},
            )
            resp.raise_for_status()

            raw = resp.content
            # Fireworks returns raw JPEG bytes
            ct = resp.headers.get("content-type", "image/jpeg")
            mime = ct.split(";")[0].strip()
            ext = "jpg" if "jpeg" in mime or "jpg" in mime else "png"
            filename = f"generated_{int(time.time())}.{ext}"
            return _ok(_bytes_to_data_url(raw, mime), raw, filename, mime, provider)

    except Exception as e:
        return _fail(provider, str(e))


async def generate_image_together(prompt: str) -> dict:
    """Provider 3: Together.ai FLUX Schnell."""
    provider = "together-flux"
    try:
        key = (os.getenv("TOGETHER_API_KEY") or "").strip()
        if not key:
            return _fail(provider, "TOGETHER_API_KEY not set")

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                "https://api.together.xyz/v1/images/generations",
                headers=headers,
                json={
                    "model": "black-forest-labs/FLUX.1-schnell-Free",
                    "prompt": prompt,
                    "width": 1024,
                    "height": 768,
                    "n": 1,
                    "response_format": "b64_json",
                },
            )
            resp.raise_for_status()
            data = resp.json()

            b64_data = data["data"][0]["b64_json"]
            raw = base64.b64decode(b64_data)
            filename = f"generated_{int(time.time())}.png"
            return _ok(_bytes_to_data_url(raw, "image/png"), raw, filename, "image/png", provider)

    except Exception as e:
        return _fail(provider, str(e))


async def generate_image_fal(prompt: str) -> dict:
    """Provider 3: Fal.ai FLUX Schnell."""
    provider = "fal-flux"
    try:
        key = (os.getenv("FAL_KEY") or "").strip()
        if not key:
            return _fail(provider, "FAL_KEY not set")

        headers = {
            "Authorization": f"Key {key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=120) as client:
            # Submit request
            resp = await client.post(
                "https://queue.fal.run/fal-ai/flux/schnell",
                headers=headers,
                json={"prompt": prompt, "image_size": "landscape_4_3", "num_images": 1},
            )
            resp.raise_for_status()
            data = resp.json()

            # Queue-based: check for request_id (async) or direct result
            if "images" in data:
                # Synchronous result
                image_url = data["images"][0]["url"]
            elif "request_id" in data:
                # Poll for result
                request_id = data["request_id"]
                status_url = f"https://queue.fal.run/fal-ai/flux/schnell/requests/{request_id}/status"
                result_url = f"https://queue.fal.run/fal-ai/flux/schnell/requests/{request_id}"
                for _ in range(60):
                    await asyncio.sleep(2)
                    status_resp = await client.get(status_url, headers=headers)
                    status_resp.raise_for_status()
                    status_data = status_resp.json()
                    if status_data.get("status") == "COMPLETED":
                        result_resp = await client.get(result_url, headers=headers)
                        result_resp.raise_for_status()
                        result_data = result_resp.json()
                        image_url = result_data["images"][0]["url"]
                        break
                    elif status_data.get("status") in ("FAILED",):
                        return _fail(provider, status_data.get("error", "Fal prediction failed"))
                else:
                    return _fail(provider, "Polling timed out")
            else:
                return _fail(provider, "Unexpected response format")

            # Download image
            img_resp = await client.get(image_url)
            img_resp.raise_for_status()
            raw = img_resp.content
            # Detect format from content-type or default to png
            ct = img_resp.headers.get("content-type", "image/png")
            mime = ct.split(";")[0].strip()
            ext = "jpg" if "jpeg" in mime or "jpg" in mime else "png"
            filename = f"generated_{int(time.time())}.{ext}"
            return _ok(_bytes_to_data_url(raw, mime), raw, filename, mime, provider)

    except Exception as e:
        return _fail(provider, str(e))


async def generate_image_replicate(prompt: str) -> dict:
    """Provider 3: Replicate FLUX Schnell."""
    provider = "replicate-flux"
    try:
        token = (os.getenv("REPLICATE_API_TOKEN") or "").strip()
        if not token:
            return _fail(provider, "REPLICATE_API_TOKEN not set")

        headers = {
            "Authorization": f"Token {token}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=120) as client:
            # Create prediction via model-based endpoint
            resp = await client.post(
                "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
                headers=headers,
                json={
                    "input": {"prompt": prompt, "num_outputs": 1, "output_format": "png"},
                },
            )
            resp.raise_for_status()
            prediction = resp.json()
            poll_url = prediction.get("urls", {}).get("get", prediction.get("url", ""))

            # Poll for result
            for _ in range(60):  # max ~120s
                await asyncio.sleep(2)
                poll_resp = await client.get(poll_url, headers=headers)
                poll_resp.raise_for_status()
                data = poll_resp.json()
                status = data.get("status")
                if status == "succeeded":
                    output = data.get("output")
                    if isinstance(output, list) and output:
                        image_url = output[0]
                    elif isinstance(output, str):
                        image_url = output
                    else:
                        return _fail(provider, "No output URL in response")
                    # Download image
                    img_resp = await client.get(image_url)
                    img_resp.raise_for_status()
                    raw = img_resp.content
                    filename = f"generated_{int(time.time())}.png"
                    return _ok(_bytes_to_data_url(raw, "image/png"), raw, filename, "image/png", provider)
                elif status == "failed":
                    return _fail(provider, data.get("error", "Prediction failed"))
                elif status == "canceled":
                    return _fail(provider, "Prediction canceled")

            return _fail(provider, "Polling timed out")

    except Exception as e:
        return _fail(provider, str(e))


async def generate_image_huggingface(prompt: str) -> dict:
    """Provider 3: Hugging Face Inference API."""
    provider = "huggingface"
    try:
        token = (os.getenv("HF_TOKEN") or "").strip()

        model = "stabilityai/stable-diffusion-xl-base-1.0"
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"https://api-inference.huggingface.co/models/{model}",
                headers=headers,
                json={"inputs": prompt},
            )
            if resp.status_code == 503:
                # Model loading, wait and retry once
                wait_time = resp.json().get("estimated_time", 30)
                logger.info(f"[MEDIA] HF model loading, waiting {wait_time}s...")
                await asyncio.sleep(min(wait_time, 60))
                resp = await client.post(
                    f"https://api-inference.huggingface.co/models/{model}",
                    headers=headers,
                    json={"inputs": prompt},
                )
            resp.raise_for_status()

            raw = resp.content
            # HF returns raw image bytes
            if len(raw) < 1000:
                # Likely an error JSON
                return _fail(provider, raw.decode("utf-8", errors="replace")[:300])

            filename = f"generated_{int(time.time())}.png"
            return _ok(_bytes_to_data_url(raw, "image/png"), raw, filename, "image/png", provider)

    except Exception as e:
        return _fail(provider, str(e))


async def generate_image_zimage(prompt: str) -> dict:
    """Provider 4: Z-Image-Turbo (local GPU)."""
    provider = "zimage-local"
    try:
        from backend.zimage_agent import generate_zimage

        result = await generate_zimage(prompt)
        if not result.get("success"):
            return _fail(provider, result.get("error", "Z-Image generation failed"))

        image_path = result["image_path"]
        with open(image_path, "rb") as f:
            raw = f.read()

        filename = os.path.basename(image_path)
        return _ok(_bytes_to_data_url(raw, "image/png"), raw, filename, "image/png", provider)

    except Exception as e:
        return _fail(provider, str(e))


# ---------------------------------------------------------------------------
# VIDEO PROVIDERS
# ---------------------------------------------------------------------------

async def generate_video_seedance(prompt: str) -> dict:
    """Provider 1: Seedance via AI/ML API."""
    provider = "seedance"
    try:
        key = (os.getenv("AIML_API_KEY") or "").strip()
        if not key:
            return _fail(provider, "AIML_API_KEY not set")

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=300) as client:
            # Create generation task
            resp = await client.post(
                "https://api.aimlapi.com/v2/video/generations",
                headers=headers,
                json={
                    "model": "bytedance/seedance-1-0-lite-t2v",
                    "prompt": prompt,
                    "resolution": "720p",
                    "duration": 5,
                },
            )
            resp.raise_for_status()
            gen_data = resp.json()
            gen_id = gen_data.get("id")
            if not gen_id:
                return _fail(provider, f"No generation ID returned: {str(gen_data)[:200]}")

            # Poll for completion (video takes 40-120s)
            for _ in range(60):  # max ~5 min
                await asyncio.sleep(5)
                status_resp = await client.get(
                    "https://api.aimlapi.com/v2/video/generations",
                    headers=headers,
                    params={"generation_id": gen_id},
                )
                status_resp.raise_for_status()
                status_data = status_resp.json()
                status = status_data.get("status", "")

                if status in ("completed", "succeeded"):
                    video_url = status_data.get("video", {}).get("url", "")
                    if not video_url:
                        return _fail(provider, "Completed but no video URL returned")
                    vid_resp = await client.get(video_url)
                    vid_resp.raise_for_status()
                    raw = vid_resp.content
                    filename = f"generated_{int(time.time())}.mp4"
                    return _ok(_bytes_to_data_url(raw, "video/mp4"), raw, filename, "video/mp4", provider)
                elif status in ("error", "failed"):
                    return _fail(provider, status_data.get("error", "Seedance generation failed"))

            return _fail(provider, "Polling timed out after 5 minutes")

    except Exception as e:
        return _fail(provider, str(e))


async def generate_video_fal(prompt: str) -> dict:
    """Provider 2: Fal.ai Wan 2.1 T2V."""
    provider = "fal-wan2.1"
    try:
        key = (os.getenv("FAL_KEY") or "").strip()
        if not key:
            return _fail(provider, "FAL_KEY not set")

        headers = {
            "Authorization": f"Key {key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                "https://queue.fal.run/fal-ai/wan-t2v",
                headers=headers,
                json={"prompt": prompt},
            )
            resp.raise_for_status()
            data = resp.json()

            if "video" in data:
                video_url = data["video"]["url"]
            elif "request_id" in data:
                request_id = data["request_id"]
                status_url = f"https://queue.fal.run/fal-ai/wan-t2v/requests/{request_id}/status"
                result_url = f"https://queue.fal.run/fal-ai/wan-t2v/requests/{request_id}"
                for _ in range(150):  # up to ~5 min for video
                    await asyncio.sleep(2)
                    status_resp = await client.get(status_url, headers=headers)
                    status_resp.raise_for_status()
                    status_data = status_resp.json()
                    if status_data.get("status") == "COMPLETED":
                        result_resp = await client.get(result_url, headers=headers)
                        result_resp.raise_for_status()
                        result_data = result_resp.json()
                        video_url = result_data["video"]["url"]
                        break
                    elif status_data.get("status") in ("FAILED",):
                        return _fail(provider, status_data.get("error", "Fal video failed"))
                else:
                    return _fail(provider, "Polling timed out")
            else:
                return _fail(provider, "Unexpected response format")

            vid_resp = await client.get(video_url)
            vid_resp.raise_for_status()
            raw = vid_resp.content
            filename = f"generated_{int(time.time())}.mp4"
            return _ok(_bytes_to_data_url(raw, "video/mp4"), raw, filename, "video/mp4", provider)

    except Exception as e:
        return _fail(provider, str(e))


async def generate_video_replicate(prompt: str) -> dict:
    """Provider 2: Replicate Wan 2.1 T2V."""
    provider = "replicate-wan2.1"
    try:
        token = (os.getenv("REPLICATE_API_TOKEN") or "").strip()
        if not token:
            return _fail(provider, "REPLICATE_API_TOKEN not set")

        headers = {
            "Authorization": f"Token {token}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                "https://api.replicate.com/v1/models/wan-ai/wan2.1-t2v-480p/predictions",
                headers=headers,
                json={"input": {"prompt": prompt}},
            )
            resp.raise_for_status()
            prediction = resp.json()
            poll_url = prediction.get("urls", {}).get("get", prediction.get("url", ""))

            # Poll — video takes longer
            for _ in range(90):  # max ~180s
                await asyncio.sleep(2)
                poll_resp = await client.get(poll_url, headers=headers)
                poll_resp.raise_for_status()
                data = poll_resp.json()
                status = data.get("status")
                if status == "succeeded":
                    output = data.get("output")
                    if isinstance(output, list) and output:
                        video_url = output[0]
                    elif isinstance(output, str):
                        video_url = output
                    else:
                        return _fail(provider, "No output URL in response")
                    vid_resp = await client.get(video_url)
                    vid_resp.raise_for_status()
                    raw = vid_resp.content
                    filename = f"generated_{int(time.time())}.mp4"
                    return _ok(_bytes_to_data_url(raw, "video/mp4"), raw, filename, "video/mp4", provider)
                elif status == "failed":
                    return _fail(provider, data.get("error", "Video prediction failed"))
                elif status == "canceled":
                    return _fail(provider, "Prediction canceled")

            return _fail(provider, "Polling timed out")

    except Exception as e:
        return _fail(provider, str(e))


async def generate_video_huggingface(prompt: str) -> dict:
    """Provider 2: Hugging Face Inference API video."""
    provider = "huggingface-video"
    try:
        token = (os.getenv("HF_TOKEN") or "").strip()

        model = "ali-vilab/text-to-video-ms-1.7b"
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                f"https://api-inference.huggingface.co/models/{model}",
                headers=headers,
                json={"inputs": prompt},
            )
            if resp.status_code == 503:
                wait_time = resp.json().get("estimated_time", 60)
                logger.info(f"[MEDIA] HF video model loading, waiting {wait_time}s...")
                await asyncio.sleep(min(wait_time, 90))
                resp = await client.post(
                    f"https://api-inference.huggingface.co/models/{model}",
                    headers=headers,
                    json={"inputs": prompt},
                )
            resp.raise_for_status()

            raw = resp.content
            if len(raw) < 1000:
                return _fail(provider, raw.decode("utf-8", errors="replace")[:300])

            filename = f"generated_{int(time.time())}.mp4"
            return _ok(_bytes_to_data_url(raw, "video/mp4"), raw, filename, "video/mp4", provider)

    except Exception as e:
        return _fail(provider, str(e))


# ---------------------------------------------------------------------------
# ORCHESTRATORS
# ---------------------------------------------------------------------------

_IMAGE_CHAIN = [
    ("gemini", generate_image_gemini),
    ("fireworks", generate_image_fireworks),
    ("together", generate_image_together),
    ("fal", generate_image_fal),
    ("replicate", generate_image_replicate),
    ("huggingface", generate_image_huggingface),
    ("zimage", generate_image_zimage),
]

_VIDEO_CHAIN = [
    ("seedance", generate_video_seedance),
    ("fal", generate_video_fal),
    ("replicate", generate_video_replicate),
    ("huggingface", generate_video_huggingface),
]


async def generate_image(prompt: str, on_progress: Optional[Callable] = None) -> dict:
    """Try each image provider in order until one succeeds."""
    for key, fn in _IMAGE_CHAIN:
        if not _provider_available(key):
            logger.info(f"[MEDIA] Skipping {key} (no API key)")
            continue

        logger.info(f"[MEDIA] Trying image provider: {key}")
        if on_progress:
            on_progress({"status": "trying_provider", "provider": key})

        result = await fn(prompt)

        if result["success"]:
            logger.info(f"[MEDIA] Image generated successfully via {result['provider']}")
            return result

        logger.warning(f"[MEDIA] {result['provider']} failed: {result['error']}, trying next...")
        if on_progress:
            on_progress({"status": "trying_fallback", "provider": key, "error": result["error"]})

    return _fail("all", "All image providers failed. Check API keys and quotas.")


async def generate_video(prompt: str, on_progress: Optional[Callable] = None) -> dict:
    """Try each video provider in order until one succeeds."""
    for key, fn in _VIDEO_CHAIN:
        if not _provider_available(key):
            logger.info(f"[MEDIA] Skipping video provider {key} (no API key)")
            continue

        logger.info(f"[MEDIA] Trying video provider: {key}")
        if on_progress:
            on_progress({"status": "trying_provider", "provider": key})

        result = await fn(prompt)

        if result["success"]:
            logger.info(f"[MEDIA] Video generated successfully via {result['provider']}")
            return result

        logger.warning(f"[MEDIA] {result['provider']} failed: {result['error']}, trying next...")
        if on_progress:
            on_progress({"status": "trying_fallback", "provider": key, "error": result["error"]})

    return _fail("all", "All video providers failed. Check API keys and quotas.")
