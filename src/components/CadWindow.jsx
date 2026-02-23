import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Center, Stage } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { Printer } from 'lucide-react';

const GeometryModel = ({ geometry }) => {
    return (
        <mesh geometry={geometry} castShadow receiveShadow>
            <meshStandardMaterial color="#007AFF" roughness={0.3} metalness={0.8} />
        </mesh>
    );
};

const LoadingCube = () => {
    const meshRef = React.useRef();
    useFrame((state, delta) => {
        meshRef.current.rotation.x += delta;
        meshRef.current.rotation.y += delta;
    });
    return (
        <mesh ref={meshRef}>
            <boxGeometry args={[10, 10, 10]} />
            <meshStandardMaterial wireframe color="#007AFF" transparent opacity={0.5} />
        </mesh>
    );
};

const CadWindow = ({ data, thoughts, retryInfo = {}, onClose, socket }) => {
    const [isIterating, setIsIterating] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [isSending, setIsSending] = useState(false);
    const thoughtsEndRef = useRef(null);

    useEffect(() => {
        if (data) console.log("CadWindow Data:", data.format);
    }, [data]);

    useEffect(() => {
        if (thoughtsEndRef.current) {
            thoughtsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [thoughts]);

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
            return geom;
        } catch (e) {
            console.error("Failed to decode/parse STL:", e);
            return null;
        }
    }, [data]);

    const handleGenerate = () => {
        if (!prompt.trim()) return;
        setIsSending(true);
        if (socket) {
            socket.emit('generate_cad', { prompt });
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
        <div className="w-full h-full relative group rounded-lg overflow-hidden" style={{ background: 'transparent' }}>
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

            <Canvas shadows camera={{ position: [4, 4, 4], fov: 45 }}>
                <color attach="background" args={['#f5f5f7']} />

                <Stage environment="city" intensity={0.5}>
                    {data?.format === 'loading' ? (
                        <LoadingCube />
                    ) : (
                        geometry && (
                            <Center>
                                <GeometryModel geometry={geometry} />
                            </Center>
                        )
                    )}
                </Stage>

                <OrbitControls autoRotate={!isIterating} autoRotateSpeed={1} makeDefault />
            </Canvas>

            {/* Streaming Thoughts Panel */}
            {data?.format === 'loading' && (
                <div className="absolute inset-y-0 right-0 w-2/5 p-4 glass border-l border-black/5 overflow-hidden flex flex-col">
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

            <div className="absolute bottom-2 left-2 text-[10px] text-gray-400 font-medium tracking-widest pointer-events-none">
                CAD ENGINE: {data?.format?.toUpperCase() || "READY"}
            </div>
        </div>
    );
};

export default CadWindow;
