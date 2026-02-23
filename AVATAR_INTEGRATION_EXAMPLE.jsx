/**
 * JODA Avatar Integration Example
 *
 * This file shows how to integrate the JodaAvatar component into your existing App.jsx
 *
 * INTEGRATION STEPS:
 * 1. Import the JodaAvatar component
 * 2. Add state for avatar controls
 * 3. Connect to Socket.IO audio events
 * 4. Add avatar to your UI layout
 */

import { useState, useEffect, useRef } from 'react';
import JodaAvatar from './components/JodaAvatar';
import { motion } from 'framer-motion';

// ============== STEP 1: Add these state variables to your App component ==============

function AppWithAvatar() {
  // Existing state...
  const [socket, setSocket] = useState(null);

  // NEW: Avatar state
  const [showAvatar, setShowAvatar] = useState(true);
  const [avatarType, setAvatarType] = useState('holographic'); // 'holographic', 'svg', '3d', 'rpm'
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [avatarEmotion, setAvatarEmotion] = useState('neutral');
  const [rpmAvatarUrl, setRpmAvatarUrl] = useState(null); // Set your RPM URL here if using

  // ============== STEP 2: Add audio level calculation ==============

  const calculateAudioLevel = (audioData) => {
    if (!audioData) return 0;

    try {
      // Handle base64 audio data from Gemini
      const buffer = Buffer.from(audioData, 'base64');
      const pcm = new Int16Array(buffer.buffer);

      // Calculate RMS (Root Mean Square)
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) {
        const normalized = pcm[i] / 32768;
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / pcm.length);
      return Math.min(rms * 4, 1); // Amplify and normalize to 0-1
    } catch (e) {
      console.error('Error calculating audio level:', e);
      return 0;
    }
  };

  // ============== STEP 3: Simple emotion detection ==============

  const detectEmotion = (text) => {
    if (!text) return 'neutral';

    const lowerText = text.toLowerCase();

    // Alert/Error state
    if (lowerText.includes('error') || lowerText.includes('failed') || lowerText.includes('warning')) {
      return 'alert';
    }

    // Thinking/Processing state
    if (
      lowerText.includes('let me think') ||
      lowerText.includes('processing') ||
      lowerText.includes('analyzing') ||
      lowerText.includes('calculating')
    ) {
      return 'thinking';
    }

    // Happy/Success state
    if (
      lowerText.includes('great') ||
      lowerText.includes('success') ||
      lowerText.includes('excellent') ||
      lowerText.includes('done') ||
      lowerText.includes('completed') ||
      lowerText.includes('perfect')
    ) {
      return 'happy';
    }

    return 'neutral';
  };

  // ============== STEP 4: Connect to Socket.IO events ==============

  useEffect(() => {
    if (!socket) return;

    // Listen for JODA speaking (audio output)
    socket.on('audio_data', (data) => {
      setIsSpeaking(true);

      // Calculate and set audio level for mouth animation
      if (data.audio) {
        const level = calculateAudioLevel(data.audio);
        setAudioLevel(level);
      }
    });

    // When audio chunk ends
    socket.on('audio_end', () => {
      setIsSpeaking(false);
      setAudioLevel(0);
    });

    // Listen for transcriptions to detect emotion
    socket.on('transcription', (data) => {
      if (data.sender === 'JODA') {
        const emotion = detectEmotion(data.text);
        setAvatarEmotion(emotion);
      }
    });

    // When JODA stops speaking completely
    socket.on('session_stopped', () => {
      setIsSpeaking(false);
      setAudioLevel(0);
      setAvatarEmotion('neutral');
    });

    return () => {
      socket.off('audio_data');
      socket.off('audio_end');
      socket.off('transcription');
      socket.off('session_stopped');
    };
  }, [socket]);

  // ============== STEP 5: UI Layout Options ==============

  // OPTION A: Floating Avatar Window (Draggable)
  const FloatingAvatar = () => (
    <motion.div
      drag
      dragMomentum={false}
      dragConstraints={{ top: 0, left: 0, right: window.innerWidth - 300, bottom: window.innerHeight - 300 }}
      initial={{ x: window.innerWidth - 320, y: 20 }}
      className="fixed top-4 right-4 w-72 h-72 z-50"
    >
      <div className="relative w-full h-full bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl border border-cyan-500/30 overflow-hidden">
        {/* Close button */}
        <button
          onClick={() => setShowAvatar(false)}
          className="absolute top-2 left-2 z-10 w-8 h-8 rounded-full bg-red-500/80 hover:bg-red-600 text-white flex items-center justify-center text-sm"
        >
          ×
        </button>

        {/* Avatar */}
        <JodaAvatar
          type={avatarType}
          isSpeaking={isSpeaking}
          audioLevel={audioLevel}
          emotion={avatarEmotion}
          rpmAvatarUrl={rpmAvatarUrl}
          onTypeChange={setAvatarType}
        />

        {/* Status bar */}
        <div className="absolute bottom-0 left-0 right-0 bg-black/50 backdrop-blur-sm px-4 py-2 text-xs text-cyan-400 font-mono">
          {isSpeaking ? '🔊 JODA is speaking...' : '👂 Listening...'}
        </div>
      </div>
    </motion.div>
  );

  // OPTION B: Sidebar Avatar (Fixed Position)
  const SidebarAvatar = () => (
    <div className="fixed left-0 top-0 bottom-0 w-80 bg-gray-900 border-r border-cyan-500/30 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-cyan-500/30">
        <h2 className="text-xl font-bold text-cyan-400">J.O.D.A</h2>
        <p className="text-xs text-gray-400">Jarvis's Operative Developer Assistant</p>
      </div>

      {/* Avatar */}
      <div className="flex-1 p-4">
        <JodaAvatar
          type={avatarType}
          isSpeaking={isSpeaking}
          audioLevel={audioLevel}
          emotion={avatarEmotion}
          rpmAvatarUrl={rpmAvatarUrl}
          onTypeChange={setAvatarType}
        />
      </div>

      {/* Controls */}
      <div className="p-4 border-t border-cyan-500/30">
        <div className="text-xs text-gray-400 mb-2">Avatar Style</div>
        <div className="grid grid-cols-2 gap-2">
          {['holographic', 'svg', '3d', 'rpm'].map((type) => (
            <button
              key={type}
              onClick={() => setAvatarType(type)}
              className={`
                px-3 py-2 rounded text-xs font-mono uppercase transition-colors
                ${
                  avatarType === type
                    ? 'bg-cyan-500 text-black'
                    : 'bg-gray-800 text-cyan-400 hover:bg-gray-700'
                }
              `}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // OPTION C: Top Bar Avatar (Compact)
  const TopBarAvatar = () => (
    <div className="fixed top-0 left-0 right-0 h-20 bg-gray-900/95 backdrop-blur-md border-b border-cyan-500/30 flex items-center px-4 z-50">
      {/* Compact Avatar */}
      <div className="w-16 h-16 mr-4">
        <JodaAvatar
          type="svg" // Use lightweight SVG for compact view
          isSpeaking={isSpeaking}
          audioLevel={audioLevel}
          emotion={avatarEmotion}
        />
      </div>

      {/* Info */}
      <div className="flex-1">
        <h1 className="text-lg font-bold text-cyan-400">J.O.D.A</h1>
        <p className="text-xs text-gray-400">
          {isSpeaking ? '🔊 Speaking...' : '👂 Ready'}
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-cyan-500 text-black rounded-lg hover:bg-cyan-400">
          Mute
        </button>
        <button
          onClick={() => setShowAvatar(!showAvatar)}
          className="px-4 py-2 bg-gray-700 text-cyan-400 rounded-lg hover:bg-gray-600"
        >
          {showAvatar ? 'Hide' : 'Show'} Avatar
        </button>
      </div>
    </div>
  );

  // OPTION D: Center Stage Avatar (Full Focus)
  const CenterStageAvatar = () => (
    <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 via-black to-gray-900">
      <div className="w-full max-w-2xl h-screen flex flex-col">
        {/* Avatar takes most space */}
        <div className="flex-1">
          <JodaAvatar
            type={avatarType}
            isSpeaking={isSpeaking}
            audioLevel={audioLevel}
            emotion={avatarEmotion}
            rpmAvatarUrl={rpmAvatarUrl}
            onTypeChange={setAvatarType}
          />
        </div>

        {/* Status and controls at bottom */}
        <div className="p-8 bg-black/50 backdrop-blur-sm">
          <div className="text-center mb-4">
            <h1 className="text-4xl font-bold text-cyan-400 mb-2">J.O.D.A</h1>
            <p className="text-gray-400">
              {isSpeaking ? 'Speaking...' : 'Listening for your command...'}
            </p>
          </div>

          {/* Wave form visualization */}
          <div className="flex justify-center gap-1 h-16 items-end">
            {[...Array(20)].map((_, i) => (
              <motion.div
                key={i}
                className="w-2 bg-cyan-400 rounded-full"
                animate={{
                  height: isSpeaking ? [4, 16 + audioLevel * 40 * Math.random(), 4] : 4,
                }}
                transition={{
                  duration: 0.1 + i * 0.02,
                  repeat: isSpeaking ? Infinity : 0,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ============== STEP 6: Render your chosen layout ==============

  return (
    <div className="relative">
      {/* Your existing app content */}
      <div className="main-content">
        {/* ... existing components ... */}
      </div>

      {/* Add one of the avatar layouts: */}
      {showAvatar && <FloatingAvatar />}
      {/* OR */}
      {/* <SidebarAvatar /> */}
      {/* OR */}
      {/* <TopBarAvatar /> */}
      {/* OR */}
      {/* <CenterStageAvatar /> */}

      {/* Toggle button if using floating/optional avatar */}
      {!showAvatar && (
        <button
          onClick={() => setShowAvatar(true)}
          className="fixed bottom-4 right-4 w-16 h-16 rounded-full bg-cyan-500 text-black shadow-lg hover:bg-cyan-400 flex items-center justify-center text-2xl z-50"
        >
          👤
        </button>
      )}
    </div>
  );
}

// ============== BONUS: Settings Panel Integration ==============

const AvatarSettingsPanel = ({ avatarType, setAvatarType, rpmAvatarUrl, setRpmAvatarUrl }) => (
  <div className="bg-gray-800 rounded-lg p-6">
    <h3 className="text-lg font-bold text-cyan-400 mb-4">Avatar Settings</h3>

    {/* Avatar Type Selection */}
    <div className="mb-6">
      <label className="block text-sm text-gray-300 mb-2">Avatar Style</label>
      <div className="grid grid-cols-2 gap-2">
        {[
          { type: 'holographic', label: 'Holographic', desc: 'Futuristic, lightweight' },
          { type: 'svg', label: 'Minimalist', desc: '2D animated, clean' },
          { type: '3d', label: 'Custom 3D', desc: 'Built-in 3D model' },
          { type: 'rpm', label: 'Photorealistic', desc: 'Ready Player Me' },
        ].map(({ type, label, desc }) => (
          <button
            key={type}
            onClick={() => setAvatarType(type)}
            className={`
              p-3 rounded-lg text-left transition-all
              ${
                avatarType === type
                  ? 'bg-cyan-500 text-black'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }
            `}
          >
            <div className="font-semibold text-sm">{label}</div>
            <div className="text-xs opacity-70">{desc}</div>
          </button>
        ))}
      </div>
    </div>

    {/* RPM URL Input (only show if RPM selected) */}
    {avatarType === 'rpm' && (
      <div className="mb-4">
        <label className="block text-sm text-gray-300 mb-2">
          Ready Player Me Avatar URL
        </label>
        <input
          type="text"
          value={rpmAvatarUrl || ''}
          onChange={(e) => setRpmAvatarUrl(e.target.value)}
          placeholder="https://models.readyplayer.me/..."
          className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-cyan-400 focus:outline-none"
        />
        <a
          href="https://readyplayer.me/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-cyan-400 hover:underline mt-1 inline-block"
        >
          Create Avatar →
        </a>
      </div>
    )}

    {/* Preview */}
    <div className="bg-black rounded-lg p-4 h-64">
      <JodaAvatar
        type={avatarType}
        isSpeaking={false}
        audioLevel={0}
        emotion="neutral"
        rpmAvatarUrl={rpmAvatarUrl}
      />
    </div>
  </div>
);

export { AppWithAvatar, AvatarSettingsPanel };
