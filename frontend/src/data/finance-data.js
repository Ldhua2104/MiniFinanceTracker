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
    categories
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
  return Boolean(data?.transactions?.length || data?.budgets?.length);
}

export function mergeFinanceData(serverData, localData) {
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
  };
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

export async function saveServerData(data) {
  const response = await apiRequest('/auth/data', {
    method: 'PUT',
    body: JSON.stringify({
      accounts: data.accounts ?? [],
      categories: data.categories,
      transactions: data.transactions,
      budgets: (data.budgets ?? []).map((budget) => Object.fromEntries(Object.entries(budget).filter(([key]) => key !== 'accountId')))
    })
  });
  return response.data;
}

