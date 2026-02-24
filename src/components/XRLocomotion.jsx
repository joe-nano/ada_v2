import { useRef, useCallback } from 'react';
import { XROrigin, useXRControllerLocomotion, TeleportTarget } from '@react-three/xr';
import AvatarSwitch from './AvatarSwitch';

/**
 * XRLocomotion — VR navigation with smooth locomotion + teleportation.
 *
 * Wraps <XROrigin> in a movable group. useXRControllerLocomotion drives
 * left-thumbstick translation + right-thumbstick rotation. TeleportTarget
 * provides point-and-teleport on an invisible floor plane.
 *
 * Perspective:
 *   - first-person: avatar hidden, user IS the avatar
 *   - third-person: avatar visible at [0, 0, -2] in front of user
 */
export default function XRLocomotion({
  children,
  avatarMode,
  avatarPropsRef,
  perspective = 'first',
  locomotionMode = 'smooth',
}) {
  const originRef = useRef(null);

  // Smooth locomotion: left stick = translate, right stick = rotate
  useXRControllerLocomotion(
    originRef,
    locomotionMode === 'smooth' ? { speed: 2.5 } : false,
    { type: 'smooth', speed: 1.5, deadZone: 0.3 },
    'left',
  );

  // Teleport: set XROrigin group position on teleport hit
  const handleTeleport = useCallback((point) => {
    if (!originRef.current) return;
    originRef.current.position.set(point.x, 0, point.z);
  }, []);

  return (
    <group ref={originRef}>
      <XROrigin />

      {/* Avatar — visible in third-person, hidden in first-person */}
      {perspective === 'third' && (
        <group position={[0, 0, -2.0]}>
          <AvatarSwitch
            mode={avatarMode}
            audioDataRef={avatarPropsRef.audioDataRef}
            isSpeakingRef={avatarPropsRef.isSpeakingRef}
            speakingTextRef={avatarPropsRef.speakingTextRef}
            rpmAvatarUrl={avatarPropsRef.rpmAvatarUrl}
          />
        </group>
      )}

      {/* Teleport floor target — invisible plane always available */}
      <TeleportTarget onTeleport={handleTeleport}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </TeleportTarget>

      {children}
    </group>
  );
}
