import { createXRStore } from '@react-three/xr';

export const xrStore = createXRStore({
  hand: true,
  controller: true,
  handTracking: true,
  gaze: true,
  foveation: 1,
});
