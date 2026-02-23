import React, { useState, useCallback, useRef } from 'react';
import { Mic, MicOff, Settings, Power, Video, VideoOff, Hand, Lightbulb, Printer, Globe, Box, Volume2, VolumeX, Image } from 'lucide-react';

/**
 * ToolButton — Wrapper that fires onClick reliably on all platforms including
 * Vision Pro Safari flat mode (eye tracking + pinch).
 *
 * visionOS Safari inside CSS 3D-transformed containers (drei <Html>) can
 * swallow click/pointerup events. We listen on multiple event types and
 * use a debounce guard to ensure exactly one fire per gesture:
 *   - onClick      (desktop mouse, some touch browsers)
 *   - onPointerUp  (standard pointer events)
 *   - onTouchEnd   (visionOS pinch when pointer events are swallowed)
 */
function ToolButton({ onClick, disabled, className, title, children }) {
    const lastFire = useRef(0);

    const fire = useCallback((e) => {
        if (disabled) return;
        // Don't stop propagation — visionOS needs the event chain to complete
        // for gesture recognition. Just prevent default form submission.
        e?.preventDefault?.();
        const now = Date.now();
        if (now - lastFire.current < 300) return;
        lastFire.current = now;
        onClick?.();
    }, [onClick, disabled]);

    return (
        <button
            onClick={fire}
            onPointerUp={fire}
            onTouchEnd={fire}
            disabled={disabled}
            className={className}
            title={title}
            role="button"
            tabIndex={0}
            style={{ WebkitTapHighlightColor: 'transparent' }}
        >
            {children}
        </button>
    );
}

const ToolsModule = ({
    isConnected,
    isMuted,
    isVideoOn,
    isSpeakerMuted,
    speakerVolume,
    isHandTrackingEnabled,
    showSettings,
    onTogglePower,
    onToggleMute,
    onToggleSpeaker,
    onSetSpeakerVolume,
    onToggleVideo,
    onToggleSettings,
    onToggleHand,
    onToggleKasa,
    showKasaWindow,
    onTogglePrinter,
    showPrinterWindow,
    onToggleCad,
    showCadWindow,
    onToggleBrowser,
    showBrowserWindow,
    onToggleMedia,
    showMediaGallery,
    isHudAwake = true,
}) => {
    const [showVolume, setShowVolume] = useState(false);
    const volumeHideTimer = useRef(null);

    // Use pointer events for volume popup — works with Vision Pro eye tracking
    const handleVolumeEnter = useCallback(() => {
        clearTimeout(volumeHideTimer.current);
        setShowVolume(true);
    }, []);

    const handleVolumeLeave = useCallback(() => {
        // Delay hiding so user can move gaze to the popup itself
        volumeHideTimer.current = setTimeout(() => setShowVolume(false), 400);
    }, []);

    return (
        <div
            className="px-4 py-3 transition-all duration-500"
            style={{
                pointerEvents: 'auto',
                opacity: isHudAwake ? 1 : 0.6,
            }}
        >
            <div className="flex justify-center gap-3 flex-wrap">
                {/* Power Button */}
                <ToolButton
                    onClick={onTogglePower}
                    className={`apple-button sf-icon ${isConnected ? 'bg-green-500/10 border-green-500/20' : 'bg-black/5 border-black/8'}`}
                    title={isConnected ? 'Disconnect' : 'Connect'}
                >
                    <Power size={18} className={isConnected ? 'text-green-600' : 'text-gray-500'} strokeWidth={2} />
                </ToolButton>

                {/* Mute Button */}
                <ToolButton
                    onClick={onToggleMute}
                    disabled={!isConnected}
                    className={`apple-button sf-icon ${!isConnected ? 'opacity-30 cursor-not-allowed' : isMuted ? 'bg-red-500/10 border-red-400/20' : 'bg-blue-500/10 border-blue-400/15'}`}
                    title={isMuted ? 'Unmute' : 'Mute'}
                >
                    {isMuted ? <MicOff size={18} className="text-red-500" strokeWidth={2} /> : <Mic size={18} className="text-blue-500" strokeWidth={2} />}
                </ToolButton>

                {/* Speaker Button with Volume Control */}
                <div
                    className="relative"
                    onPointerEnter={handleVolumeEnter}
                    onPointerLeave={handleVolumeLeave}
                >
                    <ToolButton
                        onClick={onToggleSpeaker}
                        className={`apple-button sf-icon ${isSpeakerMuted ? 'bg-gray-500/10 border-gray-400/15' : 'bg-green-500/10 border-green-400/15'}`}
                        title="Toggle AI speech playback"
                    >
                        {isSpeakerMuted ? <VolumeX size={18} className="text-gray-500" strokeWidth={2} /> : <Volume2 size={18} className="text-green-600" strokeWidth={2} />}
                    </ToolButton>
                    {showVolume && (
                        <div
                            className="absolute left-1/2 -translate-x-1/2 bottom-[60px] px-3 py-2 rounded-xl"
                            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)' }}
                            onPointerEnter={handleVolumeEnter}
                            onPointerLeave={handleVolumeLeave}
                        >
                            <div className="flex flex-col items-center gap-1">
                                <span className="text-[9px] text-gray-400 font-medium tracking-wider">VOL</span>
                                <input
                                    type="range" min={0} max={1} step={0.01}
                                    value={Number.isFinite(speakerVolume) ? speakerVolume : 0.85}
                                    onChange={(e) => onSetSpeakerVolume?.(Number(e.target.value))}
                                    className="w-20 h-1.5 accent-blue-500 cursor-pointer rounded-full"
                                    style={{ touchAction: 'none' }}
                                />
                                <span className="text-[10px] text-gray-500 font-medium">{Math.round((Number.isFinite(speakerVolume) ? speakerVolume : 0.85) * 100)}%</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Video */}
                <ToolButton
                    onClick={onToggleVideo}
                    className={`apple-button sf-icon ${isVideoOn ? 'bg-purple-500/10 border-purple-400/15' : 'bg-black/5 border-black/8'}`}
                    title={isVideoOn ? 'Stop Camera' : 'Start Camera'}
                >
                    {isVideoOn ? <Video size={18} className="text-purple-600" strokeWidth={2} /> : <VideoOff size={18} className="text-gray-500" strokeWidth={2} />}
                </ToolButton>

                {/* Settings */}
                <ToolButton
                    onClick={onToggleSettings}
                    className={`apple-button sf-icon ${showSettings ? 'bg-blue-500/10 border-blue-400/15' : 'bg-black/5 border-black/8'}`}
                    title="Settings"
                >
                    <Settings size={18} className={showSettings ? 'text-blue-500' : 'text-gray-500'} strokeWidth={2} />
                </ToolButton>

                {/* Hand Tracking */}
                <ToolButton
                    onClick={onToggleHand}
                    className={`apple-button sf-icon ${isHandTrackingEnabled ? 'bg-orange-500/10 border-orange-400/15' : 'bg-black/5 border-black/8'}`}
                    title="Hand Tracking"
                >
                    <Hand size={18} className={isHandTrackingEnabled ? 'text-orange-500' : 'text-gray-500'} strokeWidth={2} />
                </ToolButton>

                {/* Kasa */}
                <ToolButton
                    onClick={onToggleKasa}
                    className={`apple-button sf-icon ${showKasaWindow ? 'bg-yellow-500/10 border-yellow-400/15' : 'bg-black/5 border-black/8'}`}
                    title="Smart Lights"
                >
                    <Lightbulb size={18} className={showKasaWindow ? 'text-yellow-600' : 'text-gray-500'} strokeWidth={2} />
                </ToolButton>

                {/* Printer */}
                <ToolButton
                    onClick={onTogglePrinter}
                    className={`apple-button sf-icon ${showPrinterWindow ? 'bg-green-500/10 border-green-400/15' : 'bg-black/5 border-black/8'}`}
                    title="3D Printer"
                >
                    <Printer size={18} className={showPrinterWindow ? 'text-green-600' : 'text-gray-500'} strokeWidth={2} />
                </ToolButton>

                {/* CAD */}
                <ToolButton
                    onClick={onToggleCad}
                    className={`apple-button sf-icon ${showCadWindow ? 'bg-blue-500/10 border-blue-400/15' : 'bg-black/5 border-black/8'}`}
                    title="CAD Agent"
                >
                    <Box size={18} className={showCadWindow ? 'text-blue-500' : 'text-gray-500'} strokeWidth={2} />
                </ToolButton>

                {/* Browser */}
                <ToolButton
                    onClick={onToggleBrowser}
                    className={`apple-button sf-icon ${showBrowserWindow ? 'bg-blue-500/10 border-blue-400/15' : 'bg-black/5 border-black/8'}`}
                    title="Web Browser"
                >
                    <Globe size={18} className={showBrowserWindow ? 'text-blue-500' : 'text-gray-500'} strokeWidth={2} />
                </ToolButton>

                {/* Media */}
                <ToolButton
                    onClick={onToggleMedia}
                    className={`apple-button sf-icon ${showMediaGallery ? 'bg-amber-500/10 border-amber-400/15' : 'bg-black/5 border-black/8'}`}
                    title="Media Gallery"
                >
                    <Image size={18} className={showMediaGallery ? 'text-amber-500' : 'text-gray-500'} strokeWidth={2} />
                </ToolButton>
            </div>
        </div>
    );
};

export default ToolsModule;
