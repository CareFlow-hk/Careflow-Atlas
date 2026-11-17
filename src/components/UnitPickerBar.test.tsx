import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UnitPickerBar } from './UnitPickerBar';

const noop = () => {};
const render = (props: Partial<Parameters<typeof UnitPickerBar>[0]> = {}) =>
  renderToStaticMarkup(<UnitPickerBar count={3} recordCount={0} onClear={noop} onDelete={noop} onRecord={noop} {...props} />);

/*
 * The bar stands in for the footer's record button while a set is picked. It has to say how
 * many units are in hand and exactly what each button will do to them — a delete that takes
 * records with it is the one act here that cannot be undone.
 */
describe('the bar that acts on a picked set', () => {
  it('says how many units are picked', () => {
    expect(render()).toContain('已選 3 個單位');
    expect(render({ count: 1 })).toContain('已選 1 個單位');
  });

  it('names the count on both buttons, so neither is a guess', () => {
    const markup = render();
    expect(markup).toContain('記錄 3 個單位');
    expect(markup).toContain('刪除選取的 3 個單位');
  });

  it('says nothing about records when the units have none', () => {
    expect(render()).not.toContain('筆記錄');
  });

  /* The count is on screen before the click, not only in the confirmation that follows it. */
  it('names how many records a delete would take with it', () => {
    expect(render({ recordCount: 4 })).toContain('（連 4 筆記錄）');
  });

  it('offers the way out of the selection', () => {
    expect(render()).toContain('清除選取');
  });

  /*
   * Shift-clicking is not discoverable on its own, and a 劏房 room has to be picked
   * slice by slice. The help is there for both, folded away until it is asked for.
   */
  it('keeps the how-to folded away until it is asked for', () => {
    const markup = render();
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toMatch(/id="cf-pick-help"[^>]*hidden/);
  });

  it('spells out the picking, the keys, and what a split unit will not accept', () => {
    const markup = render();
    expect(markup).toContain('Shift');
    expect(markup).toContain('Esc');
    expect(markup).toContain('劏房');
    expect(markup).toContain('略過');
  });

  it('carries no 跟進 of its own: a batch records one result, and nothing else', () => {
    const markup = render();
    for (const word of ['跟進', '限期', '負責人']) expect(markup).not.toContain(word);
  });

  it('uses no colour to mean a state — the blocks already carry that', () => {
    expect(render()).not.toContain('--cf-state');
  });

  it('names every unit and provides an individual touch removal action', () => {
    const markup = render({ units: [{ id: 'a', label: '1樓 A室' }, { id: 'b', label: '1樓 B室' }], onRemove: noop });
    expect(markup).toContain('aria-label="已選單位"');
    expect(markup).toContain('取消選取 1樓 A室');
    expect(markup).toContain('取消選取 1樓 B室');
  });

  it('allows an empty touch selection but disables recording until a unit is picked', () => {
    const markup = render({ count: 0, units: [] });
    expect(markup).toContain('請點選要記錄的單位');
    expect(markup).toContain('退出多選');
    expect(markup).toContain('請先選擇單位');
    expect(markup).toContain('disabled=""');
  });

  /* Recording a set does not depend on structure editing; deleting a set does. */
  it('offers no delete where units cannot be removed', () => {
    const markup = renderToStaticMarkup(<UnitPickerBar count={3} recordCount={2} onClear={noop} onRecord={noop} />);
    expect(markup).not.toContain('刪除選取的');
    expect(markup).toContain('記錄 3 個單位');
  });
});
