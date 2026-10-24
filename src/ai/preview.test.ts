import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { detectWorkbook, type DetectionResult } from '../imports/detector';
import { CELL_LIMIT, CHUNK_ROWS, MAX_FILE_BYTES, MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, buildPreview, chunkRows, outboundSummary } from './preview';

const book = (sheets: Record<string, unknown[][]>): ArrayBuffer => {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
};

const recognition = (over: Partial<DetectionResult> = {}): DetectionResult => ({
  detectorVersion: 'test', headers: [], status: 'UNKNOWN', score: 0, fields: [],
  unmatchedColumns: [], issues: [], appliedOverrides: [], ...over,
});

const previewOf = (buffer: ArrayBuffer, override: Partial<DetectionResult> = {}) => {
  const built = buildPreview(buffer, recognition(override), '回錄.xlsx');
  if (!built.ok) throw new Error(built.reason);
  return built.preview;
};

const refusal = (buffer: ArrayBuffer, override: Partial<DetectionResult> = {}) => {
  const built = buildPreview(buffer, recognition(override), '回錄.xlsx');
  return built.ok ? '' : built.reason;
};

describe('what leaves the browser', () => {
  it('sends every row of the chosen sheet, not a sample', () => {
    const rows = [['姓名', '人數'], ...Array.from({ length: 60 }, (_, index) => [`姓名${index}`, index])];
    const preview = previewOf(book({ 其他: [['不應送出']], 探訪: rows }), { sheetName: '探訪', headerRow: 0 });
    expect(preview.sheetName).toBe('探訪');
    expect(preview.totalRows).toBe(61);
    expect(preview.rows).toHaveLength(61);
    expect(preview.rows[60]).toEqual(['姓名59', '59']);
    expect(preview.rows.flat()).not.toContain('不應送出');
    expect(preview.sheets).toEqual([{ name: '其他', rows: 1, columns: 1 }, { name: '探訪', rows: 61, columns: 2 }]);
  });

  it('splits a long sheet into parts that add up to the same number of rows', () => {
    const rows = [['姓名'], ...Array.from({ length: 700 }, (_, index) => [`姓名${index}`])];
    const preview = previewOf(book({ 探訪: rows }), { sheetName: '探訪', headerRow: 0 });
    expect(preview.totalRows).toBe(701);
    expect(preview.chunks).toHaveLength(3);
    expect(preview.chunks[0].end - preview.chunks[0].start).toBe(CHUNK_ROWS);
    expect(preview.chunks.at(-1)!.end).toBe(701);
    expect(outboundSummary(preview)).toContain('共 701 行');
    expect(outboundSummary(preview)).toContain('將分 3 次送出');
  });

  it('names the other sheets that are not sent', () => {
    const preview = previewOf(book({ 甲: [['a']], 乙: [['b']], 丙: [['c']] }), { sheetName: '乙' });
    expect(outboundSummary(preview)).toContain('另 2 個工作表（甲、丙）未送交 AI');
  });

  it('finds the header row it was given, counting worksheet rows, not non-empty rows', () => {
    const preview = previewOf(book({ 表: [['標題'], [''], ['姓名', '電話'], ['陳大文', '61234567']] }), { sheetName: '表', headerRow: 2 });
    expect(preview.headerRow).toBe(1);
    expect(preview.headers).toEqual(['姓名', '電話']);
    expect(preview.rowNumbers).toEqual([1, 3, 4]);
    expect(preview.rows[1]).toEqual(['姓名', '電話']);
  });

  it('flags names and phone numbers, since those leave the machine too', () => {
    const preview = previewOf(book({ 表: [['姓名', '人數', '到訪日期'], ['陳大文', 3, '2026-10-01'], ['李小花', 4, '2026-10-02']] }), { sheetName: '表', headerRow: 0 });
    expect(preview.sensitiveColumns).toEqual([0]);
  });

  it('flags a column that only holds phone numbers even without a telling header', () => {
    const preview = previewOf(book({ 表: [['甲', '乙'], ['61234567', '一'], ['98765432', '二']] }), { sheetName: '表', headerRow: 0 });
    expect(preview.sensitiveColumns).toEqual([0]);
  });

  it('withholds a removed column completely, header included', () => {
    const preview = previewOf(book({ 表: [['姓名', '人數'], ['陳大文', 3]] }), { sheetName: '表', headerRow: 0 });
    const sent = chunkRows(preview, preview.chunks[0], [0]);
    expect(sent).toEqual([['', '人數'], ['', '3']]);
    expect(outboundSummary(preview, [0])).toContain('已剔除 1 欄：姓名（未送交 AI）');
    expect(outboundSummary(preview, [0])).toContain('共 2 行 · 1 欄');
  });

  it('keeps every cell bounded and says how many were shortened', () => {
    const preview = previewOf(book({ 表: [['備註'], ['字'.repeat(500)]] }), { sheetName: '表', headerRow: 0 });
    expect(preview.rows[1][0]).toHaveLength(CELL_LIMIT);
    expect(preview.truncatedCells).toBe(1);
    expect(outboundSummary(preview)).toContain('有 1 格超過');
  });

  it('refuses a file over the stated size instead of trimming it', () => {
    expect(refusal(new ArrayBuffer(MAX_FILE_BYTES + 1))).toContain('超過');
  });

  it('refuses a sheet over the stated limits and says what to do', () => {
    const wide = [Array.from({ length: MAX_SHEET_COLUMNS + 1 }, (_, index) => `欄${index}`)];
    expect(refusal(book({ 表: wide }), { sheetName: '表' })).toContain('請先分拆檔案');
    const tall = Array.from({ length: MAX_SHEET_ROWS + 1 }, (_, index) => [`第${index}行`]);
    expect(refusal(book({ 表: tall }), { sheetName: '表' })).toContain(`${MAX_SHEET_ROWS} 行上限`);
  });

  it('refuses an empty sheet instead of sending nothing', () => {
    expect(refusal(book({ 表: [[''], ['']] }), { sheetName: '表', headerRow: 0 })).toContain('空白工作表');
  });

  it('works on the workbook the rule detector refused, which is the case the assistant exists for', () => {
    const buffer = book({ 受訪記錄: [['受訪者', '樓室', '甲欄'], ['陳大文', '3/F', 'x'], ['李小花', '4/F', 'y']] });
    const found = detectWorkbook(buffer);
    expect(found.status).toBe('UNKNOWN');
    const preview = previewOf(buffer, found);
    expect(preview.sheetName).toBe('受訪記錄');
    expect(preview.headerRow).toBeNull();
    expect(preview.rows[0]).toEqual(['受訪者', '樓室', '甲欄']);
    expect(preview.totalRows).toBe(3);
  });
});
