import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_GROUPS, CONTACT_GROUPS, acceptedAssessment, acceptedContact, acceptedCoverage, acceptedSource, assessmentOptions, contactOptionGroups, coverageOptionGroups,
  recognitionAssessmentValues, recognitionCategoryValues, recognitionContactValues, recognitionCoverageValues,
  recognitionSourceValues, sourceOptions, stateColors, stateLabels, stateLegendNotes, stateSelectedColors,
} from './presentation';
import { CONTACT_OUTCOMES, COVERAGE_STATUSES, HOUSING_ASSESSMENTS, OUTREACH_STATES, SOURCE_TYPES, SUPPORT_CATEGORIES } from './types';

/**
 * The single-source guard (§6.1, §6.2). It is a test rather than a review checklist:
 * a second colour or a second label table has to fail here, not in someone's memory.
 */
function sourceFiles(extension: RegExp): string[] {
  const walk = (directory: string): string[] => readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : extension.test(path) ? [path] : [];
  });
  return walk('src');
}
const read = (path: string) => readFileSync(path, 'utf8');
const without = (paths: string[], ...excluded: string[]) => paths.filter(path => !excluded.some(name => path.endsWith(name)));

describe('one source for every colour', () => {
  const scripts = without(sourceFiles(/\.tsx?$/), 'presentation.ts', 'presentation.test.ts');

  it('draws no colour from a literal outside presentation.ts', () => {
    const offenders = scripts.filter(path => /#[0-9a-fA-F]{3,8}\b/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('lets no stylesheet define a state hue of its own', () => {
    // Only the two business palettes. The map chrome is ordinary styling that predates
    // this model and is allowed to live in CSS.
    const owned = [...Object.values(stateColors), ...Object.values(stateSelectedColors)];
    const offenders = sourceFiles(/\.css$/).flatMap(path => owned.filter(hue => read(path).includes(hue)).map(hue => `${path}: ${hue}`));
    expect(offenders).toEqual([]);
  });

  it('keeps the four states distinct and complete', () => {
    expect(Object.keys(stateColors).sort()).toEqual([...OUTREACH_STATES].sort());
    expect(Object.keys(stateSelectedColors).sort()).toEqual([...OUTREACH_STATES].sort());
    expect(new Set(Object.values(stateColors)).size).toBe(OUTREACH_STATES.length);
    expect(Object.values(stateColors).every(hue => /^#[0-9a-f]{6}$/.test(hue))).toBe(true);
    expect(Object.keys(stateLabels).sort()).toEqual([...OUTREACH_STATES].sort());
    expect(Object.keys(stateLegendNotes).sort()).toEqual([...OUTREACH_STATES].sort());
  });
});

describe('one source for every label', () => {
  // labels.test.tsx is left out because it asserts these very words are gone.
  const scripts = without(sourceFiles(/\.tsx?$/), 'presentation.ts', 'presentation.test.ts', 'labels.test.tsx');
  /*
   * Words left out on purpose, each one because it is ordinary prose somewhere rather
   * than a status label: demo notes and issue messages ("未能完成", "未能進入",
   * "已完成", "住屋變動", "健康關懷", "服務邀約", "暫無可靠記錄", "未到訪"), a form
   * callout and a placeholder example ("無人應門", "居民口述") and one code comment
   * ("一般跟進"). Everything still in the list is a sentence that only a label table
   * would produce; retyping any of them is the regression this test exists to catch.
   */
  const labelOnly = [
    '需留意', '尚待了解', '曾嘗試', '部分完成', '已訪，無記錄發現', '已訪，有記錄',
    '未嘗試接觸', '住戶婉拒', '接觸結果未明', '今次未更新住房判斷', '住房情況未能確定',
    '疑似劏房，尚待核實', '今次未見相關跡象', '工作人員已確認', '工作人員觀察', '其他來源',
    '疑似劏房線索', '已確認劏房', '有記錄發現',
    ...Object.values(stateLegendNotes),
  ];
  it('keeps every status sentence inside presentation.ts', () => {
    const offenders = scripts.flatMap(path => labelOnly.filter(sentence => read(path).includes(sentence)).map(sentence => `${path}: ${sentence}`));
    expect(offenders).toEqual([]);
  });

  it('writes no older copy of a label back into the product', () => {
    // The two wordings the three former copies disagreed on. Neither may return.
    for (const retired of ['覆蓋未明', '由工作人員確認']) {
      expect(scripts.filter(path => read(path).includes(retired))).toEqual([]);
    }
  });

  it('never words the yellow legend as a follow-up', () => {
    expect(stateLegendNotes.YELLOW).not.toContain('待跟進');
    expect(stateLabels.YELLOW).not.toContain('待跟進');
  });
});

describe('one source for every option', () => {
  it('offers every stored value exactly once across the three choices', () => {
    const covered = coverageOptionGroups.flatMap(option => option.covers);
    expect([...covered].sort()).toEqual([...COVERAGE_STATUSES].sort());
    expect(new Set(covered).size).toBe(covered.length);
    expect(coverageOptionGroups.map(option => option.group)).toEqual([...COVERAGE_GROUPS]);
    const contacts = contactOptionGroups.flatMap(option => option.covers);
    expect([...contacts].sort()).toEqual([...CONTACT_OUTCOMES].sort());
    expect(contactOptionGroups.map(option => option.group)).toEqual([...CONTACT_GROUPS]);
  });

  it('keeps three built-in choices per field, plus a blank where the field allows it', () => {
    expect(coverageOptionGroups).toHaveLength(3);
    expect(contactOptionGroups).toHaveLength(3);
    expect(assessmentOptions).toHaveLength(3);
    expect(sourceOptions).toHaveLength(3);
    // Housing and source may be left unrecorded; coverage and contact must be stated.
    expect(assessmentOptions.map(option => option.value)).not.toContain('NOT_UPDATED');
    expect(assessmentOptions.map(option => option.value)).not.toContain('UNKNOWN');
    for (const option of coverageOptionGroups) expect(COVERAGE_STATUSES).toContain(option.canonical);
    for (const option of contactOptionGroups) expect(CONTACT_OUTCOMES).toContain(option.canonical);
  });

  it('keeps every wording a sheet may already contain readable', () => {
    expect(acceptedCoverage['部分完成']).toBe('PARTIAL');
    expect(acceptedCoverage['未到訪']).toBe('UNVISITED');
    expect(acceptedCoverage['已查看・無發現']).toBe('VISITED_NO_FINDING');
    expect(acceptedCoverage['已完成探訪']).toBe('VISITED_NO_FINDING');
    expect(acceptedCoverage['未能完成探訪']).toBe('ATTEMPTED');
    expect(acceptedCoverage['覆蓋未明']).toBe('UNKNOWN');
    expect(acceptedContact['未能接觸']).toBe('NO_ANSWER');
    expect(acceptedAssessment['今次未更新']).toBe('NOT_UPDATED');
    expect(acceptedAssessment['由工作人員確認']).toBe('STAFF_VERIFIED');
    expect(acceptedSource['來源未明']).toBe('UNKNOWN');
  });

  it('recognises the same wordings the detector is offered', () => {
    for (const value of COVERAGE_STATUSES) expect(recognitionCoverageValues).toContain(value);
    for (const value of CONTACT_OUTCOMES) expect(recognitionContactValues).toContain(value);
    for (const value of HOUSING_ASSESSMENTS) expect(recognitionAssessmentValues).toContain(value);
    for (const value of SOURCE_TYPES) expect(recognitionSourceValues).toContain(value);
    for (const value of SUPPORT_CATEGORIES) expect(recognitionCategoryValues).toContain(value);
    // Simplifying the form must not shrink recognition (§10.5).
    for (const wording of Object.keys(acceptedCoverage)) expect(recognitionCoverageValues).toContain(wording);
    for (const wording of Object.keys(acceptedAssessment)) expect(recognitionAssessmentValues).toContain(wording);
    for (const wording of Object.keys(acceptedContact)) expect(recognitionContactValues).toContain(wording);
    for (const wording of Object.keys(acceptedSource)) expect(recognitionSourceValues).toContain(wording);
  });
});
