import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectWorkbook, fieldsNeedingReview, mergeOverride, recognitionBlocker, type DetectionResult, type MappingOverride } from './detector';
import { REGRESSION_SAMPLES, sampleBuffer, type SampleKind } from './samples';
import { DETECTOR_VERSION, FORMAT_PROFILES, SYSTEM_COLUMNS, normalizeHeader, type CanonicalField } from './profiles';
import { paperHeaders } from '../data/workflowFormat';

const sampleOf = (id: string) => {
  const sample = REGRESSION_SAMPLES.find((entry) => entry.id === id);
  if (!sample) throw new Error(`Unknown sample ${id}`);
  return sample;
};
const run = (id: string, override?: MappingOverride) => detectWorkbook(sampleBuffer(sampleOf(id)), override);
const fieldOf = (result: DetectionResult, key: CanonicalField) => result.fields.find((field) => field.key === key);
/** Only meaningful for the six-sheet samples, whose headers are the export's. */
const mappedHeader = (result: DetectionResult, key: CanonicalField) => {
  const field = fieldOf(result, key);
  return field?.columnIndex === undefined ? undefined : paperHeaders[field.columnIndex];
};

describe('W0 candidate format recognition', () => {
  it('ships a success, ambiguous and rejected sample for every candidate format', () => {
    const kinds: SampleKind[] = ['success', 'ambiguous', 'rejected'];
    for (const profile of FORMAT_PROFILES) {
      const samples = REGRESSION_SAMPLES.filter((sample) => sample.profileId === profile.id);
      for (const kind of kinds) expect(samples.filter((sample) => sample.kind === kind), `${profile.id}/${kind}`).toHaveLength(1);
    }
    expect(REGRESSION_SAMPLES).toHaveLength(FORMAT_PROFILES.length * kinds.length);
  });

  it('recognises the workbook this workbench itself exports', () => {
    const result = run('careflow-six-sheet/success');
    expect(result.detectorVersion).toBe(DETECTOR_VERSION);
    expect(result.profileId).toBe('careflow-six-sheet');
    expect(result.sheetName).toBe('紙本回錄');
    expect(result.headerRow).toBe(5);
    expect(result.status).toBe('KNOWN');
    expect(result.unmatchedColumns).toEqual([]);
    expect(fieldsNeedingReview(result)).toEqual([]);
  });

  it('maps every business column of the export to the right field', () => {
    const result = run('careflow-six-sheet/success');
    expect(mappedHeader(result, 'buildingId')).toBe('大廈編號');
    expect(mappedHeader(result, 'occurredAt')).toBe('到訪日期');
    expect(mappedHeader(result, 'worker')).toBe('工作員');
    expect(mappedHeader(result, 'coverage')).toBe('覆蓋結果');
    expect(mappedHeader(result, 'recordId')).toBe('記錄編號');
    expect(mappedHeader(result, 'resolvesObservationId')).toBe('結束跟進編號');
    expect(result.fields.filter((field) => field.status === 'KNOWN')).toHaveLength(paperHeaders.filter((header) => !SYSTEM_COLUMNS.includes(header)).length);
  });

  it('reports ambiguity instead of picking a column when two headers claim one field', () => {
    const result = run('careflow-six-sheet/ambiguous');
    expect(result.status).toBe('AMBIGUOUS');
    const worker = fieldOf(result, 'worker')!;
    expect(worker.status).toBe('AMBIGUOUS');
    expect(worker.columnIndex).toBeUndefined();
    expect(worker.candidates.map((candidate) => candidate.sourceHeader)).toEqual(['工作員', '工作人員']);
    expect(result.issues.some((issue) => issue.code === 'REQUIRED_FIELD_AMBIGUOUS')).toBe(true);
    expect(fieldsNeedingReview(result).map((field) => field.key)).toEqual(['worker']);
  });

  it('refuses every unrecognisable sheet without guessing a format', () => {
    for (const sample of REGRESSION_SAMPLES.filter((entry) => entry.kind === 'rejected')) {
      const result = run(sample.id);
      expect(result.status, sample.id).toBe('UNKNOWN');
      expect(result.profileId, sample.id).toBeUndefined();
      expect(result.fields, sample.id).toEqual([]);
      expect(result.issues.map((issue) => issue.code), sample.id).toContain('FORMAT_NOT_RECOGNIZED');
    }
  });

  it('does not report the six-sheet export as a guessed template', () => {
    // one-visit-per-row also names 紙本回錄, so the closed list must not cross over.
    const result = run('careflow-six-sheet/success');
    expect(result.profileKind).toBe('known');
    expect(result.issues.some((issue) => issue.code === 'TEMPLATE_PROFILE')).toBe(false);
  });

  it('flags guessed templates as unverified candidates', () => {
    for (const id of ['one-person-per-row/success', 'one-building-per-row/success', 'one-visit-per-row/success']) {
      const result = run(id);
      expect(result.status, id).toBe('KNOWN');
      expect(result.profileKind, id).toBe('template');
      expect(result.issues.some((issue) => issue.code === 'TEMPLATE_PROFILE'), id).toBe(true);
    }
  });

  it('reports ambiguity for the guessed templates too', () => {
    for (const id of ['one-person-per-row/ambiguous', 'one-building-per-row/ambiguous', 'one-visit-per-row/ambiguous']) {
      expect(run(id).status, id).toBe('AMBIGUOUS');
    }
  });

  it('lists non-empty columns it could not map instead of dropping them', () => {
    // The field-outreach demo carries follow-up columns no legacy field claims.
    const bytes = readFileSync('public/demo/careflow-field-outreach-demo.xlsx');
    const result = detectWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const claimed = new Set(result.fields.map((field) => field.columnIndex));
    const dropped = result.unmatchedColumns.filter((column) => column.hasData);
    expect(dropped.length).toBeGreaterThan(0);
    for (const column of dropped) expect(claimed.has(column.columnIndex)).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'UNMATCHED_COLUMN')).toBe(true);
  });

  it('does not call a column lost while it is still offered as a candidate', () => {
    // Both copies of the duplicate id column are candidates for recordId, not orphans.
    const result = run('legacy-synthetic/ambiguous');
    const loose = result.unmatchedColumns.filter((column) => column.hasData);
    expect(loose.map((column) => [column.columnIndex, column.candidateFor])).toEqual([[0, 'recordId'], [8, 'recordId']]);
    expect(result.issues.some((issue) => issue.code === 'UNMATCHED_COLUMN')).toBe(false);
  });

  it('resolves an ambiguity into a confirmed mapping when the person in charge chooses', () => {
    const before = run('careflow-six-sheet/ambiguous');
    expect(before.status).toBe('AMBIGUOUS');
    const resolved = run('careflow-six-sheet/ambiguous', { columns: { worker: paperHeaders.indexOf('工作員') } });
    expect(resolved.status).toBe('KNOWN');
    expect(fieldOf(resolved, 'worker')!.status).toBe('KNOWN');
    expect(fieldOf(resolved, 'worker')!.basis).toBe('負責人指定欄位');
    expect(fieldOf(resolved, 'worker')!.overridden).toBe('column');
    expect(resolved.appliedOverrides).toContain('工作員');
    expect(fieldsNeedingReview(resolved)).toEqual([]);
  });

  it('records an explicit "unknown" choice rather than silently keeping a guess', () => {
    const result = run('careflow-six-sheet/success', { columns: { coverage: null } });
    const coverage = fieldOf(result, 'coverage')!;
    expect(coverage.status).toBe('UNKNOWN');
    expect(coverage.columnIndex).toBeUndefined();
    expect(coverage.basis).toBe('負責人標示為未知／忽略');
    expect(coverage.overridden).toBe('ignored');
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.appliedOverrides).toContain('覆蓋結果');
  });

  it('lets every demo workbook the workbench ships reach the merge button', () => {
    // A regression here would silently block the built-in demo path.
    const shipped: Record<string, string> = {
      'careflow-paper-excel-mock.xlsx': 'careflow-six-sheet',
      'careflow-district-demo.xlsx': 'careflow-six-sheet',
      'careflow-field-outreach-demo.xlsx': 'legacy-synthetic',
    };
    for (const [name, profileId] of Object.entries(shipped)) {
      const bytes = readFileSync(`public/demo/${name}`);
      const result = detectWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      expect(result.profileId, name).toBe(profileId);
      expect(result.issues.filter((issue) => issue.severity === 'error'), name).toEqual([]);
      expect(recognitionBlocker(result), name).toBeUndefined();
    }
  });

  it('blocks the merge while recognition is refused or a required field is undecided', () => {
    expect(recognitionBlocker(run('careflow-six-sheet/success'))).toBeUndefined();
    expect(recognitionBlocker(run('careflow-six-sheet/rejected'))).toMatch(/未能識別/);
    expect(recognitionBlocker(run('careflow-six-sheet/ambiguous'))).toMatch(/關鍵欄位/);
    expect(recognitionBlocker()).toBeUndefined();
  });

  it('accumulates corrections instead of replacing the last one', () => {
    const first = mergeOverride({}, { columns: { worker: 2 } });
    const second = mergeOverride(first, { columns: { coverage: 5 } });
    expect(second.columns).toEqual({ worker: 2, coverage: 5 });
    // Naming the format the detector already chose changes nothing, so it must keep them.
    expect(mergeOverride(second, { profileId: 'careflow-six-sheet', columns: {} }, 'careflow-six-sheet').columns)
      .toEqual({ worker: 2, coverage: 5 });
  });

  it('drops column choices when the format changes, and returns to automatic on request', () => {
    const decided = mergeOverride({}, { columns: { worker: 2 } });
    const forced = mergeOverride(decided, { profileId: 'one-visit-per-row', columns: {} }, 'careflow-six-sheet');
    // Column 2 belonged to the other profile's field list, so it must not survive.
    expect(forced).toEqual({ profileId: 'one-visit-per-row', columns: {} });
    const automatic = mergeOverride(forced, { profileId: undefined }, 'one-visit-per-row');
    expect('profileId' in automatic).toBe(true);
    expect(automatic.profileId).toBeUndefined();
    expect(automatic.columns).toEqual({});
  });

  it('folds 繁简, punctuation and spacing when comparing headers', () => {
    expect(normalizeHeader('  電話  ')).toBe(normalizeHeader('电话'));
    expect(normalizeHeader('大廈／名稱')).toBe(normalizeHeader('大厦名称'));
    expect(normalizeHeader('姓名 ／ 稱呼')).toBe(normalizeHeader('姓名/称呼'));
    expect(normalizeHeader('Coverage')).toBe(normalizeHeader('coverage'));
  });
});
