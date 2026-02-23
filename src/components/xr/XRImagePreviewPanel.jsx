import React, { useState, useCallback } from 'react';
import { Text } from '@react-three/drei';

/**
 * XRImagePreviewPanel — Native Three.js image generation status for XR.
 */
export default function XRImagePreviewPanel({ status, prompt, provider, error, onClose }) {
  const [closeHovered, setCloseHovered] = useState(false);

  const statusColor =
    status === 'complete' ? '#4ade80' :
    status === 'error' ? '#ef4444' :
    '#22d3ee';

  const statusText =
    status === 'generating' ? 'Generating...' :
    status === 'complete' ? 'Complete' :
    status === 'error' ? 'Error' :
    status || 'Idle';

  return (
    <group>
      {/* Title */}
      <Text
        position={[-0.15, 0.1, 0]}
        fontSize={0.013}
        color="#22d3ee"
        anchorX="left"
        anchorY="middle"
        fontWeight="bold"
      >
        Image Preview
      </Text>

      {/* Close button */}
      {onClose && (
        <group position={[0.17, 0.1, 0]}>
          <mesh
            onPointerEnter={() => setCloseHovered(true)}
            onPointerLeave={() => setCloseHovered(false)}
            onPointerDown={(e) => { e.stopPropagation(); onClose(); }}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          >
            <planeGeometry args={[0.03, 0.025]} />
            <meshBasicMaterial
              color={closeHovered ? '#ef4444' : '#1e293b'}
              transparent
              opacity={closeHovered ? 0.8 : 0.6}
              toneMapped={false}
            />
          </mesh>
          <Text position={[0, 0, 0.001]} fontSize={0.012} color="#ef4444" anchorX="center" anchorY="middle" fontWeight="bold">
            X
          </Text>
        </group>
      )}

      {/* Status indicator */}
      <group position={[-0.15, 0.06, 0]}>
        <mesh position={[0, 0, 0]}>
          <circleGeometry args={[0.005, 16]} />
          <meshBasicMaterial color={statusColor} toneMapped={false} />
        </mesh>
        <Text
          position={[0.02, 0, 0.001]}
          fontSize={0.01}
          color={statusColor}
          anchorX="left"
          anchorY="middle"
          fontWeight="bold"
        >
          {statusText}
        </Text>
        {provider && (
          <Text
            position={[0.14, 0, 0.001]}
            fontSize={0.008}
            color="#64748b"
            anchorX="left"
            anchorY="middle"
          >
            via {provider}
          </Text>
        )}
      </group>

      {/* Prompt */}
      {prompt && (
        <group position={[0, 0.02, 0]}>
          <mesh>
            <planeGeometry args={[0.35, 0.04]} />
            <meshBasicMaterial color="#1e293b" transparent opacity={0.6} toneMapped={false} />
          </mesh>
          <Text
            position={[0, 0, 0.001]}
            fontSize={0.009}
            color="#94a3b8"
            anchorX="center"
            anchorY="middle"
            maxWidth={0.33}
          >
            {(prompt || '').slice(0, 150)}{(prompt || '').length > 150 ? '...' : ''}
          </Text>
        </group>
      )}

      {/* Error */}
      {error && (
        <group position={[0, -0.03, 0]}>
          <mesh>
            <planeGeometry args={[0.35, 0.03]} />
            <meshBasicMaterial color="#3b1111" transparent opacity={0.6} toneMapped={false} />
          </mesh>
          <Text
            position={[0, 0, 0.001]}
            fontSize={0.009}
            color="#ef4444"
            anchorX="center"
            anchorY="middle"
            maxWidth={0.33}
          >
            {error}
          </Text>
        </group>
      )}

      {/* Note */}
      <Text
        position={[0, -0.07, 0]}
        fontSize={0.008}
        color="#475569"
        anchorX="center"
        anchorY="middle"
      >
        View generated images in the Media Gallery
      </Text>
    </group>
  );
}
