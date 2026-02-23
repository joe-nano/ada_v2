import React from 'react';
import { Container, Text } from '@react-three/uikit';

/**
 * XRToolsPanel — Button grid for immersive XR sessions.
 *
 * Provides mic toggle, speaker toggle, and power button.
 * Uses @react-three/uikit Container elements with onClick.
 * Maps to the same callbacks as the desktop ToolsModule.
 */

function XRButton({ label, active, color = '#22d3ee', onPress }) {
  return (
    <Container
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width={80}
      height={60}
      backgroundColor={active ? 'rgba(34, 211, 238, 0.2)' : 'rgba(30, 41, 59, 0.6)'}
      borderRadius={12}
      borderWidth={1}
      borderColor={active ? color : 'rgba(100, 116, 139, 0.3)'}
      onClick={onPress}
      cursor="pointer"
    >
      <Text fontSize={10} color={active ? color : '#94a3b8'} fontWeight="bold">
        {label}
      </Text>
      <Container
        width={6}
        height={6}
        borderRadius={3}
        backgroundColor={active ? color : '#475569'}
        marginTop={4}
      />
    </Container>
  );
}

export default function XRToolsPanel({
  isConnected = true,
  isMuted = false,
  isSpeakerMuted = false,
  onTogglePower,
  onToggleMute,
  onToggleSpeaker,
}) {
  return (
    <Container
      flexDirection="row"
      gap={12}
      width="100%"
      justifyContent="center"
      alignItems="center"
    >
      <XRButton
        label={isMuted ? 'MIC OFF' : 'MIC ON'}
        active={!isMuted}
        color="#22d3ee"
        onPress={onToggleMute}
      />
      <XRButton
        label={isSpeakerMuted ? 'SPK OFF' : 'SPK ON'}
        active={!isSpeakerMuted}
        color="#a78bfa"
        onPress={onToggleSpeaker}
      />
      <XRButton
        label={isConnected ? 'ON' : 'OFF'}
        active={isConnected}
        color={isConnected ? '#4ade80' : '#ef4444'}
        onPress={onTogglePower}
      />
    </Container>
  );
}
