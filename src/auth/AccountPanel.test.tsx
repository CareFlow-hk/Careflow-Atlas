import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Account, Session } from './api';
import { AccountPanel } from './AccountPanel';
import { WorkspaceAdvancedSettings } from '../components/WorkspaceAdvancedSettings';

/**
 * Who sees which block of 設定 (docs/UI_PERMISSIONS.md).
 *
 * The page is rendered to static markup, so the effects that fetch accounts and devices do
 * not run: what is asserted here is only what the role and the switches decide, which is the
 * part that had been wrong. The server still refuses what a hidden control would have sent.
 */

const account = (over: Partial<Account>): Account => ({ id: 'acc-1', email: 'a@example.org', name: '同事', role: 'MEMBER', disabled: false, pending: false, createdAt: 0, ...over });
const session = (over: Partial<Account>): Session => ({ user: account(over), csrf: 'csrf', expiresAt: Date.now() + 3600_000 });
const render = (over: Partial<Account>, features: Record<string, boolean> = {}) => renderToStaticMarkup(
  <AccountPanel session={session(over)} features={features} onClose={() => undefined} onSignedOut={() => undefined} advanced={<WorkspaceAdvancedSettings role={account(over).role} />} />,
);

describe('設定頁的角色隔離', () => {
  it('員工看不到清空工作區、功能開關和帳號管理', () => {
    const html = render({ role: 'MEMBER' });
    expect(html).not.toContain('清空工作區');
    expect(html).not.toContain('功能開關');
    expect(html).not.toContain('邀請成員');
    expect(html).not.toContain('機構帳號');
    // What a member does keep: their own account and their own entry options.
    expect(html).toContain('修改密碼');
    expect(html).toContain('常用選項');
  });

  it('員工看不到只有管理員能按的說明', () => {
    // The old page told a member that clearing is an administrator's job; that note is gone too.
    expect(render({ role: 'MEMBER' })).not.toContain('只有管理員可以執行');
  });

  it('功能全關時，機構管理員連「已開啟的功能」也不顯示', () => {
    const html = render({ role: 'ADMIN' });
    expect(html).not.toContain('功能開關');
    expect(html).not.toContain('已開啟的功能');
    // Nor the assistant's read-only panel, which describes a service this institution cannot use.
    expect(html).not.toContain('AI 助手');
  });

  it('機構管理員只看得到已開啟的功能，沒有可切換的開關', () => {
    const html = render({ role: 'ADMIN' }, { aiAssistant: true });
    expect(html).toContain('已開啟的功能');
    expect(html).toContain('AI 助手');
    expect(html).not.toContain('照片回錄（Azure 辨識）');
    expect(html).not.toContain('跨裝置同步（加密後存到伺服器）');
    // A control they cannot use is not drawn at all.
    expect(html).not.toContain('type="checkbox"');
  });

  it('平台管理員看得到全部三個開關，可以切換', () => {
    const html = render({ role: 'ADMIN', platformAdmin: true });
    expect(html).toContain('功能開關');
    expect(html).toContain('照片回錄（Azure 辨識）');
    expect(html).toContain('跨裝置同步（加密後存到伺服器）');
    expect(html).toContain('AI 助手');
    expect(html).toContain('type="checkbox"');
  });
});
