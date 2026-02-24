import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

/**
 * XRToolsPanel — Native Three.js mesh buttons for immersive XR.
 *
 * Uses plain R3F meshes instead of @react-three/uikit so that
 * @react-three/xr pointer events (gaze, transient-pointer, hand)
 * can raycast and hit them reliably on Vision Pro.
 *
 * - Gaze/head pointer: onPointerEnter highlights the button
 * - Dwell (800ms): auto-selects while you keep looking
 * - Pinch/click: immediate select
 */

const DWELL_MS = 800;
const BTN_W = 0.07;
const BTN_H = 0.048;
const GAP = 0.006;

function XRButton({ label, active, color = '#22d3ee', onPress, position }) {
  const [hovered, setHovered] = useState(false);
  const meshRef = useRef();
  const dwellTimer = useRef(null);

  useEffect(() => () => clearTimeout(dwellTimer.current), []);

  const handleEnter = useCallback((e) => {
    e.stopPropagation();
    setHovered(true);
    clearTimeout(dwellTimer.current);
    dwellTimer.current = setTimeout(() => {
      onPress?.();
    }, DWELL_MS);
  }, [onPress]);

  const handleLeave = useCallback((e) => {
    e.stopPropagation();
    setHovered(false);
    clearTimeout(dwellTimer.current);
  }, []);

  const lastFireRef = useRef(0);
  const handleClick = useCallback((e) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastFireRef.current < 200) return; // debounce
    lastFireRef.current = now;
    clearTimeout(dwellTimer.current);
    onPress?.();
  }, [onPress]);

  // Colors
  const borderColor = hovered ? '#ffffff' : active ? color : '#475569';
  const bgColor = hovered
    ? '#334155'
    : active
      ? '#1e3a5f'
      : '#0f172a';
  const textColor = hovered ? '#ffffff' : active ? color : '#94a3b8';
  const dotColor = hovered ? '#ffffff' : active ? color : '#475569';
  const scale = hovered ? 1.1 : 1;

  const bgMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    toneMapped: false,
  }), []);

  const borderMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    toneMapped: false,
  }), []);

  // Update materials reactively
  bgMaterial.color.set(bgColor);
  bgMaterial.opacity = hovered ? 0.95 : 0.85;
  borderMaterial.color.set(borderColor);
  borderMaterial.opacity = hovered ? 1 : 0.8;

  return (
    <group position={position} scale={[scale, scale, 1]}>
      {/* Border / outline — slightly larger plane behind */}
      <mesh material={borderMaterial} position={[0, 0, -0.001]}>
        <planeGeometry args={[BTN_W + 0.004, BTN_H + 0.004]} />
      </mesh>

      {/* Button background — the interactive hit target */}
      <mesh
        ref={meshRef}
        material={bgMaterial}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        onClick={handleClick}
      >
        <planeGeometry args={[BTN_W, BTN_H]} />
      </mesh>

      {/* Label */}
      <Text
        position={[0, 0.004, 0.001]}
        fontSize={0.009}
        color={textColor}
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
      >
        {label}
      </Text>

      {/* Status dot */}
      <mesh position={[0, -0.013, 0.001]}>
        <circleGeometry args={[hovered ? 0.004 : 0.003, 16]} />
        <meshBasicMaterial color={dotColor} toneMapped={false} />
      </mesh>

      {/* Gaze highlight ring — visible only when hovered */}
      {hovered && (
        <mesh position={[0, 0, -0.002]}>
          <ringGeometry args={[
            Math.max(BTN_W, BTN_H) * 0.72,
            Math.max(BTN_W, BTN_H) * 0.78,
            32
          ]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

// Layout helpers — compute positions for a row of buttons
function rowPositions(count, y) {
  const totalW = count * BTN_W + (count - 1) * GAP;
  const startX = -totalW / 2 + BTN_W / 2;
  return Array.from({ length: count }, (_, i) => [
    startX + i * (BTN_W + GAP), y, 0
  ]);
}

export default function XRToolsPanel({
  isConnected = true,
  isMuted = false,
  isSpeakerMuted = false,
  isVideoOn = false,
  showSettings = false,
  isHandTrackingEnabled = false,
  showKasaWindow = false,
  showPrinterWindow = false,
  showCadWindow = false,
  showBrowserWindow = false,
  showMediaGallery = false,
  vrPerspective = 'first',
  vrLocomotionMode = 'smooth',
  onTogglePower,
  onToggleMute,
  onToggleSpeaker,
  onToggleVideo,
  onToggleSettings,
  onToggleHand,
  onToggleKasa,
  onTogglePrinter,
  onToggleCad,
  onToggleBrowser,
  onToggleMedia,
  onTogglePerspective,
  onToggleLocomotion,
}) {
  const row1 = useMemo(() => rowPositions(6, 0.03), []);
  const row2 = useMemo(() => rowPositions(5, -0.03), []);
  const row3 = useMemo(() => rowPositions(2, -0.09), []);

  return (
    <group>
      {/* Row 1: Communication controls */}
      <XRButton position={row1[0]} label={isMuted ? 'MIC OFF' : 'MIC ON'} active={!isMuted} color="#22d3ee" onPress={onToggleMute} />
      <XRButton position={row1[1]} label={isSpeakerMuted ? 'SPK OFF' : 'SPK ON'} active={!isSpeakerMuted} color="#a78bfa" onPress={onToggleSpeaker} />
      <XRButton position={row1[2]} label={isVideoOn ? 'VID ON' : 'VID OFF'} active={isVideoOn} color="#facc15" onPress={onToggleVideo} />
      <XRButton position={row1[3]} label="SETTINGS" active={showSettings} color="#f472b6" onPress={onToggleSettings} />
      <XRButton position={row1[4]} label="HAND" active={isHandTrackingEnabled} color="#34d399" onPress={onToggleHand} />
      <XRButton position={row1[5]} label={isConnected ? 'ON' : 'OFF'} active={isConnected} color={isConnected ? '#4ade80' : '#ef4444'} onPress={onTogglePower} />

      {/* Row 2: Window toggles */}
      <XRButton position={row2[0]} label="KASA" active={showKasaWindow} color="#fb923c" onPress={onToggleKasa} />
      <XRButton position={row2[1]} label="PRINTER" active={showPrinterWindow} color="#60a5fa" onPress={onTogglePrinter} />
      <XRButton position={row2[2]} label="CAD" active={showCadWindow} color="#c084fc" onPress={onToggleCad} />
      <XRButton position={row2[3]} label="BROWSER" active={showBrowserWindow} color="#2dd4bf" onPress={onToggleBrowser} />
      <XRButton position={row2[4]} label="MEDIA" active={showMediaGallery} color="#f87171" onPress={onToggleMedia} />

      {/* Row 3: VR navigation */}
      <XRButton position={row3[0]} label={vrPerspective === 'first' ? '1ST PER' : '3RD PER'} active={vrPerspective === 'third'} color="#e879f9" onPress={onTogglePerspective} />
      <XRButton position={row3[1]} label={vrLocomotionMode === 'smooth' ? 'SMOOTH' : 'TELEPORT'} active={vrLocomotionMode === 'teleport'} color="#38bdf8" onPress={onToggleLocomotion} />
    </group>
  );
}
