# External Tools for JODA

This directory contains powerful AI/ML tools that extend JODA's capabilities for image generation, code execution, and open-source model management.

## 🎯 Quick Summary

| Tool | Status | Purpose | Integration |
|------|--------|---------|-------------|
| **Z-Image** | ✅ Ready | State-of-the-art image generation (6B params) | `generate_zimage()` |
| **Ollama** | ✅ Ready | Model management & backup (Z-Image stored) | Model Storage |
| **Judge0** | ⚙️ Setup Required | Sandboxed code execution (90+ languages) | `execute_code()` |
| **Pinokio** | 📦 Available | 1-click launcher for open-source AI models | Desktop App |

---

## 🚀 Quick Start

### Z-Image (Image Generation)
Already installed and ready to use! Just call the JODA tool:

```python
# In JODA conversation:
"Generate an image of a futuristic city at sunset with flying cars"
```

The image will be saved to `/root/Desktop/joda_ai_local/outputs/zimage/`

**Test it directly**:
```bash
cd /root/Desktop/joda_ai_local/backend
python zimage_agent.py
```

### Ollama (Model Management & Backup)
Ollama is used to manage and backup AI models, including Z-Image-Turbo.

**Check available models**:
```bash
ollama list
```

**Pull new models**:
```bash
ollama pull model-name
```

**Sync models to Google Drive**:
```bash
cd /root/Desktop/joda_ai_local/external_tools
./sync-ollama-to-gdrive.sh
```

**Model Storage Locations**:
- Local: `/usr/share/ollama/.ollama/models` (19GB)
- Backup: `/home/yoda_external_storage_server/biz_automate/ollama_models` (Google Drive)

**Models Currently Stored**:
- `x/z-image-turbo:latest` (12GB) - State-of-the-art image generation
- `qwen2.5-coder:1.5b` (986MB) - Code generation
- `llama3.2:3b` (2GB) - General purpose LLM
- `deepseek-r1:1.5b` (1.1GB) - Reasoning model

### Judge0 (Code Execution)
**Setup** (one-time):
```bash
cd /root/Desktop/joda_ai_local/external_tools/judge0
./setup-judge0.sh
```

**Use in JODA**:
```python
# In JODA conversation:
"Execute this Python code: print('Hello JODA!')"
```

**Test it directly**:
```bash
cd /root/Desktop/joda_ai_local/backend
python judge0_client.py
```

**Stop Judge0**:
```bash
cd /root/Desktop/joda_ai_local/external_tools/judge0
docker-compose down
```

### Pinokio (Model Platform)
A desktop application for launching any open-source AI model. See SETUP_GUIDE.md for build instructions.

---

## 📖 Documentation

**Full Setup Guide**: [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- Detailed installation instructions
- API documentation
- Troubleshooting guide
- Integration examples

**Tool Implementations**:
- Z-Image: `/root/Desktop/joda_ai_local/backend/zimage_agent.py`
- Judge0: `/root/Desktop/joda_ai_local/backend/judge0_client.py`

---

## 🎨 Z-Image Features

- **#1 Open-Source Model** on Artificial Analysis Leaderboard
- **6B Parameters** - State-of-the-art quality
- **Sub-second inference** on H800 GPUs
- **16GB VRAM** consumer device compatible
- **Bilingual support** - English & Chinese text rendering
- **8 inference steps** (Turbo model)

**Example Prompts**:
```
- "Young Chinese woman in red Hanfu, intricate embroidery"
- "Cyberpunk street market with neon signs and rain"
- "Photorealistic portrait of a scientist in a modern lab"
- "Ancient temple with glowing runes in a misty forest"
```

---

## 💻 Judge0 Features

- **90+ Languages** - Python, JavaScript, Java, C++, Go, Rust, and more
- **Sandboxed execution** - Safe isolated environment
- **Time & memory limits** - Configurable resource constraints
- **Multi-file programs** - Support for projects with dependencies
- **Unit testing** - Compare expected vs actual output

**Supported Languages** (most popular):
- Python, JavaScript/Node.js, TypeScript
- Java, C++, C, C#
- Go, Rust, Ruby, PHP
- Swift, Kotlin, Scala
- R, Bash, SQL

**Language IDs** (for direct API usage):
```python
"python": 71
"javascript": 63
"java": 62
"cpp": 54
"go": 60
"rust": 73
```

---

## 🔧 Common Commands

### Check Service Status
```bash
# Judge0
cd /root/Desktop/joda_ai_local/external_tools/judge0
docker-compose ps

# JODA
ps aux | grep joda
```

### View Logs
```bash
# Judge0 logs
cd /root/Desktop/joda_ai_local/external_tools/judge0
docker-compose logs -f server

# JODA logs
tail -f /root/Desktop/joda_ai_local/logs/backend.log
```

### Restart Services
```bash
# Judge0
cd /root/Desktop/joda_ai_local/external_tools/judge0
docker-compose restart

# JODA
cd /root/Desktop/joda_ai_local
./stop-joda.sh && ./start-joda.sh
```

---

## 🎯 Example Usage

### Example 1: Generate Image + Execute Code
```
User: "Generate an image of a Python logo, then write Python code to display ASCII art"

JODA:
1. Uses generate_zimage("Python logo, blue and yellow snake, clean design")
   → Saves to outputs/zimage/zimage_1234567890.png

2. Uses execute_code(
     source_code='''
     print(" ____  _   _ _____ _   _  ___  _   _ ")
     print("|  _ \\| | | |_   _| | | |/ _ \\| \\ | |")
     print("| |_) | |_| | | | | |_| | | | |  \\| |")
     print("|  __/ \\__, | | | |  _  | |_| | |\\  |")
     print("|_|      /_/  |_| |_| |_|\\___/|_| \\_|")
     ''',
     language="python"
   )
   → Returns stdout with ASCII art
```

### Example 2: Multi-Language Code Testing
```
User: "Test this hello world code in Python, JavaScript, and C++"

JODA:
- Executes Python: print("Hello World")
- Executes JavaScript: console.log("Hello World")
- Executes C++: #include <iostream>... cout << "Hello World"
- Compares outputs and confirms all work correctly
```

---

## 🔐 Security Notes

### Z-Image
- Models cached in `~/.cache/huggingface/hub/`
- Outputs saved to local `outputs/zimage/` directory
- GPU isolated execution (CUDA sandbox)

### Ollama
- Models stored in `/usr/share/ollama/.ollama/models`
- Runs as dedicated `ollama` user (non-root)
- Backed up to Google Drive via rclone mount
- API accessible only on localhost:11434 by default

### Judge0
- **Fully sandboxed** execution environment
- Configurable time limits (default 2 seconds)
- Memory limits (default 128MB)
- Network access disabled
- No filesystem access outside container

### Pinokio
- Scripts run isolated in `~/pinokio/api`
- Binaries installed in `~/pinokio/bin`
- All operations within Pinokio directory
- Verified scripts reviewed by maintainers

---

## 📊 Resource Requirements

### Z-Image
- **GPU**: CUDA-capable (16GB+ VRAM recommended)
- **CPU**: Fallback available (slower)
- **Disk**: ~20GB for model cache
- **RAM**: 8GB+

### Ollama
- **CPU**: 2+ cores
- **RAM**: 4GB+ (more for running large models)
- **Disk**: Variable (19GB for current models)
- **Network**: Internet for model downloads
- **Backup Storage**: 2TB+ Google Drive (1.8TB available)

### Judge0
- **CPU**: 2+ cores
- **RAM**: 4GB+
- **Disk**: 10GB+ for Docker images
- **Network**: Internet for initial Docker pulls

### Pinokio
- **CPU**: 2+ cores
- **RAM**: 2GB+
- **Disk**: Varies by installed models (10GB+ recommended)
- **OS**: Linux, macOS, Windows

---

## 🆘 Troubleshooting

### Z-Image: "CUDA out of memory"
```python
# Enable CPU offloading in backend/zimage_agent.py
pipe.enable_model_cpu_offload()
```

### Judge0: "Connection refused"
```bash
# Check if Docker containers are running
cd external_tools/judge0
docker-compose ps

# If not running, start them
./setup-judge0.sh
```

### Judge0: "Language not supported"
```bash
# List all supported languages
python backend/judge0_client.py
# Or use the tool: list_programming_languages()
```

### Ollama: Model version too old
```bash
# Update Ollama to latest version
curl -fsSL https://ollama.com/install.sh | sh

# Verify version (should be 0.14.2+)
ollama --version
```

### Ollama: Sync to Google Drive failed
```bash
# Check if rclone mount is accessible
ls -la /home/yoda_external_storage_server/biz_automate/

# Check available space
df -h /home/yoda_external_storage_server/

# Manually run sync script
/root/Desktop/joda_ai_local/external_tools/sync-ollama-to-gdrive.sh
```

### Port Conflicts
```bash
# Ollama uses port 11434
# Judge0 uses port 2358
# Change in docker-compose.yml: "2358:2358" → "YOUR_PORT:2358"

# JODA uses ports 5173 (frontend) and 8765 (backend)
# Configure in .env file
```

---

## 📚 Additional Resources

- **Z-Image GitHub**: https://github.com/joe-nano/Z-Image
- **Z-Image Paper**: https://arxiv.org/abs/2511.22699
- **Ollama**: https://ollama.com
- **Ollama GitHub**: https://github.com/ollama/ollama
- **Ollama Python Client**: https://github.com/ollama/ollama-python
- **Judge0 Docs**: https://ce.judge0.com
- **Judge0 GitHub**: https://github.com/judge0/judge0
- **Pinokio**: https://pinokio.computer

---

## 📝 License

- **Z-Image**: Apache 2.0 License
- **Judge0**: GNU GPL v3.0
- **Pinokio**: MIT License

All tools are used as external dependencies and remain under their original licenses.

---

**Need help?** Check [SETUP_GUIDE.md](./SETUP_GUIDE.md) or open an issue on the JODA repository.
