# External Tools Setup Guide

This directory contains powerful AI/ML tools integrated with JODA for enhanced capabilities.

## 📦 Installed Tools

### 1. Z-Image Generator (Image Generation)
**Purpose**: State-of-the-art image generation with 6B parameters - ranked #1 open-source model on Artificial Analysis Leaderboard.

**Status**: ✅ Installed and Ready
- Repository: `/root/Desktop/joda_ai_local/external_tools/Z-Image`
- Dependencies: Installed in JODA venv
- Model: Auto-downloads on first use from Hugging Face

**Features**:
- Sub-second inference on H800 GPUs
- Fits in 16GB VRAM consumer devices
- Photorealistic image generation
- Bilingual text rendering (English & Chinese)
- 8 inference steps (Z-Image-Turbo)

**Quick Start**:
```python
import torch
from diffusers import ZImagePipeline

# Load the pipeline
pipe = ZImagePipeline.from_pretrained(
    "Tongyi-MAI/Z-Image-Turbo",
    torch_dtype=torch.bfloat16,
)
pipe.to("cuda")

# Generate image
prompt = "Young Chinese woman in red Hanfu, intricate embroidery..."
image = pipe(
    prompt=prompt,
    height=1024,
    width=1024,
    num_inference_steps=9,
    guidance_scale=0.0,
).images[0]

image.save("example.png")
```

**Integration with JODA**:
- Backend endpoint: `/generate_zimage`
- Tool name: `generate_zimage`
- See: `backend/zimage_agent.py`

---

### 2. Judge0 (Code Execution Sandbox)
**Purpose**: Robust, scalable, and sandboxed code execution system for 90+ programming languages.

**Status**: ⚙️ Requires Docker Setup
- Repository: `/root/Desktop/joda_ai_local/external_tools/judge0`
- Docker Compose: Ready
- Configuration: Needs password setup

**Features**:
- Sandboxed execution of untrusted code
- Support for 90+ languages
- Compilation and execution of multi-file programs
- Custom compiler options and time/memory limits
- HTTP JSON API

**Setup Instructions**:

1. **Generate secure passwords**:
```bash
# Generate Redis password
export REDIS_PASS=$(openssl rand -base64 32)

# Generate PostgreSQL password
export POSTGRES_PASS=$(openssl rand -base64 32)
```

2. **Update judge0.conf**:
```bash
cd /root/Desktop/joda_ai_local/external_tools/judge0

# Update Redis password
sed -i "s/REDIS_PASSWORD=/REDIS_PASSWORD=$REDIS_PASS/" judge0.conf

# Update PostgreSQL password
sed -i "s/POSTGRES_PASSWORD=/POSTGRES_PASSWORD=$POSTGRES_PASS/" judge0.conf
```

3. **Start Judge0 services**:
```bash
# Start database and redis first
docker-compose up -d db redis
sleep 10

# Start all services
docker-compose up -d

# Check status
docker-compose ps
```

4. **Test Judge0 API**:
```bash
curl -X POST http://localhost:2358/submissions?wait=true \
  -H "Content-Type: application/json" \
  -d '{
    "language_id": 71,
    "source_code": "print(\"Hello, World!\")"
  }'
```

**Integration with JODA**:
- Backend endpoint: `/execute_code`
- Tool name: `execute_code`
- See: `backend/judge0_client.py`

---

### 3. Pinokio (Open Source Model Platform)
**Purpose**: 1-click launcher for any open-source AI model project.

**Status**: 📦 Cloned (Requires Build)
- Repository: `/root/Desktop/joda_ai_local/external_tools/pinokio`
- Type: Electron application
- Platform: Node.js based

**About**:
Pinokio is a desktop application that allows you to:
- Launch any open-source AI model with 1 click
- Isolated script execution in `~/pinokio/api`
- Built-in package managers (Conda, Homebrew, Pip, NPM)
- Access to verified AI models from the "Discover" page

**Build Instructions** (Optional - for desktop use):
```bash
cd /root/Desktop/joda_ai_local/external_tools/pinokio

# Install dependencies
npm install

# Build Electron app
npm run build

# Or run in development mode
npm start
```

**Note**: Pinokio is primarily a desktop application for managing AI models. For server integration, consider using its script format directly in JODA's agent system.

---

## 🔗 JODA Integration Architecture

### Z-Image Integration

**Backend: `backend/zimage_agent.py`**
```python
from diffusers import ZImagePipeline
import torch

class ZImageAgent:
    def __init__(self):
        self.pipe = ZImagePipeline.from_pretrained(
            "Tongyi-MAI/Z-Image-Turbo",
            torch_dtype=torch.bfloat16,
        )
        self.pipe.to("cuda")

    async def generate(self, prompt: str, width: int = 1024, height: int = 1024):
        image = self.pipe(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=9,
            guidance_scale=0.0,
        ).images[0]
        return image
```

**Usage in JODA**:
```
User: "Generate an image of a futuristic city at sunset"
JODA: [Uses generate_zimage tool] → Returns image path
```

---

### Judge0 Integration

**Backend: `backend/judge0_client.py`**
```python
import httpx

class Judge0Client:
    BASE_URL = "http://localhost:2358"

    async def execute_code(self, language_id: int, source_code: str, stdin: str = ""):
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.BASE_URL}/submissions?wait=true",
                json={
                    "language_id": language_id,
                    "source_code": source_code,
                    "stdin": stdin
                }
            )
            return response.json()
```

**Supported Languages** (examples):
- Python: `language_id = 71`
- JavaScript (Node.js): `language_id = 63`
- C++: `language_id = 54`
- Java: `language_id = 62`
- Go: `language_id = 60`

**Usage in JODA**:
```
User: "Run this Python code: print('Hello JODA')"
JODA: [Uses execute_code tool] → Returns execution result with stdout/stderr
```

---

## 📊 System Requirements

### Z-Image:
- CUDA-capable GPU (recommended: 16GB+ VRAM)
- Python 3.8+
- PyTorch 2.5.0+
- 20GB+ free disk space (for model cache)

### Judge0:
- Docker 20.10+
- Docker Compose 2.0+
- Linux (Ubuntu 22.04 recommended)
- 4GB+ RAM
- 10GB+ disk space

### Pinokio:
- Node.js 16+
- Electron compatible OS
- 2GB+ RAM

---

## 🚀 Quick Start Commands

### Start All Services:
```bash
# From JODA root directory
cd /root/Desktop/joda_ai_local

# Start JODA (includes Z-Image)
./start-joda.sh

# Start Judge0 (in separate terminal)
cd external_tools/judge0
docker-compose up -d
```

### Stop All Services:
```bash
# Stop JODA
./stop-joda.sh

# Stop Judge0
cd external_tools/judge0
docker-compose down
```

### Check Service Status:
```bash
# Judge0
cd external_tools/judge0
docker-compose ps

# JODA
ps aux | grep joda
```

---

## 📖 Additional Resources

- **Z-Image Documentation**: https://github.com/joe-nano/Z-Image
- **Z-Image Paper**: https://arxiv.org/abs/2511.22699
- **Judge0 API Docs**: https://ce.judge0.com
- **Pinokio Docs**: https://docs.pinokio.computer

---

## 🔧 Troubleshooting

### Z-Image Model Download Issues:
```bash
# Manually download model
huggingface-cli download Tongyi-MAI/Z-Image-Turbo --local-dir ~/.cache/huggingface/hub/Z-Image-Turbo
```

### Judge0 Connection Refused:
```bash
# Check if services are running
docker-compose ps

# Restart services
docker-compose restart

# Check logs
docker-compose logs -f server
```

### CUDA Out of Memory:
```python
# Use CPU offloading in Z-Image
pipe.enable_model_cpu_offload()
```

---

## 📝 License Notes

- **Z-Image**: Apache 2.0 License
- **Judge0**: GNU General Public License v3.0
- **Pinokio**: MIT License

All tools remain under their original licenses and are used as external dependencies.
