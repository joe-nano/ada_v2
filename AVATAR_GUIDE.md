# JODA Avatar System Guide

## Overview

JODA's avatar system provides 4 distinct visual representations that can talk and interact with users in real-time. Each avatar type offers different aesthetics and performance characteristics.

---

## Avatar Options

### 1. 🌀 **Holographic Avatar** (Default - Recommended)
**Type**: `holographic`

**Features**:
- Futuristic holographic appearance with scan lines
- Animated waveform mouth that responds to audio levels
- Orbiting particles and glowing effects
- Status indicators (TRANSMITTING/LISTENING)
- Very lightweight and performant

**Best For**: Modern, sci-fi aesthetic; minimal resource usage

**Visual Style**: Think J.A.R.V.I.S. from Iron Man meets modern AI interfaces

---

### 2. 🎨 **Animated SVG Avatar** (Minimalist)
**Type**: `svg`

**Features**:
- Clean 2D animated face
- Blinking eyes with natural timing
- Mouth animations synchronized to speech
- Multiple emotional states (neutral, happy, thinking, alert)
- Smooth glow effects and voice indicator rings
- Extremely lightweight

**Best For**: Clean, professional look; low bandwidth; accessibility

**Emotional States**:
- `neutral` - Default calm expression
- `happy` - Smiling, upbeat
- `thinking` - Focused, processing
- `alert` - Attentive, active

---

### 3. 🎯 **Custom 3D Avatar** (Built-in)
**Type**: `3d`

**Features**:
- Simple geometric 3D head with body
- Glowing cyan eyes
- Animated mouth based on audio levels
- Metallic, robotic appearance
- Interactive (can be rotated with mouse)

**Best For**: 3D immersion without external assets; customizable

**Performance**: Medium (uses Three.js rendering)

---

### 4. 👤 **Ready Player Me Avatar** (Photorealistic)
**Type**: `rpm`

**Features**:
- Fully customizable photorealistic 3D avatar
- Professional lip-sync and facial animations
- Wide variety of customization options
- Industry-standard GLB format

**Best For**: Personalized, human-like appearance; professional presentations

**Setup Required**: Create avatar at https://readyplayer.me/

**Performance**: Higher resource usage (detailed 3D model)

---

## Installation

### Install Required Dependencies (if not already present)

```bash
npm install @react-three/fiber @react-three/drei three framer-motion
```

All dependencies should already be installed in your project.

---

## Basic Usage

### 1. Import the Avatar Component

```jsx
import JodaAvatar from './components/JodaAvatar';
```

### 2. Add to Your UI

```jsx
function App() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  return (
    <div className="avatar-container">
      <JodaAvatar
        type="holographic"
        isSpeaking={isSpeaking}
        audioLevel={audioLevel}
        emotion="neutral"
      />
    </div>
  );
}
```

---

## Integration with JODA's Voice System

### Connect to Audio Stream

```jsx
import { useEffect, useState } from 'react';
import JodaAvatar from './components/JodaAvatar';

function JodaInterface() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [emotion, setEmotion] = useState('neutral');

  useEffect(() => {
    // Listen for audio data from Socket.IO
    socket.on('audio_data', (data) => {
      setIsSpeaking(true);

      // Calculate audio level from audio chunk
      const level = calculateAudioLevel(data.audio);
      setAudioLevel(level);
    });

    socket.on('audio_end', () => {
      setIsSpeaking(false);
      setAudioLevel(0);
    });

    // Listen for transcription to determine emotion
    socket.on('transcription', (data) => {
      if (data.sender === 'JODA') {
        // Analyze sentiment and set emotion
        const detectedEmotion = analyzeEmotion(data.text);
        setEmotion(detectedEmotion);
      }
    });

    return () => {
      socket.off('audio_data');
      socket.off('audio_end');
      socket.off('transcription');
    };
  }, []);

  return (
    <JodaAvatar
      type="holographic"
      isSpeaking={isSpeaking}
      audioLevel={audioLevel}
      emotion={emotion}
    />
  );
}

// Calculate audio level from PCM data
function calculateAudioLevel(audioData) {
  if (!audioData) return 0;

  // Convert base64 to array buffer
  const buffer = Buffer.from(audioData, 'base64');
  const pcm = new Int16Array(buffer.buffer);

  // Calculate RMS (Root Mean Square) for audio level
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const normalized = pcm[i] / 32768;
    sum += normalized * normalized;
  }

  const rms = Math.sqrt(sum / pcm.length);
  return Math.min(rms * 3, 1); // Normalize to 0-1 range
}

// Simple sentiment analysis
function analyzeEmotion(text) {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('error') || lowerText.includes('failed')) {
    return 'alert';
  }

  if (lowerText.includes('think') || lowerText.includes('processing')) {
    return 'thinking';
  }

  if (lowerText.includes('great') || lowerText.includes('success') || lowerText.includes('done')) {
    return 'happy';
  }

  return 'neutral';
}
```

---

## Props Reference

### JodaAvatar Component Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `string` | `'holographic'` | Avatar type: `'holographic'`, `'svg'`, `'3d'`, `'rpm'` |
| `isSpeaking` | `boolean` | `false` | Whether JODA is currently speaking |
| `audioLevel` | `number` | `0` | Audio amplitude (0-1) for mouth animation |
| `emotion` | `string` | `'neutral'` | Emotional state (only for SVG type): `'neutral'`, `'happy'`, `'thinking'`, `'alert'` |
| `rpmAvatarUrl` | `string` | `null` | URL to Ready Player Me GLB model (required for `type='rpm'`) |
| `onTypeChange` | `function` | `null` | Callback when user switches avatar type |

---

## Advanced: Ready Player Me Integration

### Step 1: Create Your Avatar

1. Go to https://readyplayer.me/
2. Customize your avatar (male appearance recommended for JODA)
3. Copy the GLB URL when done

### Step 2: Use the URL

```jsx
<JodaAvatar
  type="rpm"
  rpmAvatarUrl="https://models.readyplayer.me/[your-avatar-id].glb"
  isSpeaking={isSpeaking}
  audioLevel={audioLevel}
/>
```

### Step 3: Advanced Lip Sync

For better lip-sync with Ready Player Me avatars, you can use morph targets:

```jsx
// In ReadyPlayerMeAvatar component
useEffect(() => {
  if (meshRef.current && isSpeaking) {
    const head = meshRef.current.getObjectByName('Wolf3D_Head');

    if (head && head.morphTargetInfluences) {
      // RPM standard morph targets
      const mouthOpenIndex = head.morphTargetDictionary['mouthOpen'];
      const mouthSmileIndex = head.morphTargetDictionary['mouthSmile'];

      head.morphTargetInfluences[mouthOpenIndex] = audioLevel * 0.8;
      head.morphTargetInfluences[mouthSmileIndex] = 0.2;
    }
  }
}, [isSpeaking, audioLevel]);
```

---

## Customization Examples

### Change Colors

```jsx
// Holographic avatar - edit in JodaAvatar.jsx
className="border-2 border-cyan-400"  // Change to border-purple-400
className="bg-cyan-400"                // Change to bg-purple-400
```

### Adjust Animation Speed

```jsx
// SVG avatar blinking
transition={{ duration: 3, repeat: Infinity, repeatDelay: 2 }}
// Change to duration: 2 for faster blinking
```

### Add Custom Emotions

```jsx
const emotions = {
  neutral: { eyeY: 45, mouthPath: "M 40 70 Q 50 75 60 70" },
  happy: { eyeY: 42, mouthPath: "M 35 65 Q 50 80 65 65" },
  // Add your own:
  excited: { eyeY: 40, mouthPath: "M 30 60 Q 50 85 70 60" },
  concerned: { eyeY: 48, mouthPath: "M 40 75 Q 50 70 60 75" },
};
```

---

## Performance Optimization

### Tips for Best Performance

1. **Use Holographic or SVG** for low-end devices
2. **Limit 3D avatars** to one instance (don't render multiple)
3. **Disable OrbitControls** if not needed: Remove `<OrbitControls />` component
4. **Reduce particle count** in holographic mode
5. **Lower animation frame rate** on battery-powered devices

### Performance Monitoring

```jsx
import { Perf } from 'r3f-perf';

// In Canvas component
<Canvas>
  <Perf position="top-left" />
  {/* Your avatar */}
</Canvas>
```

---

## Troubleshooting

### Avatar Not Showing

**Issue**: Black screen or nothing renders

**Solutions**:
- Check browser console for errors
- Ensure all dependencies are installed
- Verify component is inside proper container with height/width

### RPM Avatar Not Loading

**Issue**: Ready Player Me avatar shows error

**Solutions**:
- Verify GLB URL is accessible (open in browser)
- Check CORS settings
- Ensure URL ends with `.glb`
- Try a different avatar from RPM

### Poor Performance

**Issue**: Laggy or slow animations

**Solutions**:
- Switch to `holographic` or `svg` type
- Reduce canvas resolution: `<Canvas dpr={[1, 1.5]} />`
- Disable shadows and complex lighting
- Close other 3D applications

---

## Future Enhancements

Planned features:

- [ ] **Advanced Lip-Sync**: Phoneme-based mouth shapes using Rhubarb Lip Sync
- [ ] **Facial Expressions**: More nuanced emotions based on conversation context
- [ ] **Eye Tracking**: Follow cursor or webcam-detected face
- [ ] **Gesture System**: Hand and body gestures during explanations
- [ ] **Voice-Matched Avatars**: Different visual styles based on voice characteristics
- [ ] **Custom Backgrounds**: Holographic environments, tech labs, space stations
- [ ] **VRM Support**: VRoid/VRM avatar format for anime-style characters
- [ ] **Accessibility**: High contrast mode, reduced motion options

---

## Examples Gallery

### Example 1: Floating Avatar Window

```jsx
<motion.div
  className="fixed top-20 right-4 w-64 h-64 rounded-lg overflow-hidden shadow-2xl"
  drag
  dragMomentum={false}
>
  <JodaAvatar type="holographic" isSpeaking={isSpeaking} audioLevel={audioLevel} />
</motion.div>
```

### Example 2: Fullscreen Presentation Mode

```jsx
<div className="fixed inset-0 bg-black flex items-center justify-center">
  <div className="w-screen h-screen max-w-2xl">
    <JodaAvatar type="3d" isSpeaking={isSpeaking} audioLevel={audioLevel} />
  </div>
</div>
```

### Example 3: Split Screen with Chat

```jsx
<div className="grid grid-cols-2 h-screen">
  <div className="bg-black">
    <JodaAvatar type="svg" isSpeaking={isSpeaking} audioLevel={audioLevel} emotion={emotion} />
  </div>
  <div className="bg-gray-900 p-4">
    <ChatModule />
  </div>
</div>
```

---

## Support

For issues or feature requests, please create an issue in the repository with:
- Avatar type being used
- Browser and OS version
- Console errors (if any)
- Expected vs actual behavior
