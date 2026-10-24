import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecognitionPanel } from './RecognitionPanel';
import { columnChoice, detectWorkbook, recognitionBlocker } from '../imports/detector';
import { REGRESSION_SAMPLES, sampleBuffer } from '../imports/samples';
import { paperHeaders } from '../data/workflowFormat';
import { SYSTEM_COLUMNS } from '../imports/profiles';

const render = (id: string, override?: Parameters<typeof detectWorkbook>[1]) => {
  const sample = REGRESSION_SAMPLES.find((entry) => entry.id === id);
  if (!sample) throw new Error(`Unknown sample ${id}`);
  const recognition = detectWorkbook(sampleBuffer(sample), override);
  return { recognition, html: renderToStaticMarkup(<RecognitionPanel recognition={recognition} onRemap={() => {}} />) };
};

describe('recognition preview', () => {
  it('renders the recognised format with one mapping row per field', () => {
    const { html } = render('careflow-six-sheet/success');
    expect(html).toContain('中文六表封存格式');
    expect(html).toContain('已識別');
    expect(html).toContain('紙本回錄');
    // One select per field, plus the format picker.
    expect(html.match(/<select/g)).toHaveLength(paperHeaders.filter((header) => !SYSTEM_COLUMNS.includes(header)).length + 1);
    expect(html).toContain('大廈編號 對應欄位');
  });

  it('shows the ambiguous field with its candidates so a person can choose', () => {
    const { html } = render('careflow-six-sheet/ambiguous');
    expect(html).toContain('有待核對');
    expect(html).toContain('請選擇…');
    // Positions are derived: the duplicate column is appended past the real headers.
    expect(html).toContain(`可能欄位：${paperHeaders.indexOf('工作員') + 1}. 工作員、${paperHeaders.length + 1}. 工作人員`);
  });

  it('explains a refused recognition instead of showing an empty mapping table', () => {
    const { recognition, html } = render('careflow-six-sheet/rejected');
    expect(html).toContain('未識別出候選格式');
    expect(html).toContain('未能識別');
    expect(html).not.toContain('對應欄位</');
    expect(recognitionBlocker(recognition)).toBeTruthy();
  });

  it('marks the person in charge’s own corrections', () => {
    const { html } = render('careflow-six-sheet/ambiguous', { columns: { worker: paperHeaders.indexOf('工作員') } });
    expect(html).toContain('已按你的選擇更新：工作員');
    expect(html).toContain('負責人指定欄位');
  });

  it('turns a chosen column into a correction, and "not in this sheet" into an explicit null', () => {
    expect(columnChoice('worker', '22')).toEqual({ columns: { worker: 22 } });
    // null and absent mean different things: one is a decision, the other no decision.
    expect(columnChoice('worker', '__ignored__')).toEqual({ columns: { worker: null } });
    expect(columnChoice('worker', '')).toBeUndefined();
  });

  it('never asks for a re-run just by rendering', () => {
    const onRemap = vi.fn();
    const sample = REGRESSION_SAMPLES.find((entry) => entry.id === 'careflow-six-sheet/ambiguous')!;
    renderToStaticMarkup(<RecognitionPanel recognition={detectWorkbook(sampleBuffer(sample))} onRemap={onRemap} />);
    expect(onRemap).not.toHaveBeenCalled();
  });
});
