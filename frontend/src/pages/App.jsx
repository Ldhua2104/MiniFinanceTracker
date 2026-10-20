import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
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

function recentFiveDays() {
  const center = new Date(`${today()}T12:00:00`);
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(center);
    date.setDate(center.getDate() + index - 2);
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
  const [page, setPage] = useState('overview');
  const [user, setUser] = useState(null);
  const [anonymousProfile, setAnonymousProfile] = useState(loadAnonymousProfile);
  const [role, setRole] = useState(APP_ROLES.anonymous);
  const [workspace, setWorkspace] = useState(emptyWorkspace());
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [migration, setMigration] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [rightEditor, setRightEditor] = useState(null);
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
  const monthTransactions = accountTransactions.filter((item) => item.transactionDate.startsWith(month)).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
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

  function addCategory(category) {
    setWorkspace((current) => current.categories.some((item) => item.id === category.id)
      ? current
      : { ...current, categories: [...current.categories, category] });
  }

  function deleteTransaction(id) {
    setWorkspace((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== id) }));
  }

  function addAccount(account) {
    setWorkspace((current) => ({ ...current, accounts: [...current.accounts, account] }));
    setSelectedAccountId(account.id);
    setRightEditor(null);
  }

  function openTransactionEditor() {
    setRightEditor('transaction');
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
            <SettingsPage t={t} language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} />
          ) : page === 'budgets' ? (
            <PlaceholderPage title={t('budgets')} detail={t('comingSoon')} />
          ) : page === 'activity' ? (
            <section className="page-section">
              <PageTitle title={t('activity')} detail={t('activityHint')} />
              <TransactionPanel items={monthTransactions} categories={workspace.categories} accounts={workspace.accounts} t={t} language={language} onDelete={deleteTransaction} onAdd={openTransactionEditor} account={selectedAccount} />
            </section>
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
              <TransactionPanel items={monthTransactions} categories={workspace.categories} accounts={workspace.accounts} t={t} language={language} onDelete={deleteTransaction} onAdd={openTransactionEditor} account={selectedAccount} />
            </>
          )}
        </main>

        <aside className={`right-rail ${rightEditor ? 'editing' : ''}`}>
          {rightEditor === 'account' ? (
            <AccountForm t={t} onCancel={() => setRightEditor(null)} onSubmit={addAccount} />
          ) : rightEditor === 'transaction' ? (
            <TransactionForm account={selectedAccount} categories={workspace.categories} user={user} t={t} onCancel={() => setRightEditor(null)} onSubmit={(transaction) => { addTransaction(transaction); setRightEditor(null); }} onCreateAccount={() => setRightEditor('account')} onCreateCategory={addCategory} />
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

function AccountForm({ t, onCancel, onSubmit }) {
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
  return (
    <section className="panel side-editor">
      <div className="editor-heading"><div><div className="eyebrow">{t('accounts')}</div><h2>{t('addAccount')}</h2></div><button className="icon-button close-editor" onClick={onCancel} aria-label={t('close')}>?</button></div>
      <p className="editor-copy">{t('accountSetupHint')}</p>
      <form onSubmit={submit}>
        <label className="field"><span>{t('accountName')}</span><input name="name" type="text" maxLength="60" autoFocus required /></label>
        <label className="field"><span>{t('openingBalance')}</span><input name="openingBalance" type="number" min="0" step="0.01" defaultValue="0.00" required /></label>
        <label className="field"><span>{t('currency')}</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label>
        {error && <div className="inline-error">{error}</div>}
        <button className="primary-button" type="submit">{t('saveAccount')} <span>+</span></button>
        <button className="text-button" type="button" onClick={onCancel}>{t('cancel')}</button>
      </form>
    </section>
  );
}

function TransactionPanel({ items, categories, accounts, t, language, onDelete, onAdd, account }) {
  return (
    <section className="panel transaction-panel">
      <div className="panel-heading">
        <div><div className="eyebrow">{t('activity')}</div><h2>{t('recent')}</h2></div>
        <div className="panel-actions"><span className="count-pill">{items.length} {t('transactionsCount')}</span><button className="add-transaction-button" onClick={onAdd} aria-label={t('newTransaction')} title={t('newTransaction')}>+</button></div>
      </div>
      {items.length ? <TransactionList items={items} categories={categories} accounts={accounts} t={t} language={language} onDelete={onDelete} /> : <div className="empty-state"><span className="empty-icon">?</span><p>{account ? t('empty') : t('chooseAccountFirst')}</p></div>}
    </section>
  );
}

function TransactionForm({ account, categories, user, t, onSubmit, onCancel, onCreateAccount, onCreateCategory }) {
  const [type, setType] = useState('expense');
  const [categoryId, setCategoryId] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [noteImage, setNoteImage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const choices = categories.filter((item) => item.type === type && !item.archived);
  const selectedCategoryId = choices.some((item) => item.id === categoryId) ? categoryId : choices[0]?.id;

  function createCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const existing = choices.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      setCategoryId(existing.id);
    } else {
      const category = { id: crypto.randomUUID(), name, type, archived: false };
      onCreateCategory(category);
      setCategoryId(category.id);
    }
    setNewCategoryName('');
    setAddingCategory(false);
  }

  function chooseNoteImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 1024 * 1024) {
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
    if (!account || working) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = String(form.get('amount')).trim();
    const cents = moneyToCents(amount);
    if (!cents || cents <= 0n) return setError(t('fieldRequired'));
    if (!selectedCategoryId) return setError(t('fieldRequired'));
    setError('');
    setWorking(true);
    try {
      let noteImagePath = '';
      if (user && noteImage) {
        const upload = await apiRequest('/auth/transaction-images', {
          method: 'POST', body: JSON.stringify({ image: noteImage })
        });
        noteImagePath = upload.data.path;
      }
      onSubmit({
        id: crypto.randomUUID(), type, amount: centsToAmount(cents), currency: account.currency,
        accountId: account.id, categoryId: selectedCategoryId,
        transactionDate: String(form.get('transactionDate')), note: String(form.get('note') ?? '').trim(),
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
    <section className="panel side-editor">
      <div className="editor-heading"><div><div className="eyebrow">{t('activity')}</div><h2>{t('newTransaction')}</h2></div><button className="icon-button close-editor" onClick={onCancel} aria-label={t('close')}>x</button></div>
      {!account ? <div className="empty-editor"><p>{t('chooseAccountFirst')}</p><button className="primary-button" onClick={onCreateAccount}>{t('createFirstAccount')}</button></div> : <>
        <div className="editing-account"><span className="account-glyph">{account.name.slice(0, 1).toUpperCase()}</span><div><strong>{account.name}</strong><small>{account.currency}</small></div></div>
        <form onSubmit={submit}>
          <label className="field"><span>{t('type')}</span><div className="segmented-control"><button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => { setType('expense'); setCategoryId(''); }}>{t('expenseType')}</button><button type="button" className={type === 'income' ? 'active' : ''} onClick={() => { setType('income'); setCategoryId(''); }}>{t('incomeType')}</button></div></label>
          <label className="field"><span>{t('amount')}</span><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
          <div className="field"><span>{t('category')}</span><div className="category-chip-list" role="group" aria-label={t('category')}>
            {choices.map((item) => <button key={item.id} type="button" className={`category-chip ${selectedCategoryId === item.id ? 'selected' : ''}`} aria-pressed={selectedCategoryId === item.id} onClick={() => setCategoryId(item.id)}>{item.name}</button>)}
            <button type="button" className="category-chip category-add-chip" aria-label={t('addCategory')} title={t('addCategory')} onClick={() => { setAddingCategory((current) => !current); setNewCategoryName(''); }}>+</button>
          </div>
          {addingCategory && <div className="category-add-form"><input type="text" maxLength="50" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createCategory(); } }} placeholder={t('categoryName')} aria-label={t('categoryName')} /><button type="button" className="secondary-button" onClick={createCategory}>{t('save')}</button></div>}
          </div>
          <label className="field"><span>{t('date')}</span><input name="transactionDate" type="date" defaultValue={today()} required /></label>
          <label className="field"><span>{t('note')}</span><input name="note" type="text" maxLength="500" /></label>
          {user && <div className="field note-image-field"><span>{t('noteImage')}</span><label className="secondary-button image-upload-button">{noteImage ? t('changeImage') : t('attachImage')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={chooseNoteImage} /></label>{noteImage && <div className="note-image-preview"><img src={noteImage} alt={t('noteImage')} /><button type="button" className="text-button" onClick={() => setNoteImage('')}>{t('removeImage')}</button></div>}</div>}
          {error && <div className="inline-error">{error}</div>}
          <button className="primary-button" type="submit" disabled={working}>{working ? '?' : t('save')} <span>+</span></button>
        </form>
      </>}
    </section>
  );
}

function TransactionList({ items, categories, accounts = [], t, language, onDelete }) {
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
  return (
    <div className="transaction-list">
      {groups.map((group) => <section className="transaction-date-group" key={group.date}>
        <h3>{formatGroupDate(group.date)}</h3>
        {group.items.map((item) => <article className="transaction-row" key={item.id}>
          <span className={`transaction-symbol ${item.type}`}>{item.type === 'income' ? '+' : '\u2212'}</span>
          <div className="transaction-info">
            <strong>{item.note || categoryMap.get(item.categoryId) || '\u2014'}</strong>
            {item.noteImage && <img className="transaction-note-image" src={item.noteImage} alt={t('noteImage')} loading="lazy" />}
            <div className="transaction-meta-tags">
              {accountMap.get(item.accountId) && <span className="transaction-tag account-tag">{accountMap.get(item.accountId)}</span>}
              <span className="transaction-tag">{categoryMap.get(item.categoryId) || '\u2014'}</span>
            </div>
          </div>
          <strong className={`transaction-value ${item.type}`}>{item.type === 'income' ? '+' : '\u2212'}{formatCents(moneyToCents(item.amount) ?? 0n, locale, item.currency)}</strong>
          <button className="icon-button" onClick={() => { if (window.confirm(t('confirmDelete'))) onDelete(item.id); }} aria-label={t('delete')} title={t('delete')}>x</button>
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
  const incomePoints = points.map((item, index) => `${x(index)},${y(item.income)}`).join(' ');
  const expensePoints = points.map((item, index) => `${x(index)},${y(item.expense)}`).join(' ');
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
          <polyline points={incomePoints} className="chart-line income-line" />
          <polyline points={expensePoints} className="chart-line expense-line" />
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

function SettingsPage({ t, language, setLanguage, theme, setTheme }) {
  const [migrationNotice, setMigrationNotice] = useState(false);
  return <section className="page-section"><PageTitle title={t('settings')} detail={t('settingsHint')} />
    <div className="panel settings-panel">
      <label className="settings-row"><span><strong>{t('language')}</strong><small>{t('languageHint')}</small></span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="zh">??</option><option value="en">English</option></select></label>
      <label className="settings-row"><span><strong>{t('theme')}</strong><small>{t('themeHint')}</small></span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="light">{t('light')}</option><option value="dark">{t('dark')}</option></select></label>
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
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 1024 * 1024) {
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
                {user && <><p className="profile-email">{user.email}</p><small>{t('roleUser')} ? {user.baseCurrency}</small></>}
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
