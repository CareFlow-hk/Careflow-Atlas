import { describe, expect, it } from 'vitest';
import {
  OUTREACH_STATES, aggregate, buildingState, clueOf, currentAssessment, effectiveObservations, floorState,
  followUpBadges, getOpenFollowUps, isTagged, latestInScope, nodeState, openFollowUpsInScope, stateBreakdown, stateOf, tagNode, unitState, withOpenTasks,
  type Building, type ContactOutcome, type CoverageStatus, type Floor, type HousingAssessment, type NodeTag,
  type Observation, type OutreachSnapshot, type State, type Unit,
} from './types';

const flags = { isSynthetic: true as const, provisional: true as const };
const at = (day: number) => new Date(Date.UTC(2026, 0, day, 2, 0, 0)).toISOString();

function observation(id: string, overrides: Partial<Observation> = {}): Observation {
  return { ...flags, id, visitId: `visit-${id}`, buildingId: 'b1', occurredAt: at(1), recordedAt: at(1), workerName: 'w', coverage: 'UNVISITED', evidence: [], ...overrides };
}
function unit(id: string, floorId: string): Unit { return { ...flags, id, buildingId: 'b1', floorId, label: id }; }
function floor(id: string, level: number, tag?: NodeTag): Floor { return { ...flags, id, buildingId: 'b1', level, label: `${level}F`, tag }; }
function building(tag?: NodeTag): Building {
  return { ...flags, id: 'b1', name: '合成示例大廈', address: '合成示例地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true, tag };
}
/** Two floors; floor 1 holds two units, floor 2 holds one. */
function snapshot(observations: Observation[], options: { building?: Building; floors?: Floor[]; units?: Unit[] } = {}): OutreachSnapshot {
  return {
    schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
    buildings: [options.building ?? building()],
    floors: options.floors ?? [floor('f1', 1), floor('f2', 2)],
    units: options.units ?? [unit('u1', 'f1'), unit('u2', 'f1'), unit('u3', 'f2')],
    households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [], visits: [], observations,
  };
}
/** A record on one unit, with the two axes the pipeline reads and an optional open task. */
function unitRecord(id: string, unitId: string, coverage: CoverageStatus, extra: Partial<Observation> = {}): Observation {
  return observation(id, { floorId: unitId.startsWith('u1') || unitId.startsWith('u2') ? 'f1' : 'f2', unitId, coverage, ...extra });
}
function task(action = '再訪', extra: Partial<Observation['followUp']> = {}): Partial<Observation> {
  return { followUp: { action, status: 'OPEN', ...extra } };
}

describe('stateOf: the one colour switch', () => {
  const cases: [string, Partial<Observation>, boolean, State][] = [
    ['no record at all', {}, false, 'GRAY'],
    ['UNKNOWN coverage', { coverage: 'UNKNOWN' }, false, 'GRAY'],
    ['UNVISITED coverage', { coverage: 'UNVISITED' }, false, 'GRAY'],
    ['UNVISITED with an open task stays grey', { coverage: 'UNVISITED' }, true, 'GRAY'],
    ['visited with no finding', { coverage: 'VISITED_NO_FINDING' }, false, 'GREEN'],
    ['visited with no finding plus a task', { coverage: 'VISITED_NO_FINDING' }, true, 'YELLOW'],
    ['visited with a finding', { coverage: 'VISITED_WITH_FINDING' }, false, 'GREEN'],
    ['visited with a finding plus a task', { coverage: 'VISITED_WITH_FINDING' }, true, 'YELLOW'],
    ['partial visit', { coverage: 'PARTIAL' }, false, 'RED'],
    ['partial visit plus a task', { coverage: 'PARTIAL' }, true, 'YELLOW'],
    ['attempted, nobody answered', { coverage: 'ATTEMPTED', contactOutcome: 'NO_ANSWER' }, false, 'RED'],
    ['attempted, nobody answered, with a task', { coverage: 'ATTEMPTED', contactOutcome: 'NO_ANSWER' }, true, 'RED'],
    ['attempted and made contact', { coverage: 'ATTEMPTED', contactOutcome: 'CONTACTED' }, false, 'RED'],
    ['attempted and made contact, with a task', { coverage: 'ATTEMPTED', contactOutcome: 'CONTACTED' }, true, 'YELLOW'],
    ['could not get in', { coverage: 'INACCESSIBLE' }, false, 'RED'],
    ['could not get in, with a task', { coverage: 'INACCESSIBLE' }, true, 'RED'],
    ['could not get in but made contact', { coverage: 'INACCESSIBLE', contactOutcome: 'CONTACTED' }, false, 'RED'],
  ];
  for (const [name, extra, hasOpen, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      const records = extra.coverage ? [unitRecord('o1', 'u1', extra.coverage, extra)] : [];
      expect(stateOf(snapshot(records), { buildingId: 'b1', unitId: 'u1' }, hasOpen)).toBe(expected);
    });
  }

  it('reads the newest record, occurrence time first', () => {
    const older = unitRecord('o1', 'u1', 'UNVISITED');
    const newer = unitRecord('o2', 'u1', 'VISITED_NO_FINDING', { occurredAt: at(5), recordedAt: at(5) });
    expect(stateOf(snapshot([newer, older]), { buildingId: 'b1', unitId: 'u1' }, false)).toBe('GREEN');
    expect(stateOf(snapshot([older, newer]), { buildingId: 'b1', unitId: 'u1' }, false)).toBe('GREEN');
  });

  it('excludes a corrected event from the candidate set', () => {
    const original = unitRecord('o1', 'u1', 'UNVISITED');
    const correction = unitRecord('o2', 'u1', 'VISITED_WITH_FINDING', { occurredAt: at(2), recordedAt: at(3), correctsObservationId: 'o1' });
    expect(stateOf(snapshot([original, correction]), { buildingId: 'b1', unitId: 'u1' }, false)).toBe('GREEN');
  });
});

describe('aggregate: any mixture is yellow', () => {
  it('returns fallback for nothing', () => expect(aggregate([])).toBeUndefined());
  it('keeps a uniform colour', () => {
    for (const state of OUTREACH_STATES) expect(aggregate([state, state, state])).toBe(state);
  });
  it('turns every mixture yellow', () => {
    expect(aggregate(['GREEN', 'RED'])).toBe('YELLOW');
    expect(aggregate(['RED', 'GRAY'])).toBe('YELLOW');
    expect(aggregate(['GREEN', 'GRAY'])).toBe('YELLOW');
    expect(aggregate(['GREEN', 'YELLOW', 'GRAY'])).toBe('YELLOW');
  });
  it('lets yellow beat gray, as ruled', () => {
    expect(aggregate(['YELLOW', 'GRAY'])).toBe('YELLOW');
  });
  it('counts the composition a mixed node is made of', () => {
    expect(stateBreakdown(['GREEN', 'GREEN', 'RED', 'GRAY', 'GRAY', 'GRAY'])).toEqual({ GREEN: 2, YELLOW: 0, RED: 1, GRAY: 3 });
  });
});

describe('nodeState: the node competes with its children in time', () => {
  const units = [unit('u1', 'f1'), unit('u2', 'f1')];
  const childStates: State[] = ['GRAY', 'GRAY'];

  it('a newer building record beats unrecorded units: the early draft would have shown gray', () => {
    const record = observation('o1', { coverage: 'INACCESSIBLE', occurredAt: at(9), recordedAt: at(9) });
    const scene = snapshot([record], { units });
    expect(nodeState(scene, { buildingId: 'b1' }, childStates, latestInScope(scene, { buildingId: 'b1' }))).toBe('RED');
    expect(buildingState(scene, 'b1')).toBe('RED');
  });

  it('a stale building record does not drag newer unit work back', () => {
    const stale = observation('o1', { coverage: 'INACCESSIBLE', occurredAt: at(1), recordedAt: at(1) });
    const fresh = unitRecord('o2', 'u1', 'VISITED_NO_FINDING', { occurredAt: at(9), recordedAt: at(9) });
    const scene = snapshot([stale, fresh], { units });
    expect(buildingState(scene, 'b1')).toBe('YELLOW'); // one green unit, one unrecorded → mixture
    expect(floorState(scene, 'b1', 'f1')).toBe('YELLOW');
  });

  it('no record here and no record below stays gray', () => {
    const scene = snapshot([], { units });
    expect(nodeState(scene, { buildingId: 'b1' }, childStates, undefined)).toBe('GRAY');
    expect(buildingState(scene, 'b1')).toBe('GRAY');
  });

  it('a floor-level record no longer decides its floor: floors are the sum of their units', () => {
    // Decision 2026-09-29: floors keep no record of their own. A legacy one is history only.
    const scene = snapshot([observation('o1', { floorId: 'f1', coverage: 'VISITED_NO_FINDING', occurredAt: at(9), recordedAt: at(9) })], { units });
    expect(floorState(scene, 'b1', 'f1')).toBe('GRAY');
    expect(buildingState(scene, 'b1')).toBe('GRAY');
  });

  it('a floor is exactly the aggregate of its units', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'VISITED_NO_FINDING'), unitRecord('o2', 'u2', 'INACCESSIBLE'),
      observation('o3', { floorId: 'f1', coverage: 'UNVISITED', occurredAt: at(9), recordedAt: at(9) })], { units });
    expect(floorState(scene, 'b1', 'f1')).toBe(aggregate([unitState(scene, 'b1', 'u1'), unitState(scene, 'b1', 'u2')]));
  });
});

describe('three levels read the same switch', () => {
  const combos: [CoverageStatus, ContactOutcome | undefined][] = [
    ['UNVISITED', undefined], ['UNKNOWN', 'NO_ANSWER'], ['VISITED_NO_FINDING', 'CONTACTED'],
    ['VISITED_WITH_FINDING', 'DECLINED'], ['PARTIAL', 'NOT_ATTEMPTED'], ['ATTEMPTED', 'CONTACTED'], ['INACCESSIBLE', 'NO_ANSWER'],
  ];
  for (const [coverage, contactOutcome] of combos) {
    it(`${coverage} + ${contactOutcome ?? 'no contact axis'} reads the same at every level`, () => {
      for (const hasOpen of [false, true]) {
        const unitLevel = stateOf(snapshot([unitRecord('o1', 'u1', coverage, { contactOutcome })], { floors: [], units: [unit('u1', 'f1')] }), { buildingId: 'b1', unitId: 'u1' }, hasOpen);
        const floorLevel = stateOf(snapshot([observation('o1', { floorId: 'f1', coverage, contactOutcome })], { units: [] }), { buildingId: 'b1', floorId: 'f1' }, hasOpen);
        const buildingLevel = stateOf(snapshot([observation('o1', { coverage, contactOutcome })], { floors: [], units: [] }), { buildingId: 'b1' }, hasOpen);
        expect(floorLevel).toBe(unitLevel);
        expect(buildingLevel).toBe(unitLevel);
      }
    });
  }

  it('a floor-level task is not painted onto any unit', () => {
    const scene = snapshot([
      unitRecord('o1', 'u1', 'VISITED_NO_FINDING'),
      observation('o2', { floorId: 'f1', coverage: 'VISITED_NO_FINDING', ...task() }),
    ]);
    expect(unitState(scene, 'b1', 'u1')).toBe('GREEN');
    expect(floorState(scene, 'b1', 'f1')).toBe('YELLOW');
  });
});

describe('the manual tag is a separate marker', () => {
  // Decision 2026-09-29: the tag never recolours, never cascades and never aggregates.
  const records = () => [unitRecord('o1', 'u1', 'VISITED_NO_FINDING'), unitRecord('o2', 'u2', 'INACCESSIBLE')];

  it('changes no colour at any level when a floor is tagged', () => {
    const plain = snapshot(records());
    const tagged = tagNode(plain, { buildingId: 'b1', floorId: 'f1' }, 'FOLLOW_UP');
    for (const id of ['u1', 'u2', 'u3']) expect(unitState(tagged, 'b1', id)).toBe(unitState(plain, 'b1', id));
    for (const id of ['f1', 'f2']) expect(floorState(tagged, 'b1', id)).toBe(floorState(plain, 'b1', id));
    expect(buildingState(tagged, 'b1')).toBe(buildingState(plain, 'b1'));
  });

  it('changes no colour at any level when a building is tagged', () => {
    const plain = snapshot([]);
    const tagged = tagNode(plain, { buildingId: 'b1' }, 'FOLLOW_UP');
    expect(buildingState(tagged, 'b1')).toBe('GRAY');
    expect(floorState(tagged, 'b1', 'f1')).toBe('GRAY');
    expect(unitState(tagged, 'b1', 'u1')).toBe('GRAY');
  });

  it('is visible only on the node it was set on', () => {
    const tagged = tagNode(snapshot([]), { buildingId: 'b1', floorId: 'f1' }, 'FOLLOW_UP');
    expect(isTagged(tagged, { buildingId: 'b1', floorId: 'f1' })).toBe(true);
    expect(isTagged(tagged, { buildingId: 'b1', floorId: 'f2' })).toBe(false);
    expect(isTagged(tagged, { buildingId: 'b1' })).toBe(false);
  });

  it('sets and clears without storing a "no mark" value', () => {
    const marked = tagNode(snapshot([]), { buildingId: 'b1', floorId: 'f1' }, 'FOLLOW_UP');
    expect(marked.floors.find(f => f.id === 'f1')?.tag).toBe('FOLLOW_UP');
    const cleared = tagNode(marked, { buildingId: 'b1', floorId: 'f1' }, undefined);
    expect('tag' in cleared.floors.find(f => f.id === 'f1')!).toBe(false);
  });

  it('never rewrites the record the pipeline reads', () => {
    const before = snapshot([unitRecord('o1', 'u1', 'INACCESSIBLE')]);
    const after = tagNode(before, { buildingId: 'b1' }, 'FOLLOW_UP');
    expect(after.observations).toEqual(before.observations);
    expect(effectiveObservations(after)).toEqual(effectiveObservations(before));
  });
});

describe('a task changes the badge, never the base colour', () => {
  it('keeps a red unit red and still shows the task', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'INACCESSIBLE', task('再訪樓梯口', { category: 'GENERAL' }))]);
    expect(unitState(scene, 'b1', 'u1')).toBe('RED');
    expect(followUpBadges(scene, { buildingId: 'b1', unitId: 'u1' })).toEqual([{ category: 'GENERAL', action: '再訪樓梯口', dueDate: undefined, assignee: undefined, timingNote: undefined }]);
  });

  it('keeps a gray unit gray and still shows the task', () => {
    const scene = snapshot([observation('o1', { unitId: 'u1', floorId: 'f1', coverage: 'UNVISITED', ...task('確認單位是否存在', { category: 'HOUSING_CHANGE' }) })]);
    expect(unitState(scene, 'b1', 'u1')).toBe('GRAY');
    expect(followUpBadges(scene, { buildingId: 'b1', unitId: 'u1' })[0]?.category).toBe('HOUSING_CHANGE');
  });

  it('adds a badge to a yellow unit without moving it off yellow', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'VISITED_NO_FINDING', task())]);
    expect(unitState(scene, 'b1', 'u1')).toBe('YELLOW');
    expect(followUpBadges(scene, { buildingId: 'b1', unitId: 'u1' })).toHaveLength(1);
  });

  it('an open task alone never repaints any level', () => {
    const plain = snapshot([unitRecord('o1', 'u1', 'UNVISITED')]);
    const withTask = snapshot([unitRecord('o1', 'u1', 'UNVISITED', task())]);
    expect(getOpenFollowUps(withTask)).toHaveLength(1);
    expect(unitState(withTask, 'b1', 'u1')).toBe(unitState(plain, 'b1', 'u1'));
    expect(floorState(withTask, 'b1', 'f1')).toBe(floorState(plain, 'b1', 'f1'));
    expect(buildingState(withTask, 'b1')).toBe(buildingState(plain, 'b1'));
  });

  it('groups badges by category and carries the facts a hover needs', () => {
    const scene = snapshot([
      unitRecord('o1', 'u1', 'VISITED_NO_FINDING', task('第一次', { category: 'GENERAL', dueDate: '2026-01-20', assignee: '甲', timingNote: '下週' })),
      observation('o2', { unitId: 'u1', floorId: 'f1', occurredAt: at(2), recordedAt: at(2), coverage: 'VISITED_NO_FINDING', ...task('第二次', { category: 'GENERAL', dueDate: '2026-01-25' }) }),
      observation('o3', { unitId: 'u1', floorId: 'f1', occurredAt: at(3), recordedAt: at(3), coverage: 'VISITED_NO_FINDING', ...task('第三次', { category: 'HEALTH_SUPPORT' }) }),
    ]);
    const badges = followUpBadges(scene, { buildingId: 'b1', unitId: 'u1' });
    expect(badges).toHaveLength(2);
    expect(badges[0]).toMatchObject({ category: 'GENERAL', action: '第一次', dueDate: '2026-01-20', assignee: '甲', timingNote: '下週' });
    expect(badges[1]).toMatchObject({ category: 'HEALTH_SUPPORT', action: '第三次' });
  });

  it('a task with no category is unclassified, not general', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'UNVISITED', { ...task('待確認') })]);
    const [badge] = followUpBadges(scene, { buildingId: 'b1', unitId: 'u1' });
    expect(badge.category).toBeUndefined();
    expect(badge.action).toBe('待確認');
    expect(badge.category).not.toBe('GENERAL');
  });
});

describe('clue markers', () => {
  it('marks a finding on a green unit and leaves it green', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'VISITED_WITH_FINDING')]);
    expect(clueOf(scene, 'b1', 'u1')).toBe('FINDING');
    expect(unitState(scene, 'b1', 'u1')).toBe('GREEN');
  });

  it('marks a finding on a yellow unit and leaves it yellow', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'VISITED_WITH_FINDING', task())]);
    expect(clueOf(scene, 'b1', 'u1')).toBe('FINDING');
    expect(unitState(scene, 'b1', 'u1')).toBe('YELLOW');
  });

  it('keeps the two judgement levels apart', () => {
    const suspected = snapshot([unitRecord('o1', 'u1', 'VISITED_NO_FINDING', { assessment: 'SUSPECTED' })]);
    const verified = snapshot([unitRecord('o1', 'u1', 'VISITED_NO_FINDING', { assessment: 'STAFF_VERIFIED' })]);
    expect(clueOf(suspected, 'b1', 'u1')).toBe('SUSPECTED');
    expect(clueOf(verified, 'b1', 'u1')).toBe('VERIFIED');
  });

  it('does not fire on NO_INDICATION or UNKNOWN', () => {
    for (const assessment of ['NO_INDICATION', 'UNKNOWN'] as HousingAssessment[]) {
      expect(clueOf(snapshot([unitRecord('o1', 'u1', 'VISITED_NO_FINDING', { assessment })]), 'b1', 'u1')).toBeUndefined();
    }
  });

  it('carries a judgement forward over a visit that did not revisit housing', () => {
    const scene = snapshot([
      unitRecord('o1', 'u1', 'VISITED_NO_FINDING', { assessment: 'SUSPECTED' }),
      observation('o2', { unitId: 'u1', floorId: 'f1', occurredAt: at(5), recordedAt: at(5), coverage: 'VISITED_NO_FINDING', assessment: 'NOT_UPDATED' }),
    ]);
    expect(currentAssessment(scene, 'u1')).toBe('SUSPECTED');
    expect(clueOf(scene, 'b1', 'u1')).toBe('SUSPECTED');
  });

  it('lets a stated conclusion replace an earlier suspicion', () => {
    const scene = snapshot([
      unitRecord('o1', 'u1', 'VISITED_NO_FINDING', { assessment: 'SUSPECTED' }),
      observation('o2', { unitId: 'u1', floorId: 'f1', occurredAt: at(5), recordedAt: at(5), coverage: 'VISITED_NO_FINDING', assessment: 'NO_INDICATION' }),
    ]);
    expect(currentAssessment(scene, 'u1')).toBe('NO_INDICATION');
    expect(clueOf(scene, 'b1', 'u1')).toBeUndefined();
  });

  it('a finding and a judgement never split one colour into two', () => {
    const withFinding = snapshot([unitRecord('o1', 'u1', 'VISITED_WITH_FINDING')]);
    const withoutFinding = snapshot([unitRecord('o1', 'u1', 'VISITED_NO_FINDING')]);
    expect(unitState(withFinding, 'b1', 'u1')).toBe(unitState(withoutFinding, 'b1', 'u1'));
  });
});

describe('the two meanings of yellow', () => {
  it('a mixture is yellow with no task at all', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'VISITED_NO_FINDING')], { floors: [floor('f1', 1)], units: [unit('u1', 'f1'), unit('u2', 'f1')] });
    expect(floorState(scene, 'b1', 'f1')).toBe('YELLOW');
    expect(getOpenFollowUps(scene)).toHaveLength(0);
    expect(followUpBadges(scene, { buildingId: 'b1', floorId: 'f1' })).toHaveLength(0);
  });

  it('describes that mixture in words', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'VISITED_NO_FINDING'), unitRecord('o2', 'u2', 'VISITED_NO_FINDING')], { floors: [floor('f1', 1)], units: [unit('u1', 'f1'), unit('u2', 'f1'), unit('u3', 'f1')] });
    const counts = stateBreakdown(scene.units.map(u => unitState(scene, 'b1', u.id)));
    expect(counts).toEqual({ GREEN: 2, YELLOW: 0, RED: 0, GRAY: 1 });
  });

  it('a yellow that carries a task does show a badge', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'VISITED_NO_FINDING', task())]);
    expect(unitState(scene, 'b1', 'u1')).toBe('YELLOW');
    expect(followUpBadges(scene, { buildingId: 'b1', unitId: 'u1' })).toHaveLength(1);
  });
});

/* §10.2: the simplified three-option fields must reproduce all 35 old combinations. */
describe('option simplification keeps every old combination', () => {
  const coverages: CoverageStatus[] = ['UNKNOWN', 'UNVISITED', 'ATTEMPTED', 'PARTIAL', 'VISITED_NO_FINDING', 'VISITED_WITH_FINDING', 'INACCESSIBLE'];
  const contacts: ContactOutcome[] = ['NOT_ATTEMPTED', 'NO_ANSWER', 'DECLINED', 'CONTACTED', 'UNKNOWN'];
  /** The behaviour these 35 combinations had before the options were simplified. */
  const expected = (coverage: CoverageStatus, contact: ContactOutcome, hasOpen: boolean): State => {
    if (coverage === 'UNKNOWN' || coverage === 'UNVISITED') return 'GRAY';
    if (coverage === 'VISITED_NO_FINDING' || coverage === 'VISITED_WITH_FINDING') return hasOpen ? 'YELLOW' : 'GREEN';
    // Reaching nobody leaves a failure; only a partial visit, or one that did reach
    // someone, counts as intermediate — and only a task turns an intermediate yellow.
    const intermediate = coverage === 'PARTIAL' || contact === 'CONTACTED';
    return intermediate && hasOpen ? 'YELLOW' : 'RED';
  };
  it('covers all 35 combinations', () => expect(coverages.length * contacts.length).toBe(35));
  for (const coverage of coverages) for (const contact of contacts) for (const hasOpen of [false, true]) {
    it(`${coverage} + ${contact}${hasOpen ? ' + open task' : ''}`, () => {
      const scene = snapshot([unitRecord('o1', 'u1', coverage, { contactOutcome: contact })]);
      expect(stateOf(scene, { buildingId: 'b1', unitId: 'u1' }, hasOpen)).toBe(expected(coverage, contact, hasOpen));
    });
  }
});
/*
 * 裁定（2026-09-26）：黃色優先於綠色。綠的定義是「完成且無 OPEN 跟進」，所以只要
 * 節點內仍有未結跟進，它就不是綠的——即使它的覆蓋率看起來已經做完。紅與灰不動。
 *
 * 缺口只在聚合那一支：節點自身的舊記錄被較新的子記錄比下去時，`nodeState` 回傳
 * 子節點的聚合色，而那一支從前不看 hasOpen。所以重現必須是「本層舊記錄帶 OPEN
 * 跟進 + 樓下單位較新且已完成」——單位的底色本身已經是黃，測不出這個缺口。
 */
describe('yellow outranks green when a task is still open', () => {
  const units = [unit('u1', 'f1')];
  const floors = [floor('f1', 1)];

  /** A floor-level record from day 1 with an open task, plus a newer finished unit. */
  const staleTaskAndFreshUnit = () => snapshot([
    observation('o1', { floorId: 'f1', occurredAt: at(1), recordedAt: at(1), coverage: 'ATTEMPTED', ...task('再走一次樓梯口') }),
    unitRecord('o2', 'u1', 'VISITED_NO_FINDING', { occurredAt: at(9), recordedAt: at(9) }),
  ], { units, floors });

  it('a floor whose units are all green but which still has a task is not green', () => {
    const scene = staleTaskAndFreshUnit();
    // The floor's own record loses the time race, so the children decide — and the one
    // child is green, which is exactly how this used to come back green with a task on it.
    expect(aggregate([unitState(scene, 'b1', 'u1')])).toBe('GREEN');
    expect(openFollowUpsInScope(scene, { buildingId: 'b1', floorId: 'f1' })).toHaveLength(1);
    expect(floorState(scene, 'b1', 'f1')).toBe('YELLOW');
    expect(buildingState(scene, 'b1')).toBe('YELLOW');
  });

  it('says the same at the building level, where the building record loses to a floor', () => {
    const scene = snapshot([
      observation('o1', { occurredAt: at(1), recordedAt: at(1), coverage: 'ATTEMPTED', ...task('問管理處') }),
      unitRecord('o2', 'u1', 'VISITED_NO_FINDING', { occurredAt: at(9), recordedAt: at(9) }),
    ], { units, floors });
    expect(aggregate([floorState(scene, 'b1', 'f1')])).toBe('GREEN');
    expect(buildingState(scene, 'b1')).toBe('YELLOW');
  });

  it('is the rule, not a side effect: green with no task is still green', () => {
    const scene = snapshot([
      observation('o1', { floorId: 'f1', occurredAt: at(1), recordedAt: at(1), coverage: 'ATTEMPTED' }),
      unitRecord('o2', 'u1', 'VISITED_NO_FINDING', { occurredAt: at(9), recordedAt: at(9) }),
    ], { units, floors });
    expect(floorState(scene, 'b1', 'f1')).toBe('GREEN');
    expect(withOpenTasks('GREEN', true)).toBe('YELLOW');
    expect(withOpenTasks('GREEN', false)).toBe('GREEN');
  });

  it('leaves red alone: a failure is still a failure with a task on it', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'INACCESSIBLE', task())], { units, floors });
    expect(unitState(scene, 'b1', 'u1')).toBe('RED');
    expect(withOpenTasks('RED', true)).toBe('RED');
  });

  it('leaves grey alone: nothing recorded is not the same as nothing outstanding', () => {
    const scene = snapshot([unitRecord('o1', 'u1', 'UNVISITED', task())], { units, floors });
    expect(unitState(scene, 'b1', 'u1')).toBe('GRAY');
    expect(withOpenTasks('GRAY', true)).toBe('GRAY');
  });

  it('a closed task does not hold a green node back', () => {
    const done = unitRecord('o1', 'u1', 'VISITED_NO_FINDING', { followUp: { action: '再訪', status: 'DONE' } });
    const scene = snapshot([done], { units, floors });
    expect(getOpenFollowUps(scene)).toHaveLength(0);
    expect(floorState(scene, 'b1', 'f1')).toBe('GREEN');
  });

  it('never makes a node greener or redder than the leaf switch would', () => {
    // Whatever the branch, a node may only ever move off green; the leaf path already
    // applies the rule, so applying it again at the node must change nothing there.
    for (const coverage of ['VISITED_NO_FINDING', 'VISITED_WITH_FINDING', 'PARTIAL', 'ATTEMPTED', 'INACCESSIBLE', 'UNVISITED'] as const) {
      for (const hasOpen of [true, false]) {
        const scene = snapshot([unitRecord('o1', 'u1', coverage, hasOpen ? task() : {})], { units, floors });
        expect(withOpenTasks(unitState(scene, 'b1', 'u1'), hasOpen)).toBe(unitState(scene, 'b1', 'u1'));
      }
    }
  });
});
