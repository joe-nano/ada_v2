import React, { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, useFBX } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import HeyGenAvatar from './HeyGenAvatar';

/**
 * JODA Avatar Component
 *
 * Supports multiple avatar types:
 * 1. 3D Ready Player Me Avatar (RPM)
 * 2. 3D Custom GLB Model
 * 3. 2D Animated SVG Avatar
 * 4. AI-Generated Talking Head (D-ID style)
 */

// ==================== OPTION 1: 3D Ready Player Me Avatar ====================
function ReadyPlayerMeAvatar({ avatarUrl, isSpeaking, audioLevel }) {
  // Use local file instead of external URL to avoid CORS issues
  const localAvatarUrl = avatarUrl?.includes('readyplayer.me') ? '/models/joda-avatar.glb' : avatarUrl || '/models/joda-avatar.glb';
  const gltf = useGLTF(localAvatarUrl);
  const meshRef = useRef();

  useEffect(() => {
    if (meshRef.current && isSpeaking) {
      // Animate mouth based on audio level
      const mouthOpenness = audioLevel * 0.5;
      // You'll need to target the specific morph targets for mouth
      // This is a placeholder - actual implementation depends on RPM model structure
      if (meshRef.current.morphTargetInfluences) {
        meshRef.current.morphTargetInfluences[0] = mouthOpenness;
      }
    }
  }, [isSpeaking, audioLevel]);

  return (
    <primitive
      ref={meshRef}
      object={gltf.scene}
      scale={2.5}
      position={[0, -1.5, 0]}
    />
  );
}

// ==================== OPTION 2: Custom 3D Humanoid Avatar ====================
function Custom3DAvatar({ isSpeaking, audioLevel }) {
  return (
    <group position={[0, -0.5, 0]}>
      {/* Head - More angular, humanoid */}
      <mesh position={[0, 1.6, 0]} castShadow>
        <boxGeometry args={[0.35, 0.4, 0.35]} />
        <meshStandardMaterial
          color="#001a33"
          emissive="#00D9FF"
          emissiveIntensity={0.4}
          metalness={0.95}
          roughness={0.1}
        />
      </mesh>

      {/* Visor/Face Plate - Glowing */}
      <mesh position={[0, 1.65, 0.18]}>
        <boxGeometry args={[0.32, 0.15, 0.02]} />
        <meshStandardMaterial
          color="#00FFFF"
          emissive="#00FFFF"
          emissiveIntensity={1.2}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Eyes - Bright cyan glow */}
      <mesh position={[-0.08, 1.65, 0.19]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial
          color="#00FFFF"
          emissive="#00FFFF"
          emissiveIntensity={isSpeaking ? 2.0 : 1.5}
        />
      </mesh>
      <mesh position={[0.08, 1.65, 0.19]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial
          color="#00FFFF"
          emissive="#00FFFF"
          emissiveIntensity={isSpeaking ? 2.0 : 1.5}
        />
      </mesh>

      {/* Jaw/Lower face - moves down when speaking */}
      <mesh
        position={[
          0,
          1.50 - (isSpeaking ? audioLevel * 0.08 : 0), // Jaw drops when speaking
          0.17
        ]}
        castShadow
      >
        <boxGeometry args={[0.25, 0.08, 0.05]} />
        <meshStandardMaterial
          color="#001a33"
          emissive="#00D9FF"
          emissiveIntensity={0.3}
          metalness={0.95}
          roughness={0.1}
        />
      </mesh>

      {/* Mouth indicator - Animated bar that opens/closes with speech */}
      <mesh
        position={[
          0,
          1.52 - (isSpeaking ? audioLevel * 0.08 : 0), // Moves with jaw
          0.19
        ]}
        scale={[
          isSpeaking ? 0.2 + (audioLevel * 0.5) : 0.15,  // Width expands significantly (up to 70% bigger)
          isSpeaking ? 0.02 + (audioLevel * 0.15) : 0.01, // Height expands dramatically (up to 8x bigger)
          0.01
        ]}
      >
        <boxGeometry />
        <meshStandardMaterial
          color="#00FFFF"
          emissive="#00FFFF"
          emissiveIntensity={isSpeaking ? 2.5 + (audioLevel * 3) : 0.5}
        />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.2, 16]} />
        <meshStandardMaterial
          color="#000814"
          emissive="#00D9FF"
          emissiveIntensity={0.3}
          metalness={0.95}
          roughness={0.1}
        />
      </mesh>

      {/* Shoulders/Upper Torso */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[0.7, 0.35, 0.3]} />
        <meshStandardMaterial
          color="#001a33"
          emissive="#00D9FF"
          emissiveIntensity={0.25}
          metalness={0.95}
          roughness={0.15}
        />
      </mesh>

      {/* Chest Core - Glowing reactor */}
      <mesh position={[0, 1.0, 0.16]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial
          color="#00FFFF"
          emissive="#00FFFF"
          emissiveIntensity={isSpeaking ? 2.5 : 1.8}
        />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 0.25]} />
        <meshStandardMaterial
          color="#000814"
          emissive="#00D9FF"
          emissiveIntensity={0.2}
          metalness={0.95}
          roughness={0.15}
        />
      </mesh>

      {/* Waist */}
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[0.4, 0.2, 0.22]} />
        <meshStandardMaterial
          color="#001a33"
          emissive="#00D9FF"
          emissiveIntensity={0.15}
          metalness={0.95}
          roughness={0.15}
        />
      </mesh>

      {/* Left Arm - Upper */}
      <mesh position={[-0.45, 0.95, 0]} rotation={[0, 0, 0.2]}>
        <cylinderGeometry args={[0.08, 0.07, 0.4, 16]} />
        <meshStandardMaterial
          color="#001a33"
          emissive="#00D9FF"
          emissiveIntensity={0.25}
          metalness={0.95}
          roughness={0.15}
        />
      </mesh>

      {/* Left Arm - Lower */}
      <mesh position={[-0.55, 0.6, 0]} rotation={[0, 0, 0.1]}>
        <cylinderGeometry args={[0.07, 0.06, 0.35, 16]} />
        <meshStandardMaterial
          color="#000814"
          emissive="#00D9FF"
          emissiveIntensity={0.2}
          metalness={0.95}
          roughness={0.15}
        />
      </mesh>

      {/* Left Hand/Glow */}
      <mesh position={[-0.6, 0.38, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial
          color="#00FFFF"
          emissive="#00FFFF"
          emissiveIntensity={1.0}
        />
      </mesh>

      {/* Right Arm - Upper */}
      <mesh position={[0.45, 0.95, 0]} rotation={[0, 0, -0.2]}>
        <cylinderGeometry args={[0.08, 0.07, 0.4, 16]} />
        <meshStandardMaterial
          color="#001a33"
          emissive="#00D9FF"
          emissiveIntensity={0.25}
          metalness={0.95}
          roughness={0.15}
        />
      </mesh>

      {/* Right Arm - Lower */}
      <mesh position={[0.55, 0.6, 0]} rotation={[0, 0, -0.1]}>
        <cylinderGeometry args={[0.07, 0.06, 0.35, 16]} />
        <meshStandardMaterial
          color="#000814"
          emissive="#00D9FF"
          emissiveIntensity={0.2}
          metalness={0.95}
          roughness={0.15}
        />
      </mesh>

      {/* Right Hand/Glow */}
      <mesh position={[0.6, 0.38, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial
          color="#00FFFF"
          emissive="#00FFFF"
          emissiveIntensity={1.0}
        />
      </mesh>

      {/* Neon accent lines on body */}
      <mesh position={[-0.15, 0.7, 0.13]}>
        <boxGeometry args={[0.02, 0.4, 0.01]} />
        <meshStandardMaterial
          color="#00FFFF"
          emissive="#00FFFF"
          emissiveIntensity={1.5}
        />
      </mesh>
      <mesh position={[0.15, 0.7, 0.13]}>
        <boxGeometry args={[0.02, 0.4, 0.01]} />
        <meshStandardMaterial
          color="#00FFFF"
          emissive="#00FFFF"
          emissiveIntensity={1.5}
        />
      </mesh>

      {/* Enhanced Lighting */}
      <pointLight position={[0, 1.65, 0.5]} color="#00FFFF" intensity={isSpeaking ? 4 : 3} distance={4} />
      <pointLight position={[0, 1.0, 0.5]} color="#00D9FF" intensity={isSpeaking ? 3 : 2} distance={3} />

      {/* Rim/Key lights for Tron effect */}
      <spotLight position={[-3, 3, 3]} intensity={2} color="#00FFFF" angle={0.5} penumbra={0.5} castShadow />
      <spotLight position={[3, 3, 3]} intensity={2} color="#0080FF" angle={0.5} penumbra={0.5} castShadow />
      <pointLight position={[0, -1, 2]} intensity={1.5} color="#00D9FF" distance={5} />
    </group>
  );
}

// ==================== OPTION 3: 2D Animated Avatar (Minimalist) ====================
function AnimatedSVGAvatar({ isSpeaking, audioLevel, emotion = 'neutral' }) {
  const mouthScale = isSpeaking ? 1 + (audioLevel * 0.5) : 1;

  const emotions = {
    neutral: { eyeY: 45, mouthPath: "M 40 70 Q 50 75 60 70" },
    happy: { eyeY: 42, mouthPath: "M 35 65 Q 50 80 65 65" },
    thinking: { eyeY: 48, mouthPath: "M 40 70 L 60 70" },
    alert: { eyeY: 40, mouthPath: "M 40 68 Q 50 72 60 68" }
  };

  const currentEmotion = emotions[emotion] || emotions.neutral;

  return (
    <motion.svg
      width="200"
      height="200"
      viewBox="0 0 100 100"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      {/* Glow effect */}
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#00FFFF" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#4A90E2" stopOpacity="0" />
        </radialGradient>
        <filter id="blur">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
        </filter>
      </defs>

      {/* Background glow */}
      <motion.circle
        cx="50"
        cy="50"
        r="45"
        fill="url(#glow)"
        filter="url(#blur)"
        animate={{
          r: isSpeaking ? [45, 48, 45] : 45,
          opacity: isSpeaking ? [0.6, 0.9, 0.6] : 0.4
        }}
        transition={{ duration: 0.8, repeat: isSpeaking ? Infinity : 0 }}
      />

      {/* Head */}
      <circle cx="50" cy="50" r="30" fill="#4A90E2" stroke="#00FFFF" strokeWidth="2" />

      {/* Eyes */}
      <motion.circle
        cx="40"
        cy={currentEmotion.eyeY}
        r="3"
        fill="#00FFFF"
        animate={{ scaleY: [1, 0.1, 1] }}
        transition={{ duration: 3, repeat: Infinity, repeatDelay: 2 }}
      />
      <motion.circle
        cx="60"
        cy={currentEmotion.eyeY}
        r="3"
        fill="#00FFFF"
        animate={{ scaleY: [1, 0.1, 1] }}
        transition={{ duration: 3, repeat: Infinity, repeatDelay: 2 }}
      />

      {/* Mouth - animated with speech */}
      <motion.path
        d={currentEmotion.mouthPath}
        stroke="#00FFFF"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        animate={{
          scaleY: mouthScale,
          d: isSpeaking
            ? [currentEmotion.mouthPath, "M 40 70 Q 50 80 60 70", currentEmotion.mouthPath]
            : currentEmotion.mouthPath
        }}
        transition={{ duration: 0.15 }}
      />

      {/* Voice indicator rings */}
      <AnimatePresence>
        {isSpeaking && (
          <>
            <motion.circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke="#00FFFF"
              strokeWidth="1"
              initial={{ r: 30, opacity: 0.8 }}
              animate={{ r: 45, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <motion.circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke="#00FFFF"
              strokeWidth="1"
              initial={{ r: 30, opacity: 0.8 }}
              animate={{ r: 45, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1, repeat: Infinity, delay: 0.3 }}
            />
          </>
        )}
      </AnimatePresence>

      {/* Accent details */}
      <circle cx="50" cy="30" r="2" fill="#00FFFF" opacity="0.6" />
      <circle cx="35" cy="35" r="1.5" fill="#00FFFF" opacity="0.4" />
      <circle cx="65" cy="35" r="1.5" fill="#00FFFF" opacity="0.4" />
    </motion.svg>
  );
}

// ==================== OPTION 4: Enhanced Holographic Floating Avatar ====================
function HolographicAvatar({ isSpeaking, audioLevel, emotion = 'neutral' }) {
  const [currentEmotion, setCurrentEmotion] = React.useState('neutral');
  const [isBlinking, setIsBlinking] = React.useState(false);
  const [smoothedAudioLevel, setSmoothedAudioLevel] = React.useState(0);
  const [mouthShape, setMouthShape] = React.useState('closed'); // closed, open, wide
  const lastAudioLevelRef = React.useRef(0);
  const syllableTimerRef = React.useRef(null);

  // Advanced lip sync - detect syllables and create mouth shapes
  React.useEffect(() => {
    // MUCH more sensitive detection - respond to any speech
    if (isSpeaking && audioLevel > 0.01) {
      const audioDelta = audioLevel - lastAudioLevelRef.current;

      // Debug logging
      if (audioLevel > 0.05) {
        console.log('[HOLOGRAM LIP SYNC] isSpeaking:', isSpeaking, 'audioLevel:', audioLevel.toFixed(3), 'delta:', audioDelta.toFixed(3), 'mouthShape:', mouthShape);
      }

      // Detect syllable start (sudden amplitude increase) - very sensitive
      if (audioDelta > 0.03 || audioLevel > 0.1) {
        // New syllable detected - adjust mouth based on audio level
        if (audioLevel > 0.5) {
          setMouthShape('wide'); // Wide mouth for loud sounds
        } else if (audioLevel > 0.2) {
          setMouthShape('open'); // Medium mouth for normal sounds
        } else {
          setMouthShape('small'); // Small mouth for quiet sounds
        }

        // Clear existing timer
        if (syllableTimerRef.current) clearTimeout(syllableTimerRef.current);

        // Close mouth after syllable (faster, more natural timing)
        syllableTimerRef.current = setTimeout(() => {
          setMouthShape('closed');
        }, 60 + Math.random() * 60); // 60-120ms per syllable (faster)
      }

      // Smooth audio level
      setSmoothedAudioLevel(prev => prev + (audioLevel - prev) * 0.4);
    } else {
      setMouthShape('closed');
      setSmoothedAudioLevel(0);
    }

    lastAudioLevelRef.current = audioLevel;
  }, [isSpeaking, audioLevel]);

  // Automatic blinking
  React.useEffect(() => {
    const blinkInterval = setInterval(() => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 150);
    }, 3000 + Math.random() * 2000); // Blink every 3-5 seconds

    return () => clearInterval(blinkInterval);
  }, []);

  // Emotion detection based on audio and speech
  React.useEffect(() => {
    if (isSpeaking && audioLevel > 0.5) {
      setCurrentEmotion('excited');
    } else if (isSpeaking && audioLevel > 0.05) {
      setCurrentEmotion('happy');
    } else {
      setCurrentEmotion('neutral');
    }
  }, [isSpeaking, audioLevel]);

  // Emotion configurations
  const emotions = {
    neutral: {
      eyeScale: 1,
      eyeY: 0,
      mouthHeight: 6,
      mouthCurve: 0,
      glowIntensity: 0.5,
      color: '#22d3ee'
    },
    happy: {
      eyeScale: 1.2,
      eyeY: -2,
      mouthHeight: 12,
      mouthCurve: 8,
      glowIntensity: 0.8,
      color: '#22d3ee'
    },
    excited: {
      eyeScale: 1.4,
      eyeY: -4,
      mouthHeight: 18,
      mouthCurve: 12,
      glowIntensity: 1,
      color: '#00ff88'
    },
    sad: {
      eyeScale: 0.8,
      eyeY: 3,
      mouthHeight: 4,
      mouthCurve: -6,
      glowIntensity: 0.3,
      color: '#6b7280'
    }
  };

  const currentEmotionConfig = emotions[currentEmotion] || emotions.neutral;
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* Shadow underneath hologram */}
      <motion.div
        className="absolute bottom-0 w-48 h-6 rounded-full blur-xl opacity-40"
        style={{
          background: `radial-gradient(ellipse, ${currentEmotionConfig.color}80, transparent 70%)`,
        }}
        animate={{
          scale: isSpeaking ? [1, 1.2, 1] : [1, 1.1, 1],
          opacity: [0.3, 0.5, 0.3]
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />

      {/* Main floating hologram */}
      <motion.div
        className="relative w-64 h-64"
        animate={{
          y: [0, -15, 0],
          rotateY: [0, 5, 0, -5, 0],
          scale: isSpeaking ? [1, 1.08, 1] : [1, 1.02, 1],
        }}
        transition={{
          y: { duration: 4, repeat: Infinity, ease: "easeInOut" },
          rotateY: { duration: 6, repeat: Infinity, ease: "easeInOut" },
          scale: { duration: 0.3 }
        }}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Holographic glow layers */}
        <motion.div
          className="absolute inset-0 rounded-full blur-xl"
          style={{
            background: `radial-gradient(circle, ${currentEmotionConfig.color}33, ${currentEmotionConfig.color}1a, transparent)`
          }}
          animate={{
            scale: isSpeaking ? [1, 1.3, 1] : [1, 1.1, 1],
            opacity: isSpeaking ? [currentEmotionConfig.glowIntensity, currentEmotionConfig.glowIntensity * 1.5, currentEmotionConfig.glowIntensity] : [currentEmotionConfig.glowIntensity * 0.7, currentEmotionConfig.glowIntensity, currentEmotionConfig.glowIntensity * 0.7]
          }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />

        {/* Rotating rings */}
        {[...Array(3)].map((_, i) => (
          <motion.div
            key={`ring-${i}`}
            className="absolute inset-0 border border-cyan-400/30 rounded-full"
            style={{
              width: `${80 + i * 40}%`,
              height: `${80 + i * 40}%`,
              left: `${10 - i * 20}%`,
              top: `${10 - i * 20}%`,
            }}
            animate={{
              rotateZ: 360,
              opacity: [0.2, 0.5, 0.2]
            }}
            transition={{
              rotateZ: { duration: 10 + i * 5, repeat: Infinity, ease: "linear" },
              opacity: { duration: 2, repeat: Infinity, delay: i * 0.3 }
            }}
          />
        ))}

        {/* Main holographic sphere */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{
            rotateX: [0, 5, 0, -5, 0],
          }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.div
            className="w-48 h-48 rounded-full relative"
            style={{
              background: 'radial-gradient(circle at 30% 30%, rgba(34, 211, 238, 0.4), rgba(59, 130, 246, 0.2), rgba(0, 255, 255, 0.1))',
              border: '2px solid rgba(34, 211, 238, 0.6)',
              boxShadow: isSpeaking
                ? '0 0 40px rgba(0, 255, 255, 0.8), inset 0 0 40px rgba(0, 255, 255, 0.3)'
                : '0 0 25px rgba(0, 255, 255, 0.5), inset 0 0 25px rgba(0, 255, 255, 0.2)'
            }}
          >
            {/* Scan lines effect */}
            <div className="absolute inset-0 rounded-full overflow-hidden opacity-30">
              <motion.div
                className="absolute w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
                animate={{ y: ['0%', '100%'] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            </div>

            {/* Emoji-like face with emotions */}
            <div className="relative w-full h-full flex flex-col items-center justify-center">
              {/* Eyes - expressive with blinking */}
              <motion.div className="flex gap-10 mb-4" animate={{ y: currentEmotionConfig.eyeY }}>
                {/* Left Eye */}
                <motion.div
                  className="relative w-5 h-5 rounded-full"
                  style={{
                    background: `radial-gradient(circle at 35% 35%, ${currentEmotionConfig.color}, ${currentEmotionConfig.color}cc)`,
                    boxShadow: `0 0 12px ${currentEmotionConfig.color}cc`
                  }}
                  animate={{
                    scaleY: isBlinking ? 0.1 : currentEmotionConfig.eyeScale,
                    scaleX: currentEmotionConfig.eyeScale
                  }}
                  transition={{ duration: 0.1 }}
                >
                  {/* Pupil */}
                  <motion.div
                    className="absolute top-1/2 left-1/2 w-2 h-2 bg-white rounded-full"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    animate={{
                      x: isSpeaking ? [-1, 1, -1] : [0, 1, 0, -1, 0],
                      y: isSpeaking ? [0, -1, 0] : [0, 0.5, 0, 0.5, 0]
                    }}
                    transition={{
                      duration: isSpeaking ? 0.5 : 4,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                  />
                  {/* Highlight */}
                  <div className="absolute top-1 left-1 w-1.5 h-1.5 bg-white/80 rounded-full blur-[1px]" />
                </motion.div>

                {/* Right Eye */}
                <motion.div
                  className="relative w-5 h-5 rounded-full"
                  style={{
                    background: `radial-gradient(circle at 35% 35%, ${currentEmotionConfig.color}, ${currentEmotionConfig.color}cc)`,
                    boxShadow: `0 0 12px ${currentEmotionConfig.color}cc`
                  }}
                  animate={{
                    scaleY: isBlinking ? 0.1 : currentEmotionConfig.eyeScale,
                    scaleX: currentEmotionConfig.eyeScale
                  }}
                  transition={{ duration: 0.1, delay: 0.02 }}
                >
                  {/* Pupil */}
                  <motion.div
                    className="absolute top-1/2 left-1/2 w-2 h-2 bg-white rounded-full"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    animate={{
                      x: isSpeaking ? [-1, 1, -1] : [0, 1, 0, -1, 0],
                      y: isSpeaking ? [0, -1, 0] : [0, 0.5, 0, 0.5, 0]
                    }}
                    transition={{
                      duration: isSpeaking ? 0.5 : 4,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: 0.05
                    }}
                  />
                  {/* Highlight */}
                  <div className="absolute top-1 left-1 w-1.5 h-1.5 bg-white/80 rounded-full blur-[1px]" />
                </motion.div>
              </motion.div>

              {/* Expressive mouth with emotion - Animoji style */}
              <motion.div
                className="flex gap-1.5 items-end h-12 px-4 relative mt-2"
                animate={{
                  scale: isSpeaking ? [1, 1.05, 1] : 1
                }}
              >
                {/* Smooth animoji-style mouth */}
                <svg width="80" height="48" className="absolute top-0 left-0" style={{ overflow: 'visible' }}>
                  {!isSpeaking ? (
                    // Static smile when not speaking
                    <motion.path
                      d={`M 10 24 Q 40 ${24 + currentEmotionConfig.mouthCurve} 70 24`}
                      stroke={currentEmotionConfig.color}
                      strokeWidth="3"
                      fill="none"
                      strokeLinecap="round"
                      animate={{
                        opacity: [0.6, 1, 0.6],
                      }}
                      transition={{
                        opacity: { duration: 1.5, repeat: Infinity },
                      }}
                    />
                  ) : (
                    // Animated mouth with realistic lip sync
                    <>
                      {/* Mouth shapes based on syllable detection */}
                      {mouthShape === 'closed' && (
                        <motion.path
                          d="M 15 26 Q 40 26 65 26"
                          stroke={currentEmotionConfig.color}
                          strokeWidth="3"
                          fill="none"
                          strokeLinecap="round"
                          opacity={0.8}
                        />
                      )}

                      {mouthShape === 'small' && (
                        <>
                          <motion.ellipse cx="40" cy="22" rx="18" ry="3" fill={currentEmotionConfig.color} opacity="0.8" />
                          <motion.ellipse cx="40" cy="27" rx="14" ry="6" fill="rgba(0, 20, 40, 0.7)" stroke={currentEmotionConfig.color} strokeWidth="2" />
                          <motion.ellipse cx="40" cy="32" rx="18" ry="3" fill={currentEmotionConfig.color} opacity="0.8" />
                        </>
                      )}

                      {mouthShape === 'open' && (
                        <>
                          <motion.ellipse cx="40" cy="20" rx="22" ry="4" fill={currentEmotionConfig.color} opacity="0.9" />
                          <motion.ellipse cx="40" cy="27" rx="18" ry="10" fill="rgba(0, 20, 40, 0.6)" stroke={currentEmotionConfig.color} strokeWidth="2" />
                          <motion.ellipse cx="40" cy="34" rx="22" ry="4" fill={currentEmotionConfig.color} opacity="0.9" />
                          <motion.ellipse cx="40" cy="27" rx="23" ry="12" fill="none" stroke={currentEmotionConfig.color} strokeWidth="1.5" opacity="0.4" />
                        </>
                      )}

                      {mouthShape === 'wide' && (
                        <>
                          <motion.ellipse cx="40" cy="18" rx="26" ry="5" fill={currentEmotionConfig.color} opacity="0.95" />
                          <motion.ellipse cx="40" cy="28" rx="22" ry="14" fill="rgba(0, 20, 40, 0.5)" stroke={currentEmotionConfig.color} strokeWidth="2.5" />
                          <motion.ellipse cx="40" cy="38" rx="26" ry="5" fill={currentEmotionConfig.color} opacity="0.95" />
                          <motion.ellipse cx="40" cy="28" rx="27" ry="16" fill="none" stroke={currentEmotionConfig.color} strokeWidth="2" opacity="0.5" />
                        </>
                      )}
                    </>
                  )}
                </svg>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>

        {/* Floating particles */}
        {[...Array(8)].map((_, i) => (
	          <motion.div
	            key={`particle-${i}`}
	            className="absolute w-1.5 h-1.5 rounded-full"
	            style={{
	              left: '50%',
	              top: '50%',
	              backgroundColor: currentEmotionConfig.color,
	              boxShadow: `0 0 8px ${currentEmotionConfig.color}cc`
	            }}
	            animate={{
	              x: [0, Math.cos((i / 8) * Math.PI * 2) * (80 + Math.random() * 40), 0],
	              y: [0, Math.sin((i / 8) * Math.PI * 2) * (80 + Math.random() * 40), 0],
              opacity: [0.2, 0.8, 0.2],
              scale: [0.5, 1, 0.5]
            }}
            transition={{
              duration: 4 + i * 0.3,
              repeat: Infinity,
              delay: i * 0.2,
              ease: 'easeInOut'
            }}
          />
        ))}
      </motion.div>

      {/* Holographic status text */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-sm font-mono tracking-wider"
        style={{ color: currentEmotionConfig.color }}
        animate={{
          opacity: [0.6, 1, 0.6],
          textShadow: isSpeaking
            ? [`0 0 10px ${currentEmotionConfig.color}80`, `0 0 20px ${currentEmotionConfig.color}cc`, `0 0 10px ${currentEmotionConfig.color}80`]
            : `0 0 10px ${currentEmotionConfig.color}4d`
        }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        {isSpeaking ? '◉ TRANSMITTING' : currentEmotion === 'excited' ? '✨ EXCITED' : currentEmotion === 'happy' ? '😊 HAPPY' : '○ STANDBY'}
      </motion.div>
    </div>
  );
}

// ==================== Main Avatar Component with Type Selector ====================
export default function JodaAvatar({
  type = 'holographic', // 'rpm', '3d', 'svg', 'holographic', 'heygen'
  isSpeaking = false,
  audioLevel = 0, // 0-1
  emotion = 'neutral',
  rpmAvatarUrl = null,
  text = '', // Text for HeyGen avatar to speak
  onTypeChange = null
}) {
  const [currentType, setCurrentType] = useState(type);

  const handleTypeChange = (newType) => {
    setCurrentType(newType);
    if (onTypeChange) onTypeChange(newType);
  };

  const renderAvatar = () => {
    switch (currentType) {
      case 'rpm':
        if (!rpmAvatarUrl) {
          return (
            <div className="text-white text-center p-4">
              <p>Ready Player Me avatar URL required</p>
              <a
                href="https://readyplayer.me/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 underline"
              >
                Create Avatar
              </a>
            </div>
          );
        }
        return (
          <Canvas camera={{ position: [0, 0, 3], fov: 50 }}>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} />
            <ReadyPlayerMeAvatar
              avatarUrl={rpmAvatarUrl}
              isSpeaking={isSpeaking}
              audioLevel={audioLevel}
            />
            <OrbitControls enableZoom={false} />
          </Canvas>
        );

      case '3d':
        return (
          <Canvas camera={{ position: [0, 1, 3], fov: 50 }}>
            <ambientLight intensity={0.3} />
            <pointLight position={[10, 10, 10]} intensity={0.5} />
            <spotLight position={[0, 5, 5]} angle={0.3} intensity={1} />
            <Custom3DAvatar isSpeaking={isSpeaking} audioLevel={audioLevel} />
            <OrbitControls enableZoom={false} />
          </Canvas>
        );

      case 'svg':
        return (
          <div className="flex items-center justify-center h-full">
            <AnimatedSVGAvatar
              isSpeaking={isSpeaking}
              audioLevel={audioLevel}
              emotion={emotion}
            />
          </div>
        );

      case 'heygen':
        return (
          <div className="w-full h-full">
            <HeyGenAvatar
              isSpeaking={isSpeaking}
              text={text}
              onAvatarReady={() => console.log('[JODA] HeyGen avatar ready')}
              onError={(err) => console.error('[JODA] HeyGen error:', err)}
            />
          </div>
        );

      case 'holographic':
      default:
        return (
          <div className="flex items-center justify-center h-full">
            <HolographicAvatar
              isSpeaking={isSpeaking}
              audioLevel={audioLevel}
            />
          </div>
        );
    }
  };

  return (
    <div className="w-full h-full bg-black/30 backdrop-blur-sm rounded-lg overflow-hidden relative">
      {renderAvatar()}

      {/* Avatar Type Selector */}
      <div className="absolute top-4 right-4 flex gap-2">
        {['holographic', 'svg', '3d', 'heygen', 'rpm'].map((avatarType) => (
          <button
            key={avatarType}
            onClick={() => handleTypeChange(avatarType)}
            className={`
              px-3 py-1 rounded text-xs font-mono uppercase transition-colors
              ${currentType === avatarType
                ? 'bg-cyan-500 text-black'
                : 'bg-black/50 text-cyan-400 hover:bg-cyan-500/20'
              }
            `}
          >
            {avatarType}
          </button>
        ))}
      </div>

      {/* Audio level indicator */}
      {isSpeaking && (
        <div className="absolute bottom-4 left-4 right-4">
          <div className="h-1 bg-black/50 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
              initial={{ width: 0 }}
              animate={{ width: `${audioLevel * 100}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
