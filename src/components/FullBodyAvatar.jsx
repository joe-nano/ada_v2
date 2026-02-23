import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

/**
 * FullBodyAvatar - Full-body 3D avatar with skeletal animations and lip sync
 *
 * M3GAN-inspired: fluid, expressive gestures with smooth crossfade blending.
 * Preserves text-to-phoneme lip sync from BeautifulAvatar.
 *
 * Animation State Machine:
 *   idle → talking (on speech start, 0.3s crossfade)
 *   talking → gesturing (on emphasis/loud audio, 0.4s blend)
 *   talking → idle (on silence, 0.5s gentle fade)
 *   idle → greeting (on session start)
 *   Any → thinking (on processing delay)
 */

// Text-to-ARKit phoneme mapping (same as BeautifulAvatar)
const textToPhonemeMapping = {
  'a': { primary: 'jawOpen', secondary: 'mouthOpen', intensity: 0.6 },
  'e': { primary: 'mouthStretchLeft', secondary: 'mouthStretchRight', intensity: 0.5 },
  'i': { primary: 'mouthStretchLeft', secondary: 'mouthStretchRight', intensity: 0.7 },
  'o': { primary: 'mouthFunnel', secondary: 'jawOpen', intensity: 0.5 },
  'u': { primary: 'mouthPucker', secondary: null, intensity: 0.6 },
  'b': { primary: 'mouthClose', secondary: null, intensity: 0.8 },
  'p': { primary: 'mouthPressLeft', secondary: 'mouthPressRight', intensity: 0.7 },
  'm': { primary: 'mouthClose', secondary: null, intensity: 0.7 },
  'f': { primary: 'mouthLowerDownLeft', secondary: 'mouthLowerDownRight', intensity: 0.6 },
  'v': { primary: 'mouthLowerDownLeft', secondary: 'mouthLowerDownRight', intensity: 0.6 },
  'th': { primary: 'mouthStretchLeft', secondary: 'mouthStretchRight', intensity: 0.4 },
  'l': { primary: 'mouthRollUpper', secondary: null, intensity: 0.3 },
  'r': { primary: 'mouthFunnel', secondary: null, intensity: 0.3 },
  's': { primary: 'mouthStretchLeft', secondary: 'mouthStretchRight', intensity: 0.3 },
  'sh': { primary: 'mouthFunnel', secondary: 'mouthPucker', intensity: 0.4 },
  'ch': { primary: 'mouthFunnel', secondary: null, intensity: 0.4 },
  't': { primary: 'jawOpen', secondary: null, intensity: 0.3 },
  'd': { primary: 'jawOpen', secondary: null, intensity: 0.3 },
  'k': { primary: 'jawOpen', secondary: null, intensity: 0.4 },
  'g': { primary: 'jawOpen', secondary: null, intensity: 0.4 },
  'w': { primary: 'mouthPucker', secondary: null, intensity: 0.5 },
  'y': { primary: 'mouthSmileLeft', secondary: 'mouthSmileRight', intensity: 0.4 }
};

function textToPhonemes(text) {
  if (!text) return [];
  const phonemes = [];
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    let i = 0;
    while (i < word.length) {
      if (i < word.length - 1) {
        const digraph = word.substring(i, i + 2);
        if (textToPhonemeMapping[digraph]) {
          phonemes.push(textToPhonemeMapping[digraph]);
          i += 2;
          continue;
        }
      }
      const char = word[i];
      if (textToPhonemeMapping[char]) {
        phonemes.push(textToPhonemeMapping[char]);
      } else {
        phonemes.push({ primary: 'jawOpen', secondary: null, intensity: 0.2 });
      }
      i++;
    }
    phonemes.push({ primary: 'mouthClose', secondary: null, intensity: 0.1 });
  }
  return phonemes;
}

// Animation state constants
const ANIM_STATES = {
  IDLE: 'idle',
  TALKING: 'talking',
  GESTURING: 'gesturing',
  THINKING: 'thinking',
  GREETING: 'greeting',
  LISTENING: 'listening'
};

// Map animation state to animation clip names (from Mixamo)
// These names should match the clips embedded in the GLB or loaded separately
const ANIM_CLIP_NAMES = {
  [ANIM_STATES.IDLE]: ['Idle', 'idle', 'Standing Idle', 'Happy Idle', 'Breathing Idle'],
  [ANIM_STATES.TALKING]: ['Talking', 'talking', 'Standing Talk', 'Explaining'],
  [ANIM_STATES.GESTURING]: ['Gesturing', 'gesturing', 'Explaining', 'Weight Shift'],
  [ANIM_STATES.THINKING]: ['Thinking', 'thinking', 'Looking Around'],
  [ANIM_STATES.GREETING]: ['Greeting', 'greeting', 'Waving', 'Standing Greeting'],
  [ANIM_STATES.LISTENING]: ['Listening', 'listening', 'Weight Shift', 'Idle']
};

export function FullBodyAvatar({
  modelUrl = '/models/joda-fullbody.glb',
  audioData = [],
  lipsyncData = null,
  expression = 'neutral',
  isSpeaking = false,
  isProcessing = false,
  scale = 1,
  speakingText = ''
}) {
  const group = useRef();
  const headMesh = useRef(null);
  const blinkTimer = useRef(0);
  const nextBlink = useRef(3);
  const audioLevel = useRef(0);
  const currentState = useRef(ANIM_STATES.IDLE);
  const stateTimer = useRef(0);
  const hasGreeted = useRef(false);

  // Text-based lip sync state
  const [phonemes, setPhonemes] = useState([]);
  const phonemeIndex = useRef(0);
  const phonemeTimer = useRef(0);
  const lastSpeakingText = useRef('');

  // Load model with animations
  const { scene, nodes, animations } = useGLTF(modelUrl);
  const { actions, mixer, names } = useAnimations(animations, group);

  // Find the best matching animation clip for a given state
  const findAnimation = (state) => {
    const candidates = ANIM_CLIP_NAMES[state] || ANIM_CLIP_NAMES[ANIM_STATES.IDLE];
    for (const name of candidates) {
      if (actions[name]) return actions[name];
    }
    // Fallback: try partial match
    for (const name of candidates) {
      const match = Object.keys(actions).find(k =>
        k.toLowerCase().includes(name.toLowerCase())
      );
      if (match) return actions[match];
    }
    return null;
  };

  // Crossfade to a new animation state
  const transitionTo = (newState, duration = 0.4) => {
    if (currentState.current === newState) return;

    const currentAction = findAnimation(currentState.current);
    const newAction = findAnimation(newState);

    if (newAction) {
      newAction.reset();
      newAction.setEffectiveTimeScale(1);
      newAction.setEffectiveWeight(1);

      if (currentAction) {
        newAction.crossFadeFrom(currentAction, duration, true);
      }

      newAction.play();
    }

    currentState.current = newState;
    stateTimer.current = 0;
  };

  // Initialize: find head mesh, start idle animation
  useEffect(() => {
    if (!scene) return;

    // Find head mesh with morph targets
    scene.traverse((object) => {
      if (object.isMesh && object.morphTargetDictionary) {
        const morphCount = Object.keys(object.morphTargetDictionary).length;
        if (morphCount > 10 && !headMesh.current) {
          headMesh.current = object;
          console.log('[FULLBODY] Found head mesh:', object.name, 'morphs:', morphCount);
        }
      }
    });

    // Log available animations
    console.log('[FULLBODY] Available animations:', names);
    console.log('[FULLBODY] Action keys:', Object.keys(actions));

    // Start with idle animation
    const idleAction = findAnimation(ANIM_STATES.IDLE);
    if (idleAction) {
      idleAction.play();
      console.log('[FULLBODY] Playing idle animation');
    } else if (names.length > 0) {
      // Fallback: play first available animation
      const firstAction = actions[names[0]];
      if (firstAction) {
        firstAction.play();
        console.log('[FULLBODY] Playing fallback animation:', names[0]);
      }
    }
  }, [scene, actions, names]);

  // Greeting on first mount
  useEffect(() => {
    if (!hasGreeted.current && Object.keys(actions).length > 0) {
      const greetAction = findAnimation(ANIM_STATES.GREETING);
      if (greetAction) {
        transitionTo(ANIM_STATES.GREETING, 0.3);
        hasGreeted.current = true;
        // Return to idle after greeting
        setTimeout(() => {
          transitionTo(ANIM_STATES.IDLE, 0.5);
        }, 3000);
      } else {
        hasGreeted.current = true;
      }
    }
  }, [actions]);

  // Text-to-phoneme processing
  useEffect(() => {
    if (speakingText && speakingText !== lastSpeakingText.current) {
      const newPhonemes = textToPhonemes(speakingText);
      setPhonemes(prev => [...prev, ...newPhonemes]);
      lastSpeakingText.current = speakingText;
    }
  }, [speakingText]);

  // Animation state machine
  useFrame((state, delta) => {
    if (!group.current) return;

    const time = state.clock.elapsedTime;
    stateTimer.current += delta;

    // Calculate audio level
    if (audioData && audioData.length > 0) {
      const maxAmp = Math.max(...audioData.slice(-10).map(v => Math.abs(v))) / 255;
      audioLevel.current += (maxAmp - audioLevel.current) * 0.4;
    } else {
      audioLevel.current *= 0.9;
    }

    // State machine transitions
    if (isProcessing && currentState.current !== ANIM_STATES.THINKING) {
      transitionTo(ANIM_STATES.THINKING, 0.4);
    } else if (isSpeaking && audioLevel.current > 0.3 && currentState.current !== ANIM_STATES.GESTURING) {
      // Loud speech → gesturing
      transitionTo(ANIM_STATES.GESTURING, 0.4);
    } else if (isSpeaking && currentState.current !== ANIM_STATES.TALKING && currentState.current !== ANIM_STATES.GESTURING) {
      transitionTo(ANIM_STATES.TALKING, 0.3);
    } else if (!isSpeaking && !isProcessing && currentState.current !== ANIM_STATES.IDLE && currentState.current !== ANIM_STATES.GREETING) {
      // Return to idle when not speaking
      if (currentState.current === ANIM_STATES.TALKING || currentState.current === ANIM_STATES.GESTURING) {
        transitionTo(ANIM_STATES.IDLE, 0.5);
      } else if (stateTimer.current > 1) {
        transitionTo(ANIM_STATES.IDLE, 0.5);
      }
    }

    // Drop back from gesturing to talking if audio level drops
    if (currentState.current === ANIM_STATES.GESTURING && isSpeaking && audioLevel.current < 0.15 && stateTimer.current > 1) {
      transitionTo(ANIM_STATES.TALKING, 0.4);
    }

    // Micro-movements (always present — breathing, subtle sway)
    if (group.current) {
      const breathe = Math.sin(time * 0.8) * 0.005;
      const sway = Math.sin(time * 0.3) * 0.003;
      group.current.position.y = -1 + breathe;
      group.current.position.x = sway;
    }

    // === MORPH TARGET ANIMATIONS (lip sync, blinking, expressions) ===
    if (!headMesh.current?.morphTargetInfluences) return;

    const influences = headMesh.current.morphTargetInfluences;
    const dictionary = headMesh.current.morphTargetDictionary;

    // Blinking
    blinkTimer.current += delta;
    if (blinkTimer.current >= nextBlink.current) {
      const blinkValue = Math.sin((blinkTimer.current - nextBlink.current) * 30) ** 2;
      if (dictionary.eyeBlinkLeft !== undefined) influences[dictionary.eyeBlinkLeft] = blinkValue;
      if (dictionary.eyeBlinkRight !== undefined) influences[dictionary.eyeBlinkRight] = blinkValue;
      if (blinkTimer.current >= nextBlink.current + 0.2) {
        blinkTimer.current = 0;
        nextBlink.current = 2 + Math.random() * 3;
      }
    } else {
      if (dictionary.eyeBlinkLeft !== undefined) influences[dictionary.eyeBlinkLeft] *= 0.9;
      if (dictionary.eyeBlinkRight !== undefined) influences[dictionary.eyeBlinkRight] *= 0.9;
    }

    // Text-based lip sync
    if (isSpeaking && audioData && audioData.length > 0) {
      if (phonemes.length > 0 && phonemeIndex.current < phonemes.length) {
        const phonemeSpeed = audioLevel.current > 0.03 ? 0.04 : 0.01;
        phonemeTimer.current += delta;

        if (phonemeTimer.current >= phonemeSpeed) {
          phonemeIndex.current++;
          phonemeTimer.current = 0;
        }

        const currentPhoneme = phonemes[phonemeIndex.current];
        if (currentPhoneme && audioLevel.current > 0.03) {
          const intensity = Math.min(audioLevel.current * 1.5, 1) * currentPhoneme.intensity;

          if (currentPhoneme.primary && dictionary[currentPhoneme.primary] !== undefined) {
            const targetValue = intensity;
            influences[dictionary[currentPhoneme.primary]] +=
              (targetValue - influences[dictionary[currentPhoneme.primary]]) * 0.6;
          }
          if (currentPhoneme.secondary && dictionary[currentPhoneme.secondary] !== undefined) {
            const targetValue = intensity * 0.7;
            influences[dictionary[currentPhoneme.secondary]] +=
              (targetValue - influences[dictionary[currentPhoneme.secondary]]) * 0.6;
          }

          // Eyebrow raise on emphasis
          if (audioLevel.current > 0.6 && dictionary.browInnerUp !== undefined) {
            influences[dictionary.browInnerUp] += ((audioLevel.current - 0.6) * 0.4 - influences[dictionary.browInnerUp]) * 0.3;
          }

          // Subtle smile
          if (dictionary.mouthSmileLeft !== undefined) {
            influences[dictionary.mouthSmileLeft] += (intensity * 0.12 - influences[dictionary.mouthSmileLeft]) * 0.3;
          }
          if (dictionary.mouthSmileRight !== undefined) {
            influences[dictionary.mouthSmileRight] += (intensity * 0.12 - influences[dictionary.mouthSmileRight]) * 0.3;
          }
        }
      }

      // Audio-only fallback lip sync
      if (audioLevel.current > 0.03 && (phonemes.length === 0 || phonemeIndex.current >= phonemes.length)) {
        const intensity = Math.min(audioLevel.current * 2.0, 1);
        if (dictionary.jawOpen !== undefined) {
          influences[dictionary.jawOpen] += (intensity * 0.6 - influences[dictionary.jawOpen]) * 0.5;
        }
        const cyclePhase = (Math.sin(time * 8) + 1) / 2;
        if (intensity > 0.5 && dictionary.mouthFunnel !== undefined) {
          influences[dictionary.mouthFunnel] += (intensity * cyclePhase * 0.4 - influences[dictionary.mouthFunnel]) * 0.6;
        }
      }

      // Fade when quiet
      if (audioLevel.current <= 0.03) {
        const fadeKeys = ['jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthStretchLeft', 'mouthStretchRight', 'mouthSmileLeft', 'mouthSmileRight'];
        fadeKeys.forEach(key => {
          if (dictionary[key] !== undefined) influences[dictionary[key]] *= 0.85;
        });
      }
    } else {
      // Not speaking: reset mouth morphs
      audioLevel.current *= 0.85;
      const resetKeys = ['jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthStretchLeft', 'mouthStretchRight', 'mouthSmileLeft', 'mouthSmileRight', 'browInnerUp'];
      resetKeys.forEach(key => {
        if (dictionary[key] !== undefined) influences[dictionary[key]] *= 0.8;
      });

      if (phonemes.length > 0) {
        setPhonemes([]);
        phonemeIndex.current = 0;
        phonemeTimer.current = 0;
        lastSpeakingText.current = '';
      }
    }

    // Expression-based morphs
    if (expression === 'listening') {
      if (dictionary.mouthSmileLeft !== undefined) {
        influences[dictionary.mouthSmileLeft] += (0.15 - influences[dictionary.mouthSmileLeft]) * 0.05;
      }
      if (dictionary.mouthSmileRight !== undefined) {
        influences[dictionary.mouthSmileRight] += (0.15 - influences[dictionary.mouthSmileRight]) * 0.05;
      }
    }
  });

  if (!scene) return null;

  return (
    <group ref={group} scale={scale} position={[0, -1, 0]}>
      <primitive object={scene} />
    </group>
  );
}

export default FullBodyAvatar;
