# JODA Client SDK

Connect to JODA from any application using Socket.IO. Send messages, trigger tools, stream audio, and subscribe to state updates.

---

## Table of Contents

- [Connecting](#connecting)
- [Sending Messages](#sending-messages)
- [Receiving Responses](#receiving-responses)
- [Triggering Tools](#triggering-tools)
- [Subscribing to State](#subscribing-to-state)
- [Audio Streaming](#audio-streaming)
- [Full Event Reference](#full-event-reference)

---

## Connecting

JODA's backend runs a Socket.IO server on port 8765.

### JavaScript

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8765', {
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
});

socket.on('connect', () => {
  console.log('Connected to JODA:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

socket.on('error', (data) => {
  console.error('JODA error:', data.message || data);
});
```

### Python

```python
import socketio

sio = socketio.AsyncClient()

@sio.on('connect')
async def on_connect():
    print('Connected to JODA')

@sio.on('error')
async def on_error(data):
    print(f'Error: {data}')

async def main():
    await sio.connect('http://localhost:8765', transports=['websocket'])
    await sio.wait()
```

### Connection Notes

- **Transport**: WebSocket is recommended. Long-polling works but adds latency.
- **CORS**: The server allows all origins by default.
- **Single session**: Only one active voice session per backend instance. Multiple clients can connect, but only one can stream audio at a time.

---

## Sending Messages

### Text Input

Send a text message for the AI to process:

```javascript
socket.emit('user_input', { text: 'Design a box that is 50mm wide' });
```

The AI will process your message and respond via `transcription`, `status`, and potentially trigger tool calls.

### Slash Commands

Slash commands are processed by `user_input` before reaching the AI:

```javascript
socket.emit('user_input', { text: '/projects' });        // List projects
socket.emit('user_input', { text: '/ralph myapp fix bugs' }); // Run Ralph
socket.emit('user_input', { text: '/scheduler' });        // List scheduled jobs
socket.emit('user_input', { text: '/skills' });           // List browser skills
```

---

## Receiving Responses

### AI Text Responses

```javascript
// Transcription events (both user and AI speech)
socket.on('transcription', (data) => {
  // data may include transcribed text from user or AI
  console.log('Transcription:', data);
});

// Status updates during processing
socket.on('status', (data) => {
  console.log('Status:', data);
});
```

### Tool Confirmation Requests

When the AI wants to execute a tool that requires confirmation:

```javascript
socket.on('tool_confirmation_request', (data) => {
  // data: { id, tool_name, tool_args }
  console.log(`AI wants to run: ${data.tool_name}`);

  // Approve or deny
  socket.emit('confirm_tool', { id: data.id, confirmed: true });
});
```

### Agent Feedback

```javascript
socket.on('agent_feedback', (data) => {
  console.log('Agent says:', data);
});
```

---

## Triggering Tools

You can directly invoke JODA's tools without going through the AI conversation.

### CAD Generation

```javascript
// Generate a new design
socket.emit('generate_cad', { prompt: 'A spur gear with 24 teeth and module 2' });

// Iterate on existing design
socket.emit('iterate_cad', { prompt: 'Make it 5mm thicker' });

// Listen for results
socket.on('cad_data', (data) => {
  // data contains STL geometry
  console.log('CAD ready:', data);
});

socket.on('cad_status', (data) => {
  console.log('CAD status:', data);
});
```

### Web Automation

```javascript
socket.emit('run_web_agent', { prompt: 'Go to github.com and search for JODA' });
socket.emit('run_browser_use', { prompt: 'Fill out the contact form' });

socket.on('browser_frame', (data) => {
  // data: { image } — screenshot as base64
  console.log('Browser screenshot received');
});
```

### Smart Home

```javascript
// Discover devices
socket.emit('discover_kasa');

socket.on('kasa_devices', (data) => {
  console.log('Found devices:', data);
});

// Control a device
socket.emit('control_kasa', {
  ip: '192.168.1.100',
  action: 'on'              // 'on', 'off', 'brightness', 'color'
});

// With brightness
socket.emit('control_kasa', {
  ip: '192.168.1.100',
  action: 'brightness',
  value: 50                  // 0-100
});
```

### 3D Printing

```javascript
// Discover printers
socket.emit('discover_printers');

socket.on('printer_list', (data) => {
  console.log('Printers:', data);
});

// Print an STL
socket.emit('print_stl', {
  stl_path: '/path/to/model.stl',
  printer: 'BambuLab X1',    // optional
  profile: 'PLA Standard'     // optional
});

socket.on('slicing_progress', (data) => {
  console.log('Slicing:', data);
});

socket.on('print_result', (data) => {
  console.log('Print started:', data);
});
```

### Agents

```javascript
// Deploy an agent
socket.emit('deploy_agent', {
  type: 'freqtrade',
  name: 'btc-scalper',
  config: { /* agent-specific config */ }
});

socket.on('agent_deployed', (data) => {
  console.log('Agent deployed:', data);
});

// List all agents
socket.emit('list_agents', {});

socket.on('agents_list', (data) => {
  console.log('Agents:', data);
});

// Control an agent
socket.emit('stop_agent', { agent_id: 'abc123' });
socket.emit('pause_agent', { agent_id: 'abc123' });
socket.emit('resume_agent', { agent_id: 'abc123' });
```

### Scheduler

```javascript
// Create a scheduled job
socket.emit('scheduler_create', {
  name: 'Daily Report',
  schedule_type: 'cron',
  cron: '0 9 * * *',          // Every day at 9am
  task_type: 'text_command',
  payload: { text: 'Generate my daily summary' }
});

// Or with interval
socket.emit('scheduler_create', {
  name: 'Check Prices',
  schedule_type: 'interval',
  interval_minutes: 30,
  task_type: 'text_command',
  payload: { text: 'Check BTC price' }
});

// List jobs
socket.emit('scheduler_list');
socket.on('scheduler_jobs', (data) => console.log(data));

// Run immediately
socket.emit('scheduler_run_now', { id: 'job-id' });

// Delete
socket.emit('scheduler_delete', { id: 'job-id' });
```

### MCP Tools

```javascript
// List available MCP tools
socket.emit('list_mcp_tools', {});

socket.on('mcp_tools_list', (data) => {
  console.log('MCP tools:', data);
});

// Call an MCP tool
socket.emit('call_mcp_tool', {
  agent_id: 'agent-id',
  tool_name: 'search_web',
  arguments: { query: 'JODA AI assistant' }
});

socket.on('mcp_tool_result', (data) => {
  console.log('Tool result:', data);
});
```

---

## Subscribing to State

### Settings

```javascript
socket.emit('get_settings');

socket.on('settings', (data) => {
  console.log('Current settings:', data);
});

// Update settings
socket.emit('update_settings', {
  face_auth_enabled: false,
  camera_flipped: true
});
```

### Authentication Status

```javascript
socket.on('auth_status', (data) => {
  console.log('Auth status:', data);
});
```

### Printer Status

```javascript
socket.on('print_status_update', (data) => {
  console.log('Print progress:', data);
});
```

---

## Audio Streaming

### Starting the Audio Session

```javascript
// Start the audio loop (enables AI voice)
socket.emit('start_audio', {
  audio_source: 'browser'    // optional
});

// Pause/resume
socket.emit('pause_audio');
socket.emit('resume_audio');

// Stop
socket.emit('stop_audio');
```

### Sending Audio from the Browser

Stream microphone audio as PCM chunks:

```javascript
const audioContext = new AudioContext({ sampleRate: 16000 });
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const source = audioContext.createMediaStreamSource(stream);
const processor = audioContext.createScriptProcessor(4096, 1, 1);

source.connect(processor);
processor.connect(audioContext.destination);

processor.onaudioprocess = (e) => {
  const pcmData = e.inputBuffer.getChannelData(0);
  const int16 = new Int16Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, pcmData[i] * 32768));
  }
  socket.emit('mic_audio_chunk', int16.buffer);
};
```

### Receiving Audio

```javascript
socket.on('audio_data', (data) => {
  // Binary PCM audio data from the AI
  // Play it back through the Web Audio API
  playAudio(data);
});
```

### Sending Video Frames

For face authentication or visual context:

```javascript
// Send a video frame (base64 JPEG or binary)
socket.emit('video_frame', { image: base64ImageData });
```

---

## Full Event Reference

See [events-reference.md](events-reference.md) for the complete catalog of all Socket.IO events with payload schemas.

---

## Examples

- **[remote-client.js](examples/remote-client.js)** — Minimal Node.js client that connects, sends a message, and prints the response
- **[weather-tool.py](examples/weather-tool.py)** — Python example of adding a custom tool

---

## Tips

- **Reconnection**: The Socket.IO client handles reconnection automatically. Use `reconnection: true` in options.
- **Error handling**: Always listen for the `error` event — most operations emit errors there.
- **Status flow**: Operations typically emit `status` messages during processing, then a specific result event on completion.
- **Binary data**: Audio chunks are sent as binary ArrayBuffers, not JSON. Socket.IO handles the serialization.
- **Multiple listeners**: You can have multiple clients connected simultaneously for monitoring, but only one can own the audio session.
