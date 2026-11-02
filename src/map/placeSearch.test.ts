import { describe, expect, it, vi } from 'vitest';
import { nearbyBuilding, PLACE_NEARBY_METRES, readPlaces, searchPlaces, type ExistingBuilding, type PlaceResult } from './placeSearch';

/*
 * The browser end of the address lookup (`docs/GEOCODING.md`). The server already filters;
 * this repeats the filter at the boundary the panel actually trusts, because a marker in the
 * sea is worse than one fewer result. What is checked here is that boundary and the duplicate
 * warning — not the shape of the server's answer, which has its own tests.
 */

const place = (over: Partial<PlaceResult> = {}): PlaceResult => ({ id: 'als-0', name: '福滿大廈', address: '第三街88號', lng: 114.1422, lat: 22.2867, ...over });
const building = (over: Partial<ExistingBuilding> = {}): ExistingBuilding => ({ id: 'b1', name: '福滿大廈', lng: 114.1422, lat: 22.2867, ...over });

describe('rows from the server', () => {
  it('keeps a place with a position, a name and an address', () => {
    expect(readPlaces({ places: [place()] })).toEqual([place()]);
  });

  it('drops a place without a position rather than placing it at zero', () => {
    expect(readPlaces({ places: [place({ lng: 0, lat: 0 })] })).toEqual([]);
    expect(readPlaces({ places: [{ ...place(), lng: undefined, lat: undefined }] })).toEqual([]);
    expect(readPlaces({ places: [{ ...place(), lng: '', lat: '' }] })).toEqual([]);
  });

  it('drops a place outside Hong Kong', () => {
    expect(readPlaces({ places: [place({ lng: 113.26, lat: 23.13 })] })).toEqual([]);
  });

  it('falls back to the address when the service names no building', () => {
    expect(readPlaces({ places: [place({ name: '' })] })[0].name).toBe('第三街88號');
  });

  it('drops a row with neither a name nor an address', () => {
    expect(readPlaces({ places: [place({ name: '', address: '' })] })).toEqual([]);
  });

  it('gives a row without an id a stable one of its own', () => {
    expect(readPlaces({ places: [place({ id: '' }), place({ id: '' })] }).map(row => row.id)).toEqual(['place-0', 'place-1']);
  });

  it('treats anything that is not a list of places as no results', () => {
    expect(readPlaces(undefined)).toEqual([]);
    expect(readPlaces({ error: 'nope' })).toEqual([]);
    expect(readPlaces({ places: 'nope' })).toEqual([]);
  });
});

describe('a result that lands on a building already on the atlas', () => {
  const metresNorth = (metres: number) => 22.2867 + metres / 111320;

  it('finds the building at the same coordinate', () => {
    expect(nearbyBuilding(place(), [building()])?.id).toBe('b1');
  });

  it('accepts a building within the reach the footprint matcher uses', () => {
    expect(nearbyBuilding(place(), [building({ lat: metresNorth(PLACE_NEARBY_METRES - 2) })])?.id).toBe('b1');
  });

  it('does not call a neighbour the same building just because it is close', () => {
    expect(nearbyBuilding(place(), [building({ lat: metresNorth(PLACE_NEARBY_METRES + 3) })])).toBeUndefined();
  });

  it('picks the nearest when more than one is in reach', () => {
    const near = building({ id: 'near', lat: metresNorth(3) });
    const far = building({ id: 'far', lat: metresNorth(12) });
    expect(nearbyBuilding(place(), [far, near])?.id).toBe('near');
  });

  it('ignores a building whose position was never set', () => {
    expect(nearbyBuilding(place(), [building({ lat: Number.NaN })])).toBeUndefined();
  });

  it('says nothing when there are no buildings yet', () => {
    expect(nearbyBuilding(place(), [])).toBeUndefined();
  });
});

describe('asking the server', () => {
  it('sends the words to the server, encoded, and reads what comes back', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ places: [place()] }));
    await expect(searchPlaces(' 福滿 大廈 ', { fetcher })).resolves.toEqual([place()]);
    expect(fetcher).toHaveBeenCalledWith(`/place-search?q=${encodeURIComponent('福滿 大廈')}`);
  });

  it('does not bother the server with a query that cannot name a building', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ places: [] }));
    await expect(searchPlaces('樓', { fetcher })).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes a failure on instead of showing an empty list that looks like "not found"', async () => {
    const fetcher = () => Promise.reject(new Error('地址服務未有回應'));
    await expect(searchPlaces('福滿大廈', { fetcher })).rejects.toThrow('地址服務未有回應');
  });
});
