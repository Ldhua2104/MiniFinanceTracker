import { useState } from 'react';
import { convertCents } from '../api/exchange-rates.js';
import { currencies, formatCents, formatSignedCents, moneyToCents } from '../utils/finance.js';
import { budgetColors } from '../utils/colors.js';
import { PageTitle } from '../components/PageTitle.jsx';
import { incomeSourceLabel } from '../utils/income.js';

export function IncomePage({ categories, transactions, accounts, month, locale, t, fx, reportCurrency, onReportCurrencyChange, onRefreshFx, onAddSource, onEditSource }) {
  const sources = categories.filter((category) => category.type === 'income');
  const accountColors = ['#6f9278', '#7b91aa', '#b48a68', '#927fa8', '#bd7775', '#a69553'];
  const accountColor = (accountId) => {
    const index = accounts.findIndex((account) => account.id === accountId);
    return accountColors[(index < 0 ? accounts.length : index) % accountColors.length];
  };
  const monthIncome = transactions.filter((transaction) => transaction.type === 'income' && transaction.transactionDate.startsWith(month));
  const sourceData = sources.map((source) => {
    const records = monthIncome.filter((transaction) => transaction.categoryId === source.id)
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || (b.transactionTime ?? '').localeCompare(a.transactionTime ?? ''));
    let total = 0n;
    let available = true;
    const accountTotals = new Map();
    const chartPoints = records.map((transaction) => {
      const amount = convertCents(moneyToCents(transaction.amount) ?? 0n, transaction.currency, reportCurrency, fx.rates);
      if (amount === null) {
        available = false;
        return { transaction, amount: 0n };
      }
      total += amount;
      const key = transaction.accountId || '__unassigned__';
      accountTotals.set(key, (accountTotals.get(key) ?? 0n) + amount);
      return { transaction, amount };
    });
    const accountBreakdown = [...accountTotals.entries()].map(([accountId, amount]) => ({
      accountId,
      amount,
      name: accounts.find((account) => account.id === accountId)?.name || t('unassignedAccount'),
      color: accountColor(accountId)
    })).sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0);
    return {
      source,
      records,
      total: available ? total : null,
      accountBreakdown: available ? accountBreakdown : null,
      chartPoints: available ? [...chartPoints].reverse() : null
    };
  });
  const ratesMessage = fx.status === 'loading' ? t('ratesLoading')
    : fx.status === 'error' ? t('ratesUnavailable')
      : fx.stale ? t('ratesCached')
        : fx.date ? `${t('ratesThrough')} ${fx.date}` : '';
  return <section className="page-section income-page">
    <PageTitle title={t('income')} detail={monthIncome.length ? t('incomePageIntro') : ''} />
    {!monthIncome.length ? <div className="income-empty-line"><span>{t('noIncomeForSource')}</span><button className="add-transaction-button" type="button" onClick={onAddSource} aria-label={t('addIncomeSource')} title={t('addIncomeSource')}>+</button></div> : <section className="panel income-panel">
      <div className="panel-heading">
        <div><div className="eyebrow">{t('income')}</div><h2>{t('incomeSources')}</h2></div>
        <div className="panel-actions"><span className="count-pill">{sources.length} {t('incomeSourcesCount')}</span><button className="add-transaction-button" type="button" onClick={onAddSource} aria-label={t('addIncomeSource')} title={t('addIncomeSource')}>+</button></div>
      </div>
      <div className="income-controls">
        <label><span>{t('summaryCurrency')}</span><select value={reportCurrency} onChange={(event) => onReportCurrencyChange(event.target.value)}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
        <div><span className="income-rates-status">{ratesMessage}</span><button type="button" className="income-refresh-button" onClick={onRefreshFx} disabled={fx.status === 'loading'} aria-label={t('refreshRates')} title={t('refreshRates')}>↻</button></div>
      </div>
      {sources.length ? <div className="income-source-list">{sourceData.map((data) => <IncomeSourceCard key={data.source.id} data={data} accounts={accounts} reportCurrency={reportCurrency} locale={locale} t={t} onEdit={() => onEditSource(data.source)} />)}</div>
        : <div className="empty-state income-empty"><p>{t('noIncomeSources')}</p></div>}
    </section>}
  </section>;
}

export function IncomeSourceForm({ initialSource, draftSource = null, categories, t, onCancel, onSubmit, onDelete, embedded = false }) {
  const values = initialSource ?? draftSource;
  const [title, setTitle] = useState(values?.name ?? '');
  const [color, setColor] = useState(values?.color || budgetColors[0]);
  const [error, setError] = useState('');
  const editing = Boolean(initialSource);

  function submit(event) {
    event?.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 50) return setError(t('fieldRequired'));
    const duplicate = categories.some((category) => category.type === 'income'
      && category.id !== initialSource?.id
      && category.name.trim().toLocaleLowerCase() === cleanTitle.toLocaleLowerCase());
    if (duplicate) return setError(t('incomeSourceExists'));
    setError('');
    onSubmit({ id: initialSource?.id ?? draftSource?.id ?? crypto.randomUUID(), name: cleanTitle, color, type: 'income', archived: false });
    if (embedded) setTitle('');
  }

  function deleteSource() {
    if (!initialSource || !window.confirm(t('confirmDeleteIncomeSource'))) return;
    if (onDelete(initialSource.id) === false) setError(t('incomeSourceDeleteRequiresReplacement'));
  }

  const fields = <>
    <label className="field"><span>{t('sourceTitle')}</span><input type="text" maxLength="50" value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus={!embedded} /></label>
    <div className="field"><span>{t('budgetCardColor')}</span><div className="budget-color-picker" role="group" aria-label={t('budgetCardColor')}>
      {budgetColors.map((value) => <button key={value} type="button" className={`budget-color-swatch ${color === value ? 'selected' : ''}`} style={{ '--swatch-color': value }} onClick={() => setColor(value)} aria-label={value} aria-pressed={color === value} />)}
    </div></div>
  </>;
  if (embedded) return <div className="inline-budget-editor inline-income-source-editor" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}>
    <div className="inline-budget-heading"><strong>{t('addIncomeSource')}</strong><button type="button" className="text-button" onClick={onCancel}>{t('cancel')}</button></div>
    {fields}{error && <div className="inline-error">{error}</div>}
    <button className="primary-button" type="button" onClick={() => submit()}>{t('saveIncomeSource')}</button>
  </div>;

  return <section className="panel side-editor income-source-editor">
    <div className="editor-heading"><div><div className="eyebrow">{t('incomeSources')}</div><h2>{editing ? t('editIncomeSource') : t('addIncomeSource')}</h2></div><button className="icon-button close-editor" type="button" onClick={onCancel} aria-label={t('close')}>×</button></div>
    <p className="editor-copy">{t('incomeSourceHint')}</p>
    <form onSubmit={submit}>{fields}{error && <div className="inline-error">{error}</div>}<div className="transaction-form-actions"><button className="primary-button" type="submit">{t('saveIncomeSource')}</button>{editing && <button className="delete-transaction-button" type="button" onClick={deleteSource}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l-1-13M10 11v5m4-5v5" /></svg><span>{t('delete')}</span></button>}</div></form>
  </section>;
}

export function IncomeSourceCard({ data, accounts, reportCurrency, locale, t, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const name = incomeSourceLabel(data.source.name, t);
  const total = data.total;
  const accountTotal = data.accountBreakdown?.reduce((sum, item) => sum + item.amount, 0n) ?? 0n;
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  return <article className={`income-source-card ${expanded ? 'expanded' : ''}`} style={{ '--income-source-accent': data.source.color || '#719a78' }}>
    <button type="button" className="income-source-edit" onClick={onEdit} aria-label={`${t('editIncomeSource')}: ${name}`} title={t('editIncomeSource')}>✎</button>
    <button type="button" className="income-source-summary" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <span className="income-source-heading"><strong>{name}</strong><span className="budget-currency">{reportCurrency}</span><svg className="budget-expand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></span>
      <span className="income-source-totals"><span><small>{t('incomeThisMonth')}</small><strong>{total === null ? '—' : formatSignedCents(total, locale, reportCurrency, '+')}</strong></span><span className="income-source-count"><small>{t('incomeRecordCount')}</small><strong>{data.records.length}</strong></span></span>
    </button>
    {expanded && <section className="income-source-detail" aria-label={`${name} ${t('incomeDetails')}`}>
      <div className="income-detail-section">
        <h3>{t('individualIncomeAmounts')}</h3>
        {data.chartPoints ? data.chartPoints.length ? <IncomeBarChart points={data.chartPoints} accounts={accounts} reportCurrency={reportCurrency} locale={locale} label={t('individualIncomeAmounts')} /> : <p className="budget-detail-empty">{t('noIncomeForSource')}</p> : <p className="budget-detail-empty">{t('ratesUnavailable')}</p>}
      </div>
      <div className="income-detail-section">
        <h3>{t('incomeByAccount')}</h3>
        {data.accountBreakdown === null ? <p className="budget-detail-empty">{t('ratesUnavailable')}</p> : data.accountBreakdown.length === 0 || accountTotal === 0n ? <p className="budget-detail-empty">{t('noIncomeForSource')}</p> : <>
          <div className="budget-account-bar" role="img" aria-label={t('incomeByAccount')}>
            {data.accountBreakdown.map((item) => <span key={item.accountId} style={{ width: `${Number((item.amount * 10000n) / accountTotal) / 100}%`, background: item.color }} title={`${item.name}: ${formatCents(item.amount, locale, reportCurrency)}`} />)}
          </div>
          <div className="budget-account-legend">{data.accountBreakdown.map((item) => <span key={item.accountId}><i style={{ background: item.color }} /><strong>{item.name}</strong><small>{formatCents(item.amount, locale, reportCurrency)} · {Number((item.amount * 10000n) / accountTotal) / 100}%</small></span>)}</div>
        </>}
      </div>
      <div className="income-detail-section">
        <h3>{t('recentIncomeRecords')}</h3>
        {data.records.length ? <div className="budget-recent-list">{data.records.slice(0, 5).map((item) => <div className="budget-recent-row" key={item.id}><span><strong>{item.title || item.note || name}</strong><small>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(`${item.transactionDate}T12:00:00`))} · {accountNames.get(item.accountId) || t('unassignedAccount')}</small></span><b className="income-record-amount">{formatSignedCents(moneyToCents(item.amount) ?? 0n, locale, item.currency, '+')}</b></div>)}</div> : <p className="budget-detail-empty">{t('noIncomeForSource')}</p>}
      </div>
    </section>}
  </article>;
}

export function IncomeBarChart({ points, accounts, reportCurrency, locale, label }) {
  const width = Math.max(640, points.length * 38 + 105);
  const height = 220;
  const left = 90;
  const right = 16;
  const top = 16;
  const bottom = 35;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = points.map((point) => Number(point.amount));
  const max = Math.max(1, ...values);
  const xStep = plotWidth / points.length;
  const barWidth = Math.min(26, xStep * 0.62);
  const x = (index) => left + xStep * index + xStep / 2;
  const y = (amount) => top + plotHeight - (amount / max) * plotHeight;
  const ticks = [max, max / 2, 0];
  const formatTick = (value) => formatCents(BigInt(Math.round(value)), locale, reportCurrency);
  const maxLabels = 8;
  const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));
  const labelIndices = points.map((_, index) => index).filter((index) => index % labelStep === 0 || index === points.length - 1);
  const accountColor = (accountId) => {
    const index = accounts.findIndex((account) => account.id === accountId);
    return ['#6f9278', '#7b91aa', '#b48a68', '#927fa8', '#bd7775', '#a69553'][(index < 0 ? accounts.length : index) % 6];
  };
  const dateLabel = (date) => new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
  return <div className="chart-scroll income-bars-chart"><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    {ticks.map((tick, index) => { const yy = y(tick); return <g key={index}><line x1={left} x2={width - right} y1={yy} y2={yy} className="chart-gridline" /><text x={left - 8} y={yy + 4} textAnchor="end" className="chart-axis-label">{formatTick(tick)}</text></g>; })}
    {points.map((point, index) => {
      const value = Number(point.amount);
      const topY = y(value);
      const transaction = point.transaction;
      const title = `${transaction.title || transaction.note || ''} · ${formatCents(point.amount, locale, reportCurrency)}`;
      return <g key={transaction.id}><rect x={x(index) - barWidth / 2} y={topY} width={barWidth} height={Math.max(1, top + plotHeight - topY)} rx="3" fill={accountColor(transaction.accountId)}><title>{title}</title></rect></g>;
    })}
    {labelIndices.map((index) => <text key={index} x={x(index)} y={height - 10} textAnchor="middle" className="chart-axis-label">{dateLabel(points[index].transaction.transactionDate)}</text>)}
  </svg></div>;
}
