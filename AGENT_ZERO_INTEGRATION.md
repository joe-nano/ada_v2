# J.O.D.A ↔ Agent Zero Integration

## Overview

J.O.D.A can now communicate with Agent Zero running in Docker containers. This allows J.O.D.A to orchestrate Agent Zero by sending it natural language instructions and receiving responses.

## Architecture

```
J.O.D.A Backend (port 8765)
    ↓ HTTP/WebSocket
Agent Zero Chat Interface
    ↓ HTTP API /message_async
Agent Zero Container (port 50001)
```

## Features

- ✅ **Send Instructions**: J.O.D.A can send natural language commands to Agent Zero
- ✅ **Receive Responses**: Get Agent Zero's output and execution results
- ✅ **Container Management**: Start, stop, list Agent Zero instances
- ✅ **Multi-Instance Support**: Run multiple Agent Zero containers on different ports
- ✅ **Socket.IO Integration**: Real-time communication from J.O.D.A's frontend

## API Endpoints

### 1. Get Agent Zero Status

**Endpoint**: `GET /api/agent-zero/status`

**Response**:
```json
{
  "success": true,
  "instances": [
    {
      "name": "joda-agent-zero-50001",
      "image": "agent0ai/agent-zero",
      "ports": "0.0.0.0:50001->80/tcp",
      "status": "Up 21 minutes"
    }
  ],
  "count": 1
}
```

### 2. Start Agent Zero Instance

**Endpoint**: `POST /api/agent-zero/start`

**Parameters**:
- `port` (optional): Host port to use (default: auto-assigns starting from 50001)

**Example**:
```bash
curl -X POST http://localhost:8765/api/agent-zero/start?port=50001
```

**Response**:
```json
{
  "success": true,
  "instance": {
    "name": "joda-agent-zero-50001",
    "port": 50001,
    "url": "http://localhost:50001"
  }
}
```

### 3. Stop Agent Zero Instance

**Endpoint**: `POST /api/agent-zero/stop`

**Parameters**:
- `name` (required): Container name

**Example**:
```bash
curl -X POST http://localhost:8765/api/agent-zero/stop?name=joda-agent-zero-50001
```

### 4. Send Instruction to Agent Zero (Main Feature!)

**Endpoint**: `POST /api/agent-zero/message`

**Body**:
```json
{
  "instruction": "Analyze the Bitcoin price trends",
  "port": 50001
}
```

**Example**:
```bash
curl -X POST http://localhost:8765/api/agent-zero/message \
  -H "Content-Type: application/json" \
  -d '{"instruction": "Hello Agent Zero, what can you do?", "port": 50001}'
```

**Response**:
```json
{
  "success": true,
  "response": "Agent Zero response here...",
  "method": "http"
}
```

## Socket.IO Events

### From Frontend to Backend

**Event**: `agent_zero_instruction`

**Data**:
```javascript
{
  "instruction": "your instruction here",
  "port": 50001  // optional, defaults to 50001
}
```

**Example (JavaScript)**:
```javascript
socket.emit('agent_zero_instruction', {
  instruction: 'Analyze the stock market',
  port: 50001
});
```

### From Backend to Frontend

**Event**: `agent_zero_response`

**Data**:
```javascript
{
  "instruction": "the original instruction",
  "response": "Agent Zero's response",
  "port": 50001
}
```

**Event**: `agent_zero_error`

**Data**:
```javascript
{
  "instruction": "the original instruction",
  "error": "error message",
  "suggestion": "how to fix"
}
```

## Python Usage (Backend)

```python
from agent_zero_chat import send_to_agent_zero

# Send instruction to Agent Zero
result = await send_to_agent_zero(
    instruction="Research Bitcoin price trends",
    port=50001
)

if result['success']:
    print(f"Agent Zero responded: {result['response']}")
else:
    print(f"Error: {result['error']}")
```

## How It Works

### 1. Communication Flow

```
User → J.O.D.A Frontend → Socket.IO → J.O.D.A Backend
                                           ↓
                                    Agent Zero Chat Interface
                                           ↓
                                    HTTP POST /message_async
                                           ↓
                                    Agent Zero Container
                                           ↓
                                    Response ← ← ← ← ←
```

### 2. Fallback Methods

The Agent Zero chat interface tries multiple communication methods:

1. **HTTP POST to `/message_async`** (Agent Zero's actual endpoint) - Primary method
2. **WebSocket** - If HTTP fails
3. **Docker Exec** - Direct container interaction (fallback)

### 3. Container Management

Agent Zero instances are managed by `AgentZeroManager`:
- Docker containers with label `joda.agent=agent-zero`
- Auto-restart enabled
- Port mapping: host port → container port 80
- State persisted in `$JODA_PROJECT_ROOT/.joda/agent_zero/instances.json`

## Use Cases

### 1. Delegate Complex Tasks

```javascript
// From J.O.D.A frontend
socket.emit('agent_zero_instruction', {
  instruction: 'Research the top 10 AI companies and create a report',
  port: 50001
});
```

### 2. Multi-Agent Coordination

```bash
# Start multiple Agent Zero instances
curl -X POST http://localhost:8765/api/agent-zero/start?port=50001
curl -X POST http://localhost:8765/api/agent-zero/start?port=50002

# Send different tasks to each
curl -X POST http://localhost:8765/api/agent-zero/message \
  -H "Content-Type: application/json" \
  -d '{"instruction": "Monitor Bitcoin price", "port": 50001}'

curl -X POST http://localhost:8765/api/agent-zero/message \
  -H "Content-Type: application/json" \
  -d '{"instruction": "Monitor Ethereum price", "port": 50002}'
```

### 3. Integration with J.O.D.A Tools

Agent Zero can be integrated into J.O.D.A's tool system for seamless orchestration.

## Troubleshooting

### Agent Zero not accessible

```bash
# Check if container is running
docker ps | grep agent-zero

# Check container logs
docker logs joda-agent-zero-50001

# Restart container
docker restart joda-agent-zero-50001
```

### Communication fails

```bash
# Test Agent Zero web interface directly
curl http://localhost:50001

# Test message endpoint directly
curl -X POST http://localhost:50001/message_async \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello"}'
```

### Port conflicts

```bash
# List all Agent Zero instances
curl http://localhost:8765/api/agent-zero/status

# Stop conflicting instance
curl -X POST http://localhost:8765/api/agent-zero/stop?name=joda-agent-zero-50001

# Start on different port
curl -X POST http://localhost:8765/api/agent-zero/start?port=50002
```

## Configuration

### Environment Variables

- `JODA_PROJECT_ROOT`: Base path for biz_automate projects (default: `/home/yoda_external_storage_server/biz_automate`)
- `AGENT_ZERO_IMAGE`: Docker image to use (default: `agent0ai/agent-zero`)
- `AGENT_ZERO_BASE_PORT`: Starting port for instances (default: `50001`)
- `AGENT_ZERO_NAME_PREFIX`: Container name prefix (default: `joda-agent-zero`)

### Example `.env`:

```bash
JODA_PROJECT_ROOT=/root/Desktop/biz_automate
AGENT_ZERO_IMAGE=agent0ai/agent-zero
AGENT_ZERO_BASE_PORT=50001
```

## Next Steps

1. **Frontend UI**: Add Agent Zero chat panel to J.O.D.A frontend
2. **Tool Integration**: Make Agent Zero accessible as a J.O.D.A tool
3. **Persistent History**: Store Agent Zero conversations
4. **Status Monitoring**: Real-time Agent Zero task status in J.O.D.A UI
5. **Named Tunnels**: Expose Agent Zero via Cloudflare tunnels for remote access

## Current Status

✅ Backend endpoints registered and working
✅ Agent Zero container running on port 50001
✅ HTTP communication functional
✅ Docker container management working
⏳ Frontend UI integration (pending)
⏳ WebSocket real-time communication (pending testing)

## Example Session

```bash
# 1. Check Agent Zero status
$ curl http://localhost:8765/api/agent-zero/status
{"success":true,"instances":[...],"count":1}

# 2. Send instruction
$ curl -X POST http://localhost:8765/api/agent-zero/message \
  -H "Content-Type: application/json" \
  -d '{"instruction": "What are you capable of?", "port": 50001}'

{"success":true,"response":"...Agent Zero capabilities...","method":"http"}

# 3. View Agent Zero web interface
$ open http://localhost:50001
```

J.O.D.A now has full bidirectional communication with Agent Zero! 🎉
