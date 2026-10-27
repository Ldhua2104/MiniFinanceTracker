export const currencies = ['USD', 'EUR', 'CNY', 'GBP'];

export function moneyToCents(value) {
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

export function currencySymbol(currency) {
  return ({ USD: '$', EUR: '\u20ac', CNY: '\uffe5', GBP: '\u00a3' })[currency] ?? currency;
}

export function formatCents(cents, locale, currency) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  const formatter = new Intl.NumberFormat(locale, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${negative ? '-' : ''}${currencySymbol(currency)}${formatter.format(whole)}.${fraction}`;
}

export const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export function localTransactionTimestamp(date = new Date()) {
  return {
    transactionDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    transactionTime: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  };
}

export function formatTransactionTime(value, format, language) {
  if (!value) return '\u2014';
  const [hour, minute] = value.split(':').map(Number);
  if (format !== '12') return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const date = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

export function recentFiveDays() {
  const center = new Date(`${today()}T12:00:00`);
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(center);
    date.setDate(center.getDate() + index - 4);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
}

export function makeTrend(account, transactions, language) {
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

export function centsToAmount(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function formatSignedCents(cents, locale, currency, sign) {
  const isNegative = cents < 0n;
  const absolute = isNegative ? -cents : cents;
  return `${sign ?? (isNegative ? '-' : '+')}${formatCents(absolute, locale, currency)}`;
}
