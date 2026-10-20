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
  const baseHeaders = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers
  };
  const requiresCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  let csrfRetries = 0;
  while (true) {
    const headers = { ...baseHeaders };
    if (requiresCsrf) {
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
      const code = payload?.error?.code;
      if (requiresCsrf && response.status === 403 && csrfRetries === 0 && ['CSRF_REQUIRED', 'CSRF_INVALID'].includes(code)) {
        csrfToken = null;
        csrfRetries += 1;
        await readCsrfToken();
        continue;
      }
      const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`);
      error.code = code;
      error.status = response.status;
      error.fields = payload?.error?.fields;
      throw error;
    }
    return payload;
  }
}

export function refreshCsrfToken() {
  csrfToken = null;
  return readCsrfToken();
}
