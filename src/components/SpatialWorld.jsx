import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, XROrigin, useXR } from '@react-three/xr';
import { xrStore } from '../xrStore';
import { SpatialContext } from './spatialContext';
import SpatialPanel from './SpatialPanel';
import AvatarController from './AvatarController';
import AvatarSwitch from './AvatarSwitch';
import XRAudioBridge from './XRAudioBridge';

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
  // Spatial tracking disabled — useSpatialTracking's require('three') conflicts
  // with Vite/R3F's pre-bundled copy, creating duplicate React instances.
  const spatialTracking = useMemo(() => ({ active: false, poseRef: { current: null }, request: () => {} }), []);

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

  // Stable portal container for drei <Html> — prevents portal teardown
  // when XR's events.connected changes the default target.
  const portalRef = useRef(null);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    if (portalRef.current) setPortalReady(true);
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const spatialContextValue = useMemo(
    () => ({ disableCamera, enableCamera, portalRef }),
    [disableCamera, enableCamera]
  );

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Stable portal target for drei Html panels — sits above the Canvas */}
      <div
        ref={portalRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
          zIndex: 1,
        }}
      />
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 3, 8], fov: 60 }}
        style={{ width: '100%', height: '100%' }}
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
