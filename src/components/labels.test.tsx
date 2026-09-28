import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BuildingDetail } from './BuildingDetail';
import { ObservationEditor } from './ObservationEditor';
import { ObservationHistory } from './ObservationHistory';
import {
  assessmentLabels, assessmentOptions, clueLabels, contactLabels, contactOptionGroups, coverageLabels,
  coverageOptionGroups, sourceLabels, sourceOptions, stateColors, stateLabels, supportCategoryLabels,
  uncategorisedFollowUpLabel,
} from '../domain/presentation';
import { clueOf, unitState, type Observation, type OutreachSnapshot } from '../domain/types';
import { addCustomOption, choiceValue, customOptions, impliedByCoverage, menuChoices, OTHER_CHOICE } from '../domain/optionPrefs';

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
function renderDetail(snapshot: OutreachSnapshot) {
  return renderToStaticMarkup(<BuildingDetail snapshot={snapshot} selectedBuildingId="b1" selectedFloorId="f1" selectedUnitId="u1"
    onSelectFloor={noop} onSelectUnit={noop} onToggleTag={noop} onStartObservation={noop} />);
}
function renderHistory(snapshot: OutreachSnapshot) {
  return renderToStaticMarkup(<ObservationHistory snapshot={snapshot} subjectId="u1" />);
}

describe('a status reads the same wherever it appears', () => {
  for (const coverage of ['UNVISITED', 'ATTEMPTED', 'VISITED_NO_FINDING', 'VISITED_WITH_FINDING', 'INACCESSIBLE'] as const) {
    it(`${coverage} shows one sentence in the unit cell, the floor strip and the history`, () => {
      const snapshot = scene([observation({ id: 'o1', coverage })]);
      const detail = renderDetail(snapshot);
      const history = renderHistory(snapshot);
      // The unit cell names the four-state result; the history chip names the coverage.
      expect(detail).toContain(stateLabels[unitState(snapshot, 'b1', 'u1')]);
      expect(detail).toContain(`title="${coverageLabels[coverage]}"`);
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

describe('history chips keep every axis', () => {
  it('shows all five housing judgements', () => {
    for (const assessment of Object.keys(assessmentLabels) as (keyof typeof assessmentLabels)[]) {
      expect(renderHistory(scene([observation({ id: 'o1', assessment })]))).toContain(assessmentLabels[assessment]);
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
    expect(renderDetail(snapshot)).toContain(clueLabels.FINDING);
  });

  it('keeps the two judgement levels visually apart', () => {
    const suspected = renderDetail(scene([observation({ id: 'o1', assessment: 'SUSPECTED' })]));
    const verified = renderDetail(scene([observation({ id: 'o1', assessment: 'STAFF_VERIFIED' })]));
    expect(suspected).toContain(clueLabels.SUSPECTED);
    expect(verified).toContain(clueLabels.VERIFIED);
    expect(suspected).not.toContain(clueLabels.VERIFIED);
    expect(verified).not.toContain(clueLabels.SUSPECTED);
    expect(suspected).toContain('cf-clue');
    expect(verified).toContain('cf-clue--verified');
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
    expect(markup).toContain('（今次未更新）');
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
    optionPrefs={prefs} onOptionPrefsChange={noop} onClose={noop} onSubmit={noop} />);

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
    for (const legend of ['覆蓋狀態', '住房判斷', '資料來源', '跟進類別']) expect(markup).toContain(`<legend>${legend}</legend>`);
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

  it('names the fields that do not colour anything, rather than showing a false dot', () => {
    expect(markup).toContain('不影響底色');
    expect(markup).toContain('（今次未更新）');
  });
});

/*
 * §10.4: the three descriptive rows close with 「其他」, and its box opens in the row
 * itself rather than through a details panel. What the click does cannot be simulated
 * here — the environment has no DOM — so the rule it triggers lives in
 * `descriptiveAnswer` and is tested there; these check that the row is wired to it.
 */
describe('the free-text 「其他」 closes the descriptive rows (§10.4)', () => {
  const markup = renderToStaticMarkup(<ObservationEditor open targetLabel="合成大廈 · A室" subjectId="u1" onClose={noop} onSubmit={noop} />);

  it('offers it on 住房判斷, 資料來源 and 跟進類別, and nowhere else', () => {
    const offered = markup.split('cf-choice--other').length - 1;
    // Three rows carry it; coverage does not, because it is the one row that decides a colour.
    expect(offered).toBe(3);
    expect(markup.split(`value="${OTHER_CHOICE}"`).length - 1).toBe(3);
  });

  it('keeps the box shut until 「其他」 is the chosen answer', () => {
    // Nothing is chosen on open, so no row shows a text box yet.
    expect(markup).not.toContain('cf-choice__other');
  });

  it('does not let the built-in 資料來源 option read as a second 「其他」', () => {
    // The list must hold one way out of it, not two entries that look the same.
    expect(markup.split('>其他<').length - 1).toBe(3);
  });
});

/*
 * 接觸結果 left the entry form, so a new record's outcome is the one its coverage implies.
 * Showing it would only repeat the coverage chip beside it — but an older record may hold
 * a pair that was chosen apart, and that difference is a fact the history must keep.
 */
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

  it('leaves a record with no category at all unclassified', () => {
    expect(classLine(renderHistory(scene([observation({ id: 'o1', followUp })])))).toBe(uncategorisedFollowUpLabel);
  });

  it('keeps a stored category when that is what was chosen', () => {
    const snapshot = scene([observation({ id: 'o1', followUp: { ...followUp, category: 'HEALTH_SUPPORT' } })]);
    expect(classLine(renderHistory(snapshot))).toBe(supportCategoryLabels.HEALTH_SUPPORT);
  });
});
