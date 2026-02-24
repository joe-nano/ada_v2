import React, { useEffect, useRef, useState } from 'react';
import StreamingAvatar, {
    AvatarQuality,
    StreamingEvents,
    TaskType,
} from '@heygen/streaming-avatar';

// Backend base URL - use same URL as Socket connection (supports HTTPS tunnels + dev:xr proxy)
const DEFAULT_VPS_IP = '72.62.165.102';
const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT ?? '8765';
const runtimeHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
const isElectron = typeof window !== 'undefined' && window.location.protocol === 'file:';
const backendHost = import.meta.env.VITE_BACKEND_HOST ?? runtimeHostname ?? '';
const backendProtocol = isHttps ? 'https' : 'http';

// In HTTPS mode, use same-origin (Vite proxies to backend). Otherwise connect directly.
const backendBaseUrl =
    import.meta.env.VITE_SOCKET_URL ??
    (isHttps && !isElectron
        ? ''
        : `${backendProtocol}://${backendHost || DEFAULT_VPS_IP}:${BACKEND_PORT}`);

/**
 * HeyGen Realistic AI Avatar Component
 *
 * Integrates HeyGen's Streaming Avatar SDK for photorealistic,
 * humanoid AI avatars with real-time speech and interaction.
 */

const HeyGenAvatar = ({
    isSpeaking = false,
    text = '',
    onAvatarReady = () => {},
    onError = () => {},
    avatarId = 'josh_lite3_20230714', // HeyGen avatar ID (valid default)
    quality = 'medium', // 'high', 'medium', or 'low'
    voice = {
        voiceId: 'e0abe4e9b63f47729f1041f7f716e3fb', // Default voice
        rate: 1.0,
    },
}) => {
    const videoRef = useRef(null);
    const avatarRef = useRef(null);
    const [isLoading, setIsLoading] = useState(true);
    const [sessionId, setSessionId] = useState(null);
    const [error, setError] = useState(null);
    const [debug, setDebug] = useState('Initializing...');
    const [isVideoMuted, setIsVideoMuted] = useState(true);

    // Map quality string to enum
    const qualityMap = {
        high: AvatarQuality.High,
        medium: AvatarQuality.Medium,
        low: AvatarQuality.Low,
    };

    useEffect(() => {
        initializeAvatar();

        return () => {
            if (avatarRef.current) {
                avatarRef.current.stopAvatar().catch(console.error);
            }
        };
    }, []);

    // Handle speaking when text changes
    useEffect(() => {
        if (text && sessionId && avatarRef.current && isSpeaking) {
            speakText(text);
        }
    }, [text, isSpeaking, sessionId]);

    const initializeAvatar = async () => {
        try {
            setDebug('Fetching session token...');
            console.log('[HeyGen] Fetching token from:', `${backendBaseUrl}/heygen/token`);

            // Get session token from backend
            const tokenResponse = await fetch(`${backendBaseUrl}/heygen/token`);

            if (!tokenResponse.ok) {
                throw new Error(`Backend returned ${tokenResponse.status}: ${tokenResponse.statusText}`);
            }

            const tokenData = await tokenResponse.json();
            console.log('[HeyGen] Token response:', tokenData);

            if (tokenData.error) {
                throw new Error(tokenData.message || tokenData.error);
            }

            if (!tokenData.token) {
                throw new Error('No token received from backend');
            }

            setDebug('Creating avatar instance...');

            // Initialize StreamingAvatar
            const avatar = new StreamingAvatar({
                token: tokenData.token,
            });

            avatarRef.current = avatar;

            // Set up event listeners
            avatar.on(StreamingEvents.AVATAR_START_TALKING, (e) => {
                console.log('[HeyGen] Avatar started talking', e);
            });

            avatar.on(StreamingEvents.AVATAR_STOP_TALKING, (e) => {
                console.log('[HeyGen] Avatar stopped talking', e);
            });

            avatar.on(StreamingEvents.STREAM_READY, (event) => {
                console.log('[HeyGen] Stream ready', event);
                setDebug('Stream ready!');

                // Attach video stream to video element
                if (event.detail && videoRef.current) {
                    videoRef.current.srcObject = event.detail;
                    videoRef.current.play().catch((e) => {
                        console.error('[HeyGen] Video play error:', e);
                    });
                }

                setIsLoading(false);
                onAvatarReady();
            });

            avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
                console.log('[HeyGen] Stream disconnected');
                setDebug('Stream disconnected');
                setIsLoading(false);
            });

            setDebug('Starting avatar session...');

            // Start avatar session
            const session = await avatar.createStartAvatar({
                avatarId: avatarId,  // Use avatarId instead of avatarName
                quality: qualityMap[quality] || AvatarQuality.Medium,
                voice: voice,
                language: 'en',
            });

            console.log('[HeyGen] Session started:', session);
            setSessionId(session.session_id);
            setDebug(`Session started: ${session.session_id}`);

        } catch (err) {
            console.error('[HeyGen] Initialization error:', err);
            setError(err.message);
            setDebug(`Error: ${err.message}`);
            setIsLoading(false);
            onError(err);
        }
    };

    const speakText = async (textToSpeak) => {
        if (!avatarRef.current || !sessionId) {
            console.warn('[HeyGen] Avatar not ready for speech');
            return;
        }

        try {
            await avatarRef.current.speak({
                text: textToSpeak,
                taskType: TaskType.REPEAT,
            });
            console.log('[HeyGen] Speaking:', textToSpeak);
        } catch (err) {
            console.error('[HeyGen] Speech error:', err);
        }
    };

    return (
        <div className="relative w-full h-full bg-gradient-to-br from-black via-[#000814] to-[#001a33] rounded-lg overflow-hidden">
            {/* Video Stream */}
            <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted={isVideoMuted}
                onClick={() => setIsVideoMuted((m) => !m)}
            />

            {/* Loading Overlay */}
            {isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4">
                        {/* Animated Loading Ring */}
                        <div className="relative w-20 h-20">
                            <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20"></div>
                            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-cyan-400 animate-spin"></div>
                        </div>

                        {/* Status Text */}
                        <div className="text-cyan-400 text-sm font-mono tracking-wider">
                            {debug}
                        </div>
                    </div>
                </div>
            )}

            {/* Error Overlay */}
            {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-black/95 via-red-900/20 to-black/95 backdrop-blur-sm">
                    <div className="text-center p-8 max-w-lg">
                        <div className="text-6xl mb-4">⚠️</div>
                        <div className="text-red-400 text-xl font-bold mb-3">HeyGen Avatar Unavailable</div>
                        <div className="text-gray-300 text-sm mb-4">{error}</div>

                        <div className="bg-black/60 backdrop-blur-md rounded-lg p-4 border border-red-500/30 text-left">
                            <div className="text-cyan-400 text-xs font-mono mb-2">💡 TO FIX:</div>
                            <ol className="text-gray-400 text-xs space-y-2 list-decimal list-inside">
                                <li>Get a valid HeyGen API key from <a href="https://www.heygen.com" target="_blank" className="text-cyan-400 hover:underline">heygen.com</a></li>
                                <li>Add <code className="bg-black/40 px-1 rounded text-cyan-300">HEYGEN_API_KEY</code> (or <code className="bg-black/40 px-1 rounded text-cyan-300">LIVE_AVATAR_API_KEY</code>) to backend <code className="bg-black/40 px-1 rounded text-cyan-300">.env</code></li>
                                <li>Restart the backend server</li>
                            </ol>
                        </div>

                        <div className="mt-6 text-xs text-gray-500">
                            Try other avatar modes: <span className="text-cyan-400">◈ Hologram</span>, <span className="text-cyan-400">◉ 3D</span>, or <span className="text-cyan-400">◆ SVG</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Hint */}
            {!isLoading && !error && (
                <div className="absolute top-4 left-4 text-[10px] text-cyan-200/70 bg-black/40 backdrop-blur-sm px-2 py-1 rounded-full border border-white/10">
                    Click video to {isVideoMuted ? 'unmute' : 'mute'}
                </div>
            )}

            {/* Status Indicator */}
            {!isLoading && !error && (
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 backdrop-blur-sm px-3 py-1 rounded-full border border-cyan-500/30">
                    <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-cyan-400 animate-pulse' : 'bg-gray-500'}`}></div>
                    <div className="text-cyan-400 text-xs font-mono">
                        {isSpeaking ? 'SPEAKING' : 'READY'}
                    </div>
                </div>
            )}

            {/* HeyGen Branding (required) */}
            <div className="absolute bottom-2 right-2 text-[8px] text-gray-600 font-mono">
                Powered by HeyGen
            </div>
        </div>
    );
};

export default HeyGenAvatar;
