const API_BASE = '/api/v1';
let csrfToken = null;

async function readCsrfToken() {
  const response = await fetch(`${API_BASE}/auth/csrf`, { credentials: 'include' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not initialize request security');
  csrfToken = payload.data.csrfToken;
  return csrfToken;
}

export async function apiRequest(path, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers
  };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) await readCsrfToken();
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    method,
    headers,
    credentials: 'include'
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    error.code = payload?.error?.code;
    error.status = response.status;
    error.fields = payload?.error?.fields;
    throw error;
  }
  return payload;
}

export function refreshCsrfToken() {
  csrfToken = null;
  return readCsrfToken();
}
