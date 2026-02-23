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
}) {
  const groupRef = useRef();
  const { camera, raycaster, gl } = useThree();
  const { disableCamera, enableCamera } = useContext(SpatialContext);

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

  const anchorOffset = useRef(null);          // camera-local offset (Vector3)
  const cachedWorldPos = useRef(null);        // last computed world position
  const lastCamElements = useRef(null);       // Float64Array(16) for change detection
  const mounted = useRef(false);
  const dragging = useRef(false);
  const dragPlane = useRef(new THREE.Plane());
  const dragOffset = useRef(new THREE.Vector3());
  const intersection = useRef(new THREE.Vector3());

  // Set initial position imperatively (NOT via JSX prop) so R3F never resets it
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.copy(initialPos);
      mounted.current = true;
    }
  }, [initialPos]);

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

  // ---- 3D drag (handle bar) ----
  const startDragFull = useCallback((e) => {
    // Alt+drag = rotate, plain drag = move
    if (e.altKey) return;
    e.stopPropagation();
    dragging.current = true;
    disableCamera();

    const groupPos = groupRef.current.position.clone();
    const cameraDir = new THREE.Vector3();
    camera.getWorldDirection(cameraDir);
    dragPlane.current.setFromNormalAndCoplanarPoint(cameraDir, groupPos);

    const mouse = new THREE.Vector2(
      (e.clientX / gl.domElement.clientWidth) * 2 - 1,
      -(e.clientY / gl.domElement.clientHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(dragPlane.current, intersection.current);
    dragOffset.current.copy(groupPos).sub(intersection.current);

    const onPointerMove = (moveEvent) => {
      if (!dragging.current) return;
      const m = new THREE.Vector2(
        (moveEvent.clientX / gl.domElement.clientWidth) * 2 - 1,
        -(moveEvent.clientY / gl.domElement.clientHeight) * 2 + 1
      );
      raycaster.setFromCamera(m, camera);
      const hit = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlane.current, hit);
      if (hit) {
        groupRef.current.position.copy(hit.add(dragOffset.current));
      }
    };

    const onPointerUp = () => {
      dragging.current = false;
      enableCamera();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

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

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, [camera, raycaster, gl, disableCamera, enableCamera, id, onMove, anchored]);

  // ---- Rotate (Alt+drag on handle) ----
  const startRotate = useCallback((e) => {
    if (!e.altKey) return;
    e.stopPropagation();
    e.preventDefault();
    disableCamera();

    const startX = e.clientX;
    const startY = e.clientY;
    const startRotY = groupRef.current?.rotation.y ?? 0;
    const startRotX = groupRef.current?.rotation.x ?? 0;

    const onPointerMove = (moveEvent) => {
      if (!groupRef.current) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      // Horizontal drag → Y rotation, vertical drag → X rotation
      groupRef.current.rotation.y = startRotY + dx * 0.005;
      groupRef.current.rotation.x = startRotX + dy * 0.005;
    };

    const onPointerUp = () => {
      enableCamera();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      if (onRotate && groupRef.current) {
        const r = groupRef.current.rotation;
        onRotate(id, [r.x, r.y, r.z]);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, [disableCamera, enableCamera, id, onRotate]);

  // Combined handler for handle bar
  const handlePointerDown = useCallback((e) => {
    if (e.altKey) {
      startRotate(e);
    } else {
      startDragFull(e);
    }
  }, [startRotate, startDragFull]);

  // ---- Resize (bottom-right corner drag) ----
  const startResize = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    disableCamera();
    resizingRef.current = true;

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = localW;
    const startH = localH;

    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setLocalW(Math.min(MAX_PX_W, Math.max(MIN_PX_W, startW + dx)));
      setLocalH(Math.min(MAX_PX_H, Math.max(MIN_PX_H, startH + dy)));
    };

    const onPointerUp = () => {
      resizingRef.current = false;
      enableCamera();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      // Read the latest values from state via a callback
      setLocalW((w) => {
        setLocalH((h) => {
          if (onResize) onResize(id, w, h);
          return h;
        });
        return w;
      });
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, [disableCamera, enableCamera, id, onResize, localW, localH]);

  // NOTE: No position prop on <group>. Managed entirely via ref.
  return (
    <group ref={groupRef}>
      <Html
        transform
        distanceFactor={5}
        zIndexRange={[100, 0]}
        style={{
          width: `${localW}px`,
          height: `${localH}px`,
          pointerEvents: 'auto',
          touchAction: 'manipulation',
          WebkitUserSelect: 'none',
        }}
      >
        <div
          className="spatial-panel"
          style={{
            width: `${localW}px`,
            height: `${localH}px`,
            touchAction: 'manipulation',
          }}
        >
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
              className="panel-rotate-hint"
              title="Alt + drag to rotate"
            >
              ↻
            </div>
          </div>
          <div className="spatial-panel-content" style={{ height: `calc(100% - 28px)`, overflow: 'auto' }}>
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
