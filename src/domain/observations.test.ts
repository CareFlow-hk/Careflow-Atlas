import { describe, expect, it } from 'vitest';
import { appendObservations } from './observations';
import { demoSnapshot } from '../data/demoFixture';
import type { OutreachSnapshot, SaveObservationInput } from './types';

const unitId = demoSnapshot.units[0].id;
const buildingId = demoSnapshot.units[0].buildingId;
const floorId = demoSnapshot.units[0].floorId;

function input(overrides: Partial<SaveObservationInput> & { id: string }): SaveObservationInput {
  return {
    visitId: `visit-${overrides.id}`, buildingId, floorId, unitId,
    occurredAt: '2026-03-01T02:00:00.000Z', recordedAt: '2026-03-01T02:00:00.000Z', workerName: '合成工作員',
    coverage: 'VISITED_NO_FINDING', evidence: [], note: '合成內容', ...overrides,
  };
}
const read = (result: ReturnType<typeof appendObservations>) => {
  if ('error' in result) throw new Error(`expected a snapshot, got: ${result.error}`);
  return result.snapshot;
};

describe('appending observations in one step', () => {
  it('appends every record of the batch, in order', () => {
    const next = read(appendObservations(demoSnapshot, [input({ id: 'o1' }), input({ id: 'o2', unitId: demoSnapshot.units[1].id, floorId: demoSnapshot.units[1].floorId })]));
    expect(next.observations.slice(-2).map(item => item.id)).toEqual(['o1', 'o2']);
    expect(next.observations).toHaveLength(demoSnapshot.observations.length + 2);
  });

  it('leaves the snapshot it was given alone', () => {
    const before = JSON.stringify(demoSnapshot);
    read(appendObservations(demoSnapshot, [input({ id: 'o1' })]));
    expect(JSON.stringify(demoSnapshot)).toBe(before);
  });

  /*
   * The batch is written as one snapshot, so a record that cannot be stored stops the
   * whole set rather than leaving some units recorded and others not.
   */
  it('writes nothing when one record in the batch is unusable', () => {
    const result = appendObservations(demoSnapshot, [input({ id: 'o1' }), input({ id: 'o2', coverage: 'NOT_A_COVERAGE' as never })]);
    expect(result).toHaveProperty('error');
  });

  it('refuses the same record id twice in one batch', () => {
    const result = appendObservations(demoSnapshot, [input({ id: 'o1' }), input({ id: 'o1' })]);
    expect(result).toMatchObject({ error: expect.stringContaining('重複') });
  });

  /* Re-sending an identical record is harmless; re-using its id for other content is not. */
  it('accepts an identical record it already holds, and refuses a reused id', () => {
    const once = read(appendObservations(demoSnapshot, [input({ id: 'o1' })]));
    expect(read(appendObservations(once, [input({ id: 'o1' })]))).toBe(once);
    expect(appendObservations(once, [input({ id: 'o1', note: '不同內容' })])).toHaveProperty('error');
  });

  it('records the visit once, however many units the batch covers', () => {
    const next = read(appendObservations(demoSnapshot, [input({ id: 'o1' }), input({ id: 'o2' })]));
    expect(next.visits.filter(visit => visit.id === 'visit-o1')).toHaveLength(1);
    expect(next.visits.at(-1)?.id).toBe('visit-o2');
  });

  it('appends nothing for an empty batch', () => {
    expect(read(appendObservations(demoSnapshot, []))).toBe(demoSnapshot);
  });
});

/* A batch is the same write as a single record, so nothing about the stored shape may differ. */
describe('a batch stores what a single record stores', () => {
  it('keeps the coverage, the note and the time it was given', () => {
    const next = read(appendObservations(demoSnapshot, [input({ id: 'o1', coverage: 'ATTEMPTED', note: '樓梯口有人應門' })]));
    const stored = next.observations.at(-1)!;
    expect(stored).toMatchObject({ coverage: 'ATTEMPTED', note: '樓梯口有人應門', occurredAt: '2026-03-01T02:00:00.000Z' });
    // Synthetic demo flags, as every record in this prototype carries.
    expect(stored).toMatchObject({ isSynthetic: true, provisional: true });
  });

  it('drops keys the schema does not know, so a batch-only flag cannot be stored', () => {
    const next = read(appendObservations(demoSnapshot, [input({ id: 'o1', confirmNoSubdivision: true } as never)]));
    expect(next.observations.at(-1)).not.toHaveProperty('confirmNoSubdivision');
  });
});

/* The schema is what refuses a record, so a caller cannot bypass validation by batching. */
describe('a batch is validated before anything is written', () => {
  const cases: [string, Partial<SaveObservationInput>][] = [
    ['no time', { occurredAt: '' }],
    ['no coverage', { coverage: undefined as never }],
    ['no building', { buildingId: '' }],
  ];
  for (const [name, override] of cases) {
    it(`refuses a record with ${name}`, () => {
      const result = appendObservations(demoSnapshot, [input({ id: 'o1', ...override })]);
      expect(result).toHaveProperty('error');
    });
  }

  it('names the problem in staff wording rather than passing the parser through', () => {
    const result = appendObservations(demoSnapshot, [input({ id: 'o1', occurredAt: '' })]);
    expect('error' in result && result.error).toMatch(/時間/);
  });
});

describe('the snapshot type is not widened by batching', () => {
  it('returns the same snapshot shape', () => {
    const next: OutreachSnapshot = read(appendObservations(demoSnapshot, [input({ id: 'o1' })]));
    expect(Object.keys(next).sort()).toEqual(Object.keys(demoSnapshot).sort());
  });
});
