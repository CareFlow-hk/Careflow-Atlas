import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeleteConfirm } from './DeleteConfirm';

const noop = () => {};
const markup = (props: Partial<Parameters<typeof DeleteConfirm>[0]> = {}) =>
  renderToStaticMarkup(<DeleteConfirm question='「A室」有 3 筆記錄，刪除會連同這些記錄一起刪除，請先確認。' onConfirm={noop} onCancel={noop} {...props} />);
/* The one state SSR can show is the untouched one — a click is needed for any other — so
   every other state is asked of `deleteGate` directly, in src/domain/structure.test.ts. */
const deleteButton = (html: string) => html.match(/<button[^>]*class="is-danger"[^>]*>/)?.[0] ?? '';
const backupButton = (html: string) => html.match(/<button[^>]*>下載當前 Excel 備份<\/button>/)?.[0];

/*
 * Deleting records is the one exception to "records are only ever appended", so the copy
 * taken first is the whole of what makes it recoverable. The confirmation must therefore
 * refuse to delete until a download has really happened, and say why (review, 2026-10-15).
 */
describe('the confirmation in front of a delete', () => {
  it('names what goes and how much of it', () => {
    expect(markup()).toContain('「A室」有 3 筆記錄');
  });

  it('offers the backup and keeps 刪除 shut until it is taken', () => {
    const html = markup({ onBackup: async () => true });
    expect(backupButton(html)).toBeDefined();
    expect(deleteButton(html)).toContain('disabled');
  });

  it('says the delete is waiting on the backup rather than leaving it unexplained', () => {
    expect(markup({ onBackup: async () => true })).toContain('先下載當前 Excel 備份，才可以連記錄一併刪除');
  });

  /* Without a way to take the copy there is no way to unlock the delete — never an open door. */
  it('offers no delete at all when there is no way to take a backup', () => {
    const html = markup();
    expect(backupButton(html)).toBeUndefined();
    expect(deleteButton(html)).toContain('disabled');
  });

  it('always keeps a way out', () => {
    expect(markup().match(/<button[^>]*>取消<\/button>/)).not.toBeNull();
  });
});
