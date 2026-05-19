const WEBHOOK_URL = 'FS_REVIEW_PUBLISH_WEBHOOK_URL';
const WEBHOOK_SECRET = 'FS_REVIEW_PUBLISH_WEBHOOK_SECRET';
const ALLOWED_ACTIONS = new Set(['publish_now', 'schedule']);
const DRAFT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}(?:\.md)?$/;
const ADDITION_KEYS = ['opening', 'middle', 'closing'];
const MAX_ADDITION_LENGTH = 1200;

async function handlePost(context) {
  const receiverUrl = context.env?.[WEBHOOK_URL];
  const receiverSecret = context.env?.[WEBHOOK_SECRET];

  if (!receiverUrl || !receiverSecret) {
    return jsonResponse({
      ok: false,
      error: 'publish_receiver_not_configured',
      message: `Publish request receiver is not configured. Set ${WEBHOOK_URL} and ${WEBHOOK_SECRET}.`,
    }, 503);
  }

  let receiverEndpoint;
  try {
    receiverEndpoint = parseHttpsWebhookUrl(receiverUrl);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: 'publish_receiver_invalid_url',
      message: error.message,
    }, 503);
  }

  let input;
  try {
    input = await readPayload(context.request);
  } catch (error) {
    return jsonResponse({ ok: false, error: 'invalid_payload', message: error.message }, 400);
  }

  const draft = normalizeDraftIdentifier(input.draft || input.slug || input.file || input.filename);
  const action = String(input.action || '').trim();
  const title = String(input.title || '').trim();
  const publishAt = String(input.publishAt || input.publish_at || '').trim();
  const additions = normalizeAdditions(input);

  if (!draft) {
    return jsonResponse({
      ok: false,
      error: 'invalid_draft',
      message: 'Draft identifier must use only letters, numbers, dots, underscores, and hyphens, with no path separators.',
    }, 400);
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonResponse({ ok: false, error: 'invalid_action', message: 'Action must be publish_now or schedule.' }, 400);
  }

  if (action === 'schedule' && !publishAt) {
    return jsonResponse({ ok: false, error: 'missing_publish_at', message: 'Schedule requests require publishAt.' }, 400);
  }

  if (action === 'schedule' && !isPlausibleDateTime(publishAt)) {
    return jsonResponse({ ok: false, error: 'invalid_publish_at', message: 'publishAt must be a plausible date/time string.' }, 400);
  }

  const effectivePublishAt = action === 'schedule' ? publishAt : '';
  const timestamp = new Date().toISOString();
  const idempotencyKey = await createIdempotencyKey(draft, action, effectivePublishAt, additions);
  const webhookPayload = {
    event: 'factory_signal.review_publish_request',
    action,
    draft,
    title: title || undefined,
    publishAt: effectivePublishAt || undefined,
    additions,
    requestedAt: timestamp,
    idempotencyKey,
    source: {
      url: context.request.url,
      userAgent: context.request.headers.get('User-Agent') || undefined,
    },
  };

  const body = JSON.stringify(webhookPayload);
  const signature = await hmacSha256Hex(receiverSecret, `${timestamp}.${body}`);

  let webhookResponse;
  try {
    webhookResponse = await fetch(receiverEndpoint.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'factory-signal-review/1.0',
        'X-Factory-Signal-Event': webhookPayload.event,
        'X-Factory-Signal-Timestamp': timestamp,
        'X-Factory-Signal-Idempotency-Key': idempotencyKey,
        'X-Factory-Signal-Signature': `sha256=${signature}`,
      },
      body,
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: 'webhook_request_failed', message: error.message }, 502);
  }

  if (!webhookResponse.ok) {
    return jsonResponse({
      ok: false,
      error: 'webhook_rejected',
      message: `Publish receiver returned HTTP ${webhookResponse.status}.`,
      status: webhookResponse.status,
    }, 502);
  }

  return jsonResponse({
    ok: true,
    message: action === 'schedule' ? 'Schedule publish request sent.' : 'Publish request sent.',
    idempotencyKey,
  });
}

export function onRequest(context) {
  if (context.request.method === 'POST') {
    return handlePost(context);
  }

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: jsonHeaders({ Allow: 'POST, OPTIONS' }) });
  }

  return jsonResponse({ ok: false, error: 'method_not_allowed', message: 'Use POST for publish requests.' }, 405, {
    Allow: 'POST, OPTIONS',
  });
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
  if (!DRAFT_ID_PATTERN.test(draft)) return '';
  if (draft.includes('/') || draft.includes('\\') || draft.includes('..')) return '';
  return draft.replace(/\.md$/i, '');
}

function normalizeAdditions(input) {
  const source = input.additions && typeof input.additions === 'object' && !Array.isArray(input.additions)
    ? input.additions
    : input;
  return {
    opening: normalizeAdditionText(source.opening ?? source.additionOpening ?? source['additions.opening']),
    middle: normalizeAdditionText(source.middle ?? source.mid ?? source.additionMiddle ?? source['additions.middle']),
    closing: normalizeAdditionText(source.closing ?? source.additionClosing ?? source['additions.closing']),
  };
}

function normalizeAdditionText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+$/gm, '')
    .trim()
    .slice(0, MAX_ADDITION_LENGTH);
}

function isPlausibleDateTime(value) {
  // Accept datetime-local values (YYYY-MM-DDTHH:mm) and ISO-ish strings with timezone/seconds.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value);
}

function parseHttpsWebhookUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${WEBHOOK_URL} must be a valid HTTPS URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${WEBHOOK_URL} must use HTTPS; refusing to send publish requests to non-HTTPS receivers.`);
  }

  return parsed;
}

async function createIdempotencyKey(draft, action, publishAt, additions = {}) {
  const operation = JSON.stringify({ draft, action, publishAt: publishAt || 'now', additions: pickAdditions(additions) });
  const digest = await sha256Hex(`factory-signal.review_publish:${operation}`);
  return `${draft}-${action}-${digest.slice(0, 32)}`.slice(0, 220);
}

function pickAdditions(additions) {
  return Object.fromEntries(ADDITION_KEYS.map((key) => [key, typeof additions[key] === 'string' ? additions[key] : '']));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders(headers),
  });
}

function jsonHeaders(headers = {}) {
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    ...headers,
  };
}
