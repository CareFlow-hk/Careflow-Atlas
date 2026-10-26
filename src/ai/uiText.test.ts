import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { aiUiText } from './uiText';
import { DraftPlanPanel } from '../components/AiAssistantDialog';
import { demoSnapshot } from '../data/demoFixture';

describe('generated assistant explanations', () => {
  it('uses the interface names in errors and proposals', () => {
    expect(aiUiText('coverage、assessment、sourceType；today；followUp.dueDate')).toBe('覆蓋結果、住房判斷、資料來源；今天；跟進.跟進日期');
    expect(aiUiText('status 不在 DRAFT／REFUSE 之內。')).toBe('處理結果 不在 草稿／無法處理 之內。');
    expect(aiUiText('unmappedColumns 的 columnIndex 超出範圍。')).toBe('未對應欄位 的 欄位位置 超出範圍。');
  });
  it('translates generated warnings and missing names without changing the original note', () => {
    const html = renderToStaticMarkup(createElement(DraftPlanPanel, {
      snapshot: demoSnapshot, canCreate: false, onChange: () => {}, onBack: () => {},
      value: { status: 'DRAFT', missing: ['coverage', 'assessment', 'sourceType'], warnings: ['today 未提到 coverage'] },
      form: { buildingId: '', floor: '', unit: '', date: '', time: '', worker: '', coverage: '', contact: '', assessment: '', sourceType: '', note: '原話 coverage 保留', action: '', dueDate: '', assignee: '' },
    }));
    expect(html).toContain('覆蓋結果、住房判斷、資料來源');
    expect(html).toContain('今天 未提到 覆蓋結果');
    expect(html).not.toContain('today 未提到 coverage');
    expect(html).toContain('原話 coverage 保留');
  });
});
