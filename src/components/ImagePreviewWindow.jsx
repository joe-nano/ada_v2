import React from 'react';
import { X, Download, Loader2, Sparkles, AlertCircle } from 'lucide-react';

/**
 * ImagePreviewWindow — shows real-time feedback for image/video generation.
 *
 * Props:
 *   status    — 'generating' | 'done' | 'error' | 'trying_fallback'
 *   prompt    — the prompt text being generated
 *   imageUrl  — data URL of the generated image (set when status='done', mediaType='image')
 *   mediaUrl  — data URL of the generated video (set when status='done', mediaType='video')
 *   mediaType — 'image' | 'video' (default 'image')
 *   error     — error message (set when status='error')
 *   provider  — current provider name (shown during generation)
 *   onClose   — close handler
 */
const ImagePreviewWindow = ({ status, prompt, imageUrl, mediaUrl, mediaType = 'image', error, provider, onClose }) => {

    const isVideo = mediaType === 'video';
    const doneUrl = isVideo ? mediaUrl : imageUrl;

    const handleDownload = () => {
        if (!doneUrl) return;
        const ext = isVideo ? '.mp4' : '.png';
        const link = document.createElement('a');
        link.href = doneUrl;
        link.download = `joda_${Date.now()}${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const isGenerating = status === 'generating' || status === 'trying_fallback' || status === 'trying_provider';

    return (
        <div className="w-full h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-amber-400" />
                    <span className="text-amber-400 text-xs font-bold tracking-widest uppercase">
                        {isVideo ? 'Video Gen' : 'Image Gen'}
                    </span>
                    {isGenerating && (
                        <span className="flex items-center gap-1 text-[10px] text-blue-400 bg-blue-500/15 px-2 py-0.5 rounded-full">
                            <Loader2 size={10} className="animate-spin" />
                            {status === 'trying_fallback' ? 'Trying fallback...' : 'Generating'}
                        </span>
                    )}
                    {status === 'done' && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-full">
                            Complete
                        </span>
                    )}
                    {status === 'error' && (
                        <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-500/15 px-2 py-0.5 rounded-full">
                            <AlertCircle size={10} />
                            Failed
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {status === 'done' && doneUrl && (
                        <button
                            onClick={handleDownload}
                            className="text-gray-500 hover:text-amber-400 p-1 rounded transition-colors"
                            title="Download"
                        >
                            <Download size={14} />
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-white p-1 rounded transition-colors"
                        title="Close"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Main content area */}
            <div className="flex-1 flex flex-col items-center justify-center p-3 min-h-0 overflow-hidden">
                {/* GENERATING STATE */}
                {isGenerating && (
                    <div className="flex flex-col items-center gap-4 px-4">
                        {/* Animated loader */}
                        <div className="relative w-24 h-24">
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-500/20 to-purple-500/20 animate-pulse" />
                            <div className="absolute inset-2 rounded-xl border-2 border-dashed border-amber-500/30 animate-[spin_8s_linear_infinite]" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Sparkles size={28} className="text-amber-400 animate-pulse" />
                            </div>
                        </div>
                        <div className="text-center">
                            <p className="text-gray-300 text-xs font-medium mb-1">
                                Creating your {isVideo ? 'video' : 'image'}...
                            </p>
                            {provider && (
                                <p className="text-gray-400 text-[10px] mb-1">
                                    Provider: <span className="text-amber-400">{provider}</span>
                                </p>
                            )}
                            <p className="text-gray-500 text-[11px] leading-relaxed max-w-[280px] line-clamp-3">
                                "{prompt}"
                            </p>
                        </div>
                    </div>
                )}

                {/* DONE STATE — IMAGE */}
                {status === 'done' && !isVideo && imageUrl && (
                    <div className="w-full h-full flex items-center justify-center p-2">
                        <img
                            src={imageUrl}
                            alt={prompt || 'Generated image'}
                            className="max-w-full max-h-full rounded-lg object-contain shadow-2xl shadow-black/50"
                        />
                    </div>
                )}

                {/* DONE STATE — VIDEO */}
                {status === 'done' && isVideo && mediaUrl && (
                    <div className="w-full h-full flex items-center justify-center p-2">
                        <video
                            src={mediaUrl}
                            controls
                            autoPlay
                            loop
                            className="max-w-full max-h-full rounded-lg shadow-2xl shadow-black/50"
                        />
                    </div>
                )}

                {/* ERROR STATE */}
                {status === 'error' && (
                    <div className="flex flex-col items-center gap-3 px-4">
                        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
                            <AlertCircle size={28} className="text-red-400" />
                        </div>
                        <div className="text-center">
                            <p className="text-gray-300 text-xs font-medium mb-1">Generation failed</p>
                            <p className="text-gray-500 text-[11px] leading-relaxed max-w-[280px]">
                                {error || 'Something went wrong. Try again.'}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Prompt footer — always visible */}
            {prompt && status === 'done' && (
                <div className="px-3 py-2 border-t border-white/10 shrink-0">
                    <p className="text-gray-500 text-[10px] truncate">
                        <span className="text-gray-400 font-medium">Prompt:</span> {prompt}
                    </p>
                </div>
            )}
        </div>
    );
};

export default ImagePreviewWindow;
