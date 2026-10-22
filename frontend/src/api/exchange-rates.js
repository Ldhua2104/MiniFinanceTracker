const API_URL = 'https://api.frankfurter.dev/v2/rates';
const CACHE_KEY = 'mini-finance.exchange-rates.v1';
const CACHE_TTL = 60 * 60 * 1000;

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return cached?.rates && cached?.fetchedAt ? cached : null;
  } catch {
    return null;
  }
}

function normalizeRates(payload) {
  const rates = { EUR: 1 };
  for (const entry of payload) {
    if (entry?.quote && Number.isFinite(Number(entry.rate)) && Number(entry.rate) > 0) {
      rates[entry.quote] = Number(entry.rate);
    }
  }
  return rates;
}

export async function fetchLatestFxRates({ force = false } = {}) {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return { ...cached, stale: false };
  }

  try {
    const response = await fetch(`${API_URL}?base=EUR&quotes=USD,CNY,GBP`);
    if (!response.ok) throw new Error(`Exchange rate request failed (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Unexpected exchange rate response');
    const rates = normalizeRates(payload);
    if (!['USD', 'CNY', 'GBP'].every((currency) => rates[currency])) throw new Error('Incomplete exchange rate response');
    const date = payload.reduce((latest, row) => row.date && (!latest || row.date < latest) ? row.date : latest, '');
    const result = { rates, date, fetchedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
    return { ...result, stale: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true };
    throw error;
  }
}

function decimalFraction(value) {
  const text = String(value).toLowerCase();
  const [coefficient, exponentText] = text.split('e');
  const exponent = Number(exponentText || 0);
  const [whole, fraction = ''] = coefficient.split('.');
  let numerator = BigInt(`${whole}${fraction}`);
  let denominator = 10n ** BigInt(fraction.length);
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
  return { numerator, denominator };
}

export function convertCents(cents, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return cents;
  const fromRate = rates?.[fromCurrency];
  const toRate = rates?.[toCurrency];
  if (!fromRate || !toRate) return null;

  const from = decimalFraction(fromRate);
  const to = decimalFraction(toRate);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const numerator = absolute * to.numerator * from.denominator;
  const denominator = to.denominator * from.numerator;
  const rounded = (numerator + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}
