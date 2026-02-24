# JODA Plugin SDK

Extend JODA by adding custom tools, spatial panels, avatar modes, and XR components.

---

## Table of Contents

- [Custom Tools](#custom-tools)
- [Custom Panels](#custom-panels)
- [Custom Avatar Modes](#custom-avatar-modes)
- [Event Hooks](#event-hooks)
- [XR Panels](#xr-panels)

---

## Custom Tools

JODA's AI can call tools during conversation. Tools are defined in Python and registered with Gemini's function-calling API.

### Step 1: Define the Tool Schema

Add a tool declaration to `backend/tools.py`:

```python
get_weather_tool = {
    "name": "get_weather",
    "description": "Get the current weather for a city. Use this when the user asks about weather conditions.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "city": {
                "type": "STRING",
                "description": "The city name, e.g. 'San Francisco'"
            },
            "units": {
                "type": "STRING",
                "description": "Temperature units: 'celsius' or 'fahrenheit'"
            }
        },
        "required": ["city"]
    }
}
```

Then add it to `tools_list`:

```python
tools_list = [{
    "function_declarations": [
        generate_cad_prototype_tool,
        generate_image_tool,
        generate_video_tool,
        write_file_tool,
        read_directory_tool,
        read_file_tool,
        get_weather_tool,  # <-- Add here
    ]
}]
```

### Step 2: Handle the Tool Call

In `backend/server.py`, find the tool execution section and add a handler:

```python
async def handle_tool_call(tool_name, tool_args, sid):
    if tool_name == "get_weather":
        city = tool_args.get("city", "Unknown")
        units = tool_args.get("units", "celsius")

        # Your implementation here
        result = await fetch_weather(city, units)

        return {"weather": result}
```

### Step 3: Test It

Start JODA and say "What's the weather in Tokyo?" — the AI will call your tool and speak the result.

See [examples/weather-tool.py](examples/weather-tool.py) for a complete working example.

---

## Custom Panels

Panels are React components that float in JODA's 3D space. They're rendered as `drei Html` elements anchored to world-space positions.

### Step 1: Create the Component

Create a new file `src/components/StocksWindow.jsx`:

```jsx
import React, { useState, useEffect } from 'react';

export default function StocksWindow({ socket }) {
  const [stocks, setStocks] = useState([]);

  useEffect(() => {
    if (!socket) return;

    socket.on('stocks_update', (data) => {
      setStocks(data.stocks);
    });

    // Request initial data
    socket.emit('get_stocks');

    return () => socket.off('stocks_update');
  }, [socket]);

  return (
    <div className="bg-black/80 backdrop-blur-md rounded-xl p-4 text-white w-80">
      <h2 className="text-lg font-bold mb-3">Stocks</h2>
      <div className="space-y-2">
        {stocks.map((stock) => (
          <div key={stock.symbol} className="flex justify-between">
            <span className="font-mono">{stock.symbol}</span>
            <span className={stock.change > 0 ? 'text-green-400' : 'text-red-400'}>
              ${stock.price.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 2: Register in SpatialPanel

In `src/components/SpatialPanel.jsx`, add a position for your panel:

```javascript
const DEFAULT_POSITIONS = {
  chat:     [-3, 1.5, 0],
  tools:    [0, 0.3, 3],
  media:    [0, 2.5, -1],
  // ... existing positions ...
  stocks:   [-2, 2.5, -2],  // <-- Add your panel position
};
```

Then render it inside the SpatialPanel component alongside other panels.

### Step 3: Wire It Up

Import and render your component in `App.jsx` or `SpatialWorld.jsx`, passing the socket prop.

See [examples/custom-panel.jsx](examples/custom-panel.jsx) for a complete example.

### Panel Position Coordinates

Positions are `[X, Y, Z]` in world space:
- **X**: Left (-) / Right (+)
- **Y**: Down (-) / Up (+), floor is ~0
- **Z**: Behind (-) / In Front (+)

The user stands near the origin facing the -Z direction by default.

---

## Custom Avatar Modes

JODA supports multiple avatar rendering modes via `AvatarSwitch.jsx`. You can add your own.

### Existing Modes

| Mode | Renderer | Description |
|------|----------|-------------|
| `avatar-beautiful` | GLB mesh | Stylized character model |
| `avatar-fullbody` | GLB mesh | Full-body humanoid |
| `avatar-3d` | Procedural | Generated geometry |
| `avatar-holographic` / `avatar-svg` | Html billboard | 2D overlay in 3D space |

### Adding a Mode

In `src/components/AvatarSwitch.jsx`, add a new branch in the mode switch:

```jsx
// Import your avatar component
import RobotAvatar from './RobotAvatar';

// Inside AvatarSwitch render:
function AvatarSwitch({ mode, ...props }) {
  switch (mode) {
    case 'avatar-beautiful':
      return <BeautifulAvatar {...props} />;
    case 'avatar-fullbody':
      return <FullBodyAvatar {...props} />;
    case 'avatar-robot':               // <-- New mode
      return <RobotAvatar {...props} />;
    // ... other modes
  }
}
```

### Avatar Props

Your avatar component will receive these props via RefBridge:

| Prop | Type | Description |
|------|------|-------------|
| `audioData` | `Uint8Array` | Raw audio frequency data (updated 30-60x/sec) |
| `isSpeaking` | `boolean` | Whether the AI is currently speaking |
| `speakingText` | `string` | Current text being spoken |

**Important**: Audio data flows through refs, not state. RefBridge converts refs to scoped state to prevent re-renders in sibling components.

### Example: Robot Avatar

```jsx
import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

export default function RobotAvatar({ audioData, isSpeaking }) {
  const meshRef = useRef();

  useFrame(() => {
    if (!meshRef.current || !audioData) return;
    // Pulse the robot based on audio amplitude
    const avg = audioData.reduce((a, b) => a + b, 0) / audioData.length;
    meshRef.current.scale.setScalar(1 + avg / 512);
  });

  return (
    <group>
      {/* Head */}
      <mesh ref={meshRef} position={[0, 1.6, 0]}>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial
          color={isSpeaking ? '#00ff88' : '#4488ff'}
          emissive={isSpeaking ? '#00ff44' : '#000000'}
          emissiveIntensity={0.5}
        />
      </mesh>
      {/* Body */}
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[0.4, 0.6, 0.25]} />
        <meshStandardMaterial color="#334455" metalness={0.8} />
      </mesh>
    </group>
  );
}
```

---

## Event Hooks

JODA's backend communicates via Socket.IO events. You can listen to and emit custom events from both Python and JavaScript.

### Python (Backend)

Register a new event handler in `backend/server.py`:

```python
@sio.on('my_custom_event')
async def handle_custom(sid, data):
    # Process the event
    result = await do_something(data)

    # Emit response back to the client
    await sio.emit('my_custom_response', {
        'status': 'success',
        'result': result
    }, to=sid)
```

### JavaScript (Frontend)

Listen and emit in your React component:

```javascript
useEffect(() => {
  socket.on('my_custom_response', (data) => {
    console.log('Got response:', data);
  });

  return () => socket.off('my_custom_response');
}, [socket]);

// Emit an event
socket.emit('my_custom_event', { key: 'value' });
```

### Common Events to Hook Into

| Event | Direction | Use Case |
|-------|-----------|----------|
| `status` | Server→Client | Display status messages |
| `ai_response` | Server→Client | React to AI text responses |
| `transcription` | Server→Client | Process user/AI transcriptions |
| `tool_confirmation_request` | Server→Client | Custom confirmation UIs |
| `user_input` | Client→Server | Inject text commands |

See [Events Reference](events-reference.md) for the complete catalog.

---

## XR Panels

For WebXR (VR/AR headsets), `drei Html` doesn't render. Use `XRPanel.jsx` with `@react-three/uikit` instead.

### Creating an XR-Compatible Panel

```jsx
import { Container, Text } from '@react-three/uikit';

export default function MyXRPanel() {
  return (
    <Container
      flexDirection="column"
      padding={20}
      backgroundColor="black"
      backgroundOpacity={0.8}
      borderRadius={12}
    >
      <Text fontSize={18} color="white" fontWeight="bold">
        My XR Panel
      </Text>
      <Text fontSize={14} color="gray">
        This renders natively in WebXR
      </Text>
    </Container>
  );
}
```

### Dual-Path Rendering

For panels that work on both desktop and XR, use a conditional render:

```jsx
import { useXR } from '@react-three/xr';
import { Html } from '@react-three/drei';
import { Container, Text } from '@react-three/uikit';

export default function DualPanel({ children }) {
  const { isPresenting } = useXR();

  if (isPresenting) {
    return (
      <Container padding={20} backgroundColor="black" backgroundOpacity={0.8}>
        <Text fontSize={14} color="white">{children}</Text>
      </Container>
    );
  }

  return (
    <Html transform>
      <div className="bg-black/80 p-4 text-white rounded-xl">
        {children}
      </div>
    </Html>
  );
}
```

### XR Input (Coming in V2)

Hand and controller interaction with XR panels is planned for V2. Currently, XR panels are display-only.
