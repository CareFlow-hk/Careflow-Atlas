import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readWorkbook } from './readWorkbook';

describe('bounded workbook reader', () => {
  it('rejects oversized files before parsing', () => {
    expect(() => readWorkbook(new ArrayBuffer(5 * 1024 * 1024 + 1))).toThrow(/5 MB/);
  });
  it.each([{ r: 5000, c: 0 }, { r: 1, c: 64 }])('rejects excessive sheet dimensions %j without silently truncating', cell => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['header']]);
    XLSX.utils.sheet_add_aoa(sheet, [['outside limit']], { origin: cell });
    XLSX.utils.book_append_sheet(wb, sheet, 'test');
    expect(() => readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))).toThrow(/5000/);
  });
});
