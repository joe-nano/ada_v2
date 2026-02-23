import React, { Suspense, useState, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { BeautifulAvatar } from './BeautifulAvatar';
import { FullBodyAvatar } from './FullBodyAvatar';

/**
 * AvatarErrorBoundary — Catches errors from GLB-based avatars (e.g. missing
 * model files) and renders AvatarFallback instead of crashing the Canvas.
 */
class AvatarErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.warn('[AvatarErrorBoundary] Avatar failed to load, showing fallback:', error?.message);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

/**
 * AvatarSwitch - Renders the correct avatar mesh inside the unified Canvas.
 *
 * KEY ARCHITECTURE: Receives refs (not state) for audio/speaking data.
 * A RefBridge component reads refs in useFrame and provides local state
 * scoped to the avatar subtree only. This prevents high-frequency audio
 * updates from triggering re-renders of the sibling panel components.
 */

/**
 * RefBridge — reads from refs in useFrame and pushes to local state.
 * Re-renders are scoped to this subtree only (avatar), not panels.
 */
function RefBridge({ audioDataRef, isSpeakingRef, speakingTextRef, children }) {
  const [audioData, setAudioData] = useState([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingText, setSpeakingText] = useState('');
  const lastSpeaking = useRef(false);
  const lastText = useRef('');
  const frameCount = useRef(0);

  useFrame(() => {
    frameCount.current++;

    // Always sync isSpeaking (cheap, boolean comparison)
    const nowSpeaking = isSpeakingRef?.current || false;
    if (nowSpeaking !== lastSpeaking.current) {
      lastSpeaking.current = nowSpeaking;
      setIsSpeaking(nowSpeaking);
    }

    // Sync speakingText (cheap, string comparison)
    const nowText = speakingTextRef?.current || '';
    if (nowText !== lastText.current) {
      lastText.current = nowText;
      setSpeakingText(nowText);
    }

    // Sync audioData every other frame (~30fps) to avoid excessive re-renders
    if (frameCount.current % 2 === 0) {
      const nowAudio = audioDataRef?.current;
      if (nowAudio) {
        setAudioData(nowAudio);
      }
    }
  });

  return children({ audioData, isSpeaking, speakingText });
}

// Extracted from JodaAvatar.jsx Custom3DAvatar
function Custom3DAvatar({ isSpeaking, audioLevel }) {
  return (
    <group position={[0, -0.5, 0]}>
      {/* Head */}
      <mesh position={[0, 1.6, 0]} castShadow>
        <boxGeometry args={[0.35, 0.4, 0.35]} />
        <meshStandardMaterial color="#001a33" emissive="#00D9FF" emissiveIntensity={0.4} metalness={0.95} roughness={0.1} />
      </mesh>
      {/* Visor */}
      <mesh position={[0, 1.65, 0.18]}>
        <boxGeometry args={[0.32, 0.15, 0.02]} />
        <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={1.2} transparent opacity={0.9} />
      </mesh>
      {/* Eyes */}
      <mesh position={[-0.08, 1.65, 0.19]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={isSpeaking ? 2.0 : 1.5} />
      </mesh>
      <mesh position={[0.08, 1.65, 0.19]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={isSpeaking ? 2.0 : 1.5} />
      </mesh>
      {/* Jaw */}
      <mesh position={[0, 1.50 - (isSpeaking ? audioLevel * 0.08 : 0), 0.17]} castShadow>
        <boxGeometry args={[0.25, 0.08, 0.05]} />
        <meshStandardMaterial color="#001a33" emissive="#00D9FF" emissiveIntensity={0.3} metalness={0.95} roughness={0.1} />
      </mesh>
      {/* Mouth indicator */}
      <mesh
        position={[0, 1.52 - (isSpeaking ? audioLevel * 0.08 : 0), 0.19]}
        scale={[
          isSpeaking ? 0.2 + audioLevel * 0.5 : 0.15,
          isSpeaking ? 0.02 + audioLevel * 0.15 : 0.01,
          0.01,
        ]}
      >
        <boxGeometry />
        <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={isSpeaking ? 2.5 + audioLevel * 3 : 0.5} />
      </mesh>
      {/* Neck */}
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.2, 16]} />
        <meshStandardMaterial color="#000814" emissive="#00D9FF" emissiveIntensity={0.3} metalness={0.95} roughness={0.1} />
      </mesh>
      {/* Shoulders */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[0.7, 0.35, 0.3]} />
        <meshStandardMaterial color="#001a33" emissive="#00D9FF" emissiveIntensity={0.25} metalness={0.95} roughness={0.15} />
      </mesh>
      {/* Chest Core */}
      <mesh position={[0, 1.0, 0.16]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={isSpeaking ? 2.5 : 1.8} />
      </mesh>
      {/* Torso */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 0.25]} />
        <meshStandardMaterial color="#000814" emissive="#00D9FF" emissiveIntensity={0.2} metalness={0.95} roughness={0.15} />
      </mesh>
      {/* Waist */}
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[0.4, 0.2, 0.22]} />
        <meshStandardMaterial color="#001a33" emissive="#00D9FF" emissiveIntensity={0.15} metalness={0.95} roughness={0.15} />
      </mesh>
      {/* Arms */}
      <mesh position={[-0.45, 0.95, 0]} rotation={[0, 0, 0.2]}>
        <cylinderGeometry args={[0.08, 0.07, 0.4, 16]} />
        <meshStandardMaterial color="#001a33" emissive="#00D9FF" emissiveIntensity={0.25} metalness={0.95} roughness={0.15} />
      </mesh>
      <mesh position={[-0.55, 0.6, 0]} rotation={[0, 0, 0.1]}>
        <cylinderGeometry args={[0.07, 0.06, 0.35, 16]} />
        <meshStandardMaterial color="#000814" emissive="#00D9FF" emissiveIntensity={0.2} metalness={0.95} roughness={0.15} />
      </mesh>
      <mesh position={[-0.6, 0.38, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={1.0} />
      </mesh>
      <mesh position={[0.45, 0.95, 0]} rotation={[0, 0, -0.2]}>
        <cylinderGeometry args={[0.08, 0.07, 0.4, 16]} />
        <meshStandardMaterial color="#001a33" emissive="#00D9FF" emissiveIntensity={0.25} metalness={0.95} roughness={0.15} />
      </mesh>
      <mesh position={[0.55, 0.6, 0]} rotation={[0, 0, -0.1]}>
        <cylinderGeometry args={[0.07, 0.06, 0.35, 16]} />
        <meshStandardMaterial color="#000814" emissive="#00D9FF" emissiveIntensity={0.2} metalness={0.95} roughness={0.15} />
      </mesh>
      <mesh position={[0.6, 0.38, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={1.0} />
      </mesh>
      {/* Neon accent lines */}
      <mesh position={[-0.15, 0.7, 0.13]}>
        <boxGeometry args={[0.02, 0.4, 0.01]} />
        <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={1.5} />
      </mesh>
      <mesh position={[0.15, 0.7, 0.13]}>
        <boxGeometry args={[0.02, 0.4, 0.01]} />
        <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={1.5} />
      </mesh>
      {/* Lighting */}
      <pointLight position={[0, 1.65, 0.5]} color="#00FFFF" intensity={isSpeaking ? 4 : 3} distance={4} />
      <pointLight position={[0, 1.0, 0.5]} color="#00D9FF" intensity={isSpeaking ? 3 : 2} distance={3} />
    </group>
  );
}

// Fallback loading sphere
function AvatarFallback() {
  return (
    <mesh>
      <sphereGeometry args={[0.5, 16, 16]} />
      <meshStandardMaterial color="#007AFF" emissive="#007AFF" emissiveIntensity={0.3} wireframe />
    </mesh>
  );
}

export default function AvatarSwitch({
  mode = 'avatar-holographic',
  audioDataRef,
  isSpeakingRef,
  speakingTextRef,
  rpmAvatarUrl = '',
}) {
  const xrState = useXR();
  const isInXR = !!(xrState?.session);

  // Html-based avatars don't render in immersive XR sessions — fall back to procedural mesh
  const effectiveMode = (isInXR && (mode === 'avatar-holographic' || mode === 'avatar-svg'))
    ? 'avatar-3d'
    : mode;

  return (
    <RefBridge
      audioDataRef={audioDataRef}
      isSpeakingRef={isSpeakingRef}
      speakingTextRef={speakingTextRef}
    >
      {({ audioData, isSpeaking, speakingText }) => {
        const audioArray = Array.isArray(audioData) ? audioData : [];
        const audioLevel = audioArray.length > 0
          ? Math.min(1, audioArray.reduce((a, b) => a + b, 0) / audioArray.length / 128)
          : 0;

        switch (effectiveMode) {
          case 'avatar-beautiful':
            return (
              <AvatarErrorBoundary fallback={<AvatarFallback />}>
                <Suspense fallback={<AvatarFallback />}>
                  <BeautifulAvatar
                    isSpeaking={isSpeaking}
                    audioData={audioData}
                    speakingText={speakingText}
                    scale={1}
                  />
                </Suspense>
              </AvatarErrorBoundary>
            );

          case 'avatar-fullbody':
            return (
              <AvatarErrorBoundary fallback={<AvatarFallback />}>
                <Suspense fallback={<AvatarFallback />}>
                  <FullBodyAvatar
                    isSpeaking={isSpeaking}
                    audioData={audioData}
                    speakingText={speakingText}
                    scale={1}
                  />
                </Suspense>
              </AvatarErrorBoundary>
            );

          case 'avatar-3d':
            return (
              <Custom3DAvatar isSpeaking={isSpeaking} audioLevel={audioLevel} />
            );

          case 'avatar-holographic':
          case 'avatar-svg':
          default:
            return (
              <Html center sprite>
                <div style={{
                  width: '200px',
                  height: '200px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <div
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: '50%',
                      background: `radial-gradient(circle at 30% 30%, rgba(34, 211, 238, 0.6), rgba(59, 130, 246, 0.3), rgba(0, 255, 255, 0.15))`,
                      border: '2px solid rgba(34, 211, 238, 0.7)',
                      boxShadow: isSpeaking
                        ? '0 0 40px rgba(0, 255, 255, 0.8), inset 0 0 30px rgba(0, 255, 255, 0.3)'
                        : '0 0 20px rgba(0, 255, 255, 0.4), inset 0 0 15px rgba(0, 255, 255, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      animation: isSpeaking ? 'pulse 1s ease-in-out infinite' : 'float 3s ease-in-out infinite',
                    }}
                  >
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: '#22d3ee',
                      boxShadow: '0 0 15px #22d3ee',
                    }} />
                  </div>
                </div>
              </Html>
            );
        }
      }}
    </RefBridge>
  );
}
