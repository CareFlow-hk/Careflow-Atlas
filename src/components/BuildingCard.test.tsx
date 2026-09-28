import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BuildingCard } from './BuildingCard';
import { buildingState, getCoverageSummary, type Observation, type OutreachSnapshot } from '../domain/types';
import { stateLabels } from '../domain/presentation';

const flags = { isSynthetic: true as const, provisional: true as const };
function observation(overrides: Partial<Observation> & { id: string }): Observation {
  return {
    ...flags, visitId: `visit-${overrides.id}`, buildingId: 'b1', floorId: 'f1', unitId: 'u1',
    occurredAt: '2026-01-05T02:00:00.000Z', recordedAt: '2026-01-05T02:00:00.000Z', workerName: '合成工作員',
    coverage: 'VISITED_NO_FINDING', evidence: [], ...overrides,
  };
}
function district(observations: Observation[]): OutreachSnapshot {
  return {
    schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
    buildings: [{ ...flags, id: 'b1', name: '海景樓', address: '合成地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true, floorCount: 2 }],
    floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 1, label: '1F' }, { ...flags, id: 'f2', buildingId: 'b1', level: 2, label: '2F' }],
    units: [{ ...flags, id: 'u1', buildingId: 'b1', floorId: 'f1', label: 'A室' }],
    households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [], visits: [], observations,
  };
}
function card(snapshot: OutreachSnapshot) {
  const building = snapshot.buildings[0];
  return renderToStaticMarkup(<BuildingCard name={building.name} address={building.address} floorCount={building.floorCount}
    index={0} state={buildingState(snapshot, 'b1')} summary={getCoverageSummary(snapshot, 'b1')} selected={false} onSelect={() => {}} />);
}

/*
 * The district list is where a whole area is compared at a glance, so a building with
 * open tasks has to say so there rather than only after it is opened.
 */
describe('a building with open tasks is marked in the list', () => {
  it('carries the same yellow mark and wording the floor strip uses', () => {
    const markup = card(district([observation({ id: 'o1', coverage: 'ATTEMPTED', followUp: { action: '與同事討論後再訪', status: 'OPEN' } })]));
    expect(markup).toContain('has-followup');
    expect(markup).toContain('待跟進');
    expect(markup).toContain('1 待跟進');
    expect(markup).toContain('title="1 項待跟進"');
  });

  it('stays unmarked when nothing is open', () => {
    const markup = card(district([observation({ id: 'o1', coverage: 'VISITED_NO_FINDING' })]));
    // The whole card is asserted, so an absent tag cannot pass by the page being empty.
    expect(markup).toContain('海景樓');
    expect(markup).toContain(stateLabels[buildingState(district([observation({ id: 'o1' })]), 'b1')]);
    expect(markup).not.toContain('has-followup');
    expect(markup).not.toContain('待跟進');
  });

  it('counts a task wherever in the building it sits, including the building itself', () => {
    const markup = card(district([
      observation({ id: 'o1', floorId: 'f1', unitId: 'u1', coverage: 'ATTEMPTED', followUp: { action: '再訪', status: 'OPEN' } }),
      observation({ id: 'o2', floorId: undefined, unitId: undefined, coverage: 'ATTEMPTED', followUp: { action: '問管理處', status: 'OPEN' } }),
    ]));
    expect(markup).toContain('2 待跟進');
  });

  it('drops the mark once the task is closed, not merely recorded', () => {
    const closed = observation({ id: 'o1', coverage: 'ATTEMPTED', followUp: { action: '再訪', status: 'DONE' } });
    expect(card(district([closed]))).not.toContain('待跟進');
  });
});
