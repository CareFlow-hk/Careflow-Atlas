/** A device-only position. It never belongs to the outreach snapshot or an account on the server. */
export interface DeviceFix {
  lat: number;
  lng: number;
  accuracy: number;
  observedAt: number;
}

export const DEVICE_LOCATION_MAX_AGE_MS = 5 * 60_000;
export const DEVICE_LOCATION_MAX_ACCURACY_METRES = 500;
export const PROXIMITY_DISTANCE_SCALE_METRES = 300;
export const TEXT_RELEVANCE_WEIGHT = 0.7;
export const PROXIMITY_WEIGHT = 0.3;

export type DeviceLocationStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'timeout' | 'unavailable' | 'unsupported';

const finitePoint = (point: { lat: number; lng: number }) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
  && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

/** Browser coordinates are untrusted input: a missing or malformed fix is not (0, 0). */
export function readDeviceFix(value: {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
}, receivedAt = Date.now()): DeviceFix | undefined {
  const fix = {
    lat: value.coords.latitude,
    lng: value.coords.longitude,
    accuracy: value.coords.accuracy,
    // Safari 26 can report a 2001-epoch timestamp, and other browsers can return a timestamp
    // slightly ahead of the wall clock. Receipt time is our freshness clock; maximumAge still
    // limits the browser's cached fix before this callback arrives.
    observedAt: receivedAt,
  };
  return finitePoint(fix) && Number.isFinite(fix.accuracy) && fix.accuracy > 0 && Number.isFinite(fix.observedAt) ? fix : undefined;
}

/** Only a fresh, building-useful fix may rank places or move the opening camera. */
export function usableDeviceFix(fix: DeviceFix | undefined, now = Date.now()): fix is DeviceFix {
  return Boolean(fix && finitePoint(fix) && Number.isFinite(fix.accuracy) && fix.accuracy > 0
    && fix.accuracy <= DEVICE_LOCATION_MAX_ACCURACY_METRES && Number.isFinite(fix.observedAt)
    && now >= fix.observedAt && now - fix.observedAt <= DEVICE_LOCATION_MAX_AGE_MS);
}

/** Great-circle distance in metres, independent of the map and the browser. */
export function deviceDistanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number | undefined {
  if (!finitePoint(a) || !finitePoint(b)) return undefined;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat), dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat), lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function formatDeviceDistance(distance: number | undefined): string {
  if (distance === undefined || !Number.isFinite(distance) || distance < 0) return '';
  return distance < 1000 ? `直線約 ${Math.round(distance)} 米` : `直線約 ${(distance / 1000).toFixed(1)} 公里`;
}

export interface ProximityPlace {
  id: string;
  lat: number;
  lng: number;
  /** The server's own text-match result, not a front-end guess or an ALS vendor score. */
  relevance?: number;
  /** Filled only in the browser for the current result snapshot. */
  distanceMetres?: number;
}

/**
 * Rank one returned search snapshot. Text stays dominant; distance contributes 30%. If any
 * relevance is missing, or the fix cannot be used, the server's complete order is retained.
 * The input and its objects are never changed, and equal scores retain the server order.
 */
export function rankPlacesByProximity<T extends ProximityPlace>(places: readonly T[], fix: DeviceFix | undefined, now = Date.now()): Array<T & { distanceMetres?: number }> {
  const usable = usableDeviceFix(fix, now);
  if (!usable || places.some(place => place.relevance === undefined || !Number.isFinite(place.relevance)
    || place.relevance < 0 || place.relevance > 1 || !finitePoint(place))) {
    return places.map(place => ({ ...place, distanceMetres: undefined }));
  }
  return places.map((place, index) => {
    const distanceMetres = deviceDistanceMetres(fix, place);
    const proximity = distanceMetres === undefined ? 0 : 1 / (1 + distanceMetres / PROXIMITY_DISTANCE_SCALE_METRES);
    return { place: { ...place, distanceMetres }, score: TEXT_RELEVANCE_WEIGHT * place.relevance! + PROXIMITY_WEIGHT * proximity, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(({ place }) => place);
}
