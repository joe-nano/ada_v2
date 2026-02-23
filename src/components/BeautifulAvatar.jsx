import React, { useRef, useEffect, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

/**
 * BeautifulAvatar - High-quality 3D avatar with animations and lip sync
 */

// 🔥 TEXT-TO-ARKIT PHONEME MAPPING
// Maps text patterns to ARKit blend shapes for realistic lip sync
const textToPhonemeMapping = {
  // Vowels
  'a': { primary: 'jawOpen', secondary: 'mouthOpen', intensity: 0.6 },
  'e': { primary: 'mouthStretchLeft', secondary: 'mouthStretchRight', intensity: 0.5 },
  'i': { primary: 'mouthStretchLeft', secondary: 'mouthStretchRight', intensity: 0.7 },
  'o': { primary: 'mouthFunnel', secondary: 'jawOpen', intensity: 0.5 },
  'u': { primary: 'mouthPucker', secondary: null, intensity: 0.6 },

  // Consonants
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

// Helper: Extract phonemes from text (simplified)
function textToPhonemes(text) {
  if (!text) return [];

  const phonemes = [];
  const words = text.toLowerCase().split(/\s+/);

  for (const word of words) {
    let i = 0;
    while (i < word.length) {
      // Check for digraphs (two-letter combinations)
      if (i < word.length - 1) {
        const digraph = word.substring(i, i + 2);
        if (textToPhonemeMapping[digraph]) {
          phonemes.push(textToPhonemeMapping[digraph]);
          i += 2;
          continue;
        }
      }

      // Single character
      const char = word[i];
      if (textToPhonemeMapping[char]) {
        phonemes.push(textToPhonemeMapping[char]);
      } else {
        // Default: slight jaw open for unknown characters
        phonemes.push({ primary: 'jawOpen', secondary: null, intensity: 0.2 });
      }
      i++;
    }

    // Add a small pause between words
    phonemes.push({ primary: 'mouthClose', secondary: null, intensity: 0.1 });
  }

  return phonemes;
}

export function BeautifulAvatar({
  modelUrl = '/models/joda-avatar.glb',
  audioData = [],
  lipsyncData = null,
  expression = 'neutral',
  isSpeaking = false,
  scale = 1,
  speakingText = '' // 🔥 NEW: Text being spoken for text-based lip sync
}) {
  const group = useRef();
  const headMesh = useRef(null);
  const blinkTimer = useRef(0);
  const nextBlink = useRef(3);
  const audioLevel = useRef(0);
  const gestureTimer = useRef(0);
  const bones = useRef({});

  // 🔥 TEXT-BASED LIP SYNC STATE
  const [phonemes, setPhonemes] = useState([]);
  const phonemeIndex = useRef(0);
  const phonemeTimer = useRef(0);
  const lastSpeakingText = useRef('');

  // Load the avatar model
  console.log('[AVATAR] Loading model:', modelUrl);
  const gltfData = useGLTF(modelUrl);
  const { scene, nodes, animations } = gltfData;
  console.log('[AVATAR] Model loaded, scene:', !!scene, 'nodes:', !!nodes);
  console.log('[AVATAR] GLTF data keys:', Object.keys(gltfData));
  console.log('[AVATAR] Animations available:', animations?.length || 0);

  // IMMEDIATE LOGGING AND ARM FIXING - Don't wait for useEffect
  if (nodes) {
    const nodeKeys = Object.keys(nodes);
    console.log('[AVATAR] 🔥 IMMEDIATE - Total nodes:', nodeKeys.length);
    console.log('[AVATAR] 🔥 IMMEDIATE - Node names:', nodeKeys);

    // Find arm bones immediately
    const armBones = nodeKeys.filter(name => /arm|shoulder|hand|elbow/i.test(name));
    console.log('[AVATAR] 🔥 IMMEDIATE - Arm-related bones:', armBones);

    // Check for morph targets
    const morphNodes = nodeKeys.filter(name =>
      nodes[name]?.morphTargetDictionary && Object.keys(nodes[name].morphTargetDictionary).length > 0
    );
    console.log('[AVATAR] 🔥 IMMEDIATE - Nodes with morphs:', morphNodes);

    // ARM ROTATION DISABLED - Accepting T-pose for now, focusing on lip sync
    // TODO: Will fix with proper animation system or TaoAvatar later
    console.log('[AVATAR] 🔥 Arm rotation disabled - focusing on lip sync first');

    // Set head mesh for lip sync
    if (nodes['Wolf3D_Avatar'] && nodes['Wolf3D_Avatar'].morphTargetDictionary) {
      headMesh.current = nodes['Wolf3D_Avatar'];
      const allMorphs = Object.keys(nodes['Wolf3D_Avatar'].morphTargetDictionary);
      console.log('[AVATAR] 🔥 HEAD MESH SET:', 'Wolf3D_Avatar');
      console.log('[AVATAR] 🔥 Total morph targets:', allMorphs.length);
      console.log('[AVATAR] 🔥 ALL MORPHS:', allMorphs);

      // Find mouth/jaw related morphs specifically
      const mouthMorphs = allMorphs.filter(m =>
        /mouth|jaw|lip|viseme/i.test(m)
      );
      console.log('[AVATAR] 🔥 MOUTH/JAW MORPHS:', mouthMorphs);
    }
  }

  if (animations && animations.length > 0) {
    console.log('[AVATAR] Animation names:', animations.map(a => a.name));
  }

  // If nodes is undefined, try to traverse the scene
  if (!nodes && scene) {
    console.warn('[AVATAR] nodes is undefined, will traverse scene instead');
  }

  // Find head mesh with morph targets and bones for gestures
  useEffect(() => {
    console.log('[AVATAR] ===== useEffect TRIGGERED =====');
    console.log('[AVATAR] useEffect - finding head mesh and bones, nodes:', !!nodes, 'scene:', !!scene);
    console.log('[AVATAR] nodes type:', typeof nodes, 'scene type:', typeof scene);

    // Build a comprehensive node map by traversing the scene
    const allNodes = {};
    if (scene) {
      scene.traverse((object) => {
        if (object.name) {
          allNodes[object.name] = object;
        }

        // 🔥 HIDE ARMS - Make arm meshes invisible
        if (object.isMesh && object.name) {
          const name = object.name.toLowerCase();
          if (name.includes('arm') || name.includes('hand') || name.includes('shoulder') || name.includes('elbow')) {
            object.visible = false;
            console.log('[AVATAR] 🔥 HIDING ARM PART:', object.name);
          }
        }
      });
      console.log('[AVATAR] Traversed scene, found objects:', Object.keys(allNodes).length);
    }

    // Use nodes from useGLTF if available, otherwise use traversed nodes
    const nodesToUse = (nodes && Object.keys(nodes).length > 0) ? nodes : allNodes;

    if (nodesToUse && Object.keys(nodesToUse).length > 0) {
      // MORE EXPLICIT LOGGING - Force it to show
      const nodeKeys = Object.keys(nodesToUse);
      console.log('[AVATAR] ===== NODE DETECTION START =====');
      console.log('[AVATAR] Total nodes found:', nodeKeys.length);
      console.log('[AVATAR] All node names:', nodeKeys);

      // Log each node individually with its properties
      nodeKeys.forEach(name => {
        const node = nodesToUse[name];
        const hasMorphs = node?.morphTargetDictionary ? Object.keys(node.morphTargetDictionary).length : 0;
        if (hasMorphs > 0) {
          console.log(`[AVATAR] NODE "${name}":`, {
            type: node.type,
            morphCount: hasMorphs,
            morphs: Object.keys(node.morphTargetDictionary)
          });
        }
      });

      // Log which nodes have morph targets
      const nodesWithMorphs = nodeKeys.filter(name =>
        nodesToUse[name]?.morphTargetDictionary && Object.keys(nodesToUse[name].morphTargetDictionary).length > 0
      );
      console.log('[AVATAR] Nodes with morph targets:', nodesWithMorphs);
      console.log('[AVATAR] ===== NODE DETECTION END =====');

      // Find head mesh with morph targets - try common names and fallback to any mesh with morphs
      const headNames = ['Wolf3D_Head', 'Head', 'head', 'EyeLeft', 'EyeRight', 'Wolf3D_Teeth', 'Face', 'face'];

      for (const name of headNames) {
        if (nodesToUse[name]?.morphTargetDictionary && Object.keys(nodesToUse[name].morphTargetDictionary).length > 0) {
          headMesh.current = nodesToUse[name];
          console.log('[AVATAR] ✅ Found head:', name, 'Morphs:', Object.keys(nodesToUse[name].morphTargetDictionary));
          break;
        }
      }

      // Fallback: use the first node with morph targets
      if (!headMesh.current && nodesWithMorphs.length > 0) {
        const fallbackName = nodesWithMorphs[0];
        headMesh.current = nodesToUse[fallbackName];
        console.log('[AVATAR] ✅ Using fallback mesh:', fallbackName, 'Morphs:', Object.keys(nodesToUse[fallbackName].morphTargetDictionary));
      }

      if (!headMesh.current) {
        console.warn('[AVATAR] ⚠️ No head mesh with morph targets found - animations will be limited to body movements only');
      }

      // Find bones for gestures - search for ALL possible arm bone names
      const boneNames = [
        'LeftArm', 'RightArm',
        'LeftForeArm', 'RightForeArm',
        'LeftHand', 'RightHand',
        'LeftShoulder', 'RightShoulder',
        'LeftUpperArm', 'RightUpperArm',
        'Spine', 'Spine1', 'Spine2',
        'Hips'
      ];

      boneNames.forEach(boneName => {
        if (nodesToUse[boneName]) {
          bones.current[boneName] = nodesToUse[boneName];
          console.log('[AVATAR] ✅ Found bone:', boneName);
        }
      });

      // ALSO search for bones with "arm" or "shoulder" in the name (case insensitive)
      const allBoneNames = Object.keys(nodesToUse);
      const armRelatedBones = allBoneNames.filter(name =>
        /arm|shoulder|hand|elbow/i.test(name)
      );
      console.log('[AVATAR] All arm-related bones found:', armRelatedBones);

      // SET INITIAL ARM REST POSITIONS - bring arms down from T-pose to natural sides
      // Try multiple rotation approaches to find what works
      if (bones.current.LeftArm) {
        // Log current rotation before changing
        console.log('[AVATAR] LeftArm ORIGINAL rotation:', {
          x: bones.current.LeftArm.rotation.x,
          y: bones.current.LeftArm.rotation.y,
          z: bones.current.LeftArm.rotation.z
        });

        // AGGRESSIVE FIX: Try ALL axes with different values
        // For T-pose to natural, typically need Z-axis rotation
        bones.current.LeftArm.rotation.x = 0;      // Forward/back swing
        bones.current.LeftArm.rotation.y = 0.2;    // Slight rotation forward
        bones.current.LeftArm.rotation.z = 0.5;    // Main rotation to bring arm down

        console.log('[AVATAR] ✅ Set LeftArm rest position (x=0, y=0.2, z=0.5)');
      }
      if (bones.current.RightArm) {
        // Log current rotation before changing
        console.log('[AVATAR] RightArm ORIGINAL rotation:', {
          x: bones.current.RightArm.rotation.x,
          y: bones.current.RightArm.rotation.y,
          z: bones.current.RightArm.rotation.z
        });

        // Mirror the left arm rotation
        bones.current.RightArm.rotation.x = 0;       // Forward/back swing
        bones.current.RightArm.rotation.y = -0.2;    // Slight rotation forward (opposite)
        bones.current.RightArm.rotation.z = -0.5;    // Main rotation to bring arm down (opposite)

        console.log('[AVATAR] ✅ Set RightArm rest position (x=0, y=-0.2, z=-0.5)');
      }

      // ALSO try LeftShoulder/RightShoulder bones if they exist
      const shoulderBones = ['LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg'];
      shoulderBones.forEach(boneName => {
        if (nodesToUse[boneName]) {
          bones.current[boneName] = nodesToUse[boneName];
          console.log(`[AVATAR] ✅ Found bone: ${boneName}`);
        }
      });

      // Set forearms to natural bend
      if (bones.current.LeftForeArm) {
        bones.current.LeftForeArm.rotation.x = -0.3; // Slight bend at elbow
        console.log('[AVATAR] ✅ Set LeftForeArm rest position');
      }
      if (bones.current.RightForeArm) {
        bones.current.RightForeArm.rotation.x = -0.3; // Slight bend at elbow
        console.log('[AVATAR] ✅ Set RightForeArm rest position');
      }
    } else {
      console.error('[AVATAR] ❌ No nodes found at all - neither from useGLTF nor from scene traversal');
    }
  }, [nodes, scene]);

  // 🔥 TEXT-TO-PHONEME PROCESSING
  // Convert incoming text to phonemes for lip sync
  useEffect(() => {
    if (speakingText && speakingText !== lastSpeakingText.current) {
      console.log('[TEXT LIP SYNC] 🔥 New text received:', speakingText.substring(0, 100) + '...');
      const newPhonemes = textToPhonemes(speakingText);
      console.log('[TEXT LIP SYNC] 🔥 Generated phonemes:', newPhonemes.length, 'from', speakingText.length, 'characters');

      // Append new phonemes to existing queue
      setPhonemes(prev => [...prev, ...newPhonemes]);
      lastSpeakingText.current = speakingText;
    }
  }, [speakingText]);

  // Debug logging on mount/prop changes
  useEffect(() => {
    console.log('[AVATAR PROPS]', {
      isSpeaking,
      hasAudioData: audioData?.length > 0,
      audioDataSample: audioData?.slice(0, 5),
      expression,
      modelUrl,
      speakingText: speakingText?.substring(0, 50) + '...' // Log first 50 chars
    });
  }, [isSpeaking, audioData, expression, modelUrl, speakingText]);

  // Animation loop
  useFrame((state, delta) => {
    if (!group.current) return;

    const time = state.clock.elapsedTime;

    // === ENHANCED IDLE & SPEAKING ANIMATIONS ===

    // ALWAYS animate breathing to verify animations work
    const breathingIntensity = isSpeaking ? 0.05 : 0.03;
    const breathingSpeed = isSpeaking ? 1.2 : 0.8;
    group.current.position.y = -1 + Math.sin(time * breathingSpeed) * breathingIntensity;

    // DEBUG: Force visible head rotation to test if animations work
    const testRotation = Math.sin(time * 0.5) * 0.1; // Obvious movement for testing
    group.current.rotation.y = testRotation;

    if (isSpeaking) {
      // SPEAKING ANIMATIONS - More dynamic and expressive

      // Head movements while speaking (subtle nods and tilts)
      group.current.rotation.x = Math.sin(time * 1.5) * 0.08; // Nod up/down
      group.current.rotation.y = Math.sin(time * 0.9) * 0.12; // Turn left/right
      group.current.rotation.z = Math.sin(time * 1.1) * 0.04; // Tilt

      // Add micro-movements for realism
      group.current.position.x = Math.sin(time * 2.3) * 0.02;
      group.current.position.z = Math.sin(time * 1.7) * 0.01;

      // Slight torso sway when speaking (if the group has children with bones)
      if (scene) {
        scene.rotation.y = Math.sin(time * 0.7) * 0.05;
      }
    } else {
      // IDLE ANIMATIONS - Gentle, subtle movements

      // Gentle head sway
      group.current.rotation.x = Math.sin(time * 0.4) * 0.02;
      group.current.rotation.y = Math.sin(time * 0.3) * 0.03;
      group.current.rotation.z = Math.sin(time * 0.5) * 0.01;

      // Occasional head turn (every 5-8 seconds)
      const headTurnCycle = (time % 12) / 12;
      if (headTurnCycle > 0.3 && headTurnCycle < 0.4) {
        group.current.rotation.y += Math.sin((headTurnCycle - 0.3) * Math.PI * 10) * 0.15;
      }

      // Reset position
      group.current.position.x = 0;
      group.current.position.z = 0;
      if (scene) {
        scene.rotation.y = 0;
      }
    }

    // === MORPH TARGET ANIMATIONS ===
    if (!headMesh.current?.morphTargetInfluences) {
      // Log once per second if morphs not found
      if (Math.floor(time) !== Math.floor(time - delta)) {
        console.warn('[AVATAR] No morph targets found on head mesh');
      }
      return;
    }

    const influences = headMesh.current.morphTargetInfluences;
    const dictionary = headMesh.current.morphTargetDictionary;

    // Debug log morph targets once
    if (time < 1 && time > 0.5) {
      console.log('[AVATAR] Available morph targets:', Object.keys(dictionary));
      console.log('[AVATAR] Bones found:', Object.keys(bones.current));
    }

    // Blinking
    blinkTimer.current += delta;
    if (blinkTimer.current >= nextBlink.current) {
      const blinkValue = Math.sin((blinkTimer.current - nextBlink.current) * 30) ** 2;

      if (dictionary.eyeBlinkLeft !== undefined) {
        influences[dictionary.eyeBlinkLeft] = blinkValue;
      }
      if (dictionary.eyeBlinkRight !== undefined) {
        influences[dictionary.eyeBlinkRight] = blinkValue;
      }

      if (blinkTimer.current >= nextBlink.current + 0.2) {
        blinkTimer.current = 0;
        nextBlink.current = 2 + Math.random() * 3;
      }
    } else {
      if (dictionary.eyeBlinkLeft !== undefined) {
        influences[dictionary.eyeBlinkLeft] *= 0.9;
      }
      if (dictionary.eyeBlinkRight !== undefined) {
        influences[dictionary.eyeBlinkRight] *= 0.9;
      }
    }

    // 🔥 TEXT-BASED LIP SYNC - Using phonemes from text + audio timing
    if (isSpeaking && audioData && audioData.length > 0) {
      // Calculate audio level with smoothing
      const maxAmp = Math.max(...audioData.slice(-10).map(v => Math.abs(v))) / 255;
      audioLevel.current += (maxAmp - audioLevel.current) * 0.4;

      // TEXT-BASED: Use phoneme queue if available
      if (phonemes.length > 0 && phonemeIndex.current < phonemes.length) {
        // Progress through phonemes based on audio level (faster when louder)
        // 🔥 INCREASED SPEED: Faster progression to cover more words
        const phonemeSpeed = audioLevel.current > 0.03 ? 0.04 : 0.01; // 2x faster (was 0.08/0.02)
        phonemeTimer.current += delta;

        if (phonemeTimer.current >= phonemeSpeed) {
          phonemeIndex.current++;
          phonemeTimer.current = 0;

          // Log progress through phonemes
          if (phonemeIndex.current % 10 === 0) {
            console.log('[TEXT LIP SYNC] 🔥 Progress:', phonemeIndex.current, '/', phonemes.length);
          }
        }

        // Get current phoneme
        const currentPhoneme = phonemes[phonemeIndex.current];
        if (currentPhoneme && audioLevel.current > 0.03) {
          const intensity = Math.min(audioLevel.current * 1.5, 1) * currentPhoneme.intensity;

          // Apply primary morph target
          if (currentPhoneme.primary && dictionary[currentPhoneme.primary] !== undefined) {
            const targetValue = intensity;
            influences[dictionary[currentPhoneme.primary]] +=
              (targetValue - influences[dictionary[currentPhoneme.primary]]) * 0.6;
          }

          // Apply secondary morph target
          if (currentPhoneme.secondary && dictionary[currentPhoneme.secondary] !== undefined) {
            const targetValue = intensity * 0.7;
            influences[dictionary[currentPhoneme.secondary]] +=
              (targetValue - influences[dictionary[currentPhoneme.secondary]]) * 0.6;
          }

          // Add slight smile for expressiveness
          if (dictionary.mouthSmileLeft !== undefined && dictionary.mouthSmileRight !== undefined) {
            const smileTarget = intensity * 0.12;
            influences[dictionary.mouthSmileLeft] += (smileTarget - influences[dictionary.mouthSmileLeft]) * 0.3;
            influences[dictionary.mouthSmileRight] += (smileTarget - influences[dictionary.mouthSmileRight]) * 0.3;
          }

          // Raise eyebrows when speaking loudly
          if (audioLevel.current > 0.6 && dictionary.browInnerUp !== undefined) {
            influences[dictionary.browInnerUp] += ((audioLevel.current - 0.6) * 0.4 - influences[dictionary.browInnerUp]) * 0.3;
          }
        }

        // Clean up finished phonemes - but keep fallback active
        if (phonemeIndex.current >= phonemes.length) {
          console.log('[TEXT LIP SYNC] 🔥 Finished phoneme sequence, falling back to audio-only');
          // Don't clear immediately - let audio-based lip sync take over smoothly
          // This prevents mouth from closing while still speaking
        }

      }

      // FALLBACK: Audio-only lip sync when no text available OR phonemes finished
      // This ensures continuous lip sync even if text/phonemes run out
      if (audioLevel.current > 0.03 && (phonemes.length === 0 || phonemeIndex.current >= phonemes.length)) {
          const intensity = Math.min(audioLevel.current * 2.0, 1);

          // Primary: Jaw open based on audio intensity
          if (dictionary.jawOpen !== undefined) {
            const jawTarget = intensity * 0.6;
            influences[dictionary.jawOpen] += (jawTarget - influences[dictionary.jawOpen]) * 0.5;
          }

          // Secondary: Cycle through mouth shapes for variety
          const cycleSpeed = time * 8;
          const cyclePhase = (Math.sin(cycleSpeed) + 1) / 2;

          if (intensity > 0.5) {
            if (dictionary.mouthFunnel !== undefined) {
              const funnelTarget = intensity * cyclePhase * 0.4;
              influences[dictionary.mouthFunnel] += (funnelTarget - influences[dictionary.mouthFunnel]) * 0.6;
            }
          } else if (intensity > 0.2) {
            if (dictionary.mouthPucker !== undefined) {
              const puckerTarget = intensity * (1 - cyclePhase) * 0.3;
              influences[dictionary.mouthPucker] += (puckerTarget - influences[dictionary.mouthPucker]) * 0.6;
            }
            if (dictionary.mouthStretchLeft !== undefined && dictionary.mouthStretchRight !== undefined) {
              const stretchTarget = intensity * cyclePhase * 0.2;
              influences[dictionary.mouthStretchLeft] += (stretchTarget - influences[dictionary.mouthStretchLeft]) * 0.6;
              influences[dictionary.mouthStretchRight] += (stretchTarget - influences[dictionary.mouthStretchRight]) * 0.6;
            }
          }
        }

      // Fade out when audio is quiet
      if (audioLevel.current <= 0.03) {
        if (dictionary.jawOpen !== undefined) influences[dictionary.jawOpen] *= 0.85;
        if (dictionary.mouthFunnel !== undefined) influences[dictionary.mouthFunnel] *= 0.85;
        if (dictionary.mouthPucker !== undefined) influences[dictionary.mouthPucker] *= 0.85;
        if (dictionary.mouthStretchLeft !== undefined) influences[dictionary.mouthStretchLeft] *= 0.85;
        if (dictionary.mouthStretchRight !== undefined) influences[dictionary.mouthStretchRight] *= 0.85;
        if (dictionary.mouthSmileLeft !== undefined) influences[dictionary.mouthSmileLeft] *= 0.85;
        if (dictionary.mouthSmileRight !== undefined) influences[dictionary.mouthSmileRight] *= 0.85;
      }
    } else { // NOT SPEAKING
      // NOT SPEAKING: Reset all mouth shapes
      audioLevel.current *= 0.85;

      if (dictionary.jawOpen !== undefined) influences[dictionary.jawOpen] *= 0.8;
      if (dictionary.mouthFunnel !== undefined) influences[dictionary.mouthFunnel] *= 0.8;
      if (dictionary.mouthPucker !== undefined) influences[dictionary.mouthPucker] *= 0.8;
      if (dictionary.mouthStretchLeft !== undefined) influences[dictionary.mouthStretchLeft] *= 0.8;
      if (dictionary.mouthStretchRight !== undefined) influences[dictionary.mouthStretchRight] *= 0.8;
      if (dictionary.mouthSmileLeft !== undefined) influences[dictionary.mouthSmileLeft] *= 0.8;
      if (dictionary.mouthSmileRight !== undefined) influences[dictionary.mouthSmileRight] *= 0.8;
      if (dictionary.browInnerUp !== undefined) influences[dictionary.browInnerUp] *= 0.9;

      // Reset phoneme tracking when not speaking
      if (phonemes.length > 0) {
        console.log('[TEXT LIP SYNC] 🔥 Reset - not speaking anymore');
        setPhonemes([]);
        phonemeIndex.current = 0;
        phonemeTimer.current = 0;
        lastSpeakingText.current = '';
      }
    }

    // === HAND GESTURES when speaking ===
    // DISABLED FOR NOW - keeping arms in natural resting position
    // Will re-enable once base pose is correct
    /*
    if (isSpeaking && audioLevel.current > 0.1) {
      gestureTimer.current += delta;

      // Occasional hand gestures (every 3-5 seconds)
      const gestureCycle = gestureTimer.current % 4;

      if (bones.current.LeftArm && bones.current.RightArm) {
        // REDUCED arm movements - much more subtle to avoid zombie pose
        const gestureIntensity = Math.min(audioLevel.current * 0.5, 0.3);

        // Left arm gesture - MUCH smaller rotations
        bones.current.LeftArm.rotation.z = Math.sin(time * 0.8 + gestureCycle) * 0.03 * gestureIntensity;
        bones.current.LeftArm.rotation.x = Math.sin(time * 0.6) * 0.02 * gestureIntensity;

        // Right arm gesture (slightly out of sync for naturalness) - MUCH smaller rotations
        bones.current.RightArm.rotation.z = -Math.sin(time * 0.7 + gestureCycle + 1) * 0.03 * gestureIntensity;
        bones.current.RightArm.rotation.x = Math.sin(time * 0.5 + 0.5) * 0.02 * gestureIntensity;

        // Forearm movements (if available) - REDUCED
        if (bones.current.LeftForeArm) {
          bones.current.LeftForeArm.rotation.y = Math.sin(time * 1.2) * 0.04 * gestureIntensity;
        }
        if (bones.current.RightForeArm) {
          bones.current.RightForeArm.rotation.y = -Math.sin(time * 1.1) * 0.04 * gestureIntensity;
        }

        // Hand movements (if available) - REDUCED
        if (bones.current.LeftHand) {
          bones.current.LeftHand.rotation.z = Math.sin(time * 1.5) * 0.02 * gestureIntensity;
        }
        if (bones.current.RightHand) {
          bones.current.RightHand.rotation.z = -Math.sin(time * 1.4) * 0.02 * gestureIntensity;
        }
      }

      // Spine movement for body language
      if (bones.current.Spine) {
        bones.current.Spine.rotation.y = Math.sin(time * 0.5) * 0.05;
        bones.current.Spine.rotation.x = Math.sin(time * 0.8) * 0.03;
      }
    } else {
      // Reset arms to neutral position when not speaking
      gestureTimer.current = 0;

      if (bones.current.LeftArm) {
        bones.current.LeftArm.rotation.z *= 0.9;
        bones.current.LeftArm.rotation.x *= 0.9;
      }
      if (bones.current.RightArm) {
        bones.current.RightArm.rotation.z *= 0.9;
        bones.current.RightArm.rotation.x *= 0.9;
      }
      if (bones.current.LeftForeArm) {
        bones.current.LeftForeArm.rotation.y *= 0.9;
      }
      if (bones.current.RightForeArm) {
        bones.current.RightForeArm.rotation.y *= 0.9;
      }
      if (bones.current.LeftHand) {
        bones.current.LeftHand.rotation.z *= 0.9;
      }
      if (bones.current.RightHand) {
        bones.current.RightHand.rotation.z *= 0.9;
      }
      if (bones.current.Spine) {
        bones.current.Spine.rotation.y *= 0.95;
        bones.current.Spine.rotation.x *= 0.95;
      }
    }
    */

    // === EXPRESSIONS ===
    // Subtle smile when listening
    if (expression === 'listening' && dictionary.mouthSmile !== undefined) {
      const target = 0.2;
      influences[dictionary.mouthSmile] += (target - influences[dictionary.mouthSmile]) * 0.05;
    }
  });

  if (!scene) {
    console.error('[AVATAR] Scene is null, cannot render');
    return null;
  }

  console.log('[AVATAR] Rendering avatar');
  return (
    <group ref={group} scale={scale} position={[0, -1, 0]}>
      <primitive object={scene} />
    </group>
  );
}

export default BeautifulAvatar;
