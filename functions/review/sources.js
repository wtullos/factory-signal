const WEBHOOK_URL = 'FS_REVIEW_PUBLISH_WEBHOOK_URL';
const WEBHOOK_SECRET = 'FS_REVIEW_PUBLISH_WEBHOOK_SECRET';
const EVENT_NAME = 'factory_signal.review_sources_request';
const ALLOWED_TYPES = new Set(['rss', 'subreddit']);
const ALLOWED_ACTIONS = new Set(['load', 'save']);
const MAX_SOURCES = 100;
const MAX_FIELD_LENGTH = 500;
const WEBHOOK_RETRY_DELAYS_MS = [100, 300];

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: jsonHeaders({ Allow: 'GET, POST, OPTIONS' }) });
  }
  if (context.request.method !== 'GET' && context.request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed', message: 'Use GET to load or POST to save watched sources.' }, 405, { Allow: 'GET, POST, OPTIONS' });
  }

  const receiverUrl = context.env?.[WEBHOOK_URL];
  const receiverSecret = context.env?.[WEBHOOK_SECRET];
  if (!receiverUrl || !receiverSecret) {
    return jsonResponse({ ok: false, error: 'sources_receiver_not_configured', message: `Sources receiver is not configured. Set ${WEBHOOK_URL} and ${WEBHOOK_SECRET}.` }, 503);
  }

  let receiverEndpoint;
  try {
    receiverEndpoint = parseHttpsWebhookUrl(receiverUrl);
  } catch (error) {
    return jsonResponse({ ok: false, error: 'sources_receiver_invalid_url', message: error.message }, 503);
  }

  let input;
  try {
    input = context.request.method === 'GET' ? Object.fromEntries(new URL(context.request.url).searchParams.entries()) : await readPayload(context.request);
  } catch (error) {
    return jsonResponse({ ok: false, error: 'invalid_payload', message: error.message }, 400);
  }

  const action = context.request.method === 'GET' ? 'load' : String(input.action || 'save').trim();
  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonResponse({ ok: false, error: 'invalid_action', message: 'Action must be save or load.' }, 400);
  }

  let sources;
  try {
    sources = action === 'save' ? normalizeSources(input.sources) : undefined;
  } catch (error) {
    return jsonResponse({ ok: false, error: 'invalid_sources', message: error.message }, 400);
  }

  const timestamp = new Date().toISOString();
  const idempotencyKey = await createIdempotencyKey(action, sources);
  const webhookPayload = {
    event: EVENT_NAME,
    action,
    sources,
    requestedAt: timestamp,
    idempotencyKey,
    source: { url: context.request.url, userAgent: context.request.headers.get('User-Agent') || undefined },
  };
  if (!sources) delete webhookPayload.sources;

  const body = JSON.stringify(webhookPayload);
  const signature = await hmacSha256Hex(receiverSecret, `${timestamp}.${body}`);
  let webhookResponse;
  try {
    webhookResponse = await fetchWebhookWithRetry(receiverEndpoint.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'factory-signal-review/1.0',
        'X-Factory-Signal-Event': EVENT_NAME,
        'X-Factory-Signal-Timestamp': timestamp,
        'X-Factory-Signal-Idempotency-Key': idempotencyKey,
        'X-Factory-Signal-Signature': `sha256=${signature}`,
      },
      body,
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: 'webhook_request_failed', message: error.message }, 502);
  }

  const result = await webhookResponse.json().catch(() => ({}));
  if (!webhookResponse.ok || !result.ok) {
    return jsonResponse({ ok: false, error: 'webhook_rejected', message: result.message || `Sources receiver returned HTTP ${webhookResponse.status}.`, status: webhookResponse.status }, 502);
  }

  return jsonResponse({ ok: true, message: action === 'load' ? 'Sources loaded.' : 'Sources saved.', idempotencyKey, sources: Array.isArray(result.sources) ? normalizeSources(result.sources) : undefined, savedAt: result.savedAt || undefined });
}

async function fetchWebhookWithRetry(url, options) {
  let lastError;
  for (let attempt = 0; attempt <= WEBHOOK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status < 500 || attempt === WEBHOOK_RETRY_DELAYS_MS.length) return response;
    } catch (error) {
      lastError = error;
      if (attempt === WEBHOOK_RETRY_DELAYS_MS.length) throw error;
    }
    await delay(WEBHOOK_RETRY_DELAYS_MS[attempt]);
  }
  throw lastError || new Error('Webhook request failed.');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readPayload(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object') throw new Error('JSON body must be an object.');
    return payload;
  }
  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

function normalizeSources(value) {
  const rawSources = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(rawSources)) throw new Error('Sources must be an array.');
  if (rawSources.length > MAX_SOURCES) throw new Error(`Sources list cannot exceed ${MAX_SOURCES} items.`);
  return rawSources.map(normalizeSource).filter(Boolean);
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const type = cleanField(source.type).toLowerCase();
  if (!ALLOWED_TYPES.has(type)) throw new Error('Each source type must be rss or subreddit.');
  const name = cleanField(source.name);
  const topic = cleanField(source.topic || source.category);
  const url = cleanField(source.url || source.href);
  const enabled = source.enabled === false || source.active === false ? false : true;
  if (!name || !topic || !url) throw new Error('Each source needs a name, topic, and URL.');
  if (!/^https?:\/\//i.test(url)) throw new Error('Each source URL must start with http:// or https://.');
  return { name, type, topic, url, enabled };
}

function cleanField(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_FIELD_LENGTH);
}

function parseHttpsWebhookUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${WEBHOOK_URL} must be a valid HTTPS URL.`); }
  if (parsed.protocol !== 'https:') throw new Error(`${WEBHOOK_URL} must use HTTPS; refusing to send sources requests to non-HTTPS receivers.`);
  return parsed;
}

async function createIdempotencyKey(action, sources) {
  const operation = JSON.stringify({ action, sources: sources || [] });
  const digest = await sha256Hex(`factory-signal.review_sources:${operation}`);
  return `sources-${action}-${digest.slice(0, 32)}`;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders(headers) });
}

function jsonHeaders(headers = {}) {
  return { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers };
}
