import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { DeviceLocationMonitor, type DeviceGeolocation } from './locationMonitor';
import { DeviceLocationConsent } from './DeviceLocationConsent';
import { DeviceLocationContext, type DeviceLocationContextValue } from './deviceLocationContext';

function browserGeolocation(): DeviceGeolocation | undefined {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
  const geo = navigator.geolocation;
  return {
    getCurrentPosition: (success, error, options) => geo.getCurrentPosition(success, error, options),
    watchPosition: (success, error, options) => geo.watchPosition(success, error, options),
    clearWatch: id => geo.clearWatch(id),
  };
}

export function DeviceLocationProvider({ accountId, active, allowPrompt, children }: {
  accountId: string;
  active: boolean;
  allowPrompt: boolean;
  children: ReactNode;
}) {
  const monitorRef = useRef<DeviceLocationMonitor | undefined>(undefined);
  if (!monitorRef.current) monitorRef.current = new DeviceLocationMonitor(accountId, {
    geolocation: browserGeolocation(),
    secure: typeof window !== 'undefined' && window.isSecureContext,
  });
  const monitor = monitorRef.current;
  const snapshot = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getSnapshot);

  useEffect(() => {
    const visibility = () => monitor.setVisible(!document.hidden);
    monitor.setActive(active);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      // StrictMode replays this cleanup; the same monitor can start again on the next setup.
      monitor.setActive(false);
      monitor.setVisible(false);
    };
  }, [monitor, active]);

  const value = useMemo<DeviceLocationContextValue>(() => ({
    ...snapshot,
    consentOpen: allowPrompt && snapshot.supported && !snapshot.prompted,
    enable: monitor.enable,
    disable: monitor.disable,
    decline: monitor.decline,
  }), [snapshot, allowPrompt, monitor]);
  return <DeviceLocationContext.Provider value={value}>{children}<DeviceLocationConsent /></DeviceLocationContext.Provider>;
}
