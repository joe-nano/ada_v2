import { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';

/**
 * useSpatialTracking — Reads Apple Vision Pro's spatial tracking data
 * in non-immersive (window) mode and maps it to R3F camera coordinates.
 *
 * Two tracking sources (used in priority order):
 *
 * 1. WebXR inline session with 'viewer' reference space
 *    → gives full 6DoF pose (position + orientation) on visionOS Safari
 *
 * 2. DeviceOrientationEvent fallback
 *    → gives 3DoF orientation on any mobile/spatial device
 *
 * Returns:
 *   active     — true if spatial tracking is providing data
 *   poseRef    — ref to { position: Vector3, quaternion: Quaternion }
 *   request()  — call to request permission + start tracking
 */
export default function useSpatialTracking() {
  const [active, setActive] = useState(false);
  const poseRef = useRef({
    position: new THREE.Vector3(0, 1.6, 0), // approximate head height
    quaternion: new THREE.Quaternion(),
  });

  // Track cleanup
  const cleanupRef = useRef(null);

  // Detect visionOS or spatial device
  const isSpatialDevice = useRef(
    typeof navigator !== 'undefined' &&
    (/visionOS|Apple.*XR/i.test(navigator.userAgent) ||
     // Also detect iPad/iPhone for DeviceOrientation fallback
     /iPad|iPhone/.test(navigator.userAgent))
  );

  // --- WebXR inline session ---
  const startInlineXR = useCallback(async () => {
    if (!navigator.xr) return false;

    try {
      const supported = await navigator.xr.isSessionSupported('inline');
      if (!supported) return false;

      const session = await navigator.xr.requestSession('inline', {
        requiredFeatures: ['viewer'],
      });

      const refSpace = await session.requestReferenceSpace('viewer');

      let running = true;

      const onFrame = (time, frame) => {
        if (!running) return;
        const pose = frame.getViewerPose(refSpace);
        if (pose) {
          const t = pose.transform;
          // Map WebXR pose to Three.js
          poseRef.current.position.set(
            t.position.x,
            t.position.y,
            t.position.z
          );
          poseRef.current.quaternion.set(
            t.orientation.x,
            t.orientation.y,
            t.orientation.z,
            t.orientation.w
          );

          if (!active) setActive(true);
        }
        session.requestAnimationFrame(onFrame);
      };

      session.requestAnimationFrame(onFrame);

      cleanupRef.current = () => {
        running = false;
        session.end().catch(() => {});
      };

      return true;
    } catch (e) {
      console.warn('[SpatialTracking] WebXR inline session failed:', e);
      return false;
    }
  }, [active]);

  // --- DeviceOrientation fallback ---
  const startDeviceOrientation = useCallback(async () => {
    // Request permission on iOS/visionOS
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') {
          console.warn('[SpatialTracking] DeviceOrientation permission denied');
          return false;
        }
      } catch (e) {
        console.warn('[SpatialTracking] DeviceOrientation permission request failed:', e);
        return false;
      }
    }

    // Convert device orientation (alpha/beta/gamma) to quaternion
    const euler = new THREE.Euler();
    const q = new THREE.Quaternion();
    const screenOrientation = window.screen?.orientation?.angle || 0;

    const onOrientation = (e) => {
      if (e.alpha === null) return;

      // Convert degrees to radians
      const alpha = THREE.MathUtils.degToRad(e.alpha); // Z-axis (compass)
      const beta = THREE.MathUtils.degToRad(e.beta);   // X-axis (tilt front/back)
      const gamma = THREE.MathUtils.degToRad(e.gamma);  // Y-axis (tilt left/right)

      // Device orientation → Three.js quaternion
      // Standard ZXY Euler with screen orientation compensation
      euler.set(beta, alpha, -gamma, 'YXZ');
      q.setFromEuler(euler);

      // Apply screen orientation offset
      const screenQ = new THREE.Quaternion();
      screenQ.setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        -THREE.MathUtils.degToRad(screenOrientation)
      );
      q.multiply(screenQ);

      // Apply -90° X rotation to align device "forward" with camera "forward"
      const alignQ = new THREE.Quaternion();
      alignQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      q.multiply(alignQ);

      poseRef.current.quaternion.copy(q);

      if (!active) setActive(true);
    };

    window.addEventListener('deviceorientation', onOrientation, true);

    cleanupRef.current = () => {
      window.removeEventListener('deviceorientation', onOrientation, true);
    };

    return true;
  }, [active]);

  // Main request function
  const request = useCallback(async () => {
    // Try WebXR inline first (best tracking on visionOS)
    const xrOk = await startInlineXR();
    if (xrOk) {
      console.log('[SpatialTracking] Using WebXR inline session');
      return;
    }

    // Fall back to DeviceOrientation
    const doOk = await startDeviceOrientation();
    if (doOk) {
      console.log('[SpatialTracking] Using DeviceOrientation');
      return;
    }

    console.log('[SpatialTracking] No spatial tracking available');
  }, [startInlineXR, startDeviceOrientation]);

  // Auto-request on spatial devices
  useEffect(() => {
    if (isSpatialDevice.current) {
      request();
    }
    return () => {
      cleanupRef.current?.();
    };
  }, [request]);

  return { active, poseRef, request };
}
