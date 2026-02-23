import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Printer, Thermometer, Clock, FileText, ExternalLink } from 'lucide-react';

let shell = null;
try {
    if (typeof window !== 'undefined' && window.require) {
        shell = window.require('electron').shell;
    }
} catch {
    shell = null;
}

const openExternal = (url) => {
    if (shell && typeof shell.openExternal === 'function') {
        shell.openExternal(url);
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
};

const PrinterWindow = ({
    socket,
    onClose,
}) => {
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [printers, setPrinters] = useState([]);
    const [slicingProgress, setSlicingProgress] = useState({ percent: 0, message: '', active: false });

    useEffect(() => {
        if (socket) {
            handleDiscover();

            socket.on('printer_list', (list) => {
                setPrinters(list);
                setIsDiscovering(false);
            });

            socket.on('print_status_update', (data) => {
                setPrinters(prev => prev.map(p =>
                    p.name === data.printer ? { ...p, status: data } : p
                ));
            });

            socket.on('slicing_progress', (data) => {
                setSlicingProgress({
                    percent: data.percent,
                    message: data.message,
                    active: data.percent < 100
                });
            });

            socket.on('print_result', (result) => {
                if (result.success) {
                    setSlicingProgress({ percent: 100, message: 'Done', active: false });
                } else {
                    setSlicingProgress({ percent: 0, message: 'Failed', active: false });
                }
            });
        }
        return () => {
            if (socket) {
                socket.off('printer_list');
                socket.off('print_status_update');
                socket.off('slicing_progress');
                socket.off('print_result');
            }
        };
    }, [socket]);

    const handleDiscover = () => {
        setIsDiscovering(true);
        socket.emit('discover_printers');
        setTimeout(() => setIsDiscovering(false), 5000);
    };

    const getStatusColor = (state) => {
        if (!state) return 'text-gray-500';
        const s = state.toLowerCase();
        if (s.includes('print')) return 'text-green-400';
        if (s.includes('paus')) return 'text-yellow-400';
        if (s.includes('error') || s.includes('fail')) return 'text-red-400';
        return 'text-blue-400';
    };

    return (
        <div className="w-full h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                    <Printer size={16} className="text-green-400" />
                    <span className="text-xs font-bold tracking-widest uppercase">3D Printers</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleDiscover}
                        disabled={isDiscovering}
                        className={`p-1.5 hover:bg-white/10 rounded-full transition-colors ${isDiscovering ? 'animate-spin text-green-400' : 'text-gray-500 hover:text-green-400'}`}
                    >
                        <RefreshCw size={14} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-full text-gray-500 hover:text-white transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
                {/* Manual Add Section */}
                <div className="mb-4 p-3 bg-white/5 rounded-lg border border-white/5">
                    <div className="text-[10px] uppercase text-gray-500 font-bold mb-2 tracking-wider">Manual Add</div>
                    <div className="flex flex-col gap-2">
                        <input
                            id="printer-name-input"
                            type="text"
                            placeholder="Printer Name (e.g. Creality K1)"
                            className="w-full rounded px-2 py-1 text-xs outline-none"
                        />
                        <div className="flex gap-2">
                            <input
                                id="printer-ip-input"
                                type="text"
                                placeholder="IP Address (e.g. 192.168.1.50)"
                                className="flex-1 rounded px-2 py-1 text-xs outline-none"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const ip = e.target.value.trim();
                                        const nameInput = document.getElementById('printer-name-input');
                                        const name = nameInput?.value.trim() || ip;
                                        if (ip) {
                                            socket.emit('add_printer', { host: ip, name: name, type: 'moonraker' });
                                            e.target.value = '';
                                            if (nameInput) nameInput.value = '';
                                            setIsDiscovering(true);
                                        }
                                    }
                                }}
                            />
                            <button
                                className="bg-green-500/15 hover:bg-green-500/25 text-green-400 text-xs px-3 rounded transition-colors"
                                onClick={() => {
                                    const ipInput = document.getElementById('printer-ip-input');
                                    const nameInput = document.getElementById('printer-name-input');
                                    const ip = ipInput?.value.trim();
                                    const name = nameInput?.value.trim() || ip;
                                    if (ip) {
                                        socket.emit('add_printer', { host: ip, name: name, type: 'moonraker' });
                                        if (ipInput) ipInput.value = '';
                                        if (nameInput) nameInput.value = '';
                                        setIsDiscovering(true);
                                    }
                                }}
                            >
                                Add
                            </button>
                        </div>
                    </div>
                </div>

                {printers.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 text-xs">
                        {isDiscovering ? (
                            <div className="flex flex-col items-center gap-2">
                                <RefreshCw className="animate-spin" size={20} />
                                <span>Scanning Network...</span>
                            </div>
                        ) : (
                            "No printers found. Try adding IP manually."
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {/* Slicing Pipeline */}
                        {slicingProgress.active && (
                            <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                                <div className="text-[10px] uppercase text-blue-400 font-bold mb-2 tracking-wider flex justify-between">
                                    <span>Preparation Pipeline</span>
                                    <span>{slicingProgress.percent}%</span>
                                </div>
                                <div className="flex items-center gap-2 mb-2 text-[10px] text-gray-500">
                                    <div className={`flex items-center gap-1 ${slicingProgress.percent < 100 ? 'text-green-400 font-bold' : ''}`}>
                                        <div className={`w-2 h-2 rounded-full ${slicingProgress.percent < 100 ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
                                        Slicing
                                    </div>
                                    <div className="h-[1px] w-4 bg-gray-600" />
                                    <div className="flex items-center gap-1">
                                        <div className="w-2 h-2 rounded-full bg-gray-600" />
                                        Printing
                                    </div>
                                </div>
                                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 transition-all duration-300"
                                        style={{ width: `${slicingProgress.percent}%` }}
                                    />
                                </div>
                                <div className="text-[10px] text-blue-300 mt-1 truncate">
                                    {slicingProgress.message}
                                </div>
                            </div>
                        )}

                        {printers.map((printer, idx) => (
                            <div key={idx} className="bg-white/5 rounded-lg p-3 hover:bg-white/8 transition-all border border-white/5">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <div className="font-bold text-sm">{printer.name}</div>
                                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">{printer.host}:{printer.port} • {printer.printer_type}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => openExternal(`http://${printer.host}`)}
                                            className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/15 px-2 py-0.5 rounded transition-colors"
                                            title="Open printer web interface"
                                        >
                                            <ExternalLink size={10} />
                                            <span>Open</span>
                                        </button>
                                        {printer.status && (
                                            <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/5 ${getStatusColor(printer.status.state)}`}>
                                                {printer.status.state?.toUpperCase() || "IDLE"}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Camera Feed */}
                                {printer.camera_url && (
                                    <div className="mb-3 rounded overflow-hidden border border-white/10 bg-black/30 relative aspect-video">
                                        <img
                                            src={printer.camera_url}
                                            alt="Printer Camera"
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                e.target.style.display = 'none';
                                                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                                            }}
                                        />
                                        <div className="hidden absolute inset-0 flex items-center justify-center text-gray-500 text-xs">
                                            Camera Stream Unavailable
                                        </div>
                                    </div>
                                )}

                                {printer.status && (
                                    <div className="space-y-2 mt-3 pt-3 border-t border-white/10">
                                        {printer.status.progress_percent > 0 && (
                                            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-green-500 transition-all duration-500"
                                                    style={{ width: `${printer.status.progress_percent}%` }}
                                                />
                                            </div>
                                        )}
                                        <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400">
                                            {printer.status.filename && (
                                                <div className="col-span-2 flex items-center gap-1.5 truncate">
                                                    <FileText size={10} className="text-green-400" />
                                                    <span className="truncate">{printer.status.filename}</span>
                                                </div>
                                            )}
                                            {printer.status.temperatures?.hotend && (
                                                <div className="flex items-center gap-1.5">
                                                    <Thermometer size={10} className="text-red-400" />
                                                    <span>E: {Math.round(printer.status.temperatures.hotend.current)}°C</span>
                                                </div>
                                            )}
                                            {printer.status.temperatures?.bed && (
                                                <div className="flex items-center gap-1.5">
                                                    <Thermometer size={10} className="text-blue-400" />
                                                    <span>B: {Math.round(printer.status.temperatures.bed.current)}°C</span>
                                                </div>
                                            )}
                                            {printer.status.time_remaining && (
                                                <div className="flex items-center gap-1.5">
                                                    <Clock size={10} className="text-yellow-400" />
                                                    <span>{printer.status.time_remaining} left</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PrinterWindow;
