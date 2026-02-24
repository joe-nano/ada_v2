import React, { useRef, useMemo, useCallback, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const tmpVec = new THREE.Vector3();
const RAY_LENGTH = 20;
const DWELL_MS = 800;
const LINE_MATERIAL = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.4 });

/**
 * GazeRay - Head-gaze ray for AVP non-VR (window) mode.
 *
 * Shoots a thin cyan ray from camera center into the scene each frame,
 * raycasts against meshes tagged with userData.gazeTargetId, and reports
 * which panel the user is gazing at. After DWELL_MS of continuous gaze
 * on the same panel, fires onGazeSelect for auto-selection.
 *
 * A click/tap anywhere while gazing at a panel fires onGazeSelect immediately.
 */
export default function GazeRay({ onGazePanel, onGazeSelect, enabled = true }) {
  const lineRef = useRef();
  const reticleRef = useRef();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const dwellTimer = useRef(null);
  const gazeTarget = useRef(null);
  const { gl } = useThree();

  // Line geometry: two points (origin, end) updated each frame
  const lineGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return geo;
  }, []);

  const lineObject = useMemo(() => new THREE.Line(lineGeometry, LINE_MATERIAL), [lineGeometry]);

  // Click/tap to instantly confirm gaze selection
  const handleClick = useCallback(() => {
    if (gazeTarget.current && onGazeSelect) {
      onGazeSelect(gazeTarget.current);
    }
  }, [onGazeSelect]);

  useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('touchend', handleClick);
    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('touchend', handleClick);
    };
  }, [gl, handleClick, enabled]);

  // Cleanup dwell timer on unmount
  useEffect(() => {
    return () => {
      if (dwellTimer.current) clearTimeout(dwellTimer.current);
    };
  }, []);

  useFrame(({ camera, scene }) => {
    if (!enabled) {
      if (lineRef.current) lineRef.current.visible = false;
      if (reticleRef.current) reticleRef.current.visible = false;
      return;
    }

    // Get camera forward direction
    camera.getWorldDirection(tmpVec);

    // Update raycaster
    raycaster.set(camera.position, tmpVec);

    // Update line geometry: from camera to camera + forward * RAY_LENGTH
    const posAttr = lineGeometry.getAttribute('position');
    const arr = posAttr.array;
    // Start point: slightly in front of camera to avoid clipping
    const start = camera.position.clone().add(tmpVec.clone().multiplyScalar(0.5));
    arr[0] = start.x;
    arr[1] = start.y;
    arr[2] = start.z;
    // End point
    const end = camera.position.clone().add(tmpVec.clone().multiplyScalar(RAY_LENGTH));
    arr[3] = end.x;
    arr[4] = end.y;
    arr[5] = end.z;
    posAttr.needsUpdate = true;

    // Raycast against gaze-target meshes
    const hits = raycaster
      .intersectObjects(scene.children, true)
      .filter((h) => h.object.userData.gazeTargetId);

    const hit = hits[0];

    if (hit) {
      const targetId = hit.object.userData.gazeTargetId;

      // Update reticle position at intersection point
      if (reticleRef.current) {
        reticleRef.current.position.copy(hit.point);
        reticleRef.current.visible = true;
        // Face camera
        reticleRef.current.lookAt(camera.position);
      }

      // Shorten ray line to intersection
      arr[3] = hit.point.x;
      arr[4] = hit.point.y;
      arr[5] = hit.point.z;
      posAttr.needsUpdate = true;

      if (targetId !== gazeTarget.current) {
        // New target
        gazeTarget.current = targetId;
        if (onGazePanel) onGazePanel(targetId);

        // Reset dwell timer
        if (dwellTimer.current) clearTimeout(dwellTimer.current);
        dwellTimer.current = setTimeout(() => {
          if (gazeTarget.current === targetId && onGazeSelect) {
            onGazeSelect(targetId);
          }
        }, DWELL_MS);
      }
    } else {
      // No hit
      if (reticleRef.current) reticleRef.current.visible = false;

      if (gazeTarget.current !== null) {
        gazeTarget.current = null;
        if (onGazePanel) onGazePanel(null);
        if (dwellTimer.current) {
          clearTimeout(dwellTimer.current);
          dwellTimer.current = null;
        }
      }
    }

    if (lineRef.current) lineRef.current.visible = true;
  });

  if (!enabled) return null;

  return (
    <>
      {/* Gaze ray line */}
      <primitive ref={lineRef} object={lineObject} />

      {/* Reticle ring at intersection */}
      <mesh ref={reticleRef} visible={false}>
        <ringGeometry args={[0.02, 0.035, 32]} />
        <meshBasicMaterial color="#00e5ff" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}
