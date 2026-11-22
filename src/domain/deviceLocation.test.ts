import { describe, expect, it } from 'vitest';
import { deviceDistanceMetres, formatDeviceDistance, rankPlacesByProximity, readDeviceFix, usableDeviceFix, type DeviceFix } from './deviceLocation';

const now = Date.UTC(2026, 10, 22, 8);
const fix = (over: Partial<DeviceFix> = {}): DeviceFix => ({ lat: 22.2865, lng: 114.14175, accuracy: 25, observedAt: now - 1_000, ...over });
const place = (id: string, relevance: number | undefined, lat: number, lng = 114.14175) => ({ id, relevance, lat, lng });

describe('device fixes', () => {
  it('reads a browser position without ever substituting 0,0 for a bad coordinate', () => {
    expect(readDeviceFix({ coords: { latitude: 22.2865, longitude: 114.14175, accuracy: 25 }, timestamp: now })).toEqual(fix({ observedAt: now }));
    expect(readDeviceFix({ coords: { latitude: Number.NaN, longitude: 114.14175, accuracy: 25 }, timestamp: now })).toBeUndefined();
    expect(readDeviceFix({ coords: { latitude: 22.2865, longitude: 181, accuracy: 25 }, timestamp: now })).toBeUndefined();
    expect(readDeviceFix({ coords: { latitude: 22.2865, longitude: 114.14175, accuracy: 0 }, timestamp: now })).toBeUndefined();
  });

  it('accepts only fresh fixes accurate enough for building work', () => {
    expect(usableDeviceFix(fix(), now)).toBe(true);
    expect(usableDeviceFix(fix({ observedAt: now - 5 * 60_000 }), now)).toBe(true);
    expect(usableDeviceFix(fix({ observedAt: now - 5 * 60_000 - 1 }), now)).toBe(false);
    expect(usableDeviceFix(fix({ observedAt: now + 1 }), now)).toBe(false);
    expect(usableDeviceFix(fix({ accuracy: 500 }), now)).toBe(true);
    expect(usableDeviceFix(fix({ accuracy: 501 }), now)).toBe(false);
    expect(usableDeviceFix(undefined, now)).toBe(false);
  });

  it('calculates metres on the globe rather than degrees on the map', () => {
    const oneDegree = deviceDistanceMetres({ lat: 22, lng: 114 }, { lat: 23, lng: 114 });
    expect(oneDegree).toBeGreaterThan(111_000);
    expect(oneDegree).toBeLessThan(112_000);
    expect(deviceDistanceMetres({ lat: 22, lng: 114 }, { lat: 22, lng: 114 })).toBe(0);
    expect(deviceDistanceMetres({ lat: 91, lng: 114 }, { lat: 22, lng: 114 })).toBeUndefined();
  });

  it('formats a straight-line reference without implying walking distance', () => {
    expect(formatDeviceDistance(123.4)).toBe('直線約 123 米');
    expect(formatDeviceDistance(1_250)).toBe('直線約 1.3 公里');
    expect(formatDeviceDistance(undefined)).toBe('');
  });
});

describe('one search result snapshot', () => {
  it('lets a nearby result outrank a slightly less relevant distant result', () => {
    const ranked = rankPlacesByProximity([
      place('far', 0.9, 22.32),
      place('near', 0.89, 22.2865),
    ], fix(), now);
    expect(ranked.map(row => row.id)).toEqual(['near', 'far']);
    expect(ranked[0].distanceMetres).toBe(0);
    expect(ranked[1].distanceMetres).toBeGreaterThan(3_000);
  });

  it('keeps text relevance dominant', () => {
    const ranked = rankPlacesByProximity([
      place('relevant-far', 1, 22.32),
      place('irrelevant-near', 0, 22.2865),
    ], fix(), now);
    expect(ranked.map(row => row.id)).toEqual(['relevant-far', 'irrelevant-near']);
  });

  it('retains the complete server order if any relevance is missing', () => {
    const original = [place('first', undefined, 22.32), place('second', 1, 22.2865)];
    const ranked = rankPlacesByProximity(original, fix(), now);
    expect(ranked.map(row => row.id)).toEqual(['first', 'second']);
    expect(ranked.every(row => row.distanceMetres === undefined)).toBe(true);
  });

  it('does not rank or label distances with a stale or inaccurate fix', () => {
    const original = [place('first', 0.8, 22.32), place('second', 0.8, 22.2865)];
    for (const bad of [fix({ observedAt: now - 300_001 }), fix({ accuracy: 800 })]) {
      const ranked = rankPlacesByProximity(original, bad, now);
      expect(ranked.map(row => row.id)).toEqual(['first', 'second']);
      expect(ranked.every(row => row.distanceMetres === undefined)).toBe(true);
    }
  });

  it('keeps equal scores stable and never mutates the server results', () => {
    const original = [Object.freeze(place('first', 0.8, 22.2865)), Object.freeze(place('second', 0.8, 22.2865))];
    const snapshot = original.map(row => ({ ...row }));
    const ranked = rankPlacesByProximity(original, fix(), now);
    expect(ranked.map(row => row.id)).toEqual(['first', 'second']);
    expect(original).toEqual(snapshot);
    expect(ranked[0]).not.toBe(original[0]);
  });
});
