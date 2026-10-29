import { apiRequest } from '../api/client.js';

const STORAGE_KEY = 'mini-finance.anonymous-workspace.v1';
const PROFILE_STORAGE_KEY = 'mini-finance.anonymous-profile.v1';

export function defaultAnonymousProfile() {
  return { username: 'Default User', avatar: '' };
}

export function loadAnonymousProfile() {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!stored) return defaultAnonymousProfile();
    const profile = JSON.parse(stored);
    return {
      username: typeof profile.username === 'string' && profile.username.trim() ? profile.username : 'Default User',
      avatar: typeof profile.avatar === 'string' ? profile.avatar : ''
    };
  } catch {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    return defaultAnonymousProfile();
  }
}

export function saveAnonymousProfile(profile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function emptyFinanceData() {
  return { accounts: [], categories: [], transactions: [], budgets: [] };
}

export function makeStarterData() {
  const id = () => crypto.randomUUID();
  return {
    accounts: [],
    categories: [
      { id: id(), name: 'None', type: 'expense', archived: false },
      { id: id(), name: 'Other', type: 'expense', archived: false },
      { id: id(), name: 'Other', type: 'income', archived: false },
      { id: id(), name: 'Salary', type: 'income', archived: false },
      { id: id(), name: 'Bonus', type: 'income', archived: false }
    ],
    transactions: [],
    budgets: [],
  };
}

export function ensureFinanceDefaults(data) {
  const categories = [...(data.categories ?? [])];
  const defaults = [
    { name: 'None', type: 'expense' },
    { name: 'Other', type: 'expense' },
    { name: 'Other', type: 'income' },
    { name: 'Salary', type: 'income' },
    { name: 'Bonus', type: 'income' }
  ];
  for (const category of defaults) {
    const exists = categories.some((item) => item.type === category.type && item.name.trim().toLocaleLowerCase() === category.name.toLocaleLowerCase());
    if (!exists) categories.push({ id: crypto.randomUUID(), ...category, archived: false });
  }
  return {
    ...emptyFinanceData(),
    ...data,
    accounts: data.accounts ?? [],
    categories,
    transactions: (data.transactions ?? []).map((transaction) => {
      const { noteImage, ...rest } = transaction;
      return { ...rest, noteImages: Array.isArray(transaction.noteImages) ? transaction.noteImages : (noteImage ? [noteImage] : []) };
    })
  };
}

export function loadAnonymousData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return ensureFinanceDefaults({ ...emptyFinanceData(), ...JSON.parse(stored) });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  const initial = makeStarterData();
  saveAnonymousData(initial);
  return initial;
}

export function saveAnonymousData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...data,
    budgets: (data.budgets ?? []).map((budget) => Object.fromEntries(Object.entries(budget).filter(([key]) => key !== 'accountId')))
  }));
}

export function clearAnonymousData() {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasFinanceData(data) {
  const builtIn = { expense: new Set(['none', 'other']), income: new Set(['other', 'salary', 'bonus']) };
  const hasCustomCategories = (data?.categories ?? []).some((item) => !builtIn[item.type]?.has(item.name.trim().toLocaleLowerCase()));
  return Boolean(data?.accounts?.length || data?.transactions?.length || data?.budgets?.length || hasCustomCategories);
}

export const MIGRATION_GROUPS = Object.freeze(['accounts', 'budgets', 'incomeSources', 'transactions']);

export function migrationGroupCounts(data = {}) {
  const defaultIncomeSources = new Set(['other', 'salary', 'bonus']);
  const budgetCategoryIds = new Set((data.budgets ?? []).map((item) => item.categoryId));
  return {
    accounts: data.accounts?.length ?? 0,
    budgets: (data.budgets?.length ?? 0) + (data.categories ?? []).filter((item) => item.type === 'expense' && !['none', 'other'].includes(item.name.trim().toLocaleLowerCase()) && !budgetCategoryIds.has(item.id)).length,
    incomeSources: (data.categories ?? []).filter((item) => item.type === 'income' && !defaultIncomeSources.has(item.name.trim().toLocaleLowerCase())).length,
    transactions: data.transactions?.length ?? 0
  };
}

const normalizeName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const accountKey = (item) => `${normalizeName(item.name)}|${item.currency}`;
const categoryKey = (item) => `${item.type}|${normalizeName(item.name)}`;

function amountCents(value) {
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(String(value ?? ''));
  return match ? BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0') : 0n;
}

function centsAmount(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

function shouldImport(action) {
  return action === 'merge';
}

export function prepareFinanceMigration(serverData, localData, actions) {
  const remote = ensureFinanceDefaults(serverData);
  const local = ensureFinanceDefaults(localData);
  const result = {
    accounts: [...remote.accounts], categories: [...remote.categories], transactions: [...remote.transactions], budgets: [...remote.budgets]
  };
  const accountIds = new Map();
  const categoryIds = new Map();
  const remoteAccounts = new Map(result.accounts.map((item) => [accountKey(item), item]));

  for (const account of local.accounts) {
    const match = remoteAccounts.get(accountKey(account));
    if (match) accountIds.set(account.id, match.id);
    else if (shouldImport(actions.accounts)) {
      result.accounts.push(account);
      remoteAccounts.set(accountKey(account), account);
      accountIds.set(account.id, account.id);
    }
  }

  const remoteCategories = new Map(result.categories.map((item) => [categoryKey(item), item]));
  for (const category of local.categories) {
    const match = remoteCategories.get(categoryKey(category));
    const groupImports = category.type === 'income' ? shouldImport(actions.incomeSources) : shouldImport(actions.budgets);
    if (match) categoryIds.set(category.id, match.id);
    else if (groupImports) {
      result.categories.push(category);
      remoteCategories.set(categoryKey(category), category);
      categoryIds.set(category.id, category.id);
    }
  }

  if (shouldImport(actions.budgets)) {
    for (const budget of local.budgets) {
      const categoryId = categoryIds.get(budget.categoryId);
      if (!categoryId) throw new Error('migrationMissingBudgetCategory');
      const sameCategory = result.budgets.find((item) => item.categoryId === categoryId);
      const sameCurrencyName = result.budgets.find((item) => normalizeName(item.name) === normalizeName(budget.name) && item.currency === budget.currency);
      if (sameCategory && sameCategory.currency !== budget.currency) throw new Error('migrationBudgetCurrencyConflict');
      const match = sameCategory ?? sameCurrencyName;
      if (match) {
        const maxAmount = amountCents(match.amount) > amountCents(budget.amount) ? amountCents(match.amount) : amountCents(budget.amount);
        match.amount = centsAmount(maxAmount);
      } else {
        result.budgets.push(budget);
      }
    }
  }

  if (shouldImport(actions.transactions)) {
    const existingTransactions = new Set(result.transactions.map((item) => item.id));
    for (const transaction of local.transactions) {
      if (existingTransactions.has(transaction.id)) continue;
      const accountId = transaction.accountId == null ? null : accountIds.get(transaction.accountId) ?? result.accounts.find((item) => item.id === transaction.accountId)?.id;
      const categoryId = categoryIds.get(transaction.categoryId) ?? result.categories.find((item) => item.id === transaction.categoryId)?.id;
      if (accountId === undefined || !categoryId) throw new Error('migrationTransactionDependencies');
      result.transactions.push({ ...transaction, accountId, categoryId });
      existingTransactions.add(transaction.id);
    }
  }

  return ensureFinanceDefaults(result);
}

export function retainUnmigratedFinanceData(localData, actions) {
  const local = ensureFinanceDefaults(localData);
  const transactions = actions.transactions === 'keep' ? local.transactions : [];
  const transactionAccountIds = new Set(transactions.map((item) => item.accountId).filter(Boolean));
  const transactionCategoryIds = new Set(transactions.map((item) => item.categoryId).filter(Boolean));
  const accounts = local.accounts.filter((item) => actions.accounts === 'keep' || transactionAccountIds.has(item.id));
  const budgets = local.budgets.filter((item) => actions.budgets === 'keep' || transactionCategoryIds.has(item.categoryId));
  const categories = local.categories.filter((item) => {
    if (item.type === 'income') return actions.incomeSources === 'keep' || transactionCategoryIds.has(item.id);
    return actions.budgets === 'keep' || transactionCategoryIds.has(item.id) || budgets.some((budget) => budget.categoryId === item.id);
  });
  return { accounts, budgets, categories, transactions };
}

export async function loadServerData() {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await apiRequest('/auth/data');
      return ensureFinanceDefaults(response.data);
    } catch (error) {
      lastError = error;
      if ((error.status && error.status < 500) || attempt === 2) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function saveServerData(data, { fallbackTitle = 'Untitled transaction' } = {}) {
  const accountsById = new Map((data.accounts ?? []).map((item) => [item.id, item]));
  const categoriesById = new Map((data.categories ?? []).map((item) => [item.id, item]));
  const transactions = [];
  for (const [index, item] of (data.transactions ?? []).entries()) {
    const linkedAccount = accountsById.get(item.accountId);
    const linkedCategory = categoriesById.get(item.categoryId);
    const transactionType = item.type ?? linkedCategory?.type;
    const amount = item.amount == null ? undefined : String(item.amount);
    const currency = item.currency ?? linkedAccount?.currency;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : (typeof item.note === 'string' && item.note.trim() ? item.note.trim() : fallbackTitle);
    const transactionDate = typeof item.transactionDate === 'string' ? item.transactionDate.slice(0, 10) : (typeof item.date === 'string' ? item.date.slice(0, 10) : undefined);
    const required = { id: item.id, type: transactionType, amount, currency, title, categoryId: item.categoryId, transactionDate };
    const missing = Object.entries(required).filter(([, value]) => typeof value !== 'string' || !value.trim());
    if (missing.length) {
      const error = new Error('migrationInvalidTransaction');
      error.issues = missing.map(([field]) => ({ path: `transactions.${index}.${field}`, message: 'Required transaction data is missing' }));
      throw error;
    }
    const sourceImages = Array.isArray(item.noteImages) ? item.noteImages : (item.noteImage ? [item.noteImage] : []);
    if (sourceImages.length > 4) throw new Error('migrationTooManyImages');
    const noteImages = [];
    for (const image of sourceImages) {
      if (image.startsWith('data:')) {
        const uploaded = await apiRequest('/auth/transaction-images', { method: 'POST', body: JSON.stringify({ image }) });
        noteImages.push(uploaded.data.path);
      } else if (image) {
        noteImages.push(image);
      }
    }
    const transaction = {
      id: item.id, type: transactionType, amount, currency, title,
      categoryId: item.categoryId, transactionDate,
      transactionTime: item.transactionTime ?? '', note: item.note ?? '', accountId: item.accountId ?? null
    };
    if (noteImages.length) transaction.noteImages = noteImages;
    if (item.recurring) {
      const rule = item.recurring;
      transaction.recurring = Object.fromEntries(Object.entries({
        enabled: rule.enabled, schedule: rule.schedule, dayOfMonth: rule.dayOfMonth, time: rule.time, nextRunDate: rule.nextRunDate
      }).filter(([, value]) => value !== undefined));
    }
    if (item.recurrenceSourceId) transaction.recurrenceSourceId = item.recurrenceSourceId;
    if (item.recurrenceMonth) transaction.recurrenceMonth = item.recurrenceMonth;
    transactions.push(transaction);
  }
  const response = await apiRequest('/auth/data', {
    method: 'PUT',
    body: JSON.stringify({
      accounts: (data.accounts ?? []).map(({ id, name, note = '', currency, openingBalance }) => ({ id, name, note, currency, openingBalance })),
      categories: (data.categories ?? []).map(({ id, name, type, archived = false, color }) => ({ id, name, type, archived, ...(color ? { color } : {}) })),
      transactions,
      budgets: (data.budgets ?? []).map(({ id, name, categoryId, amount, currency, color }) => ({ id, name, categoryId, amount, currency, ...(color ? { color } : {}) }))
    })
  });
  return response.data;
}

