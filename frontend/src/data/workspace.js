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

export function emptyWorkspace() {
  return { accounts: [], categories: [], transactions: [], budgets: [], revision: 0 };
}

export function makeStarterWorkspace() {
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
    revision: 0
  };
}

export function ensureStarterCategories(workspace) {
  const categories = [...(workspace.categories ?? [])];
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
    ...emptyWorkspace(),
    ...workspace,
    accounts: workspace.accounts ?? [],
    categories
  };
}

export function loadAnonymousWorkspace() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return ensureStarterCategories({ ...emptyWorkspace(), ...JSON.parse(stored) });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  const initial = makeStarterWorkspace();
  saveAnonymousWorkspace(initial);
  return initial;
}

export function saveAnonymousWorkspace(workspace) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...workspace,
    budgets: (workspace.budgets ?? []).map((budget) => Object.fromEntries(Object.entries(budget).filter(([key]) => key !== 'accountId')))
  }));
}

export function clearAnonymousWorkspace() {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasWorkspaceData(workspace) {
  return Boolean(workspace?.transactions?.length || workspace?.budgets?.length);
}

export function mergeWorkspaces(serverData, localData) {
  const mergeById = (remote = [], local = []) => {
    const result = new Map(remote.map((item) => [item.id, item]));
    for (const item of local) if (!result.has(item.id)) result.set(item.id, item);
    return [...result.values()];
  };
  return {
    accounts: mergeById(serverData.accounts, localData.accounts),
    categories: mergeById(serverData.categories, localData.categories),
    transactions: mergeById(serverData.transactions, localData.transactions),
    budgets: mergeById(serverData.budgets, localData.budgets),
    revision: serverData.revision ?? 0
  };
}

export async function loadServerWorkspace() {
  const response = await apiRequest('/auth/workspace');
  return ensureStarterCategories(response.data);
}

export async function saveServerWorkspace(workspace) {
  const response = await apiRequest('/auth/workspace', {
    method: 'PUT',
    body: JSON.stringify({
      accounts: workspace.accounts ?? [],
      categories: workspace.categories,
      transactions: workspace.transactions,
      budgets: (workspace.budgets ?? []).map((budget) => Object.fromEntries(Object.entries(budget).filter(([key]) => key !== 'accountId')))
    })
  });
  return response.data;
}

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
