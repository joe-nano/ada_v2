import React, { useState, useCallback } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

/**
 * XRGenericPanel — Native Three.js placeholder panel for XR.
 * Shows title, optional status, and close button.
 */
export default function XRGenericPanel({ title = 'Panel', status, onClose }) {
  const [closeHovered, setCloseHovered] = useState(false);

  const handleCloseEnter = useCallback(() => setCloseHovered(true), []);
  const handleCloseLeave = useCallback(() => setCloseHovered(false), []);
  const handleClose = useCallback((e) => {
    e?.stopPropagation?.();
    onClose?.();
  }, [onClose]);

  return (
    <group>
      {/* Title */}
      <Text
        position={[-0.15, 0.08, 0]}
        fontSize={0.013}
        color="#22d3ee"
        anchorX="left"
        anchorY="middle"
        fontWeight="bold"
      >
        {title}
      </Text>

      {/* Close button */}
      {onClose && (
        <group position={[0.17, 0.08, 0]}>
          <mesh
            onPointerEnter={handleCloseEnter}
            onPointerLeave={handleCloseLeave}
            onPointerDown={handleClose}
            onClick={handleClose}
          >
            <planeGeometry args={[0.03, 0.025]} />
            <meshBasicMaterial
              color={closeHovered ? '#ef4444' : '#1e293b'}
              transparent
              opacity={closeHovered ? 0.8 : 0.6}
              toneMapped={false}
            />
          </mesh>
          <Text
            position={[0, 0, 0.001]}
            fontSize={0.012}
            color="#ef4444"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
          >
            X
          </Text>
        </group>
      )}

      {/* Status */}
      {status && (
        <group position={[0, 0.03, 0]}>
          <mesh>
            <planeGeometry args={[0.35, 0.03]} />
            <meshBasicMaterial color="#1e293b" transparent opacity={0.6} toneMapped={false} />
          </mesh>
          <Text
            position={[0, 0, 0.001]}
            fontSize={0.01}
            color="#94a3b8"
            anchorX="center"
            anchorY="middle"
          >
            {status}
          </Text>
        </group>
      )}

      {/* Voice prompt */}
      <group position={[0, -0.03, 0]}>
        <mesh>
          <planeGeometry args={[0.3, 0.04]} />
          <meshBasicMaterial color="#1e293b" transparent opacity={0.4} toneMapped={false} />
        </mesh>
        <Text
          position={[0, 0, 0.001]}
          fontSize={0.009}
          color="#64748b"
          anchorX="center"
          anchorY="middle"
        >
          Use voice commands to interact
        </Text>
      </group>
    </group>
  );
}
