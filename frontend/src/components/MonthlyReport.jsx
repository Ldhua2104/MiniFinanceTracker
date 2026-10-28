export function MonthlyReportCard({ report, language, t, onRefresh, refreshing = false }) {
  if (!report || report.status !== 'ok') return null;
  const formatAmount = (amount, currency) => new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    style: 'currency', currency, maximumFractionDigits: 2
  }).format(Number(amount) || 0);
  const renderPieGroups = (title, groups) => groups?.map((group) => {
    let offset = 0;
    const slices = group.points.map((point) => {
      const start = offset;
      offset += point.sharePercent;
      return `${point.color} ${start}% ${offset}%`;
    });
    return <section className="monthly-report-chart" key={`${title}-${group.currency}`}>
      <div className="monthly-report-chart-heading"><strong>{title}</strong><span>{formatAmount(group.total, group.currency)}</span></div>
      <div className="monthly-report-pie-layout">
        <div className="monthly-report-pie" role="img" aria-label={`${title} ${group.currency}`} style={{ background: `conic-gradient(${slices.join(', ') || 'var(--line) 0 100%'})` }} />
        <ul>{group.points.map((point) => <li key={point.id}><span className="monthly-report-legend-dot" style={{ backgroundColor: point.color }} /><span>{point.label}</span><strong>{formatAmount(point.value, group.currency)}</strong><small>{point.sharePercent}%</small></li>)}</ul>
      </div>
    </section>;
  });
  const renderTrends = report.dailyExpenseTrends?.map((trend) => {
    const values = trend.points.map((point) => point.amount);
    const maxValue = Math.max(1, ...values);
    const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${94 - (value / maxValue) * 82}`).join(' ');
    return <section className="monthly-report-trend" key={trend.currency}>
      <div className="monthly-report-chart-heading"><strong>{t('reportDailySpending')}</strong><span>{trend.currency}</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${t('reportDailySpending')} ${trend.currency}`}>
        <line x1="0" y1="94" x2="100" y2="94" />
        <polyline points={points} />
      </svg>
      <div className="monthly-report-trend-labels"><span>{trend.points[0]?.date.slice(-2)}</span><span>{trend.points.at(-1)?.date.slice(-2)}</span></div>
    </section>;
  });
  return <section className="monthly-report-card">
    <header><strong>{t('monthlyReport')}</strong><span>{report.month}</span>{onRefresh && <button className={`monthly-report-refresh ${refreshing ? 'is-refreshing' : ''}`} type="button" onClick={onRefresh} disabled={refreshing} aria-label={t('refreshReport')} title={t('refreshReport')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.9 16.5A8 8 0 0 0 19.1 18M4 17v-5h5M19.1 7.5A8 8 0 0 0 4.9 6" /></svg></button>}</header>
    <div className="monthly-report-totals">{report.currencySummaries.map((summary) => <div key={summary.currency}>
      <span>{summary.currency}</span><span>{t('reportIncome')} <strong>{formatAmount(summary.income, summary.currency)}</strong></span><span>{t('reportExpenses')} <strong>{formatAmount(summary.expense, summary.currency)}</strong></span><span>{t('reportNet')} <strong>{formatAmount(summary.net, summary.currency)}</strong></span>
    </div>)}</div>
    {renderPieGroups(t('reportExpenseShare'), report.expensePieCharts)}
    {renderPieGroups(t('reportIncomeShare'), report.incomePieCharts)}
    {renderTrends}
    {report.budgets?.length > 0 && <section className="monthly-report-list"><strong>{t('reportBudgets')}</strong>{report.budgets.map((budget) => <div key={budget.name}><span>{budget.name} · {budget.currency}</span><span>{t('reportSpent')} {formatAmount(budget.spent, budget.currency)} / {formatAmount(budget.monthlyLimit, budget.currency)}</span></div>)}</section>}
  </section>;
}
