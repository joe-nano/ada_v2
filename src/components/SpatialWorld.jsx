import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, XROrigin, useXR } from '@react-three/xr';
import { xrStore } from '../xrStore';
import { SpatialContext } from './spatialContext';
import SpatialPanel from './SpatialPanel';
import AvatarController from './AvatarController';
import AvatarSwitch from './AvatarSwitch';
import XRAudioBridge from './XRAudioBridge';
import useSpatialTracking from '../hooks/useSpatialTracking';

/**
 * SpatialWorld - The single full-screen Canvas that replaces the entire 2D layout.
 *
 * KEY ARCHITECTURE: Avatar props are passed as REFS (not state) so that
 * high-frequency audio updates (30-60x/sec during speech) do NOT cause
 * React re-renders of the entire Canvas tree. The avatar reads refs in
 * useFrame instead.
 *
 * XR: Scene children are wrapped in <XR store={xrStore}>. On desktop this
 * is a passthrough. In immersive sessions it provides controllers, hands,
 * and pointer events. Avatar placement changes in XR — life-sized at
 * [0, 0, -2.5] facing the user.
 */

function GridFloor() {
  return (
    <group>
      <gridHelper args={[100, 100, '#1a3a5c', '#0a1a2e']} position={[0, 0, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial
          color="#050510"
          transparent
          opacity={0.5}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
}

/**
 * XRAvatarPlacement — In XR, place the avatar life-sized in front of the user
 * without the AvatarController (headset owns the camera).
 */
function XRAvatarPlacement({ avatarMode, avatarPropsRef }) {
  return (
    <group position={[0, 0, -2.0]}>
      <AvatarSwitch
        mode={avatarMode}
        audioDataRef={avatarPropsRef.audioDataRef}
        isSpeakingRef={avatarPropsRef.isSpeakingRef}
        speakingTextRef={avatarPropsRef.speakingTextRef}
        rpmAvatarUrl={avatarPropsRef.rpmAvatarUrl}
      />
    </group>
  );
}

/**
 * SceneContent — Needs to be inside <XR> so useXR() works.
 */
function SceneContent({
  avatarMode,
  avatarPropsRef,
  panels,
  onPanelMove,
  onPanelResize,
  onPanelRotate,
  cameraEnabled,
  audioHandlers,
  spatialTracking,
}) {
  const xrState = useXR();
  const isInXR = !!(xrState?.session);

  return (
    <>
      {/* Background */}
      <color attach="background" args={['#050510']} />
      <fog attach="fog" args={['#050510', 8, 30]} />

      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[-3, 2, -3]} intensity={0.3} color="#ffd4a3" />

      {/* Grid floor */}
      <GridFloor />

      {/* XR origin — establishes the XR reference space */}
      {isInXR && <XROrigin />}

      {/* XR audio lifecycle — resumes AudioContexts on session start/end */}
      {audioHandlers && (
        <XRAudioBridge
          ensureAiAudioContext={audioHandlers.ensureAiAudioContext}
          startMic={audioHandlers.startMic}
          startSpeechRec={audioHandlers.startSpeechRec}
          isMutedRef={audioHandlers.isMutedRef}
          isOpenAiFallbackRef={audioHandlers.isOpenAiFallbackRef}
          selectedSpeakerId={audioHandlers.selectedSpeakerId}
          onSpeakerChange={audioHandlers.onSpeakerChange}
        />
      )}

      {/* Avatar — XR: stationary life-sized, Desktop: with AvatarController */}
      {isInXR ? (
        <XRAvatarPlacement avatarMode={avatarMode} avatarPropsRef={avatarPropsRef} />
      ) : (
        <AvatarController locomotionMode="hover" cameraEnabled={cameraEnabled} spatialTracking={spatialTracking}>
          <AvatarSwitch
            mode={avatarMode}
            audioDataRef={avatarPropsRef.audioDataRef}
            isSpeakingRef={avatarPropsRef.isSpeakingRef}
            speakingTextRef={avatarPropsRef.speakingTextRef}
            rpmAvatarUrl={avatarPropsRef.rpmAvatarUrl}
          />
        </AvatarController>
      )}

      {/* Panels */}
      {panels
        .filter((p) => p.visible)
        .map((p) => (
          <SpatialPanel
            key={p.id}
            id={p.id}
            position={p.position}
            width={p.width}
            height={p.height}
            xrContent={p.xrContent}
            onMove={onPanelMove}
            onResize={onPanelResize}
            onRotate={onPanelRotate}
          >
            {p.content}
          </SpatialPanel>
        ))}
    </>
  );
}

export default function SpatialWorld({
  avatarMode = 'avatar-holographic',
  avatarPropsRef = {},
  panels = [],
  onPanelMove,
  onPanelResize,
  onPanelRotate,
  audioHandlers,
}) {
  // Spatial tracking for Vision Pro non-VR mode
  const spatialTracking = useSpatialTracking();

  // Camera disable/enable for panel dragging
  const cameraEnabledRef = useRef(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const containerRef = useRef();

  const disableCamera = useCallback(() => {
    cameraEnabledRef.current = false;
    setCameraEnabled(false);
  }, []);

  const enableCamera = useCallback(() => {
    cameraEnabledRef.current = true;
    setCameraEnabled(true);
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const spatialContextValue = useMemo(
    () => ({ disableCamera, enableCamera }),
    [disableCamera, enableCamera]
  );

  // Fix visionOS interaction: after R3F mounts, patch the DOM so
  // eye-tracking + pinch can reach the drei <Html> overlay panels.
  const handleCreated = useCallback((state) => {
    const canvas = state.gl.domElement;

    // 1. R3F sets touch-action:none on the canvas which blocks visionOS
    //    gesture recognition on overlaid HTML. Switch to manipulation.
    canvas.style.touchAction = 'manipulation';

    // 2. Ensure the canvas sits in a known stacking layer so drei's
    //    Html portal containers can be reliably placed above it.
    const canvasWrapper = canvas.parentElement;
    if (canvasWrapper) {
      canvasWrapper.style.position = 'relative';
      canvasWrapper.style.zIndex = '0';
    }

    // 3. Fix drei Html portal containers: visionOS system-level hit
    //    testing skips subtrees with pointer-events:none. Patch any
    //    portal siblings to use pointer-events:auto and ensure they
    //    sit above the canvas layer.
    const root = canvasWrapper?.parentElement;
    if (root) {
      Array.from(root.children).forEach((child) => {
        if (child !== canvasWrapper) {
          child.style.zIndex = '1';
          child.style.pointerEvents = 'auto';
        }
      });

      // Re-run when drei adds new portal containers (panels mount later)
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && node !== canvasWrapper) {
              node.style.zIndex = '1';
              node.style.pointerEvents = 'auto';
            }
          }
        }
      });
      observer.observe(root, { childList: true });

      // Cleanup observer when Canvas unmounts (R3F handles this)
      canvas._visionOSObserver = observer;
    }
  }, []);

  // Cleanup the MutationObserver on unmount
  useEffect(() => {
    return () => {
      const container = containerRef.current;
      if (container) {
        const canvas = container.querySelector('canvas');
        if (canvas?._visionOSObserver) {
          canvas._visionOSObserver.disconnect();
        }
      }
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
    <Canvas
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      }}
      camera={{ position: [0, 3, 8], fov: 60 }}
      shadows
      style={{ width: '100%', height: '100%' }}
      onCreated={handleCreated}
    >
      <XR store={xrStore}>
        <SpatialContext.Provider value={spatialContextValue}>
          <SceneContent
            avatarMode={avatarMode}
            avatarPropsRef={avatarPropsRef}
            panels={panels}
            onPanelMove={onPanelMove}
            onPanelResize={onPanelResize}
            onPanelRotate={onPanelRotate}
            cameraEnabled={cameraEnabled}
            audioHandlers={audioHandlers}
            spatialTracking={spatialTracking}
          />
        </SpatialContext.Provider>
      </XR>
    </Canvas>
    </div>
  );
}
