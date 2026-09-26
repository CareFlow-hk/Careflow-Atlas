import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { detectWorkbook, recognitionBlocker } from './detector';
import { exportWorkflowWorkbook, parseWorkflowWorkbook } from '../data/workflowWorkbook';
import { workflowDemo } from '../data/workflowDemo';
import { paperHeaders } from '../data/workflowFormat';

const bytes = (workbook: XLSX.WorkBook) => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
const book = () => XLSX.read(exportWorkflowWorkbook(workflowDemo), { type: 'array' });

describe('import safety regressions', () => {
  it('does not let multiple canonical fields silently claim the same column', () => {
    const result = detectWorkbook(exportWorkflowWorkbook(workflowDemo), { columns: { worker: 7 } });
    expect(result.fields.find(f => f.key === 'worker')?.status).toBe('AMBIGUOUS');
    expect(recognitionBlocker(result)).toBeTruthy();
  });
  it('can explicitly map a value-bearing column with a blank trailing header', () => {
    const wb = book();
    XLSX.utils.sheet_add_aoa(wb.Sheets['紙本回錄'], [['補充']], { origin: { r: 6, c: paperHeaders.length } });
    const result = detectWorkbook(bytes(wb), { columns: { note: paperHeaders.length } });
    expect(result.fields.find(f => f.key === 'note')).toMatchObject({ columnIndex: paperHeaders.length, overridden: 'column' });
  });
  it('blocks unconfirmed candidate fields', () => {
    const result = detectWorkbook(exportWorkflowWorkbook(workflowDemo));
    result.fields.find(f => f.key === 'coverage')!.status = 'CANDIDATE';
    result.status = 'CANDIDATE';
    expect(recognitionBlocker(result)).toBeTruthy();
  });
  it('never treats an unimplemented template as importable', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['姓名', '電話'], ['測試', '00123']]), '個人');
    expect(recognitionBlocker(detectWorkbook(bytes(wb)))).toBeTruthy();
  });
  it('reports data under a blank header, including beyond the value sample', () => {
    const wb = book();
    XLSX.utils.sheet_add_aoa(wb.Sheets['紙本回錄'], [['不能遺漏']], { origin: { r: 40, c: paperHeaders.length + 1 } });
    const result = detectWorkbook(bytes(wb));
    expect(result.unmatchedColumns.some(c => c.columnIndex === paperHeaders.length + 1 && c.hasData)).toBe(true);
    expect(parseWorkflowWorkbook(bytes(wb), 'blank-header.xlsx')?.snapshot).toBeUndefined();
  });
  it('allows unknown paper worker in the visit candidate without inventing one', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['到訪日期', '大廈編號', '單位', '備註'], ['2026-09-10', 'b1', 'A', '未知工作員']]), '探訪記錄');
    const result = detectWorkbook(bytes(wb), { profileId: 'one-visit-per-row' });
    expect(result.fields.find(f => f.key === 'worker')?.required).toBe(false);
    expect(result.status).not.toBe('AMBIGUOUS');
  });
});
