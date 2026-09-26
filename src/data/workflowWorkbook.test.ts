import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { workflowDemo } from './workflowDemo';
import { demoSnapshot } from './demoFixture';
import { exportWorkflowWorkbook, parseWorkflowWorkbook } from './workflowWorkbook';
import { mergeWorkflow } from './workflowMerge';
import { excelDate, paperHeaders } from './workflowFormat';
import { getCoverageStatus, getOpenFollowUps, type OutreachSnapshot } from '../domain/types';

const now = '2026-09-11T04:00:00Z';
const workbook = (snapshot = workflowDemo) => XLSX.read(exportWorkflowWorkbook(snapshot), { type: 'array' });
const parse = (wb: XLSX.WorkBook, time = now) => parseWorkflowWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'test.xlsx', time)!;
const newRow = (wb: XLSX.WorkBook, fields: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = { '紙本編號': 'QA-01', '紙本行號': '1', '到訪日期': excelDate('2026-09-10'), '工作員': '合成工作員', '大廈編號': 'bldg-yu-an', '樓層': '5F', '單位': '5F B室', '覆蓋結果': '已嘗試接觸', '紙本原話／備註': '合成回錄', ...fields };
  XLSX.utils.sheet_add_aoa(wb.Sheets['紙本回錄'], [paperHeaders.map(h => data[h] ?? '')], { origin: -1 });
};

describe('paper and Excel workflow', () => {
  it('preserves physical row numbers through blank rows and accepts sorted correction rows', () => {
    const wb = workbook();
    const target = 'paper:QA-01:1:bldg-yu-an';
    newRow(wb, { '紙本行號': '2', '更正原記錄編號': target });
    XLSX.utils.sheet_add_aoa(wb.Sheets['紙本回錄'], [['']], { origin: -1 });
    newRow(wb, { '紙本行號': '1' });
    const result = parse(wb);
    expect(result.issues).toEqual([]);
    expect(result.snapshot?.observations.at(-1)?.importSource?.row).toBe(XLSX.utils.decode_range(wb.Sheets['紙本回錄']['!ref']!).e.r + 1);
  });
  it('round trips all entities, relations, footprints, history and text telephone numbers', () => {
    const snapshot = structuredClone(workflowDemo);
    snapshot.people[0].phone = '0012345678';
    const result = parse(workbook(snapshot));
    expect(result.issues).toEqual([]);
    expect(result.snapshot).toEqual(snapshot);
  });
  it('imports the styled downloadable mock with no issues', () => {
    const bytes = readFileSync('public/demo/careflow-paper-excel-mock.xlsx');
    const result = parseWorkflowWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'mock.xlsx');
    expect(result?.issues).toEqual([]);
    expect(result?.snapshot).toEqual(workflowDemo);
  });
  it('keeps date-only visits and uncertain timing without inventing a deadline', () => {
    const wb = workbook();
    newRow(wb, { '跟進行動': '確認到訪安排', '跟進類別': '健康關懷', '負責人': '合成同事', '時間原話／待確認': '翌日午後，待確認' });
    const result = parse(wb);
    expect(result.issues).toEqual([]);
    expect(result.snapshot?.observations.at(-1)).toMatchObject({ occurredAt: '2026-09-10', paperRef: 'QA-01', paperLine: '1', importSource: { file: 'test.xlsx', sheet: '紙本回錄' }, followUp: { category: 'HEALTH_SUPPORT', timingNote: '翌日午後，待確認' } });
    expect(result.snapshot?.observations.at(-1)?.followUp?.dueDate).toBeUndefined();
  });
  it('is idempotent when the same file is imported later under another name', () => {
    const wb = workbook(); newRow(wb);
    const first = parse(wb), second = parse(wb, '2026-09-12T04:00:00Z');
    second.snapshot!.observations.at(-1)!.importSource!.file = 'renamed.xlsx';
    const merged = mergeWorkflow(first.snapshot, second.snapshot!, second.baseline);
    expect(merged.issues).toEqual([]);
    expect(merged.summary.added).toBe(0);
    expect(merged.snapshot).toEqual(first.snapshot);
  });
  it('accepts Excel time fractions and text dates for unchanged old history', () => {
    const wb = workbook();
    wb.Sheets['紙本回錄'].E7 = { t: 's', v: '2026-09-09' };
    wb.Sheets['紙本回錄'].F7 = { t: 'n', v: (18 * 60 + 40) / 1440 };
    expect(parse(wb).snapshot).toEqual(workflowDemo);
  });
  it('understands a workbook using the Excel 1904 date system', () => {
    const wb = workbook();
    wb.Workbook = { WBProps: { date1904: true } };
    for (const name of ['紙本回錄', '待跟進']) for (const [address, cell] of Object.entries(wb.Sheets[name])) if (!address.startsWith('!') && cell.t === 'n' && cell.z === 'yyyy-mm-dd') cell.v -= 1462;
    // SheetJS read does not retain number formats unless requested; adjust known date columns.
    for (const name of ['紙本回錄', '待跟進']) {
      const ws = wb.Sheets[name]; const range = XLSX.utils.decode_range(ws['!ref']!);
      const columns = name === '紙本回錄' ? [4, 19] : [6];
      for (let r = 6; r <= range.e.r; r++) for (const c of columns) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell?.t === 'n' && !cell.z) cell.v -= 1462; }
    }
    expect(parse(wb).snapshot).toEqual(workflowDemo);
  });
  it.each([
    ['blank coverage', { '覆蓋結果': '' }], ['invalid date', { '到訪日期': '2026-02-31' }], ['ambiguous location', { '單位': '不存在' }], ['missing action', { '時間原話／待確認': '明天' }],
  ])('blocks %s without returning a partially importable snapshot', (_, values) => {
    const wb = workbook(); newRow(wb, values);
    expect(parse(wb).snapshot).toBeUndefined();
    expect(parse(wb).issues.some(i => i.severity === 'error' && i.sheet === '紙本回錄' && i.row)).toBe(true);
  });
  it('blocks changes to old observations, formulas, extra columns and numeric phones', () => {
    for (const modify of [
      (wb: XLSX.WorkBook) => { wb.Sheets['紙本回錄'].N7 = { t: 's', v: '覆寫歷史' }; },
      (wb: XLSX.WorkBook) => { wb.Sheets['個人名冊'].B7.f = '1+1'; },
      (wb: XLSX.WorkBook) => { XLSX.utils.sheet_add_aoa(wb.Sheets['個人名冊'], [['未識別'], ['不要遺漏']], { origin: 'H6' }); },
      (wb: XLSX.WorkBook) => { wb.Sheets['個人名冊'].C7 = { t: 'n', v: 123456 }; },
      (wb: XLSX.WorkBook) => { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['未支援的資料']]), '新工作表'); },
    ]) { const wb = workbook(); modify(wb); expect(parse(wb).snapshot).toBeUndefined(); }
  });
  it('updates a person using the export baseline, while rejecting a concurrent conflicting edit', () => {
    const wb = workbook(); wb.Sheets['個人名冊'].B7.v = '合成新稱呼';
    const result = parse(wb);
    const merged = mergeWorkflow(workflowDemo, result.snapshot!, result.baseline);
    expect(merged.summary.updated).toBe(1);
    expect(merged.snapshot?.people[0].displayName).toBe('合成新稱呼');
    const current = structuredClone(workflowDemo); current.people[0].displayName = '另一位同事已修改';
    expect(mergeWorkflow(current, result.snapshot!, result.baseline).snapshot).toBeUndefined();
  });
  it('preserves newer local entities and observations when merging an old file or removed Excel rows', () => {
    const current = structuredClone(workflowDemo); current.people[0].phone = '0012345';
    const wb = workbook(demoSnapshot);
    delete wb.Sheets['紙本回錄'].N7;
    // Remove the entire old row from the visible page; its archive still preserves history.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['紙本回錄'], { header: 1, defval: '' }); rows.splice(6, 1); wb.Sheets['紙本回錄'] = XLSX.utils.aoa_to_sheet(rows);
    const result = parse(wb);
    expect(mergeWorkflow(current, result.snapshot!, result.baseline).snapshot).toEqual(current);
  });
  it('closes an existing follow-up with an appended result and preserves closure on re-export', () => {
    const wb = workbook(); newRow(wb, { '結束跟進編號': 'demo-paper-housing' });
    const result = parse(wb);
    expect(result.issues).toEqual([]);
    expect(getOpenFollowUps(result.snapshot!).some(t => t.observationId === 'demo-paper-housing')).toBe(false);
    expect(parse(workbook(result.snapshot!)).snapshot).toEqual(result.snapshot);
    newRow(wb, { '紙本行號': '2', '結束跟進編號': 'demo-paper-housing' });
    expect(parse(wb).snapshot).toBeUndefined();
  });
  it('makes an appended correction take effect, and keeps the wrong row as history', () => {
    // 7F A室 has no other history, so the correction is the only thing that can decide coverage.
    const unit = ['bldg-yu-an', 'bldg-yu-an-f7-A'] as const;
    const wb = workbook();
    // The commonest paper correction: a date typed a year out, appended in good faith.
    newRow(wb, { '紙本行號': '1', '樓層': '7F', '單位': '7F A室', '到訪日期': excelDate('2030-05-05'), '覆蓋結果': '暫無可靠記錄' });
    const wrongId = 'paper:QA-01:1:bldg-yu-an';
    const before = parse(wb);
    expect(before.issues).toEqual([]);
    expect(before.snapshot!.observations.at(-1)?.id).toBe(wrongId);
    const wrongStatus = getCoverageStatus(before.snapshot!, ...unit);

    // Correcting it appends a second row that names the first; the original is never rewritten.
    newRow(wb, { '紙本行號': '2', '樓層': '7F', '單位': '7F A室', '到訪日期': excelDate('2026-09-09'), '覆蓋結果': '已查看・無發現', '更正原記錄編號': wrongId, '更正原因': '日期年份錯填' });
    const result = parse(wb);
    expect(result.issues).toEqual([]);
    expect(result.snapshot!.observations.at(-1)).toMatchObject({ correctsObservationId: wrongId, correctionReason: '日期年份錯填', occurredAt: '2026-09-09' });
    // Coverage moves to the corrected version: the wrong later date no longer decides anything.
    expect(getCoverageStatus(result.snapshot!, ...unit)).toBe('VISITED_NO_FINDING');
    expect(wrongStatus).not.toBe('VISITED_NO_FINDING');
    // The wrong row is untouched and still there for traceability.
    expect(result.snapshot!.observations.find(o => o.id === wrongId)).toMatchObject({ occurredAt: '2030-05-05', coverage: 'UNKNOWN' });
    // A correction is not a licence to rewrite: pointing at an unknown record is refused.
    const dangling = workbook(); newRow(dangling, { '更正原記錄編號': 'paper:不存在:1:bldg-yu-an' });
    expect(parse(dangling).snapshot).toBeUndefined();
  });
  it('refuses two live corrections for one record instead of guessing which wins', () => {
    const wb = workbook();
    newRow(wb, { '紙本行號': '1' });
    const target = 'paper:QA-01:1:bldg-yu-an';
    newRow(wb, { '紙本行號': '2', '更正原記錄編號': target, '更正原因': '第一次更正' });
    const first = parse(wb);
    expect(first.snapshot?.observations.some(o => o.correctsObservationId === target)).toBe(true);
    // Re-export with both corrections live: the second one cannot be ordered against the first.
    const both = workbook(); newRow(both, { '紙本行號': '1' });
    newRow(both, { '紙本行號': '2', '更正原記錄編號': target, '更正原因': '甲' });
    newRow(both, { '紙本行號': '3', '更正原記錄編號': target, '更正原因': '乙' });
    const conflict = parse(both);
    expect(conflict.snapshot).toBeUndefined();
    expect(conflict.issues.some(i => i.severity === 'error' && i.message.includes('無法判斷'))).toBe(true);
  });
  it('supports legacy snapshots through non-destructive merge and blocks same-id conflicts', () => {
    expect(mergeWorkflow(workflowDemo, demoSnapshot).snapshot).toEqual(workflowDemo);
    const altered: OutreachSnapshot = structuredClone(demoSnapshot); altered.observations[0].note = 'conflict';
    expect(mergeWorkflow(workflowDemo, altered).snapshot).toBeUndefined();
  });
});
