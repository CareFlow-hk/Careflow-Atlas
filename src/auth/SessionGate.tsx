import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, setCsrf, type Session } from './api';
import { setWorkspaceAccount } from '../app/store';
import { AccountPanel } from './AccountPanel';
import './accounts.css';

function readGrant() {
  const match = location.hash.match(/^#set-password=([\w-]{43})$/);
  if (!match) return '';
  history.replaceState(null, '', location.pathname + location.search);
  return match[1];
}
export function SessionGate({ children }: { children: ReactNode }) {
  // Capture once outside the state updater: StrictMode replays updater functions.
  const grantRef = useRef<string | undefined>(undefined);
  if (grantRef.current === undefined) grantRef.current = readGrant();
  const [grant, setGrant] = useState(grantRef.current);
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState(false);
  const generation = useRef(0);
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    const navigate = () => { const token = readGrant(); if (token) { setGrant(token); setError(''); } };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const drop = useCallback(() => {
    generation.current++;
    setCsrf(); setSession(undefined); setSettings(false); setWorkspaceAccount();
  }, []);
  const accept = useCallback((next: Session) => {
    setCsrf(next.csrf); setWorkspaceAccount(next.user.id); setSession(next);
  }, []);
  const refresh = useCallback(async () => {
    const version = generation.current;
    try { const value = await api<Session>('/session'); if (version === generation.current) accept(value); }
    catch (e) {
      if (version !== generation.current) return;
      drop();
      if (!(e instanceof ApiError && e.status === 401)) setError('无法连接账号服务。请检查网络后重试。');
    } finally { setLoading(false); }
  }, [accept, drop]);
  useEffect(() => {
    void refresh();
    const expired = () => { drop(); setNotice('会话已结束，请重新登录。'); };
    window.addEventListener('atlas-session-expired', expired);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('atlas-account') : undefined;
    if (channel) channel.onmessage = () => { drop(); void refresh(); };
    return () => { window.removeEventListener('atlas-session-expired', expired); channel?.close(); };
  }, [drop, refresh]);
  useEffect(() => {
    if (!session) return;
    const active = () => { lastActivity.current = Date.now(); };
    const check = () => { if (!document.hidden && Date.now() - lastActivity.current < 60_000) void refresh(); };
    const focus = () => { active(); void refresh(); };
    const timer = window.setInterval(check, 30_000);
    const expiry = window.setTimeout(() => { drop(); setNotice('会话已过期，请重新登录。'); }, Math.min(session.expiresAt - Date.now(), 30 * 60_000));
    window.addEventListener('pointerdown', active); window.addEventListener('keydown', active); window.addEventListener('focus', focus);
    return () => { clearInterval(timer); clearTimeout(expiry); window.removeEventListener('pointerdown', active); window.removeEventListener('keydown', active); window.removeEventListener('focus', focus); };
  }, [session, refresh, drop]);
  function broadcast() { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('atlas-account'); channel.postMessage('changed'); channel.close(); } }
  function signedOut() { drop(); broadcast(); setNotice('请重新登录。'); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    if (grant && data.get('password') !== data.get('confirm')) { setError('两次密码不一致。'); return; }
    setBusy(true); setError('');
    try {
      if (grant) {
        await api('/set-password', 'POST', { token: grant, password: data.get('password') });
        setGrant(''); signedOut(); setNotice('密码已设置，请使用邮箱和新密码登录。');
      } else { const next = await api<Session>('/login', 'POST', { email: data.get('email'), password: data.get('password') }); generation.current++; lastActivity.current = Date.now(); accept(next); broadcast(); setNotice(''); }
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败。'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try { await api('/logout', 'POST'); signedOut(); }
    catch (e) { setError(e instanceof Error ? e.message : '退出失败，请重试。'); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="account-loading" role="status">正在连接账号服务…</main>;
  if (!session || grant) return <main className="login-page"><section className="login-card">
    <p className="account-brand">CareFlow Atlas</p><h1>{grant ? '设置账号密码' : '登录工作台'}</h1>
    <p>{grant ? '邀请和重置链接仅可使用一次，1 小时内有效。' : '使用管理员为你开通的机构账号。'}</p>
    {error && <p role="alert" className="account-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form onSubmit={submit} key={grant ? 'set' : 'login'}>
      {!grant && <label>邮箱<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>}
      <label>{grant ? '新密码' : '密码'}<input name="password" type="password" autoComplete={grant ? 'new-password' : 'current-password'} required minLength={grant ? 15 : undefined} maxLength={128} /></label>
      {grant && <><label>确认密码<input name="confirm" type="password" autoComplete="new-password" required minLength={15} maxLength={128} /></label><p>15–128 个字符，可使用长句。</p></>}
      <button disabled={busy}>{busy ? '正在处理…' : grant ? '设置密码' : '登录'}</button>
    </form>
    {grant ? <button className="account-text-button" onClick={() => { setGrant(''); setError(''); }}>返回登录</button> : <details><summary>忘记密码或没有账号？</summary><p>请联系机构管理员核对身份，获取一次性邀请或重置链接。管理员无法登录时，由 VPS 运维人员运行恢复命令。</p></details>}
    <p className="account-note">当前工作台仅用于合成资料演示。账号不会让业务资料自动跨设备同步。</p>
  </section></main>;
  return <div className="authenticated-app"><nav className="account-bar" aria-label="账号菜单"><span>{session.user.name} · {session.user.role === 'ADMIN' ? '管理员' : '成员'}</span><button onClick={() => setSettings(true)}>账号设置</button><button disabled={busy} onClick={() => void logout()}>退出登录</button></nav>
    {error && <p role="alert" className="account-error">{error}</p>}
    {settings ? <AccountPanel session={session} onClose={() => setSettings(false)} onSignedOut={signedOut} /> : <div key={session.user.id} className="authenticated-workspace">{children}</div>}
  </div>;
}
