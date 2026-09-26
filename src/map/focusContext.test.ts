import { describe, expect, it } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { contextPosition, focusHeight } from './focusContext';
import { footprintOf, type MapBuilding } from './mapModel';

const parsed = createExpression(focusHeight, 'fill-extrusion-height');
if (parsed.result === 'error') throw new Error(JSON.stringify(parsed.value));
const evaluate = (bearing: number, east: number, north: number, radius = 12, height = 120) =>
  parsed.value.evaluate({ zoom: 18, globalState: { focusBearing: bearing } }, { type: 'Polygon', properties: { east, north, radius, height } });

describe('camera-relative foreground cutaway', () => {
  it('opens the viewing corridor throughout a full rotation and keeps background context', () => {
    for (let bearing = -180; bearing <= 180; bearing += 15) {
      const angle = bearing * Math.PI / 180;
      expect(evaluate(bearing, -160 * Math.sin(angle), -160 * Math.cos(angle))).toBeCloseTo(2);
      expect(evaluate(bearing, 160 * Math.sin(angle), 160 * Math.cos(angle))).toBeCloseTo(120);
      expect(evaluate(bearing, 160 * Math.cos(angle), -160 * Math.sin(angle))).toBeCloseTo(120);
    }
  });
  it('considers wide footprints and blends the edge without raising short structures', () => {
    expect(evaluate(0, 80, -180, 90)).toBeCloseTo(2);
    expect(evaluate(0, 50, -180)).toBeGreaterThan(2);
    expect(evaluate(0, 50, -180)).toBeLessThan(120);
    expect(evaluate(0, 0, -180, 12, 1)).toBe(1);
  });
  it('expresses footprint bounds in metres relative to the selected location', () => {
    const focus: MapBuilding = { id: 'focus', name: 'Demo', longitude: 114.14, latitude: 22.28, color: '#ccc', status: 'unknown', floors: [] };
    const position = contextPosition(footprintOf(focus), focus);
    expect(position.east).toBeCloseTo(0);
    expect(position.north).toBeCloseTo(0);
    expect(position.radius).toBeCloseTo(Math.hypot(13, 10));
  });
});
