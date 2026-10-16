import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import {
  clearAnonymousWorkspace, emptyWorkspace, formatCents, hasWorkspaceData, loadAnonymousWorkspace,
  loadServerWorkspace, moneyToCents, saveAnonymousWorkspace, saveServerWorkspace
} from '../data/workspace.js';
import { detectLanguage, saveLanguage, translate } from '../i18n.js';

const APP_ROLES = Object.freeze({ anonymous: 'anonymous', user: 'user' });

const currencies = ['USD', 'EUR', 'CNY', 'GBP'];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function centsToAmount(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function App() {
  const [language, setLanguage] = useState(detectLanguage);
  const [theme, setTheme] = useState(() => localStorage.getItem('mini-finance.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [page, setPage] = useState('overview');
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(APP_ROLES.anonymous);
  const [workspace, setWorkspace] = useState(emptyWorkspace());
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [migration, setMigration] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [month, setMonth] = useState(today().slice(0, 7));
  const t = (key) => translate(language, key);

  useEffect(() => {
    let active = true;
    apiRequest('/auth/me')
      .then(async ({ data: account }) => {
        const remote = await loadServerWorkspace();
        if (!active) return;
        setUser(account);
        setRole(APP_ROLES.user);
        setWorkspace(remote);
        setWorkspaceReady(true);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setRole(APP_ROLES.anonymous);
        setWorkspace(loadAnonymousWorkspace());
        setWorkspaceReady(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mini-finance.theme', theme);
  }, [theme]);

  useEffect(() => saveLanguage(language), [language]);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    if (role === 'anonymous') {
      saveAnonymousWorkspace(workspace);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSaveStatus('saving');
      saveServerWorkspace(workspace)
        .then(() => {
          setSaveStatus('saved');
        })
        .catch(() => setSaveStatus('failed'));
    }, 450);
    return () => clearTimeout(timer);
  }, [workspace, role, workspaceReady]);

  const monthTransactions = useMemo(
    () => workspace.transactions.filter((item) => item.transactionDate.startsWith(month)).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)),
    [workspace.transactions, month]
  );
  const monthTotals = useMemo(() => {
    return monthTransactions.reduce((totals, item) => {
      const cents = moneyToCents(item.amount) ?? 0n;
      if (item.type === 'income') totals.income += cents;
      else totals.expense += cents;
      return totals;
    }, { income: 0n, expense: 0n });
  }, [monthTransactions]);
  const currency = user?.baseCurrency ?? 'USD';

  async function onAuthenticated(account) {
    const local = role === 'anonymous' ? workspace : emptyWorkspace();
    const remote = await loadServerWorkspace();
    setUser(account);
    setRole(APP_ROLES.user);
    setPage('profile');
    if (hasWorkspaceData(local)) {
      setMigration({ local, remote });
      setWorkspaceReady(false);
    } else {
      setWorkspace(remote);
      setWorkspaceReady(true);
    }
  }

  async function chooseMigration(choice) {
    if (!migration) return;
    const result = choice === 'merge'
      ? await saveServerWorkspace({
          categories: mergeById(migration.remote.categories, migration.local.categories),
          transactions: mergeById(migration.remote.transactions, migration.local.transactions),
          budgets: mergeById(migration.remote.budgets, migration.local.budgets),
          revision: migration.remote.revision
        })
      : migration.remote;
    if (choice === 'merge') clearAnonymousWorkspace();
    setWorkspace(result);
    setMigration(null);
    setWorkspaceReady(true);
  }

  async function signOut() {
    try { await apiRequest('/auth/logout', { method: 'POST' }); } catch { /* The local session still ends in this browser. */ }
    setUser(null);
    setRole(APP_ROLES.anonymous);
    setMigration(null);
    setWorkspace(loadAnonymousWorkspace());
    setWorkspaceReady(true);
    setSaveStatus('saved');
    setPage('overview');
  }

  function addTransaction(transaction) {
    setWorkspace((current) => ({ ...current, transactions: [transaction, ...current.transactions] }));
  }

  function deleteTransaction(id) {
    setWorkspace((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== id) }));
  }

  const saveLabel = saveStatus === 'failed' ? t('saveFailed') : saveStatus === 'saved' ? t('saved') : '…';

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage('overview')} aria-label={t('overview')}>
          <span className="brand-mark">m</span><span>{t('brand')}</span>
        </button>
        <div className="top-actions">
          <label className="language-picker">
            <span className="sr-only">{t('language')}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label={t('language')}>
              <option value="zh">中文</option><option value="en">English</option>
            </select>
          </label>
          <button className="theme-switch" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={t('theme')} title={t('theme')}>
            <span aria-hidden="true">{theme === 'light' ? '◐' : '☼'}</span><span>{theme === 'light' ? t('dark') : t('light')}</span>
          </button>
          <button className={`profile-chip ${page === 'profile' ? 'is-active' : ''}`} onClick={() => setPage('profile')}>
            <span className="avatar">{user?.email?.slice(0, 1).toUpperCase() ?? '·'}</span>
            <span>{user?.email ?? t('profile')}</span>
          </button>
        </div>
      </header>

      <div className="layout-grid">
        <aside className="left-rail">
          <div className="rail-label">{t('overviewHint')}</div>
          <nav className="primary-nav" aria-label={t('overview')}>
            <button className={page === 'overview' ? 'selected' : ''} onClick={() => setPage('overview')}><span>◫</span>{t('overview')}</button>
            <button className={page === 'activity' ? 'selected' : ''} onClick={() => setPage('activity')}><span>↗</span>{t('activity')}</button>
            <button className={page === 'profile' ? 'selected' : ''} onClick={() => setPage('profile')}><span>○</span>{t('profile')}</button>
          </nav>
          <div className="rail-bottom">
            <span className="tiny-label">{t('account')}</span>
            <div className="role-status"><span className="role-dot" />{user ? t('roleUser') : t('roleAnonymous')}</div>
            {!user && <p>{t('localNote')}</p>}
          </div>
        </aside>

        <main className="main-content">
          {page === 'profile' ? (
            <ProfilePage user={user} t={t} onAuthenticated={onAuthenticated} onSignOut={signOut} migration={migration} onMigration={chooseMigration} />
          ) : (
            <>
              <section className="page-heading">
                <div><div className="eyebrow">{t(page === 'activity' ? 'activity' : 'brand')}</div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>
                <label className="month-control"><span>{t('month')}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
              </section>

              <section className="summary-grid" aria-label={t('overviewHint')}>
                <SummaryCard label={t('income')} value={formatCents(monthTotals.income, language === 'zh' ? 'zh-CN' : 'en-US', currency)} tone="positive" />
                <SummaryCard label={t('expense')} value={formatCents(monthTotals.expense, language === 'zh' ? 'zh-CN' : 'en-US', currency)} tone="neutral" />
                <SummaryCard label={t('balance')} value={formatCents(monthTotals.income - monthTotals.expense, language === 'zh' ? 'zh-CN' : 'en-US', currency)} tone="balance" />
              </section>

              <div className="content-columns">
                <section className="panel transaction-panel">
                  <div className="panel-heading"><div><div className="eyebrow">{t('activity')}</div><h2>{t('recent')}</h2></div><span className="count-pill">{monthTransactions.length} {t('transactionsCount')}</span></div>
                  {monthTransactions.length ? <TransactionList items={monthTransactions} categories={workspace.categories} t={t} language={language} onDelete={deleteTransaction} /> : <div className="empty-state"><span className="empty-icon">↗</span><p>{t('empty')}</p></div>}
                </section>
                <TransactionForm categories={workspace.categories} currency={currency} t={t} onSubmit={addTransaction} />
              </div>
            </>
          )}
        </main>

        <aside className="right-rail">
          <div className="right-card account-card">
            <div className="mini-icon">✳</div>
            <div className="eyebrow">{t('account')}</div>
            <h3>{user ? user.email : t('anonymous')}</h3>
            <p>{user ? t('roleUser') : t('localNote')}</p>
            <button className="subtle-button" onClick={() => setPage('profile')}>{user ? t('profile') : t('signIn')} <span>→</span></button>
          </div>
          <div className="right-card note-card">
            <span className="tiny-label">{t('month')}</span>
            <strong>{month}</strong>
            <p>{t('overviewHint')}</p>
          </div>
          {user && <div className={`sync-label ${saveStatus}`}>{saveLabel}</div>}
        </aside>
      </div>

      <footer className="app-footer"><span>{t('footer')}</span><span>© MINT FINANCE</span></footer>
    </div>
  );
}

function mergeById(remote = [], local = []) {
  const merged = new Map(remote.map((item) => [item.id, item]));
  for (const item of local) if (!merged.has(item.id)) merged.set(item.id, item);
  return [...merged.values()];
}

function SummaryCard({ label, value, tone }) {
  return <article className={`summary-card ${tone}`}><span>{label}</span><strong>{value}</strong><i /></article>;
}

function TransactionForm({ categories, currency, t, onSubmit }) {
  const [type, setType] = useState('expense');
  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [error, setError] = useState('');
  const choices = categories.filter((item) => item.type === type && !item.archived);
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = String(form.get('amount')).trim();
    if (!moneyToCents(amount) || moneyToCents(amount) <= 0n) return setError(t('fieldRequired'));
    setError('');
    onSubmit({
      id: crypto.randomUUID(), type, amount: centsToAmount(moneyToCents(amount)),
      currency: selectedCurrency, categoryId: String(form.get('categoryId')),
      transactionDate: String(form.get('transactionDate')), note: String(form.get('note') ?? '').trim()
    });
    event.currentTarget.reset();
    const dateInput = event.currentTarget.elements.transactionDate;
    if (dateInput) dateInput.value = today();
  }
  return (
    <section className="panel form-panel">
      <div className="panel-heading"><div><div className="eyebrow">{t('newTransaction')}</div><h2>{t('newTransaction')}</h2></div><span className="form-plus">＋</span></div>
      <form onSubmit={submit}>
        <label className="field"><span>{t('type')}</span><div className="segmented-control"><button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>{t('expenseType')}</button><button type="button" className={type === 'income' ? 'active' : ''} onClick={() => setType('income')}>{t('incomeType')}</button></div></label>
        <label className="field"><span>{t('amount')}</span><div className="amount-control"><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /><select aria-label={t('currency')} value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></div></label>
        <label className="field"><span>{t('category')}</span><select name="categoryId" required>{choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>{t('date')}</span><input name="transactionDate" type="date" defaultValue={today()} required /></label>
        <label className="field"><span>{t('note')}</span><input name="note" type="text" maxLength="500" /></label>
        {error && <div className="inline-error">{error}</div>}
        <button className="primary-button" type="submit">{t('save')} <span>→</span></button>
      </form>
    </section>
  );
}

function TransactionList({ items, categories, t, language, onDelete }) {
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
  return (
    <div className="transaction-list">
      {items.map((item) => (
        <article className="transaction-row" key={item.id}>
          <span className={`transaction-symbol ${item.type}`}>{item.type === 'income' ? '↙' : '↗'}</span>
          <div className="transaction-info"><strong>{item.note || categoryMap.get(item.categoryId) || '—'}</strong><span>{categoryMap.get(item.categoryId) || '—'} · {item.transactionDate}</span></div>
          <strong className={`transaction-value ${item.type}`}>{item.type === 'income' ? '+' : '−'}{formatCents(moneyToCents(item.amount) ?? 0n, language === 'zh' ? 'zh-CN' : 'en-US', item.currency)}</strong>
          <button className="icon-button" onClick={() => onDelete(item.id)} aria-label={t('delete')} title={t('delete')}>×</button>
        </article>
      ))}
    </div>
  );
}

function ProfilePage({ user, t, onAuthenticated, onSignOut, migration, onMigration }) {
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email')).trim();
    const password = String(form.get('password'));
    if (mode === 'register') {
      if (password.length < 12) return setError(t('passwordShort'));
      if (password !== form.get('confirmPassword')) return setError(t('passwordMismatch'));
    }
    setError('');
    setWorking(true);
    try {
      const response = await apiRequest(`/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      await onAuthenticated(response.data);
    } catch (authError) {
      setError(authError.message || t('authFailed'));
    } finally {
      setWorking(false);
    }
  }
  async function migrate(choice) {
    setWorking(true);
    setError('');
    try { await onMigration(choice); }
    catch { setError(t('saveFailed')); }
    finally { setWorking(false); }
  }

  return (
    <section className="profile-view">
      <div className="page-heading profile-heading"><div><div className="eyebrow">{t('profile')}</div><h1>{t('security')}</h1><p>{t('secureNote')}</p></div></div>
      {migration ? (
        <article className="panel migration-panel">
          <span className="migration-icon">↗</span><div className="eyebrow">{t('migrationTitle')}</div><h2>{t('migrationTitle')}</h2><p>{t('migrationText')}</p>
          {error && <div className="inline-error">{error}</div>}
          <div className="migration-actions"><button className="primary-button" disabled={working} onClick={() => void migrate('merge')}>{t('merge')} <span>→</span></button><button className="secondary-button" disabled={working} onClick={() => void migrate('server')}>{t('keepServer')}</button></div>
        </article>
      ) : user ? (
        <article className="panel signed-in-panel">
          <div className="signed-avatar">{user.email.slice(0, 1).toUpperCase()}</div><div className="eyebrow">{t('account')}</div><h2>{user.email}</h2><p>{t('roleUser')} · {user.baseCurrency}</p>
          <button className="secondary-button" onClick={onSignOut}>{t('signOut')}</button>
        </article>
      ) : (
        <article className="panel auth-panel">
          <div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>{t('signIn')}</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>{t('register')}</button></div>
          <form onSubmit={submit}>
            <label className="field"><span>{t('email')}</span><input name="email" type="email" autoComplete="email" required /></label>
            <label className="field"><span>{t('password')}</span><input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 12 : 1} maxLength="128" required /></label>
            {mode === 'register' && <label className="field"><span>{t('confirmPassword')}</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength="12" maxLength="128" required /></label>}
            {error && <div className="inline-error">{error}</div>}
            <button className="primary-button auth-submit" type="submit" disabled={working}>{working ? '…' : mode === 'register' ? t('register') : t('signIn')} <span>→</span></button>
          </form>
          <div className="auth-switch">{mode === 'register' ? t('already') : t('noAccount')} <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? t('switchLogin') : t('switchRegister')}</button></div>
          <div className="local-privacy"><span>⌂</span>{t('localNote')}</div>
        </article>
      )}
    </section>
  );
}
