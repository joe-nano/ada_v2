import React, { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import * as THREE from 'three';

/**
 * AvatarController - Character controller wrapping the avatar mesh.
 *
 * Camera behaviour:
 *   - If spatialTracking is active (Vision Pro non-VR): camera follows
 *     the device's head pose (position + orientation) from the tracking hook.
 *   - Otherwise (desktop):
 *     - Camera is STATIC by default — it does NOT follow the avatar automatically.
 *     - Right-drag: orbit camera around its current look-at point.
 *     - Middle-click drag or Shift+right-drag: pan camera.
 *     - Scroll: zoom in/out.
 *     - Press 'C' to re-center camera on avatar.
 *
 * This keeps panels stable on screen since the camera only moves on explicit user input.
 */

const MOVE_SPEED = 4;
const MOVE_SPEED_FAST = 8;
const LERP_FACTOR = 0.08;
const BOB_SPEED = 2;
const BOB_AMPLITUDE = 0.03;
const HOVER_HEIGHT = 0.05;

const CAM_MIN_DIST = 2;
const CAM_MAX_DIST = 20;

export default function AvatarController({
  locomotionMode = 'hover',
  cameraEnabled = true,
  spatialTracking = null,  // { active, poseRef } from useSpatialTracking
  children,
}) {
  const groupRef = useRef();
  const { camera, gl } = useThree();
  const xrState = useXR();
  const isInXR = !!(xrState?.session);

  // Keyboard state (refs to avoid re-renders)
  const keys = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    shift: false,
  });

  // Movement state
  const velocity = useRef(new THREE.Vector3());
  const clickTarget = useRef(null);

  // Camera orbit state — fully manual, no auto-follow
  const cameraAzimuth = useRef(0);
  const cameraElevation = useRef(0.4);
  const cameraDist = useRef(8);
  const cameraTarget = useRef(new THREE.Vector3(0, 1, 0)); // look-at point
  const isOrbiting = useRef(false);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const cameraInitialized = useRef(false);

  // Keyboard listeners
  useEffect(() => {
    const keyMap = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'backward', ArrowDown: 'backward',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
    };

    const onDown = (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.current.shift = true;
      const dir = keyMap[e.code];
      if (dir) keys.current[dir] = true;

      // Press C to re-center camera on avatar
      if (e.code === 'KeyC' && groupRef.current) {
        const pos = groupRef.current.position;
        cameraTarget.current.set(pos.x, pos.y + 1, pos.z);
      }
    };

    const onUp = (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.current.shift = false;
      const dir = keyMap[e.code];
      if (dir) keys.current[dir] = false;
    };

    // In XR or spatial tracking, headset owns the camera — skip keyboard movement
    if (isInXR || spatialTracking?.active) return;

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [isInXR]);

  // Mouse: right-drag = orbit, middle-drag or shift+right = pan, scroll = zoom
  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (e) => {
      if (e.button === 0) {
        // Left-click: orbit (standard 3D navigation)
        isOrbiting.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
      } else if (e.button === 2) {
        if (e.shiftKey) {
          isPanning.current = true;
        } else {
          isPanning.current = true; // Right-click = pan
        }
        lastMouse.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      } else if (e.button === 1) {
        // Middle click = pan
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    };

    const onPointerMove = (e) => {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };

      if (isOrbiting.current) {
        cameraAzimuth.current -= dx * 0.003;
        cameraElevation.current = Math.max(0.05, Math.min(1.4, cameraElevation.current + dy * 0.003));
      } else if (isPanning.current) {
        // Pan: move camera target in the camera's local XY plane
        const panSpeed = cameraDist.current * 0.002;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        camera.getWorldDirection(right);
        right.cross(up).normalize();

        cameraTarget.current.addScaledVector(right, -dx * panSpeed);
        cameraTarget.current.y += dy * panSpeed;
      }
    };

    const onPointerUp = (e) => {
      if (e.button === 0) {
        isOrbiting.current = false;
      }
      if (e.button === 2) {
        isPanning.current = false;
      }
      if (e.button === 1) {
        isPanning.current = false;
      }
    };

    const onWheel = (e) => {
      cameraDist.current = Math.max(CAM_MIN_DIST, Math.min(CAM_MAX_DIST, cameraDist.current + e.deltaY * 0.005));
    };

    const onContextMenu = (e) => e.preventDefault();

    // In XR or spatial tracking, headset owns the camera — skip mouse controls
    if (isInXR || spatialTracking?.active) return;

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel);
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [gl, camera, isInXR, spatialTracking?.active]);

  // Click-to-move on grid floor
  const onFloorClick = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.point) {
      clickTarget.current = new THREE.Vector3(e.point.x, 0, e.point.z);
    }
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const group = groupRef.current;
    const pos = group.position;
    const clock = state.clock.elapsedTime;
    const k = keys.current;

    // --- KEYBOARD MOVEMENT ---
    const speed = k.shift ? MOVE_SPEED_FAST : MOVE_SPEED;
    const inputDir = new THREE.Vector3();

    if (k.forward) inputDir.z -= 1;
    if (k.backward) inputDir.z += 1;
    if (k.left) inputDir.x -= 1;
    if (k.right) inputDir.x += 1;

    if (inputDir.lengthSq() > 0) {
      inputDir.normalize();
      clickTarget.current = null;

      // Rotate input by camera azimuth
      const angle = cameraAzimuth.current;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rx = inputDir.x * cos - inputDir.z * sin;
      const rz = inputDir.x * sin + inputDir.z * cos;

      const target = new THREE.Vector3(rx * speed, 0, rz * speed);
      velocity.current.lerp(target, LERP_FACTOR * 4);
    } else if (clickTarget.current) {
      const diff = clickTarget.current.clone().sub(new THREE.Vector3(pos.x, 0, pos.z));
      const dist = diff.length();
      if (dist < 0.1) {
        clickTarget.current = null;
        velocity.current.multiplyScalar(0.9);
      } else {
        diff.normalize().multiplyScalar(speed * 0.8);
        velocity.current.lerp(diff, LERP_FACTOR * 3);
      }
    } else {
      velocity.current.multiplyScalar(0.92);
    }

    pos.x += velocity.current.x * delta;
    pos.z += velocity.current.z * delta;

    // --- HOVER BOB ---
    pos.y = HOVER_HEIGHT + Math.sin(clock * BOB_SPEED) * BOB_AMPLITUDE;

    // --- AVATAR ROTATION ---
    if (velocity.current.lengthSq() > 0.01) {
      const targetAngle = Math.atan2(velocity.current.x, velocity.current.z);
      let diff = targetAngle - group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      group.rotation.y += diff * 0.1;
    }

    // --- CAMERA ---
    // In XR the headset owns the camera — skip all camera manipulation
    if (isInXR) {
      // XR session controls the camera
    } else if (spatialTracking?.active && spatialTracking.poseRef?.current) {
      // Spatial tracking mode (Vision Pro non-VR): use device head pose
      const pose = spatialTracking.poseRef.current;

      // Map AVP pose to scene camera. The pose is relative to where
      // the device was when tracking started. We add a base offset so
      // the user looks at the scene origin from a comfortable distance.
      if (!cameraInitialized.current) {
        cameraTarget.current.set(pos.x, pos.y + 1, pos.z);
        cameraInitialized.current = true;
      }
      const base = cameraTarget.current;

      // Position: AVP position offset from the base viewing position
      camera.position.set(
        base.x + pose.position.x,
        base.y + pose.position.y,
        base.z + 6 + pose.position.z  // 6m back from target
      );

      // Orientation: directly from head tracking
      camera.quaternion.copy(pose.quaternion);
    } else if (cameraEnabled) {
      // Desktop mode: manual orbit/pan/zoom
      if (!cameraInitialized.current) {
        cameraTarget.current.set(pos.x, pos.y + 1, pos.z);
        cameraInitialized.current = true;
      }

      const azimuth = cameraAzimuth.current;
      const elevation = cameraElevation.current;
      const dist = cameraDist.current;
      const target = cameraTarget.current;

      // Compute camera position from spherical coords around the target
      const camX = target.x + Math.sin(azimuth) * Math.cos(elevation) * dist;
      const camY = target.y + Math.sin(elevation) * dist;
      const camZ = target.z + Math.cos(azimuth) * Math.cos(elevation) * dist;

      // Snap camera (no lerp — instant positioning for stability)
      camera.position.set(camX, camY, camZ);
      camera.lookAt(target);
    }
  });

  return (
    <group ref={groupRef} position={[0, HOVER_HEIGHT, 0]}>
      {children}

      {/* Invisible floor plane for click-to-move */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -HOVER_HEIGHT, 0]}
        visible={false}
        onClick={onFloorClick}
      >
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
