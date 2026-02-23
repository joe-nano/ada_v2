import { createContext } from 'react';

export const SpatialContext = createContext({
  disableCamera: () => {},
  enableCamera: () => {},
});
