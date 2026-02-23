import React from 'react';
import { Container, Text } from '@react-three/uikit';

/**
 * XRToolsPanel — Full button grid for immersive XR sessions.
 *
 * Mirrors the desktop ToolsModule with all 11 controls arranged in 2 rows.
 * Uses BOTH onClick and onPointerUp for maximum compatibility across
 * XR input modes (hand tracking, transient pointer, controllers).
 */

function XRButton({ label, active, color = '#22d3ee', onPress }) {
  const handleEvent = (e) => {
    e?.stopPropagation?.();
    onPress?.();
  };

  return (
    <Container
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width={72}
      height={52}
      backgroundColor={active ? 'rgba(34, 211, 238, 0.2)' : 'rgba(30, 41, 59, 0.6)'}
      borderRadius={12}
      borderWidth={1}
      borderColor={active ? color : 'rgba(100, 116, 139, 0.3)'}
      pointerEvents="auto"
      pointerEventsType="all"
      onClick={handleEvent}
      onPointerDown={handleEvent}
      onPointerUp={handleEvent}
      cursor="pointer"
    >
      <Text fontSize={9} color={active ? color : '#94a3b8'} fontWeight="bold">
        {label}
      </Text>
      <Container
        width={5}
        height={5}
        borderRadius={3}
        backgroundColor={active ? color : '#475569'}
        marginTop={3}
      />
    </Container>
  );
}

export default function XRToolsPanel({
  isConnected = true,
  isMuted = false,
  isSpeakerMuted = false,
  isVideoOn = false,
  showSettings = false,
  isHandTrackingEnabled = false,
  showKasaWindow = false,
  showPrinterWindow = false,
  showCadWindow = false,
  showBrowserWindow = false,
  showMediaGallery = false,
  onTogglePower,
  onToggleMute,
  onToggleSpeaker,
  onToggleVideo,
  onToggleSettings,
  onToggleHand,
  onToggleKasa,
  onTogglePrinter,
  onToggleCad,
  onToggleBrowser,
  onToggleMedia,
}) {
  return (
    <Container
      flexDirection="column"
      gap={8}
      width="100%"
      alignItems="center"
      pointerEvents="auto"
      pointerEventsType="all"
    >
      {/* Row 1: Communication controls */}
      <Container flexDirection="row" gap={6} justifyContent="center" alignItems="center" pointerEvents="auto" pointerEventsType="all">
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
          label={isVideoOn ? 'VID ON' : 'VID OFF'}
          active={isVideoOn}
          color="#facc15"
          onPress={onToggleVideo}
        />
        <XRButton
          label="SETTINGS"
          active={showSettings}
          color="#f472b6"
          onPress={onToggleSettings}
        />
        <XRButton
          label="HAND"
          active={isHandTrackingEnabled}
          color="#34d399"
          onPress={onToggleHand}
        />
        <XRButton
          label={isConnected ? 'ON' : 'OFF'}
          active={isConnected}
          color={isConnected ? '#4ade80' : '#ef4444'}
          onPress={onTogglePower}
        />
      </Container>

      {/* Row 2: Window toggles */}
      <Container flexDirection="row" gap={6} justifyContent="center" alignItems="center" pointerEvents="auto" pointerEventsType="all">
        <XRButton
          label="KASA"
          active={showKasaWindow}
          color="#fb923c"
          onPress={onToggleKasa}
        />
        <XRButton
          label="PRINTER"
          active={showPrinterWindow}
          color="#60a5fa"
          onPress={onTogglePrinter}
        />
        <XRButton
          label="CAD"
          active={showCadWindow}
          color="#c084fc"
          onPress={onToggleCad}
        />
        <XRButton
          label="BROWSER"
          active={showBrowserWindow}
          color="#2dd4bf"
          onPress={onToggleBrowser}
        />
        <XRButton
          label="MEDIA"
          active={showMediaGallery}
          color="#f87171"
          onPress={onToggleMedia}
        />
      </Container>
    </Container>
  );
}
