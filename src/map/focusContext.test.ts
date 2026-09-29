import { describe, expect, it } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { contextPosition, cutawayEnabled, CutawayTransition, CUTAWAY_DURATION, CUTAWAY_ZOOM, focusCameraState, focusHeight, shouldLowerBuilding } from './focusContext';
import { footprintOf, type MapBuilding } from './mapModel';

const parsed = createExpression(focusHeight, 'fill-extrusion-height');
if (parsed.result === 'error') throw new Error(JSON.stringify(parsed.value));
const height = (cutaway: number, height = 120) => parsed.value.evaluate({ zoom: 18 },
  { type: 'Polygon', properties: { height } }, { cutaway });
const camera = { east: 0, north: 0, bearing: 0 };
const foreground = { east: 0, north: -160, radius: 12 };

describe('binary camera-relative foreground cutaway', () => {
  it('opens a foreground corridor through a full rotation and follows panning', () => {
    for (let bearing = -180; bearing <= 180; bearing += 15) {
      const angle = bearing * Math.PI / 180;
      const view = { ...camera, bearing };
      const point = { east: -160 * Math.sin(angle), north: -160 * Math.cos(angle), radius: 12 };
      expect(shouldLowerBuilding(point, view, true)).toBe(true);
      expect(shouldLowerBuilding({ ...point, east: -point.east, north: -point.north }, view, true)).toBe(false);
      const moved = { ...view, east: 150 * Math.cos(angle), north: -150 * Math.sin(angle) };
      expect(shouldLowerBuilding(point, moved, true)).toBe(false);
      expect(shouldLowerBuilding({ ...point, east: point.east + moved.east, north: point.north + moved.north }, moved, true)).toBe(true);
    }
    expect(shouldLowerBuilding(foreground, { ...camera, north: -320 }, true)).toBe(false);
  });
  it('classifies wide footprints and corridor edges into two states with hysteresis', () => {
    expect(shouldLowerBuilding({ ...foreground, east: 80, radius: 90 }, camera, true)).toBe(true);
    expect(shouldLowerBuilding({ ...foreground, east: 49 }, camera, true)).toBe(true);
    expect(shouldLowerBuilding({ ...foreground, east: 51 }, camera, true)).toBe(false);
    expect(shouldLowerBuilding({ ...foreground, east: 51 }, camera, true, true)).toBe(true);
    expect(shouldLowerBuilding({ ...foreground, east: 56 }, camera, true, true)).toBe(false);
    expect(shouldLowerBuilding(foreground, camera, false, true)).toBe(false);
  });
  it('switches at zoom/pitch thresholds without partial strength', () => {
    const mid = (CUTAWAY_ZOOM.off + CUTAWAY_ZOOM.on) / 2;
    expect(cutawayEnabled(CUTAWAY_ZOOM.on, 58)).toBe(true);
    expect(cutawayEnabled(CUTAWAY_ZOOM.off, 58, true)).toBe(false);
    expect(cutawayEnabled(mid, 58, true)).toBe(true);
    expect(cutawayEnabled(mid, 58, false)).toBe(false);
    expect(cutawayEnabled(19, 28, true)).toBe(false);
    expect(cutawayEnabled(19, 34)).toBe(true);
    expect(cutawayEnabled(19, 31, true)).toBe(true);
    expect(cutawayEnabled(19, 31, false)).toBe(false);
    expect(cutawayEnabled(19, 0, true)).toBe(false);
  });
  it('finishes a one-shot animation even when camera updates repeat or stop', () => {
    const animation = new CutawayTransition();
    animation.set(true, 100, CUTAWAY_DURATION);
    expect(height(animation.value(100))).toBe(120);
    expect(height(animation.value(310))).toBeCloseTo(61);
    animation.set(true, 400, CUTAWAY_DURATION); // Camera still moving: no restart.
    expect(height(animation.value(520))).toBe(2);
    expect(height(animation.value(5000))).toBe(2); // Camera has stopped.
    animation.set(false, 5000, CUTAWAY_DURATION);
    expect(height(animation.value(5420))).toBe(120);
    expect(animation.running(5420)).toBe(false);
  });
  it('reverses smoothly but always reaches an endpoint; reduced motion snaps', () => {
    const animation = new CutawayTransition();
    animation.set(true, 0, 420);
    const before = animation.value(150);
    animation.set(false, 150, 420);
    expect(animation.value(150)).toBe(before);
    expect(animation.value(570)).toBe(0);
    animation.set(true, 600, 0);
    expect(animation.value(600)).toBe(1);
    expect(animation.running(600)).toBe(false);
    expect(height(1, 1)).toBe(1);
  });
  it('settles every zoom and corridor position at minimum or original height', () => {
    for (let zoom = 16; zoom < 20; zoom += .1) {
      for (let east = 0; east < 90; east += 3) {
        const animation = new CutawayTransition();
        animation.set(shouldLowerBuilding({ ...foreground, east }, camera, cutawayEnabled(zoom, 58)), 0, 420);
        expect([2, 120]).toContain(height(animation.value(420)));
      }
    }
  });
  it('expresses footprint and camera positions in the same metre frame', () => {
    const focus: MapBuilding = { id: 'focus', name: 'Demo', longitude: 114.14, latitude: 22.28, state: 'GRAY', floors: [], followUps: 0 };
    const position = contextPosition(footprintOf(focus), focus);
    expect(position.east).toBeCloseTo(0);
    expect(position.north).toBeCloseTo(0);
    expect(position.radius).toBeCloseTo(Math.hypot(13, 10));
    const state = focusCameraState(focus, { lng: 114.142, lat: 22.281 }, 42);
    expect(state.east).toBeCloseTo(.002 * 111320 * Math.cos(22.28 * Math.PI / 180));
    expect(state.north).toBeCloseTo(111.32);
    expect(state.bearing).toBe(42);
  });
});
