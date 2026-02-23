import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';

/**
 * Avatar Customization Interface
 *
 * Allows users to:
 * 1. Create photorealistic avatar from photo (Ready Player Me)
 * 2. Use custom 3D model URL
 * 3. Choose from preset avatar styles
 * 4. Capture photo from webcam for digital twin
 */

const AvatarCustomizer = ({ onSave, onClose, currentAvatar }) => {
    const [selectedMode, setSelectedMode] = useState(currentAvatar?.mode || 'avatar-holographic');
    const [customAvatarUrl, setCustomAvatarUrl] = useState(currentAvatar?.customUrl || '');
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreview, setPhotoPreview] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showWebcam, setShowWebcam] = useState(false);
    const [rpmAvatarUrl, setRpmAvatarUrl] = useState(currentAvatar?.rpmAvatarUrl || '');
    const [avatarPosition, setAvatarPosition] = useState(currentAvatar?.position || 'bottom-right');

    const fileInputRef = useRef(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    const avatarModes = [
        {
            id: 'classic',
            name: 'Classic JODA',
            icon: '○',
            description: 'Breathing circle with text',
            preview: '/previews/classic.png'
        },
        {
            id: 'avatar-fullbody',
            name: 'Full Body',
            icon: '🧍',
            description: 'Full-body avatar with expressive gestures',
            preview: '/previews/fullbody.png'
        },
        {
            id: 'avatar-beautiful',
            name: 'Beautiful 3D',
            icon: '✨',
            description: 'High-quality photorealistic avatar with lip sync',
            preview: '/previews/beautiful.png'
        },
        {
            id: 'avatar-holographic',
            name: 'Holographic AI',
            icon: '●',
            description: 'Futuristic glowing hologram',
            preview: '/previews/holographic.png'
        },
        {
            id: 'avatar-svg',
            name: 'Minimalist 2D',
            icon: '◐',
            description: 'Clean animated face',
            preview: '/previews/svg.png'
        },
        {
            id: 'avatar-3d',
            name: '3D Geometric',
            icon: '◆',
            description: 'Geometric robot head',
            preview: '/previews/3d.png'
        },
        {
            id: 'avatar-rpm',
            name: 'Digital Twin',
            icon: '👤',
            description: 'Photorealistic avatar from your photo',
            preview: '/previews/rpm.png'
        },
        {
            id: 'avatar-custom',
            name: 'Custom Model',
            icon: '🎨',
            description: 'Upload your own 3D model',
            preview: '/previews/custom.png'
        }
    ];

    const startWebcam = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' }
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                setShowWebcam(true);
            }
        } catch (error) {
            console.error('Error accessing webcam:', error);
            alert('Could not access webcam. Please check permissions.');
        }
    };

    const stopWebcam = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const tracks = videoRef.current.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
        setShowWebcam(false);
    };

    const capturePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const canvas = canvasRef.current;
            const video = videoRef.current;

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);

            canvas.toBlob((blob) => {
                setPhotoFile(blob);
                setPhotoPreview(URL.createObjectURL(blob));
                stopWebcam();
            }, 'image/jpeg', 0.95);
        }
    };

    const handlePhotoUpload = (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            setPhotoFile(file);
            setPhotoPreview(URL.createObjectURL(file));
        }
    };

    const generateRPMAvatar = async () => {
        if (!photoFile) {
            alert('Please upload or capture a photo first');
            return;
        }

        setIsGenerating(true);

        try {
            const formData = new FormData();
            formData.append('photo', photoFile);

            alert('Opening Ready Player Me creator. After creating your avatar, copy the GLB URL and paste it below.');
            window.open('https://demo.readyplayer.me/avatar', '_blank');

        } catch (error) {
            console.error('Error generating avatar:', error);
            alert('Failed to generate avatar. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSave = () => {
        const avatarConfig = {
            mode: selectedMode,
            customUrl: customAvatarUrl,
            rpmAvatarUrl: rpmAvatarUrl,
            photoPreview: photoPreview,
            position: avatarPosition
        };

        localStorage.setItem('joda_avatar_config', JSON.stringify(avatarConfig));

        onSave(avatarConfig);
        onClose();
    };

    return (
        <div className="w-full h-full overflow-y-auto bg-white/90 rounded-2xl">
            <div className="w-full">
                {/* Header */}
                <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-black/5 p-3 flex justify-between items-center rounded-t-2xl z-10">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">Customize Avatar</h2>
                        <p className="text-xs text-gray-500 mt-0.5">Choose your AI assistant's appearance</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                    >
                        ×
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {/* Avatar Mode Selection */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-800 mb-2">Select Avatar Style</h3>
                        <div className="grid grid-cols-2 gap-2">
                            {avatarModes.map((mode) => (
                                <motion.button
                                    key={mode.id}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setSelectedMode(mode.id)}
                                    className={`
                                        p-2 rounded-lg border-2 transition-all text-left
                                        ${selectedMode === mode.id
                                            ? 'border-blue-500 bg-blue-500/10'
                                            : 'border-gray-200 bg-white/50 hover:border-blue-400/50'
                                        }
                                    `}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl">{mode.icon}</span>
                                        <span className="text-xs text-gray-800 font-semibold">{mode.name}</span>
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{mode.description}</div>
                                </motion.button>
                            ))}
                        </div>
                    </div>

                    {/* Digital Twin Setup (Ready Player Me) */}
                    {selectedMode === 'avatar-rpm' && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="glass rounded-lg p-6"
                        >
                            <h3 className="text-lg font-semibold text-gray-800 mb-4">
                                Create Your Digital Twin
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm text-gray-600 mb-3">
                                        Upload a photo or use your webcam to create a photorealistic avatar
                                    </p>

                                    {!photoPreview ? (
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => fileInputRef.current?.click()}
                                                className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 rounded-lg text-white font-medium"
                                            >
                                                Upload Photo
                                            </button>
                                            <button
                                                onClick={startWebcam}
                                                className="flex-1 px-4 py-3 bg-purple-500 hover:bg-purple-600 rounded-lg text-white font-medium"
                                            >
                                                Use Webcam
                                            </button>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="image/*"
                                                onChange={handlePhotoUpload}
                                                className="hidden"
                                            />
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="relative">
                                                <img
                                                    src={photoPreview}
                                                    alt="Preview"
                                                    className="w-full max-w-md mx-auto rounded-lg"
                                                />
                                                <button
                                                    onClick={() => {
                                                        setPhotoFile(null);
                                                        setPhotoPreview(null);
                                                    }}
                                                    className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                            <button
                                                onClick={generateRPMAvatar}
                                                disabled={isGenerating}
                                                className="w-full px-4 py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 rounded-lg text-white font-medium"
                                            >
                                                {isGenerating ? 'Generating Avatar...' : 'Generate Avatar'}
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Webcam View */}
                                {showWebcam && (
                                    <div className="space-y-3">
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            className="w-full max-w-md mx-auto rounded-lg"
                                        />
                                        <div className="flex gap-3">
                                            <button
                                                onClick={capturePhoto}
                                                className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 rounded-lg text-white font-medium"
                                            >
                                                Capture Photo
                                            </button>
                                            <button
                                                onClick={stopWebcam}
                                                className="px-4 py-3 bg-red-500 hover:bg-red-600 rounded-lg text-white font-medium"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Ready Player Me URL Input */}
                                <div>
                                    <label className="block text-sm text-gray-600 mb-2">
                                        Or paste Ready Player Me avatar URL:
                                    </label>
                                    <input
                                        type="text"
                                        value={rpmAvatarUrl}
                                        onChange={(e) => setRpmAvatarUrl(e.target.value)}
                                        placeholder="https://models.readyplayer.me/..."
                                        className="w-full px-4 py-2 glass text-gray-800 rounded-lg focus:ring-2 focus:ring-blue-400/50 focus:outline-none"
                                    />
                                    <p className="text-xs text-gray-400 mt-2">
                                        Create at: <a href="https://readyplayer.me/avatar" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">readyplayer.me/avatar</a>
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Custom Model URL */}
                    {selectedMode === 'avatar-custom' && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="glass rounded-lg p-6"
                        >
                            <h3 className="text-lg font-semibold text-gray-800 mb-4">
                                Custom 3D Model
                            </h3>
                            <div>
                                <label className="block text-sm text-gray-600 mb-2">
                                    3D Model URL (.glb or .gltf):
                                </label>
                                <input
                                    type="text"
                                    value={customAvatarUrl}
                                    onChange={(e) => setCustomAvatarUrl(e.target.value)}
                                    placeholder="https://example.com/model.glb"
                                    className="w-full px-4 py-2 glass text-gray-800 rounded-lg focus:ring-2 focus:ring-blue-400/50 focus:outline-none"
                                />
                                <p className="text-xs text-gray-400 mt-2">
                                    Supports GLB and GLTF formats. Host your model online and paste the URL.
                                </p>
                            </div>
                        </motion.div>
                    )}

                    {/* Avatar Position */}
                    <div className="glass rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">Avatar Position</h3>
                        <p className="text-gray-500 text-sm mb-4">
                            Choose where your avatar appears on screen
                        </p>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setAvatarPosition('bottom-left')}
                                className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                                    avatarPosition === 'bottom-left'
                                        ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                                        : 'border-gray-200 bg-white/50 text-gray-500 hover:border-gray-300'
                                }`}
                            >
                                <div className="text-2xl mb-2">←</div>
                                <div className="text-sm font-medium">Bottom Left</div>
                            </button>
                            <button
                                onClick={() => setAvatarPosition('bottom-right')}
                                className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                                    avatarPosition === 'bottom-right'
                                        ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                                        : 'border-gray-200 bg-white/50 text-gray-500 hover:border-gray-300'
                                }`}
                            >
                                <div className="text-2xl mb-2">→</div>
                                <div className="text-sm font-medium">Bottom Right</div>
                            </button>
                        </div>
                    </div>

                    {/* Preview */}
                    <div className="glass rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">Preview</h3>
                        <div className="aspect-video bg-gray-50 rounded-lg flex items-center justify-center border border-gray-200">
                            <div className="text-gray-400">
                                Avatar preview will appear here
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-black/5 p-3 flex justify-end gap-2 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 text-sm glass hover:bg-black/5 rounded-lg text-gray-600 font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 rounded-lg text-white font-medium"
                    >
                        Save Avatar
                    </button>
                </div>

                {/* Hidden canvas for photo capture */}
                <canvas ref={canvasRef} className="hidden" />
            </div>
        </div>
    );
};

export default AvatarCustomizer;
