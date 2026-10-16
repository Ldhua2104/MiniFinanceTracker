import { apiRequest } from '../api/client.js';

const STORAGE_KEY = 'mini-finance.anonymous-workspace.v1';

export function emptyWorkspace() {
  return { categories: [], transactions: [], budgets: [], revision: 0 };
}

export function makeStarterWorkspace() {
  const id = () => crypto.randomUUID();
  return {
    categories: [
      { id: id(), name: 'Salary', type: 'income', archived: false },
      { id: id(), name: 'Food', type: 'expense', archived: false },
      { id: id(), name: 'Transport', type: 'expense', archived: false },
      { id: id(), name: 'Housing', type: 'expense', archived: false },
      { id: id(), name: 'Other', type: 'expense', archived: false }
    ],
    transactions: [],
    budgets: [],
    revision: 0
  };
}

export function ensureStarterCategories(workspace) {
  if (workspace.categories?.length) return workspace;
  return { ...workspace, categories: makeStarterWorkspace().categories };
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
  const value = Number(cents) / 100;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
}
