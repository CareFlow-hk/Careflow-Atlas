import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../data/demoFixture';
import type { FilePlan } from './AiAssistantDialog';
import { AiAssistantDialog, FilePlanPanel } from './AiAssistantDialog';
import { shownFields } from './aiMappingFields';

const render = (over: Partial<Parameters<typeof AiAssistantDialog>[0]> = {}) => renderToStaticMarkup(
  <AiAssistantDialog open onClose={() => undefined} snapshot={demoSnapshot} orgId="org-default" onWrite={() => undefined} {...over} />,
);

describe('the assistant dialog', () => {
  it('is not in the page while it is closed', () => {
    expect(renderToStaticMarkup(<AiAssistantDialog open={false} onClose={() => undefined} snapshot={demoSnapshot} orgId="org-default" onWrite={() => undefined} />)).toBe('');
  });

  it('says it writes nothing before the person confirms', () => {
    const html = render();
    expect(html).toContain('不會寫入任何資料');
    expect(html).toContain('標明「由 AI 協助」');
  });

  it('states the reader limits rather than trimming a large file quietly', () => {
    const html = render();
    expect(html).toContain('5 MB');
    expect(html).toContain('5000 行');
    expect(html).toContain('64 欄');
    expect(html).toContain('不會偷偷截斷');
  });

  it('offers both inputs: a note and a workbook', () => {
    const html = render();
    expect(html).toContain('貼一段紙本原話或口述');
    expect(html).toContain('拖放 Excel／CSV 檔案到這裡');
  });

  it('says what the assistant must not do', () => {
    const html = render();
    expect(html).toContain('AI 不會自己新增或改寫任何資料');
    expect(html).toContain('由你確認後才建立');
    expect(html).toContain('大廈本身仍要在地圖上新增');
    expect(html).toContain('更正原記錄');
    expect(html).toContain('只留在這部裝置');
  });

  it('will not offer to send while there is no workspace to check against', () => {
    const html = render({ snapshot: undefined });
    expect(html).toContain('尚未載入工作區資料');
    expect(html).toContain('disabled');
  });

  it('keeps the key out of the markup', () => {
    expect(render()).not.toContain('sk-');
  });
});

describe('the plan screen', () => {
  const preview = {
    fileName: '探訪.xlsx', sheetName: '10月探訪', sheets: [], headerRow: 0, headers: ['大廈', '日期', '樓'],
    columnCount: 3, totalRows: 2, rows: [], rowNumbers: [], sensitiveColumns: [], truncatedCells: 0, chunks: [],
  };
  const plan: FilePlan = {
    source: 'file',
    credential: { provider: 'deepseek', model: 'deepseek-chat', key: 'sk-test' },
    preview,
    suggestion: { status: 'MATCH', fields: [], unmappedColumns: [], warnings: [] },
    columns: { buildingName: 0 },
    parse: { buffer: new ArrayBuffer(0), sheetName: '10月探訪', headerRow: 1, mapping: [], fileName: '探訪.xlsx' },
    result: {
      rows: [
        { rowNumber: 2, status: 'READY', issues: [], buildingName: '裕安樓', location: '5F B室', occurredAt: '2026-10-05', workerName: '陳同事', coverage: '未能完成探訪', input: { id: 'a', visitId: 'v', buildingId: 'bldg-yu-an', occurredAt: '2026-10-05', recordedAt: '2026-10-05', workerName: '陳同事', coverage: 'ATTEMPTED', evidence: [] } },
        { rowNumber: 5, status: 'NEEDS_REVIEW', issues: [{ code: 'LOCATION', message: '系統沒有這個單位' }], buildingName: '裕安樓', location: '9F A室', occurredAt: '2026-10-06', workerName: '陳同事', coverage: '完成探訪' },
        { rowNumber: 6, status: 'NEEDS_REVIEW', issues: [{ code: 'MISSING_DATE', message: '未填到訪日期。' }], buildingName: '裕安樓', location: '5F B室' },
      ],
      counts: { READY: 1, NEEDS_REVIEW: 2, INVALID: 0 },
      notes: [], blankRows: 0,
      pending: [{ buildingId: 'bldg-yu-an', buildingName: '裕安樓', floorLabel: '9F', newFloor: true, unitLabel: '9F A室', rowNumbers: [5] }],
    },
  };
  const html = renderToStaticMarkup(<FilePlanPanel plan={plan} canCreate
    onChangeColumn={() => undefined} onRun={() => undefined} onBack={() => undefined} />);

  it('says what will happen where, not what each column was', () => {
    expect(html).toContain('在「裕安樓 · 5F B室」新增 1 筆到訪記錄');
    expect(html).toContain('在「裕安樓 · 9F A室」新增 1 筆到訪記錄');
    expect(html).toContain('在「裕安樓」新增「9F」這一層與「9F A室」');
    expect(html).toContain('確認並執行');
  });

  it('states how many rows will be written, and keeps the mapping out of the way', () => {
    expect(html).toContain('寫入 2 筆記錄');
    expect(html).toContain('並新增 1 個樓層／單位');
    expect(html).toContain('<summary>AI 讀到的欄位對應');
  });

  it('says, without asking, that a column nobody mapped is kept in the note', () => {
    expect(html).toContain('原表另有 2 欄系統沒有對應（日期、樓）');
    expect(html).toContain('原樣記在備註');
  });

  it('lists the rows it will not write, with the reason, instead of dropping them', () => {
    expect(html).toContain('不會寫入的 1 行');
    expect(html).toContain('第 6 行');
    expect(html).toContain('未填到訪日期。');
  });

  it('has nothing left to tick: the plan is confirmed as a whole', () => {
    expect(html).not.toContain('type="checkbox"');
  });

  it('never shows the key', () => {
    expect(html).not.toContain('sk-');
  });
});

describe('the column mapping table', () => {
  it('shows the fields the AI named, the ones already mapped and the ones a person must decide', () => {
    const { shown, folded } = shownFields(new Set(['floor', 'unit', 'note']), { occurredAt: 1 });
    expect(shown).toEqual(expect.arrayContaining(['buildingId', 'buildingName', 'occurredAt', 'worker', 'coverage', 'floor', 'unit', 'note']));
    expect(folded).toContain('personName');
    expect(shown).not.toContain('personName');
  });

  it('folds the rest without dropping them: every field stays reachable', () => {
    const { keys, shown, folded } = shownFields(new Set(['floor']), {});
    expect([...shown, ...folded].sort()).toEqual([...keys].sort());
    expect(folded.length).toBeGreaterThan(0);
  });
});
