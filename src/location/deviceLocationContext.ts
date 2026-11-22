import { createContext, useContext } from 'react';
import type { DeviceLocationSnapshot } from './locationMonitor';

export interface DeviceLocationContextValue extends DeviceLocationSnapshot {
  consentOpen: boolean;
  enable: () => void;
  disable: () => void;
  decline: () => void;
}

/** A safe, inert fallback for isolated server rendering; the authenticated app always supplies a monitor. */
const fallback: DeviceLocationContextValue = {
  supported: false, prompted: false, enabled: false, status: 'unsupported', preferencePersistent: false,
  consentOpen: false, enable: () => undefined, disable: () => undefined, decline: () => undefined,
};
export const DeviceLocationContext = createContext<DeviceLocationContextValue>(fallback);
export const DeviceLocationContextProvider = DeviceLocationContext.Provider;
export const useDeviceLocation = () => useContext(DeviceLocationContext);
