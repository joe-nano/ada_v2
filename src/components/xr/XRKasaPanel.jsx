import React, { useState, useCallback } from 'react';
import { Text } from '@react-three/drei';

/**
 * XRKasaPanel — Native Three.js smart device toggles for XR.
 */

function DeviceRow({ device, socket, index }) {
  const isOn = device.is_on;
  const [hovered, setHovered] = useState(false);
  const y = -index * 0.04;

  const handleToggle = useCallback((e) => {
    e?.stopPropagation?.();
    if (!socket) return;
    socket.emit('control_kasa', {
      device_name: device.alias || device.name,
      action: isOn ? 'off' : 'on',
    });
  }, [socket, device, isOn]);

  return (
    <group position={[0, y, 0]}>
      {/* Device name */}
      <Text
        position={[-0.14, 0, 0]}
        fontSize={0.01}
        color="#e2e8f0"
        anchorX="left"
        anchorY="middle"
        maxWidth={0.2}
      >
        {device.alias || device.name || 'Unknown'}
      </Text>

      {/* Toggle button */}
      <group position={[0.14, 0, 0]}>
        <mesh
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onPointerDown={handleToggle}
          onClick={handleToggle}
        >
          <planeGeometry args={[0.05, 0.025]} />
          <meshBasicMaterial
            color={hovered ? (isOn ? '#166534' : '#334155') : (isOn ? '#14532d' : '#1e293b')}
            transparent
            opacity={hovered ? 0.9 : 0.7}
            toneMapped={false}
          />
        </mesh>
        <Text
          position={[0, 0, 0.001]}
          fontSize={0.009}
          color={isOn ? '#4ade80' : '#94a3b8'}
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          {isOn ? 'ON' : 'OFF'}
        </Text>
      </group>
    </group>
  );
}

export default function XRKasaPanel({ devices = [], socket, onClose }) {
  const [closeHovered, setCloseHovered] = useState(false);

  return (
    <group>
      {/* Title */}
      <Text
        position={[-0.15, 0.1, 0]}
        fontSize={0.013}
        color="#22d3ee"
        anchorX="left"
        anchorY="middle"
        fontWeight="bold"
      >
        Smart Devices
      </Text>

      {/* Close button */}
      {onClose && (
        <group position={[0.17, 0.1, 0]}>
          <mesh
            onPointerEnter={() => setCloseHovered(true)}
            onPointerLeave={() => setCloseHovered(false)}
            onPointerDown={(e) => { e.stopPropagation(); onClose(); }}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          >
            <planeGeometry args={[0.03, 0.025]} />
            <meshBasicMaterial
              color={closeHovered ? '#ef4444' : '#1e293b'}
              transparent
              opacity={closeHovered ? 0.8 : 0.6}
              toneMapped={false}
            />
          </mesh>
          <Text position={[0, 0, 0.001]} fontSize={0.012} color="#ef4444" anchorX="center" anchorY="middle" fontWeight="bold">
            X
          </Text>
        </group>
      )}

      {/* Devices list */}
      <group position={[0, 0.04, 0]}>
        {devices.length === 0 ? (
          <Text fontSize={0.01} color="#64748b" anchorX="center" anchorY="middle">
            No devices found
          </Text>
        ) : (
          devices.map((device, i) => (
            <DeviceRow key={device.alias || i} device={device} socket={socket} index={i} />
          ))
        )}
      </group>
    </group>
  );
}
