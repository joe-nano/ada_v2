import React from 'react';

const ConfirmationPopup = ({ request, onConfirm, onDeny }) => {
    if (!request) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-50 backdrop-blur-sm animate-fade-in">
            <div className="relative w-full max-w-lg p-8 bg-white/95 border border-blue-400/30 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.08)] backdrop-blur-2xl transform transition-all scale-100">
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 pointer-events-none mix-blend-overlay rounded-3xl"></div>

                {/* Header with Icon */}
                <div className="flex items-center gap-4 mb-6 relative z-10">
                    <div className="p-3 rounded-full bg-blue-50 border border-blue-400/30 text-blue-600 shadow-[0_0_15px_rgba(0,122,255,0.1)]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-blue-600 tracking-wider font-mono drop-shadow-sm">
                            AUTHORIZATION REQUIRED
                        </h2>
                        <p className="text-xs text-gray-400 font-mono tracking-widest uppercase">
                            AI Logic Core Request
                        </p>
                    </div>
                </div>

                {/* Content */}
                <div className="mb-8 space-y-4 relative z-10">
                    <p className="text-gray-600 leading-relaxed text-sm">
                        The system is requesting permission to execute an autonomous function. Please review the parameters below.
                    </p>

                    <div className="space-y-2">
                        <div className="bg-blue-50/50 border border-blue-200 rounded-xl overflow-hidden">
                            <div className="bg-blue-50 px-4 py-2 border-b border-blue-200 flex justify-between items-center">
                                <span className="text-xs text-blue-600 font-bold uppercase tracking-wider">Function</span>
                                <span className="text-xs text-gray-400 font-mono">system.call</span>
                            </div>
                            <div className="p-4">
                                <div className="text-gray-900 font-mono text-lg font-medium">{request.tool}</div>
                            </div>
                        </div>

                        <div className="bg-blue-50/50 border border-blue-200 rounded-xl overflow-hidden">
                            <div className="bg-blue-50 px-4 py-2 border-b border-blue-200 flex justify-between items-center">
                                <span className="text-xs text-blue-600 font-bold uppercase tracking-wider">Parameters</span>
                                <span className="text-xs text-gray-400 font-mono">json.payload</span>
                            </div>
                            <div className="p-4 bg-gray-50">
                                <pre className="text-xs text-gray-600 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                                    {JSON.stringify(request.args, null, 2)}
                                </pre>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-4 relative z-10">
                    <button
                        onClick={onDeny}
                        className="flex-1 px-4 py-3.5 rounded-xl border border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-400 hover:text-red-700 transition-all duration-200 font-bold tracking-wider uppercase text-xs"
                    >
                        Deny Request
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 px-4 py-3.5 rounded-xl border border-blue-400/30 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-500 hover:text-blue-700 transition-all duration-200 font-bold tracking-wider uppercase text-xs shadow-[0_0_20px_rgba(0,122,255,0.06)] hover:shadow-[0_0_30px_rgba(0,122,255,0.12)] relative overflow-hidden group"
                    >
                        <span className="relative z-10">Authorize Execution</span>
                        <div className="absolute inset-0 bg-blue-400/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationPopup;
