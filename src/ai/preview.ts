/**
 * What the assistant is about to see, and how it is split up on the way out.
 *
 * The assistant reads the **whole** chosen worksheet, not a sample (`docs/AI_ASSISTANT.md`
 * 6.1). A worksheet that does not fit the reader's stated limits is refused with a
 * sentence asking for a smaller file; it is never trimmed behind the person's back. The
 * preview is also where a column can be withheld: a withheld column leaves as `null` in
 * every row, so neither its header nor its cells ever reach the provider.
 *
 * Nothing here decides an outcome. It only describes the file and slices it, so the same
 * numbers can be shown before sending and compared with the proposal afterwards.
 */
import * as XLSX from 'xlsx';

/** The reader's limits, stated on screen when a file is refused. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SHEET_ROWS = 5000;
export const MAX_SHEET_COLUMNS = 64;
/** One cell is shortened so a pasted essay cannot dominate a request; the count is shown. */
export const CELL_LIMIT = 80;
/** Chunking: at most this many rows, and at most this much text, per request. */
export const CHUNK_ROWS = 300;
export const CHUNK_CHARS = 80_000;

export interface SheetSummary { name: string; rows: number; columns: number }

export interface ChunkBound { start: number; end: number }

export interface OutboundPreview {
  fileName: string;
  sheetName: string;
  /** Every worksheet, so the preview can say what is not being sent. */
  sheets: SheetSummary[];
  /** Absolute index into `rows`; null when the rule detector recognised no header. */
  headerRow: number | null;
  headers: string[];
  columnCount: number;
  /** Rows carrying at least one non-empty cell, from the top of the sheet. */
  totalRows: number;
  rows: string[][];
  /** 1-based worksheet row for each entry in `rows`. */
  rowNumbers: number[];
  /** Column indices whose header (or whole contents) look personal. */
  sensitiveColumns: number[];
  /** Cells shortened to `CELL_LIMIT`; reported so "all rows" is not overstated. */
  truncatedCells: number;
  chunks: ChunkBound[];
}

export type PreviewResult = { ok: true; preview: OutboundPreview } | { ok: false; reason: string };

const SENSITIVE_HEADER = /(姓名|名字|名稱|稱呼|電話|手機|聯絡|住址|地址|身份證|身分證|生日|出生|備註|原話|contact|phone|mobile|name|address|note|remark)/i;
const PHONE_SHAPE = /^[+(]?\d[\d\s()-]{6,}$/;
const DATE_SHAPE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/;
/** A date serial and a phone number are both digits and dashes; only one is personal. */
const looksLikePhone = (cell: string) => {
  const digits = cell.replace(/\D/g, '');
  return PHONE_SHAPE.test(cell) && digits.length >= 7 && digits.length <= 15 && !DATE_SHAPE.test(cell);
};

const EMPTY = (value: unknown) => value == null || String(value).trim() === '';

function matrixOf(workbook: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = workbook.Sheets[name];
  return sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true }) : [];
}

function rowsOf(matrix: unknown[][], width: number): { rows: string[][]; numbers: number[]; truncated: number } {
  const rows: string[][] = [];
  const numbers: number[] = [];
  let truncated = 0;
  matrix.forEach((values, index) => {
    if (!values.some(value => !EMPTY(value))) return;
    rows.push(Array.from({ length: width }, (_, col) => {
      const text = EMPTY(values[col]) ? '' : String(values[col]).trim();
      if (text.length <= CELL_LIMIT) return text;
      truncated++;
      return text.slice(0, CELL_LIMIT);
    }));
    numbers.push(index + 1);
  });
  return { rows, numbers, truncated };
}

function sensitiveOf(rows: string[][], header: number | null, width: number): number[] {
  const found: number[] = [];
  for (let col = 0; col < width; col++) {
    if (header !== null && SENSITIVE_HEADER.test(rows[header]?.[col] ?? '')) { found.push(col); continue; }
    const filled = rows.slice(header === null ? 0 : header + 1).map(row => row[col] ?? '').filter(Boolean);
    if (filled.length && filled.every(looksLikePhone)) found.push(col);
  }
  return found;
}

function chunkBounds(rows: string[][]): ChunkBound[] {
  const bounds: ChunkBound[] = [];
  let start = 0;
  while (start < rows.length) {
    let end = start, chars = 0;
    while (end < rows.length && end - start < CHUNK_ROWS) {
      const size = rows[end].reduce((total, cell) => total + cell.length + 3, 0);
      if (end > start && chars + size > CHUNK_CHARS) break;
      chars += size;
      end++;
    }
    bounds.push({ start, end });
    start = end;
  }
  return bounds;
}

/**
 * Reads one worksheet in full. `sheetName` overrides the sheet the rule detector picked;
 * a detector that recognised a different sheet contributes neither header nor sheet.
 */
export function buildPreview(buffer: ArrayBuffer, recognition: { sheetName?: string; headerRow?: number | null }, fileName: string, sheetName?: string): PreviewResult {
  if (buffer.byteLength > MAX_FILE_BYTES) return { ok: false, reason: `這個檔案 ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB，超過 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限。請先拆成較小的檔案。` };
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(buffer, { type: 'array' }); }
  catch { return { ok: false, reason: '讀不到這個檔案。請確認是 .xlsx、.xls 或 .csv，並且沒有損壞。' }; }
  if (!workbook.SheetNames.length) return { ok: false, reason: '這個檔案沒有工作表。' };

  const sheets: SheetSummary[] = workbook.SheetNames.map(name => {
    const matrix = matrixOf(workbook, name);
    const rows = matrix.filter(values => values.some(value => !EMPTY(value))).length;
    const columns = matrix.reduce((max, values) => Math.max(max, values.length), 0);
    return { name, rows, columns };
  });

  const chosen = sheetName ?? recognition.sheetName ?? [...sheets].sort((a, b) => b.rows - a.rows)[0]?.name ?? workbook.SheetNames[0];
  if (!workbook.SheetNames.includes(chosen)) return { ok: false, reason: `找不到工作表「${chosen}」。` };
  const summary = sheets.find(sheet => sheet.name === chosen)!;
  if (!summary.rows) return { ok: false, reason: `「${chosen}」是空白工作表，沒有可送出的內容。` };
  if (summary.rows > MAX_SHEET_ROWS) return { ok: false, reason: `「${chosen}」有 ${summary.rows} 行，超過 ${MAX_SHEET_ROWS} 行上限。請先分拆檔案。` };
  if (summary.columns > MAX_SHEET_COLUMNS) return { ok: false, reason: `「${chosen}」有 ${summary.columns} 欄，超過 ${MAX_SHEET_COLUMNS} 欄上限。請先分拆檔案。` };

  const width = summary.columns;
  const matrix = matrixOf(workbook, chosen);
  const { rows, numbers, truncated } = rowsOf(matrix, width);
  if (!rows.length) return { ok: false, reason: `「${chosen}」只有空白儲存格，沒有可送出的內容。` };

  // The rule detector's header index is a worksheet row; `rows` drops blanks, so translate.
  const detected = recognition.sheetName === chosen && typeof recognition.headerRow === 'number' ? numbers.indexOf(recognition.headerRow + 1) : -1;
  const headerRow = detected >= 0 ? detected : null;
  const headers = headerRow === null ? [] : rows[headerRow].map((cell, col) => cell || `第 ${col + 1} 欄`);

  return {
    ok: true,
    preview: {
      fileName, sheetName: chosen, sheets, headerRow, headers, columnCount: width,
      totalRows: rows.length, rows, rowNumbers: numbers,
      sensitiveColumns: sensitiveOf(rows, headerRow, width),
      truncatedCells: truncated, chunks: chunkBounds(rows),
    },
  };
}

/** The rows of one chunk, with the withheld columns blanked out before anything leaves. */
export function chunkRows(preview: OutboundPreview, chunk: ChunkBound, withheld: readonly number[] = []): string[][] {
  return preview.rows.slice(chunk.start, chunk.end).map(row => row.map((cell, col) => withheld.includes(col) ? '' : cell));
}

/** The header labels of one chunk, with the same columns blanked. */
export function chunkHeaders(preview: OutboundPreview, withheld: readonly number[] = []): string[] {
  return preview.headers.map((header, col) => withheld.includes(col) ? '' : header);
}

/** What the preview says before the person presses send. */
export function outboundSummary(preview: OutboundPreview, withheld: readonly number[] = []): string {
  const sent = preview.columnCount - withheld.length;
  const others = preview.sheets.filter(sheet => sheet.name !== preview.sheetName);
  const parts = [
    `「${preview.sheetName}」共 ${preview.totalRows} 行 · ${sent} 欄，將分 ${preview.chunks.length} 次送出。`,
    others.length ? `另 ${others.length} 個工作表（${others.map(sheet => sheet.name).join('、')}）未送交 AI。` : '',
    withheld.length ? `已剔除 ${withheld.length} 欄：${withheld.map(col => preview.headers[col] || `第 ${col + 1} 欄`).join('、')}（未送交 AI）。` : '',
    preview.truncatedCells ? `有 ${preview.truncatedCells} 格超過 ${CELL_LIMIT} 字，只送出前 ${CELL_LIMIT} 字。` : '',
  ];
  return parts.filter(Boolean).join('');
}
