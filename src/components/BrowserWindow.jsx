import React, { useEffect, useRef } from 'react';
import { Globe, X } from 'lucide-react';

const BrowserWindow = ({ imageSrc, logs, onClose, socket }) => {
    const [input, setInput] = React.useState('');
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    const handleSend = () => {
        if (!input.trim()) return;
        if (socket) {
            socket.emit('prompt_web_agent', { prompt: input });
        }
        setInput('');
    };

    return (
        <div className="w-full h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2 text-xs font-medium">
                    <Globe size={14} className="text-blue-400" />
                    <span>WEB AGENT</span>
                </div>
                <button onClick={onClose} className="hover:bg-white/10 text-gray-500 hover:text-red-400 p-1 rounded transition-colors">
                    <X size={14} />
                </button>
            </div>

            {/* Browser Content */}
            <div className="flex-1 relative bg-black/30 flex items-center justify-center overflow-hidden min-h-0">
                {imageSrc ? (
                    <img
                        src={`data:image/jpeg;base64,${imageSrc}`}
                        alt="Browser View"
                        className="max-w-full max-h-full object-contain"
                    />
                ) : (
                    <div className="flex flex-col items-center gap-2">
                        <div className="text-gray-500 text-xs font-medium animate-pulse">Waiting for browser stream...</div>
                    </div>
                )}
            </div>

            {/* Input Bar */}
            <div className="h-10 border-t border-white/10 flex items-center px-3 gap-2 shrink-0">
                <span className="text-blue-400 font-medium text-xs">{'>'}</span>
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Enter command for Web Agent..."
                    className="flex-1 bg-transparent border-none outline-none text-xs font-medium"
                />
            </div>

            {/* Logs */}
            <div className="h-24 border-t border-white/10 p-2 text-[10px] overflow-y-auto scrollbar-hide shrink-0">
                {logs.map((log, i) => (
                    <div key={i} className="mb-1 border-l-2 border-blue-500/30 pl-1 break-words text-gray-400">
                        <span className="opacity-50 mr-2">[{new Date().toLocaleTimeString().split(' ')[0]}]</span>
                        {log}
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    );
};

export default BrowserWindow;
