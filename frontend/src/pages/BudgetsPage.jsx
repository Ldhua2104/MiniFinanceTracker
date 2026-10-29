import { useState } from 'react';
import { convertCents } from '../api/exchange-rates.js';
import { centsToAmount, currencies, currencySymbol, formatCents, formatSignedCents, moneyToCents, today } from '../utils/finance.js';
import { budgetColors } from '../utils/colors.js';
import { PageTitle } from '../components/PageTitle.jsx';

export function BudgetPage({ budgets, transactions, categories, accounts, month, locale, t, fx, onAdd, onEdit }) {
    const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
    const visibleBudgets = budgets.filter((budget) => !budget.month || budget.month === month);
    const monthEnd = new Date(`${month}-01T12:00:00`);
    monthEnd.setMonth(monthEnd.getMonth() + 1, 0);
    const monthEndLabel = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(monthEnd);

    function relatedExpenses(budget) {
        return transactions.filter((transaction) => {
            if (transaction.type !== 'expense' || !transaction.transactionDate.startsWith(month)) return false;
            return budget.categoryId
                ? transaction.categoryId === budget.categoryId
                : categoryMap.get(transaction.categoryId)?.trim().toLocaleLowerCase() === budget.name?.trim().toLocaleLowerCase();
        });
    }

    function convertExpense(transaction, budget) {
        return convertCents(moneyToCents(transaction.amount) ?? 0n, transaction.currency, budget.currency, fx.rates);
    }

    function spentFor(budget) {
        let total = 0n;
        for (const transaction of relatedExpenses(budget)) {
            const converted = convertExpense(transaction, budget);
            if (converted === null) return null;
            total += converted;
        }
        return total;
    }

    function remainingHistoryFor(budget) {
        const dayCount = month === today().slice(0, 7) ? Number(today().slice(-2)) : monthEnd.getDate();
        const dailySpend = new Map();
        for (const transaction of relatedExpenses(budget)) {
            const amount = convertExpense(transaction, budget);
            if (amount === null) return null;
            dailySpend.set(transaction.transactionDate, (dailySpend.get(transaction.transactionDate) ?? 0n) + amount);
        }
        let spent = 0n;
        return Array.from({ length: dayCount }, (_, index) => {
            const day = index + 1;
            const date = `${month}-${String(day).padStart(2, '0')}`;
            spent += dailySpend.get(date) ?? 0n;
            return { date, day, remaining: (moneyToCents(budget.amount) ?? 0n) - spent };
        });
    }

    function accountSpendingFor(budget) {
        const totals = new Map();
        for (const transaction of relatedExpenses(budget)) {
            const amount = convertExpense(transaction, budget);
            if (amount === null) return null;
            const key = transaction.accountId || '__unassigned__';
            totals.set(key, (totals.get(key) ?? 0n) + amount);
        }
        return [...totals.entries()].map(([accountId, amount]) => ({
            accountId,
            amount,
            name: accounts.find((account) => account.id === accountId)?.name || t('unassignedAccount')
        })).sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0);
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
                        {visibleBudgets.map((budget) => <BudgetCard key={budget.id} budget={budget} spent={spentFor(budget)} remainingHistory={remainingHistoryFor(budget)} accountSpending={accountSpendingFor(budget)} recentExpenses={relatedExpenses(budget).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || (b.transactionTime ?? '').localeCompare(a.transactionTime ?? '')).slice(0, 5)} accounts={accounts} locale={locale} monthEndLabel={monthEndLabel} categoryMap={categoryMap} t={t} onEdit={() => onEdit(budget)} />)}
                    </div>
                ) : (
                    <div className="empty-state budget-empty"><span className="empty-icon">＋</span><p>{t('noBudgets')}</p><button className="primary-button" onClick={onAdd}>{t('addBudget')}</button></div>
                )}
            </section>
        </section>
    );
}

export function BudgetCard({ budget, spent, remainingHistory, accountSpending, recentExpenses, accounts, locale, monthEndLabel, categoryMap, t, onEdit }) {
    const [expanded, setExpanded] = useState(false);
    const limit = moneyToCents(budget.amount) ?? 0n;
    const remaining = spent === null ? null : limit - spent;
    const progress = spent !== null && limit > 0n ? Math.min(100, Number((spent * 10000n) / limit) / 100) : 0;
    const name = budget.name || categoryMap.get(budget.categoryId) || t('budgets');
    const accountTotal = accountSpending?.reduce((sum, item) => sum + item.amount, 0n) ?? 0n;
    const accountColors = ['#6f9278', '#7b91aa', '#b48a68', '#927fa8', '#bd7775', '#a69553'];
    const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
    return (
        <article className={`budget-card ${expanded ? 'expanded' : ''}`} style={{ '--budget-accent': budget.color || budgetColors[0] }}>
            <div className="budget-card-topline">
                <button className="budget-card-heading" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                    <strong>{name}</strong><span className="budget-currency">{budget.currency}</span><svg className="budget-expand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                <button className="budget-card-edit" type="button" onClick={onEdit} aria-label={t('editBudget')} title={t('editBudget')}>✎</button>
            </div>
            <button className="budget-card-summary" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                <span className="budget-amounts">
                    <span><small>{t('remainingBudget')}</small><strong>{remaining === null ? '—' : formatCents(remaining, locale, budget.currency)}</strong></span>
                    <span><small>{t('totalBudget')}</small><strong>{formatCents(limit, locale, budget.currency)}</strong></span>
                </span>
                <span className={`budget-progress ${spent === null ? 'unavailable' : ''}`} role="progressbar" aria-label={`${name} ${t('budgetProgress')}`} aria-valuenow={Math.round(progress)} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${progress}%` }} /></span>
                <span className="budget-card-footer"><span>{t('spentBudget')}: {spent === null ? '—' : formatCents(spent, locale, budget.currency)}</span><span>{t('monthEnds')} {monthEndLabel}</span></span>
            </button>
            {expanded && <section className="budget-detail" aria-label={`${name} ${t('budgetDetails')}`}>
                <div className="budget-detail-section">
                    <h3>{t('remainingBudgetTrend')}</h3>
                    {remainingHistory ? <BudgetRemainingChart points={remainingHistory} currency={budget.currency} locale={locale} label={t('remainingBudgetTrend')} /> : <p className="budget-detail-empty">{t('ratesUnavailable')}</p>}
                </div>
                <div className="budget-detail-section">
                    <h3>{t('accountSpendingShare')}</h3>
                    {accountSpending === null ? <p className="budget-detail-empty">{t('ratesUnavailable')}</p> : accountSpending.length === 0 || accountTotal === 0n ? <p className="budget-detail-empty">{t('noBudgetSpending')}</p> : <>
                        <div className="budget-account-bar" role="img" aria-label={t('accountSpendingShare')}>
                            {accountSpending.map((item, index) => <span key={item.accountId} style={{ width: `${Number((item.amount * 10000n) / accountTotal) / 100}%`, background: accountColors[index % accountColors.length] }} title={`${item.name}: ${formatCents(item.amount, locale, budget.currency)}`} />)}
                        </div>
                        <div className="budget-account-legend">{accountSpending.map((item, index) => <span key={item.accountId}><i style={{ background: accountColors[index % accountColors.length] }} /><strong>{item.name}</strong><small>{formatCents(item.amount, locale, budget.currency)} · {Number((item.amount * 10000n) / accountTotal) / 100}%</small></span>)}</div>
                    </>}
                </div>
                <div className="budget-detail-section">
                    <h3>{t('recentBudgetTransactions')}</h3>
                    {recentExpenses.length ? <div className="budget-recent-list">{recentExpenses.map((item) => <div className="budget-recent-row" key={item.id}><span><strong>{item.title || item.note || categoryMap.get(item.categoryId) || '—'}</strong><small>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(`${item.transactionDate}T12:00:00`))} · {accountNames.get(item.accountId) || t('unassignedAccount')}</small></span><b>{formatSignedCents(moneyToCents(item.amount) ?? 0n, locale, item.currency, '-')}</b></div>)}</div> : <p className="budget-detail-empty">{t('noBudgetSpending')}</p>}
                </div>
            </section>}
        </article>
    );
}

export function BudgetRemainingChart({ points, currency, locale, label }) {
    const width = 720;
    const height = 190;
    const left = 86;
    const right = 16;
    const top = 14;
    const bottom = 28;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = points.map((point) => Number(point.remaining));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
        const padding = Math.max(Math.abs(max) * 0.08, 100);
        min -= padding;
        max += padding;
    } else {
        const padding = (max - min) * 0.08;
        min -= padding;
        max += padding;
    }
    const x = (index) => left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotWidth);
    const y = (value) => top + ((max - value) / (max - min)) * plotHeight;
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(Number(point.remaining))}`).join(' ');
    const ticks = [max, (min + max) / 2, min];
    const formatTick = (value) => formatCents(BigInt(Math.round(value)), locale, currency);
    const middleIndex = Math.floor((points.length - 1) / 2);
    const labelIndices = [...new Set([0, middleIndex, points.length - 1])];
    return <div className="chart-scroll budget-remaining-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {ticks.map((tick, index) => { const yy = y(tick); return <g key={index}><line x1={left} x2={width - right} y1={yy} y2={yy} className="chart-gridline" /><text x={left - 8} y={yy + 4} textAnchor="end" className="chart-axis-label">{formatTick(tick)}</text></g>; })}
        <path d={path} className="budget-remaining-line" />
        {labelIndices.map((index) => <text key={index} x={x(index)} y={height - 9} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} className="chart-axis-label">{points[index].day}</text>)}
    </svg></div>;
}

export function BudgetForm({ initialBudget, draftBudget = null, categories, budgets, defaultCurrency = 'USD', t, onCancel, onSubmit, onDelete, embedded = false }) {
    const values = initialBudget ?? draftBudget;
    const [name, setName] = useState(values?.name ?? '');
    const [amount, setAmount] = useState(values?.amount ?? '100.00');
    const [currency, setCurrency] = useState(values?.currency || defaultCurrency);
    const [color, setColor] = useState(values?.color || budgetColors[0]);
    const [error, setError] = useState('');
    const editing = Boolean(initialBudget);

    function submit(event) {
        event?.preventDefault();
        const cleanName = name.trim();
        const cents = moneyToCents(amount.trim());
        if (!cleanName || cleanName.length > 60 || cents === null || cents <= 0n) return setError(t('fieldRequired'));
        const existingCategory = categories.find((category) => category.type === 'expense' && category.name.trim().toLocaleLowerCase() === cleanName.toLocaleLowerCase());
        const categoryId = initialBudget?.categoryId || draftBudget?.categoryId || existingCategory?.id || crypto.randomUUID();
        const duplicate = budgets.some((budget) => budget.id !== initialBudget?.id && (budget.categoryId === categoryId || budget.name?.trim().toLocaleLowerCase() === cleanName.toLocaleLowerCase()));
        if (duplicate) return setError(t('budgetAlreadyExists'));
        setError('');
        onSubmit({
            id: initialBudget?.id ?? draftBudget?.id ?? crypto.randomUUID(),
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
        <label className="field"><span>{t('monthlyAvailable')}</span><div className="budget-amount-input"><span>{currencySymbol(currency)}</span><input name="budgetAmount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div></label>
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
