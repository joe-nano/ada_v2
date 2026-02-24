import asyncio
import base64
import io
import os
import sys
import traceback
from dotenv import load_dotenv
try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None
try:
    import pyaudio  # type: ignore
except Exception:  # pragma: no cover
    pyaudio = None
try:
    import PIL.Image  # type: ignore
except Exception:  # pragma: no cover
    PIL = None
try:
    import mss  # type: ignore
except Exception:  # pragma: no cover
    mss = None
import argparse
import math
import struct
import time
import re

from google import genai
from google.genai import types

if sys.version_info < (3, 11, 0):
    import taskgroup, exceptiongroup
    asyncio.TaskGroup = taskgroup.TaskGroup
    asyncio.ExceptionGroup = exceptiongroup.ExceptionGroup

from tools import tools_list
from browser_skills import BrowserSkillsStore
from scheduler_store import SchedulerStore, ScheduledJob
from agent_zero_manager import AgentZeroManager

FORMAT = pyaudio.paInt16 if pyaudio else None
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024

MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025"
DEFAULT_MODE = "camera"

load_dotenv()
client = genai.Client(http_options={"api_version": "v1beta"}, api_key=os.getenv("GEMINI_API_KEY"))

# Function definitions
generate_cad = {
    "name": "generate_cad",
    "description": "Generates a 3D CAD model based on a prompt.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {"type": "STRING", "description": "The description of the object to generate."}
        },
        "required": ["prompt"]
    },
    "behavior": "NON_BLOCKING"
}

run_web_agent = {
    "name": "run_web_agent",
    "description": "Opens a web browser and performs a task according to the prompt.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {"type": "STRING", "description": "The detailed instructions for the web browser agent."}
        },
        "required": ["prompt"]
    },
    "behavior": "NON_BLOCKING"
}

run_browser_use_tool = {
    "name": "run_browser_use",
    "description": (
        "Runs an automated browser task. Uses the repo's Playwright web agent by default, and can be upgraded to "
        "use the optional browser-use integration (https://docs.browser-use.com/quickstart) when installed."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {"type": "STRING", "description": "What to do in the browser."},
        },
        "required": ["prompt"],
    },
    "behavior": "NON_BLOCKING",
}

list_browser_skills_tool = {
    "name": "list_browser_skills",
    "description": "Lists saved reusable browser skills (prompt templates) available to /browse.",
    "parameters": {"type": "OBJECT", "properties": {}},
}

save_browser_skill_tool = {
    "name": "save_browser_skill",
    "description": (
        "Saves or updates a reusable browser skill (prompt template). "
        "Skills can be reused repeatedly for browser automation."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING", "description": "Short skill name (unique; case-insensitive)."},
            "description": {"type": "STRING", "description": "What this skill does."},
            "template": {
                "type": "STRING",
                "description": "Prompt template / procedure. Use {{USERNAME}}/{{PASSWORD}} placeholders if needed.",
            },
        },
        "required": ["name", "template"],
    },
}

delete_browser_skill_tool = {
    "name": "delete_browser_skill",
    "description": "Deletes a browser skill by id or name.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "skill_id": {"type": "STRING", "description": "Skill UUID."},
            "name": {"type": "STRING", "description": "Skill name."},
        },
    },
}

list_schedules_tool = {
    "name": "list_schedules",
    "description": "Lists saved scheduler jobs for recurring automation (browse/web/mcp).",
    "parameters": {"type": "OBJECT", "properties": {}},
}

create_schedule_tool = {
    "name": "create_schedule",
    "description": (
        "Creates or updates a recurring scheduler job that will re-run an automation task (e.g. daily trend ad creation). "
        "Use task_type 'browse' to run browser tasks, 'web' for the built-in web agent, 'mcp' for MCP tool calls, "
        "or 'pipeline' for built-in pipelines (currently: daily_ads). Use 'mcp_reload' to reload MCP servers/tools."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING", "description": "Job name."},
            "enabled": {"type": "BOOLEAN", "description": "Whether the job runs automatically."},
            "schedule_type": {
                "type": "STRING",
                "description": "Either 'interval_minutes' or 'cron'.",
            },
            "interval_minutes": {"type": "INTEGER", "description": "Minutes between runs (if interval)."},
            "cron": {"type": "STRING", "description": "5-field cron string: 'min hour dom mon dow'."},
            "task_type": {"type": "STRING", "description": "browse|web|mcp|mcp_reload|pipeline"},
            "payload": {"type": "OBJECT", "description": "Task payload (e.g., {prompt: '...'} or MCP args)."},
        },
        "required": ["name", "schedule_type", "task_type", "payload"],
    },
}

delete_schedule_tool = {
    "name": "delete_schedule",
    "description": "Deletes a scheduler job by id.",
    "parameters": {
        "type": "OBJECT",
        "properties": {"id": {"type": "STRING", "description": "Job id"}},
        "required": ["id"],
    },
}

agent_zero_pull_tool = {
    "name": "agent_zero_pull",
    "description": (
        "Pulls the latest Agent Zero docker image (default: agent0ai/agent-zero). "
        "Requires shell expert mode and user confirmation."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {"image": {"type": "STRING", "description": "Docker image (optional)"}},
    },
}

agent_zero_start_tool = {
    "name": "agent_zero_start",
    "description": (
        "Starts an Agent Zero instance via docker (maps host_port->80). "
        "Requires shell expert mode and user confirmation."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "host_port": {"type": "INTEGER", "description": "Host port to bind (default: 50001+)"},
            "image": {"type": "STRING", "description": "Docker image (optional)"},
        },
    },
}

agent_zero_list_tool = {
    "name": "agent_zero_list",
    "description": "Lists running Agent Zero containers managed by JODA.",
    "parameters": {"type": "OBJECT", "properties": {}},
}

agent_zero_stop_tool = {
    "name": "agent_zero_stop",
    "description": "Stops a running Agent Zero container by name. Requires shell expert mode and confirmation.",
    "parameters": {
        "type": "OBJECT",
        "properties": {"name": {"type": "STRING", "description": "Container name"}},
        "required": ["name"],
    },
}

agent_zero_scale_tool = {
    "name": "agent_zero_scale",
    "description": (
        "Ensures at least N Agent Zero instances are running (starts more if needed). "
        "Requires shell expert mode and confirmation."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "count": {"type": "INTEGER", "description": "Desired number of instances"},
            "image": {"type": "STRING", "description": "Docker image (optional)"},
        },
        "required": ["count"],
    },
}
create_project_tool = {
    "name": "create_project",
    "description": "Creates a new project folder to organize files.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING", "description": "The name of the new project."}
        },
        "required": ["name"]
    }
}

switch_project_tool = {
    "name": "switch_project",
    "description": "Switches the current active project context.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING", "description": "The name of the project to switch to."}
        },
        "required": ["name"]
    }
}

list_projects_tool = {
    "name": "list_projects",
    "description": "Lists all available projects.",
    "parameters": {
        "type": "OBJECT",
        "properties": {},
    }
}

list_smart_devices_tool = {
    "name": "list_smart_devices",
    "description": "Lists all available smart home devices (lights, plugs, etc.) on the network.",
    "parameters": {
        "type": "OBJECT",
        "properties": {},
    }
}

control_light_tool = {
    "name": "control_light",
    "description": "Controls a smart light device.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "target": {
                "type": "STRING",
                "description": "The IP address of the device to control. Always prefer the IP address over the alias for reliability."
            },
            "action": {
                "type": "STRING",
                "description": "The action to perform: 'turn_on', 'turn_off', or 'set'."
            },
            "brightness": {
                "type": "INTEGER",
                "description": "Optional brightness level (0-100)."
            },
            "color": {
                "type": "STRING",
                "description": "Optional color name (e.g., 'red', 'cool white') or 'warm'."
            }
        },
        "required": ["target", "action"]
    }
}

discover_printers_tool = {
    "name": "discover_printers",
    "description": "Discovers 3D printers available on the local network.",
    "parameters": {
        "type": "OBJECT",
        "properties": {},
    }
}

print_stl_tool = {
    "name": "print_stl",
    "description": "Prints an STL file to a 3D printer. Handles slicing the STL to G-code and uploading to the printer.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "stl_path": {"type": "STRING", "description": "Path to STL file, or 'current' for the most recent CAD model."},
            "printer": {"type": "STRING", "description": "Printer name or IP address."},
            "profile": {"type": "STRING", "description": "Optional slicer profile name."}
        },
        "required": ["stl_path", "printer"]
    }
}

get_print_status_tool = {
    "name": "get_print_status",
    "description": "Gets the current status of a 3D printer including progress, time remaining, and temperatures.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "printer": {"type": "STRING", "description": "Printer name or IP address."}
        },
        "required": ["printer"]
    }
}

iterate_cad_tool = {
    "name": "iterate_cad",
    "description": "Modifies or iterates on the current CAD design based on user feedback. Use this when the user asks to adjust, change, modify, or iterate on the existing 3D model (e.g., 'make it taller', 'add a handle', 'reduce the thickness').",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {"type": "STRING", "description": "The changes or modifications to apply to the current design."}
        },
        "required": ["prompt"]
    },
    "behavior": "NON_BLOCKING"
}

run_shell_command_tool = {
    "name": "run_shell_command",
    "description": (
        "Runs a shell command on the server to build/test projects (e.g. using ralph-orchestrator). "
        "Use this for deterministic build steps. Prefer safe, non-destructive commands and limit scope to the workspace."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "command": {"type": "STRING", "description": "The shell command to run."},
            "cwd": {"type": "STRING", "description": "Optional working directory (must be inside allowed workspace)."},
            "timeout_sec": {"type": "INTEGER", "description": "Optional timeout in seconds (default 600)."},
        },
        "required": ["command"],
    },
}

run_ralph_orchestrator_tool = {
    "name": "run_ralph_orchestrator",
    "description": (
        "Runs ralph-orchestrator against a target project folder to generate TODOs and implement tasks. "
        "Use this to build or improve a project in the workspace."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "project_path": {"type": "STRING", "description": "Project folder path to run Ralph in."},
            "mode": {"type": "STRING", "description": "todo | build (default build)."},
            "agent": {"type": "STRING", "description": "Ralph agent selection (default auto)."},
            "max_iterations": {"type": "INTEGER", "description": "Max iterations (default 50)."},
            "max_runtime": {"type": "INTEGER", "description": "Max runtime seconds (default 3600)."},
        },
        "required": ["project_path"],
    },
}

set_shell_expert_mode_tool = {
    "name": "set_shell_expert_mode",
    "description": (
        "Enable or disable shell expert mode. Expert mode expands the allowed command set for run_shell_command, "
        "but commands still require user confirmation and are restricted to the workspace."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "enabled": {"type": "BOOLEAN", "description": "True to enable expert mode, false to disable."},
        },
        "required": ["enabled"],
    },
}

mcp_list_tools_tool = {
    "name": "mcp_list_tools",
    "description": (
        "Lists available MCP tools from configured MCP servers (e.g. Notion, Zapier, calendar integrations). "
        "Use this to discover what capabilities are available."
    ),
    "parameters": {"type": "OBJECT", "properties": {}},
}

mcp_call_tool = {
    "name": "mcp_call_tool",
    "description": (
        "Calls an MCP tool by name with arguments. Use this to interact with external systems via MCP servers "
        "(e.g. create Notion pages, trigger Zapier actions, manage calendar events)."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "tool_name": {
                "type": "STRING",
                "description": "Tool name, either fully-qualified 'server.tool' or just 'tool'.",
            },
            "arguments": {"type": "OBJECT", "description": "Arguments for the tool call."},
        },
        "required": ["tool_name", "arguments"],
    },
}

mcp_reload_tool = {
    "name": "mcp_reload",
    "description": (
        "Reloads the backend MCP client: re-reads configuration (including optional Codex import), "
        "restarts servers, and re-discovers tools."
    ),
    "parameters": {"type": "OBJECT", "properties": {}},
}

codex_mcp_add_tool = {
    "name": "codex_mcp_add",
    "description": (
        "Adds an MCP server to Codex's MCP configuration. Requires shell expert mode. "
        "After adding, you should run mcp_reload so JODA can see the new server/tools."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING", "description": "Server name in Codex config."},
            "url": {"type": "STRING", "description": "HTTP MCP server URL (if using http transport)."},
            "command": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
                "description": "Stdio command list (e.g., ['npx','-y','@scope/pkg@latest']).",
            },
            "env": {"type": "OBJECT", "description": "Optional env vars (KEY->VALUE) for stdio servers."},
        },
        "required": ["name"],
    },
}

healthcare_mcp_discover_tool = {
    "name": "healthcare_mcp_discover",
    "description": (
        "Runs a web-agent research pass to find real MCP servers for healthcare targets (FHIR, DICOMweb, SNOMED CT, "
        "Epic/Cerner SMART on FHIR, etc.) and writes a structured catalog under projects/healthcare_mcp_catalog/."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "targets": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
                "description": "Optional list of targets; if omitted uses a default healthcare target list.",
            },
            "max_candidates_per_target": {
                "type": "INTEGER",
                "description": "Max MCP candidates to return per target (default 8).",
            },
        },
    },
}

mcp_directory_discover_tool = {
    "name": "mcp_directory_discover",
    "description": (
        "Crawls an MCP directory page (default: https://mcp.so/categories) and writes a structured catalog of MCP servers "
        "and suggested `codex mcp add ...` configurations under projects/mcp_directory_catalog/."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "url": {"type": "STRING", "description": "Directory URL (default https://mcp.so/categories)."},
            "max_servers_total": {"type": "INTEGER", "description": "Max servers total (default 200)."},
            "max_servers_per_category": {"type": "INTEGER", "description": "Max servers per category (default 50)."},
        },
    },
}

tools = [{'google_search': {}}, {"function_declarations": [
    generate_cad,
    run_web_agent,
    run_browser_use_tool,
    list_browser_skills_tool,
    save_browser_skill_tool,
    delete_browser_skill_tool,
    list_schedules_tool,
    create_schedule_tool,
    delete_schedule_tool,
    agent_zero_pull_tool,
    agent_zero_start_tool,
    agent_zero_list_tool,
    agent_zero_stop_tool,
    agent_zero_scale_tool,
    create_project_tool,
    switch_project_tool,
    list_projects_tool,
    list_smart_devices_tool,
    control_light_tool,
    discover_printers_tool,
    print_stl_tool,
    get_print_status_tool,
    iterate_cad_tool,
    run_shell_command_tool,
    run_ralph_orchestrator_tool,
    set_shell_expert_mode_tool,
    mcp_list_tools_tool,
    mcp_call_tool,
    mcp_reload_tool,
    codex_mcp_add_tool,
    healthcare_mcp_discover_tool,
    mcp_directory_discover_tool,
] + tools_list[0]['function_declarations'][1:]}]

# --- CONFIG UPDATE: Enabled Transcription ---
config = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    # We switch these from [] to {} to enable them with default settings
    output_audio_transcription=types.AudioTranscriptionConfig(),
    input_audio_transcription=types.AudioTranscriptionConfig(),
    system_instruction=(
        "Your name is JODA, pronounced 'YUODA' (YOO-DA). "
        "You are an Advanced Depiction Architect, created by Dr Joe Davids. "
        "Address the user as 'Sir'. "
        "Projects are physically stored on disk under the JODA workspace at '<workspace_root>/projects/<project_name>/' "
        "(including a 'temp' project). These are real directories that can be browsed. "
        "You CAN navigate and inspect files using the filesystem tools: use 'list_projects' to see available projects "
        "and their on-disk paths, use 'switch_project' to change the active context, and use 'read_directory'/'read_file' "
        "to browse and inspect files. Do not claim projects are not browsable. "
        "For browser automation, use run_web_agent or run_browser_use when the user asks you to browse the web or complete a browser task. "
        "When needed, you can run approved build commands on the server (e.g. ralph-orchestrator) using run_ralph_orchestrator or run_shell_command."
    ),
    tools=tools,
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                voice_name="Kore"
            )
        )
    )
)

pya = None


def _get_pya() -> "pyaudio.PyAudio":
    global pya
    if pya is None:
        if pyaudio is None:
            raise RuntimeError(
                "pyaudio is not installed. Install it to use server-side mic/speaker I/O, "
                "or use external (browser) audio input in web mode."
            )
        pya = pyaudio.PyAudio()
    return pya


try:
    from cad_agent import CadAgent
except Exception:  # pragma: no cover
    CadAgent = None

try:
    from web_agent import WebAgent
except Exception:  # pragma: no cover
    WebAgent = None

try:
    from browser_use_agent import run_task as run_browser_use_task
except Exception:  # pragma: no cover
    run_browser_use_task = None

try:
    from kasa_agent import KasaAgent
except Exception:  # pragma: no cover
    KasaAgent = None

try:
    from printer_agent import PrinterAgent
except Exception:  # pragma: no cover
    PrinterAgent = None

class AudioLoop:
    def __init__(self, video_mode=DEFAULT_MODE, on_audio_data=None, on_video_frame=None, on_cad_data=None, on_web_data=None, on_transcription=None, on_tool_confirmation=None, on_cad_status=None, on_cad_thought=None, on_project_update=None, on_device_update=None, on_error=None, on_media_asset=None, on_image_status=None, input_device_index=None, input_device_name=None, output_device_index=None, kasa_agent=None):
        self.video_mode = video_mode
        self.on_audio_data = on_audio_data
        self.on_video_frame = on_video_frame
        self.on_cad_data = on_cad_data
        self.on_web_data = on_web_data
        self.on_transcription = on_transcription
        self.on_tool_confirmation = on_tool_confirmation
        self.on_cad_status = on_cad_status
        self.on_cad_thought = on_cad_thought
        self.on_project_update = on_project_update
        self.on_device_update = on_device_update
        self.on_error = on_error
        self.on_media_asset = on_media_asset
        self.on_image_status = on_image_status
        self.input_device_index = input_device_index
        self.input_device_name = input_device_name
        self.output_device_index = output_device_index
        self.browser_secrets = None
        self.browser_skills = BrowserSkillsStore()
        self.scheduler_store = SchedulerStore()
        self.agent_zero = AgentZeroManager()

        self.audio_in_queue = None
        self.out_queue = None
        self.paused = False

        self.chat_buffer = {"sender": None, "text": ""} # For aggregating chunks
        
        # Track last transcription text to calculate deltas (Gemini sends cumulative text)
        self._last_input_transcription = ""
        self._last_output_transcription = ""
        self._last_routed_voice_command = ""

        self.audio_in_queue = None
        self.out_queue = None
        self.paused = False

        self.session = None
        
        # Create CadAgent with thought callback
        def handle_cad_thought(thought_text):
            if self.on_cad_thought:
                self.on_cad_thought(thought_text)
        
        def handle_cad_status(status_info):
            if self.on_cad_status:
                self.on_cad_status(status_info)

        self.cad_agent = None
        if CadAgent:
            self.cad_agent = CadAgent(on_thought=handle_cad_thought, on_status=handle_cad_status)

        self.web_agent = WebAgent() if WebAgent else None
        self.kasa_agent = kasa_agent if kasa_agent else (KasaAgent() if KasaAgent else None)
        self.printer_agent = PrinterAgent() if PrinterAgent else None

    def set_browser_secrets(self, secrets: dict[str, str] | None) -> None:
        # Memory-only; never written to disk. Used to expand {{USERNAME}}/{{PASSWORD}} placeholders
        # during web automation, both for direct commands and model tool calls.
        self.browser_secrets = secrets or None

        self.send_text_task = None
        self.stop_event = asyncio.Event()
        
        self.stop_event = asyncio.Event()
        
        self.permissions = {} # Default Empty (Will treat unset as True)
        self._pending_confirmations = {}

        # If true, audio is supplied by the web client (Socket.IO) instead of server-side PyAudio.
        self.use_external_audio = False
        self.external_audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=200)
        self._external_audio_drops: int = 0

        # Shell execution safety mode (expanded allowlist, still confirmation-gated).
        self.shell_expert_mode = False
        self._mcp_client = None

        # Video buffering state
        self._latest_image_payload = None
        # VAD State
        self._is_speaking = False
        self._silence_start_time = None
        
        # Initialize ProjectManager
        from project_manager import ProjectManager
        # Assuming we are running from backend/ or root? 
        # Using abspath of current file to find root
        current_dir = os.path.dirname(os.path.abspath(__file__))
        # If joda.py is in backend/, project root is one up
        project_root = os.path.dirname(current_dir)
        self.project_manager = ProjectManager(project_root)
        
        # Sync Initial Project State
        if self.on_project_update:
            # We need to defer this slightly or just call it. 
            # Since this is init, loop might not be running, but on_project_update in server.py uses asyncio.create_task which needs a loop.
            # We will handle this by calling it in run() or just print for now.
            pass

    def flush_chat(self):
        """Forces the current chat buffer to be written to log."""
        if self.chat_buffer["sender"] and self.chat_buffer["text"].strip():
            self.project_manager.log_chat(self.chat_buffer["sender"], self.chat_buffer["text"])
            self.chat_buffer = {"sender": None, "text": ""}
        # Reset transcription tracking for new turn
        self._last_input_transcription = ""
        self._last_output_transcription = ""
        self._last_routed_voice_command = ""

    def _normalize_agent0_voice_command(self, transcript: str) -> str | None:
        """
        Map spoken "agent zero ..." / "agent 0 ..." / "agent0 ..." into a typed "/agent0 ..." command.
        Only returns a command when an action keyword is detected.
        """
        t = (transcript or "").strip()
        if not t:
            return None

        lower = t.lower()
        # Already a command
        if lower.startswith("/agent0"):
            rest = t[len("/agent0") :].strip()
        else:
            m = re.match(r"^(agent\\s*zero|agent\\s*0|agent0)\\b[:\\-\\s]*", lower)
            if not m:
                return None
            rest = t[m.end() :].strip()

        rest_lower = rest.lower()
        # Detect action keywords
        action = None
        for a in ("pull", "list", "start", "stop", "scale"):
            if re.search(rf"\\b{a}\\b", rest_lower):
                action = a
                break
        if not action:
            return None

        # Extract first integer if needed
        num = None
        mnum = re.search(r"\\b(\\d{2,5})\\b", rest)
        if mnum:
            try:
                num = int(mnum.group(1))
            except Exception:
                num = None

        if action in ("pull", "list"):
            return f"/agent0 {action}"
        if action == "start":
            return f"/agent0 start {num}" if num else "/agent0 start"
        if action == "scale":
            return f"/agent0 scale {num}" if num else "/agent0 scale"
        if action == "stop":
            # Best-effort: keep remainder as name
            name = rest
            # Remove leading 'stop'
            name = re.sub(r"^.*?\\bstop\\b[:\\-\\s]*", "", name, flags=re.I).strip()
            return f"/agent0 stop {name}".strip() if name else "/agent0 stop"
        return None

    async def _route_voice_command_if_needed(self, full_transcript: str) -> None:
        """
        If user speaks an Agent Zero command, inject the normalized /agent0 command into the live session.
        This preserves voice transcription while making Agent Zero control work with voice.
        """
        cmd = self._normalize_agent0_voice_command(full_transcript)
        if not cmd:
            return
        if cmd == self._last_routed_voice_command:
            return
        self._last_routed_voice_command = cmd
        try:
            if self.on_transcription:
                self.on_transcription({"sender": "System", "text": f"\n[Voice→Command] {cmd}\n"})
        except Exception:
            pass
        if not self.session:
            return
        try:
            await self.session.send(input=cmd, end_of_turn=True)
        except Exception:
            # Don't crash audio loop on routing errors
            pass

    def update_permissions(self, new_perms):
        print(f"[JODA DEBUG] [CONFIG] Updating tool permissions: {new_perms}")
        self.permissions.update(new_perms)

    def set_paused(self, paused):
        self.paused = paused

    def stop(self):
        self.stop_event.set()

    def set_shell_expert_mode(self, enabled: bool) -> None:
        self.shell_expert_mode = bool(enabled)

    async def _get_mcp_client(self):
        if self._mcp_client is not None:
            return self._mcp_client
        from mcp_client import get_mcp_client
        self._mcp_client = await get_mcp_client()
        return self._mcp_client

    async def handle_mcp_list_tools(self) -> str:
        client = await self._get_mcp_client()
        tools = client.list_tools()
        if not tools:
            return "No MCP tools available. Check backend/mcp_servers.json and enable servers."
        lines = [f"{t['name']}: {t.get('description','')}".rstrip() for t in tools]
        return "Available MCP tools:\n" + "\n".join(lines[:200])

    async def handle_mcp_call_tool(self, tool_name: str, arguments: dict) -> str:
        client = await self._get_mcp_client()
        result = await client.call_tool(tool_name=tool_name, arguments=arguments, agent_id="joda")
        if not result.get("success"):
            return f"MCP tool call failed: {result.get('error')}"
        # Keep payload bounded
        out = result.get("result")
        text = str(out)
        if len(text) > 4000:
            text = text[:4000] + "\n...[truncated]..."
        return f"MCP tool call succeeded: {tool_name}\n{text}"

    async def handle_mcp_reload(self) -> str:
        from mcp_admin import reload_mcp_client

        res = await reload_mcp_client()
        return f"MCP reloaded: {res.get('servers')} servers, {res.get('tools')} tools"

    async def handle_codex_mcp_add(self, payload: dict) -> str:
        if not self.shell_expert_mode:
            return "codex_mcp_add requires shell expert mode. Use set_shell_expert_mode first."

        name = str(payload.get("name") or "").strip()
        url = str(payload.get("url") or "").strip()
        command = payload.get("command")
        env = payload.get("env")

        if not name:
            return "Missing name"

        try:
            from mcp_admin import codex_mcp_add_stdio, codex_mcp_add_url

            if url:
                codex_mcp_add_url(name=name, url=url)
            else:
                if not isinstance(command, list) or not all(isinstance(x, str) and x.strip() for x in command):
                    return "Missing/invalid command (provide a string array) or url"
                env_dict = None
                if isinstance(env, dict):
                    env_dict = {str(k): str(v) for k, v in env.items()}
                codex_mcp_add_stdio(name=name, command=[str(x) for x in command], env=env_dict)

            # Refresh JODA's MCP client so tools are available immediately.
            await self.handle_mcp_reload()
            return f"Added Codex MCP server '{name}'."
        except Exception as e:
            return f"codex_mcp_add failed: {str(e)[:400]}"

    async def handle_healthcare_mcp_discover(self, payload: dict) -> str:
        targets = payload.get("targets")
        if targets is not None and not isinstance(targets, list):
            return "targets must be an array of strings"
        max_candidates = int(payload.get("max_candidates_per_target") or 8)
        from healthcare_mcp_discovery import run_healthcare_mcp_discovery

        res = await run_healthcare_mcp_discovery(
            targets=[str(t) for t in (targets or [])] if targets else None,
            max_candidates_per_target=max_candidates,
        )
        return (
            f"Healthcare MCP discovery complete (parse_ok={res.get('parse_ok')}): "
            f"{res.get('catalog_path')}"
        )

    async def handle_mcp_directory_discover(self, payload: dict) -> str:
        url = str(payload.get("url") or "https://mcp.so/categories").strip()
        max_total = int(payload.get("max_servers_total") or 200)
        max_per_cat = int(payload.get("max_servers_per_category") or 50)

        from mcp_directory_discovery import run_mcp_directory_discovery

        res = await run_mcp_directory_discovery(
            url=url,
            max_servers_total=max_total,
            max_servers_per_category=max_per_cat,
        )
        return f"MCP directory discovery complete (parse_ok={res.get('parse_ok')}): {res.get('catalog_path')}"

    def _allowed_shell_cwd(self, cwd: str | None) -> str:
        """Restrict shell command execution to known safe roots."""
        base_roots = [
            os.getenv("JODA_PROJECT_ROOT", ""),  # orchestration root (e.g. gdrive workspace)
            os.path.dirname(os.path.abspath(__file__)),  # backend dir
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),  # app root
        ]
        roots = [os.path.abspath(r) for r in base_roots if r]
        target = os.path.abspath(cwd) if cwd else roots[-1]
        if not roots:
            return target
        if not any(target == r or target.startswith(r + os.sep) for r in roots):
            raise ValueError(f"cwd '{cwd}' is outside allowed roots")
        return target

    def _allowed_shell_command(self, command: str) -> None:
        """Basic safety filter: allow known build/test commands only."""
        cmd = (command or "").strip()
        if not cmd:
            raise ValueError("Empty command")
        # Block obviously dangerous patterns.
        blocked = [
            " rm ",
            "rm -",
            "sudo",
            "chmod",
            "chown",
            "mkfs",
            ":(){",
            "dd ",
            ">",
            ">>",
            "|&",
            "nc ",
            "netcat",
        ]
        lowered = f" {cmd.lower()} "
        if any(b in lowered for b in blocked):
            raise ValueError("Command contains a blocked pattern")

        base_allowed_prefixes = (
            "ralph ",
            "python ",
            "python3 ",
            "pytest",
            "uv ",
            "npm ",
            "node ",
            "git ",
            "ls",
            "cat ",
            "sed ",
            "grep ",
            "find ",
        )

        expert_allowed_prefixes = base_allowed_prefixes + (
            "bash ",
            "bash -lc",
            "zsh ",
            "zsh -lc",
            "sh ",
            "curl ",
            "wget ",
            "tar ",
            "unzip ",
            "zip ",
            "make ",
            "cmake ",
            "ninja ",
            "docker ",
            "docker-compose ",
            "podman ",
            "pnpm ",
            "yarn ",
            "bun ",
            "pip ",
            "pip3 ",
            "poetry ",
            "ruff ",
            "black ",
            "tsc",
            "eslint ",
        )

        allowed_prefixes = expert_allowed_prefixes if self.shell_expert_mode else base_allowed_prefixes
        if not cmd.startswith(allowed_prefixes):
            raise ValueError("Command not in allowlist (enable expert mode to expand)")

    async def handle_run_shell_command(self, command: str, cwd: str | None = None, timeout_sec: int = 600) -> str:
        """Run a shell command (confirmation-gated) and return summarized output."""
        safe_cwd = self._allowed_shell_cwd(cwd)
        self._allowed_shell_command(command)

        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=safe_cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
        except asyncio.TimeoutError:
            proc.kill()
            return f"[shell] Timed out after {timeout_sec}s: {command}"

        text = (out or b"").decode(errors="replace")
        if len(text) > 4000:
            text = text[:4000] + "\n...[truncated]..."
        return f"[shell] exit={proc.returncode} cwd={safe_cwd}\n$ {command}\n{text}"

    async def handle_run_ralph_orchestrator(
        self,
        project_path: str,
        mode: str = "build",
        agent: str = "auto",
        max_iterations: int = 50,
        max_runtime: int = 3600,
    ) -> str:
        project_path = (project_path or "").strip()
        if not project_path:
            raise ValueError("Missing project_path")
        safe_cwd = self._allowed_shell_cwd(project_path)
        mode = (mode or "build").strip().lower()
        if mode not in ("todo", "build"):
            mode = "build"

        # Build a prompt that forces the TODO->execute workflow.
        prompt = (
            "Create or update TODO.md for this project based on PROMPT.md and CONTEXT.md. "
            + ("Do NOT implement tasks; only produce TODO.md." if mode == "todo" else "Then implement tasks from TODO.md in order.")
        )
        cmd = (
            f'ralph run -a "{agent}" -i {int(max_iterations)} -t {int(max_runtime)} '
            f'-p "{prompt.replace(chr(34), r"\\\"")}"'
        )
        return await self.handle_run_shell_command(command=cmd, cwd=safe_cwd, timeout_sec=max_runtime + 120)
        
    def resolve_tool_confirmation(self, request_id, confirmed):
        print(f"[JODA DEBUG] [RESOLVE] resolve_tool_confirmation called. ID: {request_id}, Confirmed: {confirmed}")
        if request_id in self._pending_confirmations:
            future = self._pending_confirmations[request_id]
            if not future.done():
                print(f"[JODA DEBUG] [RESOLVE] Future found and pending. Setting result to: {confirmed}")
                future.set_result(confirmed)
            else:
                 print(f"[JODA DEBUG] [WARN] Request {request_id} future already done. Result: {future.result()}")
        else:
            print(f"[JODA DEBUG] [WARN] Confirmation Request {request_id} not found in pending dict. Keys: {list(self._pending_confirmations.keys())}")

    def clear_audio_queue(self):
        """Clears the queue of pending audio chunks to stop playback immediately."""
        try:
            count = 0
            while not self.audio_in_queue.empty():
                self.audio_in_queue.get_nowait()
                count += 1
            if count > 0:
                print(f"[JODA DEBUG] [AUDIO] Cleared {count} chunks from playback queue due to interruption.")
        except Exception as e:
            print(f"[JODA DEBUG] [ERR] Failed to clear audio queue: {e}")

    async def send_frame(self, frame_data):
        # Update the latest frame payload
        if isinstance(frame_data, bytes):
            b64_data = base64.b64encode(frame_data).decode('utf-8')
        else:
            b64_data = frame_data 

        # Store as the designated "next frame to send"
        self._latest_image_payload = {"mime_type": "image/jpeg", "data": b64_data}
        # No event signal needed - listen_audio pulls it

    async def send_realtime(self):
        import time as _time_mod
        _rt_count = 0
        _rt_last_log = _time_mod.monotonic()
        while True:
            msg = await self.out_queue.get()
            await self.session.send(input=msg, end_of_turn=False)
            _rt_count += 1
            now = _time_mod.monotonic()
            if _rt_count == 1:
                mt = msg.get("mime_type", "?") if isinstance(msg, dict) else "?"
                dlen = len(msg.get("data", b"")) if isinstance(msg, dict) else "?"
                print(f"[JODA] send_realtime: ▶ first msg to Gemini (mime={mt}, {dlen}B)")
            if now - _rt_last_log >= 10.0:
                print(f"[JODA] send_realtime: {_rt_count} msgs sent to Gemini session")
                _rt_last_log = now

    async def listen_audio(self):
        # External audio mode (browser mic streaming)
        if self.use_external_audio:
            print("[JODA] Using external audio input (web client).")
            _ext_chunks_sent = 0
            _ext_last_log = time.monotonic() if 'time' in dir() else __import__('time').monotonic()
            import time as _time_mod
            while True:
                if self.paused:
                    if _ext_chunks_sent == 0:
                        print("[JODA] listen_audio: paused, waiting…")
                    await asyncio.sleep(0.05)
                    continue
                # Don't consume external audio until the Gemini session is ready and `out_queue` exists.
                if not self.out_queue:
                    if _ext_chunks_sent == 0:
                        print("[JODA] listen_audio: out_queue not ready, waiting…")
                    await asyncio.sleep(0.05)
                    continue
                try:
                    data = await self.external_audio_queue.get()
                    await self.out_queue.put({"data": data, "mime_type": "audio/pcm"})
                    _ext_chunks_sent += 1
                    now = _time_mod.monotonic()
                    if _ext_chunks_sent == 1:
                        is_silent = all(b == 0 for b in data[:100]) if len(data) >= 100 else all(b == 0 for b in data)
                        print(f"[JODA] listen_audio: ▶ first chunk → Gemini ({len(data)}B, silent={is_silent})")
                    if now - _ext_last_log >= 5.0:
                        print(f"[JODA] listen_audio: {_ext_chunks_sent} chunks → Gemini, qsize={self.external_audio_queue.qsize()}, drops={self._external_audio_drops}")
                        _ext_last_log = now
                except Exception as e:
                    print(f"[JODA] [ERR] External audio loop error: {e}")
                    import traceback; traceback.print_exc()
                    await asyncio.sleep(0.05)
            # unreachable

        pya = _get_pya()
        if FORMAT is None:
            raise RuntimeError("pyaudio is not available (FORMAT undefined)")

        mic_info = pya.get_default_input_device_info()

        # Resolve Input Device by Name if provided
        resolved_input_device_index = None
        
        if self.input_device_name:
            print(f"[JODA] Attempting to find input device matching: '{self.input_device_name}'")
            count = pya.get_device_count()
            best_match = None
            
            for i in range(count):
                try:
                    info = pya.get_device_info_by_index(i)
                    if info['maxInputChannels'] > 0:
                        name = info.get('name', '')
                        # Simple case-insensitive check
                        if self.input_device_name.lower() in name.lower() or name.lower() in self.input_device_name.lower():
                             print(f"   Candidate {i}: {name}")
                             # Prioritize exact match or very close match if possible, but first match is okay for now
                             resolved_input_device_index = i
                             best_match = name
                             break
                except Exception:
                    continue
            
            if resolved_input_device_index is not None:
                print(f"[JODA] Resolved input device '{self.input_device_name}' to index {resolved_input_device_index} ({best_match})")
            else:
                print(f"[JODA] Could not find device matching '{self.input_device_name}'. Checking index...")

        # Fallback to index if Name lookup failed or wasn't provided
        if resolved_input_device_index is None and self.input_device_index is not None:
             try:
                 resolved_input_device_index = int(self.input_device_index)
                 print(f"[JODA] Requesting Input Device Index: {resolved_input_device_index}")
             except ValueError:
                 print(f"[JODA] Invalid device index '{self.input_device_index}', reverting to default.")
                 resolved_input_device_index = None

        if resolved_input_device_index is None:
             print("[JODA] Using Default Input Device")

        try:
            self.audio_stream = await asyncio.to_thread(
                pya.open,
                format=FORMAT,
                channels=CHANNELS,
                rate=SEND_SAMPLE_RATE,
                input=True,
                input_device_index=resolved_input_device_index if resolved_input_device_index is not None else mic_info["index"],
                frames_per_buffer=CHUNK_SIZE,
            )
        except OSError as e:
            print(f"[JODA] [ERR] Failed to open audio input stream: {e}")
            print("[JODA] [WARN] Server-side audio unavailable (VPS/headless). Waiting for browser audio...")
            # On VPS/headless systems, enable external audio mode and wait for browser input
            self.use_external_audio = True
            # Now call the external audio handler
            return await self.listen_audio()

        if __debug__:
            kwargs = {"exception_on_overflow": False}
        else:
            kwargs = {}
        
        # VAD Constants
        VAD_THRESHOLD = 800 # Adj based on mic sensitivity (800 is conservative for 16-bit)
        SILENCE_DURATION = 0.5 # Seconds of silence to consider "done speaking"
        
        while True:
            if self.paused:
                await asyncio.sleep(0.1)
                continue

            try:
                data = await asyncio.to_thread(self.audio_stream.read, CHUNK_SIZE, **kwargs)
                
                # 1. Send Audio
                if self.out_queue:
                    await self.out_queue.put({"data": data, "mime_type": "audio/pcm"})
                
                # 2. VAD Logic for Video
                # rms = audioop.rms(data, 2)
                # Replacement for audioop.rms(data, 2)
                count = len(data) // 2
                if count > 0:
                    shorts = struct.unpack(f"<{count}h", data)
                    sum_squares = sum(s**2 for s in shorts)
                    rms = int(math.sqrt(sum_squares / count))
                else:
                    rms = 0
                
                if rms > VAD_THRESHOLD:
                    # Speech Detected
                    self._silence_start_time = None
                    
                    if not self._is_speaking:
                        # NEW Speech Utterance Started
                        self._is_speaking = True
                        print(f"[JODA DEBUG] [VAD] Speech Detected (RMS: {rms}). Sending Video Frame.")
                        
                        # Send ONE frame
                        if self._latest_image_payload and self.out_queue:
                            await self.out_queue.put(self._latest_image_payload)
                        else:
                            print(f"[JODA DEBUG] [VAD] No video frame available to send.")
                            
                else:
                    # Silence
                    if self._is_speaking:
                        if self._silence_start_time is None:
                            self._silence_start_time = time.time()
                        
                        elif time.time() - self._silence_start_time > SILENCE_DURATION:
                            # Silence confirmed, reset state
                            print(f"[JODA DEBUG] [VAD] Silence detected. Resetting speech state.")
                            self._is_speaking = False
                            self._silence_start_time = None

            except Exception as e:
                print(f"Error reading audio: {e}")
                await asyncio.sleep(0.1)

    def enable_external_audio(self, enabled: bool = True) -> None:
        self.use_external_audio = enabled

    def feed_external_audio(self, pcm_s16le: bytes) -> None:
        if not self.use_external_audio:
            return
        try:
            self.external_audio_queue.put_nowait(pcm_s16le)
        except asyncio.QueueFull:
            # Drop oldest to keep latency down
            self._external_audio_drops += 1
            if self._external_audio_drops % 50 == 1:
                print(f"[JODA] external_audio_queue full — dropped {self._external_audio_drops} chunks total (qsize={self.external_audio_queue.qsize()})")
            try:
                _ = self.external_audio_queue.get_nowait()
            except Exception:
                pass
            try:
                self.external_audio_queue.put_nowait(pcm_s16le)
            except Exception:
                pass

    async def handle_generate_image(self, prompt, fc_id=None, fc_name=None):
        """Generate an image using multi-provider fallback chain and send to Media Gallery."""
        print(f"[JODA DEBUG] [IMAGE] Background Task Started: handle_generate_image('{prompt}')")
        try:
            import media_generators

            # Notify frontend: generation started → preview window opens
            if self.on_image_status:
                self.on_image_status({"status": "generating", "prompt": prompt, "mediaType": "image"})

            def on_progress(info):
                if self.on_image_status:
                    self.on_image_status({
                        "status": info.get("status", "generating"),
                        "prompt": prompt,
                        "provider": info.get("provider", ""),
                        "mediaType": "image",
                    })

            result = await media_generators.generate_image(prompt, on_progress=on_progress)

            if result["success"]:
                # Save to project folder
                project_path = self.project_manager.get_current_project_path() / "images"
                project_path.mkdir(parents=True, exist_ok=True)
                save_path = project_path / result["filename"]
                with open(save_path, "wb") as f:
                    f.write(result["raw_bytes"])
                print(f"[JODA DEBUG] [IMAGE] Saved to {save_path} (via {result['provider']})")

                if self.on_image_status:
                    self.on_image_status({
                        "status": "done",
                        "prompt": prompt,
                        "imageUrl": result["data_url"],
                        "filename": result["filename"],
                        "model": result["provider"],
                        "mediaType": "image",
                    })

                if self.on_media_asset:
                    self.on_media_asset({
                        "type": "image",
                        "data": result["data_url"],
                        "filename": result["filename"],
                        "prompt": prompt,
                        "model": result["provider"],
                    })
                    print(f"[JODA DEBUG] [IMAGE] Sent to Media Gallery")
            else:
                print(f"[JODA DEBUG] [IMAGE] All providers failed: {result['error']}")
                if self.on_image_status:
                    self.on_image_status({"status": "error", "prompt": prompt, "error": result["error"], "mediaType": "image"})

        except Exception as e:
            print(f"[JODA DEBUG] [IMAGE] Error: {e}")
            import traceback
            traceback.print_exc()
            if self.on_image_status:
                self.on_image_status({"status": "error", "prompt": prompt, "error": str(e)[:200], "mediaType": "image"})

    async def handle_generate_video(self, prompt, fc_id=None, fc_name=None):
        """Generate a video using multi-provider fallback chain and send to Media Gallery."""
        print(f"[JODA DEBUG] [VIDEO] Background Task Started: handle_generate_video('{prompt}')")
        try:
            import media_generators

            if self.on_image_status:
                self.on_image_status({"status": "generating", "prompt": prompt, "mediaType": "video"})

            def on_progress(info):
                if self.on_image_status:
                    self.on_image_status({
                        "status": info.get("status", "generating"),
                        "prompt": prompt,
                        "provider": info.get("provider", ""),
                        "mediaType": "video",
                    })

            result = await media_generators.generate_video(prompt, on_progress=on_progress)

            if result["success"]:
                project_path = self.project_manager.get_current_project_path() / "videos"
                project_path.mkdir(parents=True, exist_ok=True)
                save_path = project_path / result["filename"]
                with open(save_path, "wb") as f:
                    f.write(result["raw_bytes"])
                print(f"[JODA DEBUG] [VIDEO] Saved to {save_path} (via {result['provider']})")

                if self.on_image_status:
                    self.on_image_status({
                        "status": "done",
                        "prompt": prompt,
                        "mediaUrl": result["data_url"],
                        "filename": result["filename"],
                        "model": result["provider"],
                        "mediaType": "video",
                    })

                if self.on_media_asset:
                    self.on_media_asset({
                        "type": "video",
                        "data": result["data_url"],
                        "filename": result["filename"],
                        "prompt": prompt,
                        "model": result["provider"],
                    })
                    print(f"[JODA DEBUG] [VIDEO] Sent to Media Gallery")
            else:
                print(f"[JODA DEBUG] [VIDEO] All providers failed: {result['error']}")
                if self.on_image_status:
                    self.on_image_status({"status": "error", "prompt": prompt, "error": result["error"], "mediaType": "video"})

        except Exception as e:
            print(f"[JODA DEBUG] [VIDEO] Error: {e}")
            import traceback
            traceback.print_exc()
            if self.on_image_status:
                self.on_image_status({"status": "error", "prompt": prompt, "error": str(e)[:200], "mediaType": "video"})

    async def handle_cad_request(self, prompt):
        print(f"[JODA DEBUG] [CAD] Background Task Started: handle_cad_request('{prompt}')")
        if not self.cad_agent:
            if self.on_cad_status:
                self.on_cad_status("error")
            if self.on_transcription:
                self.on_transcription(
                    {
                        "sender": "System",
                        "text": "CAD agent is unavailable (missing dependencies). Install CAD deps to enable this tool.\n",
                    }
                )
            return
        if self.on_cad_status:
            self.on_cad_status("generating")

        async def notify(text, end_of_turn=True):
            try:
                if self.session:
                    await self.session.send(input=text, end_of_turn=end_of_turn)
                elif self.on_transcription:
                    self.on_transcription({"sender": "System", "text": text + "\n"})
            except Exception as e:
                print(f"[JODA DEBUG] [ERR] Notification failed: {e}")
            
        # Auto-create project if stuck in temp
        if self.project_manager.current_project == "temp":
            import datetime
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            new_project_name = f"Project_{timestamp}"
            print(f"[JODA DEBUG] [CAD] Auto-creating project: {new_project_name}")
            
            success, msg = self.project_manager.create_project(new_project_name)
            if success:
                self.project_manager.switch_project(new_project_name)
                # Notify User (Optional, or rely on update)
                await notify(
                    f"System Notification: Automatic Project Creation. Switched to new project '{new_project_name}'.",
                    end_of_turn=False,
                )
                if self.on_project_update:
                    self.on_project_update(new_project_name)

        # Get project cad folder path
        cad_output_dir = str(self.project_manager.get_current_project_path() / "cad")
        
        # Call the secondary agent with project path
        cad_data = await self.cad_agent.generate_prototype(prompt, output_dir=cad_output_dir)
        
        if cad_data:
            print(f"[JODA DEBUG] [OK] CadAgent returned data successfully.")
            print(f"[JODA DEBUG] [INFO] Data Check: {len(cad_data.get('vertices', []))} vertices, {len(cad_data.get('edges', []))} edges.")
            
            if self.on_cad_data:
                print(f"[JODA DEBUG] [SEND] Dispatching data to frontend callback...")
                self.on_cad_data(cad_data)
                print(f"[JODA DEBUG] [SENT] Dispatch complete.")
            
            # Save to Project
            if 'file_path' in cad_data:
                self.project_manager.save_cad_artifact(cad_data['file_path'], prompt)
            else:
                 # Fallback (legacy support)
                 self.project_manager.save_cad_artifact("output.stl", prompt)

            # Notify the model that the task is done - this triggers speech about completion
            completion_msg = "System Notification: CAD generation is complete! The 3D model is now displayed for the user. Let them know it's ready."
            await notify(completion_msg, end_of_turn=True)
            print(f"[JODA DEBUG] [NOTE] Sent completion notification.")

        else:
            print(f"[JODA DEBUG] [ERR] CadAgent returned None.")
            # Optionally notify failure
            await notify("System Notification: CAD generation failed.", end_of_turn=True)



    async def handle_write_file(self, path, content):
        print(f"[JODA DEBUG] [FS] Writing file: '{path}'")

        async def notify(text, end_of_turn=True):
            try:
                if self.session:
                    await self.session.send(input=text, end_of_turn=end_of_turn)
                elif self.on_transcription:
                    self.on_transcription({"sender": "System", "text": text + "\n"})
            except Exception as e:
                print(f"[JODA DEBUG] [ERR] Notification failed: {e}")
        
        # Auto-create project if stuck in temp
        if self.project_manager.current_project == "temp":
            import datetime
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            new_project_name = f"Project_{timestamp}"
            print(f"[JODA DEBUG] [FS] Auto-creating project: {new_project_name}")
            
            success, msg = self.project_manager.create_project(new_project_name)
            if success:
                self.project_manager.switch_project(new_project_name)
                # Notify User
                await notify(
                    f"System Notification: Automatic Project Creation. Switched to new project '{new_project_name}'.",
                    end_of_turn=False,
                )
                if self.on_project_update:
                    self.on_project_update(new_project_name)
        
        # Force path to be relative to current project
        # If absolute path is provided, we try to strip it or just ignore it and use basename
        filename = os.path.basename(path)
        
        # If path contained subdirectories (e.g. "backend/server.py"), preserving that structure might be desired IF it's within the project.
        # But for safety, and per user request to "always create the file in the project", 
        # we will root it in the current project path.
        
        current_project_path = self.project_manager.get_current_project_path()
        final_path = current_project_path / filename # Simple flat structure for now, or allow relative?
        
        # If the user specifically wanted a subfolder, they might have provided "sub/file.txt".
        # Let's support relative paths if they don't start with /
        if not os.path.isabs(path):
             final_path = current_project_path / path
        
        print(f"[JODA DEBUG] [FS] Resolved path: '{final_path}'")

        try:
            # Ensure parent exists
            os.makedirs(os.path.dirname(final_path), exist_ok=True)
            with open(final_path, 'w', encoding='utf-8') as f:
                f.write(content)
            result = f"File '{final_path.name}' written successfully to project '{self.project_manager.current_project}'."
        except Exception as e:
            result = f"Failed to write file '{path}': {str(e)}"

        print(f"[JODA DEBUG] [FS] Result: {result}")
        await notify(f"System Notification: {result}", end_of_turn=True)

    async def handle_read_directory(self, path):
        print(f"[JODA DEBUG] [FS] Reading directory: '{path}'")

        async def notify(text, end_of_turn=True):
            try:
                if self.session:
                    await self.session.send(input=text, end_of_turn=end_of_turn)
                elif self.on_transcription:
                    self.on_transcription({"sender": "System", "text": text + "\n"})
            except Exception as e:
                print(f"[JODA DEBUG] [ERR] Notification failed: {e}")
        try:
            if not os.path.exists(path):
                result = f"Directory '{path}' does not exist."
            else:
                items = os.listdir(path)
                result = f"Contents of '{path}': {', '.join(items)}"
        except Exception as e:
            result = f"Failed to read directory '{path}': {str(e)}"

        print(f"[JODA DEBUG] [FS] Result: {result}")
        await notify(f"System Notification: {result}", end_of_turn=True)

    async def handle_read_file(self, path):
        print(f"[JODA DEBUG] [FS] Reading file: '{path}'")

        async def notify(text, end_of_turn=True):
            try:
                if self.session:
                    await self.session.send(input=text, end_of_turn=end_of_turn)
                elif self.on_transcription:
                    self.on_transcription({"sender": "System", "text": text + "\n"})
            except Exception as e:
                print(f"[JODA DEBUG] [ERR] Notification failed: {e}")
        try:
            if not os.path.exists(path):
                result = f"File '{path}' does not exist."
            else:
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                result = f"Content of '{path}':\n{content}"
        except Exception as e:
            result = f"Failed to read file '{path}': {str(e)}"

        print(f"[JODA DEBUG] [FS] Result: {result}")
        await notify(f"System Notification: {result}", end_of_turn=True)

    async def handle_web_agent_request(self, prompt, secrets=None):
        print(f"[JODA DEBUG] [WEB] Web Agent Task: '{prompt}'")
        if secrets is None:
            secrets = self.browser_secrets
        if not self.web_agent:
            if self.on_transcription:
                self.on_transcription(
                    {
                        "sender": "System",
                        "text": "Web agent is unavailable (missing dependencies). Install Playwright + Google GenAI deps to enable this tool.\n",
                    }
                )
            return

        async def notify(text, end_of_turn=True):
            try:
                if self.session:
                    await self.session.send(input=text, end_of_turn=end_of_turn)
                elif self.on_transcription:
                    self.on_transcription({"sender": "System", "text": text + "\n"})
            except Exception as e:
                print(f"[JODA DEBUG] [ERR] Notification failed: {e}")
        
        async def update_frontend(image_b64, log_text):
            if self.on_web_data:
                 self.on_web_data({"image": image_b64, "log": log_text})
                 
        # Run the web agent and wait for it to return
        result = await self.web_agent.run_task(prompt, update_callback=update_frontend, secrets=secrets)
        print(f"[JODA DEBUG] [WEB] Web Agent Task Returned: {result}")
        
        # Send the final result back to the main model
        await notify(f"System Notification: Web Agent has finished.\nResult: {result}", end_of_turn=True)

    async def handle_browser_use_request(self, prompt: str, secrets=None):
        print(f"[JODA DEBUG] [BROWSER_USE] Task: '{prompt}'")
        if secrets is None:
            secrets = self.browser_secrets
        if not run_browser_use_task:
            if self.on_transcription:
                self.on_transcription(
                    {
                        "sender": "System",
                        "text": "Browser task agent is unavailable (missing dependencies). Install browser-use or enable the built-in web agent.\n",
                    }
                )
            return

        async def notify(text, end_of_turn=True):
            try:
                if self.session:
                    await self.session.send(input=text, end_of_turn=end_of_turn)
                elif self.on_transcription:
                    self.on_transcription({"sender": "System", "text": text + "\n"})
            except Exception as e:
                print(f"[JODA DEBUG] [ERR] Notification failed: {e}")

        async def update_frontend(image_b64, log_text):
            if self.on_web_data:
                self.on_web_data({"image": image_b64, "log": log_text})

        preamble = ""
        try:
            preamble = self.browser_skills.build_prompt_preamble(prompt, limit=5)
        except Exception:
            preamble = ""
        merged_prompt = f"{preamble}\nTask:\n{prompt}".strip() if preamble else prompt
        result = await run_browser_use_task(merged_prompt, update_callback=update_frontend, secrets=secrets)
        await notify(f"System Notification: Browser task finished.\nResult: {result}", end_of_turn=True)

    async def receive_audio(self):
        "Background task to reads from the websocket and write pcm chunks to the output queue"
        try:
            while True:
                turn = self.session.receive()
                async for response in turn:
                    # 1. Handle Audio Data
                    if data := response.data:
                        self.audio_in_queue.put_nowait(data)
                        # NOTE: 'continue' removed here to allow processing transcription/tools in same packet

                    # 2. Handle Transcription (User & Model)
                    if response.server_content:
                        if response.server_content.input_transcription:
                            transcript = response.server_content.input_transcription.text
                            if transcript:
                                # Skip if this is an exact duplicate event
                                if transcript != self._last_input_transcription:
                                    # Calculate delta (Gemini may send cumulative or chunk-based text)
                                    delta = transcript
                                    if transcript.startswith(self._last_input_transcription):
                                        delta = transcript[len(self._last_input_transcription):]
                                    self._last_input_transcription = transcript
                                    
                                    # Only send if there's new text
                                    if delta:
                                        # User is speaking, so interrupt model playback!
                                        self.clear_audio_queue()

                                        # Route voice Agent Zero commands into /agent0 commands (best-effort).
                                        # Use the full transcript so we don't trigger on partial deltas.
                                        try:
                                            asyncio.create_task(self._route_voice_command_if_needed(transcript))
                                        except Exception:
                                            pass

                                        # Send to frontend (Streaming)
                                        if self.on_transcription:
                                             self.on_transcription({"sender": "User", "text": delta})
                                        
                                        # Buffer for Logging
                                        if self.chat_buffer["sender"] != "User":
                                            # Flush previous if exists
                                            if self.chat_buffer["sender"] and self.chat_buffer["text"].strip():
                                                self.project_manager.log_chat(self.chat_buffer["sender"], self.chat_buffer["text"])
                                            # Start new
                                            self.chat_buffer = {"sender": "User", "text": delta}
                                        else:
                                            # Append
                                            self.chat_buffer["text"] += delta
                        
                        if response.server_content.output_transcription:
                            transcript = response.server_content.output_transcription.text
                            if transcript:
                                # Skip if this is an exact duplicate event
                                if transcript != self._last_output_transcription:
                                    # Calculate delta (Gemini may send cumulative or chunk-based text)
                                    delta = transcript
                                    if transcript.startswith(self._last_output_transcription):
                                        delta = transcript[len(self._last_output_transcription):]
                                    self._last_output_transcription = transcript
                                    
                                    # Only send if there's new text
                                    if delta:
                                        # Send to frontend (Streaming)
                                        if self.on_transcription:
                                             self.on_transcription({"sender": "JODA", "text": delta})
                                        
                                        # Buffer for Logging
                                        if self.chat_buffer["sender"] != "JODA":
                                            # Flush previous
                                            if self.chat_buffer["sender"] and self.chat_buffer["text"].strip():
                                                self.project_manager.log_chat(self.chat_buffer["sender"], self.chat_buffer["text"])
                                            # Start new
                                            self.chat_buffer = {"sender": "JODA", "text": delta}
                                        else:
                                            # Append
                                            self.chat_buffer["text"] += delta
                        
                        # Flush buffer on turn completion if needed, 
                        # but usually better to wait for sender switch or explicit end.
                        # We can also check turn_complete signal if available in response.server_content.model_turn etc

                    # 3. Handle Tool Calls
                    if response.tool_call:
                        print("The tool was called")
                        function_responses = []
                        for fc in response.tool_call.function_calls:
                            if fc.name in [
                                "generate_cad",
                                "generate_image",
                                "generate_video",
                                "run_web_agent",
                                "run_browser_use",
                                "list_browser_skills",
                                "save_browser_skill",
                                "delete_browser_skill",
                                "list_schedules",
                                "create_schedule",
                                "delete_schedule",
                                "agent_zero_pull",
                                "agent_zero_start",
                                "agent_zero_list",
                                "agent_zero_stop",
                                "agent_zero_scale",
                                "write_file",
                                "read_directory",
                                "read_file",
                                "create_project",
                                "switch_project",
                                "list_projects",
                                "list_smart_devices",
                                "control_light",
                                "discover_printers",
                                "print_stl",
                                "get_print_status",
                                "iterate_cad",
                                "run_shell_command",
                                "run_ralph_orchestrator",
                                "set_shell_expert_mode",
                                "mcp_list_tools",
                                "mcp_call_tool",
                            ]:
                                prompt = fc.args.get("prompt", "")  # Prompt is not present for all tools

                                # Permission model:
                                # - permissions[tool] == True (default) -> auto-allow
                                # - permissions[tool] == False -> require confirmation
                                # - run_shell_command / run_ralph_orchestrator always require confirmation
                                allowed = self.permissions.get(fc.name, True)
                                require_confirmation = (
                                    fc.name in (
                                        "run_shell_command",
                                        "run_ralph_orchestrator",
                                        "set_shell_expert_mode",
                                        "mcp_list_tools",
                                        "mcp_call_tool",
                                        "agent_zero_pull",
                                        "agent_zero_start",
                                        "agent_zero_stop",
                                        "agent_zero_scale",
                                    )
                                ) or (not allowed)

                                if require_confirmation:
                                    if not self.on_tool_confirmation:
                                        function_responses.append(
                                            types.FunctionResponse(
                                                id=fc.id,
                                                name=fc.name,
                                                response={
                                                    "result": "Tool requires confirmation but no UI confirmation callback is configured."
                                                },
                                            )
                                        )
                                        continue

                                    import uuid

                                    request_id = str(uuid.uuid4())
                                    print(
                                        f"[JODA DEBUG] [CONFIRM] Requesting confirmation for '{fc.name}' (ID: {request_id})"
                                    )

                                    future = asyncio.Future()
                                    self._pending_confirmations[request_id] = future
                                    self.on_tool_confirmation({"id": request_id, "tool": fc.name, "args": fc.args})
                                    try:
                                        confirmed = await future
                                    finally:
                                        self._pending_confirmations.pop(request_id, None)

                                    if not confirmed:
                                        function_responses.append(
                                            types.FunctionResponse(
                                                id=fc.id,
                                                name=fc.name,
                                                response={"result": "User denied the request to use this tool."},
                                            )
                                        )
                                        continue

                                # If confirmed (or no callback configured, or auto-allowed), proceed
                                if fc.name == "generate_cad":
                                    print(f"\n[JODA DEBUG] --------------------------------------------------")
                                    print(f"[JODA DEBUG] [TOOL] Tool Call Detected: 'generate_cad'")
                                    print(f"[JODA DEBUG] [IN] Arguments: prompt='{prompt}'")

                                    asyncio.create_task(self.handle_cad_request(prompt))
                                    # No function response needed - model already acknowledged when user asked

                                elif fc.name == "generate_image":
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'generate_image' with prompt='{prompt}'")
                                    asyncio.create_task(self.handle_generate_image(prompt, fc.id, fc.name))
                                    result_text = "Image generation started. The image will appear in the Media Gallery when ready."
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name,
                                        response={"result": result_text},
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "generate_video":
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'generate_video' with prompt='{prompt}'")
                                    asyncio.create_task(self.handle_generate_video(prompt, fc.id, fc.name))
                                    result_text = "Video generation started. The video will appear in the Media Gallery when ready."
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name,
                                        response={"result": result_text},
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "run_web_agent":
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'run_web_agent' with prompt='{prompt}'")
                                    asyncio.create_task(self.handle_web_agent_request(prompt))
                                    
                                    result_text = "Web Navigation started. Do not reply to this message."
                                    function_response = types.FunctionResponse(
                                        id=fc.id,
                                        name=fc.name,
                                        response={
                                            "result": result_text,
                                        }
                                    )
                                    print(f"[JODA DEBUG] [RESPONSE] Sending function response: {function_response}")
                                    function_responses.append(function_response)

                                elif fc.name == "run_browser_use":
                                    print(
                                        f"[JODA DEBUG] [TOOL] Tool Call: 'run_browser_use' with prompt='{prompt}'"
                                    )
                                    asyncio.create_task(self.handle_browser_use_request(prompt))

                                    result_text = "Browser task started. Do not reply to this message."
                                    function_response = types.FunctionResponse(
                                        id=fc.id,
                                        name=fc.name,
                                        response={"result": result_text},
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "list_browser_skills":
                                    try:
                                        skills = [
                                            {"id": s.id, "name": s.name, "description": s.description}
                                            for s in self.browser_skills.list()
                                        ]
                                        result = {"skills": skills}
                                    except Exception as e:
                                        result = {"skills": [], "error": str(e)}
                                    function_responses.append(
                                        types.FunctionResponse(id=fc.id, name=fc.name, response=result)
                                    )

                                elif fc.name == "save_browser_skill":
                                    try:
                                        name = (fc.args.get("name") or "").strip()
                                        description = (fc.args.get("description") or "").strip()
                                        template = (fc.args.get("template") or "").strip()
                                        saved = self.browser_skills.save(
                                            name=name, description=description, template=template
                                        )
                                        result_text = f"Saved browser skill '{saved.name}' ({saved.id})."
                                    except Exception as e:
                                        result_text = f"Failed to save browser skill: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id, name=fc.name, response={"result": result_text}
                                        )
                                    )

                                elif fc.name == "delete_browser_skill":
                                    try:
                                        skill_id = (fc.args.get("skill_id") or "").strip()
                                        name = (fc.args.get("name") or "").strip()
                                        ok = self.browser_skills.delete(skill_id=skill_id or None, name=name or None)
                                        result_text = (
                                            "Deleted browser skill." if ok else "Browser skill not found."
                                        )
                                    except Exception as e:
                                        result_text = f"Failed to delete browser skill: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id, name=fc.name, response={"result": result_text}
                                        )
                                    )

                                elif fc.name == "list_schedules":
                                    try:
                                        jobs = self.scheduler_store.list()
                                        result = {
                                            "jobs": [
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
                                                for j in jobs
                                            ]
                                        }
                                    except Exception as e:
                                        result = {"jobs": [], "error": str(e)}
                                    function_responses.append(
                                        types.FunctionResponse(id=fc.id, name=fc.name, response=result)
                                    )

                                elif fc.name == "create_schedule":
                                    try:
                                        name = str(fc.args.get("name") or "").strip()
                                        enabled = bool(fc.args.get("enabled", True))
                                        schedule_type = str(fc.args.get("schedule_type") or "").strip()
                                        task_type = str(fc.args.get("task_type") or "").strip()
                                        payload = fc.args.get("payload") or {}
                                        if not isinstance(payload, dict):
                                            raise ValueError("payload must be an object")

                                        job = self.scheduler_store.create(
                                            name=name,
                                            enabled=enabled,
                                            schedule_type=schedule_type,  # type: ignore[arg-type]
                                            interval_minutes=fc.args.get("interval_minutes"),
                                            cron=fc.args.get("cron"),
                                            task_type=task_type,  # type: ignore[arg-type]
                                            payload=payload,
                                        )
                                        result_text = f"Saved schedule '{job.name}' ({job.id})."
                                    except Exception as e:
                                        result_text = f"Failed to create schedule: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id, name=fc.name, response={"result": result_text}
                                        )
                                    )

                                elif fc.name == "delete_schedule":
                                    try:
                                        job_id = str(fc.args.get("id") or "").strip()
                                        ok = self.scheduler_store.delete(job_id)
                                        result_text = "Deleted schedule." if ok else "Schedule not found."
                                    except Exception as e:
                                        result_text = f"Failed to delete schedule: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id, name=fc.name, response={"result": result_text}
                                        )
                                    )

                                elif fc.name == "agent_zero_list":
                                    try:
                                        containers = self.agent_zero.list_running()
                                        function_responses.append(
                                            types.FunctionResponse(
                                                id=fc.id, name=fc.name, response={"containers": containers}
                                            )
                                        )
                                    except Exception as e:
                                        function_responses.append(
                                            types.FunctionResponse(
                                                id=fc.id, name=fc.name, response={"error": str(e)[:500]}
                                            )
                                        )

                                elif fc.name == "agent_zero_pull":
                                    if not self.shell_expert_mode:
                                        result_text = "Shell expert mode is OFF. Use /expert on first."
                                    else:
                                        try:
                                            image = (fc.args.get("image") or "").strip() or None
                                            out = self.agent_zero.pull_latest(image=image)
                                            result_text = out[:2000] if out else "Pulled."
                                        except Exception as e:
                                            result_text = f"Agent Zero pull failed: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id, name=fc.name, response={"result": result_text}
                                        )
                                    )

                                elif fc.name == "agent_zero_start":
                                    if not self.shell_expert_mode:
                                        result_text = "Shell expert mode is OFF. Use /expert on first."
                                    else:
                                        try:
                                            host_port = fc.args.get("host_port")
                                            image = (fc.args.get("image") or "").strip() or None
                                            inst = self.agent_zero.start(host_port=host_port, image=image)
                                            result_text = f"Started {inst.name} on port {inst.host_port}."
                                        except Exception as e:
                                            result_text = f"Agent Zero start failed: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id, name=fc.name, response={"result": result_text}
                                        )
                                    )

                                elif fc.name == "agent_zero_stop":
                                    if not self.shell_expert_mode:
                                        result_text = "Shell expert mode is OFF. Use /expert on first."
                                    else:
                                        try:
                                            name = str(fc.args.get("name") or "").strip()
                                            ok = self.agent_zero.stop(name=name)
                                            result_text = "Stopped." if ok else "Stop failed or not running."
                                        except Exception as e:
                                            result_text = f"Agent Zero stop failed: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id, name=fc.name, response={"result": result_text}
                                        )
                                    )

                                elif fc.name == "agent_zero_scale":
                                    if not self.shell_expert_mode:
                                        result_text = "Shell expert mode is OFF. Use /expert on first."
                                    else:
                                        try:
                                            count = int(fc.args.get("count") or 0)
                                            image = (fc.args.get("image") or "").strip() or None
                                            created = self.agent_zero.scale(count=count, image=image)
                                            result_text = (
                                                f"Scale requested. Created {len(created)} new instance(s)."
                                                if created
                                                else "Scale requested. No new instances needed."
                                            )
                                        except Exception as e:
                                            result_text = f"Agent Zero scale failed: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id, name=fc.name, response={"result": result_text}
                                        )
                                    )

                                elif fc.name == "run_shell_command":
                                    cmd = fc.args.get("command", "")
                                    cwd = fc.args.get("cwd")
                                    timeout_sec = int(fc.args.get("timeout_sec") or 600)
                                    try:
                                        result_text = await self.handle_run_shell_command(
                                            command=cmd, cwd=cwd, timeout_sec=timeout_sec
                                        )
                                    except Exception as e:
                                        result_text = f"[shell] Error: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": result_text},
                                        )
                                    )



                                elif fc.name == "run_ralph_orchestrator":
                                    project_path = fc.args.get("project_path", "")
                                    mode = fc.args.get("mode", "build")
                                    agent = fc.args.get("agent", "auto")
                                    max_iterations = int(fc.args.get("max_iterations") or 50)
                                    max_runtime = int(fc.args.get("max_runtime") or 3600)
                                    try:
                                        result_text = await self.handle_run_ralph_orchestrator(
                                            project_path=project_path,
                                            mode=mode,
                                            agent=agent,
                                            max_iterations=max_iterations,
                                            max_runtime=max_runtime,
                                        )
                                    except Exception as e:
                                        result_text = f"[ralph] Error: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": result_text},
                                        )
                                    )

                                elif fc.name == "set_shell_expert_mode":
                                    enabled = bool(fc.args.get("enabled", False))
                                    self.set_shell_expert_mode(enabled)
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": f"Shell expert mode set to: {enabled}"},
                                        )
                                    )

                                elif fc.name == "mcp_list_tools":
                                    try:
                                        result_text = await self.handle_mcp_list_tools()
                                    except Exception as e:
                                        result_text = f"[mcp] Error listing tools: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": result_text},
                                        )
                                    )

                                elif fc.name == "mcp_call_tool":
                                    tool_name = fc.args.get("tool_name", "")
                                    arguments = fc.args.get("arguments", {}) or {}
                                    try:
                                        result_text = await self.handle_mcp_call_tool(tool_name, arguments)
                                    except Exception as e:
                                        result_text = f"[mcp] Tool call error: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": result_text},
                                        )
                                    )

                                elif fc.name == "mcp_reload":
                                    try:
                                        result_text = await self.handle_mcp_reload()
                                    except Exception as e:
                                        result_text = f"[mcp] Reload error: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": result_text},
                                        )
                                    )

                                elif fc.name == "codex_mcp_add":
                                    try:
                                        result_text = await self.handle_codex_mcp_add(fc.args or {})
                                    except Exception as e:
                                        result_text = f"[codex_mcp_add] Error: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": result_text},
                                        )
                                    )

                                elif fc.name == "healthcare_mcp_discover":
                                    try:
                                        result_text = await self.handle_healthcare_mcp_discover(fc.args or {})
                                    except Exception as e:
                                        result_text = f"[healthcare_mcp_discover] Error: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": result_text},
                                        )
                                    )

                                elif fc.name == "mcp_directory_discover":
                                    try:
                                        result_text = await self.handle_mcp_directory_discover(fc.args or {})
                                    except Exception as e:
                                        result_text = f"[mcp_directory_discover] Error: {e}"
                                    function_responses.append(
                                        types.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": result_text},
                                        )
                                    )

                                elif fc.name == "write_file":
                                    path = fc.args["path"]
                                    content = fc.args["content"]
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'write_file' path='{path}'")
                                    asyncio.create_task(self.handle_write_file(path, content))
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": "Writing file..."}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "read_directory":
                                    path = fc.args["path"]
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'read_directory' path='{path}'")
                                    asyncio.create_task(self.handle_read_directory(path))
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": "Reading directory..."}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "read_file":
                                    path = fc.args["path"]
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'read_file' path='{path}'")
                                    asyncio.create_task(self.handle_read_file(path))
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": "Reading file..."}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "create_project":
                                    name = fc.args["name"]
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'create_project' name='{name}'")
                                    success, msg = self.project_manager.create_project(name)
                                    if success:
                                        # Auto-switch to the newly created project
                                        self.project_manager.switch_project(name)
                                        msg += f" Switched to '{name}'."
                                        if self.on_project_update:
                                            self.on_project_update(name)
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": msg}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "switch_project":
                                    name = fc.args["name"]
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'switch_project' name='{name}'")
                                    success, msg = self.project_manager.switch_project(name)
                                    if success:
                                        if self.on_project_update:
                                            self.on_project_update(name)
                                        # Gather project context and send to AI (silently, no response expected)
                                        context = self.project_manager.get_project_context()
                                        print(f"[JODA DEBUG] [PROJECT] Sending project context to AI ({len(context)} chars)")
                                        try:
                                            await self.session.send(input=f"System Notification: {msg}\n\n{context}", end_of_turn=False)
                                        except Exception as e:
                                            print(f"[JODA DEBUG] [ERR] Failed to send project context: {e}")
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": msg}
                                    )
                                    function_responses.append(function_response)
                                
                                elif fc.name == "list_projects":
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'list_projects'")
                                    projects = sorted(self.project_manager.list_projects())
                                    projects_dir = getattr(self.project_manager, "projects_dir", None)
                                    projects_root = str(projects_dir) if projects_dir else "(unknown)"
                                    paths = []
                                    for name in projects:
                                        if projects_dir:
                                            paths.append(f"- {name}: {projects_dir / name}")
                                        else:
                                            paths.append(f"- {name}")
                                    function_response = types.FunctionResponse(
                                        id=fc.id,
                                        name=fc.name,
                                        response={
                                            "result": (
                                                "Available projects (on disk):\n"
                                                + "\n".join(paths)
                                                + f"\n\nProjects root: {projects_root}"
                                            )
                                        },
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "list_smart_devices":
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'list_smart_devices'")
                                    # Use cached devices directly for speed
                                    # devices_dict is {ip: SmartDevice}
                                    
                                    dev_summaries = []
                                    frontend_list = []
                                    
                                    for ip, d in self.kasa_agent.devices.items():
                                        dev_type = "unknown"
                                        if d.is_bulb: dev_type = "bulb"
                                        elif d.is_plug: dev_type = "plug"
                                        elif d.is_strip: dev_type = "strip"
                                        elif d.is_dimmer: dev_type = "dimmer"
                                        
                                        # Format for Model
                                        info = f"{d.alias} (IP: {ip}, Type: {dev_type})"
                                        if d.is_on:
                                            info += " [ON]"
                                        else:
                                            info += " [OFF]"
                                        dev_summaries.append(info)
                                        
                                        # Format for Frontend
                                        frontend_list.append({
                                            "ip": ip,
                                            "alias": d.alias,
                                            "model": d.model,
                                            "type": dev_type,
                                            "is_on": d.is_on,
                                            "brightness": d.brightness if d.is_bulb or d.is_dimmer else None,
                                            "hsv": d.hsv if d.is_bulb and d.is_color else None,
                                            "has_color": d.is_color if d.is_bulb else False,
                                            "has_brightness": d.is_dimmable if d.is_bulb or d.is_dimmer else False
                                        })
                                    
                                    result_str = "No devices found in cache."
                                    if dev_summaries:
                                        result_str = "Found Devices (Cached):\n" + "\n".join(dev_summaries)
                                    
                                    # Trigger frontend update
                                    if self.on_device_update:
                                        self.on_device_update(frontend_list)

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "control_light":
                                    target = fc.args["target"]
                                    action = fc.args["action"]
                                    brightness = fc.args.get("brightness")
                                    color = fc.args.get("color")
                                    
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'control_light' Target='{target}' Action='{action}'")
                                    
                                    result_msg = f"Action '{action}' on '{target}' failed."
                                    success = False
                                    
                                    if action == "turn_on":
                                        success = await self.kasa_agent.turn_on(target)
                                        if success:
                                            result_msg = f"Turned ON '{target}'."
                                    elif action == "turn_off":
                                        success = await self.kasa_agent.turn_off(target)
                                        if success:
                                            result_msg = f"Turned OFF '{target}'."
                                    elif action == "set":
                                        success = True
                                        result_msg = f"Updated '{target}':"
                                    
                                    # Apply extra attributes if 'set' or if we just turned it on and want to set them too
                                    if success or action == "set":
                                        if brightness is not None:
                                            sb = await self.kasa_agent.set_brightness(target, brightness)
                                            if sb:
                                                result_msg += f" Set brightness to {brightness}."
                                        if color is not None:
                                            sc = await self.kasa_agent.set_color(target, color)
                                            if sc:
                                                result_msg += f" Set color to {color}."

                                    # Notify Frontend of State Change
                                    if success:
                                        # We don't need full discovery, just refresh known state or push update
                                        # But for simplicity, let's get the standard list representation
                                        # KasaAgent updates its internal state on control, so we can rebuild the list
                                        
                                        # Quick rebuild of list from internal dict
                                        updated_list = []
                                        for ip, dev in self.kasa_agent.devices.items():
                                            # We need to ensure we have the correct dict structure expected by frontend
                                            # We duplicate logic from KasaAgent.discover_devices a bit, but that's okay for now or we can add a helper
                                            # Ideally KasaAgent has a 'get_devices_list()' method.
                                            # Use the cached objects in self.kasa_agent.devices
                                            
                                            dev_type = "unknown"
                                            if dev.is_bulb: dev_type = "bulb"
                                            elif dev.is_plug: dev_type = "plug"
                                            elif dev.is_strip: dev_type = "strip"
                                            elif dev.is_dimmer: dev_type = "dimmer"

                                            d_info = {
                                                "ip": ip,
                                                "alias": dev.alias,
                                                "model": dev.model,
                                                "type": dev_type,
                                                "is_on": dev.is_on,
                                                "brightness": dev.brightness if dev.is_bulb or dev.is_dimmer else None,
                                                "hsv": dev.hsv if dev.is_bulb and dev.is_color else None,
                                                "has_color": dev.is_color if dev.is_bulb else False,
                                                "has_brightness": dev.is_dimmable if dev.is_bulb or dev.is_dimmer else False
                                            }
                                            updated_list.append(d_info)
                                            
                                        if self.on_device_update:
                                            self.on_device_update(updated_list)
                                    else:
                                        # Report Error
                                        if self.on_error:
                                            self.on_error(result_msg)

                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_msg}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "discover_printers":
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'discover_printers'")
                                    printers = await self.printer_agent.discover_printers()
                                    # Format for model
                                    if printers:
                                        printer_list = []
                                        for p in printers:
                                            printer_list.append(f"{p['name']} ({p['host']}:{p['port']}, type: {p['printer_type']})")
                                        result_str = "Found Printers:\n" + "\n".join(printer_list)
                                    else:
                                        result_str = "No printers found on network. Ensure printers are on and running OctoPrint/Moonraker."
                                    
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "print_stl":
                                    stl_path = fc.args["stl_path"]
                                    printer = fc.args["printer"]
                                    profile = fc.args.get("profile")
                                    
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'print_stl' STL='{stl_path}' Printer='{printer}'")
                                    
                                    # Resolve 'current' to project STL
                                    if stl_path.lower() == "current":
                                        stl_path = "output.stl" # Let printer agent resolve it in root_path

                                    # Get current project path
                                    project_path = str(self.project_manager.get_current_project_path())
                                    
                                    result = await self.printer_agent.print_stl(
                                        stl_path, 
                                        printer, 
                                        profile, 
                                        root_path=project_path
                                    )
                                    result_str = result.get("message", "Unknown result")
                                    
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "get_print_status":
                                    printer = fc.args["printer"]
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'get_print_status' Printer='{printer}'")
                                    
                                    status = await self.printer_agent.get_print_status(printer)
                                    if status:
                                        result_str = f"Printer: {status.printer}\n"
                                        result_str += f"State: {status.state}\n"
                                        result_str += f"Progress: {status.progress_percent:.1f}%\n"
                                        if status.time_remaining:
                                            result_str += f"Time Remaining: {status.time_remaining}\n"
                                        if status.time_elapsed:
                                            result_str += f"Time Elapsed: {status.time_elapsed}\n"
                                        if status.filename:
                                            result_str += f"File: {status.filename}\n"
                                        if status.temperatures:
                                            temps = status.temperatures
                                            if "hotend" in temps:
                                                result_str += f"Hotend: {temps['hotend']['current']:.0f}°C / {temps['hotend']['target']:.0f}°C\n"
                                            if "bed" in temps:
                                                result_str += f"Bed: {temps['bed']['current']:.0f}°C / {temps['bed']['target']:.0f}°C"
                                    else:
                                        result_str = f"Could not get status for printer '{printer}'. Ensure it is discovered first."
                                    
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)

                                elif fc.name == "iterate_cad":
                                    prompt = fc.args["prompt"]
                                    print(f"[JODA DEBUG] [TOOL] Tool Call: 'iterate_cad' Prompt='{prompt}'")
                                    
                                    # Emit status
                                    if self.on_cad_status:
                                        self.on_cad_status("generating")
                                    
                                    # Get project cad folder path
                                    cad_output_dir = str(self.project_manager.get_current_project_path() / "cad")
                                    
                                    # Call CadAgent to iterate on the design
                                    cad_data = await self.cad_agent.iterate_prototype(prompt, output_dir=cad_output_dir)
                                    
                                    if cad_data:
                                        print(f"[JODA DEBUG] [OK] CadAgent iteration returned data successfully.")
                                        
                                        # Dispatch to frontend
                                        if self.on_cad_data:
                                            print(f"[JODA DEBUG] [SEND] Dispatching iterated CAD data to frontend...")
                                            self.on_cad_data(cad_data)
                                            print(f"[JODA DEBUG] [SENT] Dispatch complete.")
                                        
                                        # Save to Project
                                        self.project_manager.save_cad_artifact("output.stl", f"Iteration: {prompt}")
                                        
                                        result_str = f"Successfully iterated design: {prompt}. The updated 3D model is now displayed."
                                    else:
                                        print(f"[JODA DEBUG] [ERR] CadAgent iteration returned None.")
                                        result_str = f"Failed to iterate design with prompt: {prompt}"
                                    
                                    function_response = types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result_str}
                                    )
                                    function_responses.append(function_response)
                        if function_responses:
                            await self.session.send_tool_response(function_responses=function_responses)
                
                # Turn/Response Loop Finished
                self.flush_chat()

                while not self.audio_in_queue.empty():
                    self.audio_in_queue.get_nowait()
        except Exception as e:
            print(f"Error in receive_audio: {e}")
            traceback.print_exc()
            # CRITICAL: Re-raise to crash the TaskGroup and trigger outer loop reconnect
            raise e

    async def play_audio(self):
        stream = None
        try:
            pya = _get_pya()
            if FORMAT is not None:
                stream = await asyncio.to_thread(
                    pya.open,
                    format=FORMAT,
                    channels=CHANNELS,
                    rate=RECEIVE_SAMPLE_RATE,
                    output=True,
                    output_device_index=self.output_device_index,
                )
        except OSError as e:
            # VPS/headless environments often have no audio output device; continue streaming to frontend anyway.
            print(f"[JODA] [WARN] Failed to open audio output stream (server-side): {e}")
            stream = None
        except Exception as e:
            # If pyaudio isn't installed, just stream to frontend.
            print(f"[JODA] [WARN] Server-side audio output disabled: {e}")
            stream = None
        while True:
            bytestream = await self.audio_in_queue.get()
            if self.on_audio_data:
                self.on_audio_data(bytestream)
            if stream:
                await asyncio.to_thread(stream.write, bytestream)

    async def get_frames(self):
        if cv2 is None:
            raise RuntimeError(
                "OpenCV (cv2) is not installed. Install it to enable camera mode, or start JODA in web mode."
            )
        cap = await asyncio.to_thread(cv2.VideoCapture, 0, cv2.CAP_AVFOUNDATION)
        while True:
            if self.paused:
                await asyncio.sleep(0.1)
                continue
            frame = await asyncio.to_thread(self._get_frame, cap)
            if frame is None:
                break
            await asyncio.sleep(1.0)
            if self.out_queue:
                await self.out_queue.put(frame)
        cap.release()

    def _get_frame(self, cap):
        ret, frame = cap.read()
        if not ret:
            return None
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = PIL.Image.fromarray(frame_rgb)
        img.thumbnail([1024, 1024])
        image_io = io.BytesIO()
        img.save(image_io, format="jpeg")
        image_io.seek(0)
        image_bytes = image_io.read()
        return {"mime_type": "image/jpeg", "data": base64.b64encode(image_bytes).decode()}

    async def _get_screen(self):
        pass 
    async def get_screen(self):
         pass

    async def run(self, start_message=None):
        retry_delay = 1
        is_reconnect = False
        
        while not self.stop_event.is_set():
            try:
                print(f"[JODA DEBUG] [CONNECT] Connecting to Gemini Live API...")
                async with (
                    client.aio.live.connect(model=MODEL, config=config) as session,
                    asyncio.TaskGroup() as tg,
                ):
                    self.session = session

                    self.audio_in_queue = asyncio.Queue()
                    self.out_queue = asyncio.Queue(maxsize=10)

                    tg.create_task(self.send_realtime())
                    tg.create_task(self.listen_audio())
                    # tg.create_task(self._process_video_queue()) # Removed in favor of VAD

                    if self.video_mode == "camera":
                        tg.create_task(self.get_frames())
                    elif self.video_mode == "screen":
                        tg.create_task(self.get_screen())

                    tg.create_task(self.receive_audio())
                    tg.create_task(self.play_audio())

                    # Handle Startup vs Reconnect Logic
                    if not is_reconnect:
                        if start_message:
                            print(f"[JODA DEBUG] [INFO] Sending start message: {start_message}")
                            await self.session.send(input=start_message, end_of_turn=True)
                        
                        # Sync Project State
                        if self.on_project_update and self.project_manager:
                            self.on_project_update(self.project_manager.current_project)
                    
                    else:
                        print(f"[JODA DEBUG] [RECONNECT] Connection restored.")
                        # Restore Context
                        print(f"[JODA DEBUG] [RECONNECT] Fetching recent chat history to restore context...")
                        history = self.project_manager.get_recent_chat_history(limit=10)
                        
                        context_msg = "System Notification: Connection was lost and just re-established. Here is the recent chat history to help you resume seamlessly:\n\n"
                        for entry in history:
                            sender = entry.get('sender', 'Unknown')
                            text = entry.get('text', '')
                            context_msg += f"[{sender}]: {text}\n"
                        
                        context_msg += "\nPlease acknowledge the reconnection to the user (e.g. 'I lost connection for a moment, but I'm back...') and resume what you were doing."
                        
                        print(f"[JODA DEBUG] [RECONNECT] Sending restoration context to model...")
                        await self.session.send(input=context_msg, end_of_turn=True)

                    # Reset retry delay on successful connection
                    retry_delay = 1
                    
                    # Wait until stop event, or until the session task group exits (which happens on error)
                    # Actually, the TaskGroup context manager will exit if any tasks fail/cancel.
                    # We need to keep this block alive.
                    # The original code just waited on stop_event, but that doesn't account for session death.
                    # We should rely on the TaskGroup raising an exception when subtasks fail (like receive_audio).
                    
                    # However, since receive_audio is a task in the group, if it crashes (connection closed), 
                    # the group will cancel others and exit. We catch that exit below.
                    
                    # We can await stop_event, but if the connection dies, receive_audio crashes -> group closes -> we exit `async with` -> restart loop.
                    # To ensure we don't block indefinitely if connection dies silently (unlikely with receive_audio), we just wait.
                    await self.stop_event.wait()

            except asyncio.CancelledError:
                print(f"[JODA DEBUG] [STOP] Main loop cancelled.")
                break
                
            except Exception as e:
                # This catches the ExceptionGroup from TaskGroup or direct exceptions
                print(f"[JODA DEBUG] [ERR] Connection Error: {e}")
                
                if self.stop_event.is_set():
                    break
                
                print(f"[JODA DEBUG] [RETRY] Reconnecting in {retry_delay} seconds...")
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 10) # Exponential backoff capped at 10s
                is_reconnect = True # Next loop will be a reconnect
                
            finally:
                # Cleanup before retry
                if hasattr(self, 'audio_stream') and self.audio_stream:
                    try:
                        self.audio_stream.close()
                    except: 
                        pass

def get_input_devices():
    p = pyaudio.PyAudio()
    info = p.get_host_api_info_by_index(0)
    numdevices = info.get('deviceCount')
    devices = []
    for i in range(0, numdevices):
        if (p.get_device_info_by_host_api_device_index(0, i).get('maxInputChannels')) > 0:
            devices.append((i, p.get_device_info_by_host_api_device_index(0, i).get('name')))
    p.terminate()
    return devices

def get_output_devices():
    p = pyaudio.PyAudio()
    info = p.get_host_api_info_by_index(0)
    numdevices = info.get('deviceCount')
    devices = []
    for i in range(0, numdevices):
        if (p.get_device_info_by_host_api_device_index(0, i).get('maxOutputChannels')) > 0:
            devices.append((i, p.get_device_info_by_host_api_device_index(0, i).get('name')))
    p.terminate()
    return devices

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        type=str,
        default=DEFAULT_MODE,
        help="pixels to stream from",
        choices=["camera", "screen", "none"],
    )
    args = parser.parse_args()
    main = AudioLoop(video_mode=args.mode)
    asyncio.run(main.run())
