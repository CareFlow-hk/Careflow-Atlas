import { describe, expect, it } from 'vitest';
import { filterBuildings, normalizeBuildingQuery } from './buildingSearch';

const BUILDINGS = [
  { id: 'bldg-third-100', name: '第三街大廈', address: '香港第三街100號' },
  { id: 'bldg-third-101', name: '真光大廈', address: '香港第三街101號' },
  { id: 'bldg-harbour', name: '海港花園', address: 'Harbour Road 8號' },
];

describe('normalizeBuildingQuery', () => {
  it('applies NFKC, removes all whitespace, lowercases English and normalises 號 after digits', () => {
    expect(normalizeBuildingQuery('  ＴＨＩＲＤ\u3000Street\n１００號\t')).toBe('thirdstreet100');
  });

  it('does not remove 號 when it does not follow a digit', () => {
    expect(normalizeBuildingQuery('號外大廈')).toBe('號外大廈');
  });
});

describe('filterBuildings', () => {
  it.each([
    '第三街100號',
    '第三街 100',
    '第三街100',
    '真光大廈',
  ])('finds the requested building with %s', query => {
    const expectedId = query === '真光大廈' ? 'bldg-third-101' : 'bldg-third-100';
    expect(filterBuildings(BUILDINGS, query).map(building => building.id)).toEqual([expectedId]);
  });

  it('matches both names and addresses, including case-insensitive English', () => {
    expect(filterBuildings(BUILDINGS, '海港花園').map(building => building.id)).toEqual(['bldg-harbour']);
    expect(filterBuildings(BUILDINGS, 'harbourroad8').map(building => building.id)).toEqual(['bldg-harbour']);
  });

  it('returns every building in its original order for an empty or whitespace-only query', () => {
    expect(filterBuildings(BUILDINGS, '').map(building => building.id)).toEqual([
      'bldg-third-100',
      'bldg-third-101',
      'bldg-harbour',
    ]);
    expect(filterBuildings(BUILDINGS, ' \n\u3000\t')).toEqual(BUILDINGS);
  });

  it('keeps different street numbers distinct', () => {
    expect(filterBuildings(BUILDINGS, '第三街100號').map(building => building.id)).toEqual(['bldg-third-100']);
    expect(filterBuildings(BUILDINGS, '第三街101').map(building => building.id)).toEqual(['bldg-third-101']);
  });

  it('preserves matching order and returns the original records', () => {
    const reversed = [BUILDINGS[2], BUILDINGS[0], BUILDINGS[1]];
    const result = filterBuildings(reversed, '第三街');

    expect(result.map(building => building.id)).toEqual(['bldg-third-100', 'bldg-third-101']);
    expect(result[0]).toBe(BUILDINGS[0]);
    expect(result[1]).toBe(BUILDINGS[1]);
  });

  it('does not mutate the input array or building records', () => {
    const buildings = Object.freeze([
      Object.freeze({ id: 'bldg-2', name: '乙大廈', address: '第二街2號' }),
      Object.freeze({ id: 'bldg-1', name: '甲大廈', address: '第一街1號' }),
    ]);
    const before = buildings.map(building => ({ ...building }));

    expect(filterBuildings(buildings, '街').map(building => building.id)).toEqual(['bldg-2', 'bldg-1']);
    expect(buildings.map(building => ({ ...building }))).toEqual(before);
  });
});
