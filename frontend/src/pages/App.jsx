import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { convertCents, fetchLatestFxRates } from '../api/exchange-rates.js';
import {
  clearAnonymousWorkspace, emptyWorkspace, formatCents, hasWorkspaceData, loadAnonymousProfile, loadAnonymousWorkspace,
  loadServerWorkspace, moneyToCents, saveAnonymousProfile, saveAnonymousWorkspace, saveServerWorkspace
} from '../data/workspace.js';
import { detectLanguage, saveLanguage, translate } from '../i18n.js';

const APP_ROLES = Object.freeze({ anonymous: 'anonymous', user: 'user' });

const currencies = ['USD', 'EUR', 'CNY', 'GBP'];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function localTransactionTimestamp(date = new Date()) {
  return {
    transactionDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    transactionTime: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  };
}

function formatTransactionTime(value, format, language) {
  if (!value) return '\u2014';
  const [hour, minute] = value.split(':').map(Number);
  if (format !== '12') return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const date = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

function recentFiveDays() {
  const center = new Date(`${today()}T12:00:00`);
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(center);
    date.setDate(center.getDate() + index - 4);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
}

function makeTrend(account, transactions, language) {
  const days = recentFiveDays();
  const totals = new Map(days.map((day) => [day, { income: 0n, expense: 0n }]));
  for (const item of transactions) {
    const daily = totals.get(item.transactionDate);
    if (!daily || item.accountId !== account?.id) continue;
    daily[item.type] += moneyToCents(item.amount) ?? 0n;
  }
  return days.map((date) => ({
    date,
    label: new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit' }).format(new Date(`${date}T12:00:00`)),
    income: totals.get(date).income,
    expense: totals.get(date).expense
  }));
}

function centsToAmount(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function App() {
  const [language, setLanguage] = useState(detectLanguage);
  const [theme, setTheme] = useState(() => localStorage.getItem('mini-finance.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [timeFormat, setTimeFormat] = useState(() => localStorage.getItem('mini-finance.time-format') === '12' ? '12' : '24');
  const [page, setPage] = useState('overview');
  const [user, setUser] = useState(null);
  const [anonymousProfile, setAnonymousProfile] = useState(loadAnonymousProfile);
  const [role, setRole] = useState(APP_ROLES.anonymous);
  const [workspace, setWorkspace] = useState(emptyWorkspace());
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [migration, setMigration] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [rightEditor, setRightEditor] = useState(null);
  const [editingBudget, setEditingBudget] = useState(null);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [editorLoadVersion, setEditorLoadVersion] = useState(0);
  const [newTransactionTimestamp, setNewTransactionTimestamp] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [reportCurrency, setReportCurrency] = useState(() => {
    const saved = localStorage.getItem('mini-finance.report-currency');
    return currencies.includes(saved) ? saved : 'USD';
  });
  const [fx, setFx] = useState({ rates: null, date: '', status: 'idle', stale: false });
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

  useEffect(() => localStorage.setItem('mini-finance.time-format', timeFormat), [timeFormat]);

  useEffect(() => saveLanguage(language), [language]);

  useEffect(() => localStorage.setItem('mini-finance.report-currency', reportCurrency), [reportCurrency]);

  useEffect(() => {
    if (page !== 'activity' && page !== 'budgets') return undefined;
    let active = true;
    setFx((current) => ({ ...current, status: 'loading' }));
    fetchLatestFxRates()
      .then((result) => { if (active) setFx({ ...result, status: 'ready' }); })
      .catch(() => { if (active) setFx((current) => ({ ...current, status: 'error' })); });
    return () => { active = false; };
  }, [page]);

  async function refreshFxRates() {
    setFx((current) => ({ ...current, status: 'loading' }));
    try {
      const result = await fetchLatestFxRates({ force: true });
      setFx({ ...result, status: 'ready' });
    } catch {
      setFx((current) => ({ ...current, status: 'error' }));
    }
  }

  useEffect(() => {
    if (role === 'anonymous') saveAnonymousProfile(anonymousProfile);
  }, [anonymousProfile, role]);

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

  useEffect(() => {
    if (!workspace.accounts.length) setSelectedAccountId(null);
    else if (!workspace.accounts.some((account) => account.id === selectedAccountId)) setSelectedAccountId(workspace.accounts[0].id);
  }, [workspace.accounts, selectedAccountId]);

  const selectedAccount = workspace.accounts.find((account) => account.id === selectedAccountId) ?? null;
  const accountTransactions = selectedAccount ? workspace.transactions.filter((item) => item.accountId === selectedAccount.id) : [];
  const monthTransactions = accountTransactions.filter((item) => item.transactionDate.startsWith(month)).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || (b.transactionTime ?? '').localeCompare(a.transactionTime ?? ''));
  const activityTransactions = workspace.transactions.filter((item) => item.transactionDate.startsWith(month)).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || (b.transactionTime ?? '').localeCompare(a.transactionTime ?? ''));
  const trend = useMemo(() => makeTrend(selectedAccount, accountTransactions, language), [selectedAccount, accountTransactions, language]);
  const currency = selectedAccount?.currency ?? user?.baseCurrency ?? 'USD';

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
          accounts: mergeById(migration.remote.accounts, migration.local.accounts),
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

  function updateTransaction(transaction) {
    setWorkspace((current) => ({ ...current, transactions: current.transactions.map((item) => item.id === transaction.id ? transaction : item) }));
  }

  function deleteTransaction(id) {
    setWorkspace((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== id) }));
  }

  function addAccount(account) {
    setWorkspace((current) => ({ ...current, accounts: [...current.accounts, account] }));
    setSelectedAccountId(account.id);
    setRightEditor(null);
  }

  function addTransactionAccount(account) {
    setWorkspace((current) => ({ ...current, accounts: [...current.accounts, account] }));
  }

  function openBudgetEditor(budget = null) {
    setEditingBudget(budget);
    setRightEditor('budget');
  }

  function saveBudget(budget, { closeEditor = true } = {}) {
    setWorkspace((current) => {
      const category = current.categories.find((item) => item.id === budget.categoryId)
        ?? current.categories.find((item) => item.type === 'expense' && item.name.trim().toLocaleLowerCase() === budget.name.trim().toLocaleLowerCase());
      const linkedCategory = { ...(category ?? {}), id: budget.categoryId || category?.id || crypto.randomUUID(), name: budget.name, type: 'expense', archived: false };
      const savedBudget = { ...budget, categoryId: linkedCategory.id };
      const categoryExists = current.categories.some((item) => item.id === linkedCategory.id);
      const categories = categoryExists
        ? current.categories.map((item) => item.id === linkedCategory.id ? linkedCategory : item)
        : [...current.categories, linkedCategory];
      return {
        ...current,
        categories,
        budgets: current.budgets.some((item) => item.id === savedBudget.id)
          ? current.budgets.map((item) => {
              const currentBudget = { ...item };
              delete currentBudget.accountId;
              return item.id === savedBudget.id || item.categoryId === linkedCategory.id
                ? { ...currentBudget, ...(item.categoryId === linkedCategory.id ? { name: budget.name } : {}), ...(item.id === savedBudget.id ? savedBudget : {}) }
                : currentBudget;
            })
          : [...current.budgets.filter((item) => item.categoryId !== linkedCategory.id).map(({ accountId, ...item }) => item), savedBudget]
      };
    });
    if (closeEditor) {
      setEditingBudget(null);
      setRightEditor(null);
    }
  }

  function deleteBudget(id) {
    setWorkspace((current) => ({ ...current, budgets: current.budgets.filter((item) => item.id !== id) }));
    setEditingBudget(null);
    setRightEditor(null);
  }

  function openTransactionEditor() {
    setEditingTransaction(null);
    setEditorLoadVersion((version) => version + 1);
    setNewTransactionTimestamp(localTransactionTimestamp());
    setRightEditor('transaction');
  }

  function openTransactionForEdit(transaction) {
    setEditingTransaction(transaction);
    setNewTransactionTimestamp(null);
    setEditorLoadVersion((version) => version + 1);
    setRightEditor('edit-transaction');
  }

  function submitTransaction(transaction) {
    if (editingTransaction) updateTransaction(transaction);
    else addTransaction(transaction);
    setEditingTransaction(null);
    setRightEditor(null);
  }

  function removeTransaction(id) {
    deleteTransaction(id);
    setEditingTransaction(null);
    setRightEditor(null);
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
            <ProfileAvatar className="avatar" src={user?.avatar ?? anonymousProfile.avatar} name={user?.username ?? anonymousProfile.username} />
            <span>{user?.username ?? anonymousProfile.username}</span>
          </button>
        </div>
      </header>

      <div className="layout-grid">
        <aside className="left-rail">
          <div className="rail-label">{t('overviewHint')}</div>
          <nav className="primary-nav" aria-label={t('overview')}>
            <button className={page === 'overview' ? 'selected' : ''} onClick={() => setPage('overview')}><span>⌂</span>{t('home')}</button>
            <button className={page === 'activity' ? 'selected' : ''} onClick={() => setPage('activity')}><span>↗</span>{t('activity')}</button>
            <button className={page === 'budgets' ? 'selected' : ''} onClick={() => setPage('budgets')}><span>◷</span>{t('budgets')}</button>
            <button className={page === 'profile' ? 'selected' : ''} onClick={() => setPage('profile')}><span>○</span>{t('profile')}</button>
            <button className={page === 'settings' ? 'selected' : ''} onClick={() => setPage('settings')}><span>⚙</span>{t('settings')}</button>
          </nav>
          <div className="rail-bottom">
            <span className="tiny-label">{t('account')}</span>
            <div className="role-status"><span className="role-dot" />{user ? t('roleUser') : t('roleAnonymous')}</div>
            {!user && <p>{t('localNote')}</p>}
          </div>
        </aside>

        <main className="main-content">
          {page === 'profile' ? (
            <ProfilePage user={user} anonymousProfile={anonymousProfile} onAnonymousProfileChange={setAnonymousProfile} onUserUpdated={setUser} t={t} onAuthenticated={onAuthenticated} onSignOut={signOut} migration={migration} onMigration={chooseMigration} />
          ) : page === 'settings' ? (
            <SettingsPage t={t} language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} timeFormat={timeFormat} setTimeFormat={setTimeFormat} />
          ) : page === 'budgets' ? (
            <BudgetPage budgets={workspace.budgets} transactions={workspace.transactions} categories={workspace.categories} month={today().slice(0, 7)} locale={language === 'zh' ? 'zh-CN' : 'en-US'} t={t} fx={fx} onAdd={() => openBudgetEditor()} onEdit={openBudgetEditor} />
          ) : page === 'activity' ? (
            <ActivityPage items={activityTransactions} allTransactions={workspace.transactions} categories={workspace.categories} budgets={workspace.budgets} accounts={workspace.accounts} month={month} onMonthChange={setMonth} locale={language === 'zh' ? 'zh-CN' : 'en-US'} t={t} language={language} timeFormat={timeFormat} reportCurrency={reportCurrency} onReportCurrencyChange={setReportCurrency} fx={fx} onRefreshFx={refreshFxRates} onDelete={deleteTransaction} onAdd={openTransactionEditor} onEdit={openTransactionForEdit} />
          ) : (
            <>
              <section className="page-heading">
                <div><div className="eyebrow">{t('brand')}</div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>
                <label className="month-control"><span>{t('month')}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
              </section>

              <section className="account-section" aria-label={t('accounts')}>
                <div className="section-heading"><div><div className="eyebrow">{t('accounts')}</div><h2>{t('accountOverview')}</h2></div>
                  {workspace.accounts.length > 0 && <button className="add-account-link" onClick={() => setRightEditor('account')}><span>+</span>{t('addAccount')}</button>}
                </div>
                {workspace.accounts.length ? (
                  <div className="summary-grid account-scroller">
                    {workspace.accounts.map((account) => <AccountCard key={account.id} account={account} selected={account.id === selectedAccountId} transactions={workspace.transactions} locale={language === 'zh' ? 'zh-CN' : 'en-US'} onSelect={() => setSelectedAccountId(account.id)} />)}
                  </div>
                ) : (
                  <div className="account-empty"><p>{t('noAccounts')}</p><button className="primary-button first-account-button" onClick={() => setRightEditor('account')}><span className="large-plus">+</span>{t('createFirstAccount')}</button></div>
                )}
              </section>

              {selectedAccount && <TrendChart account={selectedAccount} points={trend} t={t} locale={language === 'zh' ? 'zh-CN' : 'en-US'} />}
              <TransactionPanel items={monthTransactions} categories={workspace.categories} accounts={workspace.accounts} t={t} language={language} timeFormat={timeFormat} onDelete={deleteTransaction} onAdd={openTransactionEditor} onEdit={openTransactionForEdit} account={selectedAccount} />
            </>
          )}
        </main>

        <aside className={`right-rail ${rightEditor ? 'editing' : ''}`}>
          {rightEditor === 'account' ? (
            <AccountForm t={t} onCancel={() => setRightEditor(null)} onSubmit={addAccount} />
          ) : rightEditor === 'budget' ? (
            <BudgetForm key={editingBudget?.id ?? 'new-budget'} initialBudget={editingBudget ? { ...editingBudget, name: editingBudget.name || workspace.categories.find((category) => category.id === editingBudget.categoryId)?.name || '' } : null} categories={workspace.categories} budgets={workspace.budgets} defaultCurrency={workspace.accounts.find((account) => account.id === selectedAccountId)?.currency || 'USD'} t={t} onCancel={() => { setEditingBudget(null); setRightEditor(null); }} onSubmit={saveBudget} onDelete={deleteBudget} />
          ) : rightEditor === 'transaction' || rightEditor === 'edit-transaction' ? (
            <TransactionForm key={`${editingTransaction?.id ?? 'new'}-${editorLoadVersion}`} account={selectedAccount} accounts={workspace.accounts} categories={workspace.categories} budgets={workspace.budgets} user={user} t={t} language={language} timeFormat={timeFormat} initialTransaction={editingTransaction} openedAt={newTransactionTimestamp} onCancel={() => { setRightEditor(null); setEditingTransaction(null); }} onSubmit={submitTransaction} onDelete={removeTransaction} onCreateAccount={addTransactionAccount} onCreateBudget={(budget) => saveBudget(budget, { closeEditor: false })} />
          ) : (
            <>
              <div className="right-card account-card">
                <div className="mini-icon">?</div>
                <div className="eyebrow">{t('account')}</div>
                <h3>{user ? user.email : t('anonymous')}</h3>
                <p>{user ? t('roleUser') : t('localNote')}</p>
                <button className="subtle-button" onClick={() => setPage('profile')}>{user ? t('profile') : t('signIn')} <span>?</span></button>
              </div>
              <div className="right-card note-card">
                <span className="tiny-label">{t('month')}</span><strong>{month}</strong><p>{t('overviewHint')}</p>
              </div>
              {selectedAccount && <div className="right-card balance-note"><span className="tiny-label">{t('selectedAccount')}</span><strong>{selectedAccount.name}</strong><p>{selectedAccount.currency}</p></div>}
              {user && <div className={`sync-label ${saveStatus}`}>{saveLabel}</div>}
            </>
          )}
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

function AccountCard({ account, selected, transactions, locale, onSelect }) {
  const balance = transactions.filter((item) => item.accountId === account.id).reduce((sum, item) => {
    const cents = moneyToCents(item.amount) ?? 0n;
    return sum + (item.type === 'income' ? cents : -cents);
  }, moneyToCents(account.openingBalance) ?? 0n);
  return (
    <button className={`account-card-option ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <span className="account-card-top"><span className="account-glyph">{account.name.slice(0, 1).toUpperCase()}</span><span className="account-currency">{account.currency}</span></span>
      <span className="account-name">{account.name}</span>
      <strong>{formatCents(balance, locale, account.currency)}</strong>
    </button>
  );
}

function AccountForm({ t, onCancel, onSubmit, embedded = false }) {
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    const openingBalance = String(form.get('openingBalance')).trim() || '0.00';
    if (!name || moneyToCents(openingBalance) === null) return setError(t('fieldRequired'));
    setError('');
    onSubmit({ id: crypto.randomUUID(), name, currency, openingBalance: centsToAmount(moneyToCents(openingBalance)) });
  }
  const fields = <>
    <label className="field"><span>{t('accountName')}</span><input name="name" type="text" maxLength="60" autoFocus={!embedded} required /></label>
    <label className="field"><span>{t('openingBalance')}</span><input name="openingBalance" type="number" min="0" step="0.01" defaultValue="0.00" required /></label>
    <label className="field"><span>{t('currency')}</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label>
    {error && <div className="inline-error">{error}</div>}
  </>;

  if (embedded) return <section className="inline-account-editor">
    <div className="inline-budget-heading"><strong>{t('addAccount')}</strong><button type="button" className="text-button" onClick={onCancel} aria-label={t('close')}>×</button></div>
    <form onSubmit={submit}>{fields}<button className="primary-button" type="submit">{t('saveAccount')} <span>+</span></button></form>
  </section>;

  return (
    <section className="panel side-editor">
      <div className="editor-heading"><div><div className="eyebrow">{t('accounts')}</div><h2>{t('addAccount')}</h2></div><button className="icon-button close-editor" onClick={onCancel} aria-label={t('close')}>?</button></div>
      <p className="editor-copy">{t('accountSetupHint')}</p>
      <form onSubmit={submit}>
        {fields}
        <button className="primary-button" type="submit">{t('saveAccount')} <span>+</span></button>
        <button className="text-button" type="button" onClick={onCancel}>{t('cancel')}</button>
      </form>
    </section>
  );
}

const budgetColors = ['#557b63', '#7893a4', '#b88762', '#8879a6', '#b77979', '#a39152'];

function BudgetPage({ budgets, transactions, categories, month, locale, t, fx, onAdd, onEdit }) {
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const visibleBudgets = budgets.filter((budget) => !budget.month || budget.month === month);
  const monthEnd = new Date(`${month}-01T12:00:00`);
  monthEnd.setMonth(monthEnd.getMonth() + 1, 0);
  const monthEndLabel = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(monthEnd);

  function spentFor(budget) {
    let total = 0n;
    for (const transaction of transactions) {
      if (transaction.type !== 'expense' || !transaction.transactionDate.startsWith(month)) continue;
      const matches = budget.categoryId
        ? transaction.categoryId === budget.categoryId
        : categoryMap.get(transaction.categoryId)?.trim().toLocaleLowerCase() === budget.name?.trim().toLocaleLowerCase();
      if (!matches) continue;
      const converted = convertCents(moneyToCents(transaction.amount) ?? 0n, transaction.currency, budget.currency, fx.rates);
      if (converted === null) return null;
      total += converted;
    }
    return total;
  }

  return (
    <section className="page-section budget-page">
      <PageTitle title={t('budgets')} detail={t('budgetIntro')} />
      <section className="panel budget-panel">
        <div className="panel-heading">
          <div><div className="eyebrow">{t('budgets')}</div><h2>{t('monthlyBudgets')}</h2></div>
          <div className="panel-actions"><span className="count-pill">{visibleBudgets.length} {t('budgetsCount')}</span><button className="add-transaction-button" onClick={onAdd} aria-label={t('addBudget')} title={t('addBudget')}>+</button></div>
        </div>
        {visibleBudgets.length > 0 && fx.status === 'loading' && <p className="budget-rates-status">{t('ratesLoading')}</p>}
        {visibleBudgets.length > 0 && fx.status === 'error' && <p className="budget-rates-status">{t('ratesUnavailable')}</p>}
        {visibleBudgets.length > 0 && fx.stale && <p className="budget-rates-status">{t('ratesCached')} · {t('ratesThrough')} {fx.date}</p>}
        {visibleBudgets.length ? (
          <div className="budget-list">
            {visibleBudgets.map((budget) => <BudgetCard key={budget.id} budget={budget} spent={spentFor(budget)} locale={locale} monthEndLabel={monthEndLabel} categoryMap={categoryMap} t={t} onClick={() => onEdit(budget)} />)}
          </div>
        ) : (
          <div className="empty-state budget-empty"><span className="empty-icon">＋</span><p>{t('noBudgets')}</p><button className="primary-button" onClick={onAdd}>{t('addBudget')}</button></div>
        )}
      </section>
    </section>
  );
}

function BudgetCard({ budget, spent, locale, monthEndLabel, categoryMap, t, onClick }) {
  const limit = moneyToCents(budget.amount) ?? 0n;
  const remaining = spent === null ? null : limit - spent;
  const progress = spent !== null && limit > 0n ? Math.min(100, Number((spent * 10000n) / limit) / 100) : 0;
  const name = budget.name || categoryMap.get(budget.categoryId) || t('budgets');
  return (
    <button className="budget-card" style={{ '--budget-accent': budget.color || budgetColors[0] }} onClick={onClick}>
      <span className="budget-card-heading"><strong>{name}</strong><span className="budget-currency">{budget.currency}</span></span>
      <span className="budget-amounts">
        <span><small>{t('remainingBudget')}</small><strong>{remaining === null ? '—' : formatCents(remaining, locale, budget.currency)}</strong></span>
        <span><small>{t('totalBudget')}</small><strong>{formatCents(limit, locale, budget.currency)}</strong></span>
      </span>
      <span className={`budget-progress ${spent === null ? 'unavailable' : ''}`} role="progressbar" aria-label={`${name} ${t('budgetProgress')}`} aria-valuenow={Math.round(progress)} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${progress}%` }} /></span>
      <span className="budget-card-footer"><span>{t('spentBudget')}: {spent === null ? '—' : formatCents(spent, locale, budget.currency)}</span><span>{t('monthEnds')} {monthEndLabel}</span></span>
    </button>
  );
}

function BudgetForm({ initialBudget, categories, budgets, defaultCurrency = 'USD', t, onCancel, onSubmit, onDelete, embedded = false }) {
  const [name, setName] = useState(initialBudget?.name ?? '');
  const [amount, setAmount] = useState(initialBudget?.amount ?? '100.00');
  const [currency, setCurrency] = useState(initialBudget?.currency || defaultCurrency);
  const [color, setColor] = useState(initialBudget?.color || budgetColors[0]);
  const [error, setError] = useState('');
  const editing = Boolean(initialBudget);

  function submit(event) {
    event?.preventDefault();
    const cleanName = name.trim();
    const cents = moneyToCents(amount.trim());
    if (!cleanName || cleanName.length > 60 || cents === null || cents <= 0n) return setError(t('fieldRequired'));
    const existingCategory = categories.find((category) => category.type === 'expense' && category.name.trim().toLocaleLowerCase() === cleanName.toLocaleLowerCase());
    const categoryId = initialBudget?.categoryId || existingCategory?.id || crypto.randomUUID();
    const duplicate = budgets.some((budget) => budget.id !== initialBudget?.id && (budget.categoryId === categoryId || budget.name?.trim().toLocaleLowerCase() === cleanName.toLocaleLowerCase()));
    if (duplicate) return setError(t('budgetAlreadyExists'));
    setError('');
    onSubmit({
      id: initialBudget?.id ?? crypto.randomUUID(),
      name: cleanName,
      categoryId,
      amount: centsToAmount(cents),
      currency,
      color
    });
  }

  const fields = <>
    <label className="field"><span>{t('budgetName')}</span><input name="budgetName" type="text" maxLength="60" value={name} onChange={(event) => setName(event.target.value)} autoFocus={!embedded} required /></label>
    <label className="field"><span>{t('defaultCurrency')}</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label className="field"><span>{t('monthlyAvailable')}</span><div className="budget-amount-input"><input name="budgetAmount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /><span>{currency}</span></div></label>
    <div className="field"><span>{t('budgetCardColor')}</span><div className="budget-color-picker" role="group" aria-label={t('budgetCardColor')}>
      {budgetColors.map((value) => <button key={value} type="button" className={`budget-color-swatch ${color === value ? 'selected' : ''}`} style={{ '--swatch-color': value }} onClick={() => setColor(value)} aria-label={value} aria-pressed={color === value} />)}
    </div></div>
    {error && <div className="inline-error">{error}</div>}
  </>;

  if (embedded) return <div className="inline-budget-editor" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}>
    <div className="inline-budget-heading"><strong>{t('addBudget')}</strong><button type="button" className="text-button" onClick={onCancel}>{t('cancel')}</button></div>
    {fields}
    <button className="primary-button" type="button" onClick={() => submit()}>{t('saveBudget')}</button>
  </div>;

  return <section className="panel side-editor budget-editor">
    <div className="editor-heading"><div><div className="eyebrow">{t('budgets')}</div><h2>{editing ? t('editBudget') : t('addBudget')}</h2></div><button className="icon-button close-editor" type="button" onClick={onCancel} aria-label={t('close')}>×</button></div>
    <p className="editor-copy">{t('budgetEditorHint')}</p>
    <form onSubmit={submit}>
      {fields}
      <div className="transaction-form-actions"><button className="primary-button" type="submit">{t('saveBudget')}</button>{editing && <button className="delete-transaction-button" type="button" onClick={() => { if (window.confirm(t('confirmDeleteBudget'))) onDelete(initialBudget.id); }}>{t('deleteBudget')}</button>}</div>
    </form>
  </section>;
}

function ActivityPage({ items, allTransactions, categories, budgets, accounts, month, onMonthChange, locale, t, language, timeFormat, reportCurrency, onReportCurrencyChange, fx, onRefreshFx, onDelete, onAdd, onEdit }) {
  const [filters, setFilters] = useState({ startDate: '', endDate: '', minimum: '', maximum: '', budgetId: '', accountId: '' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const monthDate = new Date(`${month}-01T12:00:00`);
  const monthOptions = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monthDate);
    date.setMonth(monthDate.getMonth() + index - 3);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
  const nativeTotals = new Map();
  allTransactions.filter((item) => item.transactionDate.startsWith(month)).forEach((item) => {
    if (!nativeTotals.has(item.currency)) nativeTotals.set(item.currency, { expense: 0n, income: 0n });
    nativeTotals.get(item.currency)[item.type] += moneyToCents(item.amount) ?? 0n;
  });
  let expense = 0n;
  let income = 0n;
  let totalsAvailable = true;
  for (const [currency, values] of nativeTotals) {
    const convertedExpense = convertCents(values.expense, currency, reportCurrency, fx.rates);
    const convertedIncome = convertCents(values.income, currency, reportCurrency, fx.rates);
    if (convertedExpense === null || convertedIncome === null) {
      totalsAvailable = false;
      break;
    }
    expense += convertedExpense;
    income += convertedIncome;
  }
  const net = income - expense;
  const ratesMessage = fx.status === 'loading' ? t('ratesLoading')
    : (!totalsAvailable || fx.status === 'error') ? t('ratesUnavailable')
      : fx.stale ? t('ratesCached')
        : fx.date ? `${t('ratesThrough')} ${fx.date}` : '';
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const minimum = filters.minimum ? moneyToCents(filters.minimum) : null;
  const maximum = filters.maximum ? moneyToCents(filters.maximum) : null;
  const filteredItems = items.filter((item) => {
    if (filters.startDate && item.transactionDate < filters.startDate) return false;
    if (filters.endDate && item.transactionDate > filters.endDate) return false;
    if (filters.accountId && item.accountId !== filters.accountId) return false;
    if (filters.budgetId) {
      const budget = budgets.find((entry) => entry.id === filters.budgetId);
      const categoryMatches = budget?.categoryId
        ? item.categoryId === budget.categoryId
        : categoryMap.get(item.categoryId)?.trim().toLocaleLowerCase() === budget?.name?.trim().toLocaleLowerCase();
      if (!categoryMatches) return false;
    }
    if (filters.minimum || filters.maximum) {
      const value = convertCents(moneyToCents(item.amount) ?? 0n, item.currency, reportCurrency, fx.rates);
      if (value === null) return false;
      if (minimum !== null && value < minimum) return false;
      if (maximum !== null && value > maximum) return false;
    }
    return true;
  });
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <section className="page-section activity-page">
      <PageTitle title={t('activity')} detail={t('activityHint')} />
      <nav className="activity-month-strip" aria-label={t('month')}>
        {monthOptions.map((value) => {
          const date = new Date(`${value}-01T12:00:00`);
          const label = new Intl.DateTimeFormat(locale, { month: 'long' }).format(date);
          return <button key={value} type="button" className={`activity-month-tab ${value === month ? 'selected' : ''}`} onClick={() => onMonthChange(value)} aria-pressed={value === month} title={value}>{label}</button>;
        })}
        <label className="activity-month-picker"><span className="sr-only">{t('month')}</span><input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} aria-label={t('month')} /></label>
      </nav>
      <section className="activity-summary" aria-label={t('activitySummary')}>
        <div className="activity-currency-controls">
          <label><span>{t('summaryCurrency')}</span><select value={reportCurrency} onChange={(event) => onReportCurrencyChange(event.target.value)}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
          <div className="activity-rates-status"><span>{ratesMessage}</span><button type="button" onClick={onRefreshFx} disabled={fx.status === 'loading'} aria-label={t('refreshRates')} title={t('refreshRates')}>↻</button></div>
        </div>
        <div className="activity-summary-row">
          <span className="activity-stat expense"><small>{t('expense')}</small><strong>{totalsAvailable ? `−${formatCents(expense, locale, reportCurrency)}` : '—'}</strong></span>
          <span className="activity-stat income"><small>{t('income')}</small><strong>{totalsAvailable ? `+${formatCents(income, locale, reportCurrency)}` : '—'}</strong></span>
          <span className={`activity-stat net ${net < 0n ? 'negative' : 'positive'}`}><small>{t('balance')}</small><strong>{totalsAvailable ? formatCents(net, locale, reportCurrency) : '—'}</strong></span>
        </div>
      </section>
      <details className="activity-filters" open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
        <summary>{t('filterTransactions')}{activeFilterCount > 0 && <span className="activity-filter-count">{activeFilterCount}</span>}</summary>
        <div className="activity-filter-grid">
          <div className="activity-filter-field"><span>{t('dateRange')}</span><div className="activity-filter-range"><input aria-label={t('startDate')} type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /><input aria-label={t('endDate')} type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></div></div>
          <div className="activity-filter-field"><span>{t('amountRange')} · {reportCurrency}</span><div className="activity-filter-range"><input aria-label={t('minimumAmount')} type="number" min="0" step="0.01" placeholder={t('minimumAmount')} value={filters.minimum} onChange={(event) => setFilters((current) => ({ ...current, minimum: event.target.value }))} /><input aria-label={t('maximumAmount')} type="number" min="0" step="0.01" placeholder={t('maximumAmount')} value={filters.maximum} onChange={(event) => setFilters((current) => ({ ...current, maximum: event.target.value }))} /></div></div>
          <label className="activity-filter-field"><span>{t('filterBudget')}</span><select value={filters.budgetId} onChange={(event) => setFilters((current) => ({ ...current, budgetId: event.target.value }))}><option value="">{t('allBudgets')}</option>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name || categoryMap.get(budget.categoryId) || t('budgets')}</option>)}</select></label>
          <label className="activity-filter-field"><span>{t('filterAccount')}</span><select value={filters.accountId} onChange={(event) => setFilters((current) => ({ ...current, accountId: event.target.value }))}><option value="">{t('allAccounts')}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
        </div>
        {activeFilterCount > 0 && <button type="button" className="activity-filter-clear" onClick={() => setFilters({ startDate: '', endDate: '', minimum: '', maximum: '', budgetId: '', accountId: '' })}>{t('clearFilters')}</button>}
      </details>
      <TransactionPanel items={filteredItems} categories={categories} accounts={accounts} t={t} language={language} timeFormat={timeFormat} reportCurrency={reportCurrency} fxRates={fx.rates} onDelete={onDelete} onAdd={onAdd} onEdit={onEdit} emptyMessage={activeFilterCount ? t('noMatchingTransactions') : t('empty')} />
    </section>
  );
}

function TransactionPanel({ items, categories, accounts, t, language, timeFormat, reportCurrency, fxRates, onDelete, onAdd, onEdit, account, emptyMessage }) {
  return (
    <section className="panel transaction-panel">
      <div className="panel-heading">
        <div><div className="eyebrow">{t('activity')}</div><h2>{t('recent')}</h2></div>
        <div className="panel-actions"><span className="count-pill">{items.length} {t('transactionsCount')}</span><button className="add-transaction-button" onClick={onAdd} aria-label={t('newTransaction')} title={t('newTransaction')}>+</button></div>
      </div>
      {items.length ? <TransactionList items={items} categories={categories} accounts={accounts} t={t} language={language} timeFormat={timeFormat} reportCurrency={reportCurrency} fxRates={fxRates} onDelete={onDelete} onEdit={onEdit} /> : <div className="empty-state"><span className="empty-icon">?</span><p>{emptyMessage || (account ? t('empty') : t('chooseAccountFirst'))}</p></div>}
    </section>
  );
}

function TransactionForm({ account, accounts, categories, budgets, user, t, language, timeFormat, initialTransaction, openedAt, onSubmit, onDelete, onCancel, onCreateAccount, onCreateBudget }) {
  const [accountId, setAccountId] = useState(initialTransaction?.accountId ?? account?.id ?? accounts[0]?.id ?? '');
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [type, setType] = useState(initialTransaction?.type ?? 'expense');
  const [categoryId, setCategoryId] = useState(initialTransaction?.categoryId ?? '');
  const [transactionDate, setTransactionDate] = useState(initialTransaction?.transactionDate ?? openedAt?.transactionDate ?? today());
  const [addingBudget, setAddingBudget] = useState(false);
  const [noteImage, setNoteImage] = useState(initialTransaction?.noteImage ?? '');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const transactionTime = initialTransaction
    ? (initialTransaction.transactionTime || '')
    : (openedAt?.transactionTime || '');
  const selectedAccount = accounts.find((item) => item.id === accountId) ?? account ?? accounts[0] ?? null;
  const categoryMap = new Map(categories.map((item) => [item.id, item]));
  const choiceMap = new Map();
  ['none', 'other'].forEach((name) => {
    const item = categories.find((category) => category.name.trim().toLocaleLowerCase() === name);
    if (item) choiceMap.set(item.id, item);
  });
  budgets.forEach((budget) => {
    const id = budget.categoryId || budget.id;
    const source = categoryMap.get(id);
    if (id && !choiceMap.has(id)) choiceMap.set(id, { id, name: budget.name || source?.name || t('budgets'), type: 'expense', archived: false });
  });
  const choices = [...choiceMap.values()];
  const selectedCategoryId = choices.some((item) => item.id === categoryId) ? categoryId : choices[0]?.id;
  const weekday = transactionDate ? new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long' }).format(new Date(`${transactionDate}T12:00:00`)) : '';

  function chooseNoteImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError(t('imageTypeError'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setNoteImage(reader.result);
        setError('');
      }
    };
    reader.onerror = () => setError(t('imageTypeError'));
    reader.readAsDataURL(file);
  }

  async function submit(event) {
    event.preventDefault();
    if (!selectedAccount || working) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get('title') ?? '').trim();
    const amount = String(form.get('amount')).trim();
    const cents = moneyToCents(amount);
    if (!title) return setError(t('fieldRequired'));
    if (!cents || cents <= 0n) return setError(t('fieldRequired'));
    if (!selectedCategoryId) return setError(t('fieldRequired'));
    setError('');
    setWorking(true);
    try {
      let noteImagePath = '';
      if (user && noteImage.startsWith('data:')) {
        const upload = await apiRequest('/auth/transaction-images', {
          method: 'POST', body: JSON.stringify({ image: noteImage })
        });
        noteImagePath = upload.data.path;
      } else if (user) {
        noteImagePath = noteImage;
      }
      onSubmit({
        id: initialTransaction?.id ?? crypto.randomUUID(), type, amount: centsToAmount(cents), currency: selectedAccount.currency,
        accountId: selectedAccount.id, categoryId: selectedCategoryId,
        title,
        transactionDate, transactionTime, note: String(form.get('note') ?? '').trim(),
        ...(user && noteImagePath ? { noteImage: noteImagePath } : {})
      });
      formElement.reset();
      setNoteImage('');
    } catch (submitError) {
      setError(submitError.message || t('saveFailed'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="panel side-editor transaction-editor">
      <div className="editor-heading"><div className="editor-heading-title"><div className="eyebrow">{t('activity')}</div><h2>{initialTransaction ? t('editTransaction') : t('newTransaction')}</h2></div><div className="editor-heading-side"><div className="editor-time"><strong>{formatTransactionTime(transactionTime, timeFormat, language)}</strong></div></div></div>
      <button className="icon-button close-editor" onClick={onCancel} aria-label={t('close')}>×</button>
      {!selectedAccount ? <div className="empty-editor"><p>{t('chooseAccountFirst')}</p><button className="primary-button" type="button" onClick={() => setAddingAccount(true)}>{t('createFirstAccount')}</button>{addingAccount && <AccountForm embedded t={t} onCancel={() => setAddingAccount(false)} onSubmit={(newAccount) => { onCreateAccount(newAccount); setAccountId(newAccount.id); setAddingAccount(false); }} />}</div> : <>
        <div className="transaction-account-switcher">
          <button className="editing-account account-switch-trigger" type="button" aria-expanded={accountPickerOpen} onClick={() => { setAccountPickerOpen((current) => !current); setAddingAccount(false); }}>
            <span className="account-glyph">{selectedAccount.name.slice(0, 1).toUpperCase()}</span><span className="editing-account-copy"><strong>{selectedAccount.name}</strong><small>{selectedAccount.currency}</small></span><span className="account-switch-chevron" aria-hidden="true">{accountPickerOpen ? '⌃' : '⌄'}</span>
          </button>
          {accountPickerOpen && <div className="transaction-account-options" role="group" aria-label={t('account')}>
            {accounts.map((item) => <button key={item.id} type="button" className={`transaction-account-option ${item.id === selectedAccount.id ? 'selected' : ''}`} aria-pressed={item.id === selectedAccount.id} onClick={() => { setAccountId(item.id); setAccountPickerOpen(false); }}><strong>{item.name}</strong><small>{item.currency}</small></button>)}
            <button type="button" className="transaction-account-option transaction-account-add" aria-label={t('addAccount')} title={t('addAccount')} onClick={() => setAddingAccount(true)}>+</button>
          </div>}
          {addingAccount && <AccountForm embedded t={t} onCancel={() => setAddingAccount(false)} onSubmit={(newAccount) => { onCreateAccount(newAccount); setAccountId(newAccount.id); setAddingAccount(false); setAccountPickerOpen(false); }} />}
        </div>
        <form onSubmit={submit}>
          <label className="field"><span>{t('type')}</span><div className="segmented-control"><button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => { setType('expense'); setCategoryId(''); }}>{t('expenseType')}</button><button type="button" className={type === 'income' ? 'active' : ''} onClick={() => { setType('income'); setCategoryId(''); }}>{t('incomeType')}</button></div></label>
          <label className="field"><span>{t('titleLabel')}</span><input name="title" type="text" maxLength="100" defaultValue={initialTransaction?.title || initialTransaction?.note || categories.find((item) => item.id === initialTransaction?.categoryId)?.name || ''} required autoFocus /></label>
          <label className="field"><span>{t('amount')}</span><div className="transaction-amount-input"><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" defaultValue={initialTransaction?.amount ?? ''} required /><span>{selectedAccount.currency}</span></div></label>
          <div className="field"><span>{t('budgets')}</span><div className="category-chip-list" role="group" aria-label={t('budgets')}>
            {choices.map((item) => <button key={item.id} type="button" className={`category-chip ${selectedCategoryId === item.id ? 'selected' : ''}`} aria-pressed={selectedCategoryId === item.id} onClick={() => setCategoryId(item.id)}>{item.name}</button>)}
            <button type="button" className="category-chip category-add-chip" aria-label={t('addBudget')} title={t('addBudget')} onClick={() => setAddingBudget((current) => !current)}>+</button>
          </div>
          {addingBudget && <BudgetForm embedded categories={categories} budgets={budgets} defaultCurrency={selectedAccount.currency} t={t} onCancel={() => setAddingBudget(false)} onSubmit={(budget) => { onCreateBudget(budget); setCategoryId(budget.categoryId); setAddingBudget(false); }} />}
          </div>
          <div className="field"><span>{t('date')}</span><div className="transaction-date-time"><input name="transactionDate" type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} required /><span className="transaction-weekday">{weekday}</span></div></div>
          <label className="field"><span>{t('note')}</span><input name="note" type="text" maxLength="500" defaultValue={initialTransaction?.note ?? ''} /></label>
          {user && <div className="field note-image-field"><span>{t('noteImage')}</span><label className="secondary-button image-upload-button">{noteImage ? t('changeImage') : t('attachImage')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={chooseNoteImage} /></label>{noteImage && <div className="note-image-preview"><img src={noteImage} alt={t('noteImage')} /><button type="button" className="text-button" onClick={() => setNoteImage('')}>{t('removeImage')}</button></div>}</div>}
          {error && <div className="inline-error">{error}</div>}
          <div className="transaction-form-actions">
            <button className="primary-button" type="submit" disabled={working}>{working ? '?' : initialTransaction ? t('updateTransaction') : t('save')} <span>{initialTransaction ? '↻' : '+'}</span></button>
            {initialTransaction && <button className="delete-transaction-button" type="button" onClick={() => confirmDeleteTransaction(initialTransaction.id, t, onDelete)} aria-label={t('delete')} title={t('delete')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v6m4-6v6" /></svg><span>{t('delete')}</span></button>}
          </div>
        </form>
      </>}
    </section>
  );
}

function confirmDeleteTransaction(id, t, onDelete) {
  if (window.confirm(t('confirmDelete'))) onDelete(id);
}

function TransactionList({ items, categories, accounts = [], t, language, timeFormat, reportCurrency, fxRates, onDelete, onEdit }) {
  const [tooltipId, setTooltipId] = useState(null);
  const hoverTimer = useRef(null);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
  const accountMap = new Map(accounts.map((item) => [item.id, item.name]));
  const groups = items.reduce((result, item) => {
    const last = result[result.length - 1];
    if (last?.date === item.transactionDate) last.items.push(item);
    else result.push({ date: item.transactionDate, items: [item] });
    return result;
  }, []);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const formatGroupDate = (date) => new Intl.DateTimeFormat(locale, {
    weekday: 'long', month: 'short', day: 'numeric'
  }).format(new Date(`${date}T12:00:00`));
  function startTooltip(id) {
    clearTimeout(hoverTimer.current);
    setTooltipId(null);
    hoverTimer.current = setTimeout(() => setTooltipId(id), 550);
  }
  function stopTooltip() {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setTooltipId(null);
  }
  return (
    <div className="transaction-list">
      {groups.map((group) => <section className="transaction-date-group" key={group.date}>
        <h3>{formatGroupDate(group.date)}</h3>
        {group.items.map((item) => <article className={`transaction-row ${tooltipId === item.id ? 'tooltip-visible' : ''}`} key={item.id} role="button" tabIndex={0} onMouseEnter={() => startTooltip(item.id)} onMouseLeave={stopTooltip} onClick={() => onEdit(item)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onEdit(item); } }}>
          <span className={`transaction-symbol ${item.type}`}>{item.type === 'income' ? '+' : '\u2212'}</span>
          <div className="transaction-info">
            <strong>{item.title || item.note || categoryMap.get(item.categoryId) || '\u2014'}</strong>
            {item.noteImage && <img className="transaction-note-image" src={item.noteImage} alt={t('noteImage')} loading="lazy" />}
            <div className="transaction-meta-tags">
              {item.transactionTime && <span className="transaction-time-tag">{formatTransactionTime(item.transactionTime, timeFormat, language)}</span>}
              {accountMap.get(item.accountId) && <span className="transaction-tag account-tag">{accountMap.get(item.accountId)}</span>}
              <span className="transaction-tag">{categoryMap.get(item.categoryId) || '\u2014'}</span>
            </div>
          </div>
          <div className="transaction-value-group"><strong className={`transaction-value ${item.type}`}>{item.type === 'income' ? '+' : '\u2212'}{formatCents(moneyToCents(item.amount) ?? 0n, locale, item.currency)}</strong>{reportCurrency && item.currency !== reportCurrency && (() => {
            const converted = convertCents(moneyToCents(item.amount) ?? 0n, item.currency, reportCurrency, fxRates);
            return converted === null ? null : <small className="transaction-converted">≈ {item.type === 'income' ? '+' : '\u2212'}{formatCents(converted, locale, reportCurrency)}</small>;
          })()}</div>
          <button className="transaction-delete-button" onClick={(event) => { event.stopPropagation(); confirmDeleteTransaction(item.id, t, onDelete); }} aria-label={t('delete')} title={t('delete')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" /></svg></button>
          {tooltipId === item.id && <div className="transaction-tooltip" role="tooltip"><div className="transaction-tooltip-heading"><strong>{item.title || item.note || categoryMap.get(item.categoryId) || '\u2014'}</strong><b className={item.type}>{item.type === 'income' ? '+' : '\u2212'}{formatCents(moneyToCents(item.amount) ?? 0n, locale, item.currency)}</b></div><div className="transaction-tooltip-meta"><span>{formatGroupDate(item.transactionDate)}{item.transactionTime ? ` · ${formatTransactionTime(item.transactionTime, timeFormat, language)}` : ''}</span><span>{accountMap.get(item.accountId) || '\u2014'} · {categoryMap.get(item.categoryId) || '\u2014'}</span></div>{item.note && <p>{item.note}</p>}{item.noteImage && <img src={item.noteImage} alt="" loading="lazy" />}</div>}
        </article>)}
      </section>)}
    </div>
  );
}

function TrendChart({ account, points, t, locale }) {
  const width = 700;
  const height = 250;
  const left = 72;
  const right = 20;
  const top = 20;
  const bottom = 42;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const max = Math.max(1, ...points.flatMap((item) => [Number(item.income), Number(item.expense)]));
  const x = (index) => left + index * (chartWidth / (points.length - 1));
  const y = (amount) => top + chartHeight - (Number(amount) / max) * chartHeight;
  const smoothPath = (type) => {
    const coordinates = points.map((item, index) => ({ x: x(index), y: y(item[type]) }));
    if (coordinates.length === 0) return '';
    if (coordinates.length === 1) return `M ${coordinates[0].x} ${coordinates[0].y}`;
    const slopes = coordinates.slice(0, -1).map((point, index) =>
      (coordinates[index + 1].y - point.y) / (coordinates[index + 1].x - point.x));
    const tangents = coordinates.map((_, index) => {
      if (index === 0) return slopes[0];
      if (index === coordinates.length - 1) return slopes.at(-1);
      const previous = slopes[index - 1];
      const next = slopes[index];
      return previous * next <= 0 ? 0 : (2 * previous * next) / (previous + next);
    });

    for (let index = 0; index < slopes.length; index += 1) {
      const slope = slopes[index];
      if (slope === 0) {
        tangents[index] = 0;
        tangents[index + 1] = 0;
        continue;
      }
      const alpha = tangents[index] / slope;
      const beta = tangents[index + 1] / slope;
      const magnitude = alpha * alpha + beta * beta;
      if (magnitude > 9) {
        const scale = 3 / Math.sqrt(magnitude);
        tangents[index] = scale * alpha * slope;
        tangents[index + 1] = scale * beta * slope;
      }
    }

    return coordinates.slice(1).reduce((path, current, index) => {
      const previous = coordinates[index];
      const segmentWidth = current.x - previous.x;
      const control1 = { x: previous.x + segmentWidth / 3, y: previous.y + tangents[index] * segmentWidth / 3 };
      const control2 = { x: current.x - segmentWidth / 3, y: current.y - tangents[index + 1] * segmentWidth / 3 };
      const start = index === 0 ? `M ${previous.x} ${previous.y}` : path;
      return `${start} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${current.x} ${current.y}`;
    }, '');
  };
  const ticks = [0, max / 2, max];
  const formatTick = (cents) => formatCents(BigInt(Math.round(cents)), locale, account.currency);
  return (
    <section className="panel trend-panel">
      <div className="panel-heading"><div><div className="eyebrow">{t('fiveDayTrend')}</div><h2>{account.name}</h2></div><span className="trend-currency">{account.currency}</span></div>
      <div className="chart-legend"><span><i className="legend-income" />{t('income')}</span><span><i className="legend-expense" />{t('expense')}</span></div>
      <div className="chart-scroll">
        <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('fiveDayTrend')}>
          {ticks.map((tick, index) => {
            const yy = y(BigInt(Math.round(tick)));
            return <g key={index}><line x1={left} x2={width - right} y1={yy} y2={yy} className="chart-gridline" /><text x={left - 9} y={yy + 4} textAnchor="end" className="chart-axis-label">{formatTick(tick)}</text></g>;
          })}
          <path d={smoothPath('income')} className="chart-line income-line" />
          <path d={smoothPath('expense')} className="chart-line expense-line" />
          {points.map((point, index) => <g key={point.date}>
            <circle cx={x(index)} cy={y(point.income)} r="4" className="chart-point income-point" />
            <circle cx={x(index)} cy={y(point.expense)} r="4" className="chart-point expense-point" />
            <text x={x(index)} y={height - 12} textAnchor="middle" className="chart-axis-label">{point.label}</text>
          </g>)}
        </svg>
      </div>
    </section>
  );
}

function PageTitle({ title, detail }) {
  return <header className="page-heading"><div><div className="eyebrow">MINT FINANCE</div><h1>{title}</h1><p>{detail}</p></div></header>;
}

function PlaceholderPage({ title, detail }) {
  return <section className="page-section"><PageTitle title={title} detail={detail} /><div className="panel placeholder-panel"><span className="empty-icon">?</span><p>{detail}</p></div></section>;
}

function SettingsPage({ t, language, setLanguage, theme, setTheme, timeFormat, setTimeFormat }) {
  const [migrationNotice, setMigrationNotice] = useState(false);
  return <section className="page-section"><PageTitle title={t('settings')} detail={t('settingsHint')} />
    <div className="panel settings-panel">
      <label className="settings-row"><span><strong>{t('language')}</strong><small>{t('languageHint')}</small></span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="zh">??</option><option value="en">English</option></select></label>
      <label className="settings-row"><span><strong>{t('theme')}</strong><small>{t('themeHint')}</small></span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="light">{t('light')}</option><option value="dark">{t('dark')}</option></select></label>
      <label className="settings-row"><span><strong>{t('timeFormat')}</strong><small>{t('timeFormatHint')}</small></span><select value={timeFormat} onChange={(event) => setTimeFormat(event.target.value)}><option value="12">{t('hourFormat12')}</option><option value="24">{t('hourFormat24')}</option></select></label>
    </div>
    <article className="panel migration-option-card">
      <div><strong>{t('migrationOption')}</strong><p>{t('migrationOptionHint')}</p>{migrationNotice && <small className="migration-notice">{t('migrationComingSoon')}</small>}</div>
      <button className="secondary-button" onClick={() => setMigrationNotice(true)}>{t('migrationOption')}</button>
    </article>
  </section>;
}

function ProfileAvatar({ className, src, name }) {
  if (src) return <img className={`${className} profile-avatar-image`} src={src} alt={name} />;
  const initials = (name || 'Default User').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'DU';
  return <span className={className} aria-label={name}>{initials}</span>;
}

function ProfilePage({ user, anonymousProfile, onAnonymousProfileChange, onUserUpdated, t, onAuthenticated, onSignOut, migration, onMigration }) {
  const [mode, setMode] = useState('login');
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ username: user?.username ?? anonymousProfile.username, avatar: user?.avatar ?? anonymousProfile.avatar });
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    setProfileDraft({ username: user?.username ?? anonymousProfile.username, avatar: user?.avatar ?? anonymousProfile.avatar });
  }, [user, anonymousProfile.username, anonymousProfile.avatar]);

  function updateProfileField(key, value) {
    if (user) {
      setProfileDraft((current) => ({ ...current, [key]: value }));
      setProfileSaved(false);
    } else {
      onAnonymousProfileChange({ ...anonymousProfile, [key]: value });
    }
  }

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
      const body = { email, password };
      if (mode === 'register') {
        body.username = anonymousProfile.username.trim() || t('defaultUser');
        body.avatar = anonymousProfile.avatar;
      }
      const response = await apiRequest(`/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST', body: JSON.stringify(body)
      });
      await onAuthenticated(response.data);
      setAuthOpen(false);
    } catch (authError) {
      setError(authError.message || t('authFailed'));
    } finally {
      setWorking(false);
    }
  }

  function changeAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError(t('avatarTypeError'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateProfileField('avatar', reader.result);
        setError('');
      }
    };
    reader.onerror = () => setError(t('avatarTypeError'));
    reader.readAsDataURL(file);
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!profileDraft.username.trim()) return setError(t('fieldRequired'));
    setWorking(true);
    setError('');
    setProfileSaved(false);
    try {
      const response = await apiRequest('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ username: profileDraft.username, avatar: profileDraft.avatar })
      });
      onUserUpdated(response.data);
      setProfileSaved(true);
    } catch (profileError) {
      setError(profileError.message || t('saveFailed'));
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

  function openAuth(nextMode = 'login') {
    setMode(nextMode);
    setError('');
    setAuthOpen(true);
  }

  return (
    <section className="profile-view">
      <div className="page-heading profile-heading"><div><div className="eyebrow">{t('profile')}</div><h1>{t('security')}</h1><p>{t('profileIntro')}</p></div></div>
      {migration ? (
        <article className="panel migration-panel">
          <span className="migration-icon">?</span><div className="eyebrow">{t('migrationTitle')}</div><h2>{t('migrationTitle')}</h2><p>{t('migrationText')}</p>
          {error && <div className="inline-error">{error}</div>}
          <div className="migration-actions"><button className="primary-button" disabled={working} onClick={() => void migrate('merge')}>{t('merge')} <span>?</span></button><button className="secondary-button" disabled={working} onClick={() => void migrate('server')}>{t('keepServer')}</button></div>
        </article>
      ) : (
        <>
          <article className="panel profile-card">
            <div className="profile-identity">
              <div className="profile-avatar-wrap">
                <ProfileAvatar className="profile-avatar-large" src={user ? profileDraft.avatar : anonymousProfile.avatar} name={user ? profileDraft.username : anonymousProfile.username} />
                <label className="avatar-change-button">{t('changeAvatar')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={changeAvatar} aria-label={t('changeAvatar')} /></label>
              </div>
              <div className="profile-details">
                {user && <><p className="profile-email">{user.email}</p><small>{t('roleUser')} · {user.baseCurrency}</small></>}
                <label className="field"><span>{t('username')}</span><input type="text" maxLength="60" value={user ? profileDraft.username : anonymousProfile.username} onChange={(event) => updateProfileField('username', event.target.value)} /></label>
                <p className="profile-hint">{t(user ? 'profileAccountEditHint' : 'profileEditHint')}</p>
              </div>
            </div>
            {error && !authOpen && <div className="inline-error">{error}</div>}
            {user ? <div className="profile-signed-actions"><button className="primary-button" onClick={saveProfile} disabled={working}>{working ? '?' : t('saveProfile')}</button><button className="secondary-button" onClick={onSignOut}>{t('signOut')}</button></div> : (
              <div className="profile-auth-prompt"><p>{t('profileLoginPrompt')}</p><button className="primary-button" onClick={() => openAuth('login')}>{t('loginOrRegister')} <span>?</span></button></div>
            )}
            {profileSaved && <p className="profile-save-status">{t('profileSaved')}</p>}
          </article>
          {authOpen && <div className="auth-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setAuthOpen(false); }}>
            <section className="panel auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
              <div className="auth-modal-heading"><div><div className="eyebrow">{t('profile')}</div><h2 id="auth-modal-title">{mode === 'register' ? t('register') : t('signIn')}</h2><p>{t('authModalIntro')}</p></div><button className="icon-button auth-modal-close" type="button" onClick={() => setAuthOpen(false)} aria-label={t('close')} disabled={working}>x</button></div>
              <div className="auth-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>{t('signIn')}</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>{t('register')}</button></div>
              <form onSubmit={submit}>
                <label className="field"><span>{t('email')}</span><input name="email" type="email" autoComplete="email" required /></label>
                <label className="field"><span>{t('password')}</span><input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 12 : 1} maxLength="128" required /></label>
                {mode === 'register' && <label className="field"><span>{t('confirmPassword')}</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength="12" maxLength="128" required /></label>}
                {error && <div className="inline-error">{error}</div>}
                <button className="primary-button auth-submit" type="submit" disabled={working}>{working ? '?' : mode === 'register' ? t('register') : t('signIn')} <span>?</span></button>
              </form>
              <div className="auth-switch">{mode === 'register' ? t('already') : t('noAccount')} <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? t('switchLogin') : t('switchRegister')}</button></div>
              {!user && <div className="local-privacy"><span>i</span>{t('localNote')}</div>}
            </section>
          </div>}
        </>
      )}
    </section>
  );
}
