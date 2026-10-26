import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../data/demoFixture';
import { floorNumber } from '../domain/structure';
import type { CanonicalField } from './profiles';
import { parseGenericRows as parseRows, readSheetMatrix } from './genericRows';

// These location/date fixtures explicitly include the newly required housing/source
// answers. Tests of absent answers below call parseRows directly, without this fixture.
const parseGenericRows = (input: Parameters<typeof parseRows>[0]) => {
  const sheet = input.matrix ?? readSheetMatrix(input.buffer, input.sheetName)!;
  const matrix = sheet.matrix.map((row, index) => {
    const copy = [...row];
    if (index >= input.headerRow && row.some(value => value !== '' && value != null)) {
      copy[62] = 'UNKNOWN'; copy[63] = 'STAFF_OBSERVATION';
    }
    return copy;
  });
  return parseRows({ ...input, matrix: { ...sheet, matrix }, mapping: [
    ...input.mapping, { key: 'assessment', columnIndex: 62 }, { key: 'sourceType', columnIndex: 63 },
  ] });
};

const building = demoSnapshot.buildings[0];
const unit = demoSnapshot.units.find(item => item.buildingId === building.id && !item.parentUnitId)!;
const floor = demoSnapshot.floors.find(item => item.id === unit.floorId)!;

const HEADERS = ['大廈', '到訪日期', '樓層', '單位', '工作員', '覆蓋結果', '備註'];
const MAPPING: { key: CanonicalField; columnIndex: number }[] = [
  { key: 'buildingName', columnIndex: 0 }, { key: 'occurredAt', columnIndex: 1 }, { key: 'floor', columnIndex: 2 },
  { key: 'unit', columnIndex: 3 }, { key: 'worker', columnIndex: 4 }, { key: 'coverage', columnIndex: 5 }, { key: 'note', columnIndex: 6 },
];

const row = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const values: unknown[] = [building.name, '2026-10-09', floor.label, unit.label, '陳同事', '已嘗試接觸', '門外有水電單'];
  for (const [index, value] of Object.entries(over)) values[Number(index)] = value;
  return values;
};

const book = (rows: unknown[][]): ArrayBuffer => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), '探訪');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
};

let counter = 0;
const parse = (rows: unknown[][], over: Partial<Parameters<typeof parseGenericRows>[0]> = {}) =>
  parseGenericRows({
    buffer: book(rows), sheetName: '探訪', headerRow: 1, mapping: MAPPING, snapshot: demoSnapshot,
    fileName: '回錄.xlsx', now: '2026-10-23T02:00:00.000Z', newId: () => `test-${++counter}`,
    ...over,
  });

describe('a row that can be written', () => {
  it('carries the values the sheet holds, and stamps neither the operator nor the AI', () => {
    const result = parse([row()]);
    const [first] = result.rows;
    expect(first.status).toBe('READY');
    expect(first.issues).toEqual([]);
    expect(first.input).toMatchObject({
      buildingId: building.id, floorId: floor.id, unitId: unit.id,
      occurredAt: '2026-10-09', workerName: '陳同事', coverage: 'ATTEMPTED', note: '門外有水電單',
      recordedAt: '2026-10-23T02:00:00.000Z', importSource: { file: '回錄.xlsx', sheet: '探訪', row: 2 },
    });
    expect(first.input!.createdBy).toBeUndefined();
    expect(first.input!.aiAssist).toBeUndefined();
    expect(first.occurredAt).toBe('2026-10-09');
  });

  it('keeps a time when the sheet has one, at Hong Kong offset', () => {
    const result = parse([[building.name, '2026-10-09 19:05', floor.label, unit.label, '陳同事', '已嘗試接觸', '']]);
    expect(result.rows[0].input!.occurredAt).toBe('2026-10-09');
    const timed = parseGenericRows({
      buffer: (() => {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['大廈', '到訪日期', '到訪時間', '工作員', '覆蓋結果'], [building.name, '2026-10-09', '19:05', '陳同事', '已嘗試接觸']]), '探訪');
        return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      })(),
      sheetName: '探訪', headerRow: 1, snapshot: demoSnapshot, fileName: '回錄.xlsx',
      mapping: [{ key: 'buildingName', columnIndex: 0 }, { key: 'occurredAt', columnIndex: 1 }, { key: 'occurredTime', columnIndex: 2 }, { key: 'worker', columnIndex: 3 }, { key: 'coverage', columnIndex: 4 }],
      newId: () => `timed-${++counter}`,
    });
    expect(timed.rows[0].input!.occurredAt).toBe('2026-10-09T19:05:00+08:00');
  });

  it('reads an Excel date serial rather than leaving a number in the record', () => {
    const serial = XLSX.SSF.parse_date_code(46295)!;
    const result = parse([row({ 1: 46295 })]);
    expect(result.rows[0].occurredAt).toBe(`${serial.y}-${String(serial.m).padStart(2, '0')}-${String(serial.d).padStart(2, '0')}`);
  });
});

describe('rows that need a person', () => {
  it('does not fill a missing date or worker', () => {
    const result = parse([row({ 1: '', 4: '' })]);
    const [first] = result.rows;
    expect(first.status).toBe('NEEDS_REVIEW');
    expect(first.input).toBeUndefined();
    expect(first.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['MISSING_DATE', 'MISSING_WORKER']));
  });

  it('keeps absent coverage in review until a person supplies it', () => {
    const result = parse([row({ 5: '' })]);
    expect(result.rows[0].status).toBe('NEEDS_REVIEW');
    expect(result.rows[0].input).toBeUndefined();
    expect(result.rows[0].issues.map(issue => issue.code)).toContain('MISSING_COVERAGE');
  });

  it.each(['coverage', 'assessment', 'sourceType'] as const)('requires %s even when other answers are present', key => {
    const mapping = [...MAPPING, { key: 'assessment' as const, columnIndex: 7 }, { key: 'sourceType' as const, columnIndex: 8 }];
    const values = [...row(), 'UNKNOWN', 'STAFF_OBSERVATION'];
    values[mapping.find(field => field.key === key)!.columnIndex] = '';
    const result = parseRows({ buffer: book([values]), sheetName: '探訪', headerRow: 1, mapping, snapshot: demoSnapshot, fileName: '必填合成.xlsx' });
    expect(result.rows[0].status).toBe('NEEDS_REVIEW');
    expect(result.rows[0].input).toBeUndefined();
    const filled = parseRows({ buffer: book([[...row(), 'UNKNOWN', 'STAFF_OBSERVATION']]), sheetName: '探訪', headerRow: 1, mapping, snapshot: demoSnapshot, fileName: '必填合成.xlsx' });
    expect(filled.rows[0].status).toBe('READY');
  });

  it('refuses an unreadable date instead of guessing the day order', () => {
    const result = parse([row({ 1: '9/10/2026' })]);
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.rows[0].issues.map(issue => issue.code)).toContain('DATE');
  });

  it('will not place a row in a building that is not on record', () => {
    const result = parse([row({ 0: '不存在大廈' })]);
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.rows[0].issues[0].message).toContain('AI 不會代為建立');
  });

  it('will not keep a floor without a unit', () => {
    const result = parse([row({ 3: '' })]);
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.rows[0].issues.map(issue => issue.code)).toContain('LOCATION');
  });

  it('offers a floor and unit the file names but the workspace does not have', () => {
    const result = parse([row({ 2: '9F', 3: '9F A室' })]);
    expect(result.rows[0].status).toBe('NEEDS_REVIEW');
    expect(result.rows[0].input).toBeUndefined();
    expect(result.rows[0].issues[0].message).toContain('系統還沒有');
    expect(result.pending).toEqual([
      { buildingId: building.id, buildingName: building.name, floorLabel: '9F', newFloor: true, unitLabel: '9F A室', rowNumbers: [2] },
    ]);
  });

  it('offers only the missing unit when the floor is already there', () => {
    const result = parse([row({ 3: 'E室' })]);
    expect(result.rows[0].status).toBe('NEEDS_REVIEW');
    expect(result.pending).toEqual([
      { buildingId: building.id, buildingName: building.name, floorLabel: floor.label, newFloor: false, unitLabel: 'E室', rowNumbers: [2] },
    ]);
  });

  it('gathers the rows that name the same missing place instead of offering it twice', () => {
    const result = parse([row({ 2: '9F', 3: '9F A室' }), row({ 2: '9樓', 3: 'A室' })]);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].rowNumbers).toEqual([2, 3]);
    expect(result.counts.NEEDS_REVIEW).toBe(2);
  });

  it('still refuses a missing building, without offering to create it', () => {
    const result = parse([row({ 0: '不存在大廈', 2: '9F', 3: '9F A室' })]);
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.pending).toEqual([]);
  });

  it('still refuses wording the structure rules cannot read', () => {
    const result = parse([row({ 2: '頂樓', 3: '頂樓 A室' })]);
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.pending).toEqual([]);
  });

  it('will not keep a correction without a reason', () => {
    const result = parse([row({ 7: 'obs-1', 8: '' })], { mapping: [...MAPPING, { key: 'correctsObservationId', columnIndex: 7 }, { key: 'correctionReason', columnIndex: 8 }] });
    expect(result.rows[0].status).toBe('INVALID');
  });
});

describe('columns nobody mapped', () => {
  const withoutNote = MAPPING.filter(field => field.key !== 'note');

  it('keeps their content in the note instead of dropping it', () => {
    const result = parse([row()], { mapping: withoutNote, extraColumns: [{ header: '備註', columnIndex: 6 }] });
    expect(result.rows[0].status).toBe('READY');
    expect(result.rows[0].input?.note).toBe('原表「備註」：門外有水電單');
  });

  it('adds them after a note the sheet already has', () => {
    const headers = [...HEADERS, '電話'];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, [...row(), '2111 1111']]), '探訪');
    const result = parseGenericRows({
      buffer: XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
      sheetName: '探訪', headerRow: 1, mapping: MAPPING, snapshot: demoSnapshot, fileName: '回錄.xlsx',
      now: '2026-10-23T02:00:00.000Z', newId: () => `extra-${++counter}`,
      extraColumns: [{ header: '電話', columnIndex: 7 }],
    });
    expect(result.rows[0].input?.note).toBe('門外有水電單；原表「電話」：2111 1111');
  });

  it('ignores a column the caller lists but has mapped after all', () => {
    const result = parse([row()], { extraColumns: [{ header: '備註', columnIndex: 6 }] });
    expect(result.rows[0].input?.note).toBe('門外有水電單');
  });
});

describe('a floor the sheet spells differently', () => {
  const five = demoSnapshot.floors.find(item => item.buildingId === building.id && floorNumber(item.label) === 5)!;
  const fiveB = demoSnapshot.units.find(item => item.floorId === five.id && item.label === '5F B室')!;

  it('reads 「5」 as the floor labelled 5F instead of calling it missing', () => {
    const result = parse([row({ 2: '5', 3: 'B' })]);
    expect(result.rows[0].status).toBe('READY');
    expect(result.rows[0].input?.floorId).toBe(five.id);
    expect(result.rows[0].input?.unitId).toBe(fiveB.id);
    expect(result.pending).toEqual([]);
  });

  it('reads 「5樓」 the same way', () => {
    const result = parse([row({ 2: '5樓', 3: 'B室' })]);
    expect(result.rows[0].status).toBe('READY');
    expect(result.rows[0].input?.unitId).toBe(fiveB.id);
  });

  it('does not guess when two floors carry the same number', () => {
    const twin = { ...five, id: 'dup-5f', label: '5/F' };
    const result = parse([row({ 2: '5', 3: 'B' })], { snapshot: { ...demoSnapshot, floors: [...demoSnapshot.floors, twin] } });
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.rows[0].issues[0].message).toContain('對應到多層');
    expect(result.pending).toEqual([]);
  });
});

describe('rows that look like a repeat', () => {
  it('points at the earlier row in the same file instead of merging', () => {
    const result = parse([row(), row()]);
    expect(result.rows[0].suspectedDuplicateOfRow).toBeUndefined();
    expect(result.rows[1].suspectedDuplicateOfRow).toBe(2);
    expect(result.rows[1].input).toBeDefined();
  });

  it('points at an existing record when one matches', () => {
    const twin = { ...demoSnapshot.observations[0], id: 'twin', buildingId: building.id, floorId: floor.id, unitId: unit.id, occurredAt: '2026-10-09', workerName: '陳同事', coverage: 'ATTEMPTED' as const, deleted: undefined };
    const result = parse([row()], { snapshot: { ...demoSnapshot, observations: [...demoSnapshot.observations, twin] } });
    expect(result.rows[0].suspectedDuplicateOf).toBe('twin');
  });
});

describe('the sheet as a whole', () => {
  it('reports blank rows instead of counting them as data', () => {
    const result = parse([row(), ['', '', '', '', '', '', ''], row({ 4: '另一位' })]);
    expect(result.rows).toHaveLength(2);
    expect(result.blankRows).toBe(1);
    expect(result.counts.READY).toBe(2);
  });

  it('says which whole-sheet mapping is missing, without dropping rows silently', () => {
    const result = parse([row()], { mapping: [{ key: 'occurredAt', columnIndex: 1 }] });
    expect(result.notes[0]).toContain('大廈');
    expect(result.rows[0].status).toBe('INVALID');
  });

  it('classifies every row, so the counts add up to what the sheet holds', () => {
    const result = parse([row(), row({ 1: '' }), row({ 0: '不存在大廈' })]);
    const total = result.counts.READY + result.counts.NEEDS_REVIEW + result.counts.INVALID;
    expect(total).toBe(3);
  });
});

describe('a sheet with no 大廈 column, and the building the person typed', () => {
  // 「探訪日期 / 樓 / 室 / 負責同事 / 覆蓋結果」: the paper was filed under a building that
  // the rows never repeat. What the person typed beside the file is where it comes from.
  const NO_BUILDING = [
    { key: 'occurredAt' as const, columnIndex: 0 }, { key: 'floor' as const, columnIndex: 1 },
    { key: 'unit' as const, columnIndex: 2 }, { key: 'worker' as const, columnIndex: 3 },
    { key: 'coverage' as const, columnIndex: 4 },
  ];
  const sheet = (rows: unknown[][]) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['探訪日期', '樓', '室', '負責同事', '覆蓋結果'], ...rows]), '探訪記錄');
    return workbook;
  };
  const run = (rows: unknown[][], over: Partial<Parameters<typeof parseGenericRows>[0]> = {}) => parseGenericRows({
    buffer: XLSX.write(sheet(rows), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    sheetName: '探訪記錄', headerRow: 1, mapping: NO_BUILDING, snapshot: demoSnapshot,
    fileName: '探訪.xlsx', now: '2026-10-23T02:00:00.000Z', newId: () => `t-${++counter}`, ...over,
  });

  it('writes the rows under the building the person named, and says that is where it came from', () => {
    const result = run([['2026-10-05', floor.label, unit.label, '陳同事', '已嘗試接觸']], { defaultBuilding: { id: building.id, name: building.name } });
    expect(result.rows[0].status).toBe('READY');
    expect(result.rows[0].input!.buildingId).toBe(building.id);
    expect(result.notes.join('')).toContain(`1 行沒有填大廈，都按你在補充說明寫的「${building.name}」處理`);
  });

  it('is still unusable without it: the parser never picks a building itself', () => {
    const result = run([['2026-10-05', floor.label, unit.label, '陳同事', '已嘗試接觸']]);
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.notes[0]).toContain('大廈');
  });

  it('does not overrule a row that names its own building', () => {
    const other = demoSnapshot.buildings.find(item => item.id !== building.id)!;
    const otherUnit = demoSnapshot.units.find(item => item.buildingId === other.id && !item.parentUnitId)!;
    const otherFloor = demoSnapshot.floors.find(item => item.id === otherUnit.floorId)!;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['大廈', '探訪日期', '樓', '室', '負責同事', '覆蓋結果'],
      [other.name, '2026-10-05', otherFloor.label, otherUnit.label, '陳同事', '已嘗試接觸'],
      [other.name, '2026-10-06', otherFloor.label, otherUnit.label, '李同事', '已嘗試接觸'],
    ]), '探訪記錄');
    const result = parseGenericRows({
      buffer: XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
      sheetName: '探訪記錄', headerRow: 1, snapshot: demoSnapshot, fileName: '探訪.xlsx',
      now: '2026-10-23T02:00:00.000Z', newId: () => `t-${++counter}`,
      mapping: [{ key: 'buildingName', columnIndex: 0 }, ...NO_BUILDING.map(entry => ({ ...entry, columnIndex: entry.columnIndex + 1 }))],
      defaultBuilding: { id: building.id, name: building.name },
    });
    expect(result.rows.map(row => row.input?.buildingId)).toEqual([other.id, other.id]);
    expect(result.notes.join('')).not.toContain('沒有填大廈');
  });

  it('still refuses a name the workspace does not have, rather than falling back to the typed one', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['大廈', '探訪日期', '樓', '室', '負責同事', '覆蓋結果'],
      ['不存在大廈', '2026-10-05', floor.label, unit.label, '陳同事', '已嘗試接觸'],
    ]), '探訪記錄');
    const result = parseGenericRows({
      buffer: XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
      sheetName: '探訪記錄', headerRow: 1, snapshot: demoSnapshot, fileName: '探訪.xlsx',
      now: '2026-10-23T02:00:00.000Z', newId: () => `t-${++counter}`,
      mapping: [{ key: 'buildingName', columnIndex: 0 }, ...NO_BUILDING.map(entry => ({ ...entry, columnIndex: entry.columnIndex + 1 }))],
      defaultBuilding: { id: building.id, name: building.name },
    });
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.rows[0].issues.map(issue => issue.code)).toContain('BUILDING');
  });
});

describe('a sheet that never prints a floor or unit, and the place the person typed', () => {
  const NO_PLACE = [
    { key: 'occurredAt' as const, columnIndex: 0 }, { key: 'worker' as const, columnIndex: 1 },
    { key: 'coverage' as const, columnIndex: 2 },
  ];
  const run = (rows: unknown[][], over: Partial<Parameters<typeof parseGenericRows>[0]> = {}) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['探訪日期', '負責同事', '覆蓋結果'], ...rows]), '探訪記錄');
    return parseGenericRows({
      buffer: XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
      sheetName: '探訪記錄', headerRow: 1, mapping: NO_PLACE, snapshot: demoSnapshot,
      fileName: '探訪.xlsx', now: '2026-10-23T02:00:00.000Z', newId: () => `p-${++counter}`, ...over,
    });
  };
  const defaultBuilding = { id: building.id, name: building.name };
  const defaultPlace = { buildingId: building.id, floorLabel: floor.label, unitLabel: unit.label };

  it('puts rows with no place at the one the person typed, and says so', () => {
    const result = run([['2026-10-05', '陳同事', '已嘗試接觸']], { defaultBuilding, defaultPlace });
    expect(result.rows[0].status).toBe('READY');
    expect(result.rows[0].input!.floorId).toBe(floor.id);
    expect(result.rows[0].input!.unitId).toBe(unit.id);
    expect(result.notes.join('')).toContain(`1 行沒有填樓層／單位，都按你在補充說明寫的「${floor.label} ${unit.label}」處理`);
  });

  it('leaves a row that names its own place where it says', () => {
    const otherFloor = demoSnapshot.floors.find(item => item.buildingId === building.id && item.id !== floor.id)!;
    const otherUnit = demoSnapshot.units.find(item => item.floorId === otherFloor.id && !item.parentUnitId)!;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['探訪日期', '樓層', '單位', '負責同事', '覆蓋結果'],
      ['2026-10-05', otherFloor.label, otherUnit.label, '陳同事', '已嘗試接觸'],
    ]), '探訪記錄');
    const result = parseGenericRows({
      buffer: XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
      sheetName: '探訪記錄', headerRow: 1, snapshot: demoSnapshot, fileName: '探訪.xlsx',
      now: '2026-10-23T02:00:00.000Z', newId: () => `p-${++counter}`,
      mapping: [
        { key: 'occurredAt', columnIndex: 0 }, { key: 'floor', columnIndex: 1 }, { key: 'unit', columnIndex: 2 },
        { key: 'worker', columnIndex: 3 }, { key: 'coverage', columnIndex: 4 },
      ],
      defaultBuilding, defaultPlace,
    });
    expect(result.rows[0].input!.unitId).toBe(otherUnit.id);
    expect(result.notes.join('')).not.toContain('沒有填樓層／單位');
  });

  it('does not put one building’s place on a row that resolved to another building', () => {
    const other = demoSnapshot.buildings.find(item => item.id !== building.id)!;
    const result = run([['2026-10-05', '陳同事', '已嘗試接觸']], {
      defaultBuilding: { id: other.id, name: other.name }, defaultPlace,
    });
    expect(result.rows[0].input!.floorId).toBeUndefined();
    expect(result.rows[0].input!.unitId).toBeUndefined();
    expect(result.notes.join('')).not.toContain('沒有填樓層／單位');
  });
});

describe('cells changed after the plan was shown', () => {
  it('reads an edit exactly like the cell had said so in the first place', () => {
    const before = parse([row({ 1: '' })]);
    expect(before.rows[0].status).toBe('NEEDS_REVIEW');
    expect(before.rows[0].issues.map(issue => issue.code)).toContain('MISSING_DATE');

    const after = parse([row({ 1: '' })], { overrides: [{ row: 2, column: 1, value: '2026-10-11' }] });
    expect(after.rows[0].status).toBe('READY');
    expect(after.rows[0].input!.occurredAt).toBe('2026-10-11');
  });

  it('fills a blank 覆蓋結果 cell from a person without changing the other cells', () => {
    const before = parse([row({ 5: '' })]);
    expect(before.rows[0].input).toBeUndefined();

    const after = parse([row({ 5: '' })], { overrides: [{ row: 2, column: 5, value: '已嘗試接觸' }] });
    expect(after.rows[0].input!.coverage).toBe('ATTEMPTED');
  });

  it('changes only the row it names', () => {
    const result = parse([row({ 1: '' }), row()], { overrides: [{ row: 2, column: 1, value: '2026-10-11' }] });
    expect(result.rows[0].input!.occurredAt).toBe('2026-10-11');
    expect(result.rows[1].input!.occurredAt).toBe('2026-10-09');
  });

  it('still refuses a value the parser cannot read, rather than accepting the edit', () => {
    const result = parse([row()], { overrides: [{ row: 2, column: 5, value: '好像去過' }] });
    expect(result.rows[0].status).toBe('INVALID');
    expect(result.rows[0].issues.map(issue => issue.code)).toContain('COVERAGE');
  });

  it('fills a cell past the sheet width for a field that has no column', () => {
    const mapping = MAPPING.filter(entry => entry.key !== 'coverage');
    // 100 is past the seven columns the sheet has: the person supplied a value for a field
    // the sheet never carried, so the dialog maps it to a column of its own.
    const result = parse([row()], {
      mapping: [...mapping, { key: 'coverage', columnIndex: 100 }],
      overrides: [{ row: 2, column: 100, value: '已嘗試接觸' }],
    });
    expect(result.rows[0].status).toBe('READY');
    expect(result.rows[0].input!.coverage).toBe('ATTEMPTED');
  });

  it('reads the same sheet from a matrix it was handed instead of the buffer', () => {
    const buffer = book([row()]);
    const stored = readSheetMatrix(buffer, '探訪')!;
    const result = parseGenericRows({
      buffer, sheetName: '探訪', headerRow: 1, mapping: MAPPING, snapshot: demoSnapshot,
      fileName: '回錄.xlsx', newId: () => `m-${++counter}`, matrix: stored,
    });
    expect(result.rows[0].status).toBe('READY');
    expect(result.rows[0].input!.coverage).toBe('ATTEMPTED');
  });
});

describe('one explicitly chosen year for a sheet', () => {
  it('keeps yearless rows in review, then reparses all of them with the chosen year', () => {
    const rows = [row({ 1: '12/9' }), row({ 1: '26/9' }), row({ 1: '8/10（三）' }), row({ 1: '2025-10-08' })];
    const before = parse(rows);
    expect(before.rows.slice(0, 3).every(row => row.status === 'NEEDS_REVIEW' && row.issues.some(issue => issue.code === 'MISSING_YEAR'))).toBe(true);
    const after = parse(rows, { sheetYear: 2026 });
    expect(after.rows.map(row => row.input?.occurredAt)).toEqual(['2026-09-12', '2026-09-26', '2026-10-08', '2025-10-08']);
    expect(parse(rows, { sheetYear: undefined }).counts.NEEDS_REVIEW).toBe(3);
  });
  it('refuses an impossible date after a year is chosen', () => {
    expect(parse([row({ 1: '29/2' })], { sheetYear: 2026 }).rows[0].input).toBeUndefined();
    expect(parse([row({ 1: '29/2' })], { sheetYear: 2028 }).rows[0].input?.occurredAt).toBe('2028-02-29');
  });
});
