import { describe, expect, it } from 'vitest';
import { suggestNearbyAddress, NEARBY_LIMIT_METRES } from './nearbyAddress';

const point = { lng: 114.14, lat: 22.2868 };
/** Metres east of `point`, in the same local frame the suggestion measures in. */
const east = (metres: number) => ({ lng: point.lng + metres / (111320 * Math.cos(point.lat * Math.PI / 180)), lat: point.lat });

describe('the address suggestion for a new building', () => {
  it('words the nearest building on the atlas as a field note would', () => {
    const suggestion = suggestNearbyAddress(point, [{ name: '福滿大廈', ...east(30) }, { name: '遠處大廈', ...east(90) }]);
    expect(suggestion).toMatchObject({ text: '近福滿大廈', name: '福滿大廈' });
    expect(suggestion!.distance).toBeCloseTo(30, 1);
  });

  it('stays silent when nothing registered is close enough, rather than guessing', () => {
    expect(suggestNearbyAddress(point, [{ name: '遠方大廈', ...east(NEARBY_LIMIT_METRES + 1) }])).toBeUndefined();
    expect(suggestNearbyAddress(point, [])).toBeUndefined();
  });

  it('takes a building just inside the limit, and ignores records it cannot place', () => {
    expect(suggestNearbyAddress(point, [{ name: '邊界大廈', ...east(NEARBY_LIMIT_METRES - 1) }])?.name).toBe('邊界大廈');
    expect(suggestNearbyAddress(point, [{ name: '  ', ...east(5) }, { name: '無座標大廈', lng: NaN, lat: NaN }, { name: '真實大廈', ...east(40) }])?.name).toBe('真實大廈');
  });
});
