import React, { useRef, useState, useContext, useCallback, useMemo, useEffect } from 'react';
import { Html } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import * as THREE from 'three';
import { SpatialContext } from './spatialContext';
import XRPanel from './XRPanel';


const DEFAULT_POSITIONS = {
  chat:         [-3, 1.5, 0],
  tools:        [0, 0.3, 3],
  media:        [0, 2.5, -1],
  imagePreview: [2, 2.0, -1],
  browser:      [3, 1.5, 0],
  kasa:         [-4, 1, 2],
  printer:      [4, 1, 2],
  settings:     [0, 1.5, 4],
  avatar:       [2, 1.5, 3],
  cad:          [3, 2, -2],
};

// Forward-facing arc for immersive XR — all panels in front of user at ~1.5-2m
const XR_POSITIONS = {
  chat:         [-0.8, 1.4, -1.8],
  tools:        [ 0,   0.8, -1.5],
  media:        [ 0.9, 1.6, -1.6],
  imagePreview: [ 0.5, 1.8, -1.5],
  browser:      [-0.9, 1.6, -1.6],
  kasa:         [ 1.2, 1.2, -1.4],
  printer:      [-1.2, 1.2, -1.4],
  settings:     [ 0,   1.0, -2.0],
  avatar:       [ 0.6, 1.2, -1.7],
  cad:          [-0.5, 1.4, -1.7],
};

export { DEFAULT_POSITIONS, XR_POSITIONS };

/**
 * SpatialPanel — 3D panel wrapper.
 *
 * KEY FIX: The <group> has NO position prop. Position is managed entirely
 * through the ref so that R3F's reconciler can never reset it during React
 * re-renders (which happen ~30x/sec during speech). useFrame runs at
 * priority -1 (before drei's <Html> at priority 0) so the position is
 * always correct before projection.
 */
export default function SpatialPanel({
  id,
  position,
  width = 420,
  height = 500,
  onMove,
  onResize,
  onRotate,
  children,
  xrContent,
  defaultAnchored = true,
  isGazed = false,
}) {
  const xrState = useXR();
  const isInXR = !!(xrState?.session);

  // In XR mode, render XRPanel with WebGL UI instead of Html
  if (isInXR && xrContent) {
    // Convert pixel dimensions to meters (approx 1px = 1mm)
    const xrW = width / 1000;
    const xrH = height / 1000;
    const xrPos = position || XR_POSITIONS[id] || DEFAULT_POSITIONS[id] || [0, 1, 0];

    // Convert meter resize back to pixel dimensions for App state
    const handleXRResize = onResize
      ? (panelId, metersW, metersH) => onResize(panelId, Math.round(metersW * 1000), Math.round(metersH * 1000))
      : undefined;

    return (
      <XRPanel
        id={id}
        position={xrPos}
        width={xrW}
        height={xrH}
        onMove={onMove}
        onResize={handleXRResize}
        onRotate={onRotate}
        faceUser
      >
        {xrContent}
      </XRPanel>
    );
  }

  // Desktop path
  return <DesktopSpatialPanel
    id={id}
    position={position}
    width={width}
    height={height}
    onMove={onMove}
    onResize={onResize}
    onRotate={onRotate}
    defaultAnchored={defaultAnchored}
    isGazed={isGazed}
  >
    {children}
  </DesktopSpatialPanel>;
}

// Size constraints in pixels
const MIN_PX_W = 200;
const MAX_PX_W = 800;
const MIN_PX_H = 150;
const MAX_PX_H = 900;

function DesktopSpatialPanel({
  id,
  position,
  width = 420,
  height = 500,
  onMove,
  onResize,
  onRotate,
  children,
  defaultAnchored = true,
  isGazed = false,
}) {
  const groupRef = useRef();
  const { camera, raycaster, gl } = useThree();
  const { disableCamera, enableCamera, portalRef } = useContext(SpatialContext);

  const [anchored, setAnchored] = useState(defaultAnchored);
  const [localW, setLocalW] = useState(width);
  const [localH, setLocalH] = useState(height);
  // Sync from props when not resizing
  const resizingRef = useRef(false);
  useEffect(() => {
    if (!resizingRef.current) {
      setLocalW(width);
      setLocalH(height);
    }
  }, [width, height]);

  // Lock the initial world-space position at mount time
  const initialPos = useMemo(
    () => new THREE.Vector3(...(position || DEFAULT_POSITIONS[id] || [0, 1, 0])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Compute initial Y rotation so the panel's readable face (+Z) points
  // toward the camera. Camera starts at [0, 3, 8] (SpatialWorld config).
  const initialRotY = useMemo(() => {
    const p = position || DEFAULT_POSITIONS[id] || [0, 1, 0];
    const camZ = camera.position.z || 8;
    const camX = camera.position.x || 0;
    return Math.atan2(camX - p[0], camZ - p[2]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anchorOffset = useRef(null);          // camera-local offset (Vector3)
  const cachedWorldPos = useRef(null);        // last computed world position
  const lastCamElements = useRef(null);       // Float64Array(16) for change detection
  const mounted = useRef(false);
  const dragging = useRef(false);
  const dragPlane = useRef(new THREE.Plane());
  const dragOffset = useRef(new THREE.Vector3());
  const intersection = useRef(new THREE.Vector3());

  // Set initial position + rotation imperatively (NOT via JSX prop)
  // so R3F never resets it during React re-renders.
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.copy(initialPos);
      groupRef.current.rotation.y = initialRotY;
      // Tilt panels back ~20° so the bottom leans toward the user
      // (like an angled monitor). Negative X rotation pitches the
      // bottom edge out of the screen toward the viewer.
      groupRef.current.rotation.x = -0.45;
      mounted.current = true;
    }
  }, [initialPos, initialRotY]);

  // ---- Anchor: keep panel at fixed viewport position ----
  // Priority -1 ensures this runs BEFORE drei's <Html> (priority 0)
  // reads the position for CSS projection.
  useFrame(() => {
    if (!groupRef.current || !mounted.current) return;
    if (dragging.current) return;

    if (!anchored) {
      // Floating mode — position stays wherever it was last set. Nothing to do.
      return;
    }

    // Compute camera-local offset once
    if (!anchorOffset.current) {
      const currentPos = groupRef.current.position.clone();
      const invMat = new THREE.Matrix4().copy(camera.matrixWorld).invert();
      anchorOffset.current = currentPos.clone().applyMatrix4(invMat);
      cachedWorldPos.current = currentPos.clone();
      lastCamElements.current = new Float64Array(camera.matrixWorld.elements);
    }

    // Check if camera actually moved
    const els = camera.matrixWorld.elements;
    const prev = lastCamElements.current;
    let cameraChanged = false;
    for (let i = 0; i < 16; i++) {
      if (els[i] !== prev[i]) { cameraChanged = true; break; }
    }

    if (cameraChanged) {
      // Recompute world position from camera-local offset
      cachedWorldPos.current = anchorOffset.current.clone().applyMatrix4(camera.matrixWorld);
      for (let i = 0; i < 16; i++) prev[i] = els[i];
    }

    // ALWAYS write the cached position — this is the critical fix.
    // Even if the camera didn't move, a React re-render between frames
    // might have caused R3F to dirty the position. We overwrite unconditionally.
    groupRef.current.position.copy(cachedWorldPos.current);
  }, -1); // <-- priority -1: before Html's useFrame

  // ---- Toggle anchor ----
  const toggleAnchor = useCallback(() => {
    setAnchored((prev) => {
      const next = !prev;
      if (next && groupRef.current) {
        // Recompute offset from current world position
        const invMat = new THREE.Matrix4().copy(camera.matrixWorld).invert();
        anchorOffset.current = groupRef.current.position.clone().applyMatrix4(invMat);
        cachedWorldPos.current = groupRef.current.position.clone();
        lastCamElements.current = new Float64Array(camera.matrixWorld.elements);
      } else {
        // Switching to floating: clear anchor state
        anchorOffset.current = null;
        cachedWorldPos.current = null;
        lastCamElements.current = null;
      }
      return next;
    });
  }, [camera]);

  // Helper: extract clientX/clientY from pointer, mouse, or touch events.
  // Handles TouchEvent, Touch object, PointerEvent, and MouseEvent.
  const getXY = useCallback((e) => {
    if (e.touches?.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches?.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    // Touch object passed directly (legacy path)
    if (e.clientX == null && e.identifier != null) return { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    return { x: e.clientX, y: e.clientY };
  }, []);

  // Helper: attach drag listeners using pointer capture (Safari fix).
  //
  // Safari doesn't propagate pointermove/pointerup from inside CSS
  // 3D-transformed elements (drei <Html transform>) to document/window.
  // setPointerCapture() on the R3F canvas forces all subsequent pointer
  // events to route through the canvas, bypassing the 3D transform boundary.
  // Falls back to window-level mouse/touch listeners for non-pointer events.
  const addDragListeners = useCallback((originEvent, onMoveHandler, onUpHandler) => {
    const canvas = gl.domElement;
    const pointerId = originEvent?.pointerId;
    let hasCapture = false;
    let done = false;

    // Try pointer capture on the R3F canvas — the most reliable Safari fix.
    // Pointer capture redirects ALL subsequent pointer events for this ID
    // to the canvas, regardless of CSS 3D transforms or DOM hierarchy.
    if (pointerId != null && canvas?.setPointerCapture) {
      try {
        canvas.setPointerCapture(pointerId);
        hasCapture = true;
        console.log('[SpatialPanel] Pointer capture acquired, pointerId:', pointerId);
      } catch (err) {
        console.warn('[SpatialPanel] Pointer capture failed:', err.message);
      }
    } else {
      console.log('[SpatialPanel] No pointer capture — pointerId:', pointerId, 'canvas:', !!canvas);
    }

    const wrappedUp = (upEvent) => {
      if (done) return;
      done = true;
      cleanup();
      onUpHandler(upEvent);
    };

    // If pointer capture is active, listen on the canvas — events are
    // guaranteed to arrive here even on Safari.
    if (hasCapture) {
      canvas.addEventListener('pointermove', onMoveHandler);
      canvas.addEventListener('pointerup', wrappedUp);
      canvas.addEventListener('lostpointercapture', wrappedUp);
    }

    // Fallback: window-level listeners for mouse/touch events (and pointer
    // events when capture isn't available). Use window instead of document —
    // Safari routes events to window more reliably from 3D-transformed HTML.
    const win = window;
    if (!hasCapture) {
      win.addEventListener('pointermove', onMoveHandler, true);
      win.addEventListener('pointerup', wrappedUp, true);
    }
    win.addEventListener('mousemove', onMoveHandler, true);
    win.addEventListener('mouseup', wrappedUp, true);
    win.addEventListener('touchmove', onMoveHandler, { passive: false, capture: true });
    win.addEventListener('touchend', wrappedUp, true);

    function cleanup() {
      if (hasCapture) {
        try { canvas.releasePointerCapture(pointerId); } catch (_) {}
        canvas.removeEventListener('pointermove', onMoveHandler);
        canvas.removeEventListener('pointerup', wrappedUp);
        canvas.removeEventListener('lostpointercapture', wrappedUp);
      }
      if (!hasCapture) {
        win.removeEventListener('pointermove', onMoveHandler, true);
        win.removeEventListener('pointerup', wrappedUp, true);
      }
      win.removeEventListener('mousemove', onMoveHandler, true);
      win.removeEventListener('mouseup', wrappedUp, true);
      win.removeEventListener('touchmove', onMoveHandler, { capture: true });
      win.removeEventListener('touchend', wrappedUp, true);
    }

    return cleanup;
  }, [gl]);

  // ---- 3D drag (handle bar) ----
  const startDragFull = useCallback((e) => {
    // Alt+drag = rotate, plain drag = move
    if (e.altKey) return;
    e.stopPropagation?.();
    e.preventDefault?.();
    dragging.current = true;
    disableCamera();

    const groupPos = groupRef.current.position.clone();
    const cameraDir = new THREE.Vector3();
    camera.getWorldDirection(cameraDir);
    dragPlane.current.setFromNormalAndCoplanarPoint(cameraDir, groupPos);

    const { x: startClientX, y: startClientY } = getXY(e);
    const mouse = new THREE.Vector2(
      (startClientX / gl.domElement.clientWidth) * 2 - 1,
      -(startClientY / gl.domElement.clientHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(dragPlane.current, intersection.current);
    dragOffset.current.copy(groupPos).sub(intersection.current);

    const onMoveHandler = (moveEvent) => {
      if (!dragging.current) return;
      moveEvent.preventDefault?.();
      const { x, y } = getXY(moveEvent);
      const m = new THREE.Vector2(
        (x / gl.domElement.clientWidth) * 2 - 1,
        -(y / gl.domElement.clientHeight) * 2 + 1
      );
      raycaster.setFromCamera(m, camera);
      const hit = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlane.current, hit);
      if (hit) {
        groupRef.current.position.copy(hit.add(dragOffset.current));
      }
    };

    const onUpHandler = () => {
      dragging.current = false;
      enableCamera();

      // Recompute anchor from new position
      if (anchored && groupRef.current) {
        const invMat = new THREE.Matrix4().copy(camera.matrixWorld).invert();
        anchorOffset.current = groupRef.current.position.clone().applyMatrix4(invMat);
        cachedWorldPos.current = groupRef.current.position.clone();
        lastCamElements.current = new Float64Array(camera.matrixWorld.elements);
      }

      if (groupRef.current && onMove) {
        const p = groupRef.current.position;
        onMove(id, [p.x, p.y, p.z]);
      }
    };

    addDragListeners(e, onMoveHandler, onUpHandler);
  }, [camera, raycaster, gl, disableCamera, enableCamera, id, onMove, anchored, getXY, addDragListeners]);

  // ---- Rotate (drag on rotate grip, or Alt+drag on handle) ----
  // Horizontal drag → yaw (Y), vertical drag → pitch (X), Shift+horizontal → roll (Z)
  const startRotate = useCallback((e) => {
    console.log(`[SpatialPanel:${id}] startRotate`, e.type, 'pointerId:', e.pointerId);
    e.stopPropagation?.();
    e.preventDefault?.();
    disableCamera();

    const { x: startX, y: startY } = getXY(e);
    const startRotY = groupRef.current?.rotation.y ?? 0;
    const startRotX = groupRef.current?.rotation.x ?? 0;
    const startRotZ = groupRef.current?.rotation.z ?? 0;

    const onMoveHandler = (moveEvent) => {
      if (!groupRef.current) return;
      moveEvent.preventDefault?.();
      const { x, y } = getXY(moveEvent);
      const dx = x - startX;
      const dy = y - startY;

      if (moveEvent.shiftKey) {
        // Shift held → roll (Z axis)
        groupRef.current.rotation.z = startRotZ + dx * 0.01;
      } else {
        // Normal → yaw (Y) + pitch (X) — higher sensitivity for full 360°
        groupRef.current.rotation.y = startRotY + dx * 0.01;
        groupRef.current.rotation.x = startRotX + dy * 0.01;
      }
    };

    const onUpHandler = () => {
      enableCamera();

      if (onRotate && groupRef.current) {
        const r = groupRef.current.rotation;
        onRotate(id, [r.x, r.y, r.z]);
      }
    };

    addDragListeners(e, onMoveHandler, onUpHandler);
  }, [disableCamera, enableCamera, id, onRotate, getXY, addDragListeners]);

  // Combined handler for handle bar — Alt+drag = rotate, plain drag = move
  const handlePointerDown = useCallback((e) => {
    console.log(`[SpatialPanel:${id}] handlePointerDown`, e.type, 'pointerId:', e.pointerId, 'altKey:', e.altKey);
    if (e.altKey) {
      startRotate(e);
    } else {
      startDragFull(e);
    }
  }, [startRotate, startDragFull, id]);

  // ---- Resize (bottom-right corner drag) ----
  const startResize = useCallback((e) => {
    console.log(`[SpatialPanel:${id}] startResize`, e.type, 'pointerId:', e.pointerId);
    e.stopPropagation?.();
    e.preventDefault?.();
    disableCamera();
    resizingRef.current = true;

    const { x: startX, y: startY } = getXY(e);
    const startW = localW;
    const startH = localH;

    const onMoveHandler = (moveEvent) => {
      moveEvent.preventDefault?.();
      const { x, y } = getXY(moveEvent);
      const dx = x - startX;
      const dy = y - startY;
      setLocalW(Math.min(MAX_PX_W, Math.max(MIN_PX_W, startW + dx)));
      setLocalH(Math.min(MAX_PX_H, Math.max(MIN_PX_H, startH + dy)));
    };

    const onUpHandler = () => {
      resizingRef.current = false;
      enableCamera();

      setLocalW((w) => {
        setLocalH((h) => {
          if (onResize) onResize(id, w, h);
          return h;
        });
        return w;
      });
    };

    addDragListeners(e, onMoveHandler, onUpHandler);
  }, [disableCamera, enableCamera, id, onResize, localW, localH, getXY, addDragListeners]);

  // ---- Quick rotate by fixed increments (button bar) ----
  const rotateBy = useCallback((axis, angle) => {
    if (!groupRef.current) return;
    groupRef.current.rotation[axis] += angle;
    if (onRotate) {
      const r = groupRef.current.rotation;
      onRotate(id, [r.x, r.y, r.z]);
    }
  }, [id, onRotate]);

  // Position + rotation as JSX props so drei <Html> gets valid coords on
  // the very first frame (before useEffect/useFrame run). useFrame(-1) still
  // overwrites position every frame in anchored mode, and drag handlers
  // update via ref — so the JSX prop only matters for the initial render.
  const initialPosArr = useMemo(() => initialPos.toArray(), [initialPos]);
  const initialRotArr = useMemo(() => [-0.45, initialRotY, 0], [initialRotY]);

  return (
    <group ref={groupRef} position={initialPosArr} rotation={initialRotArr}>
      <Html
        transform
        distanceFactor={5}
        zIndexRange={[100, 0]}
        portal={portalRef}
        onOcclude={() => null}
        style={{
          width: `${localW}px`,
          height: `${localH}px`,
          pointerEvents: 'auto',
          touchAction: 'manipulation',
          WebkitUserSelect: 'none',
        }}
      >
        <div
          className={`spatial-panel${isGazed ? ' gaze-active' : ''}`}
          style={{
            width: `${localW}px`,
            height: `${localH}px`,
            touchAction: 'manipulation',
          }}
        >
          {/* Title bar — drag to move */}
          <div className="panel-handle" onPointerDown={handlePointerDown}>
            <button
              className={`panel-pin-btn ${anchored ? 'pinned' : ''}`}
              title={anchored ? 'Unpin (float in world)' : 'Pin to screen'}
              onClick={(e) => { e.stopPropagation(); toggleAnchor(); }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {anchored ? '📌' : '📎'}
            </button>
            <div className="panel-handle-grip" />
            <div className="panel-handle-label">{id.toUpperCase()}</div>
            <div
              className="panel-rotate-grip"
              title="Drag to rotate (Shift = roll)"
              onPointerDown={(e) => { e.stopPropagation(); startRotate(e); }}
            >
              ↻
            </div>
          </div>
          {/* Rotation button bar */}
          <div className="panel-rotate-bar">
            <button title="Rotate left (Y)" onClick={() => rotateBy('y', 0.3)}>⟲Y</button>
            <button title="Rotate right (Y)" onClick={() => rotateBy('y', -0.3)}>⟳Y</button>
            <button title="Tilt up (X)" onClick={() => rotateBy('x', -0.15)}>↑X</button>
            <button title="Tilt down (X)" onClick={() => rotateBy('x', 0.15)}>↓X</button>
            <button title="Roll left (Z)" onClick={() => rotateBy('z', 0.15)}>⟲Z</button>
            <button title="Roll right (Z)" onClick={() => rotateBy('z', -0.15)}>⟳Z</button>
          </div>
          <div className="spatial-panel-content" style={{ height: `calc(100% - 56px)`, overflow: 'auto' }}>
            {children}
          </div>
          {/* Resize handle — bottom-right corner */}
          <div
            className="panel-resize-handle"
            onPointerDown={startResize}
            title="Drag to resize"
          />
        </div>
      </Html>
    </group>
  );
}
