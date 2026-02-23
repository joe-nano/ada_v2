import React, { useEffect, useRef } from 'react';

const ChatModule = ({
    messages,
    inputValue,
    setInputValue,
    handleSend,
}) => {
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    return (
        <div className="flex-1 min-h-0 flex flex-col px-4 py-4">
            {/* Messages Container */}
            <div className="flex flex-col gap-3 overflow-y-auto mb-4 pr-2 flex-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                {messages.slice(-100).map((msg, i) => (
                    <div
                        key={i}
                        className={`rounded-2xl px-4 py-3 transition-all duration-200 ${
                            msg.sender === 'User'
                                ? 'ml-auto bg-blue-500/10 border border-blue-400/20 max-w-[85%]'
                                : 'mr-auto bg-white/40 border border-black/5 max-w-[85%]'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className={`text-[10px] font-semibold tracking-wide ${
                                msg.sender === 'User' ? 'text-blue-500' : 'text-gray-500'
                            }`}>
                                {msg.sender}
                            </span>
                            <span className="text-[9px] text-gray-400 font-medium">
                                {msg.time}
                            </span>
                        </div>
                        <div className={`text-sm leading-relaxed ${
                            msg.sender === 'User' ? 'text-gray-800' : 'text-gray-700'
                        }`}>
                            {msg.text}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Field */}
            <div className="flex gap-2">
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleSend}
                    placeholder="Message J.O.D.A..."
                    className="flex-1 rounded-full px-5 py-3 text-sm placeholder-gray-400
                               focus:outline-none focus:ring-2 focus:ring-blue-400/50 transition-all
                               bg-white/60 border border-black/5"
                />
                <button
                    onClick={() => handleSend({ key: 'Enter' })}
                    className="apple-button sf-icon bg-blue-500/10 border-blue-400/20 hover:bg-blue-500/20"
                    title="Send"
                >
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-blue-500"
                    >
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default ChatModule;
