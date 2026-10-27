import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

function isPublicAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168) || a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
      || (a === 203 && b === 0 && c === 113));
  }
  if (version !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    return isIP(mapped) === 4 && isPublicAddress(mapped);
  }
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff && !normalized.startsWith('2001:db8:');
}

function probeRequest(provider, model, apiKey) {
  let endpoint;
  try { endpoint = new URL(provider.endpoint); } catch { throw Object.assign(new Error(), { code: 'AI_TEST_ENDPOINT_INVALID' }); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw Object.assign(new Error(), { code: 'AI_TEST_ENDPOINT_INVALID' });
  }
  if (endpoint.protocol !== 'https:') throw Object.assign(new Error(), { code: 'AI_TEST_INSECURE_ENDPOINT' });
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  let url;
  let headers = { 'content-type': 'application/json', accept: 'application/json' };
  let body;
  if (provider.type === 'anthropic') {
    url = new URL(`${basePath.endsWith('/messages') ? basePath : `${basePath}/messages`}${endpoint.search}`, endpoint.origin);
    headers = { ...headers, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    body = { model: model.name, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with exactly OK.' }] };
  } else if (provider.type === 'gemini') {
    const path = basePath.includes(':generateContent') ? basePath : `${basePath}/models/${encodeURIComponent(model.name)}:generateContent`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers['x-goog-api-key'] = apiKey;
    body = { contents: [{ parts: [{ text: 'Reply with exactly OK.' }] }], generationConfig: { maxOutputTokens: 8 } };
  } else {
    const path = basePath.endsWith('/chat/completions') ? basePath : `${basePath}/chat/completions`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers.authorization = `Bearer ${apiKey}`;
    body = { model: model.name, messages: [{ role: 'user', content: 'Reply with exactly OK.' }], max_tokens: 8, stream: false };
  }
  return { url, headers, body };
}

async function resolvePublicAddress(hostname) {
  const literalVersion = isIP(hostname);
  const addresses = literalVersion ? [{ address: hostname, family: literalVersion }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw Object.assign(new Error(), { code: 'AI_TEST_ENDPOINT_BLOCKED' });
  }
  return addresses[0];
}

function postJson(url, headers, body, address) {
  return new Promise((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requestFn({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      servername: isIP(url.hostname) ? undefined : url.hostname,
      family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family)
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 256 * 1024) req.destroy(Object.assign(new Error(), { code: 'AI_TEST_RESPONSE_TOO_LARGE' }));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(12000, () => req.destroy(Object.assign(new Error(), { code: 'AI_TEST_TIMEOUT' })));
    req.on('error', (error) => reject(error.code ? error : Object.assign(new Error(), { code: 'AI_TEST_NETWORK' })));
    req.end(body);
  });
}

function responseError(status) {
  if (status === 401 || status === 403) return 'AI_TEST_AUTH_FAILED';
  if (status === 404) return 'AI_TEST_MODEL_OR_ENDPOINT_NOT_FOUND';
  if (status === 429) return 'AI_TEST_RATE_LIMITED';
  if (status >= 500) return 'AI_TEST_PROVIDER_UNAVAILABLE';
  if (status >= 300 && status < 400) return 'AI_TEST_REDIRECT_UNSUPPORTED';
  if (status === 400 || status === 422) return 'AI_TEST_REQUEST_REJECTED';
  return 'AI_TEST_REQUEST_FAILED';
}

export async function probeAiModel(provider, model, apiKey) {
  if (!apiKey?.trim()) throw Object.assign(new Error(), { code: 'AI_TEST_KEY_MISSING' });
  const { url, headers, body } = probeRequest(provider, model, apiKey.trim());
  const address = await resolvePublicAddress(url.hostname);
  const result = await postJson(url, headers, JSON.stringify(body), address);
  if (result.status < 200 || result.status >= 300) {
    throw Object.assign(new Error(), { code: responseError(result.status), retryable: result.status === 429 || result.status >= 500 });
  }
  let payload;
  try { payload = JSON.parse(result.body); } catch { throw Object.assign(new Error(), { code: 'AI_TEST_INVALID_RESPONSE' }); }
  const hasText = provider.type === 'anthropic'
    ? payload.content?.some((part) => typeof part.text === 'string')
    : provider.type === 'gemini'
      ? payload.candidates?.some((candidate) => candidate.content?.parts?.some((part) => typeof part.text === 'string'))
      : typeof payload.choices?.[0]?.message?.content === 'string';
  if (!hasText) throw Object.assign(new Error(), { code: 'AI_TEST_INVALID_RESPONSE' });
  return true;
}

export function isAiProbeRetryable(error) {
  return Boolean(error.retryable || ['AI_TEST_TIMEOUT', 'AI_TEST_NETWORK'].includes(error.code));
}
