import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Container, Text } from '@react-three/uikit';

/**
 * XRToolsPanel — Full button grid for immersive XR sessions.
 *
 * Vision Pro interaction: gaze at a button to highlight it, then pinch to select.
 * A dwell timer (800ms) auto-selects if the user holds their gaze.
 * Visual feedback: bright border glow + scale-like padding change on hover.
 */

const DWELL_MS = 800; // auto-select after looking for this long

function XRButton({ label, active, color = '#22d3ee', onPress }) {
  const [hovered, setHovered] = useState(false);
  const dwellTimer = useRef(null);

  // Clear dwell timer on unmount
  useEffect(() => () => clearTimeout(dwellTimer.current), []);

  const handleEnter = useCallback(() => {
    setHovered(true);
    // Start dwell-to-select timer
    clearTimeout(dwellTimer.current);
    dwellTimer.current = setTimeout(() => {
      onPress?.();
    }, DWELL_MS);
  }, [onPress]);

  const handleLeave = useCallback(() => {
    setHovered(false);
    clearTimeout(dwellTimer.current);
  }, []);

  const handleEvent = useCallback((e) => {
    e?.stopPropagation?.();
    clearTimeout(dwellTimer.current); // cancel dwell if manually pressed
    onPress?.();
  }, [onPress]);

  // Hover state drives visual highlight
  const isHighlighted = hovered || active;
  const borderCol = hovered ? '#ffffff' : active ? color : 'rgba(100, 116, 139, 0.3)';
  const bgCol = hovered
    ? 'rgba(255, 255, 255, 0.15)'
    : active
      ? 'rgba(34, 211, 238, 0.2)'
      : 'rgba(30, 41, 59, 0.6)';
  const textCol = hovered ? '#ffffff' : active ? color : '#94a3b8';
  const dotCol = hovered ? '#ffffff' : active ? color : '#475569';

  return (
    <Container
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width={hovered ? 78 : 72}
      height={hovered ? 56 : 52}
      backgroundColor={bgCol}
      borderRadius={12}
      borderWidth={hovered ? 2 : 1}
      borderColor={borderCol}
      pointerEvents="auto"
      pointerEventsType="all"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onClick={handleEvent}
      onPointerDown={handleEvent}
      onPointerUp={handleEvent}
      cursor="pointer"
    >
      <Text fontSize={hovered ? 10 : 9} color={textCol} fontWeight="bold">
        {label}
      </Text>
      <Container
        width={hovered ? 7 : 5}
        height={hovered ? 7 : 5}
        borderRadius={4}
        backgroundColor={dotCol}
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
