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

export async function completeAiChat(provider, model, apiKey, messages) {
  if (!apiKey?.trim()) throw Object.assign(new Error(), { code: 'AI_TEST_KEY_MISSING' });
  let endpoint;
  try { endpoint = new URL(provider.endpoint); } catch { throw Object.assign(new Error(), { code: 'AI_TEST_ENDPOINT_INVALID' }); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw Object.assign(new Error(), { code: 'AI_TEST_ENDPOINT_INVALID' });
  }
  if (endpoint.protocol !== 'https:') throw Object.assign(new Error(), { code: 'AI_TEST_INSECURE_ENDPOINT' });

  const basePath = endpoint.pathname.replace(/\/+$/, '');
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const dialog = messages.filter((message) => message.role !== 'system');
  let url;
  let headers = { 'content-type': 'application/json', accept: 'application/json' };
  let body;
  if (provider.type === 'anthropic') {
    const path = basePath.endsWith('/messages') ? basePath : `${basePath}/messages`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers = { ...headers, 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01' };
    body = { model: model.name, max_tokens: 1200, system, messages: dialog, stream: false };
  } else if (provider.type === 'gemini') {
    const path = basePath.includes(':generateContent') ? basePath : `${basePath}/models/${encodeURIComponent(model.name)}:generateContent`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers['x-goog-api-key'] = apiKey.trim();
    body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: dialog.map(({ role, content }) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text: content }] })),
      generationConfig: { maxOutputTokens: 1200 }
    };
  } else {
    const path = basePath.endsWith('/chat/completions') ? basePath : `${basePath}/chat/completions`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers.authorization = `Bearer ${apiKey.trim()}`;
    body = { model: model.name, messages, max_tokens: 1200, stream: false };
  }

  const address = await resolvePublicAddress(url.hostname);
  const result = await postJson(url, headers, JSON.stringify(body), address);
  if (result.status < 200 || result.status >= 300) {
    throw Object.assign(new Error(), { code: responseError(result.status), retryable: result.status === 429 || result.status >= 500 });
  }
  let payload;
  try { payload = JSON.parse(result.body); } catch { throw Object.assign(new Error(), { code: 'AI_TEST_INVALID_RESPONSE' }); }
  const text = provider.type === 'anthropic'
    ? payload.content?.filter((part) => typeof part.text === 'string').map((part) => part.text).join('\n')
    : provider.type === 'gemini'
      ? payload.candidates?.[0]?.content?.parts?.filter((part) => typeof part.text === 'string').map((part) => part.text).join('\n')
      : typeof payload.choices?.[0]?.message?.content === 'string'
        ? payload.choices[0].message.content
        : payload.choices?.[0]?.message?.content?.filter((part) => typeof part.text === 'string').map((part) => part.text).join('\n');
  if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error(), { code: 'AI_TEST_INVALID_RESPONSE' });
  return text.trim();
}

function geminiFunctionSchema(schema) {
  const typeMap = { object: 'OBJECT', string: 'STRING', number: 'NUMBER', integer: 'INTEGER', boolean: 'BOOLEAN', array: 'ARRAY' };
  return {
    ...schema,
    ...(schema.type ? { type: typeMap[schema.type] || schema.type } : {}),
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, geminiFunctionSchema(value)])) } : {}),
    ...(schema.items ? { items: geminiFunctionSchema(schema.items) } : {})
  };
}

function normalizeDsmlText(text) {
  return String(text || '')
    .replace(/｜/g, '|')
    .replace(/[‹]/g, '<')
    .replace(/<\s*\|\s*DSML\s*\|\s*\|?\s*/gi, '<|DSML|')
    .replace(/<\s*\/\s*\|\s*DSML\s*\|\s*\|?\s*/gi, '</|DSML|');
}

function parseDsmlToolCalls(text, tools) {
  const normalized = normalizeDsmlText(text);
  const allowedNames = new Set(tools.map((tool) => tool.name));
  const calls = [];
  const invokePattern = /<\|DSML\|invoke\s+name=(['"])(.*?)\1\s*>([\s\S]*?)<\/\|DSML\|invoke\s*>/gi;
  for (const match of normalized.matchAll(invokePattern)) {
    const name = match[2].trim();
    if (!allowedNames.has(name)) continue;
    const args = {};
    const parameterPattern = /<\|DSML\|parameter\s+name=(['"])(.*?)\1(?:\s+string=(['"])(true|false)\3)?\s*>([\s\S]*?)<\/\|DSML\|parameter\s*>/gi;
    for (const parameter of match[3].matchAll(parameterPattern)) {
      const key = parameter[2].trim();
      const value = parameter[5].trim();
      const stringValue = parameter[4] !== 'false';
      args[key] = stringValue ? value
        : value === 'true' ? true
          : value === 'false' ? false
            : value !== '' && Number.isFinite(Number(value)) ? Number(value) : value;
    }
    if (name === 'manage_finance_item') {
      args.entity ??= args.itemType;
      if (args.entity === 'budget') {
        args.monthlyAmount ??= args.amount;
        if (args.monthlyAmount !== undefined) args.monthlyAmount = String(args.monthlyAmount);
      }
      delete args.itemType;
      delete args.amount;
      delete args.category;
    }
    calls.push({ id: `dsml-${calls.length}`, name, arguments: args });
  }
  const markerIndex = normalized.indexOf('<|DSML|');
  const cleanText = (markerIndex >= 0 ? normalized.slice(0, markerIndex) : normalized).trim();
  return { calls, text: cleanText };
}

export async function requestAiToolCalls(provider, model, apiKey, messages, tools, { mode = 'required' } = {}) {
  if (!apiKey?.trim()) throw Object.assign(new Error(), { code: 'AI_TEST_KEY_MISSING' });
  let endpoint;
  try { endpoint = new URL(provider.endpoint); } catch { throw Object.assign(new Error(), { code: 'AI_TEST_ENDPOINT_INVALID' }); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw Object.assign(new Error(), { code: 'AI_TEST_ENDPOINT_INVALID' });
  if (endpoint.protocol !== 'https:') throw Object.assign(new Error(), { code: 'AI_TEST_INSECURE_ENDPOINT' });

  const basePath = endpoint.pathname.replace(/\/+$/, '');
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const dialog = messages.filter((message) => message.role !== 'system');
  let url;
  let headers = { 'content-type': 'application/json', accept: 'application/json' };
  let body;
  if (provider.type === 'anthropic') {
    const path = basePath.endsWith('/messages') ? basePath : `${basePath}/messages`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers = { ...headers, 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01' };
    body = {
      model: model.name,
      max_tokens: 1200,
      system,
      messages: dialog.map(({ role, content, imageDataUrls }) => imageDataUrls?.length ? ({
        role,
        content: [
          ...(content ? [{ type: 'text', text: content }] : []),
          ...imageDataUrls.map((image) => {
            const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
            return { type: 'image', source: { type: 'base64', media_type: match?.[1] || 'image/jpeg', data: match?.[2] || '' } };
          })
        ]
      }) : ({ role, content })),
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
      tool_choice: mode === 'auto' ? { type: 'auto' } : { type: 'any' }
    };
  } else if (provider.type === 'gemini') {
    const path = basePath.includes(':generateContent') ? basePath : `${basePath}/models/${encodeURIComponent(model.name)}:generateContent`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers['x-goog-api-key'] = apiKey.trim();
    body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: dialog.map(({ role, content, imageDataUrls }) => ({
        role: role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(content ? [{ text: content }] : []),
          ...(imageDataUrls || []).map((image) => {
            const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
            return { inlineData: { mimeType: match?.[1] || 'image/jpeg', data: match?.[2] || '' } };
          })
        ]
      })),
      tools: [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parameters: geminiFunctionSchema(parameters) })) }],
      toolConfig: { functionCallingConfig: { mode: mode === 'auto' ? 'AUTO' : 'ANY' } },
      generationConfig: { maxOutputTokens: 1200 }
    };
  } else {
    const path = basePath.endsWith('/chat/completions') ? basePath : `${basePath}/chat/completions`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers.authorization = `Bearer ${apiKey.trim()}`;
    body = {
      model: model.name,
      messages: messages.map(({ role, content, imageDataUrls }) => imageDataUrls?.length ? ({
        role,
        content: [
          ...(content ? [{ type: 'text', text: content }] : []),
          ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } }))
        ]
      }) : ({ role, content })),
      tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
      // `required` is rejected by some OpenAI-compatible reasoning endpoints
      // (including DeepSeek thinking mode). Keep the request portable and
      // verify below that the requested report function was actually called.
      tool_choice: 'auto',
      max_tokens: 1200,
      stream: false
    };
  }

  const address = await resolvePublicAddress(url.hostname);
  const result = await postJson(url, headers, JSON.stringify(body), address);
  if (result.status < 200 || result.status >= 300) {
    if ([400, 404, 422].includes(result.status) && /tool.?call|function.?call|function call|not support|unsupported/i.test(result.body)) {
      throw Object.assign(new Error(), { code: 'AI_TOOL_CALL_UNSUPPORTED' });
    }
    throw Object.assign(new Error(), { code: responseError(result.status), retryable: result.status === 429 || result.status >= 500 });
  }
  let payload;
  try { payload = JSON.parse(result.body); } catch { throw Object.assign(new Error(), { code: 'AI_TEST_INVALID_RESPONSE' }); }

  let toolCalls = [];
  let text = '';
  let providerMessage = null;
  if (provider.type === 'anthropic') {
    toolCalls = (payload.content || []).filter((block) => block.type === 'tool_use').map((block) => ({ id: block.id, name: block.name, arguments: block.input ?? {} }));
    text = (payload.content || []).filter((block) => typeof block.text === 'string').map((block) => block.text).join('');
    providerMessage = { role: 'assistant', content: payload.content || [] };
  } else if (provider.type === 'gemini') {
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    toolCalls = parts.filter((part) => part.functionCall?.name).map((part, index) => ({ id: `gemini-${index}`, name: part.functionCall.name, arguments: part.functionCall.args ?? {} }));
    text = parts.filter((part) => typeof part.text === 'string').map((part) => part.text).join('');
    providerMessage = { role: 'assistant', toolParts: parts };
  } else {
    const message = payload.choices?.[0]?.message;
    toolCalls = (message?.tool_calls || []).map((call) => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments ?? '{}' }));
    if (message?.function_call?.name) toolCalls.push({ id: 'legacy-function-call', name: message.function_call.name, arguments: message.function_call.arguments ?? '{}' });
    text = typeof message?.content === 'string' ? message.content : '';
    providerMessage = message ? { ...message, role: 'assistant' } : null;
  }
  if (!toolCalls.length && text) {
    const parsedDsml = parseDsmlToolCalls(text, tools);
    toolCalls = parsedDsml.calls;
    text = parsedDsml.text;
    if (toolCalls.length && providerMessage?.content) {
      providerMessage = { ...providerMessage, content: parsedDsml.text };
    }
  }
  const rawUsage = payload.usage ?? payload.usageMetadata ?? {};
  const inputTokens = Number(rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? rawUsage.promptTokenCount ?? 0);
  const outputTokens = Number(rawUsage.output_tokens ?? rawUsage.completion_tokens ?? rawUsage.candidatesTokenCount ?? 0);
  const totalTokens = Number(rawUsage.total_tokens ?? rawUsage.totalTokenCount ?? inputTokens + outputTokens);
  return {
    toolCalls,
    text,
    providerMessage,
    usage: Number.isFinite(totalTokens) && totalTokens > 0 ? {
      inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
      outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
      totalTokens
    } : null
  };
}

function postStreamingJson(url, headers, body, address, signal) {
  return new Promise((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requestFn({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      servername: isIP(url.hostname) ? undefined : url.hostname,
      family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family)
    }, resolve);
    request.setTimeout(60_000, () => request.destroy(Object.assign(new Error(), { code: 'AI_TEST_TIMEOUT' })));
    request.on('error', (error) => reject(error.code ? error : Object.assign(new Error(), { code: 'AI_TEST_NETWORK' })));
    if (signal) {
      if (signal.aborted) request.destroy(Object.assign(new Error(), { code: 'AI_CHAT_ABORTED' }));
      else signal.addEventListener('abort', () => request.destroy(Object.assign(new Error(), { code: 'AI_CHAT_ABORTED' })), { once: true });
    }
    request.end(body);
  });
}

function streamedText(providerType, payload) {
  if (providerType === 'anthropic') {
    return payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta' ? payload.delta.text : '';
  }
  if (providerType === 'gemini') {
    const candidates = Array.isArray(payload) ? payload : payload.candidates ?? [];
    return candidates.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text || '').join('');
  }
  return payload.choices?.[0]?.delta?.content ?? '';
}

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

export async function streamAiChat(provider, model, apiKey, messages, onToken, { signal, onUsage } = {}) {
  if (!apiKey?.trim()) throw Object.assign(new Error(), { code: 'AI_TEST_KEY_MISSING' });
  let endpoint;
  try { endpoint = new URL(provider.endpoint); } catch { throw Object.assign(new Error(), { code: 'AI_TEST_ENDPOINT_INVALID' }); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw Object.assign(new Error(), { code: 'AI_TEST_ENDPOINT_INVALID' });
  }
  if (endpoint.protocol !== 'https:') throw Object.assign(new Error(), { code: 'AI_TEST_INSECURE_ENDPOINT' });

  const basePath = endpoint.pathname.replace(/\/+$/, '');
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const dialog = messages.filter((message) => message.role !== 'system');
  let url;
  let headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  let body;
  if (provider.type === 'anthropic') {
    const path = basePath.endsWith('/messages') ? basePath : `${basePath}/messages`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers = { ...headers, 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01' };
    body = {
      model: model.name,
      max_tokens: 1200,
      system,
      messages: dialog.map(({ role, content, imageDataUrls }) => imageDataUrls?.length ? ({
        role,
        content: [
          ...(content ? [{ type: 'text', text: content }] : []),
          ...imageDataUrls.map((image) => {
            const parsed = parseImageDataUrl(image);
            return { type: 'image', source: { type: 'base64', media_type: parsed?.mimeType || 'image/jpeg', data: parsed?.data || '' } };
          })
        ]
      }) : ({ role, content })),
      stream: true
    };
  } else if (provider.type === 'gemini') {
    const path = basePath.includes(':generateContent')
      ? basePath.replace(':generateContent', ':streamGenerateContent')
      : `${basePath}/models/${encodeURIComponent(model.name)}:streamGenerateContent`;
    const search = new URLSearchParams(endpoint.search);
    search.set('alt', 'sse');
    url = new URL(`${path}?${search.toString()}`, endpoint.origin);
    headers['x-goog-api-key'] = apiKey.trim();
    body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: dialog.map((message) => {
        if (message.role === 'assistant' && message.toolParts) return { role: 'model', parts: message.toolParts };
        if (message.role === 'tool') {
          let result = message.content;
          try { result = JSON.parse(message.content); } catch { /* Keep a text result for compatible providers. */ }
          return { role: 'user', parts: [{ functionResponse: { name: message.name, response: { result } } }] };
        }
        return {
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [
            ...(message.content ? [{ text: message.content }] : []),
            ...(message.imageDataUrls || []).map((image) => {
              const parsed = parseImageDataUrl(image);
              return { inlineData: { mimeType: parsed?.mimeType || 'image/jpeg', data: parsed?.data || '' } };
            })
          ]
        };
      }),
      generationConfig: { maxOutputTokens: 1200 }
    };
  } else {
    const path = basePath.endsWith('/chat/completions') ? basePath : `${basePath}/chat/completions`;
    url = new URL(`${path}${endpoint.search}`, endpoint.origin);
    headers.authorization = `Bearer ${apiKey.trim()}`;
    body = {
      model: model.name,
      messages: messages.map(({ role, content, imageDataUrls }) => imageDataUrls?.length ? ({
        role,
        content: [
          ...(content ? [{ type: 'text', text: content }] : []),
          ...imageDataUrls.map((image) => ({ type: 'image_url', image_url: { url: image } }))
        ]
      }) : ({ role, content })),
      max_tokens: 1200,
      stream: true,
      stream_options: { include_usage: true }
    };
  }

  const address = await resolvePublicAddress(url.hostname);
  let response = await postStreamingJson(url, headers, JSON.stringify(body), address, signal);
  if (response.statusCode === 400 && body.stream_options) {
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > 256 * 1024) break;
    }
    // Some OpenAI-compatible providers reject `stream_options` but omit the
    // unsupported field from their error message. Usage is optional, so retry
    // once without it on any 400 response.
    const fallbackBody = { ...body };
    delete fallbackBody.stream_options;
    response = await postStreamingJson(url, headers, JSON.stringify(fallbackBody), address, signal);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > 256 * 1024) break;
      if (signal?.aborted) break;
    }
    throw Object.assign(new Error(), {
      code: responseError(response.statusCode || 0),
      httpStatus: response.statusCode || 0,
      retryable: response.statusCode === 429 || response.statusCode >= 500
    });
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let emitted = false;
  let usage = null;
  let pendingAssistantText = '';
  let dsmlMarkupDetected = false;
  const dsmlStart = /[<‹]\s*[|｜]\s*DSML/i;
  function emitSafeAssistantText(text) {
    if (dsmlMarkupDetected) return;
    pendingAssistantText += text;
    const marker = dsmlStart.exec(pendingAssistantText);
    if (marker) {
      const safePrefix = pendingAssistantText.slice(0, marker.index);
      if (safePrefix) onToken(safePrefix);
      pendingAssistantText = '';
      dsmlMarkupDetected = true;
      return;
    }
    if (pendingAssistantText.length > 64) {
      onToken(pendingAssistantText.slice(0, -64));
      pendingAssistantText = pendingAssistantText.slice(-64);
    }
  }
  function consumeLine(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trimStart();
    if (!data || data === '[DONE]') return;
    let payload;
    try { payload = JSON.parse(data); } catch { return; }
    const rawUsage = provider.type === 'anthropic' ? (payload.message?.usage ?? payload.usage)
      : provider.type === 'gemini' ? payload.usageMetadata
        : payload.usage;
    if (rawUsage) {
      const inputTokens = Number(rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? rawUsage.promptTokenCount);
      const outputTokens = Number(rawUsage.output_tokens ?? rawUsage.completion_tokens ?? rawUsage.candidatesTokenCount);
      const totalTokens = Number(rawUsage.total_tokens ?? rawUsage.totalTokenCount);
      usage = {
        inputTokens: Number.isFinite(inputTokens) ? inputTokens : usage?.inputTokens ?? 0,
        outputTokens: Number.isFinite(outputTokens) ? outputTokens : usage?.outputTokens ?? 0,
        totalTokens: Number.isFinite(totalTokens) ? totalTokens : undefined
      };
      if (!Number.isFinite(usage.totalTokens)) usage.totalTokens = usage.inputTokens + usage.outputTokens;
    }
    const text = streamedText(provider.type, payload);
    if (text) {
      emitted = true;
      emitSafeAssistantText(text);
    }
    if (payload.error) throw Object.assign(new Error(), { code: responseError(payload.error.status || 502) });
  }
  for await (const chunk of response) {
    if (signal?.aborted) throw Object.assign(new Error(), { code: 'AI_CHAT_ABORTED' });
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      consumeLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);
  if (dsmlMarkupDetected) throw Object.assign(new Error(), { code: 'AI_TOOL_CALL_UNSUPPORTED' });
  if (pendingAssistantText) onToken(pendingAssistantText);
  if (!emitted) throw Object.assign(new Error(), { code: 'AI_TEST_INVALID_RESPONSE' });
  if (usage && onUsage) onUsage(usage);
}

export function isAiProbeRetryable(error) {
  return Boolean(error.retryable || ['AI_TEST_TIMEOUT', 'AI_TEST_NETWORK'].includes(error.code));
}
