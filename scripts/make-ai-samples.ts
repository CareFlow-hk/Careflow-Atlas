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
import { MAX_SHEET_COLUMNS, buildPreview } from '../src/ai/preview';
import { detectWorkbook } from '../src/imports/detector';

const OUT = 'samples/ai-assistant';

/** Over the per-cell limit (80 characters), so the preview has to admit truncation. */
const LONG_NOTE_A = '單位內兩戶共用廚房及洗手間，走廊照明不足，門口有雜物堆放。住戶表示晚上八時後才有人在家，需要再與管理處確認上樓時間，並提醒同工不要單獨入內。另外走廊有兩戶共用電錶，需記錄讀數，住戶擔心加租，想了解租務管制。';
const LONG_NOTE_B = '大門鎖上，按鈴三次無人回應，門外有新的外賣單據。鄰居表示單位近日有人出入，但多數在日間，建議改為下午時段再訪，並先向管理處核對住戶是否仍在。鐵閘有新換的鎖頭，門牌與紀錄不符，需要再確認。';
const LONG_NOTE_C = '住戶願意受訪，表示單位已分間為三間，租金按月繳付，沒有書面租約。住戶詢問申請津貼的方法，已留下單張並記下需要下次帶同表格再來詳細說明。住戶提到業主近期會上門收租，希望同工避開該時段。';

interface Sample {
  file: string;
  /**
   * What the rule detector must say before the assistant is even offered.
   * `REFUSED` means the shared reader throws on size limits instead of answering, which is
   * also a legitimate sample: the person must see a refusal, not a silently trimmed sheet.
   */
  expect: 'UNKNOWN' | 'AMBIGUOUS' | 'KNOWN' | 'REFUSED';
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
  {
    file: '07_分塊測試_701行工資表.xlsx',
    expect: 'UNKNOWN',
    // 701 行剛好越過兩個 CHUNK_ROWS，分成 3 段；非外展內容，所以第 1 段就該回 REFUSE。
    why: '701 行的工資表，會分成 3 段送出 —— 用來確認第 1 段拒絕之後就停，另外 2 段不再送出，也不再按次付費。',
    sheets: [{
      name: '2026年10月工資',
      rows: [
        ['員工姓名', '職位', '底薪（港元）', '勤工獎', '強積金', '發薪日期'],
        ...Array.from({ length: 700 }, (_, index) => {
          const number = String(index + 1).padStart(3, '0');
          return [`員工${number}（合成）`, '外展助理', 18000, 300, 900, '2026-10-31'] as (string | number)[];
        }),
      ],
    }],
  },
  {
    file: '08_超長儲存格_截斷.xlsx',
    expect: 'UNKNOWN',
    why: '三格的現場文字超過 80 字 —— 預覽要說明「有 3 格超過 80 字，只送出前 80 字」，實際請求裡的內容也確實被截斷，不能聲稱送了完整原文。',
    sheets: [{
      name: '探訪記錄',
      rows: [
        ['探訪日期', '樓', '室', '負責同事', '現場情況文字'],
        ['2026-10-05', '5', 'B', '陳同事', LONG_NOTE_A],
        ['2026-10-05', '5', 'C', '陳同事', LONG_NOTE_B],
        ['2026-10-06', '6', 'A', '李同事', LONG_NOTE_C],
      ],
    }],
  },
  {
    file: '09_欄數超上限_拒絕.xlsx',
    expect: 'REFUSED',
    why: '65 欄，比 64 欄上限多 1 欄 —— 讀取階段就拒絕，整份檔案不會送到 AI，也不得靜默截掉第 65 欄（目前訊息來自共用的讀取器，用語仍寫「示範」）。',
    sheets: [{
      name: '過寬的表',
      rows: [
        Array.from({ length: MAX_SHEET_COLUMNS + 1 }, (_, index) => `欄${index + 1}`),
        Array.from({ length: MAX_SHEET_COLUMNS + 1 }, (_, index) => `甲-${index + 1}`),
        Array.from({ length: MAX_SHEET_COLUMNS + 1 }, (_, index) => `乙-${index + 1}`),
      ],
    }],
  },
  {
    file: '10_多工作表_只送一份.xlsx',
    expect: 'AMBIGUOUS',
    why: '兩個工作表：外展紀錄（較多行，會被選中）與工資表 —— 用來確認只有被選中的那份進請求，預覽要写明另一個工作表「未送交 AI」。',
    sheets: [
      {
        name: '探訪紀錄',
        rows: [
          ['探訪日期', '樓', '室', '負責同事', '探訪結果'],
          ...Array.from({ length: 12 }, (_, index) => [
            '2026-10-05', String(3 + (index % 3)), String.fromCharCode(65 + (index % 2)),
            index % 2 ? '陳同事' : '李同事', index % 3 ? '未能完成探訪' : '已完成探訪',
          ] as (string | number)[]),
        ],
      },
      {
        name: '工資（勿送）',
        rows: [
          ['員工姓名', '職位', '底薪（港元）'],
          ['陳大文（合成）', '社工', 28000],
          ['李小明（合成）', '活動助理', 18000],
        ],
      },
    ],
  },
];

mkdirSync(OUT, { recursive: true });

let failed = false;
for (const sample of samples) {
  write(sample);
  // Re-read from disk rather than the in-memory copy: what ships is the file.
  const onDisk = readFileSync(`${OUT}/${sample.file}`);
  const buffer = onDisk.buffer.slice(onDisk.byteOffset, onDisk.byteOffset + onDisk.byteLength) as ArrayBuffer;

  // The shared reader throws on the size limits rather than reporting a status; both
  // outcomes are sampled, so the failure is caught here and compared like any other.
  let observed: string;
  let detail: string;
  try {
    const recognition = detectWorkbook(buffer);
    observed = recognition.status;
    const preview = buildPreview(buffer, recognition, sample.file);
    detail = preview.ok
      ? `樣本 ${preview.preview.rows.length} 行×${preview.preview.columnCount} 欄，分 ${preview.preview.chunks.length} 段，個人資料欄 ${preview.preview.sensitiveColumns.map(index => index + 1).join('、') || '無'}，截斷 ${preview.preview.truncatedCells} 格`
      : `預覽拒絕：${preview.reason}`;
  } catch (error) {
    observed = 'REFUSED';
    detail = `讀取拒絕：${error instanceof Error ? error.message : String(error)}`;
  }

  const status = observed === sample.expect ? 'OK  ' : 'FAIL';
  if (status === 'FAIL') failed = true;
  console.log(`${status} ${sample.file} · 識別結果 ${observed}（預期 ${sample.expect}）· ${detail}`);
  if (status === 'FAIL') console.log(`      ${sample.why}`);
}

if (failed) {
  console.error('\n樣本與預期不符：請先看偵測器是否改了口徑，再調整樣本或本腳本。');
  process.exitCode = 1;
}
