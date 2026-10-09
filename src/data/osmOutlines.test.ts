import { describe, expect, it } from 'vitest';
import { attachOsmOutlines } from './osmOutlines';
import { mergeWorkflow } from './workflowMerge';
import { workflowDemo } from './workflowDemo';
import type { FootprintMatch } from '../map/osmFootprint';

const ring = [[114.1, 22.2], [114.1001, 22.2], [114.1001, 22.2001], [114.1, 22.2001], [114.1, 22.2]];
const withNew = () => { const s = structuredClone(workflowDemo); s.buildings.push({ isSynthetic: true, provisional: true, id: 'NEW-1', name: '新樓', address: '新街 1 號', coordinates: { lng: 114.1, lat: 22.2 }, layoutDeclared: false }); return s; };

describe('OSM outlines on import', () => {
  it('fills only buildings without an outline, and says what it did', async () => {
    const found = async (): Promise<FootprintMatch> => ({ kind: 'contains', ring, osmId: 'w1:0', area: 120, distance: 0, large: false, source: 't' });
    const { snapshot, notes } = await attachOsmOutlines(withNew(), workflowDemo, found, '2026-10-09T00:00:00Z');
    expect(snapshot.buildings.find(b => b.id === 'NEW-1')).toMatchObject({ footprint: ring, footprintSource: { kind: 'osm', osmId: 'w1:0', match: 'contains' } });
    expect(notes).toHaveLength(workflowDemo.buildings.filter(b => !b.footprint).length + 1);
    for (const b of workflowDemo.buildings.filter(b => b.footprint)) expect(snapshot.buildings.find(x => x.id === b.id)!.footprint).toEqual(b.footprint);
  });
  it('keeps the default box and explains why when nothing is found', async () => {
    const none = async (): Promise<FootprintMatch> => ({ kind: 'none', reason: '最近的建築在 35 米外' });
    const { snapshot, notes } = await attachOsmOutlines(withNew(), workflowDemo, none);
    expect(snapshot.buildings.find(b => b.id === 'NEW-1')!.footprint).toBeUndefined();
    expect(notes.at(-1)).toMatchObject({ needsCheck: true, detail: expect.stringContaining('35 米') });
  });
  it('adds an outline to a building that exists here without one, from an older file', () => {
    const local = withNew();
    const incoming = structuredClone(local);
    incoming.buildings.find(b => b.id === 'NEW-1')!.footprint = ring;
    const merged = mergeWorkflow(local, incoming, workflowDemo);
    expect(merged.issues).toEqual([]);
    expect(merged.snapshot!.buildings.find(b => b.id === 'NEW-1')!.footprint).toEqual(ring);
  });
});
