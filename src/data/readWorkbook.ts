import * as XLSX from 'xlsx';

/** Bound every reader, including recognition and the archived Chinese workbook. */
export function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  if (buffer.byteLength > 5 * 1024 * 1024) throw new Error('示範匯入上限為 5 MB。');
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, cellFormula: true, sheetRows: 5002 });
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const ref = sheet['!fullref'] || sheet['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    if (range.e.r >= 5000 || range.e.c >= 64) throw new Error(`${name}：每張示範工作表限 5000 列及 64 欄。`);
  }
  return workbook;
}
