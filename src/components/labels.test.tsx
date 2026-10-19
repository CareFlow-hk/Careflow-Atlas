import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BuildingDetail } from './BuildingDetail';
import { ObservationEditor } from './ObservationEditor';
import { ObservationHistory } from './ObservationHistory';
import {
  assessmentLabels, assessmentMarks, assessmentOptions, clueLabels, clueMarks, contactLabels, contactOptionGroups, coverageLabels,
  coverageOptionGroups, sourceLabels, sourceOptions, stateColors, stateLabels, supportCategoryLabels,
  uncategorisedFollowUpLabel,
} from '../domain/presentation';
import { clueOf, currentAssessment, recordFollowUpEvent, tagNode, unitState, type Observation, type OutreachSnapshot } from '../domain/types';
import { addCustomOption, choiceValue, customOptions, impliedByCoverage, menuChoices } from '../domain/optionPrefs';

const flags = { isSynthetic: true as const, provisional: true as const };
function observation(overrides: Partial<Observation> & { id: string }): Observation {
  return {
    ...flags, visitId: `visit-${overrides.id}`, buildingId: 'b1', floorId: 'f1', unitId: 'u1',
    occurredAt: '2026-01-05T02:00:00.000Z', recordedAt: '2026-01-05T02:00:00.000Z', workerName: '合成工作員',
    coverage: 'VISITED_NO_FINDING', evidence: [], ...overrides,
  };
}
function scene(observations: Observation[]): OutreachSnapshot {
  return {
    schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
    buildings: [{ ...flags, id: 'b1', name: '合成大廈', address: '合成地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true }],
    floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 1, label: '1F' }],
    units: [{ ...flags, id: 'u1', buildingId: 'b1', floorId: 'f1', label: 'A室' }],
    households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [], visits: [], observations,
  };
}

const noop = () => {};
function renderDetail(snapshot: OutreachSnapshot, selectedUnitId = 'u1') {
  return renderToStaticMarkup(<BuildingDetail snapshot={snapshot} selectedBuildingId="b1" selectedFloorId="f1" selectedUnitId={selectedUnitId}
    onSelectFloor={noop} onSelectUnit={noop} onToggleTag={noop} onStartObservation={noop} />);
}
function renderHistory(snapshot: OutreachSnapshot) {
  return renderToStaticMarkup(<ObservationHistory snapshot={snapshot} subjectId="u1" />);
}
/*
 * The elevation key above the matrix names every mark the blocks can show, and the ledger
 * below repeats the selected unit's words, so a whole-document search cannot tell one
 * cell's mark from the key's. These two brackets say which part is being asked about.
 */
const cellMarkup = (html: string) => html.match(/<button[^>]*role="gridcell"[^>]*>.*?<\/button>/)?.[0] ?? '';
const matrixMarkup = (html: string) => html.slice(html.indexOf('cf-matrix'), html.indexOf('cf-selected-unit'));
/* The key is two lines — the marked marks, then the unmarked words — and both are the key. */
const keyLine = (html: string) => [...html.matchAll(/<p class="cf-plate__key">([^<]*)<\/p>/g)].map(match => match[1]).join(' · ');

describe('a status reads the same wherever it appears', () => {
  for (const coverage of ['UNVISITED', 'ATTEMPTED', 'VISITED_NO_FINDING', 'VISITED_WITH_FINDING', 'INACCESSIBLE'] as const) {
    it(`${coverage} shows one sentence in the unit cell, the floor strip and the history`, () => {
      const snapshot = scene([observation({ id: 'o1', coverage })]);
      const detail = renderDetail(snapshot);
      const history = renderHistory(snapshot);
      // The unit cell names the four-state result; the history chip names the coverage.
      expect(detail).toContain(stateLabels[unitState(snapshot, 'b1', 'u1')]);
      expect(detail).toContain(coverageLabels[coverage]);
      expect(history).toContain(coverageLabels[coverage]);
      // No older wording may reappear anywhere in either view.
      for (const retired of ['覆蓋未明', '由工作人員確認', '未能確定']) expect(detail + history).not.toContain(retired);
    });
  }

  it('never leaks the raw enum onto the screen', () => {
    const markup = renderDetail(scene([observation({ id: 'o1' })])) + renderHistory(scene([observation({ id: 'o1' })]));
    for (const value of ['VISITED_NO_FINDING', 'NOT_UPDATED', 'STAFF_OBSERVATION']) expect(markup).not.toContain(value);
  });
});

/*
 * A task's 標記完成／撤銷／取消跟進 lines append with every press and are rarely what someone
 * came to the record for, so they start folded behind one button (2026-10-19 review). The
 * lines stay in the document with `hidden`, ready as soon as it is opened.
 */
describe('a task trail is folded behind one button', () => {
  const followUp = { action: '再訪', status: 'OPEN' as const };
  const events = [
    { ...flags, id: 'e1', observationId: 'o1', action: 'DONE' as const, at: '2026-01-05T03:00:00.000Z', operator: { accountId: 'a1', name: '同事甲' } },
    { ...flags, id: 'e2', observationId: 'o1', action: 'REOPENED' as const, at: '2026-01-05T04:00:00.000Z', operator: { accountId: 'a1', name: '同事甲' } },
  ];
  const markup = renderToStaticMarkup(<ObservationHistory snapshot={{ ...scene([observation({ id: 'o1', followUp })]), followUpEvents: events }}
    subjectId="u1" onFollowUpAction={noop} />);

  it('starts closed and says how many entries there are', () => {
    expect(markup).toContain('歷史記錄');
    expect(markup).toContain('2 筆');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls=');
    expect(markup).toContain('hidden=""');
  });

  it('keeps the entries in the document for when it is opened', () => {
    expect(markup).toContain('同事甲');
    expect(markup).toContain('標記完成');
    expect(markup).toContain('撤銷');
    // One trail only: the button names it, and the list is not printed twice.
    expect(markup.match(/跟進處理記錄/g)).toHaveLength(1);
  });
});

describe('history chips keep every axis', () => {
  it('shows every housing judgement that says something, and no chip for 無更新', () => {
    for (const assessment of Object.keys(assessmentLabels) as (keyof typeof assessmentLabels)[]) {
      const html = renderHistory(scene([observation({ id: 'o1', assessment })]));
      if (assessment === 'NOT_UPDATED') expect(html).not.toContain(assessmentLabels[assessment]);
      else expect(html).toContain(assessmentLabels[assessment]);
    }
  });

  it('shows a source chip when a source was recorded', () => {
    const markup = renderHistory(scene([observation({ id: 'o1', sourceType: 'RESIDENT_REPORT' })]));
    expect(markup).toContain(sourceLabels.RESIDENT_REPORT);
  });

  it('shows no source chip at all when nothing was recorded', () => {
    const markup = renderHistory(scene([observation({ id: 'o1' })]));
    // "Not recorded" must stay silent rather than read as "source unknown".
    expect(markup).not.toContain(sourceLabels.UNKNOWN);
    expect(markup).not.toContain('cf-chip--source');
  });

  it('prints a self-defined wording in place of the enum label', () => {
    const markup = renderHistory(scene([observation({ id: 'o1', coverage: 'ATTEMPTED', optionNotes: { coverage: '只走到樓梯口' } })]));
    expect(markup).toContain('只走到樓梯口');
    expect(markup).not.toContain(coverageLabels.ATTEMPTED);
  });
});

describe('two markers, never a fifth colour', () => {
  it('badges a task on a red unit and leaves the colour alone', () => {
    const snapshot = scene([observation({ id: 'o1', coverage: 'INACCESSIBLE', followUp: { action: '再訪樓梯口', status: 'OPEN', category: 'GENERAL' } })]);
    const markup = renderDetail(snapshot);
    expect(unitState(snapshot, 'b1', 'u1')).toBe('RED');
    expect(markup).toContain('一般跟進'); // the badge names the task
    expect(markup).toContain('未能完成'); // the unit keeps its own colour label
  });

  it('shows the generic badge when a task has no category', () => {
    const snapshot = scene([observation({ id: 'o1', coverage: 'INACCESSIBLE', followUp: { action: '待確認', status: 'OPEN' } })]);
    const markup = renderDetail(snapshot);
    expect(markup).toContain(uncategorisedFollowUpLabel);
    expect(markup).not.toContain('一般跟進');
  });

  it('shows a clue marker without changing the colour', () => {
    const snapshot = scene([observation({ id: 'o1', coverage: 'VISITED_WITH_FINDING' })]);
    expect(clueOf(snapshot, 'b1', 'u1')).toBe('FINDING');
    expect(unitState(snapshot, 'b1', 'u1')).toBe('GREEN');
    // Named for a screen reader, unmarked for the eye: the block's corner is for the
    // housing judgement, and a finding is not one.
    const cell = cellMarkup(renderDetail(snapshot));
    expect(cell).toContain(clueLabels.FINDING);
    expect(cell).not.toContain('cf-cell__clue');
  });

  it('keeps the two judgement levels visually apart', () => {
    const suspected = cellMarkup(renderDetail(scene([observation({ id: 'o1', assessment: 'SUSPECTED' })])));
    const verified = cellMarkup(renderDetail(scene([observation({ id: 'o1', assessment: 'STAFF_VERIFIED' })])));
    expect(suspected).toContain(clueMarks.SUSPECTED);
    expect(verified).toContain(clueMarks.VERIFIED);
    expect(suspected).not.toContain(clueMarks.VERIFIED);
    expect(verified).not.toContain(clueMarks.SUSPECTED);
    // The words beside the mark are the ones the entry form offered.
    expect(suspected).toContain(clueLabels.SUSPECTED);
    expect(verified).toContain(clueLabels.VERIFIED);
    expect(suspected).toContain('cf-cell__clue');
    expect(suspected).not.toContain('cf-cell__clue is-verified');
    expect(verified).toContain('cf-cell__clue is-verified');
  });
});

/*
 * The housing answer, in one set of words (2026-10-15): the entry form's choices, the
 * elevation key and the mark in the block are three views of the same table. What the
 * colour keeps saying is what the visit was; the mark only ever says what was found.
 */
describe('the housing mark and the housing words are the same statement', () => {
  const editor = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A室" subjectId="u1" onClose={noop} onSubmit={noop} />);
  const cell = (item: Observation) => cellMarkup(renderDetail(scene([item])));

  it('names the same words on the entry form and in the elevation key', () => {
    const key = keyLine(renderDetail(scene([observation({ id: 'o1' })])));
    for (const option of assessmentOptions) {
      expect(editor).toContain(option.label);
      expect(key).toContain(option.label);
      // Where there is a mark, the key shows the mark the block shows, beside that word.
      if (assessmentMarks[option.value]) expect(key).toContain(`${assessmentMarks[option.value]} ${option.label}`);
    }
    // 無更新 is the blank choice: no mark, and it stores nothing.
    expect(editor).toContain(assessmentLabels.NOT_UPDATED);
    expect(key).toContain(assessmentLabels.NOT_UPDATED);
    expect(assessmentMarks.NOT_UPDATED).toBe('');
  });

  it('marks 疑似劏房 with ？ and 已確認 with ✓, and answers nothing else with a mark', () => {
    expect(cell(observation({ id: 'o1', assessment: 'SUSPECTED' }))).toContain('？');
    expect(cell(observation({ id: 'o1', assessment: 'STAFF_VERIFIED' }))).toContain('✓');
    // 未見相關跡象 is a conclusion, but one with nothing to point at.
    expect(cell(observation({ id: 'o1', assessment: 'NO_INDICATION' }))).not.toContain('cf-cell__clue');
    // 無更新 judges nothing, so the block keeps only what the colour says.
    expect(cell(observation({ id: 'o1', assessment: 'NOT_UPDATED' }))).not.toContain('cf-cell__clue');
  });

  it('leaves the last judgement standing when a later record updates nothing', () => {
    const snapshot = scene([
      observation({ id: 'o1', occurredAt: '2026-01-05T02:00:00.000Z', assessment: 'STAFF_VERIFIED' }),
      observation({ id: 'o2', occurredAt: '2026-02-05T02:00:00.000Z', assessment: 'NOT_UPDATED' }),
    ]);
    expect(currentAssessment(snapshot, 'u1')).toBe('STAFF_VERIFIED');
    expect(cellMarkup(renderDetail(snapshot))).toContain(clueMarks.VERIFIED);
  });

  it('marks a split unit once, on the group, and marks none of its rooms', () => {
    const snapshot = scene([
      observation({ id: 'o1', assessment: 'STAFF_VERIFIED' }),
      // A room carrying its own judgement: the slice still shows no mark, because a slice
      // already is a 劏房 room and a mark on it would only repeat the shape of the block.
      observation({ id: 'o2', unitId: 'r1', assessment: 'SUSPECTED' }),
    ]);
    snapshot.units.push({ ...flags, id: 'r1', buildingId: 'b1', floorId: 'f1', label: 'A1室', parentUnitId: 'u1' });
    const matrix = matrixMarkup(renderDetail(snapshot));
    expect(matrix.split('cf-cell__clue').length - 1).toBe(1);
    expect(matrix).toContain(clueMarks.VERIFIED);
    expect(matrix).not.toContain(clueMarks.SUSPECTED);
    expect(matrix).toContain(clueLabels.SUSPECTED); // still named in the room's own label
  });
});

/*
 * Splitting a visited unit must not lose the visit. The room is where the unit's space now
 * is, so it carries the unit's colour rather than opening blank, and the ledger says the
 * value came from the unit rather than from a visit to this room (2026-10-15).
 */
describe('a split unit keeps its colour on the rooms that replaced it', () => {
  const splitScene = () => {
    const snapshot = scene([observation({ id: 'o1', coverage: 'VISITED_NO_FINDING' })]);
    snapshot.units.push({ ...flags, id: 'r1', buildingId: 'b1', floorId: 'f1', label: 'A1室', parentUnitId: 'u1' });
    return snapshot;
  };

  it('shows the unit’s colour on the room, not an empty block', () => {
    const matrix = matrixMarkup(renderDetail(splitScene()));
    expect(matrix).toContain('is-green is-room');
    expect(matrix).not.toContain('is-gray');
  });

  it('says in the ledger that the 最近 value is the unit’s, and where its own records are', () => {
    const ledger = renderDetail(splitScene(), 'r1');
    expect(ledger).toContain('承自分拆前的原單位');
    // The room's own history is still its own, and says so rather than reading as lost work.
    expect(ledger).toContain('這間房還未有自己的記錄');
  });

  it('claims nothing of the sort for a unit that was never split', () => {
    expect(renderDetail(scene([observation({ id: 'o1' })]))).not.toContain('承自分拆前的原單位');
  });
});

describe('the editor offers the shared option tables', () => {
  const markup = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A室" subjectId="u1" onClose={noop} onSubmit={noop} />);

  it('lists exactly the three coverage choices and their canonical values', () => {
    for (const option of coverageOptionGroups) {
      expect(markup).toContain(`value="${option.canonical}"`);
    }
  });

  /*
   * 接觸結果 is answered by the coverage now, so the editor no longer offers the three
   * contact choices as a row of their own. What it stores is unchanged: `impliedByCoverage`
   * still picks the outcome, and the pipeline reads it exactly as it read an old record.
   */
  it('no longer offers the contact choices as a row of their own', () => {
    for (const option of contactOptionGroups) expect(markup).not.toContain(option.label);
    expect(impliedByCoverage('contactOutcome', 'UNVISITED')).toBe('NOT_ATTEMPTED');
    expect(impliedByCoverage('contactOutcome', 'VISITED_NO_FINDING')).toBe('CONTACTED');
  });

  it('lets housing and source be left blank', () => {
    expect(markup).toContain('value=""');
    expect(markup).toContain(assessmentLabels.NOT_UPDATED);
    expect(markup).toContain('未分類');
    for (const option of assessmentOptions) expect(markup).toContain(option.label);
    for (const option of sourceOptions) expect(markup).toContain(option.label);
  });

  it('carries no second copy of a label table', () => {
    for (const value of Object.values(coverageLabels)) {
      const appearances = markup.split(value).length - 1;
      expect(appearances).toBeLessThanOrEqual(1);
    }
  });
});

describe('self-defined choices reach the menu (§10.4)', () => {
  const prefs = addCustomOption({}, 'coverage', { label: '只走到樓梯口', mapsTo: 'ATTEMPTED' });
  const markup = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A室" subjectId="u1"
    optionPrefs={prefs} onClose={noop} onSubmit={noop} />);

  it('adds the wording to the menu without removing a built-in', () => {
    expect(markup).toContain('只走到樓梯口');
    for (const option of coverageOptionGroups) expect(markup).toContain(option.label);
  });

  it('keeps the wording out of the value, so the enum never widens', () => {
    const [option] = customOptions(prefs, 'coverage');
    expect(markup).toContain(`value="${choiceValue(option)}"`);
    expect(markup).not.toContain(`value="只走到樓梯口"`);
  });

  it('adds exactly one choice and takes no built-in away', () => {
    const count = (html: string) => html.split('name="coverageStatus"').length - 1;
    const plain = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A室" subjectId="u1" onClose={noop} onSubmit={noop} />);
    for (const option of coverageOptionGroups) expect(plain).toContain(option.label);
    expect(count(plain)).toBe(menuChoices('coverage', {}).length);
    expect(count(markup)).toBe(menuChoices('coverage', {}).length + 1);
  });

  it('reads a saved record back in the wording that was chosen', () => {
    // What the editor stores for a custom choice: the declared value plus the wording.
    const snapshot = scene([observation({ id: 'o1', coverage: 'ATTEMPTED', optionNotes: { coverage: '只走到樓梯口' } })]);
    const history = renderHistory(snapshot);
    expect(history).toContain('只走到樓梯口');
    // The generic label must give way, or the chip would contradict the wording.
    expect(history).not.toContain(coverageLabels.ATTEMPTED);
    // And the state it declared is what the pipeline read.
    expect(unitState(snapshot, 'b1', 'u1')).not.toBe('GREEN');
  });

  it('still reads a record whose option has since been deleted or hidden', () => {
    const stored = observation({ id: 'o1', coverage: 'ATTEMPTED', optionNotes: { coverage: '只走到樓梯口' } });
    // Nothing about rendering consults the preference list.
    expect(renderHistory(scene([stored]))).toContain('只走到樓梯口');
  });
});

/*
 * A dropdown cannot carry a colour dot, so the entry fields are rows of choices. The dot
 * is the colour that choice would produce, quoted from the same rule the map and the lists
 * use — a second copy of the rule here would be a bug, not a test.
 */
describe('the entry form shows what each choice would colour (§10.4)', () => {
  const markup = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A室" subjectId="u1" onClose={noop} onSubmit={noop} />);
  const dot = (state: keyof typeof stateColors) => `--cf-state:${stateColors[state]}`;
  const dots = (html: string) => html.split('cf-choice__dot').length - 1;

  it('offers the fields as choices, not as dropdowns', () => {
    for (const field of ['coverageStatus', 'housingAssessment', 'sourceType', 'category']) {
      expect(markup).toContain(`name="${field}"`);
    }
    for (const legend of ['覆蓋狀態', '住房判斷', '資料來源', '跟進類別']) expect(markup).toContain(`<legend>${legend}`);
  });

  /*
   * 接觸結果 followed the coverage so closely that the two rows read as one question.
   * It is still stored — derived from the coverage on save — but it is no longer asked,
   * and the row must not creep back in.
   */
  it('no longer asks for 接觸結果, which the coverage already answers', () => {
    expect(markup).not.toContain('name="contactOutcome"');
    expect(markup).not.toContain('<legend>接觸結果</legend>');
  });

  it('puts a dot on every choice that decides a colour, and on none that does not', () => {
    // Coverage is the only row left that decides the colour; the other three are recorded.
    expect(dots(markup)).toBe(menuChoices('coverage', {}).length);
  });

  it('colours 未到訪 gray and 已完成探訪 green, without a task in hand', () => {
    expect(markup).toContain(dot('GRAY'));
    expect(markup).toContain(dot('GREEN'));
  });

  it('colours 未能完成探訪 red, the one choice that is red on its own', () => {
    expect(markup).toContain(dot('RED'));
  });

  it('carries no developer notes about colours under the rows', () => {
    expect(markup).not.toContain('不影響底色');
    expect(markup).not.toContain('顏色小點');
  });
});

/* v1 (2026-09-29): no row has a free-text 「其他」 — every stored answer stays searchable. */
describe('the entry form has no free-text 「其他」', () => {
  const markup = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A室" subjectId="u1" onClose={noop} onSubmit={noop} />);
  it('offers no 「其他」 on any row', () => {
    expect(markup).not.toContain('cf-choice--other');
    expect(markup).not.toContain('>其他<');
  });
  it('pre-selects no coverage, and requires one', () => {
    expect(markup).not.toMatch(/name="coverageStatus"[^>]*checked/);
    expect(markup).toMatch(/<input type="radio" required="" name="coverageStatus"/);
  });
  it('has one free-text box for the record, and folds the rest under 更多', () => {
    expect(markup).toContain('name="note"');
    expect(markup).not.toContain('name="finding"');
    expect(markup).not.toContain('name="noteCoverage"');
    expect(markup).toContain('更多跟進資料');
  });
  it('does not offer to close a task from the form', () => {
    expect(markup).not.toContain('resolvesObservationId');
  });
});

describe('the history shows 接觸結果 only when it says more than the coverage', () => {
  it('stays silent when the outcome is the one the coverage implies', () => {
    const implied = renderHistory(scene([observation({ id: 'o1', coverage: 'ATTEMPTED', contactOutcome: 'NO_ANSWER' })]));
    expect(implied).not.toContain(contactLabels.NO_ANSWER);
  });

  it('shows the outcome when it was recorded apart from the coverage', () => {
    // 未能完成探訪 yet 已接觸: they did reach someone, they just could not finish.
    const apart = renderHistory(scene([observation({ id: 'o1', coverage: 'ATTEMPTED', contactOutcome: 'CONTACTED' })]));
    expect(apart).toContain(contactLabels.CONTACTED);
  });

  it('still colours by the outcome that was stored, not by the coverage', () => {
    const snapshot = scene([observation({ id: 'o1', coverage: 'ATTEMPTED', contactOutcome: 'CONTACTED' })]);
    // The pipeline reads the stored outcome; a derived one is only what the form would set.
    expect(unitState(snapshot, 'b1', 'u1')).toBe('RED');
  });
});

describe('a category written out by hand is shown as written (§10.4)', () => {
  const followUp = { action: '再訪', dueDate: '2026-02-01', status: 'OPEN' as const };

  /* The class line, not the whole document: 待跟進 is also the label of the badge above. */
  const classLine = (html: string) => html.match(/<p class="cf-event__note">([^<]*)<\/p>/)?.[1];

  it('names the typed category instead of the generic badge', () => {
    const snapshot = scene([observation({ id: 'o1', followUp, optionNotes: { followUpCategory: '水電維修轉介' } })]);
    // A typed category names no enum, so the generic badge must not stand in for it.
    expect(classLine(renderHistory(snapshot))).toBe('水電維修轉介');
  });

  it('adds no category line when there is no category, since the status already says 待跟進', () => {
    const html = renderHistory(scene([observation({ id: 'o1', followUp })]));
    expect(classLine(html)).toBeUndefined();
    expect(html.split(uncategorisedFollowUpLabel).length - 1).toBe(1);
  });

  it('keeps a stored category when that is what was chosen', () => {
    const snapshot = scene([observation({ id: 'o1', followUp: { ...followUp, category: 'HEALTH_SUPPORT' } })]);
    expect(classLine(renderHistory(snapshot))).toBe(supportCategoryLabels.HEALTH_SUPPORT);
  });
});

/* ---------------------------------------------------------------------------------
 * Decisions of 2026-09-29 (user review of 4b343de).
 * ------------------------------------------------------------------------------- */

/*
 * One result at every picked unit (2026-10-15). The form is the same form — the same
 * choices, storing the same things — with the parts that only make sense for a single place
 * left out, and one extra statement that only makes sense for a set.
 */
describe('the entry form for a whole selection', () => {
  const batch = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · 已選 3 個單位" batch={{ units: 3 }} onClose={noop} onSubmit={noop} />);
  const single = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A室" subjectId="u1" onClose={noop} onSubmit={noop} />);

  it('says what it is about to write, and where', () => {
    expect(batch).toContain('會為已選的 3 個單位各寫入一筆相同的記錄。');
    expect(batch).toContain('記錄內容（會寫進每個單位）');
    expect(single).not.toContain('會為已選的');
  });

  it('asks the same three questions as a single record, in the same words', () => {
    for (const legend of ['覆蓋狀態', '住房判斷', '資料來源']) expect(batch).toContain(`<legend>${legend}`);
    for (const option of assessmentOptions) expect(batch).toContain(option.label);
    expect(batch).toContain(assessmentLabels.NOT_UPDATED);
  });

  /* A follow-up is one place needing one thing done; three units is three different things. */
  it('offers no 跟進 at all, rather than opening a task per unit', () => {
    expect(batch).not.toContain('name="followUpReason"');
    expect(batch).not.toContain('name="followUpDueAt"');
    expect(batch).not.toContain('更多跟進資料');
    // The single-place form still has it.
    expect(single).toContain('name="followUpReason"');
  });

  it('offers the one statement that only a set can make, and leaves it unticked', () => {
    expect(batch).toContain('name="confirmNoSubdivision"');
    expect(batch).toMatch(/name="confirmNoSubdivision"[^>]*\/>/);
    expect(batch).not.toMatch(/name="confirmNoSubdivision"[^>]*checked/);
    // Recording one unit at a time cannot confirm a set, so the box is not there.
    expect(single).not.toContain('name="confirmNoSubdivision"');
  });

  it('keeps the record itself identical: nothing batch-only is stored', () => {
    for (const field of ['name="coverageStatus"', 'name="housingAssessment"', 'name="sourceType"', 'name="note"', 'name="occurredAt"']) {
      expect(batch).toContain(field);
      expect(single).toContain(field);
    }
  });
});

/*
 * What a 劏房 room's form opens with (review, 2026-10-15). Both defaults belong to the
 * room, not to the visit: 住房判斷 restates the split, and 覆蓋狀態 is carried over from
 * the room's own last record and says so. Neither may answer for a visit nobody described —
 * a room with no record opens blank rather than at the ordinary outcome.
 */
describe('the form a 劏房 room opens with', () => {
  const editor = (props: Partial<Parameters<typeof ObservationEditor>[0]>) =>
    renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A1室" subjectId="r1" onClose={noop} onSubmit={noop} {...props} />);
  /* The value of the one choice ticked in that row, or undefined when the row is unanswered. */
  const chosen = (html: string, name: string) =>
    [...html.matchAll(new RegExp(`<input type="radio"[^>]*name="${name}"[^>]*>`, 'g'))].find(tag => tag[0].includes('checked'))?.[0].match(/value="([^"]*)"/)?.[1];

  it('pre-selects the confirmed housing answer, because the room is one', () => {
    expect(chosen(editor({ defaultAssessment: 'STAFF_VERIFIED' }), 'housingAssessment')).toBe('STAFF_VERIFIED');
  });

  it('carries the last coverage over and says that is what it is', () => {
    expect(chosen(editor({ defaultCoverage: 'ATTEMPTED' }), 'coverageStatus')).toBe('ATTEMPTED');
    // Beside the coverage legend, where the value it is about sits.
    expect(editor({ defaultCoverage: 'ATTEMPTED' })).toContain('<legend>覆蓋狀態<span class="cf-choice-row__hint">沿用上次結果</span>');
  });

  it('says nothing about carrying over when there is nothing carried over', () => {
    expect(editor({ defaultAssessment: 'STAFF_VERIFIED' })).not.toContain('沿用上次結果');
    expect(editor({})).not.toContain('沿用上次結果');
  });

  /* The one case the review asked to change: no record, no answer. */
  it('answers nothing at all for a room with no record', () => {
    expect(chosen(editor({ defaultAssessment: 'STAFF_VERIFIED' }), 'coverageStatus')).toBeUndefined();
  });

  /* Ordinary units keep opening unanswered: coverage with nothing ticked, housing on the
     blank choice, which stands for 無更新 and stores nothing. */
  it('leaves an ordinary unit unanswered', () => {
    const plain = editor({});
    expect(chosen(plain, 'coverageStatus')).toBeUndefined();
    expect(chosen(plain, 'housingAssessment')).toBe('');
  });
});

/*
 * The elevation is where a set is picked, so the panel must not offer anything about sets
 * until one exists: an untouched panel is the panel it always was.
 */
describe('the building panel before anything is picked', () => {
  const markup = renderDetail(scene([observation({ id: 'o1' })]));

  it('shows the ordinary footer button, not the bar', () => {
    expect(markup).toContain('cf-record-action');
    expect(markup).not.toContain('cf-pick');
  });

  it('marks no cell as picked', () => {
    expect(markup).not.toContain('is-picked');
  });

  /* Ctrl/Command-clicking is not discoverable on its own, and the batch bar only appears
     after the picking it explains has already been done. */
  it('says under the blocks how a set is picked', () => {
    expect(markup).toContain('Ctrl');
    expect(markup).toContain('Command');
    // It is the elevation's own note, and it is not the key: the key names marks, not keys.
    expect(markup).toContain('cf-plate__hint');
    expect(keyLine(markup).startsWith('↻')).toBe(true);
  });

  /*
   * The marks run down the first line and the words with no mark get a line of their own:
   * a list where every line but the last starts with a mark reads as a table, and the
   * qualifier that has no mark would break it.
   */
  it('keeps the unmarked words on a line of their own', () => {
    const lines = [...markup.matchAll(/<p class="cf-plate__key">([^<]*)<\/p>/g)].map(match => match[1]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`↻ 待跟進 · ${clueMarks.SUSPECTED} ${assessmentLabels.SUSPECTED} · ${clueMarks.VERIFIED} ${assessmentLabels.STAFF_VERIFIED}`);
    expect(lines[1]).toBe(`無符號＝${assessmentLabels.NO_INDICATION}／${assessmentLabels.NOT_UPDATED}`);
  });
});

describe('the form reads back in the words it offered', () => {
  it('shows 未能完成探訪 for what that choice stores, not 曾嘗試', () => {
    const history = renderHistory(scene([observation({ id: 'o1', coverage: 'ATTEMPTED' })]));
    expect(history).toContain('未能完成探訪');
    expect(history).not.toContain('曾嘗試');
  });

  it('shows 已完成探訪 for what that choice stores', () => {
    expect(renderHistory(scene([observation({ id: 'o1', coverage: 'VISITED_NO_FINDING' })]))).toContain('已完成探訪');
  });

  it('keeps the finer wording of older records', () => {
    expect(renderHistory(scene([observation({ id: 'o1', coverage: 'INACCESSIBLE' })]))).toContain(coverageLabels.INACCESSIBLE);
    expect(renderHistory(scene([observation({ id: 'o1', coverage: 'PARTIAL' })]))).toContain(coverageLabels.PARTIAL);
  });
});

describe('self-defined options live in settings, not in the entry form', () => {
  const markup = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A室" subjectId="u1" onClose={noop} onSubmit={noop} />);
  it('has no option manager in the entry form', () => {
    expect(markup).not.toContain('管理常用選項');
    expect(markup).not.toContain('cf-option-manager');
  });
  it("keeps a person's own words in the one 記錄內容 box", () => {
    expect(markup).toContain('記錄內容');
    expect(markup).not.toContain('name="noteCoverage"');
  });
});

describe('a task can be closed without a visit', () => {
  const task = { action: '再訪', status: 'OPEN' as const };
  const operator = { accountId: 'acct-1', name: '合成操作員' };
  const withTask = scene([observation({ id: 'o1', followUp: task })]);
  const history = (snapshot: OutreachSnapshot) => renderToStaticMarkup(<ObservationHistory snapshot={snapshot} subjectId="u1" onFollowUpAction={noop} />);

  it('offers 標記完成 and 取消跟進 on an open task', () => {
    const html = history(withTask);
    expect(html).toContain('標記完成');
    expect(html).toContain('取消跟進');
  });

  it('shows no buttons when the history is read-only', () => {
    expect(renderHistory(withTask)).not.toContain('標記完成');
  });

  it('names who closed it, when, and offers to undo', () => {
    const done = recordFollowUpEvent(withTask, { id: 'e1', observationId: 'o1', action: 'DONE', at: '2026-01-06T02:00:00.000Z', operator });
    const html = history(done);
    expect(html).toContain('已標記完成');
    expect(html).toContain('合成操作員');
    expect(html).toContain('撤銷標記完成');
    expect(html).not.toContain('>取消跟進<');
  });

  it('shows the reason a task was cancelled', () => {
    const cancelled = recordFollowUpEvent(withTask, { id: 'e1', observationId: 'o1', action: 'CANCELLED', reason: '已電話聯絡', at: '2026-01-06T02:00:00.000Z', operator });
    const html = history(cancelled);
    expect(html).toContain('已取消');
    expect(html).toContain('已電話聯絡');
  });
});

describe('the building panel', () => {
  const buildingTask = observation({ id: 'ob', floorId: undefined, unitId: undefined, coverage: 'PARTIAL', followUp: { action: '聯絡中心護士', status: 'OPEN', category: 'HEALTH_SUPPORT' } });

  it('keeps building-level tasks in view while a unit is selected', () => {
    const html = renderDetail(scene([buildingTask]));
    expect(html).toContain('本幢待跟進');
    expect(html).toContain('聯絡中心護士');
  });

  it('names the elevation columns after the units the building actually has', () => {
    const numbered = {
      ...scene([]),
      units: [{ ...flags, id: 'u1', buildingId: 'b1', floorId: 'f1', label: '1室' }, { ...flags, id: 'u2', buildingId: 'b1', floorId: 'f1', label: '2室' }],
    };
    const headers = (html: string) => [...matrixMarkup(html).matchAll(/role="columnheader"[^>]*>([^<]*)</g)].map(match => match[1]);
    // The figures column is the panel's own, not a unit column.
    expect(headers(renderDetail(numbered))).toEqual(['1室', '2室', '完成']);
  });

  it('hides the manual mark in v1 and never lets a stored one change a status', () => {
    const plain = scene([observation({ id: 'o1', coverage: 'VISITED_NO_FINDING' })]);
    const tagged = tagNode(plain, { buildingId: 'b1', floorId: 'f1' }, 'FOLLOW_UP');
    expect(renderDetail(tagged)).not.toContain('已標記跟進');
    expect(renderDetail(tagged)).not.toContain('標記本層');
    expect(renderDetail(tagged)).not.toContain('標記跟進');
    expect(unitState(tagged, 'b1', 'u1')).toBe(unitState(plain, 'b1', 'u1'));
    // The unit cell still reads 已完成, not 需留意.
    const unitCard = (html: string) => html.slice(html.indexOf('cf-matrix'));
    expect(unitCard(renderDetail(tagged))).toContain(stateLabels.GREEN);
    expect(unitCard(renderDetail(tagged))).not.toContain(stateLabels.YELLOW);
  });
});
