import { CircleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DeviceLocationStatus } from '../domain/deviceLocation';
import { useDeviceLocation } from './deviceLocationContext';
import { deviceLocationFailed, deviceLocationStatusText } from './deviceLocationStatus';

/** The same monitor also speaks where the person is working, not only inside settings. */
export function DeviceLocationNotice() {
  const location = useDeviceLocation();
  const [dismissed, setDismissed] = useState<DeviceLocationStatus>();
  const failed = deviceLocationFailed(location);
  useEffect(() => { if (!failed) setDismissed(undefined); }, [failed]);
  if (!failed || dismissed === location.status) return null;
  return <div className="map-notice device-location-notice" role="alert">
    <CircleAlert size={20} aria-hidden="true" />
    <span className="device-location-notice__text"><strong>定位未能使用</strong><span>{deviceLocationStatusText(location)}</span></span>
    <button type="button" aria-label="關閉定位錯誤提示" onClick={() => setDismissed(location.status)}><X size={17} aria-hidden="true" /></button>
  </div>;
}
