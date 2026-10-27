const LOCAL_AI_SETTINGS_KEY = 'mini-finance.ai-config.v1';
const DATABASE_NAME = 'mini-finance-secure-settings';
const DATABASE_VERSION = 1;
const KEY_STORE = 'crypto-keys';

export const emptyAiSettings = () => ({
  providers: [],
  models: [],
  assignments: { receipt: '', conversation: '' }
});

function openKeyDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function keyStoreRequest(mode, operation) {
  const database = await openKeyDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(KEY_STORE, mode);
      const request = operation(transaction.objectStore(KEY_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function getLocalEncryptionKey() {
  let key = await keyStoreRequest('readonly', (store) => store.get('ai-settings-v1'));
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await keyStoreRequest('readwrite', (store) => store.put(key, 'ai-settings-v1'));
  }
  return key;
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function loadLocalAiSettings() {
  const raw = localStorage.getItem(LOCAL_AI_SETTINGS_KEY);
  if (!raw) return { settings: emptyAiSettings(), apiKeys: {} };
  const stored = JSON.parse(raw);
  if (stored.version === 1 && stored.iv && stored.ciphertext) {
    const key = await getLocalEncryptionKey();
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(stored.iv) }, key, fromBase64(stored.ciphertext));
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    return { settings: parsed.settings, apiKeys: parsed.apiKeys || {} };
  }

  // Upgrade the earlier metadata-only local format. It never contained API keys.
  const settings = stored && Array.isArray(stored.providers) && Array.isArray(stored.models)
    ? { providers: stored.providers, models: stored.models, assignments: stored.assignments || emptyAiSettings().assignments }
    : emptyAiSettings();
  await saveLocalAiSettings(settings, {});
  return { settings, apiKeys: {} };
}

export async function saveLocalAiSettings(settings, apiKeys) {
  const key = await getLocalEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({ settings, apiKeys }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  localStorage.setItem(LOCAL_AI_SETTINGS_KEY, JSON.stringify({ version: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }));
}

export async function clearLocalAiSettings() {
  localStorage.removeItem(LOCAL_AI_SETTINGS_KEY);
  try {
    await keyStoreRequest('readwrite', (store) => store.delete('ai-settings-v1'));
  } catch {
    // The encrypted localStorage payload is still removed if IndexedDB is unavailable.
  }
}

export async function migrateLocalAiSettings(apiRequest) {
  const local = await loadLocalAiSettings();
  const hasConfiguration = local.settings.providers.length || local.settings.models.length || Object.values(local.apiKeys).some(Boolean);
  if (!hasConfiguration) {
    if (localStorage.getItem(LOCAL_AI_SETTINGS_KEY)) await clearLocalAiSettings();
    return null;
  }
  const response = await apiRequest('/auth/ai-settings/migrate', {
    method: 'POST',
    body: JSON.stringify({ ...local.settings, assignments: { receipt: local.settings.assignments?.receipt || '', conversation: local.settings.assignments?.conversation || '' }, providers: local.settings.providers.map(({ id, type, endpoint }) => ({ id, type, endpoint })), apiKeys: local.apiKeys })
  });
  await clearLocalAiSettings();
  return response.data;
}
