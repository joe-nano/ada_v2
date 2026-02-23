"""
Beautiful Avatar Service - High-Quality TTS + Lip Sync
Integrates ElevenLabs TTS with Rhubarb lip sync for J.O.D.A's beautiful 3D avatar
"""

import asyncio
import subprocess
import json
import base64
import os
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class BeautifulAvatarService:
    """
    High-quality TTS with phoneme-based lip sync for beautiful avatars

    Pipeline:
    1. Generate speech with ElevenLabs (high-quality TTS)
    2. Convert MP3 → WAV for Rhubarb processing
    3. Extract phonemes/visemes using Rhubarb
    4. Return audio + lip sync data to frontend
    """

    def __init__(self, elevenlabs_api_key: Optional[str] = None):
        """
        Initialize the beautiful avatar service

        Args:
            elevenlabs_api_key: ElevenLabs API key (optional, can use env var)
        """
        self.api_key = elevenlabs_api_key or os.getenv('ELEVENLABS_API_KEY')
        self.audio_dir = Path(__file__).parent.parent / 'audios'
        self.audio_dir.mkdir(exist_ok=True)

        self.rhubarb_path = Path(__file__).parent / 'bin' / 'rhubarb'

        # Verify Rhubarb is available
        if not self.rhubarb_path.exists():
            logger.warning(f"Rhubarb binary not found at {self.rhubarb_path}")

        logger.info("Beautiful Avatar Service initialized")

    async def generate_speech_with_lipsync(
        self,
        text: str,
        voice_id: str = "21m00Tcm4TlvDq8ikWAM",  # Rachel - natural female voice
        model: str = "eleven_multilingual_v2"
    ) -> Dict[str, Any]:
        """
        Generate high-quality speech with lip sync data

        Args:
            text: Text to convert to speech
            voice_id: ElevenLabs voice ID
            model: ElevenLabs model to use

        Returns:
            Dict with audio (base64), lipsync data, and metadata
        """
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            base_filename = f"speech_{timestamp}"
            mp3_path = self.audio_dir / f"{base_filename}.mp3"
            wav_path = self.audio_dir / f"{base_filename}.wav"

            # Step 1: Generate speech with ElevenLabs
            logger.info(f"Generating speech with ElevenLabs: '{text[:50]}...'")
            audio_data = await self._generate_elevenlabs_speech(
                text, voice_id, model, mp3_path
            )

            if not audio_data:
                logger.error("Failed to generate speech with ElevenLabs")
                return {"success": False, "error": "Speech generation failed"}

            # Step 2: Convert MP3 to WAV for Rhubarb
            logger.info(f"Converting {mp3_path} to WAV")
            wav_success = await self._convert_to_wav(mp3_path, wav_path)

            if not wav_success:
                logger.error("Failed to convert MP3 to WAV")
                return {"success": False, "error": "Audio conversion failed"}

            # Step 3: Generate lip sync data with Rhubarb
            logger.info(f"Generating lip sync with Rhubarb")
            lipsync_data = await self._generate_lipsync(wav_path)

            if not lipsync_data:
                logger.warning("Lip sync generation failed, returning audio only")
                lipsync_data = {"mouthCues": []}

            # Step 4: Encode audio to base64
            with open(mp3_path, 'rb') as f:
                audio_b64 = base64.b64encode(f.read()).decode('utf-8')

            # Clean up WAV file (keep MP3 for debugging)
            if wav_path.exists():
                wav_path.unlink()

            return {
                "success": True,
                "audio": audio_b64,
                "audioFormat": "mp3",
                "lipsync": lipsync_data,
                "text": text,
                "duration": lipsync_data.get("metadata", {}).get("duration", 0),
                "timestamp": timestamp
            }

        except Exception as e:
            logger.error(f"Error in generate_speech_with_lipsync: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def _generate_elevenlabs_speech(
        self,
        text: str,
        voice_id: str,
        model: str,
        output_path: Path
    ) -> bool:
        """Generate speech using ElevenLabs API"""
        try:
            # Import elevenlabs here to avoid import errors if not installed
            from elevenlabs.client import ElevenLabs
            from elevenlabs import VoiceSettings

            if not self.api_key:
                logger.error("ElevenLabs API key not found")
                return False

            client = ElevenLabs(api_key=self.api_key)

            # Generate speech
            audio = client.generate(
                text=text,
                voice=voice_id,
                model=model,
                voice_settings=VoiceSettings(
                    stability=0.5,
                    similarity_boost=0.75,
                    style=0.0,
                    use_speaker_boost=True
                )
            )

            # Write audio to file
            with open(output_path, 'wb') as f:
                for chunk in audio:
                    f.write(chunk)

            logger.info(f"Speech generated successfully: {output_path}")
            return True

        except ImportError:
            logger.error("elevenlabs package not installed")
            return False
        except Exception as e:
            logger.error(f"ElevenLabs API error: {e}", exc_info=True)
            return False

    async def _convert_to_wav(self, input_path: Path, output_path: Path) -> bool:
        """Convert audio file to WAV format using ffmpeg"""
        try:
            # Check if ffmpeg is available
            result = subprocess.run(
                ['which', 'ffmpeg'],
                capture_output=True,
                text=True
            )

            if result.returncode != 0:
                logger.error("ffmpeg not found. Install with: apt install ffmpeg")
                return False

            # Convert MP3 to WAV
            result = subprocess.run(
                [
                    'ffmpeg', '-y',  # Overwrite output file
                    '-i', str(input_path),  # Input file
                    '-ar', '16000',  # Sample rate 16kHz (Rhubarb requirement)
                    '-ac', '1',  # Mono audio
                    '-acodec', 'pcm_s16le',  # 16-bit PCM
                    str(output_path)  # Output file
                ],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode != 0:
                logger.error(f"ffmpeg error: {result.stderr}")
                return False

            logger.info(f"Converted to WAV: {output_path}")
            return True

        except subprocess.TimeoutExpired:
            logger.error("ffmpeg conversion timed out")
            return False
        except Exception as e:
            logger.error(f"WAV conversion error: {e}", exc_info=True)
            return False

    async def _generate_lipsync(self, audio_path: Path) -> Optional[Dict[str, Any]]:
        """Generate lip sync data using Rhubarb"""
        try:
            if not self.rhubarb_path.exists():
                logger.error(f"Rhubarb binary not found: {self.rhubarb_path}")
                return None

            # Run Rhubarb lip sync
            result = subprocess.run(
                [
                    str(self.rhubarb_path),
                    '-f', 'json',  # Output format: JSON
                    '--extendedShapes', 'GHX',  # Extended viseme set
                    str(audio_path)
                ],
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode != 0:
                logger.error(f"Rhubarb error: {result.stderr}")
                return None

            # Parse Rhubarb JSON output
            lipsync_data = json.loads(result.stdout)

            logger.info(f"Lip sync generated: {len(lipsync_data.get('mouthCues', []))} cues")
            return lipsync_data

        except subprocess.TimeoutExpired:
            logger.error("Rhubarb processing timed out")
            return None
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Rhubarb output: {e}")
            return None
        except Exception as e:
            logger.error(f"Lip sync generation error: {e}", exc_info=True)
            return None

    async def test_service(self) -> Dict[str, Any]:
        """
        Test the beautiful avatar service with a sample phrase

        Returns:
            Test results
        """
        test_text = "Hello! This is a test of the beautiful avatar system."

        logger.info("Running Beautiful Avatar Service test...")
        result = await self.generate_speech_with_lipsync(test_text)

        if result.get("success"):
            logger.info(f"✅ Test successful!")
            logger.info(f"   Audio size: {len(result.get('audio', ''))} bytes (base64)")
            logger.info(f"   Lip sync cues: {len(result.get('lipsync', {}).get('mouthCues', []))}")
            logger.info(f"   Duration: {result.get('duration')}s")
        else:
            logger.error(f"❌ Test failed: {result.get('error')}")

        return result


# Example usage
if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s'
    )

    async def main():
        service = BeautifulAvatarService()

        if len(sys.argv) > 1:
            text = " ".join(sys.argv[1:])
        else:
            text = "Hello! I am J.O.D.A, your beautiful AI assistant."

        result = await service.generate_speech_with_lipsync(text)

        if result.get("success"):
            print(f"\n✅ Speech generated successfully!")
            print(f"   Text: {result['text']}")
            print(f"   Duration: {result.get('duration')}s")
            print(f"   Lip sync cues: {len(result['lipsync']['mouthCues'])}")
            print(f"\nFirst 3 mouth cues:")
            for cue in result['lipsync']['mouthCues'][:3]:
                print(f"   {cue['start']:.2f}s - {cue['end']:.2f}s: {cue['value']}")
        else:
            print(f"\n❌ Failed: {result.get('error')}")

    asyncio.run(main())
