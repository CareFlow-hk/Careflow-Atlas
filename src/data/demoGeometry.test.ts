import { describe, expect, it } from 'vitest';
import { demoSnapshot } from './demoFixture';
import geometry from './demoGeometry.json';
import { alignDemoBuilding } from './demoGeometry';
import { OutreachRepository } from './repository';
import { buildingFeatures, floorFeatures, type MapBuilding } from '../map/mapModel';

describe('basemap-aligned demo geometry', () => {
  it('shares the exact source ring between map shells and every floor', () => {
    for (const binding of geometry.buildings) {
      const building = demoSnapshot.buildings.find(b => b.id === binding.id)!;
      const mapBuilding: MapBuilding = { ...building, longitude: building.coordinates.lng, latitude: building.coordinates.lat, state: 'GRAY', followUps: 0, tagged: false, floors: [{ id: 'floor', label: '1F', level: 1, state: 'GRAY', total: 0, recorded: 0, hasFollowUp: false, breakdown: { GREEN: 0, YELLOW: 0, RED: 0, GRAY: 0 }, tagged: false }] };
      expect(buildingFeatures([mapBuilding]).features[0].geometry.coordinates[0]).toEqual(binding.footprint);
      for (const progress of [0, .5, 1]) expect(floorFeatures(mapBuilding, progress).features[0].geometry.coordinates[0]).toEqual(binding.footprint);
    }
  });
  it('upgrades legacy stored demo coordinates without writing or losing history', () => {
    const legacy = { ...demoSnapshot, buildings: demoSnapshot.buildings.map(building => ({ ...building, footprint: undefined, coordinates: geometry.buildings.find(b => b.id === building.id)!.legacyCoordinates })) };
    let writes = 0;
    const repository = new OutreachRepository({ read: () => JSON.stringify(legacy), write: () => { writes++; } });
    const updated = repository.getSnapshot()!;
    expect(updated.buildings).toEqual(demoSnapshot.buildings);
    expect(updated.observations).toEqual(legacy.observations);
    expect(updated.visits).toEqual(legacy.visits);
    expect(writes).toBe(0);
  });
  it('leaves supplied footprints and independently edited or imported locations untouched', () => {
    const demo = demoSnapshot.buildings[0];
    for (const building of [demo, { ...demo, footprint: undefined, coordinates: { lng: 114.2, lat: 22.3 } }, { ...demo, footprint: undefined, name: 'Different building' }]) {
      expect(alignDemoBuilding(building)).toBe(building);
    }
  });
});

describe('addresses saved before 2026-09-29', () => {
  it('still align a legacy demo building whose address ends in 「（合成）」', () => {
    const binding = geometry.buildings[0];
    const legacy = { ...demoSnapshot.buildings.find(b => b.id === binding.id)!, address: `${binding.address}（合成）`, coordinates: { ...binding.legacyCoordinates } };
    delete legacy.footprint;
    expect(alignDemoBuilding(legacy).footprint).toEqual(binding.footprint);
  });
});
