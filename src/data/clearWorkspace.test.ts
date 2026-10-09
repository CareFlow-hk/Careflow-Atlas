import { describe, expect, it } from 'vitest';
import { OutreachRepository, PersistenceError, type PersistenceAdapter } from './repository';
import { workflowDemo } from './workflowDemo';

class MemoryAdapter implements PersistenceAdapter {
  items = new Map<string, string>();
  read(key: string) { return this.items.get(key) ?? null; }
  write(key: string, value: string) { this.items.set(key, value); }
  remove(key: string) { this.items.delete(key); }
}

describe('clearing a workspace', () => {
  it('removes only this workspace and leaves other keys alone', () => {
    const adapter = new MemoryAdapter();
    adapter.write('careflow-atlas.account.a.options', '{}');
    const mine = new OutreachRepository(adapter, 'careflow-atlas.account.a.demo');
    const theirs = new OutreachRepository(adapter, 'careflow-atlas.account.b.demo');
    mine.replaceSnapshot(workflowDemo); theirs.replaceSnapshot(workflowDemo);
    mine.clear();
    expect(mine.getSnapshot()).toBeUndefined();
    expect(theirs.getSnapshot()).toBeDefined();
    expect(adapter.read('careflow-atlas.account.a.options')).toBe('{}');
  });
  it('refuses rather than pretending when storage cannot delete', () => {
    const repository = new OutreachRepository({ read: () => null, write: () => {} });
    expect(() => repository.clear()).toThrow(PersistenceError);
  });
});
