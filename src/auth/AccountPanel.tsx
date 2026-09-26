import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Account, type Session } from './api';

interface Device { id: string; created_at: number; seen_at: number; current: boolean; }
interface AuditEvent { id: number; time: number; action: string; actor_email?: string; target_email?: string; }
const actions: Record<string, string> = { login: '登录', login_failed: '登录失败', logout: '退出', user_created: '创建账号', user_updated: '修改账号', password_link_created: '生成设置密码链接', password_set: '设置密码', password_changed: '修改密码', other_sessions_revoked: '撤销其他会话', operator_recovery: '运维恢复管理员' };
export function AccountPanel({ session, onClose, onSignedOut }: { session: Session; onClose: () => void; onSignedOut: () => void }) {
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
  useEffect(() => { void reload().catch(e => setError(e instanceof Error ? e.message : '读取失败。')); }, [reload]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage(''); setLink('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败。'); }
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
    if (data.get('password') !== data.get('confirm')) { setError('两次密码不一致。'); return; }
    void perform(async () => { await api('/password', 'POST', { oldPassword: data.get('oldPassword'), password: data.get('password') }); onSignedOut(); });
  }
  function update(user: Account, changes: Partial<Account>) {
    void perform(async () => {
      await api(`/admin/users/${user.id}`, 'PATCH', { name: user.name, role: user.role, disabled: user.disabled, ...changes });
      if (user.id === session.user.id) onSignedOut(); else { await reload(); setMessage('账号已更新，其已有会话已撤销。'); }
    });
  }
  return <section className="account-page" aria-label="账号设置">
    <header><div><h1>账号设置</h1><p>{session.user.name} · {session.user.email}</p></div><button onClick={onClose}>返回工作台</button></header>
    <p className="account-note">工作台当前使用合成演示资料，按账号保存在此浏览器中，不会同步到其他设备。</p>
    {error && <p role="alert" className="account-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {link && <section className="account-link"><h2>一次性设置密码链接</h2><p>1 小时有效，仅显示这一次。请通过可信渠道私下交付，新的链接会使旧链接失效。</p><input aria-label="一次性链接" readOnly value={link} onFocus={e => e.currentTarget.select()} /><button onClick={() => setLink('')}>隐藏链接</button></section>}
    <div className="account-columns">
      <section><h2>修改密码</h2><form onSubmit={password}>
        <label>当前密码<input name="oldPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <label>新密码<input name="password" type="password" autoComplete="new-password" required minLength={15} maxLength={128} /></label>
        <label>确认新密码<input name="confirm" type="password" autoComplete="new-password" required minLength={15} maxLength={128} /></label>
        <p>15–128 个字符，可使用长句。修改后所有设备都需要重新登录。</p><button disabled={busy}>修改并重新登录</button>
      </form></section>
      <section><h2>登录会话</h2><p>连续 30 分钟无操作或登录满 12 小时后过期。</p>
        <ul>{devices.map(device => <li key={device.id}>{device.current ? '当前会话' : '其他会话'} · 登录于 {new Date(device.created_at).toLocaleString('zh-CN')}</li>)}</ul>
        <button disabled={busy} onClick={() => void perform(async () => { await api('/sessions/revoke-others', 'POST'); await reload(); setMessage('其他设备已退出。'); })}>退出其他设备</button>
      </section>
    </div>
    {admin && <>
      <section><h2>邀请成员</h2><form onSubmit={invite} className="account-invite">
        <label>姓名<input name="name" required maxLength={80} autoComplete="off" /></label>
        <label>邮箱<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
        <label>角色<select name="role"><option value="MEMBER">成员</option><option value="ADMIN">管理员</option></select></label>
        <button disabled={busy}>创建邀请</button>
      </form></section>
      <section><h2>机构账号</h2><div className="account-table"><table><thead><tr><th>成员</th><th>状态</th><th>角色</th><th>操作</th></tr></thead><tbody>{users.map(user => <tr key={user.id}>
        <td>{user.name}<small>{user.email}</small></td><td>{user.disabled ? '已停用' : user.pending ? '待激活' : '正常'}</td>
        <td><select aria-label={`${user.email}角色`} disabled={busy} value={user.role} onChange={e => update(user, { role: e.target.value as Account['role'] })}><option value="MEMBER">成员</option><option value="ADMIN">管理员</option></select></td>
        <td><button disabled={busy} onClick={() => update(user, { disabled: !user.disabled })}>{user.disabled ? '启用' : '停用'}</button> <button disabled={busy || user.disabled} onClick={() => void perform(async () => { const result = await api<{ link: string }>(`/admin/users/${user.id}/reset`, 'POST'); setLink(result.link); await reload(); })}>{user.pending ? '重新邀请' : '重置密码'}</button></td>
      </tr>)}</tbody></table></div></section>
      <section><h2>最近 100 条账号操作记录</h2><div className="account-table"><table><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td>{new Date(event.time).toLocaleString('zh-CN')}</td><td>{event.actor_email ?? '系统／未登录'}</td><td>{actions[event.action] ?? event.action}</td><td>{event.target_email ?? '—'}</td></tr>)}</tbody></table></div></section>
    </>}
  </section>;
}
