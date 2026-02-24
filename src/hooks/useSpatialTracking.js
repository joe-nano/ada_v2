import { useRef, useCallback, useState, useEffect } from 'react';

/**
 * useSpatialTracking — stub for Vision Pro spatial tracking.
 * Three.js types are created lazily to avoid Vite creating a
 * separate dep bundle that conflicts with R3F's React copy.
 */
export default function useSpatialTracking() {
  const [active, setActive] = useState(false);
  const poseRef = useRef(null);
  const cleanupRef = useRef(null);

  // Lazily create Three.js objects only when actually needed
  const ensurePose = useCallback(() => {
    if (!poseRef.current) {
      try {
        // Dynamic require avoids top-level 'three' import
        const { Vector3, Quaternion } = require('three');
        poseRef.current = {
          position: new Vector3(0, 1.6, 0),
          quaternion: new Quaternion(),
        };
      } catch {
        poseRef.current = {
          position: { x: 0, y: 1.6, z: 0, set() {}, copy() {} },
          quaternion: { x: 0, y: 0, z: 0, w: 1, set() {}, copy() {} },
        };
      }
    }
    return poseRef.current;
  }, []);

  const isSpatialDevice = useRef(
    typeof navigator !== 'undefined' &&
    (/visionOS|Apple.*XR/i.test(navigator.userAgent) ||
     /iPad|iPhone/.test(navigator.userAgent))
  );

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
      const pose = ensurePose();

      const onFrame = (time, frame) => {
        if (!running) return;
        const viewerPose = frame.getViewerPose(refSpace);
        if (viewerPose) {
          const t = viewerPose.transform;
          pose.position.set(t.position.x, t.position.y, t.position.z);
          pose.quaternion.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
          if (!active) setActive(true);
        }
        session.requestAnimationFrame(onFrame);
      };
      session.requestAnimationFrame(onFrame);
      cleanupRef.current = () => { running = false; session.end().catch(() => {}); };
      return true;
    } catch (e) {
      console.warn('[SpatialTracking] WebXR inline session failed:', e);
      return false;
    }
  }, [active, ensurePose]);

  const startDeviceOrientation = useCallback(async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') return false;
      } catch { return false; }
    }

    let THREE;
    try { THREE = require('three'); } catch { return false; }
    const { Euler, Quaternion, Vector3, MathUtils } = THREE;

    const euler = new Euler();
    const q = new Quaternion();
    const screenOrientation = window.screen?.orientation?.angle || 0;
    const pose = ensurePose();

    const onOrientation = (e) => {
      if (e.alpha === null) return;
      euler.set(
        MathUtils.degToRad(e.beta),
        MathUtils.degToRad(e.alpha),
        -MathUtils.degToRad(e.gamma),
        'YXZ'
      );
      q.setFromEuler(euler);
      const screenQ = new Quaternion();
      screenQ.setFromAxisAngle(new Vector3(0, 0, 1), -MathUtils.degToRad(screenOrientation));
      q.multiply(screenQ);
      const alignQ = new Quaternion();
      alignQ.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
      q.multiply(alignQ);
      pose.quaternion.copy(q);
      if (!active) setActive(true);
    };

    window.addEventListener('deviceorientation', onOrientation, true);
    cleanupRef.current = () => window.removeEventListener('deviceorientation', onOrientation, true);
    return true;
  }, [active, ensurePose]);

  const request = useCallback(async () => {
    const xrOk = await startInlineXR();
    if (xrOk) { console.log('[SpatialTracking] Using WebXR inline session'); return; }
    const doOk = await startDeviceOrientation();
    if (doOk) { console.log('[SpatialTracking] Using DeviceOrientation'); return; }
    console.log('[SpatialTracking] No spatial tracking available');
  }, [startInlineXR, startDeviceOrientation]);

  useEffect(() => {
    if (isSpatialDevice.current) request();
    return () => cleanupRef.current?.();
  }, [request]);

  // Ensure poseRef always has a value for callers
  ensurePose();

  return { active, poseRef, request };
}
