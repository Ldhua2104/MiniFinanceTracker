import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { fetchLatestFxRates } from '../api/exchange-rates.js';
import { clearAnonymousData, emptyFinanceData, hasFinanceData, loadAnonymousProfile, loadAnonymousData, loadServerData, mergeFinanceData, saveAnonymousProfile, saveAnonymousData, saveServerData } from '../data/finance-data.js';
import { materializeDueRecurringTransactions } from '../data/recurrence.js';
import { migrateLocalAiSettings } from '../data/ai-settings.js';
import { detectLanguage, saveLanguage, translate } from '../i18n.js';
import { currencies, today, localTransactionTimestamp, makeTrend } from '../utils/finance.js';
import { AccountForm } from './AccountsPage.jsx';
import { BudgetPage, BudgetForm } from './BudgetsPage.jsx';
import { budgetColors } from '../utils/colors.js';
import { IncomePage, IncomeSourceForm } from './IncomePage.jsx';
import { ActivityPage, TransactionForm } from './TransactionsPage.jsx';
import { OverviewPage } from './OverviewPage.jsx';
import { AssistantPage, AssistantToolsPanel } from './AssistantPage.jsx';
import { SettingsPage } from './SettingsPage.jsx';
import { ProfileAvatar, ProfilePage } from './ProfilePage.jsx';

const APP_ROLES = Object.freeze({ anonymous: 'anonymous', user: 'user' });

export function App() {
  const [language, setLanguage] = useState(detectLanguage);
  const [theme, setTheme] = useState(() => localStorage.getItem('mini-finance.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [timeFormat, setTimeFormat] = useState(() => localStorage.getItem('mini-finance.time-format') === '12' ? '12' : '24');
  const [page, setPage] = useState('overview');
  const [user, setUser] = useState(null);
  const [anonymousProfile, setAnonymousProfile] = useState(loadAnonymousProfile);
  const [role, setRole] = useState(APP_ROLES.anonymous);
  const [financeData, setFinanceData] = useState(emptyFinanceData());
  const [financeDataReady, setFinanceDataReady] = useState(false);
  const [migration, setMigration] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [assistantToolsOpen, setAssistantToolsOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [rightEditor, setRightEditor] = useState(null);
  const [editingBudget, setEditingBudget] = useState(null);
  const [editingIncomeSource, setEditingIncomeSource] = useState(null);
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
        const remote = await loadServerData();
        try { await migrateLocalAiSettings(apiRequest); } catch { /* Keep encrypted local AI settings when migration is unavailable. */ }
        if (!active) return;
        setUser(account);
        setRole(APP_ROLES.user);
        setFinanceData(remote);
        setFinanceDataReady(true);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setRole(APP_ROLES.anonymous);
        setFinanceData(loadAnonymousData());
        setFinanceDataReady(true);
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
    if (rightEditor) setRightRailCollapsed(false);
  }, [rightEditor]);

  useEffect(() => {
    if (page !== 'assistant') setAssistantToolsOpen(false);
  }, [page]);

  useEffect(() => {
    if (page === 'assistant' && assistantToolsOpen) setRightRailCollapsed(false);
  }, [page, assistantToolsOpen]);

  useEffect(() => {
    if (page !== 'activity' && page !== 'budgets' && page !== 'income') return undefined;
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
    if (!financeDataReady) return undefined;
    if (role === 'anonymous') {
      saveAnonymousData(financeData);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSaveStatus('saving');
      saveServerData(financeData)
        .then(() => {
          setSaveStatus('saved');
        })
        .catch(() => setSaveStatus('failed'));
    }, 450);
    return () => clearTimeout(timer);
  }, [financeData, role, financeDataReady]);

  useEffect(() => {
    if (!financeDataReady) return undefined;
    const materialize = () => setFinanceData((current) => materializeDueRecurringTransactions(current, today()));
    materialize();
    const timer = window.setInterval(materialize, 60_000);
    return () => window.clearInterval(timer);
  }, [financeDataReady]);

  useEffect(() => {
    if (!financeData.accounts.length) setSelectedAccountId(null);
    else if (!financeData.accounts.some((account) => account.id === selectedAccountId)) setSelectedAccountId(financeData.accounts[0].id);
  }, [financeData.accounts, selectedAccountId]);

  const selectedAccount = financeData.accounts.find((account) => account.id === selectedAccountId) ?? null;
  const accountTransactions = selectedAccount ? financeData.transactions.filter((item) => item.accountId === selectedAccount.id) : [];
  const activityTransactions = financeData.transactions.filter((item) => item.transactionDate.startsWith(month)).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || (b.transactionTime ?? '').localeCompare(a.transactionTime ?? ''));
  const trend = useMemo(() => makeTrend(selectedAccount, accountTransactions, language), [selectedAccount, accountTransactions, language]);
  const currency = selectedAccount?.currency ?? user?.baseCurrency ?? 'USD';

  async function onAuthenticated(account) {
    const local = role === 'anonymous' ? financeData : emptyFinanceData();
    const remote = await loadServerData();
    try { await migrateLocalAiSettings(apiRequest); } catch { /* Keep encrypted local AI settings when migration is unavailable. */ }
    setUser(account);
    setRole(APP_ROLES.user);
    setPage('profile');
    if (hasFinanceData(local)) {
      setMigration({ local, remote });
      setFinanceDataReady(false);
    } else {
      setFinanceData(remote);
      setFinanceDataReady(true);
    }
  }

  async function chooseMigration(choice) {
    if (!migration) return;
    const result = choice === 'merge'
      ? await saveServerData(mergeFinanceData(migration.remote, migration.local))
      : migration.remote;
    if (choice === 'merge') clearAnonymousData();
    setFinanceData(result);
    setMigration(null);
    setFinanceDataReady(true);
  }

  async function signOut() {
    try { await apiRequest('/auth/logout', { method: 'POST' }); } catch { /* The local session still ends in this browser. */ }
    setUser(null);
    setRole(APP_ROLES.anonymous);
    setMigration(null);
    setFinanceData(loadAnonymousData());
    setFinanceDataReady(true);
    setSaveStatus('saved');
    setPage('overview');
  }

  function addTransaction(transaction) {
    setFinanceData((current) => ({ ...current, transactions: [transaction, ...current.transactions] }));
  }

  function updateTransaction(transaction) {
    setFinanceData((current) => ({ ...current, transactions: current.transactions.map((item) => item.id === transaction.id ? transaction : item) }));
  }

  function deleteTransaction(id) {
    setFinanceData((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== id) }));
  }

  function addAccount(account) {
    setFinanceData((current) => ({ ...current, accounts: [...current.accounts, account] }));
    setSelectedAccountId(account.id);
    setEditingAccount(null);
    setRightEditor(null);
  }

  function updateAccount(account) {
    setFinanceData((current) => ({ ...current, accounts: current.accounts.map((item) => item.id === account.id ? account : item) }));
    setRightEditor(null);
    setEditingAccount(null);
  }

  function deleteAccount(id) {
    setFinanceData((current) => ({
      ...current,
      accounts: current.accounts.filter((item) => item.id !== id),
      transactions: current.transactions.filter((item) => item.accountId !== id)
    }));
    setRightEditor(null);
    setEditingAccount(null);
  }

  function openAccountEditor(account = null) {
    setRightRailCollapsed(false);
    setEditingAccount(account);
    setRightEditor('account');
  }

  function addTransactionAccount(account) {
    setFinanceData((current) => ({ ...current, accounts: [...current.accounts, account] }));
  }

  function openBudgetEditor(budget = null) {
    setRightRailCollapsed(false);
    setEditingBudget(budget);
    setRightEditor('budget');
  }

  function saveBudget(budget, { closeEditor = true } = {}) {
    setFinanceData((current) => {
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

  function openIncomeSourceEditor(source = null) {
    setRightRailCollapsed(false);
    setEditingIncomeSource(source);
    setRightEditor('income-source');
  }

  function saveIncomeSource(source, { closeEditor = true } = {}) {
    setFinanceData((current) => {
      const saved = { ...source, color: source.color || budgetColors[0], type: 'income', archived: false };
      const exists = current.categories.some((item) => item.id === saved.id);
      return { ...current, categories: exists
        ? current.categories.map((item) => item.id === saved.id ? saved : item)
        : [...current.categories, saved] };
    });
    if (closeEditor) {
      setEditingIncomeSource(null);
      setRightEditor(null);
    }
  }

  function deleteIncomeSource(id) {
    const source = financeData.categories.find((item) => item.id === id && item.type === 'income');
    if (!source) return false;
    const hasTransactions = financeData.transactions.some((item) => item.type === 'income' && item.categoryId === id);
    const fallback = financeData.categories.find((item) => item.type === 'income' && item.id !== id && item.name.trim().toLocaleLowerCase() === 'other')
      ?? financeData.categories.find((item) => item.type === 'income' && item.id !== id);
    if (hasTransactions && !fallback) return false;
    setFinanceData((current) => ({
      ...current,
      categories: current.categories.filter((item) => item.id !== id),
      transactions: fallback
        ? current.transactions.map((item) => item.type === 'income' && item.categoryId === id ? { ...item, categoryId: fallback.id } : item)
        : current.transactions
    }));
    setEditingIncomeSource(null);
    setRightEditor(null);
    return true;
  }

  function deleteBudget(id) {
    setFinanceData((current) => ({ ...current, budgets: current.budgets.filter((item) => item.id !== id) }));
    setEditingBudget(null);
    setRightEditor(null);
  }

  function openTransactionEditor() {
    setRightRailCollapsed(false);
    setEditingTransaction(null);
    setEditorLoadVersion((version) => version + 1);
    setNewTransactionTimestamp(localTransactionTimestamp());
    setRightEditor('transaction');
  }

  function openTransactionForEdit(transaction) {
    setRightRailCollapsed(false);
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
              <option value="zh">&#x7B80;&#x4F53;&#x4E2D;&#x6587;</option><option value="en">English</option>
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

      <div className={`layout-grid ${rightRailCollapsed ? 'right-rail-collapsed' : ''}`}>
        <aside className="left-rail">
          <div className="rail-label">{t('overviewHint')}</div>
          <nav className="primary-nav" aria-label={t('overview')}>
            <button className={page === 'overview' ? 'selected' : ''} onClick={() => setPage('overview')}><span>⌂</span>{t('home')}</button>
            <button className={page === 'activity' ? 'selected' : ''} onClick={() => setPage('activity')}><span>↗</span>{t('activity')}</button>
            <button className={page === 'budgets' ? 'selected' : ''} onClick={() => setPage('budgets')}><span>◷</span>{t('budgets')}</button>
            <button className={page === 'income' ? 'selected' : ''} onClick={() => setPage('income')}><span>↑</span>{t('income')}</button>
            <button className={page === 'assistant' ? 'selected' : ''} onClick={() => setPage('assistant')}><span>✳</span>{t('assistant')}</button>
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
            <SettingsPage t={t} language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} timeFormat={timeFormat} setTimeFormat={setTimeFormat} user={user} />
          ) : page === 'budgets' ? (
            <BudgetPage budgets={financeData.budgets} transactions={financeData.transactions} categories={financeData.categories} accounts={financeData.accounts} month={today().slice(0, 7)} locale={language === 'zh' ? 'zh-CN' : 'en-US'} t={t} fx={fx} onAdd={() => openBudgetEditor()} onEdit={openBudgetEditor} />
          ) : page === 'income' ? (
            <IncomePage categories={financeData.categories} transactions={financeData.transactions} accounts={financeData.accounts} month={today().slice(0, 7)} locale={language === 'zh' ? 'zh-CN' : 'en-US'} t={t} fx={fx} reportCurrency={reportCurrency} onReportCurrencyChange={setReportCurrency} onRefreshFx={refreshFxRates} onAddSource={() => openIncomeSourceEditor()} onEditSource={openIncomeSourceEditor} />
          ) : page === 'activity' ? (
            <ActivityPage items={activityTransactions} allTransactions={financeData.transactions} categories={financeData.categories} budgets={financeData.budgets} accounts={financeData.accounts} month={month} onMonthChange={setMonth} locale={language === 'zh' ? 'zh-CN' : 'en-US'} t={t} language={language} timeFormat={timeFormat} reportCurrency={reportCurrency} onReportCurrencyChange={setReportCurrency} fx={fx} onRefreshFx={refreshFxRates} onDelete={deleteTransaction} onAdd={openTransactionEditor} onEdit={openTransactionForEdit} />
          ) : page === 'assistant' ? (
            <AssistantPage user={user} t={t} language={language} onOpenSettings={() => setPage('settings')} toolsOpen={assistantToolsOpen} onToggleTools={() => setAssistantToolsOpen((open) => !open)} />
          ) : <OverviewPage accounts={financeData.accounts} categories={financeData.categories} transactions={financeData.transactions} selectedAccount={selectedAccount} selectedAccountId={selectedAccountId} trend={trend} month={month} onMonthChange={setMonth} language={language} timeFormat={timeFormat} t={t} onSelectAccount={(account) => { setSelectedAccountId(account.id); openAccountEditor(account); }} onAddAccount={() => openAccountEditor()} onAddTransaction={openTransactionEditor} onDeleteTransaction={deleteTransaction} onEditTransaction={openTransactionForEdit} />}
        </main>

        <aside className={`right-rail ${rightEditor ? 'editing' : ''} ${page === 'assistant' && assistantToolsOpen ? 'assistant-tools-visible' : ''} ${rightRailCollapsed ? 'collapsed' : ''}`}>
          <div className="right-rail-toggle-row">
            <button className="right-rail-toggle" type="button" aria-expanded={!rightRailCollapsed} aria-label={t(rightRailCollapsed ? 'expandRightRail' : 'collapseRightRail')} title={t(rightRailCollapsed ? 'expandRightRail' : 'collapseRightRail')} onClick={() => setRightRailCollapsed((collapsed) => !collapsed)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={rightRailCollapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} /></svg>
              <span className="sr-only">{t(rightRailCollapsed ? 'expandRightRail' : 'collapseRightRail')}</span>
            </button>
          </div>
          <div className="right-rail-content">
          {page === 'assistant' && assistantToolsOpen ? (
            <AssistantToolsPanel t={t} />
          ) : rightEditor === 'account' ? (
            <AccountForm key={editingAccount?.id ?? 'new-account'} t={t} initialAccount={editingAccount} onCancel={() => { setRightEditor(null); setEditingAccount(null); }} onSubmit={editingAccount ? updateAccount : addAccount} onDelete={deleteAccount} />
          ) : rightEditor === 'budget' ? (
            <BudgetForm key={editingBudget?.id ?? 'new-budget'} initialBudget={editingBudget ? { ...editingBudget, name: editingBudget.name || financeData.categories.find((category) => category.id === editingBudget.categoryId)?.name || '' } : null} categories={financeData.categories} budgets={financeData.budgets} defaultCurrency={financeData.accounts.find((account) => account.id === selectedAccountId)?.currency || 'USD'} t={t} onCancel={() => { setEditingBudget(null); setRightEditor(null); }} onSubmit={saveBudget} onDelete={deleteBudget} />
          ) : rightEditor === 'income-source' ? (
            <IncomeSourceForm key={editingIncomeSource?.id ?? 'new-income-source'} initialSource={editingIncomeSource} categories={financeData.categories} t={t} onCancel={() => { setEditingIncomeSource(null); setRightEditor(null); }} onSubmit={saveIncomeSource} onDelete={deleteIncomeSource} />
          ) : rightEditor === 'transaction' || rightEditor === 'edit-transaction' ? (
            <TransactionForm key={`${editingTransaction?.id ?? 'new'}-${editorLoadVersion}`} account={selectedAccount} accounts={financeData.accounts} categories={financeData.categories} budgets={financeData.budgets} user={user} t={t} language={language} timeFormat={timeFormat} initialTransaction={editingTransaction} openedAt={newTransactionTimestamp} onCancel={() => { setRightEditor(null); setEditingTransaction(null); }} onSubmit={submitTransaction} onDelete={removeTransaction} onCreateAccount={addTransactionAccount} onCreateBudget={(budget) => saveBudget(budget, { closeEditor: false })} onCreateIncomeSource={(source) => saveIncomeSource(source, { closeEditor: false })} />
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
          </div>
        </aside>
      </div>

      <footer className="app-footer"><span>{t('footer')}</span><span>© MINT FINANCE</span></footer>
    </div>
  );
}
