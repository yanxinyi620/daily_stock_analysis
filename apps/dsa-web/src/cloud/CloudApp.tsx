import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { Tooltip } from '../components/common/Tooltip';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import { ReportMarkdownBody } from '../components/report/ReportMarkdownBody';
import { cloudData, createCloudClient, type CloudData, type CloudReport, type Market, type WatchItem } from './client';
import { AnalysisRecords } from './AnalysisRecords';
import { RunnerPanel } from './RunnerPanel';
import { CloudDialog } from './CloudDialog';
import './cloud.css';

const pageSize = Math.max(1, Math.min(100, Number(import.meta.env.VITE_CLOUD_REPORT_PAGE_SIZE) || 20));
const displayZone = import.meta.env.VITE_CLOUD_TIME_ZONE || 'Asia/Shanghai';
function date(value: string) {
  try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: displayZone }).format(new Date(value)); }
  catch { return value; }
}
const requestError = '请求失败，请检查网络、登录状态及权限后重试。';

function Login({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error) setError('登录失败，请核对邮箱和密码。');
      setPassword('');
    } catch { setError(requestError); }
    finally { setBusy(false); }
  };
  return <main className="cloud-login">
    <div className="cloud-eyebrow">DAILY STOCK ANALYSIS</div>
    <h1>你的研究，<br />有迹可循。</h1>
    <p className="cloud-muted">登录后查看你的自选股与分析报告。</p>
    <form onSubmit={(e) => void submit(e)} className="cloud-panel cloud-form">
      <label>邮箱<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>密码<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
      <small className="cloud-muted">账户由站点所有者预先创建。需要帮助时请联系站点所有者。</small>
    </form>
  </main>;
}

function Watchlist({ api, user }: { api: CloudData; user: string }) {
  const [items, setItems] = useState<WatchItem[]>([]); const [revision, setRevision] = useState(0);
  const [market, setMarket] = useState<Market>('CN'); const [code, setCode] = useState('');
  const [name, setName] = useState(''); const [position, setPosition] = useState(0);
  const [editing, setEditing] = useState<string>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const close = () => { setOpen(false); setEditing(undefined); setCode(''); setName(''); };
  useEffect(() => {
    let current = true;
    api.watchlist(user).then((rows) => { if (current) setItems(rows); }).catch(() => { if (current) setError(requestError); });
    return () => { current = false; };
  }, [api, user, revision]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api.saveWatch(user, { market, code, name, position }, editing);
      setCode(''); setName(''); setEditing(undefined); setOpen(false); setRevision((n) => n + 1);
    } catch { setError('保存失败，请核对代码格式、重复记录及账户权限。'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true); setError('');
    try { await api.deleteWatch(user, id); setRevision((n) => n + 1); }
    catch { setError(requestError); }
    finally { setBusy(false); }
  };
  const edit = (item: WatchItem) => {
    setEditing(item.id); setMarket(item.market); setCode(item.code); setName(item.name); setPosition(item.position); setError(''); setOpen(true);
  };
  const beginAdd = () => { setEditing(undefined); setMarket('CN'); setCode(''); setName(''); setPosition(0); setError(''); setOpen(true); };
  return <aside className="cloud-watchlist">
    <div className="cloud-section-heading"><h2>我的自选股</h2><span>{items.length} 只</span></div>
    <ul className="cloud-list">{items.map((item) => <li key={item.id}>
      <span><strong>{item.name || item.code}</strong><small>{item.name ? `${item.code} · ${item.market}` : item.market}</small></span>
      <div className="cloud-actions"><button disabled={busy} onClick={() => edit(item)} aria-label={`编辑 ${item.code}`}>编辑</button><button disabled={busy} onClick={() => void remove(item.id)} aria-label={`移除 ${item.code}`}>移除</button></div>
    </li>)}</ul>
    {!items.length && <p className="cloud-muted">添加你正在关注的股票。</p>}
    <button type="button" className="cloud-watchlist-add" disabled={busy} onClick={beginAdd}>添加自选股</button>
    <p className="cloud-watchlist-note">综合分析使用提交时的自选股快照。</p>
    {open && <CloudDialog title={editing ? '编辑自选股' : '添加自选股'} onClose={close} busy={busy}><form className="cloud-form" onSubmit={(e) => void save(e)}>
      <div className="cloud-fields"><label>市场<select value={market} onChange={(e) => setMarket(e.target.value as Market)}>
        <option value="CN">A 股</option><option value="HK">港股</option><option value="US">美股</option>
      </select></label><label>代码<input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="000001 / hk00700 / AAPL" /></label></div>
      <div className="cloud-fields"><label>名称<input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>排序<input type="number" step="1" value={position} onChange={(e) => setPosition(Number(e.target.value))} /></label></div>
      <div className="cloud-actions"><button className="btn-primary" disabled={busy}>{editing ? '保存修改' : '添加自选股'}</button>
        <button type="button" disabled={busy} onClick={close}>取消</button></div>
      {error && <p role="alert">{error}</p>}
    </form></CloudDialog>}
    {error && !open && <p role="alert">{error} <button onClick={() => setRevision((n) => n + 1)}>重试</button></p>}
  </aside>;
}

function ReportDetail({ api, user }: { api: CloudData; user: string }) {
  const { id = '' } = useParams(); const [report, setReport] = useState<CloudReport>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    api.report(user, id).then((result) => { if (current) setReport(result); }).catch(() => { if (current) setError('报告不存在、无权访问或网络请求失败。'); });
    return () => { current = false; };
  }, [api, user, id]);
  const download = async () => {
    if (!report) return;
    setBusy(true); setError('');
    try {
      const blob = await api.download(report);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `report-${report.task_id}.md`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError(requestError); }
    finally { setBusy(false); }
  };
  return <main className="cloud-panel cloud-detail"><Link to="/">← 报告列表</Link>
    {error && <p role="alert">{error}</p>}
    {report ? <><div className="cloud-section-heading"><h1>{report.title}</h1><button disabled={busy} onClick={() => void download()}>下载 Markdown</button></div>
      <p className="cloud-muted">生成于 {date(report.generated_at)} · 行情截至 {report.market_as_of ? date(report.market_as_of) : '未提供'}</p>
      <ReportMarkdownBody content={report.markdown} /></> : !error && <p>加载报告中…</p>}
  </main>;
}

function Account({ client }: { client: SupabaseClient }) {
  const [password, setPassword] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); const triggerRef = useRef<HTMLButtonElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try { const { error } = await client.auth.updateUser({ password }); setMessage(error ? '修改失败，请重新登录后重试。' : '密码已更新。'); setPassword(''); }
    catch { setMessage(requestError); } finally { setBusy(false); }
  };
  const close = () => { setOpen(false); window.setTimeout(() => triggerRef.current?.focus()); };
  return <><button ref={triggerRef} type="button" onClick={() => setOpen(true)}>账户</button>{open && <CloudDialog title="修改密码" onClose={close} busy={busy}><form className="cloud-form" onSubmit={(e) => void submit(e)}>
    <label>新密码<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    <button disabled={busy}>更新密码</button>{message && <p role="status">{message}</p>}
  </form></CloudDialog>}</>;
}

function Workspace({ client, session, api, logout }: { client: SupabaseClient; session: Session; api: CloudData; logout: () => void }) {
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => { flushSync(() => setRefreshing(true)); window.location.reload(); };
  return <BrowserRouter><div className="cloud-workspace">
    <header className="cloud-header"><div className="cloud-brand-actions"><Link to="/" className="cloud-brand">DSA <span>研究档案</span></Link><Tooltip content={refreshing ? '刷新中…' : '刷新页面'} side="bottom"><button className="cloud-refresh-button" type="button" aria-label="刷新" aria-busy={refreshing} disabled={refreshing} onClick={refresh}><RefreshCw size={16} aria-hidden="true" /></button></Tooltip></div>
      <div className="cloud-actions"><span className="cloud-muted">{session.user.email}</span><Account client={client} /><button onClick={logout}>退出登录</button></div></header>
    <Routes><Route path="/reports/:id" element={<ReportDetailRoute api={api} user={session.user.id} />} />
      <Route path="/" element={<div className="cloud-grid"><div className="cloud-sidebar"><div className="cloud-intro"><div><h1>分析工作台</h1><p className="cloud-muted">发起分析，回看每一次判断。</p></div>
        </div>
        <Watchlist api={api} user={session.user.id} /></div><main className="cloud-stack">
          <RunnerPanel client={client} accessToken={session.access_token} user={session.user.id} onReport={() => setRevision((n) => n + 1)} reportRevision={revision} />
          <AnalysisRecords api={api} user={session.user.id} revision={revision} pageSize={pageSize} formatDate={date} onChanged={() => setRevision((n) => n + 1)} /></main></div>} />
      <Route path="*" element={<main className="cloud-panel">页面不存在。<Link to="/">返回报告列表</Link></main>} /></Routes>
    <footer className="cloud-muted">分析仅供研究参考 · 时间显示：{displayZone}</footer>
  </div></BrowserRouter>;
}
function ReportDetailRoute(props: { api: CloudData; user: string }) {
  const { id } = useParams();
  return <ReportDetail key={id} {...props} />;
}

function Authenticated({ client, session, logout }: { client: SupabaseClient; session: Session; logout: () => void }) {
  const api = useMemo(() => cloudData(client), [client]);
  const [member, setMember] = useState<boolean>(); const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    api.member(session.user.id).then((active) => { if (current) setMember(active); }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [api, session.user.id]);
  if (member !== true) return <main className="cloud-login"><p>{error ? requestError : member === false ? '账户尚未获得访问权限，请联系站点所有者。' : '正在检查账户权限…'}</p><button onClick={logout}>退出登录</button></main>;
  return <Workspace client={client} session={session} api={api} logout={logout} />;
}

function SessionApp({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(); const [error, setError] = useState('');
  useEffect(() => {
    let current = true; let eventReceived = false;
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      eventReceived = true;
      if (current) { setSession(next); setError(''); }
    });
    client.auth.getSession().then((result) => {
      if (current && !eventReceived) {
        if (result.error) { setError(requestError); setSession(null); }
        else setSession(result.data.session);
      }
    }).catch(() => { if (current && !eventReceived) { setError(requestError); setSession(null); } });
    return () => { current = false; data.subscription.unsubscribe(); };
  }, [client]);
  const logout = async () => {
    // Remove private state before waiting for the auth request; no cross-account cache.
    setSession(null);
    try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) setError('退出请求失败，请重试或清除此站点的浏览器数据。'); }
    catch { setError(requestError); }
  };
  return <>{error && <p className="cloud-banner" role="alert">{error}</p>}{session === undefined ? <main className="cloud-login">加载会话中…</main> : session ?
    <Authenticated key={`${session.user.id}:${session.access_token}`} client={client} session={session} logout={() => void logout()} /> : <Login client={client} />}</>;
}

export default function CloudApp() {
  const setup = useMemo(() => {
    try { return { client: createCloudClient(), error: '' }; }
    catch (error) { return { client: undefined, error: error instanceof Error ? error.message : '云端配置错误' }; }
  }, []);
  return <div className="cloud-app">{setup.client ? <SessionApp client={setup.client} /> : <main className="cloud-login"><h1>云端配置未就绪</h1><p role="alert">{setup.error}</p></main>}</div>;
}
