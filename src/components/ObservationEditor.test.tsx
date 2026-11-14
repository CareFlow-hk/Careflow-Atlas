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

  it('keeps the original modal for desktop', () => {
    const html = renderToStaticMarkup(<ObservationEditor open targetLabel="大廈" onClose={noop} onSubmit={noop} />);
    expect(html).toMatch(/<dialog[^>]*class="cf-dialog"/);
    expect(html).not.toContain('cf-editor--sheet');
  });
});
