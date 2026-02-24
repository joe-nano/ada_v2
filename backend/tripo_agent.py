"""
TripoAgent — Text-to-3D model generation via the Tripo AI API.

Uses the Tripo v2 API to generate high-quality GLB meshes from text prompts.
API docs: https://platform.tripo3d.ai/docs/generation

Flow:
  1. POST /v2/openapi/task  with {type: "text_to_model", prompt: ...}
  2. Poll  GET /v2/openapi/task/{task_id}  until status == "success"
  3. Download the GLB from output.model URL
  4. Return base64-encoded GLB data
"""

import os
import asyncio
import base64
import aiohttp
from dotenv import load_dotenv

load_dotenv()

TRIPO_BASE = "https://api.tripo3d.ai/v2/openapi"
POLL_INTERVAL = 2  # seconds between status checks
MAX_POLL_TIME = 300  # max 5 minutes for a generation


class TripoAgent:
    def __init__(self, on_status=None):
        self.api_key = os.getenv("TRIPO_API_KEY")
        self.on_status = on_status  # Callback: {status, progress, error}

    def _headers(self):
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    async def generate_model(self, prompt: str, output_dir: str = None, model_version: str = "default"):
        """
        Generate a 3D model from a text prompt via Tripo API.

        Returns:
            dict with keys: format ("glb"), data (base64), file_path (local path)
            or None on failure.
        """
        if not self.api_key:
            print("[TripoAgent] ERROR: TRIPO_API_KEY not set")
            return None

        print(f"[TripoAgent] Generating model for: '{prompt}'")

        if self.on_status:
            self.on_status({"status": "generating", "provider": "tripo", "progress": 0})

        try:
            async with aiohttp.ClientSession() as session:
                # 1. Create task
                task_id = await self._create_task(session, prompt, model_version)
                if not task_id:
                    return None

                print(f"[TripoAgent] Task created: {task_id}")

                # 2. Poll until complete
                result = await self._poll_task(session, task_id)
                if not result:
                    return None

                # 3. Download GLB
                model_url = result.get("model")
                if not model_url:
                    print("[TripoAgent] ERROR: No model URL in result")
                    return None

                print(f"[TripoAgent] Downloading model from: {model_url}")
                glb_data = await self._download(session, model_url)
                if not glb_data:
                    return None

                # 4. Save to disk if output_dir provided
                file_path = None
                if output_dir:
                    os.makedirs(output_dir, exist_ok=True)
                    from datetime import datetime
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    file_path = os.path.join(output_dir, f"tripo_{timestamp}.glb")
                    with open(file_path, "wb") as f:
                        f.write(glb_data)
                    print(f"[TripoAgent] Saved to: {file_path}")

                b64_data = base64.b64encode(glb_data).decode("utf-8")

                if self.on_status:
                    self.on_status({"status": "success", "provider": "tripo", "progress": 100})

                return {
                    "format": "glb",
                    "data": b64_data,
                    "file_path": file_path,
                }

        except Exception as e:
            print(f"[TripoAgent] ERROR: {e}")
            import traceback
            traceback.print_exc()
            if self.on_status:
                self.on_status({"status": "failed", "provider": "tripo", "error": str(e)})
            return None

    async def _create_task(self, session, prompt, model_version="default"):
        """POST /task to create a text_to_model generation task."""
        payload = {
            "type": "text_to_model",
            "prompt": prompt,
        }
        if model_version and model_version != "default":
            payload["model_version"] = model_version

        async with session.post(
            f"{TRIPO_BASE}/task",
            json=payload,
            headers=self._headers(),
        ) as resp:
            body = await resp.json()
            if resp.status != 200 or body.get("code") != 0:
                err = body.get("message", body)
                print(f"[TripoAgent] Task creation failed: {err}")
                if self.on_status:
                    self.on_status({"status": "failed", "provider": "tripo", "error": str(err)})
                return None
            return body["data"]["task_id"]

    async def _poll_task(self, session, task_id):
        """Poll GET /task/{task_id} until success or failure."""
        elapsed = 0
        while elapsed < MAX_POLL_TIME:
            async with session.get(
                f"{TRIPO_BASE}/task/{task_id}",
                headers=self._headers(),
            ) as resp:
                body = await resp.json()
                data = body.get("data", {})
                status = data.get("status", "unknown")
                progress = data.get("progress", 0)

                if self.on_status:
                    self.on_status({
                        "status": status,
                        "provider": "tripo",
                        "progress": progress,
                    })

                if status == "success":
                    return data.get("output", {})
                elif status == "failed":
                    err = data.get("message", "Generation failed")
                    print(f"[TripoAgent] Task failed: {err}")
                    return None

            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

        print("[TripoAgent] Task timed out")
        if self.on_status:
            self.on_status({"status": "failed", "provider": "tripo", "error": "Timed out"})
        return None

    async def _download(self, session, url):
        """Download binary data from a URL."""
        async with session.get(url) as resp:
            if resp.status != 200:
                print(f"[TripoAgent] Download failed: HTTP {resp.status}")
                return None
            return await resp.read()
