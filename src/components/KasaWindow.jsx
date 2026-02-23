import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Power, Sun, Palette } from 'lucide-react';

const KasaWindow = ({
    socket,
    devices = [],
    onClose,
}) => {
    const [isThinking, setIsThinking] = useState(false);
    const [loadingDevices, setLoadingDevices] = useState({});

    useEffect(() => {
        const onUpdate = (data) => {
            if (data && data.ip) {
                setLoadingDevices(prev => {
                    const next = { ...prev };
                    delete next[data.ip];
                    return next;
                });
            }
        };

        socket.on('kasa_update', onUpdate);
        return () => socket.off('kasa_update', onUpdate);
    }, [socket]);

    const handleDiscover = () => {
        setIsThinking(true);
        socket.emit('discover_kasa');
        setTimeout(() => setIsThinking(false), 5000);
    };

    useEffect(() => {
        if (devices && devices.length > 0) {
            setIsThinking(false);
        }
    }, [devices]);

    const handleToggle = (ip, currentState) => {
        setLoadingDevices(prev => ({ ...prev, [ip]: true }));
        socket.emit('control_kasa', {
            ip: ip,
            action: currentState ? 'off' : 'on'
        });
    };

    const handleBrightness = (ip, val) => {
        socket.emit('control_kasa', {
            ip: ip,
            action: 'brightness',
            value: parseInt(val)
        });
    };

    const handleColor = (ip, hue) => {
        socket.emit('control_kasa', {
            ip: ip,
            action: 'color',
            value: { h: parseInt(hue), s: 100, v: 100 }
        });
    };

    return (
        <div className="w-full h-full flex flex-col gap-2 p-3">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-1">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${devices.length > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
                    <h3 className="font-bold text-xs tracking-wider">SMART CONTROL</h3>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto scrollbar-hide">
                {devices.length === 0 && !isThinking && (
                    <div className="flex flex-col items-center justify-center p-8 text-center opacity-60">
                        <p className="text-xs mb-4">No devices found. Ensure they are on the same network.</p>
                        <button
                            onClick={handleDiscover}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 transition-all text-xs font-medium text-blue-400"
                        >
                            <RefreshCw size={14} /> DISCOVER LIGHTS
                        </button>
                    </div>
                )}

                {isThinking && (
                    <div className="flex flex-col items-center justify-center p-8 gap-3">
                        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-blue-400 animate-pulse">Scanning Network...</span>
                    </div>
                )}

                {devices.map((dev) => (
                    <div key={dev.ip} className="mb-3 p-3 bg-white/5 rounded-lg hover:bg-white/8 transition-all border border-white/5">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex flex-col">
                                <span className="font-bold text-sm">{dev.alias}</span>
                                <span className="text-[10px] text-gray-500 font-medium">{dev.ip}</span>
                            </div>
                            <button
                                onClick={() => handleToggle(dev.ip, dev.is_on)}
                                disabled={loadingDevices[dev.ip]}
                                className={`p-2 rounded-full transition-all ${dev.is_on
                                    ? 'bg-green-500/15 text-green-400'
                                    : 'bg-white/5 text-gray-500 hover:text-gray-300'}
                                    ${loadingDevices[dev.ip] ? 'opacity-50 cursor-not-allowed' : ''}
                                `}
                            >
                                {loadingDevices[dev.ip] ? (
                                    <div className="w-[18px] h-[18px] border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <Power size={18} />
                                )}
                            </button>
                        </div>

                        {/* Brightness */}
                        {dev.has_brightness && dev.is_on && (
                            <div className="flex items-center gap-2 mt-2">
                                <Sun size={14} className="text-yellow-400" />
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    defaultValue={dev.brightness || 100}
                                    onChange={(e) => handleBrightness(dev.ip, e.target.value)}
                                    className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                                />
                            </div>
                        )}

                        {/* Color Control */}
                        {dev.has_color && dev.is_on && (
                            <div className="flex items-center gap-2 mt-2">
                                <Palette size={14} className="text-purple-400" />
                                <input
                                    type="range"
                                    min="0"
                                    max="360"
                                    defaultValue={(dev.hsv && dev.hsv.h) || 0}
                                    onChange={(e) => handleColor(dev.ip, e.target.value)}
                                    className="w-full h-1 rounded-full appearance-none cursor-pointer"
                                    style={{
                                        background: 'linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)'
                                    }}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Bottom Discover */}
            {devices.length > 0 && (
                <div className="pt-2 border-t border-white/10 flex justify-end">
                    <button
                        onClick={handleDiscover}
                        className="p-1 text-gray-500 hover:text-blue-400 transition-colors"
                        title="Rescan"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default KasaWindow;
