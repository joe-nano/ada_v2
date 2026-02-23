import React, { useState, useMemo, useCallback } from 'react';
import { X, Trash2, Download, ChevronLeft, ChevronRight, Image, Film, Layers } from 'lucide-react';

const FILTERS = [
    { key: 'all', label: 'All', icon: Layers },
    { key: 'image', label: 'Images', icon: Image },
    { key: 'video', label: 'Videos', icon: Film },
];

const MediaGalleryWindow = ({ assets = [], onClose, onClearAll }) => {
    const [filter, setFilter] = useState('all');
    const [lightboxIndex, setLightboxIndex] = useState(null);

    const filtered = useMemo(() => {
        if (filter === 'all') return assets;
        return assets.filter(a => (a.type || 'image') === filter);
    }, [assets, filter]);

    const openLightbox = useCallback((idx) => setLightboxIndex(idx), []);
    const closeLightbox = useCallback(() => setLightboxIndex(null), []);

    const lightboxAsset = lightboxIndex !== null ? filtered[lightboxIndex] : null;

    const navigate = useCallback((dir) => {
        setLightboxIndex(prev => {
            if (prev === null) return null;
            const next = prev + dir;
            if (next < 0 || next >= filtered.length) return prev;
            return next;
        });
    }, [filtered.length]);

    const handleDownload = useCallback((asset) => {
        const link = document.createElement('a');
        link.href = asset.url || asset.data;
        link.download = asset.filename || `media_${Date.now()}.${asset.type === 'video' ? 'mp4' : 'png'}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, []);

    const formatTime = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="w-full h-full flex flex-col overflow-hidden relative">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-amber-400 text-xs font-bold tracking-widest uppercase">Media</span>
                    <span className="bg-amber-500/20 text-amber-300 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                        {assets.length}
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    {FILTERS.map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            className={`text-[10px] px-2 py-1 rounded transition-colors ${
                                filter === f.key
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            <f.icon size={12} className="inline mr-1" />
                            {f.label}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-1">
                    {assets.length > 0 && (
                        <button onClick={onClearAll}
                                className="text-gray-500 hover:text-red-400 p-1 rounded transition-colors"
                                title="Clear all">
                            <Trash2 size={14} />
                        </button>
                    )}
                    <button onClick={onClose}
                            className="text-gray-500 hover:text-white p-1 rounded transition-colors"
                            title="Close">
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Grid or Empty State */}
            <div className="flex-1 overflow-y-auto p-2 scrollbar-hide min-h-0">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
                        <Image size={40} strokeWidth={1} className="text-gray-600" />
                        <p className="text-xs">Generated media will appear here</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                        {filtered.map((asset, idx) => (
                            <button
                                key={asset._receivedAt || idx}
                                onClick={() => openLightbox(idx)}
                                className="relative aspect-square rounded-lg overflow-hidden group/thumb bg-black/50 border border-white/5 hover:border-amber-500/30 transition-colors"
                            >
                                {(asset.type || 'image') === 'video' ? (
                                    <video
                                        src={asset.url || asset.data}
                                        poster={asset.poster}
                                        className="w-full h-full object-cover"
                                        muted
                                    />
                                ) : (
                                    <img
                                        src={asset.url || asset.data}
                                        alt={asset.prompt || 'Generated media'}
                                        className="w-full h-full object-cover"
                                    />
                                )}

                                {asset.source && (
                                    <span className="absolute top-1 left-1 bg-black/60 text-amber-300 text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-wider">
                                        {asset.source}
                                    </span>
                                )}

                                <span className="absolute bottom-1 right-1 bg-black/60 text-gray-300 text-[8px] px-1 py-0.5 rounded opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                                    {formatTime(asset._receivedAt || asset.timestamp)}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Lightbox Overlay — relative to this panel, not the viewport */}
            {lightboxAsset && (
                <div className="absolute inset-0 z-10 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center"
                     onClick={closeLightbox}>
                    <button onClick={closeLightbox}
                            className="absolute top-3 right-3 text-gray-400 hover:text-white p-1 z-10">
                        <X size={20} />
                    </button>

                    {lightboxIndex > 0 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); navigate(-1); }}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white bg-white/10 rounded-full p-1"
                        >
                            <ChevronLeft size={20} />
                        </button>
                    )}
                    {lightboxIndex < filtered.length - 1 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); navigate(1); }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white bg-white/10 rounded-full p-1"
                        >
                            <ChevronRight size={20} />
                        </button>
                    )}

                    <div className="flex-1 flex items-center justify-center p-4 max-w-full max-h-[70%]"
                         onClick={(e) => e.stopPropagation()}>
                        {(lightboxAsset.type || 'image') === 'video' ? (
                            <video
                                src={lightboxAsset.url || lightboxAsset.data}
                                controls autoPlay
                                className="max-w-full max-h-full rounded-lg"
                            />
                        ) : (
                            <img
                                src={lightboxAsset.url || lightboxAsset.data}
                                alt={lightboxAsset.prompt || 'Media'}
                                className="max-w-full max-h-full rounded-lg object-contain"
                            />
                        )}
                    </div>

                    <div className="w-full px-4 py-2 border-t border-white/10 flex items-center justify-between shrink-0"
                         onClick={(e) => e.stopPropagation()}>
                        <div className="flex-1 min-w-0">
                            {lightboxAsset.prompt && (
                                <p className="text-gray-300 text-xs truncate">{lightboxAsset.prompt}</p>
                            )}
                            <div className="flex gap-3 text-[10px] text-gray-500 mt-0.5">
                                {lightboxAsset.source && <span className="uppercase">{lightboxAsset.source}</span>}
                                {lightboxAsset.dimensions && <span>{lightboxAsset.dimensions}</span>}
                                <span>{formatTime(lightboxAsset._receivedAt || lightboxAsset.timestamp)}</span>
                            </div>
                        </div>
                        <button
                            onClick={() => handleDownload(lightboxAsset)}
                            className="text-amber-400 hover:text-amber-300 p-1.5 bg-white/5 rounded-lg transition-colors"
                            title="Download"
                        >
                            <Download size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MediaGalleryWindow;
