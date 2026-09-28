import { describe, expect, it } from 'vitest';
import { OPTION_FIELDS, type OptionField } from './types';
import {
  addCustomOption, applyCoverageChange, builtInChoices, choiceValue, customOptionFor, customOptions,
  dependentDefaults, descriptiveAnswer, impliedByCoverage, isMappedValue, markTouched, menuChoices,
  nextOptionId, OTHER_CHOICE, parseCustomOptions, removeCustomOption, setCustomOptionHidden, type CustomOptions,
} from './optionPrefs';

const allFields: OptionField[] = [...OPTION_FIELDS];

describe('the built-in choices stay locked', () => {
  it('offers exactly three per field, which is what the pipeline is written against', () => {
    for (const field of allFields) expect({ field, count: builtInChoices(field).length }).toEqual({ field, count: 3 });
  });

  it('never lets an option be added without a state to map to (§10.4)', () => {
    for (const field of allFields) {
      const target = builtInChoices(field)[0].value;
      expect(addCustomOption({}, field, { label: '有', mapsTo: target })).toHaveProperty(field);
      // No mapping, an unknown mapping, or a blank label: nothing is stored.
      expect(addCustomOption({}, field, { label: '有', mapsTo: '' })).toEqual({});
      expect(addCustomOption({}, field, { label: '有', mapsTo: 'NOT_A_VALUE' })).toEqual({});
      expect(addCustomOption({}, field, { label: '   ', mapsTo: target })).toEqual({});
    }
  });

  it('refuses a mapping borrowed from another field', () => {
    // SUSPECTED is a housing value; it must not become a coverage option.
    expect(isMappedValue('coverage', 'SUSPECTED')).toBe(false);
    expect(isMappedValue('assessment', 'SUSPECTED')).toBe(true);
    expect(addCustomOption({}, 'coverage', { label: '疑似', mapsTo: 'SUSPECTED' })).toEqual({});
  });

  it('offers the built-ins first and unchanged, whatever has been added', () => {
    const prefs = addCustomOption({}, 'coverage', { label: '只走到樓梯口', mapsTo: 'ATTEMPTED' });
    expect(menuChoices('coverage', prefs).slice(0, 3).map(choice => choice.label))
      .toEqual(builtInChoices('coverage').map(choice => choice.label));
  });
});

describe('self-defined choices', () => {
  const withOption = (field: OptionField, label: string, mapsTo?: string): CustomOptions =>
    addCustomOption({}, field, { label, mapsTo: mapsTo ?? builtInChoices(field)[1].value });

  it('keeps the wording and the state it stands for apart', () => {
    const prefs = withOption('coverage', '只走到樓梯口');
    const [option] = customOptions(prefs, 'coverage');
    expect(option.label).toBe('只走到樓梯口');
    expect(option.mapsTo).toBe(builtInChoices('coverage')[1].value);
    // The wording is not a value: it must not be usable as one.
    expect(isMappedValue('coverage', option.label)).toBe(false);
  });

  it('resolves the menu value back to its option, and a built-in to nothing', () => {
    const prefs = withOption('coverage', '只走到樓梯口');
    const [option] = customOptions(prefs, 'coverage');
    expect(customOptionFor('coverage', prefs, choiceValue(option))?.mapsTo).toBe(option.mapsTo);
    for (const choice of builtInChoices('coverage')) expect(customOptionFor('coverage', prefs, choice.value)).toBeUndefined();
    expect(customOptionFor('coverage', prefs, 'custom:not-there')).toBeUndefined();
  });

  it('hides without deleting, so a record that used it still has its value', () => {
    const prefs = withOption('coverage', '只走到樓梯口');
    const [option] = customOptions(prefs, 'coverage');
    const hidden = setCustomOptionHidden(prefs, 'coverage', option.id, true);
    expect(menuChoices('coverage', hidden)).toHaveLength(3);
    expect(customOptions(hidden, 'coverage')).toHaveLength(1);
    expect(customOptionFor('coverage', hidden, choiceValue(option))?.mapsTo).toBe(option.mapsTo);
  });

  it('deletes only the one asked for', () => {
    const prefs = addCustomOption(withOption('coverage', '甲'), 'coverage', { label: '乙', mapsTo: 'ATTEMPTED' });
    const [first] = customOptions(prefs, 'coverage');
    const left = removeCustomOption(prefs, 'coverage', first.id);
    expect(customOptions(left, 'coverage').map(option => option.label)).toEqual(['乙']);
    expect(removeCustomOption(prefs, 'coverage', 'nothing')).toEqual(prefs);
  });

  it('leaves the other fields alone while one changes', () => {
    const prefs = addCustomOption(withOption('coverage', '甲'), 'assessment', { label: '丙', mapsTo: 'SUSPECTED' });
    expect(removeCustomOption(prefs, 'coverage', customOptions(prefs, 'coverage')[0].id)).toHaveProperty('assessment');
    expect(customOptions(setCustomOptionHidden(prefs, 'coverage', customOptions(prefs, 'coverage')[0].id, true), 'assessment')).toHaveLength(1);
  });

  it('gives the same wording the same id, and a second one a suffix', () => {
    const once = addCustomOption({}, 'coverage', { label: '只走到樓梯口', mapsTo: 'ATTEMPTED' });
    expect(customOptions(once, 'coverage')[0].id).toBe(nextOptionId({}, 'coverage', '只走到樓梯口'));
    const twice = addCustomOption(once, 'coverage', { label: '只走到樓梯口', mapsTo: 'ATTEMPTED' });
    expect(customOptions(twice, 'coverage').map(option => option.id)).toHaveLength(new Set(customOptions(twice, 'coverage').map(option => option.id)).size);
  });

  it('survives a storage round trip unchanged', () => {
    const prefs = addCustomOption({}, 'contactOutcome', { label: '隔門回應', mapsTo: 'NO_ANSWER' });
    expect(parseCustomOptions(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
  });
});

describe('reading stored preferences back', () => {
  it('drops anything that cannot name a state, rather than repairing it', () => {
    const stored = {
      coverage: [
        { id: 'ok', label: '可以用', mapsTo: 'ATTEMPTED' },
        { id: 'bad-value', label: '壞', mapsTo: 'SUSPECTED' },
        { id: 'empty-label', label: '  ', mapsTo: 'ATTEMPTED' },
        { id: 'no-mapping', label: '缺' },
        { label: '無 id', mapsTo: 'ATTEMPTED' },
        'not an object',
      ],
      contactOutcome: 'not a list',
      assessment: [{ id: 'a', label: '合理', mapsTo: 'SUSPECTED' }],
    };
    expect(parseCustomOptions(stored)).toEqual({
      coverage: [{ id: 'ok', label: '可以用', mapsTo: 'ATTEMPTED' }],
      assessment: [{ id: 'a', label: '合理', mapsTo: 'SUSPECTED' }],
    });
  });

  it('returns an empty menu for anything that is not a preferences object', () => {
    for (const value of [undefined, null, '', 0, [], 'x', { unknownField: [{ id: 'a', label: 'b', mapsTo: 'ATTEMPTED' }] }])
      expect(parseCustomOptions(value)).toEqual({});
  });

  it('never lets stored data widen the vocabulary the pipeline reads', () => {
    // Every mapping a stored preference can name is already a built-in value.
    const prefs = parseCustomOptions({ coverage: [{ id: 'x', label: '任意文字', mapsTo: 'ATTEMPTED' }] });
    for (const option of customOptions(prefs, 'coverage')) expect(isMappedValue('coverage', option.mapsTo)).toBe(true);
  });
});

/*
 * Picking a coverage is a statement about the whole visit, so the fields below it follow
 * unless the person has already answered them. The rule lives here, not in the form, so
 * it can be stated once and tested without a browser.
 */
describe('a coverage choice fills in what it already implies', () => {
  it('reads the implied values off the built-in grouping rather than a second table', () => {
    // 未到訪 says the visit never happened: nobody was approached, nothing was assessed.
    expect(impliedByCoverage('contactOutcome', 'UNVISITED')).toBe('NOT_ATTEMPTED');
    expect(impliedByCoverage('assessment', 'UNVISITED')).toBe('');
    // 已完成探訪 means someone was met.
    expect(impliedByCoverage('contactOutcome', 'VISITED_NO_FINDING')).toBe('CONTACTED');
    // 未能完成探訪 stops at the door.
    expect(impliedByCoverage('contactOutcome', 'ATTEMPTED')).toBe('NO_ANSWER');
    // A coverage never implies another coverage.
    expect(impliedByCoverage('coverage', 'UNVISITED')).toBeUndefined();
    // Every implied value is a real choice of that field, never new vocabulary.
    for (const coverage of ['UNVISITED', 'ATTEMPTED', 'VISITED_WITH_FINDING', 'UNKNOWN'] as const) {
      for (const field of allFields) {
        const implied = impliedByCoverage(field, coverage);
        if (implied === undefined || implied === '') continue;
        expect({ coverage, field, offered: menuChoices(field, {}).some(choice => choice.value === implied) })
          .toEqual({ coverage, field, offered: true });
      }
    }
  });

  it('starts every dependent field from the default coverage', () => {
    const fields = dependentDefaults('ATTEMPTED');
    expect(fields.contactOutcome).toEqual({ value: 'NO_ANSWER', touched: false });
    expect(fields.sourceType).toEqual({ value: 'STAFF_OBSERVATION', touched: false });
    expect(fields.assessment).toEqual({ value: '', touched: false });
  });

  it('rewrites an untouched field when the coverage changes', () => {
    const before = dependentDefaults('ATTEMPTED');
    const after = applyCoverageChange(before, 'UNVISITED');
    expect(after.contactOutcome).toEqual({ value: 'NOT_ATTEMPTED', touched: false });
    expect(after.assessment).toEqual({ value: '', touched: false });
  });

  it('never overwrites an answer the person gave themselves', () => {
    const answered = markTouched(dependentDefaults('ATTEMPTED'), 'contactOutcome', 'DECLINED');
    const after = applyCoverageChange(answered, 'UNVISITED');
    // The deliberate answer stands; the fields they did not touch still follow.
    expect(after.contactOutcome).toEqual({ value: 'DECLINED', touched: true });
    expect(after.sourceType).toEqual({ value: 'STAFF_OBSERVATION', touched: false });
  });

  it('keeps a touched field even when the new coverage implies nothing at all', () => {
    const answered = markTouched(dependentDefaults('ATTEMPTED'), 'assessment', 'SUSPECTED');
    expect(applyCoverageChange(answered, 'UNKNOWN').assessment).toEqual({ value: 'SUSPECTED', touched: true });
  });
});

/*
 * §10.4: the three descriptive rows — 住房判斷, 資料來源, 跟進類別 — close with 「其他」.
 * A typed sentence declares no value, and that is the whole point: it must never invent a
 * clue marker, a follow-up category or a colour. The wording is kept, the value is not.
 */
describe('「其他」 keeps the wording and stores no value (§10.4)', () => {
  /** What the editor passes in: a custom option stores its declared value and its wording. */
  const resolve =
    (prefs: CustomOptions, field: OptionField) =>
    (value: string): { value?: string; note?: string } => {
      const custom = customOptionFor(field, prefs, value);
      return custom ? { value: custom.mapsTo, note: custom.label } : { value: value || undefined };
    };

  it('stores the typed sentence and no enum at all', () => {
    const answer = descriptiveAnswer(OTHER_CHOICE, '  走廊見到分間門牌  ', resolve({}, 'assessment'));
    expect(answer.value).toBeUndefined();
    expect(answer.note).toBe('走廊見到分間門牌');
  });

  it('treats an empty 「其他」 as no answer, not as an empty one', () => {
    // A box opened and left blank says nothing; it must not become a blank-named note.
    expect(descriptiveAnswer(OTHER_CHOICE, '   ', resolve({}, 'sourceType'))).toEqual({ note: undefined });
  });

  it('never lets a typed answer pass as a value the pipeline reads', () => {
    const answer = descriptiveAnswer(OTHER_CHOICE, 'SUSPECTED', resolve({}, 'assessment'));
    // Typing the name of an enum is still just text: the marker is not created by wording.
    expect(answer.value).toBeUndefined();
  });

  it('stores a built-in answer as its own value', () => {
    expect(descriptiveAnswer('SUSPECTED', '', resolve({}, 'assessment'))).toEqual({ value: 'SUSPECTED' });
    expect(descriptiveAnswer('HEALTH_SUPPORT', '', resolve({}, 'coverage'))).toEqual({ value: 'HEALTH_SUPPORT' });
  });

  it('stores a custom answer as the value it declared, plus its wording', () => {
    const prefs = addCustomOption({}, 'assessment', { label: '分間門牌', mapsTo: 'SUSPECTED' });
    const answer = descriptiveAnswer(choiceValue(customOptions(prefs, 'assessment')[0]), '', resolve(prefs, 'assessment'));
    expect(answer).toEqual({ value: 'SUSPECTED', note: '分間門牌' });
  });

  it('ignores typed wording when 「其他」 is not the chosen answer', () => {
    // A sentence left over from an abandoned 「其他」 must not attach itself to a real choice.
    expect(descriptiveAnswer('NO_INDICATION', '走廊見到分間門牌', resolve({}, 'assessment'))).toEqual({ value: 'NO_INDICATION' });
  });

  it('leaves a row that was never answered absent', () => {
    expect(descriptiveAnswer(undefined, '', resolve({}, 'assessment'))).toEqual({ value: undefined });
  });
});
