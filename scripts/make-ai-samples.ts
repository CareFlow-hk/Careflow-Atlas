/**
 * Builds the AI-assistant test samples under `samples/ai-assistant/`.
 *
 * Every file is synthetic: the names are placeholders and the phone numbers use
 * repeating digits, so nothing here can be mistaken for a real record. Each one
 * exists to drive the assistant into a specific state, and the script re-runs the
 * rule detector on what it wrote — if a detector change moves a sample off its
 * intended status, that is a loud failure here rather than a surprise in the UI.
 *
 *   npm run samples:ai
 *
 * Run `git diff --stat samples/ai-assistant` after regenerating: the files are
 * committed so a tester can just open them, and this script is what keeps them
 * explainable.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { buildPreview } from '../src/ai/preview';
import { detectWorkbook } from '../src/imports/detector';

const OUT = 'samples/ai-assistant';

interface Sample {
  file: string;
  /** What the rule detector must say before the assistant is even offered. */
  expect: 'UNKNOWN' | 'AMBIGUOUS' | 'KNOWN';
  /** One line the README repeats, so the two cannot drift apart. */
  why: string;
  sheets: { name: string; rows: (string | number)[][] }[];
}

/** Sheet names and rows are written verbatim; only the zip is compressed. */
function write(sample: Sample): void {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sample.sheets) {
    const matrix = XLSX.utils.aoa_to_sheet(sheet.rows);
    matrix['!cols'] = (sheet.rows[0] ?? []).map(() => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(workbook, matrix, sheet.name);
  }
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer;
  // `XLSX.writeFile` needs `set_fs` under ESM; a plain write avoids that wiring.
  writeFileSync(`${OUT}/${sample.file}`, Buffer.from(buffer));
}

const samples: Sample[] = [
  {
    file: '01_機構自有探訪表.xlsx',
    expect: 'AMBIGUOUS',
    why: '表頭是機構自己的寫法（樓宇／樓／室），規則認得日期、同事、結果、備註，但找不到大廈編號 —— AI 應該補上其餘欄位並指出缺漏。',
    sheets: [{
      name: '10月探訪',
      rows: [
        ['區域', '街道', '樓宇名稱', '樓', '室', '探訪日期', '探訪結果', '負責同事', '備註'],
        ['中西區', '示範街', '裕安樓', '5', 'B', '2026-10-05', '未能完成探訪', '陳同事', '無人應門，留下聯絡卡'],
        ['中西區', '示範街', '裕安樓', '5', 'C', '2026-10-05', '已完成探訪', '陳同事', '戶主願意受訪，稍後跟進'],
        ['中西區', '示範街', '裕安樓', '6', 'A', '2026-10-06', '未能進入', '李同事', '大門鎖上，需管理處協助'],
        ['中西區', '示範街', '裕安樓', '6', 'B', '2026-10-06', '未到訪', '李同事', ''],
      ],
    }],
  },
  {
    file: '02_表頭含糊_欄位不足.xlsx',
    expect: 'UNKNOWN',
    why: '只有「日期」「同事」兩欄認得出，未達任何格式的最低要求 —— AI 應該把樓／室／情況／住戶／電話都提出來對應。',
    sheets: [{
      name: '住戶名單',
      rows: [
        ['日期', '樓', '室', '同事', '情況', '住戶', '電話'],
        ['2026-10-07', '7', 'A', '黃同事', '已接觸', '王女士', '2111 1111'],
        ['2026-10-07', '7', 'B', '黃同事', '無人應門', '（不詳）', '2222 2222'],
        ['2026-10-07', '8', 'A', '黃同事', '未嘗試接觸', '李先生', '2333 3333'],
      ],
    }],
  },
  {
    file: '03_與外展無關_工資表.xlsx',
    expect: 'UNKNOWN',
    why: '工資表，跟外展完全無關 —— AI 應該整份拒絕（固定拒絕語），不提出任何欄位建議。',
    sheets: [{
      name: '2026年10月工資',
      rows: [
        ['員工姓名', '職位', '底薪（港元）', '勤工獎', '強積金', '發薪日期'],
        ['陳大文', '社工', 28000, 500, 1400, '2026-10-31'],
        ['李小明', '活動助理', 18000, 300, 900, '2026-10-31'],
        ['黃小芳', '行政助理', 20000, 400, 1000, '2026-10-31'],
      ],
    }],
  },
  {
    file: '04_清單內格式_中文六表封存.xlsx',
    expect: 'KNOWN',
    why: '清單內的「紙本回錄」格式，規則全部認得 —— 這是對照組，AI 建議面板不應該出現。',
    // Deliberately no 使用說明 sheet: that one sheet makes the workflow importer claim the file,
    // and this sample exists to show a clean recognition, not a broken template.
    sheets: [
      {
        name: '紙本回錄',
        rows: [
          ['大廈編號', '到訪日期', '工作員', '覆蓋結果', '到訪時間', '樓層', '單位', '接觸結果', '備註'],
          ['bldg-yu-an', '2026-10-05', '陳同事', '未能完成探訪', '19:30', '5樓', '5樓 B室', '無人應門', '合成樣本'],
          ['bldg-yu-an', '2026-10-05', '陳同事', '已完成探訪', '20:05', '5樓', '5樓 C室', '已接觸', '合成樣本'],
          ['bldg-yu-an', '2026-10-06', '李同事', '未到訪', '', '6樓', '6樓 A室', '未嘗試接觸', '合成樣本'],
        ],
      },
    ],
  },
  {
    file: '05_含個人資料_外送預覽.xlsx',
    expect: 'AMBIGUOUS',
    why: '有標題列、缺大廈欄，且帶姓名與電話 —— 用來看外送預覽有沒有標出個人資料欄，以及標題列有沒有被跳過（樣本由第 2 列開始）。',
    sheets: [{
      name: '探訪紀錄',
      rows: [
        ['2026 年 10 月探訪紀錄（合成樣本，勿作真實用途）'],
        ['地址', '樓層', '單位', '住戶姓名', '電話', '探訪日期', '探訪結果', '備註'],
        ['示範街 1 號', '5樓', '5樓 B室', '陳大文（合成）', '2111 1111', '2026-10-05', '未能完成探訪', '無人應門'],
        ['示範街 1 號', '5樓', '5樓 C室', '李小明（合成）', '2222 2222', '2026-10-05', '已完成探訪', '願意受訪'],
        ['示範街 1 號', '6樓', '6樓 A室', '黃小芳（合成）', '2333 3333', '2026-10-06', '未能進入', '大門鎖上'],
      ],
    }],
  },
  {
    file: '06_只有表頭_無資料.xlsx',
    expect: 'UNKNOWN',
    why: '只有一行表頭、一筆資料都沒有 —— 外送預覽仍會產生（樣本 1 行），用來確認 AI 面對零資料時不會虛構住戶、樓層或日期。',
    sheets: [{ name: '空白', rows: [['日期', '樓', '室', '同事']] }],
  },
];

mkdirSync(OUT, { recursive: true });

let failed = false;
for (const sample of samples) {
  write(sample);
  // Re-read from disk rather than the in-memory copy: what ships is the file.
  const onDisk = readFileSync(`${OUT}/${sample.file}`);
  const buffer = onDisk.buffer.slice(onDisk.byteOffset, onDisk.byteOffset + onDisk.byteLength) as ArrayBuffer;
  const recognition = detectWorkbook(buffer);
  const preview = buildPreview(buffer, recognition, sample.file);
  const status = recognition.status === sample.expect ? 'OK  ' : 'FAIL';
  if (status === 'FAIL') failed = true;
  const detail = preview.ok
    ? `樣本 ${preview.preview.rows.length} 行×${preview.preview.columnCount} 欄，個人資料欄 ${preview.preview.sensitiveColumns.map(index => index + 1).join('、') || '無'}`
    : `預覽拒絕：${preview.reason}`;
  console.log(`${status} ${sample.file} · 規則識別 ${recognition.status}（預期 ${sample.expect}）· ${detail}`);
  if (status === 'FAIL') console.log(`      ${sample.why}`);
}

if (failed) {
  console.error('\n樣本與預期不符：請先看偵測器是否改了口徑，再調整樣本或本腳本。');
  process.exitCode = 1;
}
