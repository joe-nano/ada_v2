import React, { Suspense, Component } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  OrbitControls,
  ContactShadows,
  PerspectiveCamera,
  Loader,
  Html
} from '@react-three/drei';
import FullBodyAvatar from './FullBodyAvatar';

class FullBodyErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('[FULLBODY ERROR BOUNDARY]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <group>
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[1, 32, 32]} />
            <meshStandardMaterial color="#007AFF" emissive="#007AFF" emissiveIntensity={0.3} metalness={0.5} roughness={0.3} />
          </mesh>
          <Html center position={[0, 0, 2]} transform occlude={false} style={{ width: '350px', pointerEvents: 'auto' }}>
            <div style={{
              background: 'rgba(255,255,255,0.95)',
              padding: '24px',
              borderRadius: '16px',
              border: '1px solid rgba(0,0,0,0.08)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
              color: '#1d1d1f',
              textAlign: 'center',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', color: '#007AFF', fontWeight: 'bold' }}>
                Full Body Avatar
              </h3>
              <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#666' }}>
                No full-body model found. Place a GLB model at:
              </p>
              <code style={{
                background: 'rgba(0,0,0,0.05)',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#333'
              }}>
                /public/models/joda-fullbody.glb
              </code>
              <p style={{ margin: '12px 0 0', fontSize: '11px', color: '#999' }}>
                Use a Ready Player Me full-body avatar or any rigged GLB with Mixamo animations.
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
 * FullBodyAvatarExperience - Scene wrapper for full-body avatar
 *
 * Camera pulled back to frame full body, natural lighting,
 * contact shadows for grounding, minimal post-processing.
 */
export function FullBodyAvatarExperience({
  audioData = [],
  lipsyncData = null,
  isSpeaking = false,
  isProcessing = false,
  expression = 'neutral',
  modelUrl = '/models/joda-fullbody.glb',
  speakingText = ''
}) {
  return (
    <div className="w-full h-full relative" style={{ background: 'transparent' }}>
      <Canvas
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance'
        }}
        style={{ background: 'transparent' }}
      >
        {/* Camera: pulled back for full-body framing */}
        <PerspectiveCamera
          makeDefault
          position={[0, 0.8, 4.5]}
          fov={35}
        />

        {/* Natural soft lighting */}
        <ambientLight intensity={0.5} />

        {/* Key light */}
        <directionalLight
          position={[5, 5, 5]}
          intensity={1.0}
          color="#ffffff"
          castShadow
          shadow-mapSize={[2048, 2048]}
        />

        {/* Fill light */}
        <pointLight
          position={[-3, 2, -3]}
          intensity={0.5}
          color="#ffd4a3"
        />

        {/* Rim light */}
        <spotLight
          position={[0, 4, -4]}
          angle={0.3}
          penumbra={1}
          intensity={0.7}
          color="#ffffff"
        />

        {/* Contact shadows for grounding */}
        <ContactShadows
          position={[0, -1, 0]}
          opacity={0.4}
          scale={10}
          blur={2.5}
          far={4}
          color="#000000"
        />

        {/* Avatar */}
        <FullBodyErrorBoundary>
          <Suspense fallback={null}>
            <FullBodyAvatar
              modelUrl={modelUrl}
              audioData={audioData}
              lipsyncData={lipsyncData}
              isSpeaking={isSpeaking}
              isProcessing={isProcessing}
              expression={expression}
              scale={1}
              speakingText={speakingText}
            />
          </Suspense>
        </FullBodyErrorBoundary>

        {/* Camera controls */}
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={2.5}
          maxDistance={7}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 1.8}
          target={[0, 0.3, 0]}
        />
      </Canvas>

      <Loader
        containerStyles={{ background: 'transparent' }}
        innerStyles={{ background: '#007AFF' }}
        barStyles={{ background: '#007AFF' }}
        dataStyles={{ color: '#666' }}
      />
    </div>
  );
}

export default FullBodyAvatarExperience;
