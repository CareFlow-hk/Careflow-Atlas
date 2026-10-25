import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Account, type Session } from './api';
import type { FeatureSwitches } from './accountContext';
import { WorkspaceKeyPanel } from './WorkspaceKeyPanel';
import { AiSettingsPanel } from './AiSettingsPanel';

interface Device { id: string; created_at: number; seen_at: number; current: boolean; }
/** An institution as the platform administrator sees it: who is in it and its own switches. */
interface Org { id: string; name: string; admins: number; members: number; accounts: number; features: FeatureSwitches; }
interface AuditEvent { id: number; time: number; action: string; actor_email?: string; target_email?: string; target?: string; }
const actions: Record<string, string> = { login: '登入', login_failed: '登入失敗', logout: '登出', user_created: '建立帳號', user_updated: '修改帳號', password_link_created: '生成設定密碼連結', password_set: '設定密碼', password_changed: '修改密碼', other_sessions_revoked: '撤銷其他登入', operator_recovery: '運維恢復管理員', platform_admin_granted: '設為平台管理員', org_created: '建立機構', org_renamed: '機構改名', user_moved: '移到另一機構', platform_admin_revoked: '取消平台管理員', feature_enabled: '開啟功能', feature_disabled: '關閉功能', workspace_saved: '同步工作區', workspace_cleared: '清空工作區', ai_assisted_write: 'AI 協助寫入', ai_assist: '使用 AI 助手', workspace_key_created: '設定機構密語', workspace_key_rewrapped: '更改機構密語', workspace_key_replaced: '更換機構密鑰', ai_key_set: '設定 AI 密鑰', ai_key_changed: '更換 AI 密鑰', ai_key_removed: '移除 AI 密鑰' };
/** Provider ids as they appear in an audit target, `azure-openai@org-id`. Mirrors server/orgAi.mjs. */
const providerText: Record<string, string> = { 'azure-openai': 'Azure OpenAI', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek' };
/** What each site-wide switch does, in staff wording. Keys match server/features.mjs. */
const featureText: Record<keyof FeatureSwitches, { label: string; detail: string }> = {
  photoIntake: { label: '照片回錄（Azure 辨識）', detail: '開啟後，同事可以上傳紙本照片，照片會傳送到 Azure 辨識。關閉時頂欄不顯示入口，伺服器也拒絕轉送照片。' },
  workspaceSync: { label: '跨裝置同步（加密後存到伺服器）', detail: '開啟後，同一機構的同事在不同裝置看到同一份資料。住戶姓名、電話、備註和記錄文字先在瀏覽器用機構密語加密，伺服器只存加密後的內容。關閉時資料只留在各自的裝置，伺服器拒絕讀寫。需要先在下面設定機構密語。' },
  aiAssistant: { label: 'AI 助手', detail: '開啟後，同事在頁首的「AI 助手」對話框裡可以貼上文字或上傳表格，請 AI 整理成待確認的記錄，或建議欄位對應；AI 只提建議，下一步會列出「將執行的目標」，由登入的同事確認後署名寫入。AI 由伺服器代理 Azure，密鑰只由平台管理員在伺服器設定，因此這個開關也由平台管理員決定；關閉時伺服器不會把任何內容送到 Azure。' },
};
export function AccountPanel({ session, features = {}, onFeaturesChanged, onKeyChanged, onClose, onSignedOut, advanced }: { session: Session; /** Site-wide switches; only an administrator sees and changes them. */ features?: FeatureSwitches; onFeaturesChanged?: (features: FeatureSwitches) => void; /** The institution key on this device changed. */ onKeyChanged?: () => void; onClose: () => void; onSignedOut: () => void; /** Workspace settings, folded under 高級設定. */ advanced?: ReactNode }) {
  const [users, setUsers] = useState<Account[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [changing, setChanging] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditFilter, setAuditFilter] = useState<'all' | 'ai'>('all');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [azureReady, setAzureReady] = useState<boolean>();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const admin = session.user.role === 'ADMIN';
  // Site-wide switches reach every institution, so only the platform administrator turns them.
  const platform = session.user.platformAdmin === true;
  const reload = useCallback(async () => {
    const [deviceData, userData, auditData] = await Promise.all([
      api<{ sessions: Device[] }>('/sessions'),
      admin ? api<{ users: Account[] }>('/admin/users') : Promise.resolve({ users: [] }),
      admin ? api<{ events: AuditEvent[] }>('/admin/audit') : Promise.resolve({ events: [] }),
    ]);
    setDevices(deviceData.sessions); setUsers(userData.users); setEvents(auditData.events);
    if (admin) setAzureReady((await api<{ configured: boolean }>('/photos/status')).configured);
    if (platform) setOrgs((await api<{ orgs: Org[] }>('/admin/orgs')).orgs);
  }, [admin, platform]);
  useEffect(() => { void reload().catch(e => setError(e instanceof Error ? e.message : '讀取失敗。')); }, [reload]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage(''); setLink('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失敗。'); }
    finally { setBusy(false); }
  }
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    void perform(async () => {
      const result = await api<{ link: string }>('/admin/users', 'POST', Object.fromEntries(data));
      setLink(result.link); form.reset(); await reload();
    });
  }
  function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirm')) { setError('兩次密碼不一致。'); return; }
    void perform(async () => { await api('/password', 'POST', { oldPassword: data.get('oldPassword'), password: data.get('password') }); onSignedOut(); });
  }
  function update(user: Account, changes: Partial<Account>) {
    void perform(async () => {
      await api(`/admin/users/${user.id}`, 'PATCH', { name: user.name, role: user.role, disabled: user.disabled, ...changes });
      if (user.id === session.user.id) onSignedOut(); else { await reload(); setMessage('帳號已更新，其已有登入已撤銷。'); }
    });
  }
  /** `org` names another institution for a per-institution switch; without it, it is this one. */
  function toggle(key: keyof FeatureSwitches, enabled: boolean, org?: Org) {
    void perform(async () => {
      const result = await api<{ features: FeatureSwitches }>('/admin/features', 'PUT', { key, enabled, ...(org ? { orgId: org.id } : {}) });
      if (!org || org.id === session.user.orgId) onFeaturesChanged?.(result.features);
      await reload();
      const where = key === 'photoIntake' ? '全站的' : `「${org?.name ?? '本機構'}」的`;
      setMessage(`已${enabled ? '開啟' : '關閉'}${where}「${featureText[key].label}」，立即生效。`);
    });
  }
  /** Audit targets read `workspaceSync@org-id`, or `azure-openai@org-id` for the AI key. */
  const targetLabel = (target: string) => {
    const [key, orgId] = target.split('@');
    const label = key in featureText ? featureText[key as keyof FeatureSwitches].label : providerText[key] ? `AI 密鑰 · ${providerText[key]}` : undefined;
    if (!label) return undefined;
    if (!orgId) return label;
    return `${label} · ${orgId === session.user.orgId ? '本機構' : orgs.find(o => o.id === orgId)?.name ?? orgId}`;
  };
  /** The AI-assisted rows are a disclosure of how a record was produced, not an accusation. */
  const aiEvents = auditFilter === 'ai' ? events.filter(event => event.action === 'ai_assisted_write') : events;
  /**
   * Every switch here sends data off this deployment, and the AI key is now the platform's
   * (server `.env`), so none of them is an institution administrator's call
   * (`docs/AI_ASSISTANT.md` 2.2 decision 18). An institution's administrator still sees the
   * state; the server refuses the change either way.
   */
  const mayTurn = () => platform;
  return <section className="account-page" aria-label="設定">
    <header><div><h1>設定</h1><p>{session.user.name} · {session.user.email}</p></div><button onClick={onClose}>返回工作台</button></header>
    {error && <p role="alert" className="account-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {link && <section className="account-link"><h2>一次性設定密碼連結</h2><p>1 小時有效，僅顯示這一次。請通過可信渠道私下交付，新的連結會使舊連結失效。</p><input aria-label="一次性連結" readOnly value={link} onFocus={e => e.currentTarget.select()} /><button onClick={() => setLink('')}>隱藏連結</button></section>}
    <div className="account-columns">
      {/* Folded until asked for: new-password fields on an ordinary visit invite a password
          manager to suggest and save a password nobody chose. The account is the username. */}
      <section><h2>修改密碼</h2>{!changing ? <><p>修改後所有裝置都需要重新登入。</p><button type="button" onClick={() => setChanging(true)}>修改密碼…</button></> : <form onSubmit={password}>
        <label>帳號<input name="username" type="email" autoComplete="username" readOnly value={session.user.email} /></label>
        <label>目前密碼<input name="oldPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <label>新密碼<input name="password" type="password" autoComplete="new-password" required minLength={15} maxLength={128} /></label>
        <label>確認新密碼<input name="confirm" type="password" autoComplete="new-password" required minLength={15} maxLength={128} /></label>
        <p>15–128 個字元，可使用長句。修改後所有裝置都需要重新登入。</p><div className="account-actions"><button type="button" onClick={() => setChanging(false)}>取消</button><button disabled={busy}>修改並重新登入</button></div>
      </form>}</section>
      <section><h2>登入狀態</h2><p>連續 6 小時無操作或登入滿 12 小時後過期。</p>
        <ul>{devices.map(device => <li key={device.id}>{device.current ? '目前登入' : '其他登入'} · 登入於 {new Date(device.created_at).toLocaleString('zh-HK')}</li>)}</ul>
        <button disabled={busy} onClick={() => void perform(async () => { await api('/sessions/revoke-others', 'POST'); await reload(); setMessage('其他裝置已登出。'); })}>登出其他裝置</button>
      </section>
    </div>
    {/* Every member sees whether the assistant is set up; only an administrator changes it. */}
    <AiSettingsPanel orgId={session.user.orgId ?? session.user.id} admin={admin} />
    {admin && <>
      <section className="account-features"><h2>功能開關</h2><p>{platform
        ? '照片回錄影響全站；跨裝置同步和 AI 助手按機構分開，這裡是本機構的，其他機構的同步在下面「機構」裡開關，AI 助手由各機構自己的管理員開關。預設全部關閉，每次開關都記在操作記錄裡。'
        : '照片回錄和跨裝置同步由平台管理員（CareFlow 團隊）設定；AI 助手是本機構的事，由你在下面開關。'}</p>
        <ul>{(Object.keys(featureText) as (keyof FeatureSwitches)[]).map(key => <li key={key}>
          <label><input type="checkbox" checked={features[key] === true} disabled={busy || !mayTurn()} onChange={e => toggle(key, e.target.checked)} /><strong>{featureText[key].label}</strong>{!mayTurn() && <span className="account-features__state">{features[key] ? '已開啟' : '已關閉'}</span>}</label>
          <p>{featureText[key].detail}</p>
          {key === 'photoIntake' && azureReady === false && <p className="account-features__warn">伺服器未設定 Azure 金鑰：即使開啟，照片也無法辨識。</p>}
        </li>)}</ul>
      </section>
      {platform && orgs.length > 0 && <section className="account-orgs"><h2>機構</h2>
        <p>每間機構有自己的工作區和機構密語，互相看不到。新增機構、把帳號移到另一間機構，要在伺服器用命令完成（見 docs/ACCOUNTS.md）。</p>
        <div className="account-table"><table><thead><tr><th>機構</th><th>機構管理員</th><th>員工</th><th>跨裝置同步</th></tr></thead><tbody>{orgs.map(org => <tr key={org.id}>
          <td>{org.name}{org.id === session.user.orgId && <span className="account-badge">你所在</span>}<small>{org.id}</small></td>
          <td>{org.admins}</td><td>{org.members}</td>
          <td><label className="account-orgs__switch"><input type="checkbox" aria-label={`${org.name}跨裝置同步`} checked={org.features.workspaceSync === true} disabled={busy} onChange={e => toggle('workspaceSync', e.target.checked, org)} />{org.features.workspaceSync ? '已開啟' : '已關閉'}</label></td>
        </tr>)}</tbody></table></div>
      </section>}
      <WorkspaceKeyPanel orgId={session.user.orgId ?? session.user.id} onChanged={() => onKeyChanged?.()} />
      <section><h2>邀請成員</h2><form onSubmit={invite} className="account-invite">
        <label>姓名<input name="name" required maxLength={80} autoComplete="off" /></label>
        <label>電郵<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
        <label>角色<select name="role"><option value="MEMBER">成員</option><option value="ADMIN">機構管理員</option></select></label>
        <button disabled={busy}>建立邀請</button>
      </form></section>
      <section><h2>機構帳號</h2><div className="account-table"><table><thead><tr><th>成員</th><th>狀態</th><th>角色</th><th>操作</th></tr></thead><tbody>{users.map(user => <tr key={user.id}>
        <td>{user.name}{user.platformAdmin && <span className="account-badge">平台管理員</span>}<small>{user.email}</small></td><td>{user.disabled ? '已停用' : user.pending ? '待啟用' : '正常'}</td>
        <td><select aria-label={`${user.email}角色`} disabled={busy || user.id === session.user.id || (user.platformAdmin && !platform)} value={user.role} onChange={e => update(user, { role: e.target.value as Account['role'] })}><option value="MEMBER">成員</option><option value="ADMIN">機構管理員</option></select></td>
        <td>{user.id === session.user.id ? <small>（你自己；請用上面的「修改密碼」）</small> : user.platformAdmin && !platform ? <small>（平台管理員的帳號只可由平台管理員修改）</small> : <><button disabled={busy} onClick={() => update(user, { disabled: !user.disabled })}>{user.disabled ? '啟用' : '停用'}</button> <button disabled={busy || user.disabled} onClick={() => void perform(async () => { const result = await api<{ link: string }>(`/admin/users/${user.id}/reset`, 'POST'); setLink(result.link); await reload(); })}>{user.pending ? '重新邀請' : '重設密碼'}</button></>}</td>
      </tr>)}</tbody></table></div></section>
      <section><h2>最近 100 條帳號操作記錄 <select aria-label="篩選操作記錄" value={auditFilter} onChange={e => setAuditFilter(e.target.value as 'all' | 'ai')}><option value="all">全部</option><option value="ai">只看 AI 協助寫入</option></select></h2><div className="account-table"><table><thead><tr><th>時間</th><th>操作者</th><th>操作</th><th>對象</th></tr></thead><tbody>{aiEvents.map(event => <tr key={event.id}><td>{new Date(event.time).toLocaleString('zh-HK')}</td><td>{event.actor_email ?? '系統／未登入'}</td><td>{actions[event.action] ?? event.action}</td><td>{event.target_email ?? ((event.target && targetLabel(event.target)) ?? (event.target === session.user.orgId ? '本機構' : '—'))}</td></tr>)}</tbody></table>{aiEvents.length === 0 && <p className="account-note">這段期間沒有符合的記錄。</p>}</div></section>
    </>}
    {advanced && <details className="account-advanced"><summary>高級設定</summary>{advanced}</details>}
  </section>;
}
