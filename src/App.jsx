import React, { useEffect, useState, useRef, useCallback } from 'react';
import io from 'socket.io-client';

import TopAudioBar from './components/TopAudioBar';
import { CadPanelContent } from './components/CadWindow';
import BrowserWindow from './components/BrowserWindow';
import ChatModule from './components/ChatModule';
import ToolsModule from './components/ToolsModule';
import SpatialWorld from './components/SpatialWorld';
import { DEFAULT_POSITIONS } from './components/SpatialPanel';
import { Mic, MicOff, Settings, X, Minus, Power, Video, VideoOff, Layout, Hand, Printer, Clock, User } from 'lucide-react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
// MemoryPrompt removed - memory is now actively saved to project
import ConfirmationPopup from './components/ConfirmationPopup';
import AuthLock from './components/AuthLock';
import KasaWindow from './components/KasaWindow';
import PrinterWindow from './components/PrinterWindow';
import MediaGalleryWindow from './components/MediaGalleryWindow';
import ImagePreviewWindow from './components/ImagePreviewWindow';
import SettingsWindow from './components/SettingsWindow';
import AvatarCustomizer from './components/AvatarCustomizer';
import { xrStore } from './xrStore';
import XRChatPanel from './components/xr/XRChatPanel';
import XRToolsPanel from './components/xr/XRToolsPanel';
import XRGenericPanel from './components/xr/XRGenericPanel';
import XRKasaPanel from './components/xr/XRKasaPanel';
import XRImagePreviewPanel from './components/xr/XRImagePreviewPanel';
import DebugOverlay from './components/DebugOverlay';

// Backend connection:
// - HTTPS mode (dev:xr): Socket.IO is proxied through Vite on the same origin,
//   so we connect to '' (current host) to avoid mixed-content blocks in Safari/WebXR.
// - HTTP mode: connect directly to the backend on port 8765.
// - Electron (file://): hostname is empty, fall back to env or the default VPS IP.
const DEFAULT_VPS_IP = '72.62.165.102';
const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT ?? '8765';
const runtimeHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
const isElectron = typeof window !== 'undefined' && window.location.protocol === 'file:';
const backendHost = import.meta.env.VITE_BACKEND_HOST ?? runtimeHostname ?? '';
const backendProtocol = isHttps ? 'https' : 'http';

// In HTTPS mode (no explicit VITE_SOCKET_URL), use same-origin so Vite's proxy handles
// the /socket.io/ path — avoids mixed-content (https→ws) blocks on Safari / Vision Pro.
const socketUrl =
    import.meta.env.VITE_SOCKET_URL ??
    (isHttps && !isElectron
        ? ''  // same-origin: Vite proxies /socket.io/ → http://localhost:8765
        : `${backendProtocol}://${backendHost || DEFAULT_VPS_IP}:${BACKEND_PORT}`);
// Force WebSocket transport for high-frequency binary audio streaming.
// Polling can choke and corrupt payloads ("Too many packets in payload") under load.
const socket = io(socketUrl, { transports: ['websocket'], upgrade: false });

let ipcRenderer = null;
try {
    if (typeof window !== 'undefined' && window.require) {
        ipcRenderer = window.require('electron').ipcRenderer;
    }
} catch {
    ipcRenderer = null;
}

function App() {
    const [status, setStatus] = useState('Disconnected');
    const [socketConnected, setSocketConnected] = useState(socket.connected); // Track socket connection reactively

    // Media permissions gate — prompt for mic + camera before app loads
    const [mediaPermission, setMediaPermission] = useState(() => {
        return localStorage.getItem('joda_media_granted') === 'true' ? 'granted' : 'pending';
    });

    const requestMediaPermissions = useCallback(async () => {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            // Not HTTPS — skip permission prompt, proceed anyway
            setMediaPermission('granted');
            localStorage.setItem('joda_media_granted', 'true');
            return;
        }
        try {
            // Request both mic + camera — this triggers Safari's permission dialog
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            // Stop tracks immediately — we just needed the permission grant
            stream.getTracks().forEach(t => t.stop());
        } catch (e) {
            console.warn('[Permissions] getUserMedia failed:', e);
            // Try audio-only if video was denied
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioStream.getTracks().forEach(t => t.stop());
            } catch (e2) {
                console.warn('[Permissions] audio-only getUserMedia also failed:', e2);
            }
        }

        // Also request DeviceOrientation permission (required on iOS/visionOS)
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                await DeviceOrientationEvent.requestPermission();
            } catch (e) {
                console.warn('[Permissions] DeviceOrientation permission failed:', e);
            }
        }

        // Proceed regardless of individual permission outcomes
        setMediaPermission('granted');
        localStorage.setItem('joda_media_granted', 'true');
    }, []);

    // Auth State
    // WebXR capability detection
    const [xrVRSupported, setXrVRSupported] = useState(false);
    const [xrARSupported, setXrARSupported] = useState(false);

    useEffect(() => {
        if (navigator.xr) {
            navigator.xr.isSessionSupported('immersive-vr').then(setXrVRSupported).catch(() => {});
            navigator.xr.isSessionSupported('immersive-ar').then(setXrARSupported).catch(() => {});
        }
    }, []);

    const [isAuthenticated, setIsAuthenticated] = useState(() => {
        // Optimistically assume authenticated if face auth is NOT enabled
        return localStorage.getItem('face_auth_enabled') !== 'true';
    });

    // Initialize from LocalStorage to prevent flash of UI
    const [isLockScreenVisible, setIsLockScreenVisible] = useState(() => {
        const saved = localStorage.getItem('face_auth_enabled');
        // If saved is 'true', we MUST start locked.
        // If 'false' or null (default off), we start unlocked.
        return saved === 'true';
    });

    // Local state for tracking settings, also init from local storage
    const [faceAuthEnabled, setFaceAuthEnabled] = useState(() => {
        return localStorage.getItem('face_auth_enabled') === 'true';
    });


    const [isConnected, setIsConnected] = useState(true); // Power state DEFAULT ON
    // Mic defaults to ON so voice interaction works immediately in web mode.
    // HUD still stays "asleep" until speech is detected.
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOn, setIsVideoOn] = useState(false); // Video state
    const [messages, setMessages] = useState([]);
    const currentSpeakingTextRef = useRef(''); // Ref to avoid re-renders during speech
    const setCurrentSpeakingText = (valOrFn) => {
        if (typeof valOrFn === 'function') {
            currentSpeakingTextRef.current = valOrFn(currentSpeakingTextRef.current);
        } else {
            currentSpeakingTextRef.current = valOrFn;
        }
    };
    const clearSpeakingTextTimeout = useRef(null); // 🔥 Track timeout to prevent early clearing
    const [inputValue, setInputValue] = useState('');
    const [cadData, setCadData] = useState(null);
    const [cadThoughts, setCadThoughts] = useState(''); // Streaming AI thoughts
    const [cadRetryInfo, setCadRetryInfo] = useState({ attempt: 1, maxAttempts: 3, error: null }); // Retry status
    const [browserData, setBrowserData] = useState({ image: null, logs: [] });
    // showMemoryPrompt removed - memory is now actively saved to project
    const [confirmationRequest, setConfirmationRequest] = useState(null); // { id, tool, args }
    const [kasaDevices, setKasaDevices] = useState([]);
    const [showKasaWindow, setShowKasaWindow] = useState(false);
    const [showPrinterWindow, setShowPrinterWindow] = useState(false);
    const [showCadWindow, setShowCadWindow] = useState(false);
    const [showBrowserWindow, setShowBrowserWindow] = useState(false);
    const [showMediaGallery, setShowMediaGallery] = useState(false);
    const [mediaAssets, setMediaAssets] = useState([]);
    const [imagePreview, setImagePreview] = useState({ visible: false, status: null, prompt: '', imageUrl: null, mediaUrl: null, mediaType: 'image', error: null, provider: '' });

    // Printing workflow status (for top toolbar display)
    const [slicingStatus, setSlicingStatus] = useState({ active: false, percent: 0, message: '' });
    const [activePrintStatus, setActivePrintStatus] = useState(null); // {printer, progress_percent, time_elapsed, state}
    const [printerCount, setPrinterCount] = useState(0); // Count of connected printers
    const [currentTime, setCurrentTime] = useState(new Date()); // Live clock


    // RESTORED STATE — audio data as ref (high-frequency, no re-render needed)
    const aiAudioDataRef = useRef(new Array(64).fill(0));
    const setAiAudioData = (data) => { aiAudioDataRef.current = data; };
    const [micAudioData, setMicAudioData] = useState(new Array(32).fill(0));
    const [fps, setFps] = useState(0);
    const isMutedRef = useRef(false);

    // AI Speaking state — ref for avatar (no re-render), kept as lightweight
    const isAiSpeakingRef = useRef(false);
    const setIsAiSpeaking = (val) => { isAiSpeakingRef.current = val; };
    const aiSpeakingTimeoutRef = useRef(null);

    // HUD "alive" state (wake on user speech)
    const [isHudAwake, setIsHudAwake] = useState(false);
    const isHudAwakeRef = useRef(false);
    const lastSpeechAtRef = useRef(0);
    const HUD_AWAKE_THRESHOLD = 22; // 0-255 analyser max magnitude
    const HUD_AWAKE_HOLD_MS = 900;

    const setHudAwake = (next) => {
        if (isHudAwakeRef.current === next) return;
        isHudAwakeRef.current = next;
        setIsHudAwake(next);
    };

    // AI audio playback (browser)
    const aiAudioContextRef = useRef(null);
    const aiGainNodeRef = useRef(null);
    const aiNextPlayTimeRef = useRef(0);
    const aiAudioNeedsGestureRef = useRef(false);
    const aiAudioGestureMsgShownRef = useRef(false);
    const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
    const isSpeakerMutedRef = useRef(false);
    const speakerVolumeRef = useRef(0.85);
    const [speakerVolume, setSpeakerVolume] = useState(() => {
        const saved = localStorage.getItem('speaker_volume');
        const parsed = saved ? Number(saved) : NaN;
        if (!Number.isFinite(parsed)) return 0.85;
        return Math.min(1, Math.max(0, parsed));
    });

    useEffect(() => {
        isSpeakerMutedRef.current = isSpeakerMuted;
    }, [isSpeakerMuted]);

    useEffect(() => {
        speakerVolumeRef.current = speakerVolume;
    }, [speakerVolume]);

    useEffect(() => {
        localStorage.setItem('speaker_volume', String(speakerVolume));
        const gain = aiGainNodeRef.current;
        const ctx = aiAudioContextRef.current;
        if (!gain || !ctx) return;
        try {
            gain.gain.setTargetAtTime(speakerVolume, ctx.currentTime, 0.015);
        } catch {
            // ignore
        }
    }, [speakerVolume]);

    const ensureAiAudioContext = async () => {
        if (aiAudioContextRef.current) {
            // Some browsers start suspended until user gesture.
            if (aiAudioContextRef.current.state === 'suspended') {
                try {
                    await aiAudioContextRef.current.resume();
                } catch (e) {
                    console.warn('[AI Audio] Failed to resume AudioContext:', e);
                }
            }
            if (aiAudioContextRef.current.state === 'suspended') {
                aiAudioNeedsGestureRef.current = true;
                if (!aiAudioGestureMsgShownRef.current) {
                    aiAudioGestureMsgShownRef.current = true;
                    addMessage('System', 'Click the speaker button once to enable audio playback in this browser.');
                }
            } else {
                aiAudioNeedsGestureRef.current = false;
            }
            return;
        }
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
            aiAudioContextRef.current = ctx;
            aiNextPlayTimeRef.current = ctx.currentTime;
            // Route to selected speaker device if supported
            const savedSpeaker = localStorage.getItem('selectedSpeakerId');
            if (savedSpeaker && 'setSinkId' in ctx) {
                await ctx.setSinkId(savedSpeaker).catch(e =>
                    console.warn('[Audio] setSinkId failed:', e)
                );
            }
            const gain = ctx.createGain();
            gain.gain.value = speakerVolume;
            gain.connect(ctx.destination);
            aiGainNodeRef.current = gain;
            if (ctx.state === 'suspended') {
                // Must be called after a user gesture (click/key press)
                try {
                    await ctx.resume();
                } catch (e) {
                    console.warn('[AI Audio] Failed to resume AudioContext:', e);
                }
            }
            if (ctx.state === 'suspended') {
                aiAudioNeedsGestureRef.current = true;
                if (!aiAudioGestureMsgShownRef.current) {
                    aiAudioGestureMsgShownRef.current = true;
                    addMessage('System', 'Click the speaker button once to enable audio playback in this browser.');
                }
            } else {
                aiAudioNeedsGestureRef.current = false;
                addMessage('System', 'AI audio playback enabled.');
            }
        } catch (err) {
            console.error('[AI Audio] init failed:', err);
            addMessage('System', `AI audio playback unavailable: ${err?.message ?? String(err)}`);
        }
    };

    const speakTtsText = (text) => {
        const cleaned = (text ?? '').trim();
        if (!cleaned) return;
        if (isSpeakerMutedRef.current) return;
        if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
            addMessage('System', 'Browser TTS is unavailable in this environment.');
            return;
        }
        try {
            // Avoid stacking responses infinitely.
            window.speechSynthesis.cancel();
        } catch {
            // ignore
        }
        try {
            const utter = new SpeechSynthesisUtterance(cleaned);
            utter.volume = Math.min(1, Math.max(0, speakerVolumeRef.current));
            window.speechSynthesis.speak(utter);
        } catch (e) {
            console.warn('[TTS] Failed:', e);
        }
    };

    const playAiPcmChunk = async (byteList) => {
        if (isSpeakerMutedRef.current) return;
        if (!byteList || byteList.length < 2) return;
        await ensureAiAudioContext();
        const ctx = aiAudioContextRef.current;
        if (aiAudioNeedsGestureRef.current) return;
        if (!ctx) return;
        const gain = aiGainNodeRef.current;

        // Convert list-of-bytes -> Float32 PCM
        const u8 = new Uint8Array(byteList);
        const sampleCount = Math.floor(u8.length / 2);
        if (sampleCount <= 0) return;

        const audioBuffer = ctx.createBuffer(1, sampleCount, 24000);
        const channel = audioBuffer.getChannelData(0);
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        for (let i = 0; i < sampleCount; i++) {
            const s = dv.getInt16(i * 2, true);
            channel[i] = s / 32768;
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gain || ctx.destination);

        const startAt = Math.max(ctx.currentTime, aiNextPlayTimeRef.current);
        source.start(startAt);
        aiNextPlayTimeRef.current = startAt + audioBuffer.duration;
    };

    // Browser mic streaming -> backend (for VPS/web mode)
    const preCapturedStreamRef = useRef(null); // visionOS: mic captured before XR entry
    const micStreamRef = useRef(null);
    const micAudioContextRef = useRef(null);
    const micSourceNodeRef = useRef(null);
    const micProcessorRef = useRef(null);
    const micSentFirstChunkRef = useRef(false);
    const micSampleRateRef = useRef(16000);
    const micSuspensionIntervalRef = useRef(null);

    // Safari detection helper — Safari ignores requested sampleRate and
    // may need JSON-serialized audio chunks instead of raw ArrayBuffer.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    useEffect(() => {
        isMutedRef.current = isMuted;
        if (isMuted) setHudAwake(false);
    }, [isMuted]);

    const startBrowserMicStream = async () => {
        if (micStreamRef.current) return;
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            addMessage('System', 'Mic streaming requires HTTPS or localhost.');
            return;
        }
        try {
            // On visionOS, getUserMedia returns a dead stream inside an active
            // XR session. Reuse the pre-captured stream when available.
            let stream;
            if (preCapturedStreamRef.current && preCapturedStreamRef.current.active) {
                stream = preCapturedStreamRef.current;
                console.log('[MicStream] Reusing pre-captured mic stream for XR');
            } else {
                const savedMic = localStorage.getItem('selectedMicId');
                const audioConstraints = savedMic
                    ? { deviceId: { ideal: savedMic } }
                    : true;
                stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            }
            micStreamRef.current = stream;

            // All browsers: use ScriptProcessorNode to send raw PCM Int16.
            // MediaRecorder on Safari sends audio/mp4 (AAC) which the backend
            // cannot decode for transcription. ScriptProcessorNode works on
            // Safari 17+ / visionOS Safari and sends raw PCM that the backend expects.
            //
            // Don't request 16kHz — Safari ignores the requested sampleRate
            // silently and uses the device native rate (44100/48000). Let the
            // browser use its native rate; the backend resamples to 16kHz.
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Safari suspends new AudioContexts until resumed after a user gesture.
            // Without this, onaudioprocess never fires and no audio is transmitted.
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            micAudioContextRef.current = audioContext;
            // Safari may ignore the requested sampleRate and use the device native
            // rate (44100/48000). Read the actual rate so the backend knows.
            micSampleRateRef.current = audioContext.sampleRate || 16000;
            console.log('[MicStream] AudioContext state:', audioContext.state, 'sampleRate:', audioContext.sampleRate);
            // Tell backend the actual sample rate so it can resample if needed.
            socket.emit('mic_sample_rate', { sample_rate: micSampleRateRef.current });
            const source = audioContext.createMediaStreamSource(stream);
            micSourceNodeRef.current = source;

            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            micProcessorRef.current = processor;

            let chunkCount = 0;
            processor.onaudioprocess = (event) => {
                if (isMutedRef.current) return;
                // Safari can re-suspend the context; nudge it back.
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                const input = event.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) {
                    const s = Math.max(-1, Math.min(1, input[i]));
                    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }
                // Safari: send as JSON object with sample rate inline to avoid
                // binary serialization issues and race with mic_sample_rate event.
                // Chrome: send raw ArrayBuffer for best performance.
                if (isSafari) {
                    socket.emit('mic_audio_chunk', {
                        sr: audioContext.sampleRate,
                        pcm: Array.from(int16),
                    });
                } else {
                    socket.emit('mic_audio_chunk', int16.buffer);
                }

                chunkCount++;
                if (chunkCount === 1) {
                    console.log('[MicStream] First audio chunk sent', {
                        samples: int16.length,
                        sampleRate: audioContext.sampleRate,
                        ctxState: audioContext.state,
                        socketConnected: socket.connected
                    });
                }
                if (chunkCount % 50 === 0) {
                    console.log('[MicStream] chunks sent:', chunkCount, 'ctxState:', audioContext.state);
                }
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            // External suspension poller — Safari/visionOS can suspend the
            // AudioContext outside the processor callback (deadlock: the
            // onaudioprocess handler never fires so it can't self-resume).
            micSuspensionIntervalRef.current = setInterval(() => {
                if (micAudioContextRef.current?.state === 'suspended') {
                    console.log('[MicStream] AudioContext suspended externally, resuming…');
                    micAudioContextRef.current.resume();
                }
            }, 1000);

            addMessage('System', 'Browser mic streaming enabled.');
        } catch (err) {
            console.error('[MicStream] failed:', err);
            addMessage('System', `Mic streaming failed: ${err?.message ?? String(err)}`);
        }
    };

    const stopBrowserMicStream = async () => {
        try {
            if (micSuspensionIntervalRef.current) {
                clearInterval(micSuspensionIntervalRef.current);
            }
            if (micProcessorRef.current) {
                micProcessorRef.current.disconnect();
                micProcessorRef.current.onaudioprocess = null;
            }
            if (micSourceNodeRef.current) micSourceNodeRef.current.disconnect();
            if (micAudioContextRef.current) await micAudioContextRef.current.close();
            if (micStreamRef.current) {
                micStreamRef.current.getTracks().forEach((t) => t.stop());
            }
        } finally {
            micSuspensionIntervalRef.current = null;
            micProcessorRef.current = null;
            micSourceNodeRef.current = null;
            micAudioContextRef.current = null;
            micStreamRef.current = null;
            micSentFirstChunkRef.current = false;
        }
    };

    // Text-only fallback support (OpenAI/Ollama): use browser SpeechRecognition for voice input.
    const [openAiFallbackActive, setOpenAiFallbackActive] = useState(false);
    const openAiFallbackActiveRef = useRef(false);
    useEffect(() => { openAiFallbackActiveRef.current = openAiFallbackActive; }, [openAiFallbackActive]);
    const speechRecRef = useRef(null);
    const speechRecActiveRef = useRef(false);
    const speechRecRestartTimerRef = useRef(null);

    const startBrowserSpeechRecognition = () => {
        if (speechRecActiveRef.current) return;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            addMessage('System', 'Browser speech recognition is not supported here.');
            return;
        }
        if (!window.isSecureContext) {
            addMessage('System', 'Speech recognition requires HTTPS or localhost.');
            return;
        }

        const rec = speechRecRef.current || new SR();
        speechRecRef.current = rec;

        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onresult = (event) => {
            let finalText = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const res = event.results[i];
                if (!res?.[0]?.transcript) continue;
                if (res.isFinal) finalText += res[0].transcript;
            }
            const cleaned = finalText.trim();
            if (!cleaned) return;
            lastSpeechAtRef.current = performance.now();
            setHudAwake(true);
            addMessage('User', cleaned);
            socket.emit('user_input', { text: cleaned });
        };

        rec.onstart = () => {
            console.log('[SpeechRec] started');
        };

        rec.onerror = (e) => {
            console.warn('[SpeechRec] error:', e);
        };

        rec.onend = () => {
            speechRecActiveRef.current = false;
            if (!openAiFallbackActive || isMutedRef.current) return;
            // Some browsers stop automatically after silence; keep it alive.
            speechRecRestartTimerRef.current = window.setTimeout(() => {
                try {
                    if (!speechRecActiveRef.current) rec.start();
                    speechRecActiveRef.current = true;
                } catch {
                    // ignore
                }
            }, 450);
        };

        try {
            rec.start();
            speechRecActiveRef.current = true;
            addMessage('System', 'Browser speech recognition enabled (OpenAI fallback).');
        } catch (e) {
            console.warn('[SpeechRec] start failed:', e);
        }
    };

    const stopBrowserSpeechRecognition = () => {
        if (speechRecRestartTimerRef.current) {
            window.clearTimeout(speechRecRestartTimerRef.current);
            speechRecRestartTimerRef.current = null;
        }
        const rec = speechRecRef.current;
        if (!rec) return;
        try {
            rec.onresult = null;
            rec.onerror = null;
            rec.onend = null;
            rec.stop();
        } catch {
            // ignore
        } finally {
            speechRecActiveRef.current = false;
        }
    };

    useEffect(() => {
        if (openAiFallbackActive && isConnected && !isMuted) {
            // Prefer browser STT so voice input still works without Gemini.
            startBrowserSpeechRecognition();
            // Avoid streaming raw audio to a backend session that doesn't exist.
            stopBrowserMicStream();
            return;
        }
        stopBrowserSpeechRecognition();
    }, [openAiFallbackActive, isConnected, isMuted]);

    // Device states - microphones, speakers, webcams
    const [micDevices, setMicDevices] = useState([]);
    const [speakerDevices, setSpeakerDevices] = useState([]);
    const [webcamDevices, setWebcamDevices] = useState([]);

    // Selected device IDs - restored from localStorage
    const [selectedMicId, setSelectedMicId] = useState(() => localStorage.getItem('selectedMicId') || '');
    const [selectedSpeakerId, setSelectedSpeakerId] = useState(() => localStorage.getItem('selectedSpeakerId') || '');
    const [selectedWebcamId, setSelectedWebcamId] = useState(() => localStorage.getItem('selectedWebcamId') || '');

    // Reusable device enumeration — called on init and after permission grant
    const enumerateMediaDevices = useCallback(() => {
        if (!window.isSecureContext || !navigator.mediaDevices?.enumerateDevices) {
            console.warn('[MediaDevices] Not available (requires HTTPS)');
            return;
        }
        navigator.mediaDevices.enumerateDevices()
            .then(devs => {
                const audioInputs = devs.filter(d => d.kind === 'audioinput');
                const audioOutputs = devs.filter(d => d.kind === 'audiooutput');
                const videoInputs = devs.filter(d => d.kind === 'videoinput');

                setMicDevices(audioInputs);
                setSpeakerDevices(audioOutputs);
                setWebcamDevices(videoInputs);

                const savedMicId = localStorage.getItem('selectedMicId');
                if (savedMicId && audioInputs.some(d => d.deviceId === savedMicId)) {
                    setSelectedMicId(savedMicId);
                } else if (audioInputs.length > 0) {
                    setSelectedMicId(audioInputs[0].deviceId);
                }

                const savedSpeakerId = localStorage.getItem('selectedSpeakerId');
                if (savedSpeakerId && audioOutputs.some(d => d.deviceId === savedSpeakerId)) {
                    setSelectedSpeakerId(savedSpeakerId);
                } else if (audioOutputs.length > 0) {
                    setSelectedSpeakerId(audioOutputs[0].deviceId);
                }

                const savedWebcamId = localStorage.getItem('selectedWebcamId');
                if (savedWebcamId && videoInputs.some(d => d.deviceId === savedWebcamId)) {
                    setSelectedWebcamId(savedWebcamId);
                } else if (videoInputs.length > 0) {
                    setSelectedWebcamId(videoInputs[0].deviceId);
                }

                console.log(`[MediaDevices] Found ${audioInputs.length} mics, ${audioOutputs.length} speakers, ${videoInputs.length} cameras`);
            })
            .catch(err => {
                console.error('[MediaDevices] enumerateDevices failed:', err);
            });
    }, []);

    // Re-enumerate devices after permission is granted (devices now have labels)
    useEffect(() => {
        if (mediaPermission === 'granted') {
            enumerateMediaDevices();
        }
    }, [mediaPermission, enumerateMediaDevices]);

    const [showSettings, setShowSettings] = useState(false);
    const [currentProject, setCurrentProject] = useState('default');

    // Avatar customization state
    const [showAvatarCustomizer, setShowAvatarCustomizer] = useState(false);
    const [avatarConfig, setAvatarConfig] = useState(() => {
        const saved = localStorage.getItem('joda_avatar_config');
        return saved ? JSON.parse(saved) : {
            mode: 'avatar-holographic',
            customUrl: '',
            rpmAvatarUrl: '',
            photoPreview: null
        };
    });

    // Spatial 3D positions for panels (used by SpatialWorld)
    const [spatialPositions, setSpatialPositions] = useState({ ...DEFAULT_POSITIONS });

    // Panel dimensions — updated by XR two-hand pinch gesture
    const [panelDimensions, setPanelDimensions] = useState({});
    const handlePanelResize = useCallback((id, width, height) => {
        setPanelDimensions(prev => ({ ...prev, [id]: { width, height } }));
    }, []);

    // Panel rotations — updated by XR two-hand twist gesture [x, y, z] euler
    const [panelRotations, setPanelRotations] = useState({});
    const handlePanelRotate = useCallback((id, rotation) => {
        setPanelRotations(prev => ({ ...prev, [id]: rotation }));
    }, []);


    // Hand Control State
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
    const [isPinching, setIsPinching] = useState(false);
    const [isHandTrackingEnabled, setIsHandTrackingEnabled] = useState(false); // DEFAULT OFF
    const [vrPerspective, setVrPerspective] = useState('first'); // 'first' | 'third'
    const [vrLocomotionMode, setVrLocomotionMode] = useState('smooth'); // 'smooth' | 'teleport'
    const [cursorSensitivity, setCursorSensitivity] = useState(2.0);
    const [isCameraFlipped, setIsCameraFlipped] = useState(false); // Gesture control camera flip

    // Refs for Loop Access (Avoiding Closure Staleness)
    const isHandTrackingEnabledRef = useRef(false); // DEFAULT OFF
    const cursorSensitivityRef = useRef(2.0);
    const isCameraFlippedRef = useRef(false);
    const handLandmarkerRef = useRef(null);
    const cursorTrailRef = useRef([]); // Stores last N positions for trail
    const [ripples, setRipples] = useState([]); // Visual ripples on click

    // Web Audio Context for Mic Visualization
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const sourceRef = useRef(null);
    const animationFrameRef = useRef(null);

    // Video Refs
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const transmissionCanvasRef = useRef(null); // Dedicated canvas for resizing payload
    const videoIntervalRef = useRef(null);
    const lastFrameTimeRef = useRef(0);
    const frameCountRef = useRef(0);
    const lastVideoTimeRef = useRef(-1);

    // Ref to track video state for the loop (avoids closure staleness)
    const isVideoOnRef = useRef(false);
    const activeDragElementRef = useRef(null);
    const lastActiveDragElementRef = useRef(null);
    const lastCursorPosRef = useRef({ x: 0, y: 0 });
    const lastWristPosRef = useRef({ x: 0, y: 0 }); // For stable fist gesture tracking

    // Smoothing and Snapping Refs
    const smoothedCursorPosRef = useRef({ x: 0, y: 0 });
    const snapStateRef = useRef({ isSnapped: false, element: null, snapPos: { x: 0, y: 0 } });

    // Update refs when state changes
    useEffect(() => {
        isHandTrackingEnabledRef.current = isHandTrackingEnabled;
        cursorSensitivityRef.current = cursorSensitivity;
        isCameraFlippedRef.current = isCameraFlipped;
    }, [isHandTrackingEnabled, cursorSensitivity, isCameraFlipped]);

    // Live Clock Update
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Legacy centering removed — spatial 3D world handles panel positioning.

    // Ref to track if model has been auto-connected (prevents duplicate connections)
    const hasAutoConnectedRef = useRef(false);

    // Auto-Connect Model on Start (Only after Auth and devices loaded)
    useEffect(() => {
        // Only auto-connect once: when socket connected and authenticated.
        if (isConnected && isAuthenticated && socketConnected && !hasAutoConnectedRef.current) {
            hasAutoConnectedRef.current = true;

            // Trigger Kasa and Printer Discovery
            socket.emit('discover_kasa');
            socket.emit('discover_printers');

            // Connect to model with small delay for socket stability
            const timer = setTimeout(() => {
                const index = micDevices.findIndex(d => d.deviceId === selectedMicId);
                const queryDevice = micDevices.find(d => d.deviceId === selectedMicId);
                const deviceName = queryDevice ? queryDevice.label : null;
                console.log("Auto-connecting to model with device:", deviceName, "Index:", index);

                setStatus('Connecting...');
                socket.emit('start_audio', {
                    device_index: index >= 0 ? index : null,
                    device_name: deviceName,
                    muted: isMuted,
                    audio_source: 'browser'
                });
            }, 500);
        }
    }, [isConnected, isAuthenticated, socketConnected, micDevices, selectedMicId]);

    useEffect(() => {
        // Socket IO Setup
        socket.on('connect', () => {
            setStatus('Connected');
            setSocketConnected(true);
            socket.emit('get_settings');
        });
        socket.on('disconnect', () => {
            setStatus('Disconnected');
            setSocketConnected(false);
            // Allow auto-connect to run again after a backend restart.
            hasAutoConnectedRef.current = false;
        });
        socket.on('status', (data) => {
            const msg = typeof data?.msg === 'string' ? data.msg : '';
            if (msg) addMessage('System', msg);

            // Toggle voice input strategy when backend falls back to OpenAI text-only mode.
            const isTextFallback =
                /openai fallback/i.test(msg) ||
                /ollama fallback/i.test(msg) ||
                /\btext-only\b/i.test(msg) ||
                /gemini unavailable/i.test(msg);

            if (isTextFallback) {
                setOpenAiFallbackActive(true);
                // Hint for debugging/UX: in fallback we use browser STT.
                if (typeof window !== 'undefined' && !window.isSecureContext) {
                    addMessage('System', '[Voice] Fallback STT requires HTTPS or localhost.');
                }
            }
            if (msg === 'JODA Stopped') setOpenAiFallbackActive(false);
            // If we started without any fallback markers, prefer Gemini mic streaming.
            if (msg.startsWith('JODA Started') && !isTextFallback) setOpenAiFallbackActive(false);

            // Update status bar based on backend messages
            if (msg.startsWith('JODA Started')) {
                setStatus('Model Connected');
                // If we're unmuted, begin the correct voice input path immediately.
                if (!isMutedRef.current) {
                    if (openAiFallbackActive) startBrowserSpeechRecognition();
                    else startBrowserMicStream();
                    ensureAiAudioContext();
                }
            } else if (msg === 'JODA Already Running') {
                setStatus('Model Connected');
                if (!isMutedRef.current) {
                    if (openAiFallbackActive) startBrowserSpeechRecognition();
                    else startBrowserMicStream();
                    ensureAiAudioContext();
                }
            } else if (msg === 'JODA Stopped') {
                setStatus('Connected');
            }
        });
        socket.on('audio_data', (data) => {
            setAiAudioData(data.data);

            // Detect if AI is speaking based on audio level
            const audioArray = Array.isArray(data.data) ? data.data : [];
            const maxAmplitude = audioArray.length > 0 ? Math.max(...audioArray) : 0;
            const avgAmplitude = audioArray.length > 0 ? audioArray.reduce((a, b) => a + b, 0) / audioArray.length : 0;

            // Debug logging (comment out in production)
            if (maxAmplitude > 5) {
                console.log('[LIP SYNC] Max:', maxAmplitude, 'Avg:', avgAmplitude.toFixed(1));
            }

            // If there's significant audio, mark AI as speaking (very sensitive threshold)
            if (maxAmplitude > 5 || avgAmplitude > 3) {
                setIsAiSpeaking(true);
                // Clear any existing timeout
                if (aiSpeakingTimeoutRef.current) {
                    clearTimeout(aiSpeakingTimeoutRef.current);
                }
                // Set timeout to mark as not speaking after 80ms of silence (very fast response)
                aiSpeakingTimeoutRef.current = setTimeout(() => {
                    setIsAiSpeaking(false);
                }, 80);
            }

            // Also play the PCM stream as speech audio.
            // This requires a user gesture at least once to unlock audio playback in the browser.
            playAiPcmChunk(data.data);
        });
        socket.on('tts_text', (data) => {
            // Text-to-speech fallback for text-only model responses (e.g., OpenAI fallback).
            speakTtsText(data?.text);
        });
        socket.on('auth_status', (data) => {
            console.log("Auth Status:", data);
            setIsAuthenticated(data.authenticated);
            if (data.authenticated) {
                // If authenticated, hide lock screen with animation (handled by component if visible)
                // But simpler: just hide it
                // Actually, wait for animation if it WAS visible.
                // For now, let's just assume if authenticated -> hide
                // But we want the component to invoke onAnimationComplete.
                // If we are starting up (and face auth disabled), we want it FALSE immediately.
                if (!isLockScreenVisible) {
                    // Do nothing, already hidden
                }
            } else {
                // If NOT authenticated, show lock screen
                setIsLockScreenVisible(true);
            }
        });

        socket.on('settings', (settings) => {
            console.log("[Settings] Received:", settings);
            if (settings && typeof settings.face_auth_enabled !== 'undefined') {
                setFaceAuthEnabled(settings.face_auth_enabled);
                localStorage.setItem('face_auth_enabled', settings.face_auth_enabled);
            }
            if (typeof settings.camera_flipped !== 'undefined') {
                console.log("[Settings] Camera flip set to:", settings.camera_flipped);
                setIsCameraFlipped(settings.camera_flipped);
            }
        });
        socket.on('error', (data) => {
            console.error("Socket Error:", data);
            addMessage('System', `Error: ${data.msg}`);
        });
        socket.on('cad_data', (data) => {
            console.log("Received CAD Data:", data);
            setCadData(data);
            setCadThoughts(''); // Clear thoughts when generation complete
            setShowCadWindow(true); // Open window when data arrives
        });
        socket.on('cad_status', (data) => {
            console.log("Received CAD Status:", data);
            // Extract retry info from extended payload
            if (data.attempt) {
                setCadRetryInfo({
                    attempt: data.attempt,
                    maxAttempts: data.max_attempts || 3,
                    error: data.error
                });
            }
            if (data.status === 'generating' || data.status === 'retrying') {
                setCadData({ format: 'loading' });
                setShowCadWindow(true);
                if (data.status === 'generating' && data.attempt === 1) {
                    setCadThoughts(''); // Clear previous thoughts for new generation
                }
            } else if (data.status === 'failed') {
                // Keep loading state but show error
                setCadData({ format: 'loading' });
            }
        });
        socket.on('cad_thought', (data) => {
            // Append streaming thought text
            setCadThoughts(prev => prev + data.text);
        });
        socket.on('browser_frame', (data) => {
            setBrowserData(prev => ({
                image: data.image,
                logs: [...prev.logs, data.log].filter(l => l).slice(-50)
            }));
            setShowBrowserWindow(true);
        });

        socket.on('media_asset', (asset) => {
            setMediaAssets(prev => [...prev, { ...asset, _receivedAt: Date.now() }].slice(-50));
            setShowMediaGallery(true);
        });

        // Image generation lifecycle: generating → done/error
        socket.on('image_status', (data) => {
            if (data.status === 'generating') {
                setImagePreview({ visible: true, status: 'generating', prompt: data.prompt || '', imageUrl: null, mediaUrl: null, mediaType: data.mediaType || 'image', error: null, provider: data.provider || '' });
            } else if (data.status === 'trying_fallback' || data.status === 'trying_provider') {
                setImagePreview(prev => ({ ...prev, status: data.status, provider: data.provider || prev.provider }));
            } else if (data.status === 'done') {
                setImagePreview(prev => ({ ...prev, status: 'done', imageUrl: data.imageUrl || prev.imageUrl, mediaUrl: data.mediaUrl || prev.mediaUrl, prompt: data.prompt || prev.prompt, mediaType: data.mediaType || prev.mediaType }));
            } else if (data.status === 'error') {
                setImagePreview(prev => ({ ...prev, status: 'error', error: data.error || 'Unknown error', prompt: data.prompt || prev.prompt }));
            }
        });

        // Handle streaming transcription
        socket.on('transcription', (data) => {
            if (data?.sender === 'User') {
                lastSpeechAtRef.current = performance.now();
                setHudAwake(true);
            }

            // 🔥 NEW: Track current speaking text for avatar lip sync
            if (data?.sender === 'JODA' && data?.text) {
                setCurrentSpeakingText(prev => prev + data.text);

                // Clear any existing timeout to prevent early clearing
                if (clearSpeakingTextTimeout.current) {
                    clearTimeout(clearSpeakingTextTimeout.current);
                }

                // Set new timeout to clear text after speech should be done
                clearSpeakingTextTimeout.current = setTimeout(() => {
                    setCurrentSpeakingText('');
                    clearSpeakingTextTimeout.current = null;
                }, 5000); // 5 seconds after last chunk (increased from 3s)
            }

            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];

                // If the last message is from the same sender, append the chunk
                if (lastMsg && lastMsg.sender === data.sender) {
                    // Create a NEW object instead of mutating (prevents React StrictMode duplication)
                    return [
                        ...prev.slice(0, -1),
                        {
                            ...lastMsg,
                            text: lastMsg.text + data.text
                        }
                    ];
                } else {
                    // New message block
                    return [...prev, {
                        sender: data.sender,
                        text: data.text,
                        time: new Date().toLocaleTimeString()
                    }];
                }
            });
        });

        // Handle tool confirmation requests
        socket.on('tool_confirmation_request', (data) => {
            console.log("Received Confirmation Request:", data);
            setConfirmationRequest(data);
        });

        // Ralph Orchestrator logs
        socket.on('ralph_log', (data) => {
            if (data?.line) addMessage('Ralph', data.line);
        });
        socket.on('ralph_status', (data) => {
            addMessage(
                'System',
                `[Ralph] ${data?.status ?? 'status'}${data?.project ? ` (${data.project})` : ''}${typeof data?.exit_code === 'number' ? ` exit=${data.exit_code}` : ''}`
            );
            if (data?.cmd) addMessage('System', `[Ralph] cmd: ${data.cmd}`);
        });
        socket.on('ralph_projects', (data) => {
            const root = data?.root ?? '';
            const projects = Array.isArray(data?.projects) ? data.projects : [];
            const preview = projects.slice(0, 30).map(p => `- ${p}`).join('\n');
            addMessage(
                'System',
                [
                    '[Ralph] Where should I start? Pick a folder and run one of:',
                    `- /todo <project>`,
                    `- /build <project>`,
                    `- /ralph <project> <prompt...>`,
                    root ? `[Ralph] Root: ${root}` : null,
                    projects.length ? `[Ralph] Projects:\n${preview}${projects.length > 30 ? `\n...and ${projects.length - 30} more` : ''}` : '[Ralph] No projects found under root.'
                ].filter(Boolean).join('\n')
            );
        });

        socket.on('joda_projects', (data) => {
            const root = data?.root ?? '';
            const projects = Array.isArray(data?.projects) ? data.projects : [];
            const preview = projects.slice(0, 30).map(p => `- ${p}`).join('\n');
            addMessage(
                'System',
                [
                    '[JODA] Project folders on disk:',
                    root ? `[JODA] Root: ${root}` : null,
                    projects.length ? `[JODA] Projects:\n${preview}${projects.length > 30 ? `\n...and ${projects.length - 30} more` : ''}` : '[JODA] No project folders found.'
                ].filter(Boolean).join('\n')
            );
        });

        // Handle Print Window Request (from CadWindow)
        socket.on('request_print_window', () => {
            setShowPrinterWindow(true);
        });

        // Kasa Devices
        socket.on('kasa_devices', (devices) => {
            console.log("Kasa Devices:", devices);
            setKasaDevices(devices);
        });

        socket.on('kasa_update', (data) => {
            setKasaDevices(prev => prev.map(d => {
                if (d.ip === data.ip) {
                    // Update only fields that are not null/undefined
                    return {
                        ...d,
                        is_on: data.is_on !== null ? data.is_on : d.is_on,
                        brightness: data.brightness !== null ? data.brightness : d.brightness
                    };
                }
                return d;
            }));
        });

        socket.on('project_update', (data) => {
            console.log("Project Update:", data.project);
            setCurrentProject(data.project);
            addMessage('System', `Switched to project: ${data.project}`);
        });

        // Track printer count for toolbar display
        socket.on('printer_list', (list) => {
            console.log('[PRINTERS] Count:', list.length);
            setPrinterCount(list.length);
        });

        // Slicing progress for top toolbar
        socket.on('slicing_progress', (data) => {
            console.log('[SLICING] Progress:', data);
            setSlicingStatus({
                active: data.percent < 100,
                percent: data.percent,
                message: data.message
            });
        });

        // Print status for top toolbar - track active prints
        socket.on('print_status_update', (data) => {
            console.log('[PRINT STATUS]', data);
            // Only show in toolbar if actively printing
            if (data.state && data.state.toLowerCase().includes('print')) {
                setActivePrintStatus({
                    printer: data.printer,
                    progress_percent: data.progress_percent,
                    time_elapsed: data.time_elapsed,
                    state: data.state
                });
            } else if (data.state && (data.state.toLowerCase() === 'idle' || data.state.toLowerCase() === 'standby' || data.state.toLowerCase() === 'complete')) {
                // Clear if print finished or idle
                setActivePrintStatus(null);
            }
        });



        // Initial device enumeration (will re-run with labels after permission grant)
        enumerateMediaDevices();

        // Initialize Hand Landmarker
        const initHandLandmarker = async () => {
            try {
                console.log("Initializing HandLandmarker...");

                // 1. Verify Model File
                console.log("Fetching model file...");
                const response = await fetch('/hand_landmarker.task');
                if (!response.ok) {
                    throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
                }
                console.log("Model file found:", response.headers.get('content-type'), response.headers.get('content-length'));

                // 2. Initialize Vision
                console.log("Initializing FilesetResolver...");
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
                );
                console.log("FilesetResolver initialized.");

                // 3. Create Landmarker
                console.log("Creating HandLandmarker (GPU)...");
                handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: `/hand_landmarker.task`,
                        delegate: "GPU" // Enable GPU acceleration
                    },
                    runningMode: "VIDEO",
                    numHands: 1
                });
                console.log("HandLandmarker initialized successfully!");
                addMessage('System', 'Hand Tracking Ready');

            } catch (error) {
                console.error("Failed to initialize HandLandmarker:", error);
                addMessage('System', `Hand Tracking Error: ${error.message}`);
            }
        };
        initHandLandmarker();

        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('status');
            socket.off('audio_data');
            socket.off('cad_data');
            socket.off('cad_thought');
            socket.off('cad_status');
            socket.off('browser_frame');
            socket.off('media_asset');
            socket.off('image_status');
            socket.off('transcription');
            socket.off('tool_confirmation_request');
            socket.off('kasa_devices');
            socket.off('printer_list');
            socket.off('slicing_progress');
            socket.off('print_status_update');
            socket.off('error');
            socket.off('ralph_log');
            socket.off('ralph_status');
            socket.off('ralph_projects');
            socket.off('joda_projects');

            stopMicVisualizer();
            stopVideo();
        };
    }, []);

    // Initial check in case we are already connected (fix race condition)
    useEffect(() => {
        if (socket.connected) {
            setStatus('Connected');
            socket.emit('get_settings');
        }
    }, []);

    // Persist device selections to localStorage when they change
    useEffect(() => {
        if (selectedMicId) {
            localStorage.setItem('selectedMicId', selectedMicId);
            console.log('[Settings] Saved microphone:', selectedMicId);
        }
    }, [selectedMicId]);

    useEffect(() => {
        if (selectedSpeakerId) {
            localStorage.setItem('selectedSpeakerId', selectedSpeakerId);
            console.log('[Settings] Saved speaker:', selectedSpeakerId);
            // Route audio to the newly selected device
            const ctx = aiAudioContextRef.current;
            if (ctx && 'setSinkId' in ctx) {
                ctx.setSinkId(selectedSpeakerId).catch(e =>
                    console.warn('[Audio] setSinkId on device change failed:', e)
                );
            }
        }
    }, [selectedSpeakerId]);

    useEffect(() => {
        if (selectedWebcamId) {
            localStorage.setItem('selectedWebcamId', selectedWebcamId);
            console.log('[Settings] Saved webcam:', selectedWebcamId);
        }
    }, [selectedWebcamId]);

    // Start/Stop Mic Visualizer
    useEffect(() => {
        if (selectedMicId) {
            startMicVisualizer(selectedMicId);
        }
    }, [selectedMicId]);

    const startMicVisualizer = async (deviceId) => {
        stopMicVisualizer();
        try {
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
                throw new Error('Mic requires HTTPS or localhost');
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: deviceId } }
            });

            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 64;

            sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
            sourceRef.current.connect(analyserRef.current);

            const updateMicData = () => {
                if (!analyserRef.current) return;
                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                analyserRef.current.getByteFrequencyData(dataArray);
                setMicAudioData(Array.from(dataArray));

                // Wake HUD when user speaks (simple VAD based on analyser magnitude).
                if (!isMutedRef.current) {
                    const max = dataArray.reduce((m, v) => (v > m ? v : m), 0);
                    const now = performance.now();
                    if (max >= HUD_AWAKE_THRESHOLD) {
                        lastSpeechAtRef.current = now;
                        setHudAwake(true);
                    } else if (isHudAwakeRef.current && now - lastSpeechAtRef.current > HUD_AWAKE_HOLD_MS) {
                        setHudAwake(false);
                    }
                }

                animationFrameRef.current = requestAnimationFrame(updateMicData);
            };

            updateMicData();
        } catch (err) {
            console.error("Error accessing microphone:", err);
            addMessage('System', `Mic disabled: ${err?.message ?? String(err)}`);
        }
    };

    const stopMicVisualizer = () => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (sourceRef.current) sourceRef.current.disconnect();
        if (audioContextRef.current) audioContextRef.current.close();
    };

    const startVideo = async () => {
        try {
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
                throw new Error('Camera requires HTTPS or localhost');
            }
            // Request 1080p resolution with selected webcam
            const constraints = {
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    aspectRatio: 16 / 9
                }
            };

            // Use selected webcam if available
            if (selectedWebcamId) {
                constraints.video.deviceId = { exact: selectedWebcamId };
            }

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
            }

            // Initialize the transmission canvas
            if (!transmissionCanvasRef.current) {
                transmissionCanvasRef.current = document.createElement('canvas');
                transmissionCanvasRef.current.width = 640;
                transmissionCanvasRef.current.height = 360;
                console.log("Initialized transmission canvas (640x360)");
            }

            setIsVideoOn(true);
            isVideoOnRef.current = true; // Update ref for loop

            console.log("Starting video loop with webcam:", selectedWebcamId || "default");
            requestAnimationFrame(predictWebcam);

        } catch (err) {
            console.error("Error accessing camera:", err);
            addMessage('System', 'Error accessing camera');
        }
    };

    const predictWebcam = () => {
        // Use ref for checking state to avoid closure staleness
        if (!videoRef.current || !canvasRef.current || !isVideoOnRef.current) {
            return;
        }

        // Check if video has valid dimensions to prevent MediaPipe crash
        if (videoRef.current.readyState < 2 || videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) {
            requestAnimationFrame(predictWebcam);
            return;
        }

        // 1. Draw Video to Local Display Canvas (Native Resolution)
        const ctx = canvasRef.current.getContext('2d');

        // Ensure canvas matches video dimensions
        if (canvasRef.current.width !== videoRef.current.videoWidth || canvasRef.current.height !== videoRef.current.videoHeight) {
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
        }

        ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);

        // 2. Send Frame to Backend (Throttled & Resized)
        // Only send if connected
        if (isConnected) {
            // Simple throttle: every 5th frame roughly
            if (frameCountRef.current % 5 === 0) {

                // Use dedicated transmission canvas for resizing
                const transCanvas = transmissionCanvasRef.current;
                if (transCanvas) {
                    const transCtx = transCanvas.getContext('2d');
                    // Draw resized image
                    transCtx.drawImage(videoRef.current, 0, 0, transCanvas.width, transCanvas.height);

                    // Convert resized image to blob
                    transCanvas.toBlob((blob) => {
                        if (blob) {
                            socket.emit('video_frame', { image: blob });
                        }
                    }, 'image/jpeg', 0.6); // Slightly higher compression for speed
                }
            }
        }


        // 3. Hand Tracking
        let startTimeMs = performance.now();
        // Use Ref for toggle check
        if (isHandTrackingEnabledRef.current && handLandmarkerRef.current && videoRef.current.currentTime !== lastVideoTimeRef.current) {
            lastVideoTimeRef.current = videoRef.current.currentTime;
            const results = handLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);

            // Log every 100 frames to confirm loop is running
            if (frameCountRef.current % 100 === 0) {
                console.log("Tracking loop running... Last result:", results.landmarks.length > 0 ? "Hand Found" : "No Hand");
            }

            if (results.landmarks && results.landmarks.length > 0) {
                const landmarks = results.landmarks[0];

                // Log on first detection
                if (cursorPos.x === 0 && cursorPos.y === 0) {
                    console.log("First hand detection!", landmarks);
                }

                // Index Finger Tip (8)
                const indexTip = landmarks[8];
                // Thumb Tip (4)
                const thumbTip = landmarks[4];

                // Map to Screen Coords with Sensitivity Scaling
                // Sensitivity: Map center 50% of camera to 100% of screen.
                const SENSITIVITY = cursorSensitivityRef.current;

                // Apply camera flip if enabled (horizontal mirror)
                const rawX = isCameraFlippedRef.current ? (1 - indexTip.x) : indexTip.x;

                // 1. Normalize and Scale X
                let normX = (rawX - 0.5) * SENSITIVITY + 0.5;
                // Clamp to [0, 1]
                normX = Math.max(0, Math.min(1, normX));

                // 2. Normalize and Scale Y
                let normY = (indexTip.y - 0.5) * SENSITIVITY + 0.5;
                normY = Math.max(0, Math.min(1, normY));

                const targetX = normX * window.innerWidth;
                const targetY = normY * window.innerHeight;

                // 1. Smoothing (Lerp)
                // Factor 0.2 = smooth but responsive. Lower = smoother/slower.
                const lerpFactor = 0.2;
                smoothedCursorPosRef.current.x = smoothedCursorPosRef.current.x + (targetX - smoothedCursorPosRef.current.x) * lerpFactor;
                smoothedCursorPosRef.current.y = smoothedCursorPosRef.current.y + (targetY - smoothedCursorPosRef.current.y) * lerpFactor;

                let finalX = smoothedCursorPosRef.current.x;
                let finalY = smoothedCursorPosRef.current.y;

                // 2. Snap-to-Button Logic
                const SNAP_THRESHOLD = 50; // Pixels to snap
                const UNSNAP_THRESHOLD = 100; // Pixels to unsnap (Hysteresis)

                if (snapStateRef.current.isSnapped) {
                    // Check if we should unsnap
                    const dist = Math.sqrt(
                        Math.pow(finalX - snapStateRef.current.snapPos.x, 2) +
                        Math.pow(finalY - snapStateRef.current.snapPos.y, 2)
                    );

                    if (dist > UNSNAP_THRESHOLD) {
                        // REMOVE HIGHLIGHT
                        if (snapStateRef.current.element) {
                            snapStateRef.current.element.classList.remove('snap-highlight');
                            snapStateRef.current.element.style.boxShadow = '';
                            snapStateRef.current.element.style.backgroundColor = '';
                            snapStateRef.current.element.style.borderColor = '';
                        }

                        snapStateRef.current = { isSnapped: false, element: null, snapPos: { x: 0, y: 0 } };
                    } else {
                        // Stay snapped
                        finalX = snapStateRef.current.snapPos.x;
                        finalY = snapStateRef.current.snapPos.y;
                    }
                } else {
                    // Check if we should snap
                    // Find all interactive elements
                    const targets = Array.from(document.querySelectorAll('button, input, select, .draggable'));
                    let closest = null;
                    let minDist = Infinity;

                    for (const el of targets) {
                        const rect = el.getBoundingClientRect();
                        const centerX = rect.left + rect.width / 2;
                        const centerY = rect.top + rect.height / 2;
                        const dist = Math.sqrt(Math.pow(finalX - centerX, 2) + Math.pow(finalY - centerY, 2));

                        if (dist < minDist) {
                            minDist = dist;
                            closest = { el, centerX, centerY };
                        }
                    }

                    if (closest && minDist < SNAP_THRESHOLD) {
                        snapStateRef.current = {
                            isSnapped: true,
                            element: closest.el,
                            snapPos: { x: closest.centerX, y: closest.centerY }
                        };
                        finalX = closest.centerX;
                        finalY = closest.centerY;

                        // SNAP HIGHLIGHT Logic
                        closest.el.classList.add('snap-highlight');
                        // Add some inline style for the glow if class isn't enough (using imperative for speed)
                        closest.el.style.boxShadow = '0 0 20px rgba(34, 211, 238, 0.6)';
                        closest.el.style.backgroundColor = 'rgba(6, 182, 212, 0.2)';
                        closest.el.style.borderColor = 'rgba(34, 211, 238, 1)';
                    }
                }

                // Update Cursor Loop
                setCursorPos({ x: finalX, y: finalY });

                // Trail Logic: Removed per user request

                // Pinch Detection (Distance between Index and Thumb)
                const distance = Math.sqrt(
                    Math.pow(indexTip.x - thumbTip.x, 2) + Math.pow(indexTip.y - thumbTip.y, 2)
                );

                const isPinchNow = distance < 0.05; // Threshold
                if (isPinchNow && !isPinching) {
                    // Click Triggered
                    console.log("Click triggered at", finalX, finalY);

                    // Ripple Effect: Removed per user request

                    const el = document.elementFromPoint(finalX, finalY);
                    if (el) {
                        // Find closest clickable element (button, input, etc.)
                        const clickable = el.closest('button, input, a, [role="button"]');
                        if (clickable && typeof clickable.click === 'function') {
                            clickable.click();
                        } else if (typeof el.click === 'function') {
                            el.click();
                        }
                    }
                }
                setIsPinching(isPinchNow);

                // Fist Detection for Gesture-Based Dragging (Popup Windows Only)
                // Detects if all fingers are folded (tips closer to wrist than MCPs)
                const isFingerFolded = (tipIdx, mcpIdx) => {
                    const tip = landmarks[tipIdx];
                    const mcp = landmarks[mcpIdx];
                    const wrist = landmarks[0];
                    const distTip = Math.sqrt(Math.pow(tip.x - wrist.x, 2) + Math.pow(tip.y - wrist.y, 2));
                    const distMcp = Math.sqrt(Math.pow(mcp.x - wrist.x, 2) + Math.pow(mcp.y - wrist.y, 2));
                    return distTip < distMcp; // Folded if tip is closer
                };

                const isFist = isFingerFolded(8, 5) && isFingerFolded(12, 9) && isFingerFolded(16, 13) && isFingerFolded(20, 17);

                // Get wrist position in screen coordinates (stable reference for fist gesture)
                const wrist = landmarks[0];
                const wristRawX = isCameraFlippedRef.current ? (1 - wrist.x) : wrist.x;
                const wristNormX = Math.max(0, Math.min(1, (wristRawX - 0.5) * SENSITIVITY + 0.5));
                const wristNormY = Math.max(0, Math.min(1, (wrist.y - 0.5) * SENSITIVITY + 0.5));
                const wristScreenX = wristNormX * window.innerWidth;
                const wristScreenY = wristNormY * window.innerHeight;

                if (isFist) {
                    if (!activeDragElementRef.current) {
                        // Only check popup windows (draggable elements)
                        const draggableElements = ['cad', 'browser', 'kasa', 'printer'];

                        for (const id of draggableElements) {
                            const el = document.getElementById(id);
                            if (el) {
                                const rect = el.getBoundingClientRect();
                                // Use the cursor position from before fist was made for hit detection
                                if (finalX >= rect.left && finalX <= rect.right && finalY >= rect.top && finalY <= rect.bottom) {
                                    activeDragElementRef.current = id;
                                    // Lock the initial wrist position when starting drag
                                    lastWristPosRef.current = { x: wristScreenX, y: wristScreenY };
                                    break;
                                }
                            }
                        }
                    }

                    if (activeDragElementRef.current) {
                        // Use WRIST movement (not index finger) for stable dragging
                        // The wrist doesn't move when making a fist
                        const dx = wristScreenX - lastWristPosRef.current.x;
                        const dy = wristScreenY - lastWristPosRef.current.y;

                        // Hand-drag of 2D elements removed — panels now in 3D space

                        // Update last wrist position
                        lastWristPosRef.current = { x: wristScreenX, y: wristScreenY };
                    }
                } else {
                    activeDragElementRef.current = null;
                }

                // Sync ref for visual feedback (only on change)
                if (activeDragElementRef.current !== lastActiveDragElementRef.current) {
                    lastActiveDragElementRef.current = activeDragElementRef.current;
                }

                lastCursorPosRef.current = { x: finalX, y: finalY };

                // Draw Skeleton
                drawSkeleton(ctx, landmarks);
            }

        }

        // 4. FPS Calculation
        const now = performance.now();
        frameCountRef.current++;
        if (now - lastFrameTimeRef.current >= 1000) {
            setFps(frameCountRef.current);
            frameCountRef.current = 0;
            lastFrameTimeRef.current = now;
        }

        if (isVideoOnRef.current) {
            requestAnimationFrame(predictWebcam);
        }
    };

    const drawSkeleton = (ctx, landmarks) => {
        ctx.strokeStyle = '#00FFFF';
        ctx.lineWidth = 2;

        // Connections
        const connections = HandLandmarker.HAND_CONNECTIONS;
        for (const connection of connections) {
            const start = landmarks[connection.start];
            const end = landmarks[connection.end];
            ctx.beginPath();
            ctx.moveTo(start.x * canvasRef.current.width, start.y * canvasRef.current.height);
            ctx.lineTo(end.x * canvasRef.current.width, end.y * canvasRef.current.height);
            ctx.stroke();
        }
    };

    const stopVideo = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
        setIsVideoOn(false);
        isVideoOnRef.current = false; // Update ref
        setFps(0);
    };

    const toggleVideo = () => {
        if (isVideoOn) {
            stopVideo();
        } else {
            startVideo();
        }
    };

    const addMessage = (sender, text) => {
        setMessages(prev => [...prev, { sender, text, time: new Date().toLocaleTimeString() }]);
    };

    const togglePower = () => {
        if (isConnected) {
            socket.emit('stop_audio');
            setIsConnected(false);
            // Ensure all capture is stopped when powering off.
            stopBrowserMicStream();
            stopBrowserSpeechRecognition();
        } else {
            const index = micDevices.findIndex(d => d.deviceId === selectedMicId);
            const queryDevice = micDevices.find(d => d.deviceId === selectedMicId);
            const deviceName = queryDevice ? queryDevice.label : null;
            socket.emit('start_audio', {
                device_index: index >= 0 ? index : null,
                device_name: deviceName,
                muted: false,
                audio_source: 'browser'
            });
            setIsConnected(true);
            // Power-on should listen by default.
            isMutedRef.current = false;
            setIsMuted(false);

            // If we are already unmuted, start the appropriate capture path immediately.
            if (openAiFallbackActive) startBrowserSpeechRecognition();
            else startBrowserMicStream();
            ensureAiAudioContext();
        }
    };

    const toggleMute = () => {
        if (!isConnected) return; // Can't mute if not connected

        if (isMuted) {
            socket.emit('resume_audio');
            setIsMuted(false);
            if (openAiFallbackActive) {
                if (typeof window !== 'undefined' && !window.isSecureContext) {
                    addMessage('System', 'Voice input requires HTTPS or localhost.');
                }
                startBrowserSpeechRecognition();
            } else {
                startBrowserMicStream();
            }
            // Unmuting is a user gesture; use it to unlock AI playback too.
            ensureAiAudioContext();
        } else {
            socket.emit('pause_audio');
            setIsMuted(true);
            stopBrowserMicStream();
            stopBrowserSpeechRecognition();
        }
    };

    const toggleSpeaker = async () => {
        // User gesture: allow unlock/resume audio context.
        await ensureAiAudioContext();
        setIsSpeakerMuted((prev) => !prev);
    };

    const handleSend = (e) => {
        if (e?.key !== 'Enter') return;
        if (e.isComposing) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        if (inputValue.trim()) {
            const text = inputValue.trim();
            const lower = text.toLowerCase();

            // Direct agent commands (bypass model tool calling)
            if (lower === '/help') {
                addMessage(
                    'System',
                    [
                        'Commands:',
                        '- /web <task>  (run web agent)',
                        '- /browse <task>  (run browser task agent)',
                        '- /cad <task>  (run 3D/CAD agent)',
                        '- /ralph <project> <prompt...>  (run Ralph with your prompt)',
                        '- /todo <project>  (Ralph: generate TODO.md only)',
                        '- /build <project>  (Ralph: generate TODO.md then implement tasks)',
                        '- /expert [on|off]  (expand shell allowlist; enables bash -lc/zsh -lc)',
                        '- /scheduler  (list scheduler jobs)',
                        '- /schedule ...  (create/manage jobs; see /scheduler)',
                        '- /agent0  (Agent Zero docker shortcuts)',
                    ].join('\n')
                );
                setInputValue('');
                return;
            }

            if (lower.startsWith('/web ')) {
                const prompt = text.slice(5).trim();
                socket.emit('run_web_agent', { prompt });
                addMessage('You', text);
                setShowBrowserWindow(true);
                setInputValue('');
                return;
            }

            if (lower.startsWith('/browse ')) {
                const prompt = text.slice(8).trim();
                socket.emit('run_browser_use', { prompt });
                addMessage('You', text);
                setShowBrowserWindow(true);
                setInputValue('');
                return;
            }

            if (lower.startsWith('/cad ')) {
                const prompt = text.slice(5).trim();
                socket.emit('generate_cad', { prompt });
                addMessage('You', text);
                setShowCadWindow(true);
                setInputValue('');
                return;
            }

            if (lower === '/projects') {
                socket.emit('list_joda_projects');
                addMessage('You', text);
                setInputValue('');
                return;
            }

            if (lower.startsWith('/todo ')) {
                const project = text.slice(6).trim();
                if (!project) {
                    socket.emit('ralph_list_projects');
                    addMessage('System', '[Ralph] Tell me which project folder to use after /todo');
                    setInputValue('');
                    return;
                }
                socket.emit('ralph_run', {
                    project,
                    mode: 'todo',
                    codex: true,
                    codex_permission_mode: 'interactive',
                    max_iterations: 25,
                    max_runtime: 1200
                });
                addMessage('You', text);
                setInputValue('');
                return;
            }

            if (lower.startsWith('/build ')) {
                const project = text.slice(7).trim();
                if (!project) {
                    socket.emit('ralph_list_projects');
                    addMessage('System', '[Ralph] Tell me which project folder to use after /build');
                    setInputValue('');
                    return;
                }
                socket.emit('ralph_run', {
                    project,
                    mode: 'build',
                    codex: true,
                    codex_permission_mode: 'interactive',
                    max_iterations: 50,
                    max_runtime: 3600
                });
                addMessage('You', text);
                setInputValue('');
                return;
            }

            if (lower.startsWith('/ralph ')) {
                // Usage: /ralph <project_path> <prompt...>
                const rest = text.slice(7).trim();
                const firstSpace = rest.indexOf(' ');
                const project = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
                const prompt = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim();
                socket.emit('ralph_run', {
                    project,
                    prompt: prompt || undefined,
                    agent: 'auto',
                    max_iterations: 50,
                    max_runtime: 3600
                });
                addMessage('You', text);
                setInputValue('');
                return;
            }

            if (!socket?.connected) {
                addMessage('System', 'Not connected to backend; cannot send command.');
                setInputValue('');
                return;
            }
            socket.emit('user_input', { text });
            addMessage('You', text);
            setInputValue('');
        }
    };

    const handleMinimize = () => ipcRenderer?.send?.('window-minimize');
    const handleMaximize = () => ipcRenderer?.send?.('window-maximize');

    // Close Application - memory is now actively saved to project, no prompt needed
    const handleCloseRequest = () => {
        // In web mode, never shut down the backend (it may be shared or remote).
        if (!ipcRenderer?.send) {
            addMessage('System', 'Close is disabled in web mode. Close the browser tab instead.');
            return;
        }

        // Emit shutdown signal to backend for graceful shutdown
        // Use volatile emit with timeout fallback to ensure window closes even if server is unresponsive
        const closeWindow = () => {
            if (ipcRenderer?.send) {
                ipcRenderer.send('window-close');
                return;
            }
            // Web fallback: attempt to close tab (may be blocked by browser), otherwise no-op.
            window.close();
        };

        if (socket.connected) {
            console.log('[APP] Sending shutdown signal to backend...');
            socket.emit('shutdown', {}, (ack) => {
                // This callback may not be called if server uses os._exit
                console.log('[APP] Shutdown acknowledged');
                closeWindow();
            });
            // Fallback: close after 500ms if ack doesn't come back
            setTimeout(closeWindow, 500);
        } else {
            // Socket not connected, just close
            closeWindow();
        }
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const textContent = event.target.result;
                // Just send the text content directly
                if (typeof textContent === 'string' && textContent.length > 0) {
                    socket.emit('upload_memory', { memory: textContent });
                    addMessage('System', 'Uploading memory...');
                } else {
                    addMessage('System', 'Empty or invalid memory file');
                }
            } catch (err) {
                console.error("Error reading file:", err);
                addMessage('System', 'Error reading memory file');
            }
        };
        reader.readAsText(file);
    };

    // handleCancelClose removed - no longer using memory prompt

    const handleConfirmTool = () => {
        if (confirmationRequest) {
            socket.emit('confirm_tool', { id: confirmationRequest.id, confirmed: true });
            setConfirmationRequest(null);
        }
    };

    const handleDenyTool = () => {
        if (confirmationRequest) {
            socket.emit('confirm_tool', { id: confirmationRequest.id, confirmed: false });
            setConfirmationRequest(null);
        }
    };

    // Spatial panel move callback (3D drag)
    const handlePanelMove = (id, pos) => {
        setSpatialPositions(prev => ({ ...prev, [id]: pos }));
    };

    // audioAmp removed — aiAudioData is now a ref, consumed only by avatar

    const toggleKasaWindow = () => {
        if (!showKasaWindow) {
            // Maybe trigger discover instantly?
            if (kasaDevices.length === 0) socket.emit('discover_kasa');
        }
        setShowKasaWindow(!showKasaWindow);
    };

    const togglePrinterWindow = () => {
        setShowPrinterWindow(!showPrinterWindow);
    };



    // Show permission prompt before the main app
    if (mediaPermission !== 'granted') {
        return (
            <div
                className="h-screen w-screen flex items-center justify-center"
                style={{
                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                    background: '#050510',
                }}
            >
                <div className="text-center max-w-md px-6">
                    <div className="text-5xl mb-6">🎙️</div>
                    <h1 className="text-2xl font-bold text-white mb-3">JODA Needs Access</h1>
                    <p className="text-gray-400 text-sm mb-2">
                        To hear and speak with your AI assistant, JODA needs access to your microphone and camera.
                    </p>
                    <p className="text-gray-500 text-xs mb-8">
                        Your browser will ask for permission. On Apple Vision Pro, tap Allow when prompted.
                    </p>
                    <button
                        onClick={requestMediaPermissions}
                        className="px-8 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors text-base"
                        style={{ cursor: 'pointer', minWidth: 200, minHeight: 48 }}
                    >
                        Grant Permissions
                    </button>
                    <button
                        onClick={() => {
                            setMediaPermission('granted');
                            localStorage.setItem('joda_media_granted', 'true');
                        }}
                        className="block mx-auto mt-4 text-gray-500 hover:text-gray-300 text-xs transition-colors"
                        style={{ cursor: 'pointer', minHeight: 44 }}
                    >
                        Skip for now
                    </button>
                </div>
            </div>
        );
    }

    // Panels defined inline in SpatialWorld JSX below (not useMemo).
    // useMemo was broken by unstable deps (handleSend, toggles).

    return (
        <div className="h-screen w-screen overflow-hidden relative" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>

            {/* Auth Lock Screen */}
            {isLockScreenVisible && (
                <AuthLock
                    socket={socket}
                    onAuthenticated={() => setIsAuthenticated(true)}
                    onAnimationComplete={() => setIsLockScreenVisible(false)}
                />
            )}

            {/* Hand Cursor - Only show if tracking is enabled */}
            {isVideoOn && isHandTrackingEnabled && (
                <div
                    className={`fixed w-6 h-6 border-2 rounded-full pointer-events-none z-[100] transition-transform duration-75 ${isPinching ? 'bg-blue-400 border-blue-400 scale-75 shadow-[0_0_15px_rgba(59,130,246,0.6)]' : 'border-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.3)]'}`}
                    style={{
                        left: cursorPos.x,
                        top: cursorPos.y,
                        transform: 'translate(-50%, -50%)'
                    }}
                >
                    <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
                </div>
            )}

            {/* Top Bar HUD - Fixed overlay above 3D Canvas */}
            <div className="fixed top-0 inset-x-0 z-50 glass-topbar flex items-center justify-between px-4 py-3 select-none" style={{ WebkitAppRegion: 'drag' }}>
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-semibold tracking-tight text-gray-800">
                        J.O.D.A
                    </h1>
                    <div className="glass px-2 py-0.5 rounded-full text-[10px] text-gray-500 font-medium">
                        v2.0
                    </div>
                    <div className="hidden lg:block text-[11px] text-gray-400 font-medium">
                        Created by Dr Joseph Davids
                    </div>
                    {isVideoOn && (
                        <div className="glass px-2 py-1 rounded-full text-[10px] text-green-600 font-medium flex items-center gap-1">
                            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            <span>{fps} FPS</span>
                        </div>
                    )}
                    {printerCount > 0 && (
                        <div className="glass flex items-center gap-1.5 text-[10px] text-green-600 px-2.5 py-1 rounded-full font-medium">
                            <Printer size={11} className="text-green-600" />
                            <span>{printerCount}</span>
                        </div>
                    )}
                    {kasaDevices.length > 0 && (
                        <div className="glass flex items-center gap-1.5 text-[10px] text-yellow-600 px-2.5 py-1 rounded-full font-medium">
                            <span>💡</span>
                            <span>{kasaDevices.length}</span>
                        </div>
                    )}
                </div>

                <div className="flex-1 flex justify-center mx-4">
                    <TopAudioBar audioData={micAudioData} />
                </div>

                <div className="flex items-center gap-4" style={{ WebkitAppRegion: 'no-drag' }}>
                    <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
                        <Clock size={14} className="text-gray-400" />
                        <span>{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {/* WebXR Entry Buttons */}
                    {xrVRSupported && (
                        <button
                            onClick={async () => { await ensureAiAudioContext(); xrStore.enterVR(); }}
                            className="apple-button sf-icon"
                            title="Enter VR"
                        >
                            <span className="text-xs font-semibold text-gray-500">VR</span>
                        </button>
                    )}
                    {xrARSupported && (
                        <button
                            onClick={async () => { await ensureAiAudioContext(); xrStore.enterAR(); }}
                            className="apple-button sf-icon"
                            title="Enter AR"
                        >
                            <span className="text-xs font-semibold text-gray-500">AR</span>
                        </button>
                    )}
                    {/* Avatar Customize Button */}
                    <button
                        onClick={() => setShowAvatarCustomizer(true)}
                        className="apple-button sf-icon"
                        title="Customize Avatar"
                    >
                        <User size={16} className="text-gray-500" />
                    </button>
                    <div className="flex items-center gap-2">
                        <button onClick={handleCloseRequest} className="window-control red" title="Close" />
                        <button onClick={handleMinimize} className="window-control yellow" title="Minimize" />
                        <button onClick={handleMaximize} className="window-control green" title="Maximize" />
                    </div>
                </div>
            </div>

            {/* Spatial 3D World - Full screen behind top bar */}
            <div className="spatial-world-container">
                <SpatialWorld
                    avatarMode={avatarConfig.mode}
                    avatarPropsRef={{
                        audioDataRef: aiAudioDataRef,
                        isSpeakingRef: isAiSpeakingRef,
                        speakingTextRef: currentSpeakingTextRef,
                        rpmAvatarUrl: avatarConfig.rpmAvatarUrl,
                    }}
                    audioHandlers={{
                        ensureAiAudioContext,
                        startMic: startBrowserMicStream,
                        startSpeechRec: startBrowserSpeechRecognition,
                        isMutedRef: isMutedRef,
                        isOpenAiFallbackRef: openAiFallbackActiveRef,
                        selectedSpeakerId,
                        onSpeakerChange: (deviceId) => {
                            setSelectedSpeakerId(deviceId);
                            localStorage.setItem('selectedSpeakerId', deviceId);
                        },
                        preCapturedStreamRef,
                    }}
                    onPanelResize={handlePanelResize}
                    onPanelRotate={handlePanelRotate}
                    panels={[
                        {
                            id: 'chat', visible: true,
                            position: spatialPositions.chat,
                            width: panelDimensions.chat?.width ?? 420, height: panelDimensions.chat?.height ?? 500,
                            content: (
                                <ChatModule
                                    messages={messages}
                                    inputValue={inputValue}
                                    setInputValue={setInputValue}
                                    handleSend={handleSend}
                                />
                            ),
                            xrContent: (
                                <XRChatPanel
                                    messages={messages}
                                    isSpeakingRef={isAiSpeakingRef}
                                    isMuted={isMuted}
                                />
                            ),
                        },
                        {
                            id: 'tools', visible: true,
                            position: spatialPositions.tools,
                            width: panelDimensions.tools?.width ?? 520, height: panelDimensions.tools?.height ?? 200,
                            content: (
                                <ToolsModule
                                    isConnected={isConnected}
                                    isMuted={isMuted}
                                    isVideoOn={isVideoOn}
                                    isSpeakerMuted={isSpeakerMuted}
                                    speakerVolume={speakerVolume}
                                    isHandTrackingEnabled={isHandTrackingEnabled}
                                    showSettings={showSettings}
                                    onTogglePower={togglePower}
                                    onToggleMute={toggleMute}
                                    onToggleSpeaker={toggleSpeaker}
                                    onSetSpeakerVolume={setSpeakerVolume}
                                    onToggleVideo={toggleVideo}
                                    onToggleSettings={() => setShowSettings(!showSettings)}
                                    onToggleHand={() => setIsHandTrackingEnabled(!isHandTrackingEnabled)}
                                    onToggleKasa={toggleKasaWindow}
                                    showKasaWindow={showKasaWindow}
                                    onTogglePrinter={togglePrinterWindow}
                                    showPrinterWindow={showPrinterWindow}
                                    onToggleCad={() => setShowCadWindow(!showCadWindow)}
                                    showCadWindow={showCadWindow}
                                    onToggleBrowser={() => setShowBrowserWindow(!showBrowserWindow)}
                                    showBrowserWindow={showBrowserWindow}
                                    onToggleMedia={() => setShowMediaGallery(!showMediaGallery)}
                                    showMediaGallery={showMediaGallery}
                                    isHudAwake={isHudAwake}
                                />
                            ),
                            xrContent: (
                                <XRToolsPanel
                                    isConnected={isConnected}
                                    isMuted={isMuted}
                                    isSpeakerMuted={isSpeakerMuted}
                                    isVideoOn={isVideoOn}
                                    showSettings={showSettings}
                                    isHandTrackingEnabled={isHandTrackingEnabled}
                                    showKasaWindow={showKasaWindow}
                                    showPrinterWindow={showPrinterWindow}
                                    showCadWindow={showCadWindow}
                                    showBrowserWindow={showBrowserWindow}
                                    showMediaGallery={showMediaGallery}
                                    onTogglePower={togglePower}
                                    onToggleMute={toggleMute}
                                    onToggleSpeaker={toggleSpeaker}
                                    onToggleVideo={toggleVideo}
                                    onToggleSettings={() => setShowSettings(!showSettings)}
                                    onToggleHand={() => setIsHandTrackingEnabled(!isHandTrackingEnabled)}
                                    onToggleKasa={toggleKasaWindow}
                                    onTogglePrinter={togglePrinterWindow}
                                    onToggleCad={() => setShowCadWindow(!showCadWindow)}
                                    onToggleBrowser={() => setShowBrowserWindow(!showBrowserWindow)}
                                    onToggleMedia={() => setShowMediaGallery(!showMediaGallery)}
                                    vrPerspective={vrPerspective}
                                    vrLocomotionMode={vrLocomotionMode}
                                    onTogglePerspective={() => setVrPerspective(p => p === 'first' ? 'third' : 'first')}
                                    onToggleLocomotion={() => setVrLocomotionMode(m => m === 'smooth' ? 'teleport' : 'smooth')}
                                />
                            ),
                        },
                        {
                            id: 'media', visible: showMediaGallery,
                            position: spatialPositions.media,
                            width: panelDimensions.media?.width ?? 520, height: panelDimensions.media?.height ?? 440,
                            content: (
                                <MediaGalleryWindow
                                    assets={mediaAssets}
                                    onClose={() => setShowMediaGallery(false)}
                                    onClearAll={() => setMediaAssets([])}
                                />
                            ),
                            xrContent: (
                                <XRGenericPanel
                                    title="Media Gallery"
                                    status={`${mediaAssets.length} item${mediaAssets.length !== 1 ? 's' : ''}`}
                                    onClose={() => setShowMediaGallery(false)}
                                />
                            ),
                        },
                        {
                            id: 'imagePreview', visible: imagePreview.visible,
                            position: spatialPositions.imagePreview,
                            width: panelDimensions.imagePreview?.width ?? 420, height: panelDimensions.imagePreview?.height ?? 400,
                            content: (
                                <ImagePreviewWindow
                                    status={imagePreview.status}
                                    prompt={imagePreview.prompt}
                                    imageUrl={imagePreview.imageUrl}
                                    mediaUrl={imagePreview.mediaUrl}
                                    mediaType={imagePreview.mediaType}
                                    error={imagePreview.error}
                                    provider={imagePreview.provider}
                                    onClose={() => setImagePreview(prev => ({ ...prev, visible: false }))}
                                />
                            ),
                            xrContent: (
                                <XRImagePreviewPanel
                                    status={imagePreview.status}
                                    prompt={imagePreview.prompt}
                                    provider={imagePreview.provider}
                                    error={imagePreview.error}
                                    onClose={() => setImagePreview(prev => ({ ...prev, visible: false }))}
                                />
                            ),
                        },
                        {
                            id: 'browser', visible: showBrowserWindow,
                            position: spatialPositions.browser,
                            width: panelDimensions.browser?.width ?? 550, height: panelDimensions.browser?.height ?? 380,
                            content: (
                                <BrowserWindow
                                    imageSrc={browserData.image}
                                    logs={browserData.logs}
                                    onClose={() => setShowBrowserWindow(false)}
                                    socket={socket}
                                />
                            ),
                            xrContent: (
                                <XRGenericPanel
                                    title="Browser"
                                    status="Browser automation active"
                                    onClose={() => setShowBrowserWindow(false)}
                                />
                            ),
                        },
                        {
                            id: 'kasa', visible: showKasaWindow,
                            position: spatialPositions.kasa,
                            width: panelDimensions.kasa?.width ?? 300, height: panelDimensions.kasa?.height ?? 380,
                            content: (
                                <KasaWindow
                                    socket={socket}
                                    devices={kasaDevices}
                                    onClose={() => setShowKasaWindow(false)}
                                />
                            ),
                            xrContent: (
                                <XRKasaPanel
                                    devices={kasaDevices}
                                    socket={socket}
                                    onClose={() => setShowKasaWindow(false)}
                                />
                            ),
                        },
                        {
                            id: 'printer', visible: showPrinterWindow,
                            position: spatialPositions.printer,
                            width: panelDimensions.printer?.width ?? 380, height: panelDimensions.printer?.height ?? 380,
                            content: (
                                <PrinterWindow
                                    socket={socket}
                                    onClose={() => setShowPrinterWindow(false)}
                                />
                            ),
                            xrContent: (
                                <XRGenericPanel
                                    title="3D Printer"
                                    onClose={() => setShowPrinterWindow(false)}
                                />
                            ),
                        },
                        {
                            id: 'settings', visible: showSettings,
                            position: spatialPositions.settings,
                            width: panelDimensions.settings?.width ?? 400, height: panelDimensions.settings?.height ?? 500,
                            content: (
                                <SettingsWindow
                                    socket={socket}
                                    micDevices={micDevices}
                                    speakerDevices={speakerDevices}
                                    webcamDevices={webcamDevices}
                                    selectedMicId={selectedMicId}
                                    setSelectedMicId={setSelectedMicId}
                                    selectedSpeakerId={selectedSpeakerId}
                                    setSelectedSpeakerId={setSelectedSpeakerId}
                                    selectedWebcamId={selectedWebcamId}
                                    setSelectedWebcamId={setSelectedWebcamId}
                                    cursorSensitivity={cursorSensitivity}
                                    setCursorSensitivity={setCursorSensitivity}
                                    isCameraFlipped={isCameraFlipped}
                                    setIsCameraFlipped={setIsCameraFlipped}
                                    handleFileUpload={handleFileUpload}
                                    onClose={() => setShowSettings(false)}
                                />
                            ),
                            xrContent: (
                                <XRGenericPanel
                                    title="Settings"
                                    onClose={() => setShowSettings(false)}
                                />
                            ),
                        },
                        {
                            id: 'avatar', visible: showAvatarCustomizer,
                            position: spatialPositions.avatar,
                            width: panelDimensions.avatar?.width ?? 480, height: panelDimensions.avatar?.height ?? 560,
                            content: (
                                <AvatarCustomizer
                                    currentAvatar={avatarConfig}
                                    onSave={(config) => {
                                        setAvatarConfig(config);
                                        localStorage.setItem('joda_avatar_config', JSON.stringify(config));
                                    }}
                                    onClose={() => setShowAvatarCustomizer(false)}
                                />
                            ),
                            xrContent: (
                                <XRGenericPanel
                                    title="Avatar"
                                    onClose={() => setShowAvatarCustomizer(false)}
                                />
                            ),
                        },
                    ]}
                    onPanelMove={handlePanelMove}
                />
            </div>

            {/* Video Feed - Fixed 2D overlay */}
            <div
                id="video"
                className={`fixed bottom-4 left-4 transition-all duration-200
                    ${isVideoOn ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                    glass spatial-card shadow-xl rounded-xl
                `}
                style={{ zIndex: 60 }}
            >
                <div className="relative border border-gray-300/50 rounded-lg overflow-hidden shadow-sm w-80 aspect-video bg-gray-100/80">
                    <video ref={videoRef} autoPlay muted className="absolute inset-0 w-full h-full object-cover opacity-0" />
                    <div className="absolute top-2 left-2 text-[10px] text-gray-500 bg-white/70 backdrop-blur px-2 py-0.5 rounded border border-gray-300/30 z-10 font-bold tracking-wider">CAM_01</div>
                    <canvas
                        ref={canvasRef}
                        className="absolute inset-0 w-full h-full opacity-80"
                        style={{ transform: isCameraFlipped ? 'scaleX(-1)' : 'none' }}
                    />
                </div>
            </div>


            {/* Tool Confirmation Modal */}
            <ConfirmationPopup
                request={confirmationRequest}
                onConfirm={handleConfirmTool}
                onDeny={handleDenyTool}
            />

            {/* On-screen debug console for Vision Pro — disabled during debugging */}
            {/* <DebugOverlay /> */}

        </div>
    );
}

export default App;
