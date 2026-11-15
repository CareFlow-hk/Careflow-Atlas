import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ObservationEditor } from './ObservationEditor';

const noop = () => {};

describe('ObservationEditor mobile sheet', () => {
  it('keeps the location and removable batch units in one sticky context', () => {
    const html = renderToStaticMarkup(<ObservationEditor
      open
      variant="sheet"
      targetLabel="真光大廈 · 已選 2 個單位"
      batch={{ units: 2 }}
      selectedUnits={[{ id: 'a1', label: '1樓 A1室' }, { id: 'a2', label: '1樓 A2室' }]}
      onRemoveUnit={noop}
      onChangeContext={noop}
      onClose={noop}
      onSubmit={noop}
    />);
    expect(html).toContain('<section class="cf-observation-sheet"');
    expect(html).toContain('<form class="cf-editor cf-editor--sheet"');
    expect(html).not.toContain('<dialog');
    expect(html).toContain('真光大廈 · 已選 2 個單位');
    expect(html.indexOf('真光大廈 · 已選 2 個單位')).toBeLessThan(html.indexOf('取消本次 1樓 A1室'));
    expect(html.indexOf('取消本次 1樓 A1室')).toBeLessThan(html.indexOf('name="coverageStatus"'));
    expect(html).toContain('取消本次 1樓 A2室');
    expect(html).toContain('更改');
    expect(html).toContain('取消本次');
  });

  it('offers an explicit unable-to-assess answer without weakening required fields', () => {
    const html = renderToStaticMarkup(<ObservationEditor
      open
      variant="sheet"
      targetLabel="真光大廈 · 1樓 A室"
      subjectId="a"
      onClose={noop}
      onSubmit={noop}
    />);
    expect(html).toContain('今次未能判斷住房情況');
    expect(html).toContain('value="UNKNOWN"');
    expect((html.match(/required=""/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('replaces misplaced native radio bubbles with focusable required groups', () => {
    const html = renderToStaticMarkup(<ObservationEditor
      open
      variant="sheet"
      targetLabel="真光大廈 · 1樓 A室"
      subjectId="a"
      onClose={noop}
      onSubmit={noop}
    />);
    expect(html).toContain('noValidate=""');
    for (const name of ['coverageStatus', 'housingAssessment', 'sourceType']) {
      expect(html).toContain(`data-choice="${name}"`);
    }
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('required=""');
  });

  it('keeps the original modal for desktop', () => {
    const html = renderToStaticMarkup(<ObservationEditor open targetLabel="大廈" onClose={noop} onSubmit={noop} />);
    expect(html).toMatch(/<dialog[^>]*class="cf-dialog"/);
    expect(html).not.toContain('cf-editor--sheet');
  });

  /*
   * A batch of one is still a batch (2026-11-15): the recorder must be able to leave a
   * task whether they picked one unit or five, so the field cannot be hidden by `batch`.
   */
  it('offers the optional follow-up in a batch too, though it is not required', () => {
    for (const units of [1, 3]) {
      const html = renderToStaticMarkup(<ObservationEditor
        open
        variant="sheet"
        targetLabel={`真光大廈 · 已選 ${units} 個單位`}
        batch={{ units }}
        selectedUnits={[{ id: 'a', label: '1樓 A室' }]}
        onClose={noop}
        onSubmit={noop}
      />);
      expect(html).toContain('name="followUpReason"');
      expect(html).toContain('name="followUpDueAt"');
      expect(html).toContain('更多跟進資料');
      expect(html).toContain('跟進如填寫，亦會為每個單位各開一項。');
      expect(html).not.toMatch(/name="followUpReason"[^>]*required/);
    }
  });
});
