const API_BASE = '/api/v1';
let csrfToken = null;

function notifySessionExpired(code) {
  if (code === 'UNAUTHENTICATED' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
}

async function readCsrfToken() {
  const response = await fetch(`${API_BASE}/auth/csrf`, { credentials: 'include', cache: 'no-store' });
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
      credentials: 'include',
      cache: 'no-store'
    });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const code = payload?.error?.code;
      notifySessionExpired(code);
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
      error.requestId = payload?.meta?.requestId;
      throw error;
    }
    return payload;
  }
}

export async function apiStream(path, options = {}, onEvent) {
  const method = (options.method ?? 'GET').toUpperCase();
  const baseHeaders = {
    Accept: 'text/event-stream',
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
    const response = await fetch(`${API_BASE}${path}`, { ...options, method, headers, credentials: 'include', cache: 'no-store' });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const code = payload?.error?.code;
      notifySessionExpired(code);
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
      error.requestId = payload?.meta?.requestId;
      throw error;
    }
    if (!response.body) throw new Error('Streaming response is unavailable in this browser');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = 'message';
    let dataLines = [];
    const dispatch = () => {
      if (!dataLines.length) { eventName = 'message'; return; }
      let data = {};
      try { data = JSON.parse(dataLines.join('\n')); } catch { /* Ignore malformed provider events. */ }
      if (eventName === 'error') {
        const error = new Error(data.message || data.code || 'Stream failed');
        error.code = data.code;
        error.requestId = data.requestId;
        throw error;
      }
      onEvent?.(eventName, data);
      eventName = 'message';
      dataLines = [];
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (!line) dispatch();
          else if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (done) break;
      }
      if (buffer.trim()) {
        if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
      }
      dispatch();
      return;
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
  }
}

export function refreshCsrfToken() {
  csrfToken = null;
  return readCsrfToken();
}
