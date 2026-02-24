import React, { useRef } from 'react';

/**
 * GazeCollider - Invisible collision proxy mesh for a SpatialPanel.
 *
 * drei <Html> panels can't be raycasted because they're CSS overlays.
 * This places an invisible plane at the panel's 3D position so the
 * GazeRay raycaster can detect gaze intersections.
 *
 * Pixel-to-world conversion: at distanceFactor=5 (used in SpatialPanel's
 * <Html transform distanceFactor={5}>), 1 world unit ~ 200px. So we
 * divide pixel dimensions by 200 to get world units.
 */
const PX_TO_WORLD = 1 / 200;

export default function GazeCollider({ panelId, position, width = 420, height = 500 }) {
  const meshRef = useRef();
  const worldW = width * PX_TO_WORLD;
  const worldH = height * PX_TO_WORLD;

  return (
    <mesh
      ref={meshRef}
      position={position}
      userData={{ gazeTargetId: panelId }}
      visible={false}
    >
      <planeGeometry args={[worldW, worldH]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
}
