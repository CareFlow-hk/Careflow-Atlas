import type { ExpressionSpecification } from 'maplibre-gl';
import type { MapBuilding } from './mapModel';
import { easeInOutCubic } from '../app/motion';

// Separate enter/exit thresholds prevent flicker; they never represent a height range.
export const CUTAWAY_ZOOM = { off: 16.8, on: 17.1 };
export const CUTAWAY_DURATION = 420;

export function cutawayEnabled(zoom: number, pitch: number, wasEnabled = false): boolean {
  return wasEnabled ? zoom > CUTAWAY_ZOOM.off && pitch > 28 : zoom >= CUTAWAY_ZOOM.on && pitch >= 34;
}

/** Keep geometry in a stable coordinate frame; move the corridor with the view. */
export function focusCameraState(focus: Pick<MapBuilding, 'latitude' | 'longitude'>,
  center: { lng: number; lat: number }, bearing: number) {
  return {
    bearing,
    east: (center.lng - focus.longitude) * 111320 * Math.cos(focus.latitude * Math.PI / 180),
    north: (center.lat - focus.latitude) * 111320,
  };
}

/**
 * Compass direction of the line of sight from the camera's ground position to a point.
 * When the focused building is offset from the screen centre, this differs from the
 * map bearing by enough to move the corridor off the building.
 */
/** Ground position below the camera: `distance` metres from the centre, back along the bearing. */
export function cameraGroundPoint(center: { lng: number; lat: number }, bearing: number, pitch: number, distance: number) {
  const back = distance * Math.sin(pitch * Math.PI / 180), angle = bearing * Math.PI / 180;
  return {
    lng: center.lng - back * Math.sin(angle) / (111320 * Math.cos(center.lat * Math.PI / 180)),
    lat: center.lat - back * Math.cos(angle) / 111320,
  };
}

export function sightBearing(eye: { lng: number; lat: number }, target: { lng: number; lat: number }): number {
  const east = (target.lng - eye.lng) * Math.cos(target.lat * Math.PI / 180);
  const north = target.lat - eye.lat;
  return Math.atan2(east, north) * 180 / Math.PI;
}

export function shouldLowerBuilding(position: { east: number; north: number; radius: number },
  camera: ReturnType<typeof focusCameraState>, enabled: boolean, wasLowered = false): boolean {
  if (!enabled) return false;
  const angle = camera.bearing * Math.PI / 180;
  const east = position.east - camera.east, north = position.north - camera.north;
  const side = east * Math.cos(angle) - north * Math.sin(angle);
  const front = -(east * Math.sin(angle) + north * Math.cos(angle));
  const margin = wasLowered ? 5 : 0;
  return front + position.radius > -margin && Math.abs(side) < 38 + position.radius + margin;
}

/** Time-based transition: camera changes cannot hold a building at partial height. */
export class CutawayTransition {
  target: 0 | 1 = 0;
  private from = 0;
  private started = 0;
  private duration = 0;

  value(now: number): number {
    const t = this.duration === 0 ? 1 : Math.min(1, Math.max(0, (now - this.started) / this.duration));
    return this.from + (this.target - this.from) * easeInOutCubic(t);
  }

  set(lowered: boolean, now: number, duration: number): void {
    const target = lowered ? 1 : 0;
    if (target === this.target) return;
    this.from = this.value(now);
    this.target = target;
    this.started = now;
    this.duration = duration;
  }

  running(now: number): boolean {
    return now < this.started + this.duration && this.from !== this.target;
  }
}

/** Position/bounds used to open a viewing corridor through foreground context. */
export function contextPosition(ring: number[][], focus: MapBuilding) {
  const metresX = 111320 * Math.cos(focus.latitude * Math.PI / 180);
  const xs = ring.map(point => (point[0] - focus.longitude) * metresX);
  const ys = ring.map(point => (point[1] - focus.latitude) * 111320);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { east: (minX + maxX) / 2, north: (minY + maxY) / 2, radius: Math.hypot(maxX - minX, maxY - minY) / 2 };
}

/** Only the one-shot animation can have intermediate values; resting states are 0/1. */
export const focusHeight: ExpressionSpecification = ['let',
  'cut', ['number', ['feature-state', 'cutaway'], 0],
  ['+', ['*', ['get', 'height'], ['-', 1, ['var', 'cut']]], ['*', ['min', 2, ['get', 'height']], ['var', 'cut']]],
];
