import Decimal from 'decimal.js';
import { Account, Budget, Category, IncomeSource, Transaction } from '../models/index.js';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CHART_COLORS = ['#557b63', '#7896a8', '#bd8968', '#8b7cab', '#b67478', '#aa944f', '#5f9e9a', '#8b9b68', '#cc9e62', '#687c9a'];

function currentMonthInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

function currentDateInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function resolveReportMonth(text, timezone = 'UTC', suggestedMonth) {
  const current = currentMonthInTimezone(timezone);
  const previousMonth = (month) => {
    const [year, monthNumber] = month.split('-').map(Number);
    return monthNumber === 1 ? `${year - 1}-12` : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
  };
  const source = String(text || '');
  if (/上个月|上個月|last\s+month/i.test(source)) return previousMonth(current);
  if (/本月|这个月|這個月|this\s+month/i.test(source)) return current;

  const explicitIsoMonth = source.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])\b/);
  const explicitChineseMonth = source.match(/((?:19|20)\d{2})\s*年\s*(0?[1-9]|1[0-2])\s*月/);
  const explicitMonth = explicitIsoMonth || explicitChineseMonth;
  if (explicitMonth) return `${explicitMonth[1]}-${String(Number(explicitMonth[2])).padStart(2, '0')}`;

  const monthOnly = source.match(/(?:^|\D)(1[0-2]|0?[1-9])\s*月(?:份)?/);
  if (monthOnly) return `${current.slice(0, 4)}-${String(Number(monthOnly[1])).padStart(2, '0')}`;
  if (suggestedMonth && MONTH_PATTERN.test(suggestedMonth)) return suggestedMonth;
  return current;
}

function monthDayCount(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function decimal(value) {
  try { return new Decimal(value || 0); } catch { return new Decimal(0); }
}

function amountString(value) {
  return value.toFixed(2);
}

function amountNumber(value) {
  return Number(value.toFixed(2));
}

function chartGroups(groups, key) {
  const byCurrency = new Map();
  for (const group of groups) {
    if (!byCurrency.has(group.currency)) byCurrency.set(group.currency, []);
    byCurrency.get(group.currency).push(group);
  }
  return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, items]) => {
    const total = items.reduce((sum, item) => sum.plus(item.amountDecimal), new Decimal(0));
    const points = items.map((item, index) => ({
      id: item.id,
      label: item.name,
      value: amountNumber(item.amountDecimal),
      color: item.color || CHART_COLORS[index % CHART_COLORS.length],
      sharePercent: total.isZero() ? 0 : Number(item.amountDecimal.div(total).mul(100).toFixed(2))
    }));
    return { currency, total: amountString(total), labels: points.map((point) => point.label), values: points.map((point) => point.value), colors: points.map((point) => point.color), points, [key]: amountNumber(total) };
  });
}

export async function getMonthlyReport(userId, { month, timezone = 'UTC' } = {}) {
  const reportMonth = month || currentMonthInTimezone(timezone);
  const currentDate = currentDateInTimezone(timezone);
  if (!MONTH_PATTERN.test(reportMonth)) throw Object.assign(new Error('Month must use YYYY-MM format'), { code: 'AI_TOOL_INVALID_ARGUMENTS' });
  const nextMonth = (() => {
    const [year, monthNumber] = reportMonth.split('-').map(Number);
    return monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
  })();

  const [accounts, expenseCategories, incomeSources, budgets, transactions] = await Promise.all([
    Account.find({ userId }).sort({ sortOrder: 1 }).select('-_id -userId -createdAt -updatedAt -sortOrder').lean(),
    Category.find({ userId, type: 'expense' }).select('-_id -userId -createdAt -updatedAt -sortOrder').lean(),
    IncomeSource.find({ userId }).select('-_id -userId -createdAt -updatedAt -sortOrder').lean(),
    Budget.find({ userId }).sort({ sortOrder: 1 }).select('-_id -userId -createdAt -updatedAt -sortOrder').lean(),
    Transaction.find({ userId, transactionDate: { $gte: `${reportMonth}-01`, $lt: `${nextMonth}-01` } })
      .select('-_id -userId -createdAt -updatedAt -sortOrder -noteImage').lean()
  ]);

  if (!transactions.length) return { status: 'no_data', month: reportMonth };

  const expenseCategoryById = new Map(expenseCategories.map((category) => [category.id, category]));
  const incomeSourceById = new Map(incomeSources.map((source) => [source.id, source]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const budgetByCategoryId = new Map(budgets.map((budget) => [budget.categoryId, budget]));
  const expenseGroups = new Map();
  const incomeGroups = new Map();
  const currencyTotals = new Map();
  const accountTotals = new Map();
  const dailyTotals = new Map();
  const budgetSpend = new Map();

  for (const transaction of transactions) {
    const currency = transaction.currency;
    const value = decimal(transaction.amount);
    if (!currencyTotals.has(currency)) currencyTotals.set(currency, { income: new Decimal(0), expense: new Decimal(0), incomeCount: 0, expenseCount: 0 });
    const currencyTotal = currencyTotals.get(currency);
    currencyTotal[transaction.type] = currencyTotal[transaction.type].plus(value);
    currencyTotal[`${transaction.type}Count`] += 1;

    const account = accountById.get(transaction.accountId);
    const accountKey = `${transaction.accountId || '__none__'}:${currency}`;
    if (!accountTotals.has(accountKey)) accountTotals.set(accountKey, { accountId: transaction.accountId || '', accountName: account?.name || 'Unassigned account', currency, income: new Decimal(0), expense: new Decimal(0), count: 0 });
    const accountTotal = accountTotals.get(accountKey);
    accountTotal[transaction.type] = accountTotal[transaction.type].plus(value);
    accountTotal.count += 1;

    if (transaction.type === 'expense') {
      const category = expenseCategoryById.get(transaction.categoryId);
      const budget = budgetByCategoryId.get(transaction.categoryId);
      const key = `${transaction.categoryId}:${currency}`;
      if (!expenseGroups.has(key)) expenseGroups.set(key, { id: transaction.categoryId, name: category?.name || 'Uncategorized', currency, color: budget?.color || category?.color || '', amountDecimal: new Decimal(0), count: 0 });
      const group = expenseGroups.get(key);
      group.amountDecimal = group.amountDecimal.plus(value);
      group.count += 1;
      const dateKey = `${currency}:${transaction.transactionDate}`;
      dailyTotals.set(dateKey, (dailyTotals.get(dateKey) || new Decimal(0)).plus(value));
      const budgetKey = `${transaction.categoryId}:${currency}`;
      budgetSpend.set(budgetKey, (budgetSpend.get(budgetKey) || new Decimal(0)).plus(value));
    } else {
      const source = incomeSourceById.get(transaction.categoryId);
      const key = `${transaction.categoryId}:${currency}`;
      if (!incomeGroups.has(key)) incomeGroups.set(key, { id: transaction.categoryId, name: source?.name || 'Uncategorized', currency, color: source?.color || '', amountDecimal: new Decimal(0), count: 0 });
      const group = incomeGroups.get(key);
      group.amountDecimal = group.amountDecimal.plus(value);
      group.count += 1;
    }
  }

  const expenseCategoryGroups = [...expenseGroups.values()].sort((a, b) => b.amountDecimal.comparedTo(a.amountDecimal));
  const incomeSourceGroups = [...incomeGroups.values()].sort((a, b) => b.amountDecimal.comparedTo(a.amountDecimal));
  const expensePieCharts = chartGroups(expenseCategoryGroups, 'expense');
  const incomePieCharts = chartGroups(incomeSourceGroups, 'income');
  const currencySummaries = [...currencyTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => ({
    currency,
    income: amountString(total.income),
    expense: amountString(total.expense),
    net: amountString(total.income.minus(total.expense)),
    incomeCount: total.incomeCount,
    expenseCount: total.expenseCount
  }));
  const budgetSummaries = budgets.map((budget) => {
    const spent = budgetSpend.get(`${budget.categoryId}:${budget.currency}`) || new Decimal(0);
    const otherCurrencySpending = [...budgetSpend.entries()]
      .filter(([key]) => key.startsWith(`${budget.categoryId}:`) && key !== `${budget.categoryId}:${budget.currency}`)
      .map(([key, amount]) => ({ currency: key.slice(budget.categoryId.length + 1), amount: amountString(amount) }));
    const limit = decimal(budget.amount);
    return {
      name: budget.name,
      currency: budget.currency,
      monthlyLimit: budget.amount,
      spent: amountString(spent),
      remaining: amountString(limit.minus(spent)),
      utilizationPercent: limit.isZero() ? 0 : Number(spent.div(limit).mul(100).toFixed(2)),
      otherCurrencySpending
    };
  });
  const trendDayCount = reportMonth === currentDate.slice(0, 7) ? Number(currentDate.slice(-2)) : monthDayCount(reportMonth);
  const dailyExpenseTrends = [...currencyTotals.keys()].sort().map((currency) => ({
    currency,
    points: Array.from({ length: trendDayCount }, (_, dayIndex) => {
      const date = `${reportMonth}-${String(dayIndex + 1).padStart(2, '0')}`;
      return { date, amount: amountNumber(dailyTotals.get(`${currency}:${date}`) || new Decimal(0)) };
    })
  })).filter((trend) => trend.points.some((point) => point.amount > 0));

  return {
    status: 'ok',
    month: reportMonth,
    currencySummaries,
    expenseCategories: expenseCategoryGroups.map(({ amountDecimal, ...item }) => ({ ...item, amount: amountString(amountDecimal), sharePercent: expensePieCharts.find((chart) => chart.currency === item.currency)?.points.find((point) => point.id === item.id)?.sharePercent || 0 })),
    incomeSources: incomeSourceGroups.map(({ amountDecimal, ...item }) => ({ ...item, amount: amountString(amountDecimal), sharePercent: incomePieCharts.find((chart) => chart.currency === item.currency)?.points.find((point) => point.id === item.id)?.sharePercent || 0 })),
    expensePieCharts,
    incomePieCharts,
    dailyExpenseTrends,
    accounts: [...accountTotals.values()].map((item) => ({
      accountId: item.accountId,
      name: item.accountName,
      currency: item.currency,
      income: amountString(item.income),
      expense: amountString(item.expense),
      net: amountString(item.income.minus(item.expense)),
      transactionCount: item.count
    })).sort((a, b) => a.name.localeCompare(b.name)),
    budgets: budgetSummaries,
    transactionCount: transactions.length
  };
}
