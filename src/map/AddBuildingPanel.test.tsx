import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Map as LibreMap } from 'maplibre-gl';
import { AddBuildingPanel } from './AddBuildingPanel';
import { addressFromTab, buildingInput, seedRing, shapeNote } from './addBuildingDraft';
import { defaultFootprintRing } from './mapModel';
import type { FootprintMatch } from './osmFootprint';

const point = { lng: 114.1400376, lat: 22.2867829 };
const ring = [[114.14, 22.2867], [114.1401, 22.2867], [114.1401, 22.2868], [114.14, 22.2868], [114.14, 22.2867]];
const matched: FootprintMatch = { kind: 'contains', ring, osmId: '42', area: 120, distance: 0, large: false, source: 'tile' };
const missed: FootprintMatch = { kind: 'none', reason: '附近沒有建築資料' };
const form = { name: '新大廈', address: '' };
const noop = () => undefined;

describe('adding a building on the map', () => {
  it('takes the matched outline and puts the marker at the middle of it', () => {
    const input = buildingInput(form, { point, match: matched });
    expect(input.footprint).toEqual(ring);
    expect(input.footprintSource).toMatchObject({ kind: 'osm', osmId: '42', match: 'contains' });
    expect(input.coordinates).not.toEqual(point);
  });

  it('keeps a right-clicked spot as it is, with no outline borrowed from a neighbour', () => {
    const input = buildingInput(form, { point, manual: true });
    expect(input.coordinates).toEqual(point);
    expect(input.footprint).toBeUndefined();
    expect(input.footprintSource).toBeUndefined();
  });

  it('stores a blank address as blank, and falls back to the spot when nothing was matched', () => {
    const input = buildingInput(form, { point, match: missed });
    expect(input).toMatchObject({ address: '', coordinates: point });
    expect(input.footprint).toBeUndefined();
  });

  it('starts the editor from the matched outline, the default block, or nothing while still looking', () => {
    expect(seedRing({ point, manual: true })).toEqual(defaultFootprintRing(point));
    expect(seedRing({ point, match: matched })).toEqual(ring);
    // No outline on the basemap is still a shape to draw on, unlike one not yet looked up.
    expect(seedRing({ point, match: missed })).toEqual(defaultFootprintRing(point));
    expect(seedRing({ point })).toBeUndefined();
  });

  it('stores the outline as it was left, and the marker at the middle of it', () => {
    const drawn = [[114.14, 22.2867], [114.1402, 22.2867], [114.1402, 22.2868], [114.14, 22.2868], [114.14, 22.2867]];
    const input = buildingInput(form, { point, match: matched }, { ring: drawn, edited: true });
    expect(input.footprint).toEqual(drawn);
    expect(input.coordinates.lng).toBeGreaterThan(point.lng);
  });

  it('keeps a moved outline as a person’s own reading, not the basemap’s', () => {
    // Untouched, the same ring is still OpenStreetMap's.
    expect(buildingInput(form, { point, match: matched }, { ring, edited: false }).footprintSource)
      .toMatchObject({ kind: 'osm', osmId: '42' });
    // Moved, it is recorded as manual — with the match kept, so what was offered can be traced.
    expect(buildingInput(form, { point, match: matched }, { ring: [...ring], edited: true }).footprintSource)
      .toMatchObject({ kind: 'manual', osmId: '42' });
    // A block drawn where the basemap had nothing is manual with no OSM id to name.
    const block = defaultFootprintRing(point);
    expect(buildingInput(form, { point, match: missed }, { ring: block, edited: false }).footprintSource)
      .toMatchObject({ kind: 'manual' });
    expect(buildingInput(form, { point, manual: true }, { ring: block, edited: false }).footprintSource)
      .not.toHaveProperty('osmId');
  });

  it('says which shape will be stored, so a placeholder is never mistaken for a survey', () => {
    expect(shapeNote({ point, manual: true })).toMatchObject({ check: true });
    expect(shapeNote({ point, manual: true }).text).toContain('預設方塊');
    expect(shapeNote({ point, match: matched }).text).toContain('OpenStreetMap');
    // The shape is adjusted here now, so the note no longer sends anyone to another mode.
    expect(shapeNote({ point, match: missed }).text).not.toContain('調整大廈形狀');
    expect(shapeNote({ point, manual: true }).text).not.toContain('調整大廈形狀');
    expect(shapeNote({ point, match: matched }).text).toContain('拖動');
  });

  it('takes the suggestion on Tab only from a blank naming field', () => {
    const suggestion = { text: '近福滿大廈', name: '福滿大廈', distance: 40 };
    expect(addressFromTab('name', '', suggestion)).toBe('近福滿大廈');
    expect(addressFromTab('address', '   ', suggestion)).toBe('近福滿大廈');
    // Someone typing their own address keeps it; other fields keep ordinary Tab behaviour.
    expect(addressFromTab('address', '第三街 88 號', suggestion)).toBeUndefined();
    expect(addressFromTab('other', '', suggestion)).toBeUndefined();
    expect(addressFromTab('name', '', undefined)).toBeUndefined();
  });

  it('offers the right-click on the map in its instructions', () => {
    const props = { map: {} as LibreMap, existingAt: () => undefined, onAdd: noop, onCancel: noop };
    const html = renderToStaticMarkup(<AddBuildingPanel {...props} />);
    expect(html).toContain('按右鍵');
    expect(html).toContain('地址可以留空');
    // The number is not asked for, and floors are the structure editor's job.
    expect(html).toContain('大廈編號會自動編');
    expect(html).not.toContain('樓層及單位');
  });
});
