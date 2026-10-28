import { useEffect, useMemo, useRef, useState } from 'react';
import { convertCents, fetchLatestFxRates } from '../api/exchange-rates.js';
import { centsToAmount, currencies, currencySymbol, formatCents, formatSignedCents, formatTransactionTime, localTransactionTimestamp, moneyToCents, today } from '../utils/finance.js';
import { makeMonthlyRecurrence } from '../data/recurrence.js';
import { PageTitle } from '../components/PageTitle.jsx';
import { MonthlyReportCard } from '../components/MonthlyReport.jsx';
import { incomeSourceLabel } from '../utils/income.js';
import { budgetColors } from '../utils/colors.js';
import { apiRequest } from '../api/client.js';
import { TransactionAiDraftModal } from '../components/TransactionAiDraftModal.jsx';

const MAX_TRANSACTION_IMAGES = 4;
const MAX_TRANSACTION_IMAGE_BYTES = 5 * 1024 * 1024;

function amountFromCents(value) {
  return Number(value) / 100;
}

function createMonthlyReport({ month, transactions, categories, budgets }) {
  const records = transactions.filter((item) => item.transactionDate.startsWith(month));
  if (!records.length) return { status: 'no_data', month };

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const budgetByCategory = new Map(budgets.map((budget) => [budget.categoryId, budget]));
  const totals = new Map();
  const expenseGroups = new Map();
  const incomeGroups = new Map();
  const daily = new Map();
  const budgetSpent = new Map();
  const getTotal = (currency) => {
    if (!totals.has(currency)) totals.set(currency, { income: 0n, expense: 0n, incomeCount: 0, expenseCount: 0 });
    return totals.get(currency);
  };
  for (const transaction of records) {
    const amount = moneyToCents(transaction.amount) ?? 0n;
    const total = getTotal(transaction.currency);
    total[transaction.type] += amount;
    total[`${transaction.type}Count`] += 1;
    const groups = transaction.type === 'expense' ? expenseGroups : incomeGroups;
    const groupKey = `${transaction.categoryId || '__other__'}:${transaction.currency}`;
    if (!groups.has(groupKey)) {
      const category = categoryById.get(transaction.categoryId);
      const budget = transaction.type === 'expense' ? budgetByCategory.get(transaction.categoryId) : null;
      groups.set(groupKey, { id: transaction.categoryId || '__other__', name: category?.name || 'Other', currency: transaction.currency, color: budget?.color || category?.color || budgetColors[groups.size % budgetColors.length], amount: 0n, count: 0 });
    }
    const group = groups.get(groupKey);
    group.amount += amount;
    group.count += 1;
    if (transaction.type === 'expense') {
      const dayKey = `${transaction.currency}:${transaction.transactionDate}`;
      daily.set(dayKey, (daily.get(dayKey) || 0n) + amount);
      const budgetKey = `${transaction.categoryId}:${transaction.currency}`;
      budgetSpent.set(budgetKey, (budgetSpent.get(budgetKey) || 0n) + amount);
    }
  }

  const toPieCharts = (groups) => {
    const byCurrency = new Map();
    for (const group of groups.values()) {
      if (!byCurrency.has(group.currency)) byCurrency.set(group.currency, []);
      byCurrency.get(group.currency).push(group);
    }
    return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, items]) => {
      const total = items.reduce((sum, item) => sum + item.amount, 0n);
      const points = items.sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0).map((item) => ({
        id: item.id,
        label: item.name,
        value: amountFromCents(item.amount),
        color: item.color,
        sharePercent: total ? Number((item.amount * 10000n) / total) / 100 : 0
      }));
      return { currency, total: amountFromCents(total), points };
    });
  };
  const expensePieCharts = toPieCharts(expenseGroups);
  const incomePieCharts = toPieCharts(incomeGroups);
  const monthLength = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const dayCount = month === today().slice(0, 7) ? Number(today().slice(-2)) : monthLength;
  const dailyExpenseTrends = [...totals.keys()].sort().map((currency) => ({
    currency,
    points: Array.from({ length: dayCount }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`;
      return { date, amount: amountFromCents(daily.get(`${currency}:${date}`) || 0n) };
    })
  })).filter((trend) => trend.points.some((point) => point.amount > 0));
  const budgetSummaries = budgets.map((budget) => {
    const spent = budgetSpent.get(`${budget.categoryId}:${budget.currency}`) || 0n;
    return { name: budget.name, currency: budget.currency, monthlyLimit: budget.amount, spent: (amountFromCents(spent)).toFixed(2) };
  });
  return {
    status: 'ok',
    month,
    currencySummaries: [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => ({ currency, income: amountFromCents(total.income), expense: amountFromCents(total.expense), net: amountFromCents(total.income - total.expense) })),
    expensePieCharts,
    incomePieCharts,
    dailyExpenseTrends,
    budgets: budgetSummaries
  };
}

export function ActivityPage({ items, allTransactions, categories, budgets, accounts, month, onMonthChange, locale, t, language, timeFormat, reportCurrency, onReportCurrencyChange, fx, onRefreshFx, onDelete, onAdd, onEdit, user }) {
  const [filters, setFilters] = useState({ type: '', startDate: '', endDate: '', minimum: '', maximum: '', budgetId: '', accountId: '', sourceId: '', autoAdd: '' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [monthlyReportOpen, setMonthlyReportOpen] = useState(false);
  const [serverReport, setServerReport] = useState(null);
  const [reportRefreshVersion, setReportRefreshVersion] = useState(0);
  const [reportRefreshing, setReportRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
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
  const incomeSources = categories.filter((category) => category.type === 'income');
  const minimum = filters.minimum ? moneyToCents(filters.minimum) : null;
  const maximum = filters.maximum ? moneyToCents(filters.maximum) : null;
  const filteredItems = items.filter((item) => {
    if (filters.type && item.type !== filters.type) return false;
    if (filters.startDate && item.transactionDate < filters.startDate) return false;
    if (filters.endDate && item.transactionDate > filters.endDate) return false;
    const isAutoAdded = Boolean(item.recurring?.enabled || item.recurrenceSourceId);
    if (filters.autoAdd === 'automatic' && !isAutoAdded) return false;
    if (filters.autoAdd === 'manual' && isAutoAdded) return false;
    if (filters.type !== 'income' && filters.accountId && item.accountId !== filters.accountId) return false;
    if (filters.type === 'income' && filters.sourceId && item.categoryId !== filters.sourceId) return false;
    if (filters.type !== 'income' && filters.budgetId) {
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
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const localMonthlyReport = useMemo(() => createMonthlyReport({ month, transactions: allTransactions, categories, budgets }), [month, allTransactions, categories, budgets, reportRefreshVersion]);
  const monthlyReport = serverReport?.month === month ? serverReport : localMonthlyReport;
  useEffect(() => {
    let active = true;
    if (!monthlyReportOpen || !user) {
      setServerReport(null);
      setReportRefreshing(false);
      return () => { active = false; };
    }
    setReportRefreshing(true);
    const finish = () => { if (active) setReportRefreshing(false); };
    apiRequest(`/auth/reports/monthly?month=${encodeURIComponent(month)}`)
      .then((response) => { if (active) setServerReport(response.data); })
      .catch(() => { if (active) setServerReport(null); })
      .finally(finish);
    return () => { active = false; };
  }, [monthlyReportOpen, month, user?.id, reportRefreshVersion]);
  useEffect(() => setCurrentPage(1), [month, filters]);
  useEffect(() => setCurrentPage((page) => Math.min(page, totalPages)), [totalPages]);

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
        <span className="activity-stat expense"><small>{t('expense')}</small><strong>{totalsAvailable ? formatSignedCents(expense, locale, reportCurrency, '-') : '—'}</strong></span>
        <span className="activity-stat income"><small>{t('income')}</small><strong>{totalsAvailable ? formatSignedCents(income, locale, reportCurrency, '+') : '—'}</strong></span>
        <span className={`activity-stat net ${net < 0n ? 'negative' : 'positive'}`}><small>{t('balance')}</small><strong>{totalsAvailable ? formatSignedCents(net, locale, reportCurrency) : '—'}</strong></span>
        </div>
      </section>
      <div className="activity-report-entry">
        <button className="secondary-button" type="button" aria-expanded={monthlyReportOpen} onClick={() => setMonthlyReportOpen((open) => !open)}>
          <span>{t('monthlyAnalysis')}</span><svg className={`budget-expand-mark ${monthlyReportOpen ? 'is-open' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      {monthlyReportOpen && (monthlyReport.status === 'ok'
        ? <MonthlyReportCard report={monthlyReport} language={language} t={t} refreshing={reportRefreshing} onRefresh={() => setReportRefreshVersion((version) => version + 1)} />
        : <section className="monthly-report-empty"><span>{t('monthlyReportNoData')}</span><button type="button" onClick={() => setReportRefreshVersion((version) => version + 1)} disabled={reportRefreshing}>{t('refreshReport')}</button></section>)}
      <details className="activity-filters" open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
        <summary>{t('filterTransactions')}{activeFilterCount > 0 && <span className="activity-filter-count">{activeFilterCount}</span>}<svg className="budget-expand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
        <div className="activity-filter-grid">
          <label className="activity-filter-field"><span>{t('transactionType')}</span><select value={filters.type} onChange={(event) => { const type = event.target.value; setFilters((current) => ({ ...current, type, budgetId: '', accountId: '', sourceId: '' })); }}><option value="">{t('allTransactionTypes')}</option><option value="expense">{t('expenseType')}</option><option value="income">{t('incomeType')}</option></select></label>
          <div className="activity-filter-field"><span>{t('dateRange')}</span><div className="activity-filter-range"><input aria-label={t('startDate')} type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /><input aria-label={t('endDate')} type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></div></div>
          <div className="activity-filter-field"><span>{t('amountRange')} · {reportCurrency}</span><div className="activity-filter-range"><input aria-label={t('minimumAmount')} type="number" min="0" step="0.01" placeholder={t('minimumAmount')} value={filters.minimum} onChange={(event) => setFilters((current) => ({ ...current, minimum: event.target.value }))} /><input aria-label={t('maximumAmount')} type="number" min="0" step="0.01" placeholder={t('maximumAmount')} value={filters.maximum} onChange={(event) => setFilters((current) => ({ ...current, maximum: event.target.value }))} /></div></div>
          {filters.type === 'income' && <label className="activity-filter-field"><span>{t('filterIncomeSource')}</span><select value={filters.sourceId} onChange={(event) => setFilters((current) => ({ ...current, sourceId: event.target.value }))}><option value="">{t('allSources')}</option>{incomeSources.map((source) => <option key={source.id} value={source.id}>{incomeSourceLabel(source.name, t)}</option>)}</select></label>}
          {filters.type !== 'income' && <><label className="activity-filter-field"><span>{t('filterBudget')}</span><select value={filters.budgetId} onChange={(event) => setFilters((current) => ({ ...current, budgetId: event.target.value }))}><option value="">{t('allBudgets')}</option>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name || categoryMap.get(budget.categoryId) || t('budgets')}</option>)}</select></label>
          <label className="activity-filter-field"><span>{t('filterAccount')}</span><select value={filters.accountId} onChange={(event) => setFilters((current) => ({ ...current, accountId: event.target.value }))}><option value="">{t('allAccounts')}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label></>}
          <label className="activity-filter-field"><span>{t('filterAutoAdd')}</span><select value={filters.autoAdd} onChange={(event) => setFilters((current) => ({ ...current, autoAdd: event.target.value }))}><option value="">{t('allRecurringTypes')}</option><option value="automatic">{t('recurringOnly')}</option><option value="manual">{t('nonRecurringOnly')}</option></select></label>
        </div>
        {activeFilterCount > 0 && <button type="button" className="activity-filter-clear" onClick={() => setFilters({ type: '', startDate: '', endDate: '', minimum: '', maximum: '', budgetId: '', accountId: '', sourceId: '', autoAdd: '' })}>{t('clearFilters')}</button>}
      </details>
      <TransactionPanel items={pageItems} count={filteredItems.length} categories={categories} accounts={accounts} t={t} language={language} timeFormat={timeFormat} reportCurrency={reportCurrency} fxRates={fx.rates} onDelete={onDelete} onAdd={onAdd} onEdit={onEdit} emptyMessage={activeFilterCount ? t('noMatchingTransactions') : t('empty')} />
      {totalPages > 1 && <nav className="activity-pagination" aria-label={t('pagination')}>
        <span>{t('showingTransactions').replace('{start}', String((currentPage - 1) * pageSize + 1)).replace('{end}', String(Math.min(currentPage * pageSize, filteredItems.length))).replace('{total}', String(filteredItems.length))}</span>
        <div className="activity-pagination-controls">
          <button className="secondary-button" type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>{t('previousPage')}</button>
          <span>{t('pageOf').replace('{current}', String(currentPage)).replace('{total}', String(totalPages))}</span>
          <button className="secondary-button" type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>{t('nextPage')}</button>
        </div>
      </nav>}
    </section>
  );
}

export function TransactionPanel({ items, count = items.length, categories, accounts, t, language, timeFormat, reportCurrency, fxRates, onDelete, onAdd, onEdit, account, emptyMessage }) {
  return (
    <section className="panel transaction-panel">
      <div className="panel-heading">
        <div><div className="eyebrow">{t('activity')}</div><h2>{t('recent')}</h2></div>
        <div className="panel-actions"><span className="count-pill">{count} {t('transactionsCount')}</span><button className="add-transaction-button" onClick={onAdd} aria-label={t('newTransaction')} title={t('newTransaction')}>+</button></div>
      </div>
      {items.length ? <TransactionList items={items} categories={categories} accounts={accounts} t={t} language={language} timeFormat={timeFormat} reportCurrency={reportCurrency} fxRates={fxRates} onDelete={onDelete} onEdit={onEdit} /> : <div className="empty-state"><span className="empty-icon">?</span><p>{emptyMessage || (account ? t('empty') : t('chooseAccountFirst'))}</p></div>}
    </section>
  );
}

export function TransactionForm({ account, accounts, categories, budgets, user, t, language, timeFormat, initialTransaction, openedAt, fx, onSubmit, onDelete, onCancel, onCreateAccount, onCreateBudget, onCreateIncomeSource }) {
  const [accountId, setAccountId] = useState(initialTransaction?.accountId ?? account?.id ?? accounts[0]?.id ?? '');
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [type, setType] = useState(initialTransaction?.type ?? 'expense');
  const [title, setTitle] = useState(initialTransaction?.title || initialTransaction?.note || categories.find((item) => item.id === initialTransaction?.categoryId)?.name || '');
  const [amount, setAmount] = useState(initialTransaction?.amount ?? '');
  const [note, setNote] = useState(initialTransaction?.note ?? '');
  const [categoryId, setCategoryId] = useState(initialTransaction?.categoryId ?? '');
  const [transactionDate, setTransactionDate] = useState(initialTransaction?.transactionDate ?? openedAt?.transactionDate ?? today());
  const [monthlyAuto, setMonthlyAuto] = useState(Boolean(initialTransaction?.recurring?.enabled));
  const [recurrenceSchedule, setRecurrenceSchedule] = useState(initialTransaction?.recurring?.schedule ?? 'month-start');
  const [recurrenceDay, setRecurrenceDay] = useState(String(initialTransaction?.recurring?.dayOfMonth ?? Number((initialTransaction?.transactionDate ?? openedAt?.transactionDate ?? today()).slice(-2))));
  const [recurrenceTime, setRecurrenceTime] = useState(initialTransaction?.recurring?.time ?? initialTransaction?.transactionTime ?? openedAt?.transactionTime ?? '09:00');
  const [addingBudget, setAddingBudget] = useState(false);
  const [addingIncomeSource, setAddingIncomeSource] = useState(false);
  const [noteImages, setNoteImages] = useState(initialTransaction?.noteImages ?? (initialTransaction?.noteImage ? [initialTransaction.noteImage] : []));
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  const [aiDraftNotice, setAiDraftNotice] = useState('');
  const [recognizedAmount, setRecognizedAmount] = useState(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const isGeneratedOccurrence = Boolean(initialTransaction?.recurrenceSourceId);
  const transactionTime = initialTransaction
    ? (initialTransaction.transactionTime || '')
    : (openedAt?.transactionTime || '');
  const selectedAccount = accounts.find((item) => item.id === accountId) ?? account ?? accounts[0] ?? null;
  const categoryMap = new Map(categories.map((item) => [item.id, item]));
  const choiceMap = new Map();
  if (type === 'income') {
    ['other', 'salary', 'bonus'].forEach((name) => {
      const item = categories.find((category) => category.type === 'income' && category.name.trim().toLocaleLowerCase() === name);
      if (item) choiceMap.set(item.id, item);
    });
    categories.filter((category) => category.type === 'income' && !category.archived).forEach((category) => choiceMap.set(category.id, category));
  } else {
    ['none', 'other'].forEach((name) => {
      const item = categories.find((category) => category.type === 'expense' && category.name.trim().toLocaleLowerCase() === name);
      if (item) choiceMap.set(item.id, item);
    });
    budgets.forEach((budget) => {
      const id = budget.categoryId || budget.id;
      const source = categoryMap.get(id);
      if (id && !choiceMap.has(id)) choiceMap.set(id, { id, name: budget.name || source?.name || t('budgets'), type: 'expense', archived: false });
    });
  }
  const choices = [...choiceMap.values()];
  const selectedCategoryId = choices.some((item) => item.id === categoryId) ? categoryId : choices[0]?.id;
  const weekday = transactionDate ? new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long' }).format(new Date(`${transactionDate}T12:00:00`)) : '';

  function chooseNoteImage(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length) return;
    if (noteImages.length + files.length > MAX_TRANSACTION_IMAGES) {
      setError(t('aiDraftImageLimit'));
      return;
    }
    if (files.some((file) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > MAX_TRANSACTION_IMAGE_BYTES)) {
      setError(t('imageTypeError'));
      return;
    }
    Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('invalid image'));
      reader.onerror = () => reject(new Error('invalid image'));
      reader.readAsDataURL(file);
    }))).then((images) => {
      setNoteImages((current) => [...current, ...images]);
      setError('');
    }).catch(() => setError(t('imageTypeError')));
  }

  function setSelectedAccount(nextAccount) {
    setAccountId(nextAccount.id);
    if (!recognizedAmount) return;
    if (!recognizedAmount.currency || recognizedAmount.currency === 'unknown') {
      setAmount('');
      setAiDraftNotice(t('aiDraftCurrencyUnknown'));
      return;
    }
    const cents = moneyToCents(recognizedAmount.amount);
    const converted = recognizedAmount.currency === nextAccount.currency
      ? cents
      : cents === null ? null : convertCents(cents, recognizedAmount.currency, nextAccount.currency, recognizedAmount.rates || fx?.rates);
    setAmount(converted === null ? '' : centsToAmount(converted));
    if (recognizedAmount.currency !== nextAccount.currency) {
      setAiDraftNotice(converted === null
        ? t('aiDraftCurrencyRateUnavailable').replace('{currency}', recognizedAmount.currency).replace('{accountCurrency}', nextAccount.currency)
        : t('aiDraftCurrencyConverted').replace('{original}', formatCents(cents, language === 'zh' ? 'zh-CN' : 'en-US', recognizedAmount.currency)).replace('{converted}', formatCents(converted, language === 'zh' ? 'zh-CN' : 'en-US', nextAccount.currency)).replace('{date}', `${recognizedAmount.rateDate || fx?.date || t('unknownDate')}${recognizedAmount.stale ? ` (${t('ratesCached')})` : ''}`));
    } else {
      setAiDraftNotice(recognizedAmount.categoryMatched ? t('aiDraftApplied') : t('aiDraftCategoryFallback'));
    }
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
    if (monthlyAuto && !window.confirm(t('confirmMonthlyAutoAdd'))) return;
    let recurring;
    if (monthlyAuto) {
      const recurringDay = recurrenceSchedule === 'same-day' ? Number(transactionDate.slice(-2)) : Number(recurrenceDay);
      const recurringTimeValue = recurrenceSchedule === 'custom' ? recurrenceTime : (transactionTime || '09:00');
      const sameRule = initialTransaction?.recurring?.enabled
        && initialTransaction.recurring.schedule === recurrenceSchedule
        && Number(initialTransaction.recurring.dayOfMonth || 0) === (['custom', 'same-day'].includes(recurrenceSchedule) ? recurringDay : 0)
        && initialTransaction.recurring.time === recurringTimeValue;
      recurring = sameRule
        ? initialTransaction.recurring
        : makeMonthlyRecurrence(recurrenceSchedule, recurringDay, recurringTimeValue, today());
      if (!recurring) return setError(t('fieldRequired'));
    } else if (initialTransaction?.recurring) {
      recurring = { ...initialTransaction.recurring, enabled: false };
    }
    setError('');
    setWorking(true);
    try {
      const savedNoteImages = [];
      if (user) {
        for (const image of noteImages) {
          if (image.startsWith('data:')) {
            const upload = await apiRequest('/auth/transaction-images', { method: 'POST', body: JSON.stringify({ image }) });
            savedNoteImages.push(upload.data.path);
          } else {
            savedNoteImages.push(image);
          }
        }
      }
      onSubmit({
        id: initialTransaction?.id ?? crypto.randomUUID(), type, amount: centsToAmount(cents), currency: selectedAccount.currency,
        accountId: selectedAccount.id, categoryId: selectedCategoryId,
        title,
        transactionDate, transactionTime, note: String(form.get('note') ?? '').trim(),
        ...(recurring ? { recurring } : {}),
        ...(initialTransaction?.recurrenceSourceId ? { recurrenceSourceId: initialTransaction.recurrenceSourceId, recurrenceMonth: initialTransaction.recurrenceMonth } : {}),
        ...(user && savedNoteImages.length ? { noteImages: savedNoteImages } : {})
      });
      formElement.reset();
      setNoteImages([]);
    } catch (submitError) {
      setError(submitError.message || t('saveFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function applyAiDraft(result) {
    const draft = result.draft;
    let exchange = fx;
    const recognizedCurrency = currencies.includes(draft.currency) ? draft.currency : '';
    if (recognizedCurrency && recognizedCurrency !== selectedAccount.currency && !exchange?.rates) {
      try { exchange = await fetchLatestFxRates(); } catch { /* Leave the amount blank when no rate is available. */ }
    }
    const nativeCents = moneyToCents(draft.amount);
    const convertedCents = !recognizedCurrency ? null : recognizedCurrency === selectedAccount.currency || nativeCents === null
      ? nativeCents
      : convertCents(nativeCents, recognizedCurrency, selectedAccount.currency, exchange?.rates);
    setTitle(draft.title);
    setAmount(convertedCents === null ? '' : centsToAmount(convertedCents));
    setType(draft.type);
    setCategoryId(draft.categoryId);
    setTransactionDate(draft.transactionDate || today());
    setNote(draft.note);
    setRecognizedAmount({ amount: draft.amount, currency: recognizedCurrency || 'unknown', categoryMatched: result.categoryMatched, rates: exchange?.rates, rateDate: exchange?.date, stale: exchange?.stale });
    setNoteImages((current) => [...current, ...result.addedImages]);
    setAiDraftNotice(!recognizedCurrency
      ? t('aiDraftCurrencyUnknown')
      : recognizedCurrency !== selectedAccount.currency
      ? convertedCents === null
        ? t('aiDraftCurrencyRateUnavailable').replace('{currency}', recognizedCurrency).replace('{accountCurrency}', selectedAccount.currency)
        : t('aiDraftCurrencyConverted').replace('{original}', formatCents(nativeCents, language === 'zh' ? 'zh-CN' : 'en-US', recognizedCurrency)).replace('{converted}', formatCents(convertedCents, language === 'zh' ? 'zh-CN' : 'en-US', selectedAccount.currency)).replace('{date}', `${exchange?.date || t('unknownDate')}${exchange?.stale ? ` (${t('ratesCached')})` : ''}`)
      : !result.categoryMatched ? t('aiDraftCategoryFallback') : t('aiDraftApplied'));
    setAiDraftOpen(false);
  }

  return (
    <section className="panel side-editor transaction-editor">
      <div className="editor-heading"><div className="editor-heading-title"><div className="eyebrow">{t('activity')}</div><h2>{initialTransaction ? t('editTransaction') : t('newTransaction')}</h2></div><div className="editor-heading-side"><div className="editor-time"><strong>{formatTransactionTime(transactionTime, timeFormat, language)}</strong></div></div></div>
      <button className="icon-button close-editor" onClick={onCancel} aria-label={t('close')}>×</button>
      {!selectedAccount ? <div className="empty-editor"><p>{t('chooseAccountFirst')}</p><button className="primary-button" type="button" onClick={() => setAddingAccount(true)}>{t('createFirstAccount')}</button>{addingAccount && <AccountForm embedded t={t} onCancel={() => setAddingAccount(false)} onSubmit={(newAccount) => { onCreateAccount(newAccount); setSelectedAccount(newAccount); setAddingAccount(false); }} />}</div> : <>
        <div className="transaction-account-switcher">
          <button className="editing-account account-switch-trigger" type="button" aria-expanded={accountPickerOpen} onClick={() => { setAccountPickerOpen((current) => !current); setAddingAccount(false); }}>
            <span className="account-glyph">{selectedAccount.name.slice(0, 1).toUpperCase()}</span><span className="editing-account-copy"><strong>{selectedAccount.name}</strong><small>{selectedAccount.currency}</small></span><svg className={`budget-expand-mark account-switch-chevron ${accountPickerOpen ? 'is-open' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {accountPickerOpen && <div className="transaction-account-options" role="group" aria-label={t('account')}>
            {accounts.map((item) => <button key={item.id} type="button" className={`transaction-account-option ${item.id === selectedAccount.id ? 'selected' : ''}`} aria-pressed={item.id === selectedAccount.id} onClick={() => { setSelectedAccount(item); setAccountPickerOpen(false); }}><strong>{item.name}</strong><small>{item.currency}</small></button>)}
            <button type="button" className="transaction-account-option transaction-account-add" aria-label={t('addAccount')} title={t('addAccount')} onClick={() => setAddingAccount(true)}>+</button>
          </div>}
          {addingAccount && <AccountForm embedded t={t} onCancel={() => setAddingAccount(false)} onSubmit={(newAccount) => { onCreateAccount(newAccount); setSelectedAccount(newAccount); setAddingAccount(false); setAccountPickerOpen(false); }} />}
        </div>
        <form onSubmit={submit}>
          <label className="field"><span>{t('type')}</span><div className="segmented-control"><button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => { setType('expense'); setCategoryId(''); setAddingBudget(false); setAddingIncomeSource(false); }}>{t('expenseType')}</button><button type="button" className={type === 'income' ? 'active' : ''} onClick={() => { setType('income'); setCategoryId(''); setAddingBudget(false); }}>{t('incomeType')}</button></div></label>
          <label className="field"><span>{t('titleLabel')}</span><small>{t('transactionTitleHint')}</small><input name="title" type="text" maxLength="100" value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus /></label>
          <label className="field"><span>{t('amount')}</span><div className="transaction-amount-input"><span>{currencySymbol(selectedAccount.currency)}</span><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value); setRecognizedAmount(null); setAiDraftNotice(''); }} required /></div></label>
          <div className="field"><span>{type === 'expense' ? t('budgets') : t('source')}</span><div className="category-chip-list" role="group" aria-label={type === 'expense' ? t('budgets') : t('source')}>
            {choices.map((item) => <button key={item.id} type="button" className={`category-chip ${selectedCategoryId === item.id ? 'selected' : ''}`} aria-pressed={selectedCategoryId === item.id} onClick={() => setCategoryId(item.id)}>{type === 'income' ? incomeSourceLabel(item.name, t) : item.name}</button>)}
            {type === 'expense' && <button type="button" className="category-chip category-add-chip" aria-label={t('addBudget')} title={t('addBudget')} onClick={() => setAddingBudget((current) => !current)}>+</button>}
            {type === 'income' && <button type="button" className="category-chip category-add-chip" aria-label={t('addIncomeSource')} title={t('addIncomeSource')} onClick={() => setAddingIncomeSource((current) => !current)}>+</button>}
          </div>
          {addingBudget && <BudgetForm embedded categories={categories} budgets={budgets} defaultCurrency={selectedAccount.currency} t={t} onCancel={() => setAddingBudget(false)} onSubmit={(budget) => { onCreateBudget(budget); setCategoryId(budget.categoryId); setAddingBudget(false); }} />}
          {addingIncomeSource && <IncomeSourceForm embedded categories={categories} t={t} onCancel={() => setAddingIncomeSource(false)} onSubmit={(source) => { onCreateIncomeSource(source); setCategoryId(source.id); setAddingIncomeSource(false); }} />}
          </div>
          <div className="field"><span>{t('date')}</span><div className="transaction-date-time"><input name="transactionDate" type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} required /><span className="transaction-weekday">{weekday}</span></div></div>
          {!isGeneratedOccurrence && <div className="field recurring-field">
            <label className="recurring-toggle"><input type="checkbox" checked={monthlyAuto} onChange={(event) => setMonthlyAuto(event.target.checked)} /><span>{t('monthlyAutoAdd')}</span></label>
            {monthlyAuto && <div className="recurring-options">
              <label className="field"><span>{t('recurrenceTiming')}</span><select value={recurrenceSchedule} onChange={(event) => setRecurrenceSchedule(event.target.value)}><option value="month-start">{t('monthStart')}</option><option value="month-end">{t('monthEnd')}</option><option value="same-day">{t('sameDayMonthly')}</option><option value="custom">{t('customTime')}</option></select></label>
              {recurrenceSchedule === 'custom' && <div className="recurring-custom-fields"><label className="field"><span>{t('dayOfMonth')}</span><input type="number" min="1" max="31" value={recurrenceDay} onChange={(event) => setRecurrenceDay(event.target.value)} required /></label><label className="field"><span>{t('recurrenceTime')}</span><input type="time" value={recurrenceTime} onChange={(event) => setRecurrenceTime(event.target.value)} required /></label></div>}
              <small>{t('monthlyAutoAddHint')}</small>
            </div>}
          </div>}
          <label className="field"><span>{t('note')}</span><small>{t('transactionNoteHint')}</small><textarea name="note" rows="3" maxLength="500" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          {user && <div className="field note-image-field"><span>{t('noteImage')}</span><label className="secondary-button image-upload-button">{noteImages.length ? t('addImage') : t('attachImage')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={chooseNoteImage} /></label>{noteImages.length > 0 && <div className="note-image-preview">{noteImages.map((image, index) => <div className="note-image-preview-item" key={`${index}-${image.slice(0, 30)}`}><img src={image} alt={t('noteImage')} /><button type="button" className="text-button" onClick={() => setNoteImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t('removeImage')}</button></div>)}</div>}<small>{t('aiDraftImageLimit')}</small></div>}
          {error && <div className="inline-error">{error}</div>}
          {aiDraftNotice && <div className="ai-draft-notice" role="status">{aiDraftNotice}</div>}
          <div className="transaction-form-actions">
            {user && !initialTransaction && <button className="secondary-button ai-draft-trigger" type="button" onClick={() => { setAiDraftNotice(''); setAiDraftOpen(true); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 13.8 9l6.4 2-6.4 2-1.8 6.5L10.2 13 3.8 11l6.4-2L12 2.5Z" /><path d="m19 15 .9 2.7 2.6.8-2.6.8L19 22l-.8-2.7-2.7-.8 2.7-.8L19 15Z" /></svg>{t('aiDraftButton')}</button>}
            <button className="primary-button" type="submit" disabled={working}>{working ? '?' : initialTransaction ? t('updateTransaction') : t('save')} <span>{initialTransaction ? '↻' : '+'}</span></button>
            {initialTransaction && <button className="delete-transaction-button" type="button" onClick={() => confirmDeleteTransaction(initialTransaction.id, t, onDelete)} aria-label={t('delete')} title={t('delete')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v6m4-6v6" /></svg><span>{t('delete')}</span></button>}
          </div>
        </form>
      </>}
      {aiDraftOpen && user && selectedAccount && <TransactionAiDraftModal noteImages={noteImages} account={selectedAccount} type={type} language={language} t={t} onClose={() => setAiDraftOpen(false)} onDraft={applyAiDraft} />}
    </section>
  );
}

export function confirmDeleteTransaction(id, t, onDelete) {
  if (window.confirm(t('confirmDelete'))) onDelete(id);
}

export function TransactionList({ items, categories, accounts = [], t, language, timeFormat, reportCurrency, fxRates, onDelete, onEdit }) {
  const [tooltipId, setTooltipId] = useState(null);
  const hoverTimer = useRef(null);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const categoryMap = new Map(categories.map((item) => [item.id, item]));
  const accountMap = new Map(accounts.map((item) => [item.id, item.name]));
  const transactionCategoryName = (item) => {
    const category = categoryMap.get(item.categoryId);
    return category ? (item.type === 'income' ? incomeSourceLabel(category.name, t) : category.name) : undefined;
  };
  const transactionImages = (item) => item.noteImages?.length ? item.noteImages : (item.noteImage ? [item.noteImage] : []);
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
          <div className="transaction-info">
            <strong>{item.title || item.note || transactionCategoryName(item) || '\u2014'}</strong>
            {transactionImages(item).length > 0 && <div className="transaction-note-images">{transactionImages(item).map((image, index) => <img className="transaction-note-image" key={`${item.id}-${index}`} src={image} alt={t('noteImage')} loading="lazy" />)}</div>}
            <div className="transaction-meta-tags">
              {item.transactionTime && <span className="transaction-time-tag">{formatTransactionTime(item.transactionTime, timeFormat, language)}</span>}
              {accountMap.get(item.accountId) && <span className="transaction-tag account-tag">{accountMap.get(item.accountId)}</span>}
              <span className="transaction-tag">{transactionCategoryName(item) || '\u2014'}</span>
              {(item.recurring?.enabled || item.recurrenceSourceId) && <span className="transaction-recurring-mark" title={t('monthlyAutoAdd')} aria-label={t('monthlyAutoAdd')}><span aria-hidden="true">{'\u21bb'}</span>{t('monthlyAutoAdd')}</span>}
            </div>
          </div>
          <div className="transaction-value-group"><strong className={`transaction-value ${item.type}`}>{formatSignedCents(moneyToCents(item.amount) ?? 0n, locale, item.currency, item.type === 'income' ? '+' : '-')}</strong>{reportCurrency && item.currency !== reportCurrency && (() => {
            const converted = convertCents(moneyToCents(item.amount) ?? 0n, item.currency, reportCurrency, fxRates);
            return converted === null ? null : <small className="transaction-converted">{formatSignedCents(converted, locale, reportCurrency, item.type === 'income' ? '+' : '-')}</small>;
          })()}</div>
          <button className="transaction-delete-button" onClick={(event) => { event.stopPropagation(); confirmDeleteTransaction(item.id, t, onDelete); }} aria-label={t('delete')} title={t('delete')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" /></svg></button>
          {tooltipId === item.id && <div className="transaction-tooltip" role="tooltip">
            <div className="transaction-tooltip-heading"><strong>{item.title || item.note || transactionCategoryName(item) || '\u2014'}</strong><b className={item.type}>{formatSignedCents(moneyToCents(item.amount) ?? 0n, locale, item.currency, item.type === 'income' ? '+' : '-')}</b></div>
            <div className="transaction-tooltip-meta">
              <span className="transaction-tooltip-meta-left">{formatGroupDate(item.transactionDate)}{item.transactionTime ? ` · ${formatTransactionTime(item.transactionTime, timeFormat, language)}` : ''}{(item.recurring?.enabled || item.recurrenceSourceId) && <span className="transaction-tooltip-recurring">↻ {t('monthlyAutoAdd')}</span>}</span>
              <span className="transaction-tooltip-meta-right">{accountMap.get(item.accountId) || '\u2014'} · {transactionCategoryName(item) || '\u2014'}</span>
            </div>
            {item.note && <p>{item.note}</p>}
            {transactionImages(item).length > 0 && <div className="transaction-tooltip-images">{transactionImages(item).map((image, index) => <img className="transaction-tooltip-image" key={`${item.id}-tooltip-${index}`} src={image} alt={t('noteImage')} loading="lazy" />)}</div>}
          </div>}
        </article>)}
      </section>)}
    </div>
  );
}
