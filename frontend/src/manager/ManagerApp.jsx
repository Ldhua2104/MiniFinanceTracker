import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

const isChinese = () => (localStorage.getItem('mini-finance.language') || navigator.language || '').toLowerCase().startsWith('zh');
const text = (zh, en) => isChinese() ? zh : en;

function ErrorMessage({ children }) {
  return children ? <p className="manager-error" role="alert">{children}</p> : null;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (response.data?.role !== 'admin') {
        await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
        throw new Error(text('此入口仅限管理员使用。', 'This entry is for administrators only.'));
      }
      onLogin(response.data);
    } catch (cause) {
      setError(cause.message || text('登录失败，请检查邮箱和密码。', 'Sign in failed. Check your email and password.'));
    } finally { setBusy(false); }
  }

  return <main className="manager-login-wrap">
    <form className="manager-login-card" onSubmit={submit}>
      <div className="manager-brand-mark">M</div>
      <p className="manager-eyebrow">MINT FINANCE · MANAGER</p>
      <h1>{text('管理员登录', 'Manager sign in')}</h1>
      <p className="manager-muted">{text('使用管理员账户进入管理控制台。', 'Sign in with an administrator account to continue.')}</p>
      <label>{text('邮箱', 'Email')}<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>{text('密码', 'Password')}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <ErrorMessage>{error}</ErrorMessage>
      <button className="manager-primary" disabled={busy}>{busy ? text('正在登录…', 'Signing in…') : text('登录管理端', 'Sign in to manager')}</button>
    </form>
  </main>;
}

function MetricCard({ label, value, caption }) {
  return <article className="manager-metric-card"><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{caption}</small></article>;
}

function TrendChart({ id, title, description, rows, color, emptyLabel }) {
  const width = 820;
  const height = 248;
  const left = 42;
  const right = 12;
  const top = 16;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(1, ...rows.map((row) => row.count));
  const points = rows.map((row, index) => ({
    ...row,
    x: left + (rows.length <= 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth),
    y: top + plotHeight - (row.count / max) * plotHeight
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const area = points.length ? `${line} L ${points.at(-1).x} ${top + plotHeight} L ${points[0].x} ${top + plotHeight} Z` : '';
  const ticks = [0, Math.ceil(max / 2), max];
  const dateIndexes = [...new Set([0, Math.floor((rows.length - 1) / 3), Math.floor(((rows.length - 1) * 2) / 3), rows.length - 1])];
  const hasActivity = rows.some((row) => row.count > 0);

  return <article className="manager-chart-card">
    <div className="manager-chart-heading"><div><h2>{title}</h2><p>{description}</p></div><span className="manager-chart-key"><i style={{ background: color }} />{title}</span></div>
    {!hasActivity ? <div className="manager-chart-empty">{emptyLabel}</div> : <div className="manager-chart-plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>{description}</desc>
        {ticks.map((tick, index) => {
          const y = top + plotHeight - (tick / max) * plotHeight;
          return <g key={`${id}-tick-${index}`}><line x1={left} x2={width - right} y1={y} y2={y} className="manager-chart-gridline" /><text x={left - 10} y={y + 4} textAnchor="end" className="manager-chart-axis-label">{tick}</text></g>;
        })}
        <path d={area} fill={`url(#${id}-fill)`} />
        <defs><linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".18" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => dateIndexes.includes(index) ? <g key={`${id}-${point.date}`}><circle cx={point.x} cy={point.y} r="4" fill={color} /><text x={point.x} y={height - 7} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} className="manager-chart-date">{point.date.slice(5)}</text></g> : null)}
      </svg>
    </div>}
  </article>;
}

function AccountManagement() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ q: query, status, page: String(page), pageSize: '25' });
      const result = await apiRequest(`/admin/users?${params}`);
      setRows(result.data || []);
      setPagination(result.meta?.pagination || { pages: 1, total: 0 });
    } catch (cause) { setError(cause.message || text('无法读取账号列表。', 'Could not load accounts.')); }
    finally { setLoading(false); }
  }, [query, status, page]);

  useEffect(() => {
    const timer = window.setTimeout(loadUsers, 250);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  async function toggleStatus(account) {
    const nextStatus = account.status === 'active' ? 'disabled' : 'active';
    const confirmation = nextStatus === 'disabled'
      ? text(`停用账号 ${account.id}？该账号的现有会话将失效。`, `Disable account ${account.id}? Its active sessions will be revoked.`)
      : text(`重新启用账号 ${account.id}？`, `Re-enable account ${account.id}?`);
    if (!window.confirm(confirmation)) return;
    setWorkingId(account.id);
    try {
      await apiRequest(`/admin/users/${account.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      await loadUsers();
    } catch (cause) { setError(cause.message || text('更新账号状态失败。', 'Could not update account status.')); }
    finally { setWorkingId(''); }
  }

  return <section className="manager-content manager-accounts-content">
    <div className="manager-section-heading"><div><h2>{text('普通用户账号', 'Member accounts')}</h2><p>{text('通过系统账号 ID 管理访问状态；邮箱会隐藏部分字符。', 'Manage access by system account ID. Email addresses are partially masked.')}</p></div></div>
    <div className="manager-user-tools">
      <input aria-label={text('按账号 ID 搜索', 'Search by account ID')} placeholder={text('输入账号 ID 或前缀', 'Enter an account ID or prefix')} value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} />
      <select aria-label={text('账号状态', 'Account status')} value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="all">{text('全部状态', 'All statuses')}</option><option value="active">{text('正常', 'Active')}</option><option value="disabled">{text('已停用', 'Disabled')}</option></select>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <div className="manager-table-wrap"><table className="manager-users-table"><thead><tr><th>{text('系统账号 ID', 'System account ID')}</th><th>{text('邮箱', 'Email')}</th><th>{text('状态', 'Status')}</th><th>{text('操作', 'Action')}</th></tr></thead><tbody>
      {rows.map((account) => <tr key={account.id}><td><code>{account.id}</code></td><td>{account.maskedEmail || '—'}</td><td><span className={`manager-status ${account.status}`}>{account.status === 'active' ? text('正常', 'Active') : text('已停用', 'Disabled')}</span></td><td><button className={account.status === 'active' ? 'manager-danger-button' : 'manager-outline-button'} disabled={workingId === account.id} onClick={() => toggleStatus(account)}>{workingId === account.id ? '…' : account.status === 'active' ? text('停用账号', 'Disable') : text('启用账号', 'Enable')}</button></td></tr>)}
      {!loading && rows.length === 0 && <tr><td className="manager-empty" colSpan="4">{text('没有匹配的账号。', 'No matching accounts.')}</td></tr>}
      {loading && <tr><td className="manager-empty" colSpan="4">{text('正在加载…', 'Loading…')}</td></tr>}
    </tbody></table></div>
    <div className="manager-pagination"><span>{text('账号总数', 'Total accounts')}: {pagination.total}</span><div><button className="manager-outline-button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>{text('上一页', 'Previous')}</button><span>{page} / {Math.max(1, pagination.pages)}</span><button className="manager-outline-button" disabled={page >= pagination.pages || loading} onClick={() => setPage((value) => value + 1)}>{text('下一页', 'Next')}</button></div></div>
  </section>;
}

function Overview({ data, loading, error, onRefresh }) {
  const newUsersCount = data?.registrations?.reduce((sum, row) => sum + row.count, 0) || 0;
  const activeToday = data?.activeStreak?.at(-1)?.count || 0;
  const periodLabel = data?.period ? `${data.period.startDate} – ${data.period.endDate}` : '—';

  return <>
    <header className="manager-topbar">
      <div><p className="manager-eyebrow">MINT FINANCE · MANAGER</p><h1>{text('系统概览', 'System overview')}</h1></div>
      <button className="manager-outline-button" disabled={loading} onClick={onRefresh}>{loading ? text('正在刷新…', 'Refreshing…') : text('刷新数据', 'Refresh data')}</button>
    </header>
    <section className="manager-content">
      <div className="manager-period-label">{periodLabel}</div>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="manager-metric-grid">
        <MetricCard label={text('普通用户总数', 'Total member accounts')} value={data?.totalUsers ?? 0} caption={text('仅账户总量', 'Aggregate count only')} />
        <MetricCard label={text('近 30 天新注册', 'New registrations · 30 days')} value={newUsersCount} caption={text('按注册日期统计', 'Grouped by registration date')} />
        <MetricCard label={text('连续 3 天活跃', '3-day active users')} value={activeToday} caption={text('截至今天的匿名汇总', 'Anonymous total through today')} />
      </div>
      {data && <div className="manager-chart-grid">
        <TrendChart id="registrations" title={text('每日注册用户', 'Daily registrations')} description={text('近 30 天每天新建的普通账户数。', 'New member accounts created per day over the last 30 days.')} rows={data.registrations} color="#527f63" emptyLabel={text('此时间段内没有新注册。', 'No registrations in this period.')} />
        <TrendChart id="active-users" title={text('连续记账用户', 'Consecutive-day active users')} description={text('每天至少记录一笔收支，且连续 3 个自然日均有记录的账户数。', 'Accounts with at least one transaction on each of three consecutive calendar days, counted for each day.')} rows={data.activeStreak} color="#a18d66" emptyLabel={text('此时间段内暂无连续 3 天记账用户。', 'No users met the 3-day activity definition in this period.')} />
      </div>}
    </section>
  </>;
}

function AccessDenied({ onSwitch }) {
  return <main className="manager-login-wrap"><section className="manager-login-card"><div className="manager-brand-mark">M</div><h1>{text('无权访问', 'Access denied')}</h1><p className="manager-muted">{text('当前账户不是管理员账户。', 'This account does not have administrator access.')}</p><button className="manager-outline-button" onClick={onSwitch}>{text('切换账户', 'Switch account')}</button></section></main>;
}

export default function ManagerApp() {
  const [state, setState] = useState({ loading: true, user: null });
  const [section, setSection] = useState('overview');
  const [data, setData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoadingData(true);
    setError('');
    try {
      const result = await apiRequest('/admin/overview');
      setData(result.data);
    } catch (cause) { setError(cause.message || text('无法读取汇总数据。', 'Could not load aggregate metrics.')); }
    finally { setLoadingData(false); }
  }, []);

  useEffect(() => {
    apiRequest('/auth/me').then(({ data: user }) => setState({ loading: false, user }))
      .catch(() => setState({ loading: false, user: null }));
  }, []);
  useEffect(() => { if (state.user?.role === 'admin') loadOverview(); }, [state.user, loadOverview]);

  async function logout() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
    setData(null);
    setState({ loading: false, user: null });
  }

  if (state.loading) return <main className="manager-loading">{text('正在验证管理员身份…', 'Checking administrator access…')}</main>;
  if (state.user?.role === 'admin') return <div className="manager-shell">
    <aside className="manager-sidebar">
      <div className="manager-sidebar-brand"><span className="manager-brand-mark">M</span><div><b>MINT FINANCE</b><small>{text('管理控制台', 'MANAGER')}</small></div></div>
      <nav className="manager-navigation" aria-label={text('管理导航', 'Management navigation')}>
        <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}><span>◫</span>{text('概览', 'Overview')}</button>
        <button className={section === 'accounts' ? 'active' : ''} onClick={() => setSection('accounts')}><span>♙</span>{text('账号管理', 'Accounts')}</button>
      </nav>
      <div className="manager-sidebar-foot"><span>{text('管理员会话', 'Administrator session')}</span><button className="manager-quiet-button" onClick={logout}>{text('退出登录', 'Sign out')}</button></div>
    </aside>
    <main className="manager-main">{section === 'overview' ? <Overview data={data} loading={loadingData} error={error} onRefresh={loadOverview} /> : <><header className="manager-topbar"><div><p className="manager-eyebrow">MINT FINANCE · MANAGER</p><h1>{text('账号管理', 'Account management')}</h1></div></header><AccountManagement /></>}</main>
  </div>;
  if (state.user) return <AccessDenied onSwitch={logout} />;
  return <Login onLogin={(user) => setState({ loading: false, user })} />;
}
