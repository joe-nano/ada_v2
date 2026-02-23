import React, { useEffect, useState } from 'react';
import { Lock, Unlock, User } from 'lucide-react';

const AuthLock = ({ socket, onAuthenticated, onAnimationComplete }) => {
    const [frameSrc, setFrameSrc] = useState(null);
    const [message, setMessage] = useState("Initializing Security...");
    const [isUnlocking, setIsUnlocking] = useState(false);

    useEffect(() => {
        if (!socket) return;

        const handleAuthStatus = (data) => {
            console.log("Auth Status:", data);
            if (data.authenticated && !isUnlocking) {
                setIsUnlocking(true);
                setMessage("Identity Verified. Access Granted.");

                setTimeout(() => {
                    onAuthenticated(true);
                }, 2000);
            } else if (!data.authenticated && !isUnlocking) {
                setMessage("Look at the camera to unlock.");
            }
        };

        const handleAuthFrame = (data) => {
            setFrameSrc(`data:image/jpeg;base64,${data.image}`);
        };

        socket.on('auth_status', handleAuthStatus);
        socket.on('auth_frame', handleAuthFrame);

        return () => {
            socket.off('auth_status', handleAuthStatus);
            socket.off('auth_frame', handleAuthFrame);
        };
    }, [socket, onAuthenticated, onAnimationComplete, isUnlocking]);

    const themeColor = isUnlocking ? 'text-green-600' : 'text-blue-500';
    const borderColor = isUnlocking ? 'border-green-500' : 'border-blue-400';
    const shadowColor = isUnlocking ? 'shadow-[0_0_50px_rgba(34,197,94,0.2)]' : 'shadow-[0_0_50px_rgba(59,130,246,0.15)]';
    const bgGradient = isUnlocking
        ? 'from-green-100/60 via-white to-white'
        : 'from-blue-100/40 via-white to-white';

    return (

        <div className={`fixed inset-0 z-[9999] bg-white flex flex-col items-center justify-center select-none transition-all duration-[2000ms] ${isUnlocking ? 'opacity-0 scale-110 pointer-events-none' : 'opacity-100'}`}
            style={{ transitionDelay: '2000ms' }}>

            {/* Background Gradient */}
            <div className={`absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] ${bgGradient} pointer-events-none transition-colors duration-[1500ms]`}></div>

            <div className={`relative flex flex-col items-center gap-6 p-10 border ${borderColor}/30 rounded-2xl glass ${shadowColor} transition-all duration-[1500ms]`}>
                <div className={`text-3xl font-bold tracking-[0.3em] uppercase flex items-center gap-4 ${themeColor} transition-colors duration-1000`}>
                    {isUnlocking ? <Unlock size={32} /> : <Lock size={32} />}
                    {isUnlocking ? "UNLOCKED" : "LOCKED"}
                </div>

                {/* Camera Feed Frame */}
                <div className={`relative w-64 h-64 border-2 ${borderColor}/50 rounded-2xl overflow-hidden bg-gray-50 shadow-inner flex items-center justify-center transition-colors duration-500`}>
                    {frameSrc ? (
                        <img
                            src={frameSrc}
                            alt="Auth Camera"
                            className={`w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-500 ${isUnlocking ? 'opacity-50 grayscale' : 'opacity-100'}`}
                        />
                    ) : (
                        <div className={`animate-pulse ${isUnlocking ? 'text-green-300' : 'text-blue-300'}`}>
                            <User size={64} />
                        </div>
                    )}

                    {/* Scanning Line Animation - remove on unlock */}
                    {!isUnlocking && (
                        <div className="absolute top-0 left-0 w-full h-1 bg-blue-400/60 shadow-[0_0_15px_rgba(59,130,246,0.5)] animate-[scan_2s_ease-in-out_infinite]"></div>
                    )}

                    {/* Success Overlay */}
                    {isUnlocking && (
                        <div className="absolute inset-0 flex items-center justify-center bg-green-500/10 animate-pulse">
                            <Unlock size={64} className="text-green-500 drop-shadow-[0_0_20px_rgba(74,222,128,0.5)]" />
                        </div>
                    )}
                </div>

                <div className={`text-sm tracking-widest ${isUnlocking ? 'text-green-600' : 'text-blue-500'} animate-pulse transition-colors duration-500`}>
                    {message}
                </div>
            </div>

            {/* Keyframe for scan animation */}
            <style>{`
                @keyframes scan {
                    0%, 100% { top: 0%; opacity: 0; }
                    50% { opacity: 1; }
                    100% { top: 100%; opacity: 0; }
                }
             `}</style>
        </div>
    );
};

export default AuthLock;
