import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../data/demoFixture';
import type { DraftForm, FilePlan } from './AiAssistantDialog';
import { AiAssistantDialog, FilePlanPanel, PlanView, draftComplete, draftProblems, filePlanRows, holdSkippedRows, confirmFileRows } from './AiAssistantDialog';
import { shownFields } from './aiMappingFields';
import { NO_EDITS } from './planEdits';
import { PlanRowEditor, SkippedRowsTable } from './AiPlanRows';

/** What the server writes on every record an answer produced. */
const marker = { at: '2026-10-25T08:00:00.000Z', provider: 'azure-openai', model: 'gpt-6-luna', requestId: 'resp_test' };

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

  it('offers both inputs and one button for them together', () => {
    const html = render();
    expect(html).toContain('貼上紙本原話、口述，或問一句');
    expect(html).toContain('拖放 Excel／CSV 檔案到這裡');
    // One door in: the note and the sheet are read and confirmed as one piece of work.
    expect(html).toContain('上傳');
    expect(html).not.toContain('整理成目標');
    expect(html).not.toContain('整理這份表');
  });

  it('warns that AI sees all typed text and explains server processing', () => {
    const html = render();
    expect(html).toContain('請不要輸入姓名、電話等個人資料；AI 會讀到你輸入的全部文字。');
    expect(html).toContain('aria-describedby="ai-personal-data-note"');
    expect(html).toContain('經自家伺服器記憶體轉交 Azure');
    expect(html).toContain('內容不落庫、不進伺服器日誌');
    expect(html).not.toContain('不上傳、不進匯出檔');
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

  it('offers the task questions and the advice request, answered from this device', () => {
    const html = render();
    expect(html).toContain('這兩天有什麼跟進？');
    expect(html).toContain('給我行動建議');
    expect(html).toContain('建議按記錄上的到期日排出先後');
  });

  it('takes a sentence rather than a menu of buttons', () => {
    const html = render();
    // The examples are grey text that only fills the box; nothing is chosen for the person.
    expect(html).toContain('cf-ai__hint');
    expect(html).not.toContain('cf-ai__hints"><button');
  });

  it('keeps the task answer available when the AI switch is off', () => {
    const html = render({ aiEnabled: false });
    expect(html).toContain('AI 助手目前未開啟');
    expect(html).toContain('任務提醒');
    expect(html).toContain('問一問');
    // Nothing that would leave the device is offered while the switch is off.
    expect(html).not.toContain('拖放 Excel／CSV 檔案到這裡');
  });
});

describe('the plan screen', () => {
  const preview = {
    fileName: '探訪.xlsx', sheetName: '10月探訪', sheets: [], headerRow: 0, headers: ['大廈', '日期', '樓'],
    columnCount: 3, totalRows: 2, rows: [], rowNumbers: [], sensitiveColumns: [], truncatedCells: 0, chunks: [],
  };
  const plan: FilePlan = {
    aiAssist: marker,
    preview,
    suggestion: { status: 'MATCH', fields: [], unmappedColumns: [], warnings: [] },
    columns: { buildingName: 0 },
    parse: { buffer: new ArrayBuffer(0), sheetName: '10月探訪', headerRow: 1, mapping: [], fileName: '探訪.xlsx' },
    matrix: { matrix: [], date1904: false },
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
  const panel = (edits = NO_EDITS) => renderToStaticMarkup(<FilePlanPanel plan={plan} canCreate edits={edits} onEdit={() => undefined}
    onEditMany={() => undefined} onChangeColumn={() => undefined} onRun={() => undefined} onBack={() => undefined} />);
  const html = panel();
  const skippedRows = renderToStaticMarkup(<SkippedRowsTable rows={[plan.result.rows[2]]} valuesOf={() => []} preview={preview}
    columns={plan.columns} edits={NO_EDITS} onEdit={() => undefined} onEditMany={() => undefined} />);

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

  it('lists the rows it will not write, instead of dropping them', () => {
    expect(html).toContain('不會寫入的 1 行');
    expect(html).toContain('一行一筆記錄，一行一欄');
  });

  it('puts each row it will not write on one line, under the headers it would be written with', () => {
    expect(skippedRows).toContain('第 6 行');
    expect(skippedRows).toContain('未填到訪日期。');
    // One column per canonical field the plan writes, not a card per row to open.
    expect(skippedRows).toContain('大廈');
    expect(skippedRows).toContain('到訪日期');
    expect(skippedRows).toContain('覆蓋結果');
    expect(skippedRows).toContain('接觸結果');
    expect(skippedRows).toContain('住房判斷');
  });

  it('ticks rows only to choose where a bulk value lands, never to choose what runs', () => {
    expect(skippedRows).toContain('type="checkbox"');
    expect(skippedRows).toContain('套用到已選行');
    // The run button belongs to the plan footer alone; the table adds no second confirmation.
    expect(skippedRows).not.toContain('確認並執行');
  });

  it('asks for a sheet year without choosing one', () => {
    const yearPlan = { ...plan, columns: { ...plan.columns, occurredAt: 1 }, matrix: { matrix: [['大廈', '日期'], ['裕安樓', '12/9']], date1904: false } };
    const markup = renderToStaticMarkup(<FilePlanPanel plan={yearPlan} canCreate edits={NO_EDITS} onEdit={() => undefined}
      onEditMany={() => undefined} onChangeColumn={() => undefined} onBack={() => undefined} />);
    expect(markup).toContain('這份表是哪一年？');
    expect(markup).toMatch(/aria-label="這份表是哪一年？"[^>]*value=""/);
  });

  it('keeps literal structure suggestions unchecked until the person opts in', () => {
    const structural = { ...plan, result: { ...plan.result, pending: [{ buildingId: 'bldg-yu-an', buildingName: '裕安樓', floorLabel: '3樓', unitLabel: 'A1室、A2室', newFloor: false, rowNumbers: [2], structureUnits: ['A1室', 'A2室'], description: 'A 單位分成 2 間' }] } };
    const markup = renderToStaticMarkup(<FilePlanPanel plan={structural} canCreate edits={NO_EDITS} onEdit={() => undefined}
      onEditMany={() => undefined} onChangeColumn={() => undefined} onBack={() => undefined} />);
    expect(markup).toContain('建議建立的結構（預設不執行）');
    expect(markup).toContain('A 單位分成 2 間');
    const section = markup.match(/cf-ai__structures[^]*?<\/section>/)?.[0] ?? '';
    expect(section).not.toContain('checked');
    const selected = { ...structural, selectedStructures: ['bldg-yu-an|3樓|a1室、a2室'] };
    const accepted = renderToStaticMarkup(<FilePlanPanel plan={selected} canCreate edits={NO_EDITS} onEdit={() => undefined}
      onEditMany={() => undefined} onChangeColumn={() => undefined} onBack={() => undefined} />);
    expect(accepted).toContain('並新增 2 個樓層／單位');

  });

  it('keeps repaired rows held through edits until explicit confirmation, and re-holds invalidated rows', () => {
    const initial = holdSkippedRows(plan, true);
    expect(initial.heldRows).toEqual([6]);
    const repaired = holdSkippedRows({ ...initial, result: { ...plan.result, rows: [...plan.result.rows.slice(0, 2), { ...plan.result.rows[0], rowNumber: 6 }] } }, true);
    expect(filePlanRows(repaired, true).candidates.map(row => row.rowNumber)).toEqual([2, 5, 6]);
    expect(filePlanRows(repaired, true).writable.map(row => row.rowNumber)).toEqual([2, 5]);
    const table = renderToStaticMarkup(<SkippedRowsTable rows={[repaired.result.rows[2]]} valuesOf={() => []} preview={preview}
      columns={plan.columns} edits={NO_EDITS} onEdit={() => undefined} onEditMany={() => undefined} readyRows={new Set([6])} />);
    expect(table).toContain('已補齊，待確認');
    expect(table).toContain('確認這一行');
    expect(table).toContain('更新清單');
    const confirmed = confirmFileRows(repaired, [6], true);
    expect(filePlanRows(confirmed, true).writable.map(row => row.rowNumber)).toEqual([2, 5, 6]);
    const broken = holdSkippedRows({ ...confirmed, result: plan.result }, true);
    expect(confirmFileRows(broken, [6], true).heldRows).toEqual([6]);
  });

  it('does not create a required location for an unconfirmed repaired row', () => {
    const held = { ...plan, heldRows: [5] };
    expect(filePlanRows(held, true).places).toEqual([]);
    expect(filePlanRows(confirmFileRows(held, [5], true), true).places).toHaveLength(1);
  });

  it('never shows the key', () => {
    expect(html).not.toContain('sk-');
  });

  describe('with a note in the same upload', () => {
    const form: DraftForm = {
      buildingId: 'bldg-yu-an', floor: '3樓', unit: 'A室', date: '2026-10-24', time: '',
      worker: '陳同事', coverage: 'ATTEMPTED', contact: '', assessment: 'UNKNOWN', sourceType: 'STAFF_OBSERVATION',
      note: '', action: '', dueDate: '', assignee: '',
    };
    it.each(['coverage', 'assessment', 'sourceType'] as const)('cannot execute without %s', field => {
      expect(draftComplete(form)).toBe(true);
      expect(draftComplete({ ...form, [field]: '' })).toBe(false);
    });
    const text = {
      aiAssist: marker,
      drafts: [{
        status: 'DRAFT' as const, buildingId: 'bldg-yu-an', floorLabel: '3樓', unitLabel: 'A室',
        occurredDate: '2026-10-24', contactOutcome: 'NO_ANSWER' as const, missing: [], warnings: [],
      }],
    };
    const view = (over: { form?: typeof form; notice?: string } = {}) => renderToStaticMarkup(<PlanView
      plan={{ source: 'both', file: plan, text }} snapshot={demoSnapshot} forms={[over.form ?? form]}
      canCreate notice={over.notice} edits={NO_EDITS} onEdit={() => undefined} onEditMany={() => undefined}
      onChangeColumn={() => undefined} onChangeForm={() => undefined} onRun={() => undefined} onBack={() => undefined} />);

    it('stacks both sources under their own headings, with one confirmation for the pair', () => {
      const markup = view();
      expect(markup).toContain('檔案：探訪.xlsx');
      expect(markup).toContain('文字：第 1／1 筆記錄');
      expect(markup.match(/確認並執行/g)).toHaveLength(1);
    });

    it('offers only the three coverage results and an empty choice', () => {
      const markup = view();
      const options = markup.match(/覆蓋結果<select[^>]*>(.*?)<\/select>/)?.[1] ?? '';
      expect(options.match(/<option/g)).toHaveLength(4);
      for (const label of ['未填', '未到訪', '未能完成探訪', '已完成探訪']) expect(options).toContain(label);
    });

    it('renders separate editable household drafts with one execution button', () => {
      const textPlan = { ...text, drafts: [text.drafts[0], { ...text.drafts[0], unitLabel: 'C室' }] };
      const markup = renderToStaticMarkup(<PlanView plan={{ source: 'text', text: textPlan }} snapshot={demoSnapshot}
        forms={[{ ...form, unit: 'B室', contact: 'NO_ANSWER', note: '冇人應門' }, { ...form, unit: 'C室', contact: 'CONTACTED', note: '業主叫佢搬' }]} canCreate
        edits={NO_EDITS} onEdit={() => undefined} onEditMany={() => undefined} onChangeColumn={() => undefined} onChangeForm={() => undefined} onRun={() => undefined} onBack={() => undefined} />);
      expect(markup).toContain('文字：第 1／2 筆記錄');
      expect(markup).toContain('文字：第 2／2 筆記錄');
      expect(markup).toContain('冇人應門');
      expect(markup).toContain('業主叫佢搬');
      expect(markup.match(/確認並執行/g)).toHaveLength(1);
    });

    it('marks missing choices and counts them before execution', () => {
      const incomplete = { ...form, coverage: '' as const, sourceType: '' as const };
      expect(draftProblems(incomplete)).toEqual(['coverage', 'sourceType']);
      const markup = view({ form: incomplete });
      expect(markup).toContain('文字部分還有 2 項未填妥');
      expect(markup.match(/aria-invalid="true"/g)).toHaveLength(2);
      expect(markup).toMatch(/disabled=""[^>]*>確認並執行/);
    });
    it('blocks a missing unit and an unreadable location before any write', () => {
      expect(draftProblems({ ...form, unit: '' }, demoSnapshot)).toContain('unit');
      expect(draftComplete({ ...form, floor: '後座' }, demoSnapshot)).toBe(false);
    });

    it('will not let one press write only the half that was ready', () => {
      // The draft lost its worker, so neither footer may offer to run the pair.
      expect(view({ form: { ...form, worker: '' } })).toContain('文字部分還有 1 項未填妥');
    });

    it('keeps the file part when the text was only a heading for it', () => {
      const markup = renderToStaticMarkup(<PlanView
        plan={{ source: 'file', file: plan }} snapshot={demoSnapshot} forms={[form]} canCreate
        notice="這段文字沒有另外整理成一筆記錄，只用作這次讀表的補充說明（例如「在裕安樓」）。"
        edits={NO_EDITS} onEdit={() => undefined} onEditMany={() => undefined}
        onChangeColumn={() => undefined} onChangeForm={() => undefined} onRun={() => undefined} onBack={() => undefined} />);
      expect(markup).toContain('在「裕安樓 · 5F B室」新增 1 筆到訪記錄');
      expect(markup).toContain('只用作這次讀表的補充說明');
      expect(markup.match(/確認並執行/g)).toHaveLength(1);
    });
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

describe('editing a row on the plan screen', () => {
  const preview = {
    fileName: '探訪.xlsx', sheetName: '10月探訪', sheets: [], headerRow: 0, headers: ['大廈', '到訪日期', '備註'],
    columnCount: 3, totalRows: 2, rows: [['大廈', '到訪日期', '備註'], ['裕安樓', '2026-10-05', '門外有水電單']],
    rowNumbers: [1, 2], sensitiveColumns: [], truncatedCells: 0, chunks: [],
  };
  const plan: FilePlan = {
    aiAssist: marker,
    preview,
    suggestion: { status: 'MATCH', fields: [], unmappedColumns: [], warnings: [] },
    columns: { buildingName: 0, occurredAt: 1 },
    parse: { buffer: new ArrayBuffer(0), sheetName: '10月探訪', headerRow: 1, mapping: [], fileName: '探訪.xlsx' },
    matrix: { matrix: [['大廈', '到訪日期', '備註'], ['裕安樓', '2026-10-05', '門外有水電單']], date1904: false },
    result: {
      rows: [{ rowNumber: 2, status: 'READY', issues: [], buildingName: '裕安樓', occurredAt: '2026-10-05', workerName: '陳同事', coverage: '已嘗試接觸', input: { id: 'a', visitId: 'v', buildingId: 'bldg-yu-an', occurredAt: '2026-10-05', recordedAt: '2026-10-05', workerName: '陳同事', coverage: 'ATTEMPTED', evidence: [] } }],
      counts: { READY: 1, NEEDS_REVIEW: 0, INVALID: 0 }, notes: [], blankRows: 0, pending: [],
    },
  };
  const view = (edits = NO_EDITS, chat?: Parameters<typeof FilePlanPanel>[0]['chat']) => renderToStaticMarkup(
    <FilePlanPanel plan={plan} canCreate edits={edits} chat={chat} onEdit={() => undefined} onEditMany={() => undefined}
      onChangeColumn={() => undefined} onRun={() => undefined} onBack={() => undefined} />,
  );
  const fields = (edits = NO_EDITS) => renderToStaticMarkup(
    <PlanRowEditor row={plan.result.rows[0]} values={plan.matrix.matrix[1]} preview={preview}
      columns={plan.columns} edits={edits} onEdit={() => undefined} />,
  );

  it('can be opened from the row it belongs to', () => {
    expect(view()).toContain('可以改這一行');
  });

  it('opens one row into the cells it was read from, header and value', () => {
    const html = fields();
    expect(html).toContain('第 1 欄 · 大廈');
    expect(html).toContain('第 2 欄 · 到訪日期');
    expect(html).toContain('value="裕安樓"');
    expect(html).toContain('value="2026-10-05"');
  });

  it('keeps a column nobody mapped visible, and says it goes into the note', () => {
    const html = fields();
    expect(html).toContain('原表有、未對應 · 會記在備註');
  });

  it('marks who changed a cell, and never claims a hand edit was the AI', () => {
    const person = fields({ values: { 'c:2:1': '2026-10-11' }, sources: { 'c:2:1': 'person' } });
    expect(person).toContain('人手改');
    expect(person).toContain('value="2026-10-11"');
    expect(person).not.toContain('AI 提議');
    const ai = fields({ values: { 'c:2:1': '2026-10-11' }, sources: { 'c:2:1': 'ai' } });
    expect(ai).toContain('AI 提議');
  });

  it('offers a field the sheet never printed, so a short row can still be completed', () => {
    const html = fields();
    expect(html).toContain('這一行還缺什麼，可以直接補');
    expect(html).toContain('<option value="coverage">');
    expect(html).toContain('<option value="worker">');
  });

  it('carries the chat beside the rows, with what was already asked', () => {
    const html = view(NO_EDITS, {
      turns: [{ question: '第 2 行係已嘗試接觸', answer: '把覆蓋結果改成已嘗試接觸。', changed: 1 }],
      value: '', asking: false, onChange: () => undefined, onAsk: () => undefined,
    });
    expect(html).toContain('直接叫 AI 改這份表');
    expect(html).toContain('你：第 2 行係已嘗試接觸');
    expect(html).toContain('改了 1 格');
    expect(html).toContain('請 AI 改');
  });
});
