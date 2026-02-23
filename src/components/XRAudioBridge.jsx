import { useEffect, useRef } from 'react';
import { useXR } from '@react-three/xr';

/**
 * XRAudioBridge — Renderless component that lives inside <XR>.
 *
 * Watches the XR session lifecycle and ensures AudioContexts are
 * resumed after entering/exiting an immersive session. Safari on
 * visionOS can suspend AudioContexts when the page transitions
 * into WebXR, so we need to explicitly resume them.
 *
 * Also auto-detects headset audio output on XR entry and restores
 * the previous speaker selection on exit.
 *
 * Supports two voice input paths:
 * - Gemini mode: raw mic audio via startMic
 * - OpenAI fallback mode: browser SpeechRecognition via startSpeechRec
 */
export default function XRAudioBridge({
  ensureAiAudioContext,
  startMic,
  startSpeechRec,
  isMutedRef,
  isOpenAiFallbackRef,
  selectedSpeakerId,
  onSpeakerChange,
}) {
  const { session } = useXR();
  const preXrSpeakerIdRef = useRef(null);

  useEffect(() => {
    if (!session) return;

    const attemptVoiceInput = async (isRetry = false) => {
      // Auto-detect headset audio output
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput');

        // Heuristic: prefer device labeled as headset/spatial/visionOS
        const headsetDevice = outputs.find(d =>
          /headset|spatial|vision|head/i.test(d.label)
        );

        if (headsetDevice && onSpeakerChange) {
          // Save current speaker so we can restore on exit
          preXrSpeakerIdRef.current = selectedSpeakerId || '';
          onSpeakerChange(headsetDevice.deviceId);
        }
      } catch (e) {
        console.warn('[XRAudioBridge] Device enumeration failed:', e);
      }

      try {
        await ensureAiAudioContext();
      } catch (e) {
        console.warn('[XRAudioBridge] Failed to resume AI audio context:', e);
      }
      // Re-start voice input if not muted
      if (!isMutedRef?.current) {
        try {
          if (isOpenAiFallbackRef?.current) {
            startSpeechRec?.();
          } else {
            startMic();
          }
        } catch (e) {
          console.warn('[XRAudioBridge] Failed to start voice input:', e);
          // Retry once after another 1s if this was the first attempt
          if (!isRetry) {
            setTimeout(() => attemptVoiceInput(true), 1000);
            return;
          }
        }
      }
    };

    // XR session just started — resume/create audio contexts after
    // a delay to let the session stabilize (Safari needs ~1s).
    const timer = setTimeout(() => attemptVoiceInput(false), 1000);

    // When the session ends, restore previous speaker and resume contexts
    const onEnd = () => {
      if (preXrSpeakerIdRef.current !== null && onSpeakerChange) {
        onSpeakerChange(preXrSpeakerIdRef.current);
        preXrSpeakerIdRef.current = null;
      }
      ensureAiAudioContext().catch((e) => {
        console.warn('[XRAudioBridge] Failed to resume audio on session end:', e);
      });
    };
    session.addEventListener('end', onEnd);

    return () => {
      clearTimeout(timer);
      session.removeEventListener('end', onEnd);
    };
  }, [session, ensureAiAudioContext, startMic, startSpeechRec, isMutedRef, isOpenAiFallbackRef, onSpeakerChange, selectedSpeakerId]);

  return null;
}
