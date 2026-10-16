import { apiRequest } from '../api/client.js';

const STORAGE_KEY = 'mini-finance.anonymous-workspace.v1';

export function emptyWorkspace() {
  return { accounts: [], categories: [], transactions: [], budgets: [], revision: 0 };
}

export function makeStarterWorkspace() {
  const id = () => crypto.randomUUID();
  return {
    accounts: [],
    categories: [
      { id: id(), name: 'Salary', type: 'income', archived: false },
      { id: id(), name: 'Food', type: 'expense', archived: false },
      { id: id(), name: 'Transportation', type: 'expense', archived: false },
      { id: id(), name: 'Housing', type: 'expense', archived: false },
      { id: id(), name: 'Other', type: 'expense', archived: false },
      { id: id(), name: 'None', type: 'expense', archived: false }
    ],
    transactions: [],
    budgets: [],
    revision: 0
  };
}

export function ensureStarterCategories(workspace) {
  return {
    ...emptyWorkspace(),
    ...workspace,
    accounts: workspace.accounts ?? [],
    categories: workspace.categories?.length
      ? [
          ...workspace.categories.map((item) => item.name === 'Transport' ? { ...item, name: 'Transportation' } : item),
          ...(workspace.categories.some((item) => item.name.toLowerCase() === 'none') ? [] : [{ id: crypto.randomUUID(), name: 'None', type: 'expense', archived: false }])
        ]
      : makeStarterWorkspace().categories
  };
}

export function loadAnonymousWorkspace() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...emptyWorkspace(), ...JSON.parse(stored) };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  const initial = makeStarterWorkspace();
  saveAnonymousWorkspace(initial);
  return initial;
}

export function saveAnonymousWorkspace(workspace) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
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
      budgets: workspace.budgets
    })
  });
  return response.data;
}

export function moneyToCents(value) {
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

export function formatCents(cents, locale, currency) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parts = formatter.formatToParts(negative ? (whole === 0n ? -1n : -whole) : whole);
  return parts.map((part) => {
    if (part.type === 'fraction') return fraction;
    if (negative && whole === 0n && part.type === 'integer') return '0';
    return part.value;
  }).join('');
}
