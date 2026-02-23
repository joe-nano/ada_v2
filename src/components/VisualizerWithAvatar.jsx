import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import JodaAvatar from './JodaAvatar';
import AvatarExperience from './AvatarExperience';
import FullBodyAvatarExperience from './FullBodyAvatarExperience';

/**
 * Enhanced Visualizer with Avatar Support
 *
 * This component combines the original breathing circle visualizer
 * with the new JODA avatar system. Users can toggle between modes.
 */

const VisualizerWithAvatar = ({
    audioData,
    isListening,
    isAiSpeaking = false, // NEW: Tracks when AI is speaking for lip sync
    intensity = 0,
    width = 600,
    height = 400,
    mode = 'classic', // 'classic', 'avatar-holographic', 'avatar-svg', 'avatar-3d', 'hybrid', 'avatar-rpm', 'avatar-custom'
    rpmAvatarUrl = '', // Ready Player Me avatar URL
    customUrl = '', // Custom 3D model URL
    isHudAwake = true, // For auto-hide functionality
    speakingText = '' // 🔥 NEW: Text being spoken for text-based lip sync
}) => {
    const canvasRef = useRef(null);
    const [currentMode, setCurrentMode] = useState(mode);

    // Use refs for animation loop
    const audioDataRef = useRef(audioData);
    const intensityRef = useRef(intensity);
    const isListeningRef = useRef(isListening);

    useEffect(() => {
        audioDataRef.current = audioData;
        intensityRef.current = intensity;
        isListeningRef.current = isListening;
    }, [audioData, intensity, isListening]);

    useEffect(() => {
        setCurrentMode(mode);
    }, [mode]);

    // Classic breathing circle visualization
    useEffect(() => {
        if (!currentMode.startsWith('classic') && currentMode !== 'hybrid') return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        let animationId;

        const draw = () => {
            const w = canvas.width;
            const h = canvas.height;
            const centerX = w / 2;
            const centerY = h / 2;

            const currentIntensity = intensityRef.current;
            const currentIsListening = isListeningRef.current;

            const baseRadius = Math.min(w, h) * 0.25;
            const radius = baseRadius + (currentIntensity * 40);

            ctx.clearRect(0, 0, w, h);

            // Base Circle (Glow)
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius - 10, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0, 122, 255, 0.1)';
            ctx.lineWidth = 2;
            ctx.stroke();

            if (!currentIsListening) {
                // Idle State: Breathing Circle
                const time = Date.now() / 1000;
                const breath = Math.sin(time * 2) * 5;

                ctx.beginPath();
                ctx.arc(centerX, centerY, radius + breath, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(0, 122, 255, 0.4)';
                ctx.lineWidth = 4;
                ctx.shadowBlur = 20;
                ctx.shadowColor = 'rgba(0, 122, 255, 0.5)';
                ctx.stroke();
                ctx.shadowBlur = 0;
            } else {
                // Active State: Pulsing Circle
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(0, 122, 255, 0.6)';
                ctx.lineWidth = 4;
                ctx.shadowBlur = 20;
                ctx.shadowColor = 'rgba(0, 122, 255, 0.5)';
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            animationId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(animationId);
    }, [width, height, currentMode]);

    // Render based on mode
    const renderContent = () => {
        switch (currentMode) {
            case 'classic':
                return (
                    <>
                        {/* Central JODA Text */}
                        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                            <motion.div
                                animate={{ scale: isListening ? [1, 1.1, 1] : 1 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                                className="text-gray-600 font-bold tracking-widest"
                                style={{ fontSize: Math.min(width, height) * 0.1 }}
                            >
                                JODA
                            </motion.div>
                        </div>

                        <canvas
                            ref={canvasRef}
                            style={{ width: '100%', height: '100%' }}
                        />
                    </>
                );

            case 'avatar-beautiful':
                // Beautiful 3D avatar with React Three Fiber
                return (
                    <AvatarExperience
                        audioData={audioData}
                        lipsyncData={null} // Will be populated from backend when available
                        isSpeaking={isAiSpeaking}
                        expression={isListening ? 'listening' : 'neutral'}
                        modelUrl={customUrl || '/models/joda-avatar.glb'} // Use local file, not external RPM URL
                        enableEffects={true}
                        theme="natural" // Light natural theme
                        speakingText={speakingText} // 🔥 NEW: Pass speaking text for text-based lip sync
                    />
                );

            case 'avatar-fullbody':
                return (
                    <FullBodyAvatarExperience
                        audioData={audioData}
                        isSpeaking={isAiSpeaking}
                        expression={isListening ? 'listening' : 'neutral'}
                        modelUrl={customUrl || '/models/joda-fullbody.glb'}
                        speakingText={speakingText}
                    />
                );

            case 'avatar-holographic':
            case 'avatar-svg':
            case 'avatar-3d':
            case 'avatar-rpm':
            case 'avatar-custom':
            case 'avatar-heygen':
                const avatarType = currentMode.replace('avatar-', '');
                return (
                    <JodaAvatar
                        type={avatarType}
                        isSpeaking={isAiSpeaking}
                        audioLevel={intensity}
                        emotion="neutral"
                        rpmAvatarUrl={rpmAvatarUrl}
                        customUrl={customUrl}
                        text="" // For HeyGen - will be passed dynamically later
                    />
                );

            case 'hybrid':
                // Show both: avatar in center, breathing circle as background
                return (
                    <>
                        <canvas
                            ref={canvasRef}
                            className="absolute inset-0"
                            style={{ width: '100%', height: '100%' }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-2/3 h-2/3">
                                <JodaAvatar
                                    type="svg"
                                    isSpeaking={isAiSpeaking}
                                    audioLevel={intensity}
                                    emotion="neutral"
                                />
                            </div>
                        </div>
                    </>
                );

            default:
                return null;
        }
    };

    return (
        <div className="relative" style={{ width, height }}>
            <AnimatePresence mode="wait">
                <motion.div
                    key={currentMode}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3 }}
                    className="w-full h-full"
                >
                    {renderContent()}
                </motion.div>
            </AnimatePresence>

            {/* Avatar Mode Selector - Ghost UI that appears on hover */}
            <div className="absolute top-4 right-4 flex flex-col gap-2 transition-opacity duration-700 pointer-events-auto" style={{ opacity: isHudAwake ? 1 : 0.5, zIndex: 100 }}>
                {[
                    { mode: 'avatar-fullbody', label: 'Full Body', icon: '🧍' },
                    { mode: 'avatar-beautiful', label: 'Beautiful', icon: '✨' },
                    { mode: 'avatar-holographic', label: 'Hologram', icon: '◈' },
                    { mode: 'avatar-svg', label: 'SVG', icon: '◆' },
                    { mode: 'avatar-3d', label: '3D', icon: '◉' },
                    { mode: 'avatar-heygen', label: 'HeyGen', icon: '◎' }
                ].map(({ mode: m, label, icon }) => (
                    <motion.button
                        key={m}
                        onClick={(e) => {
                            e.stopPropagation();
                            setCurrentMode(m);
                            console.log('Avatar mode changed to:', m);
                        }}
                        whileHover={{ scale: 1.15, opacity: 1 }}
                        whileTap={{ scale: 0.9 }}
                        style={{
                            opacity: currentMode === m ? 1 : 0.5,
                            cursor: 'pointer',
                            pointerEvents: 'auto'
                        }}
                        className={`
                            group relative px-3 py-2 rounded-full text-xs font-bold uppercase transition-all duration-300
                            backdrop-blur-3xl border-2 shadow-lg
                            ${currentMode === m
                                ? 'bg-blue-500/15 border-blue-400 text-blue-600 shadow-sm'
                                : 'bg-white/60 border-black/8 text-gray-500 hover:bg-blue-500/10 hover:border-blue-400/50 hover:text-blue-500'
                            }
                        `}
                        title={label}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-lg">{icon}</span>
                            <span className="hidden group-hover:inline-block transition-all duration-200">{label}</span>
                        </div>
                        {/* Glass shine effect */}
                        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/20 via-white/5 to-transparent pointer-events-none" />
                    </motion.button>
                ))}
            </div>
        </div>
    );
};

export default VisualizerWithAvatar;
