import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Text, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

/**
 * XRPanel — Native Three.js panel for immersive XR sessions.
 *
 * Uses plain R3F meshes (not @react-three/uikit) so that pointer events
 * from @react-three/xr (gaze, transient-pointer, hand tracking) work
 * reliably on Vision Pro and other headsets.
 *
 * Supports grab-to-reposition via the top handle bar.
 */

export default function XRPanel({
  id,
  position = [0, 1.5, -2],
  width = 0.6,
  height = 0.5,
  onMove,
  faceUser = false,
  children,
}) {
  const groupRef = useRef();
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef(new THREE.Vector3());
  const pointerIdRef = useRef(null);

  // Auto-face user on mount
  useEffect(() => {
    if (faceUser && groupRef.current) {
      groupRef.current.lookAt(0, 1.5, 0);
    }
  }, [faceUser]);

  const onPointerDown = useCallback((e) => {
    e.stopPropagation();
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = e.pointerId;
    setDragging(true);
    e.target?.setPointerCapture?.(e.pointerId);
    if (groupRef.current && e.point) {
      dragOffset.current.copy(groupRef.current.position).sub(e.point);
    }
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragging || e.pointerId !== pointerIdRef.current) return;
    e.stopPropagation();
    if (groupRef.current && e.point) {
      groupRef.current.position.copy(e.point).add(dragOffset.current);
    }
  }, [dragging]);

  const onPointerUp = useCallback((e) => {
    if (e.pointerId !== pointerIdRef.current) return;
    e.stopPropagation();
    e.target?.releasePointerCapture?.(e.pointerId);
    pointerIdRef.current = null;
    setDragging(false);
    if (groupRef.current && onMove) {
      const p = groupRef.current.position;
      onMove(id, [p.x, p.y, p.z]);
    }
  }, [id, onMove]);

  // Panel dimensions in meters
  const panelW = width;
  const panelH = height;
  const handleH = 0.035;
  const padding = 0.01;

  const bgMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#0a0f1e',
    transparent: true,
    opacity: 0.85,
    toneMapped: false,
    side: THREE.DoubleSide,
  }), []);

  const borderMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#22d3ee',
    transparent: true,
    opacity: 0.3,
    toneMapped: false,
    side: THREE.DoubleSide,
  }), []);

  const handleMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#22d3ee',
    transparent: true,
    opacity: 0.15,
    toneMapped: false,
    side: THREE.DoubleSide,
  }), []);

  return (
    <group ref={groupRef} position={position}>
      {/* Panel border (slightly larger behind) */}
      <mesh material={borderMaterial} position={[0, 0, -0.002]}>
        <planeGeometry args={[panelW + 0.004, panelH + 0.004]} />
      </mesh>

      {/* Panel background */}
      <mesh material={bgMaterial} position={[0, 0, -0.001]}>
        <planeGeometry args={[panelW, panelH]} />
      </mesh>

      {/* Grab handle bar at top */}
      <mesh
        material={handleMaterial}
        position={[0, panelH / 2 - handleH / 2 - padding, 0.001]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <planeGeometry args={[panelW - padding * 2, handleH]} />
      </mesh>

      {/* Handle label */}
      <Text
        position={[0, panelH / 2 - handleH / 2 - padding, 0.002]}
        fontSize={0.011}
        color="rgba(34, 211, 238, 0.8)"
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
      >
        {id.toUpperCase()}
      </Text>

      {/* Content area — offset below handle */}
      <group position={[0, -handleH / 2, 0.003]}>
        {children}
      </group>
    </group>
  );
}
