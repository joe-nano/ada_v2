import React from 'react';
import { Text } from '@react-three/drei';

/**
 * XRChatPanel — Native Three.js chat display for immersive XR.
 * Shows recent messages + speaking/mic indicators.
 */

const MAX_MESSAGES = 6;
const LINE_H = 0.035;

export default function XRChatPanel({ messages = [], isSpeakingRef, isMuted = false }) {
  const recent = messages.slice(-MAX_MESSAGES);
  const isSpeaking = isSpeakingRef?.current || false;

  return (
    <group>
      {/* Speaking indicator */}
      <group position={[-0.17, 0.18, 0]}>
        <mesh position={[0, 0, 0]}>
          <circleGeometry args={[0.005, 16]} />
          <meshBasicMaterial color={isSpeaking ? '#00FFFF' : '#334155'} toneMapped={false} />
        </mesh>
        <Text
          position={[0.07, 0, 0.001]}
          fontSize={0.01}
          color={isSpeaking ? '#22d3ee' : '#64748b'}
          anchorX="left"
          anchorY="middle"
        >
          {isSpeaking ? 'JODA is speaking...' : 'Listening (voice)'}
        </Text>
        {/* Mic dot */}
        <mesh position={[0.2, 0, 0]}>
          <circleGeometry args={[0.004, 16]} />
          <meshBasicMaterial color={isMuted ? '#ef4444' : '#4ade80'} toneMapped={false} />
        </mesh>
        <Text
          position={[0.215, 0, 0.001]}
          fontSize={0.009}
          color={isMuted ? '#ef4444' : '#4ade80'}
          anchorX="left"
          anchorY="middle"
        >
          {isMuted ? 'MIC OFF' : 'MIC'}
        </Text>
      </group>

      {/* Messages */}
      {recent.length === 0 ? (
        <Text
          position={[0, 0.05, 0.001]}
          fontSize={0.011}
          color="#475569"
          anchorX="center"
          anchorY="middle"
        >
          No messages yet
        </Text>
      ) : (
        recent.map((msg, i) => {
          const y = 0.14 - i * LINE_H;
          const truncated = (msg.text || '').slice(0, 80) + ((msg.text || '').length > 80 ? '...' : '');
          return (
            <group key={i} position={[-0.17, y, 0]}>
              <Text
                fontSize={0.008}
                color={msg.sender === 'You' ? '#60a5fa' : '#22d3ee'}
                anchorX="left"
                anchorY="top"
                fontWeight="bold"
              >
                {msg.sender}
              </Text>
              <Text
                position={[0, -0.012, 0]}
                fontSize={0.009}
                color="#e2e8f0"
                anchorX="left"
                anchorY="top"
                maxWidth={0.35}
              >
                {truncated}
              </Text>
            </group>
          );
        })
      )}
    </group>
  );
}
