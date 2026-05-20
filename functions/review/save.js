const WEBHOOK_URL = 'FS_REVIEW_PUBLISH_WEBHOOK_URL';
const WEBHOOK_SECRET = 'FS_REVIEW_PUBLISH_WEBHOOK_SECRET';
const EVENT_NAME = 'factory_signal.review_save_request';
const DRAFT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}(?:\.md)?$/;
const ALLOWED_ACTIONS = new Set(['save', 'load']);
const REVIEW_EDIT_KEYS = ['opening', 'middle', 'closing'];
const MAX_REVIEW_EDIT_LENGTH = 1200;
const MAX_DRAFT_TITLE_LENGTH = 220;
const MAX_DRAFT_AUTHOR_LENGTH = 320;
const MAX_DRAFT_BODY_LENGTH = 200000;

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: jsonHeaders({ Allow: 'GET, POST, OPTIONS' }) });
  }
  if (context.request.method !== 'GET' && context.request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed', message: 'Use GET to load or POST to save review drafts.' }, 405, { Allow: 'GET, POST, OPTIONS' });
  }

  const receiverUrl = context.env?.[WEBHOOK_URL];
  const receiverSecret = context.env?.[WEBHOOK_SECRET];
  if (!receiverUrl || !receiverSecret) {
    return jsonResponse({ ok: false, error: 'save_receiver_not_configured', message: `Review draft receiver is not configured. Set ${WEBHOOK_URL} and ${WEBHOOK_SECRET}.` }, 503);
  }

  let receiverEndpoint;
  try {
    receiverEndpoint = parseHttpsWebhookUrl(receiverUrl);
  } catch (error) {
    return jsonResponse({ ok: false, error: 'save_receiver_invalid_url', message: error.message }, 503);
  }

  let input;
  try {
    input = context.request.method === 'GET' ? Object.fromEntries(new URL(context.request.url).searchParams.entries()) : await readPayload(context.request);
  } catch (error) {
    return jsonResponse({ ok: false, error: 'invalid_payload', message: error.message }, 400);
  }

  const draft = normalizeDraftIdentifier(input.draft || input.slug || input.file || input.filename);
  const action = context.request.method === 'GET' ? 'load' : String(input.action || 'save').trim();
  if (!draft) {
    return jsonResponse({ ok: false, error: 'invalid_draft', message: 'Draft identifier must use only letters, numbers, dots, underscores, and hyphens, with no path separators.' }, 400);
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonResponse({ ok: false, error: 'invalid_action', message: 'Action must be save or load.' }, 400);
  }

  const timestamp = new Date().toISOString();
  const reviewEdits = action === 'save' ? normalizeReviewEdits(input) : undefined;
  const draftEdits = action === 'save' ? normalizeDraftEdits(input) : undefined;
  const idempotencyKey = await createIdempotencyKey(draft, action, reviewEdits, draftEdits);
  const webhookPayload = {
    event: EVENT_NAME,
    action,
    draft,
    title: typeof input.title === 'string' ? input.title.trim() || undefined : undefined,
    draftEdits,
    reviewEdits,
    requestedAt: timestamp,
    idempotencyKey,
    source: { url: context.request.url, userAgent: context.request.headers.get('User-Agent') || undefined },
  };
  if (!draftEdits) delete webhookPayload.draftEdits;
  if (!reviewEdits) delete webhookPayload.reviewEdits;

  const body = JSON.stringify(webhookPayload);
  const signature = await hmacSha256Hex(receiverSecret, `${timestamp}.${body}`);
  let webhookResponse;
  try {
    webhookResponse = await fetch(receiverEndpoint.toString(), {
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
    return jsonResponse({ ok: false, error: 'webhook_rejected', message: result.message || `Review draft receiver returned HTTP ${webhookResponse.status}.`, status: webhookResponse.status }, 502);
  }

  return jsonResponse({ ok: true, message: action === 'load' ? 'Review draft loaded.' : 'Review draft saved.', idempotencyKey, draftEdits: result.draftEdits || undefined, reviewEdits: result.reviewEdits || undefined, savedAt: result.savedAt || undefined });
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

function normalizeDraftIdentifier(value) {
  const draft = String(value || '').trim();
  if (!DRAFT_ID_PATTERN.test(draft) || draft.includes('/') || draft.includes('\\') || draft.includes('..')) return '';
  return draft.replace(/\.md$/i, '');
}

function normalizeReviewEdits(input) {
  const source = input.reviewEdits && typeof input.reviewEdits === 'object' && !Array.isArray(input.reviewEdits) ? input.reviewEdits : input;
  return {
    opening: normalizeReviewEditText(source.opening ?? source.reviewOpening ?? source.additionOpening),
    middle: normalizeReviewEditText(source.middle ?? source.mid ?? source.reviewMiddle ?? source.additionMiddle),
    closing: normalizeReviewEditText(source.closing ?? source.reviewClosing ?? source.additionClosing),
  };
}

function normalizeReviewEditText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '').trim().slice(0, MAX_REVIEW_EDIT_LENGTH);
}

function normalizeDraftEdits(input) {
  const source = input.draftEdits && typeof input.draftEdits === 'object' && !Array.isArray(input.draftEdits) ? input.draftEdits : input;
  return {
    title: normalizeDraftEditText(source.title ?? source['draftEdits.title'], MAX_DRAFT_TITLE_LENGTH),
    author: normalizeDraftEditText(source.author ?? source.authors ?? source['draftEdits.author'] ?? source['draftEdits.authors'], MAX_DRAFT_AUTHOR_LENGTH),
    body: normalizeDraftBody(source.body ?? source.markdownBody ?? source['draftEdits.body']),
  };
}

function normalizeDraftEditText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '').trim().slice(0, maxLength);
}

function normalizeDraftBody(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '').trim().slice(0, MAX_DRAFT_BODY_LENGTH);
}

function parseHttpsWebhookUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${WEBHOOK_URL} must be a valid HTTPS URL.`); }
  if (parsed.protocol !== 'https:') throw new Error(`${WEBHOOK_URL} must use HTTPS; refusing to send review draft requests to non-HTTPS receivers.`);
  return parsed;
}

async function createIdempotencyKey(draft, action, reviewEdits = {}, draftEdits = {}) {
  const operation = JSON.stringify({ draft, action, draftEdits: pickDraftEdits(draftEdits), reviewEdits: pickReviewEdits(reviewEdits) });
  const digest = await sha256Hex(`factory-signal.review_save:${operation}`);
  return `${draft}-${action}-${digest.slice(0, 32)}`.slice(0, 220);
}

function pickDraftEdits(draftEdits = {}) {
  return {
    title: typeof draftEdits.title === 'string' ? draftEdits.title : '',
    author: typeof draftEdits.author === 'string' ? draftEdits.author : '',
    body: typeof draftEdits.body === 'string' ? draftEdits.body : '',
  };
}

function pickReviewEdits(reviewEdits = {}) {
  return Object.fromEntries(REVIEW_EDIT_KEYS.map((key) => [key, typeof reviewEdits[key] === 'string' ? reviewEdits[key] : '']));
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