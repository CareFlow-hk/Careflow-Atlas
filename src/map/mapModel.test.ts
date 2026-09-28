import { describe, it, expect } from 'vitest';
import { stateLabels } from '../domain/presentation';
import { buildingFeatures, districtBounds, visibleDistrictLabels, floorFeatures, footprintOf, markerLabel, FLOOR_HEIGHT, type MapBuilding } from './mapModel';

const building: MapBuilding = {
  id: 'test', name: 'Synthetic', longitude: 114.1418, latitude: 22.2863, state: 'YELLOW', followUps: 1,
  floors: Array.from({ length: 8 }, (_, index) => ({ id: `f${index + 1}`, label: `${index + 1}F`, level: index + 1, state: index === 4 ? 'YELLOW' as const : 'GRAY' as const, hasFollowUp: index === 4, recorded: 0, total: 4 })),
};
describe('spatial adapter', () => {
  it('keeps an exploded building anchored to the same geographical footprint', () => {
    const closed = floorFeatures(building, 0);
    const open = floorFeatures(building, 1);
    expect(open.features.map(f => f.geometry)).toEqual(closed.features.map(f => f.geometry));
    expect(open.features[0].geometry.coordinates[0][0]).toEqual(open.features[0].geometry.coordinates[0].at(-1));
    expect(open.features[7].properties!.base).toBeGreaterThan(closed.features[7].properties!.height);
  });
  it('keeps finite ordered floor slabs with positive height throughout animation', () => {
    for (const t of [0, .2, .4, .6, .8, 1]) {
      const features = floorFeatures(building, t).features;
      features.forEach((f, i) => {
        expect(f.properties!.height).toBeGreaterThan(f.properties!.base);
        expect(f.properties!.height - f.properties!.base).toBeCloseTo(FLOOR_HEIGHT - .35);
        if (i) expect(f.properties!.base).toBeGreaterThan(features[i - 1].properties!.height);
      });
    }
  });
  it('isolates selected building geometry so the shell and floors do not double render', () => {
    expect(buildingFeatures([building], building.id).features).toHaveLength(0);
    expect(floorFeatures(undefined, 1).features).toHaveLength(0);
    expect(footprintOf(building)[0][0]).toBeLessThan(building.longitude);
    expect(footprintOf(building)[2][0]).toBeGreaterThan(building.longitude);
  });
  it('pads the declared footprint bounds rather than substituting a default rectangle', () => {
    const custom = { ...building, footprint: [[114.14, 22.28], [114.142, 22.28], [114.142, 22.282], [114.14, 22.282], [114.14, 22.28]] };
    const padded = footprintOf(custom, 1);
    expect(padded[0][0]).toBeLessThan(114.14);
    expect(padded[0][1]).toBeLessThan(22.28);
    expect(padded[2][0]).toBeGreaterThan(114.142);
    expect(padded[2][1]).toBeGreaterThan(22.282);
  });
  /*
   * The reported defect (COLOR_PIPELINE_DESIGN §9) was a colour change moving building
   * height. It does not reproduce at this revision: height comes from the floor count
   * and the separation curve, colour from the pipeline, and nothing bridges them. The
   * test locks that apart so a future "tint the taller ones" change cannot reintroduce it.
   */
  it('never lets a colour change move any geometry', () => {
    const geometryOf = (scene: MapBuilding) => JSON.stringify({
      floors: floorFeatures(scene, .6).features.map(f => [f.properties!.base, f.properties!.height]),
      shells: buildingFeatures([scene]).features.map(f => f.properties!.height),
    });
    const palette = ['GREEN', 'YELLOW', 'RED', 'GRAY'] as const;
    const heights = palette.map(state => geometryOf({ ...building, state, floors: building.floors.map(floor => ({ ...floor, state })) }));
    expect(new Set(heights).size).toBe(1);
    // And the colour really does follow the state, so the check above is not vacuous.
    const colours = palette.map(state => floorFeatures({ ...building, floors: building.floors.map(floor => ({ ...floor, state })) }, .6).features[0].properties!.color);
    expect(new Set(colours).size).toBe(palette.length);
  });
  it('never intersects slabs across the full supported floor count, including interrupted transitions', () => {
    const tall = { ...building, floors: Array.from({ length: 100 }, (_, index) => ({ ...building.floors[0], id: `tall-${index}`, level: index + 1 })) };
    for (const progress of [0, .02, .1, .16, .3, .75, .4, .05, 0, 1]) {
      const features = floorFeatures(tall, progress).features;
      features.forEach((floor, index) => {
        expect(Number.isFinite(floor.properties!.height)).toBe(true);
        if (index) expect(floor.properties!.base - features[index - 1].properties!.height).toBeGreaterThan(.34);
      });
    }
  });
});


describe('district overview', () => {
  it('frames all declared footprint corners, not only building centres', () => {
    const wide = { ...building, id: 'wide', footprint: [[114.14, 22.28], [114.15, 22.28], [114.15, 22.29], [114.14, 22.29], [114.14, 22.28]] };
    expect(districtBounds([building, wide])).toEqual([[114.14, 22.28], [114.15, 22.29]]);
    expect(districtBounds([])).toBeUndefined();
  });
  it('declutters overlapping names while keeping separated labels and respecting controls', () => {
    const labels = [
      { id: 'first', x: 160, y: 240, width: 100 },
      { id: 'overlap', x: 170, y: 245, width: 100 },
      { id: 'next', x: 280, y: 240, width: 100 },
      { id: 'offscreen', x: -10, y: 210, width: 100 },
      { id: 'tools', x: 550, y: 240, width: 70 },
      { id: 'footer', x: 300, y: 495, width: 100 },
      { id: 'header', x: 160, y: 100, width: 100 },
    ];
    expect([...visibleDistrictLabels(labels, 600, 540)]).toEqual(['first', 'next']);
  });
});

/*
 * The overview map is where a district is read at a glance, so a building with open
 * tasks has to name them beside its own name — the way a floor strip names its revisit.
 */
describe('a building marker names its own task', () => {
  const withTasks = (followUps: number): MapBuilding => ({ ...building, followUps });

  it('shows the tag only when a task is open, and names the state either way', () => {
    expect(markerLabel(withTasks(0), false).task).toBeUndefined();
    expect(markerLabel(withTasks(2), false).task).toBe('待跟進');
    // The state is on the marker whether or not there is a task. Quoted from
    // presentation.ts, not retyped: the marker must not invent its own wording.
    for (const count of [0, 2]) expect(markerLabel(withTasks(count), false).title).toContain(stateLabels[building.state]);
  });

  it('counts the tasks in what a screen reader and a tooltip read out', () => {
    expect(markerLabel(withTasks(2), false).title).toBe(`Synthetic · ${stateLabels[building.state]} · 2 項待跟進`);
    expect(markerLabel(withTasks(2), true).ariaLabel).toBe(`正在查看Synthetic · ${stateLabels[building.state]} · 2 項待跟進`);
  });

  it('marks the element so the stylesheet can draw the tag', () => {
    expect(markerLabel(withTasks(1), false).className).toBe('building-map-marker has-followup');
    expect(markerLabel(withTasks(0), false).className).toBe('building-map-marker');
    expect(markerLabel(withTasks(0), true).className).toBe('building-map-marker is-selected');
  });

  it('declares the extra width, so the tag is not laid out under a neighbouring name', () => {
    const without = markerLabel(withTasks(0), false).labelWidth;
    expect(markerLabel(withTasks(1), false).labelWidth).toBe(without + 60);
  });
});
