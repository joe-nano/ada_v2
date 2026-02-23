"""
Z-Image Agent - State-of-the-art image generation integration for JODA
Using Z-Image-Turbo: #1 open-source model on Artificial Analysis Leaderboard
"""

import torch
from diffusers import ZImagePipeline
from pathlib import Path
import asyncio
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class ZImageAgent:
    """
    Z-Image-Turbo integration for JODA
    - 6B parameter model
    - Sub-second inference
    - Photorealistic generation
    - Bilingual text rendering (English & Chinese)
    """

    def __init__(self, model_path: str = "Tongyi-MAI/Z-Image-Turbo", device: str = "cuda"):
        self.model_path = model_path
        self.device = device
        self.pipe = None
        self.output_dir = Path("outputs/zimage")
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def load_model(self):
        """Load Z-Image pipeline (lazy loading)"""
        if self.pipe is None:
            try:
                logger.info(f"[Z-IMAGE] Loading model from {self.model_path}...")
                self.pipe = ZImagePipeline.from_pretrained(
                    self.model_path,
                    torch_dtype=torch.bfloat16,
                    low_cpu_mem_usage=False,
                )

                # Move to device
                if torch.cuda.is_available() and self.device == "cuda":
                    self.pipe.to("cuda")
                    logger.info("[Z-IMAGE] Model loaded on CUDA")
                else:
                    # CPU fallback
                    self.pipe.enable_model_cpu_offload()
                    logger.warning("[Z-IMAGE] CUDA not available, using CPU offload")

                # Optional: Enable Flash Attention for better performance
                try:
                    self.pipe.transformer.set_attention_backend("flash")
                    logger.info("[Z-IMAGE] Flash Attention enabled")
                except:
                    logger.info("[Z-IMAGE] Flash Attention not available, using default")

            except Exception as e:
                logger.error(f"[Z-IMAGE] Failed to load model: {e}")
                raise

    async def generate_image(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 1024,
        num_inference_steps: int = 9,
        seed: Optional[int] = None,
    ) -> str:
        """
        Generate image from text prompt

        Args:
            prompt: Text description of the image
            width: Image width (default 1024)
            height: Image height (default 1024)
            num_inference_steps: Number of denoising steps (default 9 for Turbo)
            seed: Random seed for reproducibility (optional)

        Returns:
            Path to generated image
        """
        # Load model if not loaded
        if self.pipe is None:
            self.load_model()

        try:
            logger.info(f"[Z-IMAGE] Generating image: {prompt[:50]}...")

            # Run generation in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            image = await loop.run_in_executor(
                None,
                self._generate_sync,
                prompt,
                width,
                height,
                num_inference_steps,
                seed,
            )

            # Save image
            import time
            filename = f"zimage_{int(time.time())}.png"
            output_path = self.output_dir / filename
            image.save(output_path)

            logger.info(f"[Z-IMAGE] Image saved to {output_path}")
            return str(output_path)

        except Exception as e:
            logger.error(f"[Z-IMAGE] Generation failed: {e}")
            raise

    def _generate_sync(self, prompt, width, height, num_inference_steps, seed):
        """Synchronous generation for thread pool execution"""
        generator = None
        if seed is not None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            generator = torch.Generator(device).manual_seed(seed)

        result = self.pipe(
            prompt=prompt,
            height=height,
            width=width,
            num_inference_steps=num_inference_steps,
            guidance_scale=0.0,  # Turbo models don't use CFG
            generator=generator,
        )

        return result.images[0]

    async def generate_batch(
        self,
        prompts: list[str],
        width: int = 1024,
        height: int = 1024,
        num_inference_steps: int = 9,
    ) -> list[str]:
        """
        Generate multiple images from a list of prompts

        Args:
            prompts: List of text descriptions
            width: Image width
            height: Image height
            num_inference_steps: Number of denoising steps

        Returns:
            List of paths to generated images
        """
        tasks = [
            self.generate_image(prompt, width, height, num_inference_steps)
            for prompt in prompts
        ]
        return await asyncio.gather(*tasks)

    def unload_model(self):
        """Unload model to free GPU memory"""
        if self.pipe is not None:
            del self.pipe
            self.pipe = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("[Z-IMAGE] Model unloaded")


# Global instance
_zimage_agent = None

def get_zimage_agent() -> ZImageAgent:
    """Get or create global Z-Image agent instance"""
    global _zimage_agent
    if _zimage_agent is None:
        _zimage_agent = ZImageAgent()
    return _zimage_agent


# Tool function for JODA's tool system
async def generate_zimage(prompt: str, width: int = 1024, height: int = 1024, seed: Optional[int] = None) -> dict:
    """
    Generate an image using Z-Image-Turbo

    Args:
        prompt: Detailed text description of the image to generate
        width: Image width in pixels (default 1024)
        height: Image height in pixels (default 1024)
        seed: Random seed for reproducibility (optional)

    Returns:
        Dictionary with image_path and metadata
    """
    try:
        agent = get_zimage_agent()
        image_path = await agent.generate_image(prompt, width, height, seed=seed)

        return {
            "success": True,
            "image_path": image_path,
            "prompt": prompt,
            "dimensions": f"{width}x{height}",
            "model": "Z-Image-Turbo",
        }
    except Exception as e:
        logger.error(f"[Z-IMAGE TOOL] Error: {e}")
        return {
            "success": False,
            "error": str(e),
        }


if __name__ == "__main__":
    # Test script
    async def test():
        agent = ZImageAgent()

        test_prompts = [
            "A futuristic cityscape at sunset with flying cars",
            "Young Chinese woman in red Hanfu, intricate embroidery",
            "Cyberpunk street market with neon signs and rain",
        ]

        for prompt in test_prompts:
            print(f"\nGenerating: {prompt}")
            result = await generate_zimage(prompt)
            print(f"Result: {result}")

    asyncio.run(test())
