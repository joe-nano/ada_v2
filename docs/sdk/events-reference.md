# JODA Socket.IO Events Reference

Complete catalog of all Socket.IO events in the JODA backend. Extracted from `backend/server.py`.

---

## Client → Server Events

### Core Connection

| Event | Payload | Description |
|-------|---------|-------------|
| `connect` | *(automatic)* | Client connects. Server initializes session, starts authenticator and scheduler. |
| `disconnect` | *(automatic)* | Client disconnects. Server cleans up histories, secrets, and mic state. |
| `shutdown` | *none* | Graceful server shutdown. Stops audio loop, authenticator, and terminates process. |

### Audio & Voice

| Event | Payload | Description |
|-------|---------|-------------|
| `start_audio` | `{device_index?, device_name?, audio_source?}` | Start the Gemini Live audio session. Validates face auth if enabled. |
| `stop_audio` | *none* | Stop the audio session and clean up. |
| `pause_audio` | *none* | Pause audio input (mute). |
| `resume_audio` | *none* | Resume paused audio input. |
| `mic_audio_chunk` | `ArrayBuffer` or `{data, sample_rate}` | Raw PCM audio chunk from browser mic. Resampled to 16kHz if needed. |
| `video_frame` | `{image}` (base64 or binary) | Video frame for face auth or visual context. |

### User Input & Commands

| Event | Payload | Description |
|-------|---------|-------------|
| `user_input` | `{text}` | Text input. Handles slash commands (`/projects`, `/ralph`, `/skills`, `/scheduler`). |
| `confirm_tool` | `{id, confirmed}` | Approve or deny a tool execution request from the AI. |

### CAD Generation

| Event | Payload | Description |
|-------|---------|-------------|
| `generate_cad` | `{prompt}` | Generate a 3D CAD model from a text description. |
| `iterate_cad` | `{prompt}` | Refine the current CAD design with new instructions. |

### Web Automation

| Event | Payload | Description |
|-------|---------|-------------|
| `run_web_agent` | `{prompt}` | Run the Playwright web agent with a task. |
| `run_browser_use` | `{prompt}` | Run browser-use wrapper (falls back to Playwright). |
| `prompt_web_agent` | `{prompt}` | Send a prompt directly to the web agent. |

### Ralph Orchestrator

| Event | Payload | Description |
|-------|---------|-------------|
| `ralph_run` | `{project, prompt}` | Run Ralph against a project folder. Returns project list if project is empty. |
| `ralph_list_projects` | *none* | List available Ralph project folders. |

### Projects

| Event | Payload | Description |
|-------|---------|-------------|
| `list_joda_projects` | *none* | List JODA internal project folders via ProjectManager. |

### Memory

| Event | Payload | Description |
|-------|---------|-------------|
| `save_memory` | `{messages?, filename?}` | Save conversation to long-term memory file. |
| `upload_memory` | `{memory}` (text) | Load a memory context into the active session. |

### Scheduler

| Event | Payload | Description |
|-------|---------|-------------|
| `scheduler_list` | *none* | List all scheduled jobs. |
| `scheduler_create` | `{name, schedule_type, interval_minutes? or cron?, task_type, payload}` | Create a new scheduled job. `schedule_type`: `"interval"` or `"cron"`. |
| `scheduler_delete` | `{id}` | Delete a scheduled job. |
| `scheduler_run_now` | `{id}` | Trigger a scheduled job immediately. |
| `scheduler_set_enabled` | `{id, enabled}` | Enable or disable a scheduled job. |

### 3D Printing

| Event | Payload | Description |
|-------|---------|-------------|
| `discover_printers` | *none* | Discover 3D printers on the network. Falls back to saved printers. |
| `add_printer` | `{host, name?, type?, camera_url?}` | Manually add a printer and probe its type. |
| `print_stl` | `{stl_path, printer?, profile?}` | Slice and send an STL file to a printer. |
| `get_slicer_profiles` | *none* | Get available OrcaSlicer profiles. |

### Smart Home (Kasa)

| Event | Payload | Description |
|-------|---------|-------------|
| `discover_kasa` | *none* | Discover TP-Link Kasa devices on the network. |
| `control_kasa` | `{ip, action, value?}` | Control a device. Actions: `"on"`, `"off"`, `"brightness"`, `"color"`. |

### Authentication

| Event | Payload | Description |
|-------|---------|-------------|
| `set_browser_secrets` | `{username, password}` | Store session-only browser credentials (memory-only, never persisted). |
| `clear_browser_secrets` | *none* | Clear stored browser credentials. |

### Settings

| Event | Payload | Description |
|-------|---------|-------------|
| `get_settings` | *none* | Retrieve current settings. |
| `update_settings` | `{tool_permissions?, face_auth_enabled?, camera_flipped?}` | Update runtime settings. |
| `get_tool_permissions` | *none* | Get tool permissions (legacy endpoint). |
| `update_tool_permissions` | `{...permissions}` | Update tool permissions (legacy endpoint). |

### Agents

| Event | Payload | Description |
|-------|---------|-------------|
| `deploy_agent` | `{type, name, config}` | Deploy a new agent. Types: `freqtrade`, `hummingbot`, `rl_trading`, `arbitrage`, `data_collector`. |
| `list_agents` | `{status?}` | List all agents, optionally filtered by status. |
| `get_agent_status` | `{agent_id}` | Get status of a specific agent. |
| `stop_agent` | `{agent_id}` | Stop a running agent. |
| `pause_agent` | `{agent_id}` | Pause a running agent. |
| `resume_agent` | `{agent_id}` | Resume a paused agent. |
| `restart_agent` | `{agent_id}` | Restart an agent. |
| `get_agent_stats` | *none* | Get aggregate statistics across all agents. |
| `get_consolidated_report` | *none* | Get a consolidated report from all agents. |

### MCP (Model Context Protocol)

| Event | Payload | Description |
|-------|---------|-------------|
| `list_mcp_tools` | `{agent_type?}` | List available MCP tools, optionally filtered by agent type. |
| `call_mcp_tool` | `{agent_id, tool_name, arguments}` | Execute an MCP tool from a specific agent. |
| `get_agent_tools` | `{agent_id}` | Get the tool list for a specific agent. |
| `get_mcp_servers` | *none* | List connected MCP servers. |

---

## Server → Client Events

### General

| Event | Payload | Description |
|-------|---------|-------------|
| `status` | `string` or `{message}` | Status update during any operation. |
| `error` | `string` or `{message}` | Error message from any operation. |

### Audio & Voice

| Event | Payload | Description |
|-------|---------|-------------|
| `audio_data` | `ArrayBuffer` | PCM audio data from the AI voice. |
| `transcription` | `{text, ...}` | Transcribed speech (user or AI). |

### AI Responses

| Event | Payload | Description |
|-------|---------|-------------|
| `tool_confirmation_request` | `{id, tool_name, tool_args}` | AI requests permission to run a tool. Respond with `confirm_tool`. |
| `agent_feedback` | `{message, ...}` | Feedback from an agent during processing. |

### Authentication

| Event | Payload | Description |
|-------|---------|-------------|
| `auth_status` | `{authenticated, ...}` | Face authentication status change. |
| `auth_frame` | `{image}` | Camera frame during face auth process. |

### CAD

| Event | Payload | Description |
|-------|---------|-------------|
| `cad_data` | `{stl?, geometry?, ...}` | Generated CAD geometry/STL data. |
| `cad_status` | `{status, message?}` | CAD generation progress. |

### Browser

| Event | Payload | Description |
|-------|---------|-------------|
| `browser_frame` | `{image, logs?}` | Browser screenshot and console logs. |

### Smart Home

| Event | Payload | Description |
|-------|---------|-------------|
| `kasa_devices` | `[{ip, name, type, ...}]` | List of discovered Kasa devices. |
| `kasa_update` | `{ip, state, ...}` | Device state change after control command. |

### Printing

| Event | Payload | Description |
|-------|---------|-------------|
| `printer_list` | `[{name, host, type, ...}]` | Discovered/saved printers. |
| `slicing_progress` | `{progress, ...}` | OrcaSlicer progress update. |
| `slicer_profiles` | `[{name, ...}]` | Available slicer profiles. |
| `print_result` | `{status, ...}` | Print job result. |
| `print_status_update` | `{status, progress?, ...}` | Ongoing print status. |

### Scheduler

| Event | Payload | Description |
|-------|---------|-------------|
| `scheduler_jobs` | `[{id, name, schedule_type, ...}]` | List of all scheduled jobs. |

### Agents

| Event | Payload | Description |
|-------|---------|-------------|
| `agents_list` | `[{id, name, type, status, ...}]` | All agents and their states. |
| `agent_deployed` | `{id, name, type, ...}` | Agent successfully deployed. |
| `agent_stopped` | `{id, ...}` | Agent stopped. |
| `agent_paused` | `{id, ...}` | Agent paused. |
| `agent_resumed` | `{id, ...}` | Agent resumed. |
| `agent_restarted` | `{id, ...}` | Agent restarted. |
| `agent_status` | `{id, status, ...}` | Single agent status. |
| `agent_stats` | `{total, running, ...}` | Aggregate agent statistics. |
| `consolidated_report` | `{...}` | Report from all agents. |

### MCP

| Event | Payload | Description |
|-------|---------|-------------|
| `mcp_tools_list` | `[{name, description, ...}]` | Available MCP tools. |
| `mcp_tool_result` | `{tool_name, result, ...}` | Result of an MCP tool call. |
| `agent_tools` | `[{name, ...}]` | Tools available to a specific agent. |
| `mcp_servers` | `[{name, url, ...}]` | Connected MCP servers. |

### Projects

| Event | Payload | Description |
|-------|---------|-------------|
| `joda_projects` | `[{name, path, ...}]` | JODA project list. |
| `ralph_projects` | `[{name, ...}]` | Ralph project list. |
| `project_update` | `{...}` | Project state change notification. |

### Settings

| Event | Payload | Description |
|-------|---------|-------------|
| `settings` | `{tool_permissions, face_auth_enabled, ...}` | Current settings state. |
| `tool_permissions` | `{...}` | Tool permissions (legacy). |
