import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { Printer } from 'lucide-react';

/**
 * CadModel3D — R3F component that renders a parsed 3D model directly in the
 * main scene. Replaces the old nested <Canvas> + <Stage> + <OrbitControls>.
 *
 * Props:
 *   data     — { format: 'stl'|'glb'|'fbx'|'obj'|'loading', data: base64 }
 *   position — [x, y, z] world position (defaults to [0,0,0])
 */
export function CadModel3D({ data, position = [0, 0, 0] }) {
    const groupRef = useRef();

    // Parse STL → BufferGeometry
    const geometry = useMemo(() => {
        if (!data || data.format !== 'stl' || !data.data) return null;
        try {
            const byteCharacters = atob(data.data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const loader = new STLLoader();
            const geom = loader.parse(byteArray.buffer);
            geom.center();
            geom.computeBoundingBox();
            return geom;
        } catch (e) {
            console.error("Failed to decode/parse STL:", e);
            return null;
        }
    }, [data]);

    // Parse GLB/FBX/OBJ → Three.js Object3D
    const [modelScene, setModelScene] = useState(null);
    useEffect(() => {
        const fmt = data?.format;
        if (!data || !data.data || !['glb', 'fbx', 'obj'].includes(fmt)) {
            setModelScene(null);
            return;
        }
        try {
            const byteCharacters = atob(data.data);
            const byteArray = new Uint8Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteArray[i] = byteCharacters.charCodeAt(i);
            }
            const buffer = byteArray.buffer;

            const centerAndShadow = (obj) => {
                const box = new THREE.Box3().setFromObject(obj);
                const center = box.getCenter(new THREE.Vector3());
                obj.position.sub(center);
                obj.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                setModelScene(obj);
            };

            if (fmt === 'glb') {
                const loader = new GLTFLoader();
                loader.parse(buffer, '', (gltf) => centerAndShadow(gltf.scene), (err) => {
                    console.error("Failed to parse GLB:", err);
                });
            } else if (fmt === 'fbx') {
                const loader = new FBXLoader();
                const obj = loader.parse(buffer, '');
                centerAndShadow(obj);
            } else if (fmt === 'obj') {
                const loader = new OBJLoader();
                const text = new TextDecoder().decode(byteArray);
                const obj = loader.parse(text);
                centerAndShadow(obj);
            }
        } catch (e) {
            console.error(`Failed to decode ${data.format}:`, e);
        }
    }, [data]);

    // Compute uniform scale to fit model within ~1 world unit
    const normalizedScale = useMemo(() => {
        if (geometry) {
            const box = geometry.boundingBox;
            if (box) {
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                return maxDim > 0 ? 1 / maxDim : 1;
            }
        }
        if (modelScene) {
            const box = new THREE.Box3().setFromObject(modelScene);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            return maxDim > 0 ? 1 / maxDim : 1;
        }
        return 1;
    }, [geometry, modelScene]);

    // Auto-rotation
    useFrame((_, delta) => {
        if (groupRef.current) {
            groupRef.current.rotation.y += delta * 0.5;
        }
    });

    // Loading cube (wireframe spinner)
    if (data?.format === 'loading') {
        return (
            <group ref={groupRef} position={position}>
                <mesh>
                    <boxGeometry args={[0.4, 0.4, 0.4]} />
                    <meshStandardMaterial wireframe color="#007AFF" transparent opacity={0.5} />
                </mesh>
            </group>
        );
    }

    if (!geometry && !modelScene) return null;

    // Offset slightly in front of (negative Z) the panel position
    const modelPos = [position[0], position[1], position[2] + 0.8];

    return (
        <group ref={groupRef} position={modelPos} scale={[normalizedScale, normalizedScale, normalizedScale]}>
            {geometry && (
                <mesh geometry={geometry} castShadow receiveShadow>
                    <meshStandardMaterial color="#007AFF" roughness={0.3} metalness={0.8} />
                </mesh>
            )}
            {modelScene && <primitive object={modelScene} />}
        </group>
    );
}

/**
 * CadPanelContent — HTML-only UI for the CAD panel. Rendered inside
 * SpatialPanel's <Html> wrapper. No <Canvas> — just controls & status.
 */
export function CadPanelContent({ data, thoughts, retryInfo = {}, onClose, socket }) {
    const [isIterating, setIsIterating] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [cadProvider, setCadProvider] = useState('build123d');
    const thoughtsEndRef = useRef(null);

    useEffect(() => {
        if (data) console.log("CadWindow Data:", data.format);
    }, [data]);

    useEffect(() => {
        if (thoughtsEndRef.current) {
            thoughtsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [thoughts]);

    const handleGenerate = () => {
        if (!prompt.trim()) return;
        setIsSending(true);
        if (socket) {
            socket.emit('generate_cad', { prompt, provider: cadProvider });
        } else {
            console.error("Socket not available in CadWindow");
        }
        setPrompt("");
        setTimeout(() => setIsSending(false), 2000);
    };

    const handleIterate = () => {
        if (!prompt.trim()) return;
        setIsSending(true);
        if (socket) {
            socket.emit('iterate_cad', { prompt });
        } else {
            console.error("Socket not available in CadWindow");
        }
        setIsIterating(false);
        setPrompt("");
        setIsSending(false);
    };

    return (
        <div className="w-full h-full relative group" style={{ background: 'transparent' }}>
            {/* Close Button */}
            <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={onClose} className="bg-red-500/10 hover:bg-red-500/20 text-red-500 p-1 rounded">X</button>
            </div>

            {/* Top Toolbar */}
            <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <button
                    onClick={() => setIsIterating(true)}
                    className="glass text-blue-500 text-xs px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
                >
                    ITERATE
                </button>
                <button
                    onClick={() => {
                        if (socket) socket.emit('request_print_window');
                    }}
                    className="glass text-green-600 text-xs px-2 py-1 rounded hover:bg-green-500/10 transition-colors flex items-center gap-1"
                >
                    <Printer size={12} /> PRINT
                </button>
            </div>

            {/* Iteration / Generation Overlay */}
            {(isIterating || (!data && data?.format !== 'loading')) && (
                <div className={`absolute inset-0 z-20 ${!data ? 'bg-white/95' : 'bg-white/80'} backdrop-blur-sm flex items-center justify-center p-4`}>
                    <div className="glass spatial-card p-4 w-full max-w-sm pointer-events-auto">
                        <h4 className="text-gray-700 text-sm mb-2 font-semibold">
                            {!data ? "New Design" : "Refine Design"}
                        </h4>
                        {/* Provider toggle */}
                        {!data && (
                            <div className="flex gap-1 mb-2">
                                {['build123d', 'tripo'].map((p) => (
                                    <button
                                        key={p}
                                        onClick={() => setCadProvider(p)}
                                        className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                                            cadProvider === p
                                                ? 'bg-blue-500 text-white'
                                                : 'glass text-gray-500 hover:text-gray-700'
                                        }`}
                                    >
                                        {p === 'build123d' ? 'CAD (build123d)' : 'AI Mesh (Tripo)'}
                                    </button>
                                ))}
                            </div>
                        )}
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={!data ? "Describe what you want to create..." : "e.g., Make the wheels bigger..."}
                            className="w-full glass rounded-lg p-2 text-gray-800 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400/50 h-24 resize-none placeholder-gray-400"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    !data ? handleGenerate() : handleIterate();
                                }
                            }}
                        />
                        <div className="flex justify-end gap-2">
                            {data && (
                                <button
                                    onClick={() => setIsIterating(false)}
                                    className="text-gray-400 text-xs hover:text-gray-600 px-2 py-1"
                                >
                                    Cancel
                                </button>
                            )}
                            <button
                                onClick={!data ? handleGenerate : handleIterate}
                                disabled={isSending}
                                className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-3 py-1 rounded"
                            >
                                {isSending ? "Generating..." : (!data ? "Generate" : "Update")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Streaming Thoughts Panel */}
            {data?.format === 'loading' && (
                <div className="absolute inset-0 p-4 overflow-hidden flex flex-col" style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)' }}>
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-gray-600 text-xs font-semibold tracking-widest uppercase flex items-center gap-2">
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                            Designer Thinking...
                        </h4>
                        {retryInfo.attempt && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${retryInfo.error ? 'bg-yellow-500/10 text-yellow-600' : 'bg-blue-500/10 text-blue-500'}`}>
                                Attempt {retryInfo.attempt}/{retryInfo.maxAttempts || 3}
                            </span>
                        )}
                    </div>
                    {retryInfo.error && (
                        <div className="mb-2 p-2 bg-red-500/5 border border-red-500/20 rounded text-red-500 text-xs">
                            <span className="text-red-600 font-bold">Warning:</span> {retryInfo.error}
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto text-gray-500 text-xs whitespace-pre-wrap leading-relaxed scrollbar-thin scrollbar-thumb-gray-300">
                        {thoughts}
                        <div ref={thoughtsEndRef} />
                    </div>
                </div>
            )}

            {/* Status label */}
            <div className="absolute bottom-2 left-2 text-[10px] text-gray-400 font-medium tracking-widest pointer-events-none">
                CAD ENGINE: {data?.format?.toUpperCase() || "READY"}{['glb', 'fbx', 'obj'].includes(data?.format) ? ' (TRIPO)' : ''}
            </div>
        </div>
    );
}

// Default export kept for backwards compat (re-exports CadPanelContent)
export default CadPanelContent;
