import React, { Suspense, Component } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  ContactShadows,
  PerspectiveCamera,
  Loader,
  Html
} from '@react-three/drei';
import { EffectComposer, Bloom, DepthOfField, SSAO } from '@react-three/postprocessing';
import BeautifulAvatar from './BeautifulAvatar';

// Error boundary for avatar loading
class AvatarErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('[AVATAR ERROR BOUNDARY] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Render fallback UI in 3D space
      return (
        <group>
          {/* Fallback animated sphere */}
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[1, 32, 32]} />
            <meshStandardMaterial
              color="#007AFF"
              emissive="#007AFF"
              emissiveIntensity={0.3}
              metalness={0.5}
              roughness={0.3}
            />
          </mesh>

          {/* 3D HTML instructions - persistent overlay */}
          <Html
            center
            position={[0, 0, 2]}
            transform
            occlude={false}
            style={{
              width: '400px',
              pointerEvents: 'auto'
            }}
          >
            <div style={{
              background: 'rgba(255, 255, 255, 0.95)',
              padding: '24px',
              borderRadius: '16px',
              border: '1px solid rgba(0, 0, 0, 0.08)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
              color: '#1d1d1f',
              textAlign: 'center',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}>
              <h3 style={{
                margin: '0 0 12px 0',
                fontSize: '20px',
                color: '#007AFF',
                fontWeight: 'bold'
              }}>
                ✨ Beautiful Avatar Mode
              </h3>

              <p style={{
                margin: '0 0 16px 0',
                fontSize: '13px',
                opacity: 0.9
              }}>
                No avatar model found. Add a Ready Player Me avatar to get started!
              </p>

              <div style={{
                textAlign: 'left',
                fontSize: '12px',
                opacity: 0.8,
                marginBottom: '16px',
                lineHeight: '1.6'
              }}>
                <p style={{ margin: '8px 0', fontWeight: 'bold', color: '#007AFF' }}>Quick Start:</p>
                <p style={{ margin: '4px 0' }}>1. Visit <a href="https://readyplayer.me/avatar" target="_blank" rel="noopener" style={{ color: '#007AFF', textDecoration: 'underline' }}>readyplayer.me/avatar</a></p>
                <p style={{ margin: '4px 0' }}>2. Create your avatar</p>
                <p style={{ margin: '4px 0' }}>3. Download as GLB</p>
                <p style={{ margin: '4px 0' }}>4. Save to <code style={{ background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}>/public/models/joda-avatar.glb</code></p>
              </div>

              <p style={{
                margin: '12px 0 0 0',
                fontSize: '11px',
                fontStyle: 'italic',
                color: '#007AFF',
                opacity: 0.7
              }}>
                Showing fallback preview sphere...
              </p>

              <p style={{
                margin: '8px 0 0 0',
                fontSize: '10px',
                opacity: 0.5
              }}>
                Drag to rotate • Scroll to zoom
              </p>
            </div>
          </Html>
        </group>
      );
    }

    return this.props.children;
  }
}

/**
 * AvatarExperience - Complete scene setup for beautiful 3D avatar
 *
 * Features:
 * - Studio lighting for beauty
 * - Post-processing effects (Bloom, DOF, SSAO)
 * - Camera controls
 * - Tron-style aesthetic (electric blue glow, dark backgrounds)
 */

export function AvatarExperience({
  audioData = [],
  lipsyncData = null,
  isSpeaking = false,
  expression = 'neutral',
  modelUrl,
  enableEffects = true,
  theme = 'natural', // 'tron', 'natural', or 'studio'
  speakingText = '' // 🔥 NEW: Text being spoken for text-based lip sync
}) {
  // Theme-based lighting configurations
  const themes = {
    tron: {
      background: '#000814',
      keyLight: { color: '#007AFF', intensity: 1.5 },
      fillLight: { color: '#0080FF', intensity: 0.8 },
      rimLight: { color: '#00FFFF', intensity: 1.2 },
      ambientIntensity: 0.3
    },
    natural: {
      background: '#f0f0f0',
      keyLight: { color: '#ffffff', intensity: 1.0 },
      fillLight: { color: '#ffd4a3', intensity: 0.5 },
      rimLight: { color: '#ffffff', intensity: 0.7 },
      ambientIntensity: 0.5
    },
    studio: {
      background: '#1a1a1a',
      keyLight: { color: '#ffffff', intensity: 1.2 },
      fillLight: { color: '#ffd4a3', intensity: 0.6 },
      rimLight: { color: '#ffffff', intensity: 1.0 },
      ambientIntensity: 0.4
    }
  };

  const currentTheme = themes[theme] || themes.natural;

  return (
    <div className="w-full h-full relative" style={{ background: 'transparent' }}>
      <Canvas
        dpr={[1, 2]} // Adaptive pixel ratio for performance
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance'
        }}
        style={{ background: 'transparent' }}
      >
        {/* Camera setup */}
        <PerspectiveCamera
          makeDefault
          position={[0, 0, 3]}
          fov={35}
        />

        {/* Ambient light */}
        <ambientLight intensity={currentTheme.ambientIntensity} />

        {/* Studio lighting setup */}
        {/* Key light - main light source (45° from subject) */}
        <directionalLight
          position={[5, 5, 5]}
          intensity={currentTheme.keyLight.intensity}
          color={currentTheme.keyLight.color}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-10}
          shadow-camera-right={10}
          shadow-camera-top={10}
          shadow-camera-bottom={-10}
        />

        {/* Fill light - softens shadows (opposite side) */}
        <pointLight
          position={[-3, 2, -3]}
          intensity={currentTheme.fillLight.intensity}
          color={currentTheme.fillLight.color}
        />

        {/* Rim/Back light - separation from background */}
        <spotLight
          position={[0, 4, -4]}
          angle={0.3}
          penumbra={1}
          intensity={currentTheme.rimLight.intensity}
          color={currentTheme.rimLight.color}
        />

        {/* Additional accent lights for Tron theme */}
        {theme === 'tron' && (
          <>
            <pointLight
              position={[-5, 0, 2]}
              intensity={0.5}
              color="#00FFFF"
            />
            <pointLight
              position={[5, 0, 2]}
              intensity={0.5}
              color="#0080FF"
            />
          </>
        )}

        {/* Avatar - Isolated, no environment */}
        <AvatarErrorBoundary>
          <Suspense fallback={null}>
            <BeautifulAvatar
              modelUrl={modelUrl}
              audioData={audioData}
              lipsyncData={lipsyncData}
              isSpeaking={isSpeaking}
              expression={expression}
              scale={1}
              speakingText={speakingText}
            />
          </Suspense>
        </AvatarErrorBoundary>

        {/* Camera controls - allows user to rotate/zoom */}
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={2}
          maxDistance={5}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI / 2}
          target={[0, 0.5, 0]}
        />
      </Canvas>

      {/* Loader component */}
      <Loader
        containerStyles={{
          background: 'transparent'
        }}
        innerStyles={{
          background: '#007AFF'
        }}
        barStyles={{
          background: '#007AFF'
        }}
        dataStyles={{
          color: '#ffffff'
        }}
      />
    </div>
  );
}

export default AvatarExperience;
