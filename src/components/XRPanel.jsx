import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * XRPanel — Native Three.js panel for immersive XR sessions.
 *
 * Interactions:
 *   - ONE hand on top handle bar → drag to reposition
 *   - TWO hands on panel body   → pinch apart/together to resize,
 *                                  twist to rotate (all 3 axes)
 *
 * Two-pointer gesture math:
 *   scale  = currentDistance / initialDistance  → uniform resize
 *   rotate = quaternion delta from initial midpoint-aligned frame
 */

// Resize constraints in meters
const MIN_W = 0.15;
const MAX_W = 1.2;
const MIN_H = 0.1;
const MAX_H = 1.0;

export default function XRPanel({
  id,
  position = [0, 1.5, -2],
  width = 0.6,
  height = 0.5,
  onMove,
  onResize,
  onRotate,
  faceUser = false,
  children,
}) {
  const groupRef = useRef();

  // --- Single-hand drag state (top handle) ---
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef(new THREE.Vector3());
  const dragPointerIdRef = useRef(null);

  // --- Two-hand gesture state (panel body) ---
  const pointers = useRef(new Map()); // pointerId → { point: Vector3 }
  const gestureActive = useRef(false);
  const gestureInitialDist = useRef(1);
  const gestureInitialW = useRef(width);
  const gestureInitialH = useRef(height);
  const gestureInitialQuat = useRef(new THREE.Quaternion());
  const gestureInitialUp = useRef(new THREE.Vector3());     // initial "up" of the two-pointer line
  const gestureInitialRight = useRef(new THREE.Vector3());   // initial "right" (line direction)

  // --- Local dimensions (reactive during gesture) ---
  const [localW, setLocalW] = useState(width);
  const [localH, setLocalH] = useState(height);
  const [gestureResizing, setGestureResizing] = useState(false);

  // Sync from props when not actively gesturing
  useEffect(() => {
    if (!gestureResizing) {
      setLocalW(width);
      setLocalH(height);
    }
  }, [width, height, gestureResizing]);

  // Auto-face user on mount
  useEffect(() => {
    if (faceUser && groupRef.current) {
      groupRef.current.lookAt(0, 1.5, 0);
    }
  }, [faceUser]);

  // ============================
  //  SINGLE-HAND DRAG (top bar)
  // ============================
  const onDragPointerDown = useCallback((e) => {
    e.stopPropagation();
    if (dragPointerIdRef.current !== null) return;
    dragPointerIdRef.current = e.pointerId;
    setDragging(true);
    e.target?.setPointerCapture?.(e.pointerId);
    if (groupRef.current && e.point) {
      dragOffset.current.copy(groupRef.current.position).sub(e.point);
    }
  }, []);

  const onDragPointerMove = useCallback((e) => {
    if (!dragging || e.pointerId !== dragPointerIdRef.current) return;
    e.stopPropagation();
    if (groupRef.current && e.point) {
      groupRef.current.position.copy(e.point).add(dragOffset.current);
    }
  }, [dragging]);

  const onDragPointerUp = useCallback((e) => {
    if (e.pointerId !== dragPointerIdRef.current) return;
    e.stopPropagation();
    e.target?.releasePointerCapture?.(e.pointerId);
    dragPointerIdRef.current = null;
    setDragging(false);
    if (groupRef.current && onMove) {
      const p = groupRef.current.position;
      onMove(id, [p.x, p.y, p.z]);
    }
  }, [id, onMove]);

  // ============================
  //  TWO-HAND GESTURE (body)
  // ============================

  // Helper: get the two pointer entries as an array
  const getTwoPointers = useCallback(() => {
    if (pointers.current.size < 2) return null;
    const entries = Array.from(pointers.current.values());
    return [entries[0], entries[1]];
  }, []);

  // Start / update gesture when second pointer arrives
  const beginGesture = useCallback(() => {
    const two = getTwoPointers();
    if (!two) return;

    const [a, b] = two;
    gestureInitialDist.current = a.point.distanceTo(b.point) || 0.001;
    gestureInitialW.current = localW;
    gestureInitialH.current = localH;

    if (groupRef.current) {
      gestureInitialQuat.current.copy(groupRef.current.quaternion);
    }

    // Build initial frame from two-pointer line
    const dir = new THREE.Vector3().subVectors(b.point, a.point).normalize();
    gestureInitialRight.current.copy(dir);
    // "Up" perpendicular to line in the plane facing the camera
    const mid = new THREE.Vector3().addVectors(a.point, b.point).multiplyScalar(0.5);
    const toCamera = new THREE.Vector3(0, 1.5, 0).sub(mid).normalize();
    gestureInitialUp.current.crossVectors(dir, toCamera).normalize();

    gestureActive.current = true;
    setGestureResizing(true);
  }, [getTwoPointers, localW, localH]);

  const onBodyPointerDown = useCallback((e) => {
    e.stopPropagation();
    e.target?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { point: e.point.clone() });

    if (pointers.current.size === 2) {
      beginGesture();
    }
  }, [beginGesture]);

  const onBodyPointerMove = useCallback((e) => {
    e.stopPropagation();
    const entry = pointers.current.get(e.pointerId);
    if (!entry) return;
    entry.point.copy(e.point);

    if (!gestureActive.current || pointers.current.size < 2) return;

    const two = getTwoPointers();
    if (!two) return;
    const [a, b] = two;

    // --- Scale ---
    const currentDist = a.point.distanceTo(b.point) || 0.001;
    const scaleFactor = currentDist / gestureInitialDist.current;
    const newW = Math.min(MAX_W, Math.max(MIN_W, gestureInitialW.current * scaleFactor));
    const newH = Math.min(MAX_H, Math.max(MIN_H, gestureInitialH.current * scaleFactor));
    setLocalW(newW);
    setLocalH(newH);

    // --- Rotation ---
    if (groupRef.current) {
      const currentDir = new THREE.Vector3().subVectors(b.point, a.point).normalize();
      const initialDir = gestureInitialRight.current;

      // Compute rotation quaternion from initial direction to current direction
      const rotQuat = new THREE.Quaternion().setFromUnitVectors(initialDir, currentDir);

      // Apply: new rotation = delta * initial
      groupRef.current.quaternion.copy(rotQuat).multiply(gestureInitialQuat.current);
    }
  }, [getTwoPointers]);

  const onBodyPointerUp = useCallback((e) => {
    e.stopPropagation();
    e.target?.releasePointerCapture?.(e.pointerId);
    pointers.current.delete(e.pointerId);

    if (pointers.current.size < 2 && gestureActive.current) {
      // Gesture ended
      gestureActive.current = false;
      setGestureResizing(false);

      if (onResize) {
        onResize(id, localW, localH);
      }
      if (onRotate && groupRef.current) {
        const e = groupRef.current.rotation;
        onRotate(id, [e.x, e.y, e.z]);
      }

      // If one pointer remains, re-initialize in case they add a second again
      if (pointers.current.size === 1) {
        // keep tracking for potential next two-hand gesture
      }
    }
  }, [id, onResize, onRotate, localW, localH]);

  // Also clear stale pointers if they wander off
  const onBodyPointerLeave = useCallback((e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2 && gestureActive.current) {
      gestureActive.current = false;
      setGestureResizing(false);
      if (onResize) onResize(id, localW, localH);
      if (onRotate && groupRef.current) {
        const r = groupRef.current.rotation;
        onRotate(id, [r.x, r.y, r.z]);
      }
    }
  }, [id, onResize, onRotate, localW, localH]);

  // Panel dimensions in meters
  const panelW = localW;
  const panelH = localH;
  const handleH = 0.035;
  const padding = 0.01;

  // Visual feedback: show border glow when two hands are on panel
  const gestureHighlight = gestureActive.current && pointers.current.size >= 2;

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
      {/* Panel border — glows brighter during two-hand gesture */}
      <mesh material={borderMaterial} position={[0, 0, -0.002]}>
        <planeGeometry args={[panelW + 0.004, panelH + 0.004]} />
      </mesh>
      {gestureHighlight && (
        <mesh position={[0, 0, -0.003]}>
          <planeGeometry args={[panelW + 0.012, panelH + 0.012]} />
          <meshBasicMaterial
            color="#00ffff"
            transparent
            opacity={0.2}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Panel background — receives two-hand gesture events */}
      <mesh
        material={bgMaterial}
        position={[0, 0, -0.001]}
        onPointerDown={onBodyPointerDown}
        onPointerMove={onBodyPointerMove}
        onPointerUp={onBodyPointerUp}
        onPointerLeave={onBodyPointerLeave}
      >
        <planeGeometry args={[panelW, panelH]} />
      </mesh>

      {/* Grab handle bar at top — single-hand drag */}
      <mesh
        material={handleMaterial}
        position={[0, panelH / 2 - handleH / 2 - padding, 0.001]}
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
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

      {/* Two-hand gesture hint — small icons at bottom corners */}
      <Text
        position={[-panelW / 2 + 0.02, -panelH / 2 + 0.015, 0.002]}
        fontSize={0.008}
        color="rgba(34, 211, 238, 0.4)"
        anchorX="left"
        anchorY="middle"
      >
        {'<< pinch to resize >>'}
      </Text>

      {/* Content area — offset below handle */}
      <group position={[0, -handleH / 2, 0.003]}>
        {children}
      </group>
    </group>
  );
}
