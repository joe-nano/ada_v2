import React, { useRef, useState, useCallback } from 'react';
import { Container, Text } from '@react-three/uikit';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * XRPanel — WebGL-rendered panel for immersive XR sessions.
 *
 * Uses @react-three/uikit <Container> instead of drei <Html> (which doesn't
 * render in immersive WebXR sessions). Supports grab-to-reposition via
 * standard R3F pointer events (works with both hand tracking and controllers).
 */

export default function XRPanel({
  id,
  position = [0, 1.5, -2],
  width = 0.6,
  height = 0.5,
  onMove,
  children,
}) {
  const groupRef = useRef();
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef(new THREE.Vector3());
  const pointerIdRef = useRef(null);

  const onPointerDown = useCallback((e) => {
    e.stopPropagation();
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = e.pointerId;
    setDragging(true);

    // Capture pointer for smooth tracking
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

  return (
    <group ref={groupRef} position={position}>
      <Container
        flexDirection="column"
        width={width * 1000}
        height={height * 1000}
        backgroundColor="rgba(10, 15, 30, 0.85)"
        backgroundOpacity={0.85}
        borderRadius={16}
        borderWidth={1}
        borderColor="rgba(34, 211, 238, 0.3)"
        padding={12}
      >
        {/* Grab handle */}
        <Container
          flexDirection="row"
          height={32}
          width="100%"
          backgroundColor="rgba(34, 211, 238, 0.1)"
          borderRadius={8}
          alignItems="center"
          justifyContent="center"
          marginBottom={8}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          cursor="grab"
        >
          <Text fontSize={11} fontWeight="bold" color="rgba(34, 211, 238, 0.8)">
            {id.toUpperCase()}
          </Text>
        </Container>

        {/* Content area */}
        <Container flexDirection="column" flexGrow={1} width="100%">
          {children}
        </Container>
      </Container>
    </group>
  );
}
