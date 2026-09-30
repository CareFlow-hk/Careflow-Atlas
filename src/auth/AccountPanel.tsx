import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Account, type Session } from './api';

interface Device { id: string; created_at: number; seen_at: number; current: boolean; }
interface AuditEvent { id: number; time: number; action: string; actor_email?: string; target_email?: string; }
const actions: Record<string, string> = { login: '登入', login_failed: '登入失敗', logout: '登出', user_created: '建立帳號', user_updated: '修改帳號', password_link_created: '生成設定密碼連結', password_set: '設定密碼', password_changed: '修改密碼', other_sessions_revoked: '撤銷其他登入', operator_recovery: '運維恢復管理員' };
export function AccountPanel({ session, onClose, onSignedOut, advanced }: { session: Session; onClose: () => void; onSignedOut: () => void; /** Workspace settings, folded under 高級設定. */ advanced?: ReactNode }) {
  const [users, setUsers] = useState<Account[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const admin = session.user.role === 'ADMIN';
  const reload = useCallback(async () => {
    const [deviceData, userData, auditData] = await Promise.all([
      api<{ sessions: Device[] }>('/sessions'),
      admin ? api<{ users: Account[] }>('/admin/users') : Promise.resolve({ users: [] }),
      admin ? api<{ events: AuditEvent[] }>('/admin/audit') : Promise.resolve({ events: [] }),
    ]);
    setDevices(deviceData.sessions); setUsers(userData.users); setEvents(auditData.events);
  }, [admin]);
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
  return <section className="account-page" aria-label="設定">
    <header><div><h1>設定</h1><p>{session.user.name} · {session.user.email}</p></div><button onClick={onClose}>返回工作台</button></header>
    {error && <p role="alert" className="account-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {link && <section className="account-link"><h2>一次性設定密碼連結</h2><p>1 小時有效，僅顯示這一次。請通過可信渠道私下交付，新的連結會使舊連結失效。</p><input aria-label="一次性連結" readOnly value={link} onFocus={e => e.currentTarget.select()} /><button onClick={() => setLink('')}>隱藏連結</button></section>}
    <div className="account-columns">
      <section><h2>修改密碼</h2><form onSubmit={password}>
        <label>目前密碼<input name="oldPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <label>新密碼<input name="password" type="password" autoComplete="new-password" required minLength={15} maxLength={128} /></label>
        <label>確認新密碼<input name="confirm" type="password" autoComplete="new-password" required minLength={15} maxLength={128} /></label>
        <p>15–128 個字元，可使用長句。修改後所有裝置都需要重新登入。</p><button disabled={busy}>修改並重新登入</button>
      </form></section>
      <section><h2>登入狀態</h2><p>連續 6 小時無操作或登入滿 12 小時後過期。</p>
        <ul>{devices.map(device => <li key={device.id}>{device.current ? '目前登入' : '其他登入'} · 登入於 {new Date(device.created_at).toLocaleString('zh-HK')}</li>)}</ul>
        <button disabled={busy} onClick={() => void perform(async () => { await api('/sessions/revoke-others', 'POST'); await reload(); setMessage('其他裝置已登出。'); })}>登出其他裝置</button>
      </section>
    </div>
    {admin && <>
      <section><h2>邀請成員</h2><form onSubmit={invite} className="account-invite">
        <label>姓名<input name="name" required maxLength={80} autoComplete="off" /></label>
        <label>電郵<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
        <label>角色<select name="role"><option value="MEMBER">成員</option><option value="ADMIN">管理員</option></select></label>
        <button disabled={busy}>建立邀請</button>
      </form></section>
      <section><h2>機構帳號</h2><div className="account-table"><table><thead><tr><th>成員</th><th>狀態</th><th>角色</th><th>操作</th></tr></thead><tbody>{users.map(user => <tr key={user.id}>
        <td>{user.name}<small>{user.email}</small></td><td>{user.disabled ? '已停用' : user.pending ? '待啟用' : '正常'}</td>
        <td><select aria-label={`${user.email}角色`} disabled={busy || user.id === session.user.id} value={user.role} onChange={e => update(user, { role: e.target.value as Account['role'] })}><option value="MEMBER">成員</option><option value="ADMIN">管理員</option></select></td>
        <td>{user.id === session.user.id ? <small>（你自己；請用上面的「修改密碼」）</small> : <><button disabled={busy} onClick={() => update(user, { disabled: !user.disabled })}>{user.disabled ? '啟用' : '停用'}</button> <button disabled={busy || user.disabled} onClick={() => void perform(async () => { const result = await api<{ link: string }>(`/admin/users/${user.id}/reset`, 'POST'); setLink(result.link); await reload(); })}>{user.pending ? '重新邀請' : '重設密碼'}</button></>}</td>
      </tr>)}</tbody></table></div></section>
      <section><h2>最近 100 條帳號操作記錄</h2><div className="account-table"><table><thead><tr><th>時間</th><th>操作者</th><th>操作</th><th>對象</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td>{new Date(event.time).toLocaleString('zh-HK')}</td><td>{event.actor_email ?? '系統／未登入'}</td><td>{actions[event.action] ?? event.action}</td><td>{event.target_email ?? '—'}</td></tr>)}</tbody></table></div></section>
    </>}
    {advanced && <details className="account-advanced"><summary>高級設定</summary>{advanced}</details>}
  </section>;
}
