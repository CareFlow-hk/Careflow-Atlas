import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildingOverlapGroups, type SpatialBuilding } from './buildingOverlaps';
import { toLngLat } from './footprintGeometry';
import { blankSnapshot } from '../data/blankSnapshot';
import { demoBuildings } from '../data/demoFixture';
import { mergeSync } from '../data/syncMerge';
import { BuildingCard } from '../components/BuildingCard';
import { BuildingDetail } from '../components/BuildingDetail';
import { getCoverageSummary } from '../domain/types';
import { duplicateMarkerOffsets, markerLabel, type MapBuilding } from './mapModel';
const at = (id: string, x: number): SpatialBuilding => ({id, name: `合成${id}樓`, longitude:114.14, latitude:22.28, footprint:toLngLat([[x,0],[x+10,0],[x+10,10],[x,10]], {lng:114.14,lat:22.28})});
const noop = () => {};
describe('workspace overlap review groups', () => {
  it('joins transitive overlaps but detail peers remain direct intersections', () => {
    const { groups, peers } = buildingOverlapGroups([at('A',0),at('B',8),at('C',16),at('D',40)]);
    expect(groups).toHaveLength(1);
    expect(new Set(groups[0])).toEqual(new Set(['A','B','C']));
    expect(peers.get('A')?.map(b=>b.id)).toEqual(['B']);
    expect(peers.get('B')?.map(b=>b.id)).toEqual(['A','C']);
    expect(buildingOverlapGroups([at('A',0),at('B',10)]).groups).toEqual([]);
  });
  it('marks independent IDs retained by sync and never edits their records', () => {
    const base=blankSnapshot(), local=blankSnapshot(), remote=blankSnapshot();
    local.buildings.push({...demoBuildings[0], id:'device-a', floorCount:undefined, layoutDeclared:false, footprint:at('A',0).footprint});
    remote.buildings.push({...local.buildings[0], id:'device-b'});
    const result=mergeSync(remote,local,base);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot, JSON.stringify(result)).toBeDefined();
    const saved=structuredClone(result.snapshot!);
    const spatial=saved.buildings.map(b=>({id:b.id,name:b.name,longitude:b.coordinates.lng,latitude:b.coordinates.lat,footprint:b.footprint}));
    expect(new Set(buildingOverlapGroups(spatial).groups[0])).toEqual(new Set(['device-a','device-b']));
    expect(result.snapshot).toEqual(saved);
    spatial[1].footprint=at('B',10).footprint;
    expect(buildingOverlapGroups(spatial).groups).toEqual([]);
  });
  it('recomputes after load or a shape change, without persisted flags', () => {
    const first=at('A',0), second=at('B',0);
    expect(buildingOverlapGroups([first,second]).groups).toHaveLength(1);
    second.footprint=at('B',20).footprint;
    expect(buildingOverlapGroups([first,second]).groups).toEqual([]);
    expect(buildingOverlapGroups([]).groups).toEqual([]);
  });
  it('shows the same review wording on markers, rows and details, with safe peer navigation', () => {
    const b={...at('A',0),floors:[],state:'GRAY',followUps:0,tagged:false} as MapBuilding;
    const label=markerLabel(b,false,true);
    expect(label.ariaLabel).toContain('可能重複');
    expect(label.possibleDuplicate).toBe(true);
    expect(markerLabel(b,false).ariaLabel).not.toContain('可能重複');
    const snapshot=blankSnapshot();snapshot.buildings=[{...demoBuildings[0],id:'A'}];
    const row=renderToStaticMarkup(<BuildingCard name={b.name} address="" index={0} state="GRAY" summary={getCoverageSummary(snapshot,'A')} selected={false} onSelect={noop} possibleDuplicate />);
    expect(row).toContain('building-overlap-badge');
    const detail=renderToStaticMarkup(<BuildingDetail snapshot={snapshot} selectedBuildingId="A" overlapPeers={[at('B',0)]} onSelectBuilding={noop} onSelectFloor={noop} onSelectUnit={noop} onToggleTag={noop} onStartObservation={noop} />);
    expect(detail).toContain('有記錄的那幢先不要刪');
    expect(detail).toContain('去『合成B樓』');
  });
});


it('keeps duplicate marker names readable at the same point without moving ordinary neighbours', () => {
  const labels=[{id:'A',x:100,y:200,width:160},{id:'B',x:100,y:200,width:160},{id:'C',x:100,y:200,width:160},{id:'far',x:500,y:200,width:160},{id:'ordinary',x:100,y:200,width:160}];
  const offsets=duplicateMarkerOffsets(labels,new Set(['A','B','C','far']));
  expect([...offsets]).toEqual([['A',0],['B',44],['C',88],['far',0]]);
  expect(labels.every(label=>label.y===200)).toBe(true);
});
