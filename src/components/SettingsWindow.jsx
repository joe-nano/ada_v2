import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const TOOLS = [
    { id: 'generate_cad', label: 'Generate CAD' },
    { id: 'generate_image', label: 'Generate Image' },
    { id: 'run_web_agent', label: 'Web Agent' },
    { id: 'run_browser_use', label: 'Browser Task Agent' },
    { id: 'create_directory', label: 'Create Folder' },
    { id: 'write_file', label: 'Write File' },
    { id: 'read_directory', label: 'Read Directory' },
    { id: 'read_file', label: 'Read File' },
    { id: 'create_project', label: 'Create Project' },
    { id: 'switch_project', label: 'Switch Project' },
    { id: 'list_projects', label: 'List Projects' },
    { id: 'list_smart_devices', label: 'List Devices' },
    { id: 'control_light', label: 'Control Light' },
    { id: 'discover_printers', label: 'Discover Printers' },
    { id: 'print_stl', label: 'Print 3D Model' },
    { id: 'iterate_cad', label: 'Iterate CAD' },
];

const SettingsWindow = ({
    socket,
    micDevices,
    speakerDevices,
    webcamDevices,
    selectedMicId,
    setSelectedMicId,
    selectedSpeakerId,
    setSelectedSpeakerId,
    selectedWebcamId,
    setSelectedWebcamId,
    cursorSensitivity,
    setCursorSensitivity,
    isCameraFlipped,
    setIsCameraFlipped,
    handleFileUpload,
    onClose
}) => {
    const [permissions, setPermissions] = useState({});
    const [faceAuthEnabled, setFaceAuthEnabled] = useState(false);
    const [browserUsername, setBrowserUsername] = useState('');
    const [browserPassword, setBrowserPassword] = useState('');

    useEffect(() => {
        socket.emit('get_settings');

        const handleSettings = (settings) => {
            if (settings) {
                if (settings.tool_permissions) setPermissions(settings.tool_permissions);
                if (typeof settings.face_auth_enabled !== 'undefined') {
                    setFaceAuthEnabled(settings.face_auth_enabled);
                    localStorage.setItem('face_auth_enabled', settings.face_auth_enabled);
                }
            }
        };

        socket.on('settings', handleSettings);
        return () => socket.off('settings', handleSettings);
    }, [socket]);

    const togglePermission = (toolId) => {
        const currentVal = permissions[toolId] !== false;
        const nextVal = !currentVal;
        socket.emit('update_settings', { tool_permissions: { [toolId]: nextVal } });
    };

    const toggleFaceAuth = () => {
        const newVal = !faceAuthEnabled;
        setFaceAuthEnabled(newVal);
        localStorage.setItem('face_auth_enabled', newVal);
        socket.emit('update_settings', { face_auth_enabled: newVal });
    };

    const toggleCameraFlip = () => {
        const newVal = !isCameraFlipped;
        setIsCameraFlipped(newVal);
        socket.emit('update_settings', { camera_flipped: newVal });
    };

    const saveBrowserSecrets = () => {
        socket.emit('set_browser_secrets', { username: browserUsername, password: browserPassword });
        setBrowserPassword('');
    };

    const clearBrowserSecrets = () => {
        socket.emit('clear_browser_secrets');
        setBrowserUsername('');
        setBrowserPassword('');
    };

    return (
        <div className="w-full h-full flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center px-3 py-2 border-b border-white/10">
                <h2 className="font-bold text-xs uppercase tracking-wider">Settings</h2>
                <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded transition-colors">
                    <X size={16} />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-5 scrollbar-hide">

                {/* Security */}
                <div>
                    <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-70">Security</h3>
                    <div className="flex items-center justify-between text-xs bg-white/5 p-2 rounded border border-white/10">
                        <span>Face Authentication</span>
                        <button
                            onClick={toggleFaceAuth}
                            className={`relative w-8 h-4 rounded-full transition-colors duration-200 ${faceAuthEnabled ? 'bg-blue-500' : 'bg-white/20'}`}
                        >
                            <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform duration-200 ${faceAuthEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>

                {/* Microphone */}
                <div>
                    <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-70">Microphone</h3>
                    <select
                        value={selectedMicId}
                        onChange={(e) => setSelectedMicId(e.target.value)}
                        className="w-full rounded p-2 text-xs outline-none"
                    >
                        {micDevices.map((device, i) => (
                            <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Microphone ${i + 1}`}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Speaker */}
                <div>
                    <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-70">Speaker</h3>
                    <select
                        value={selectedSpeakerId}
                        onChange={(e) => setSelectedSpeakerId(e.target.value)}
                        className="w-full rounded p-2 text-xs outline-none"
                    >
                        {speakerDevices.map((device, i) => (
                            <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Speaker ${i + 1}`}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Webcam */}
                <div>
                    <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-70">Webcam</h3>
                    <select
                        value={selectedWebcamId}
                        onChange={(e) => setSelectedWebcamId(e.target.value)}
                        className="w-full rounded p-2 text-xs outline-none"
                    >
                        {webcamDevices.map((device, i) => (
                            <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Camera ${i + 1}`}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Cursor Sensitivity */}
                <div>
                    <div className="flex justify-between mb-2">
                        <h3 className="font-bold text-xs uppercase tracking-wider opacity-70">Cursor Sensitivity</h3>
                        <span className="text-xs text-gray-400">{cursorSensitivity}x</span>
                    </div>
                    <input
                        type="range"
                        min="1.0"
                        max="5.0"
                        step="0.1"
                        value={cursorSensitivity}
                        onChange={(e) => setCursorSensitivity(parseFloat(e.target.value))}
                        className="w-full accent-blue-500 cursor-pointer h-1 rounded-lg appearance-none"
                    />
                </div>

                {/* Browser Credentials */}
                <div>
                    <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-70">Browser Login</h3>
                    <div className="space-y-2 text-xs bg-white/5 p-2 rounded border border-white/10">
                        <div className="text-gray-500 text-[10px]">
                            Saved in backend memory only for this session.
                        </div>
                        <input
                            value={browserUsername}
                            onChange={(e) => setBrowserUsername(e.target.value)}
                            placeholder="Username / email"
                            className="w-full rounded p-2 text-xs outline-none"
                        />
                        <input
                            value={browserPassword}
                            onChange={(e) => setBrowserPassword(e.target.value)}
                            placeholder="Password"
                            type="password"
                            className="w-full rounded p-2 text-xs outline-none"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={saveBrowserSecrets}
                                className="flex-1 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 rounded px-2 py-1 transition-colors"
                            >
                                Save
                            </button>
                            <button
                                onClick={clearBrowserSecrets}
                                className="flex-1 bg-white/5 hover:bg-white/10 text-gray-400 rounded px-2 py-1 transition-colors"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>

                {/* Gesture Control */}
                <div>
                    <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-70">Gesture Control</h3>
                    <div className="flex items-center justify-between text-xs bg-white/5 p-2 rounded border border-white/10">
                        <span>Flip Camera Horizontal</span>
                        <button
                            onClick={toggleCameraFlip}
                            className={`relative w-8 h-4 rounded-full transition-colors duration-200 ${isCameraFlipped ? 'bg-blue-500' : 'bg-white/20'}`}
                        >
                            <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform duration-200 ${isCameraFlipped ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>

                {/* Tool Permissions */}
                <div>
                    <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-70">Tool Confirmations</h3>
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1 scrollbar-hide">
                        {TOOLS.map(tool => {
                            const isRequired = permissions[tool.id] !== false;
                            return (
                                <div key={tool.id} className="flex items-center justify-between text-xs bg-white/5 p-2 rounded border border-white/10">
                                    <span>{tool.label}</span>
                                    <button
                                        onClick={() => togglePermission(tool.id)}
                                        className={`relative w-8 h-4 rounded-full transition-colors duration-200 ${isRequired ? 'bg-blue-500' : 'bg-white/20'}`}
                                    >
                                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform duration-200 ${isRequired ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Memory Upload */}
                <div>
                    <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-70">Memory Data</h3>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] text-gray-500 uppercase">Upload Memory Text</label>
                        <input
                            type="file"
                            accept=".txt"
                            onChange={handleFileUpload}
                            className="text-xs rounded p-2 file:mr-2 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-[10px] file:font-semibold file:bg-blue-500/15 file:text-blue-400 hover:file:bg-blue-500/25 cursor-pointer"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsWindow;
