import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as onSaveRequest } from '../functions/review/save.js';
import { onRequest as onPublishRequest } from '../functions/review/publish.js';

const env = {
  FS_REVIEW_PUBLISH_WEBHOOK_URL: 'https://receiver.example.com/factory-signal/review-publish',
  FS_REVIEW_PUBLISH_WEBHOOK_SECRET: 'unit-test-secret',
};

test('review save retries transient webhook failures before succeeding', async () => {
  const calls = [];
  await withFetchMock(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new Error('tunnel unavailable');
    if (calls.length === 2) return jsonResponse({ ok: false }, 502);
    return jsonResponse({ ok: true, savedAt: '2026-05-19T00:00:00.000Z', reviewEdits: { opening: 'Saved', middle: '', closing: '' } }, 200);
  }, async () => {
    const response = await onSaveRequest({
      env,
      request: jsonRequest('https://factory-signal.example/review/save', {
        draft: 'sample-draft',
        action: 'save',
        reviewEdits: { opening: 'Saved' },
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.savedAt, '2026-05-19T00:00:00.000Z');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, env.FS_REVIEW_PUBLISH_WEBHOOK_URL);
    assert.equal(calls[0].options.headers['X-Factory-Signal-Event'], 'factory_signal.review_save_request');
  });
});

test('review save does not retry fail-closed client-side webhook rejections', async () => {
  const calls = [];
  await withFetchMock(async () => {
    calls.push(true);
    return jsonResponse({ ok: false, message: 'bad signature' }, 401);
  }, async () => {
    const response = await onSaveRequest({
      env,
      request: jsonRequest('https://factory-signal.example/review/save', { draft: 'sample-draft', action: 'save' }),
    });

    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.error, 'webhook_rejected');
    assert.equal(payload.status, 401);
    assert.equal(calls.length, 1);
  });
});

test('review publish retries transient webhook 5xx before succeeding', async () => {
  const calls = [];
  await withFetchMock(async () => {
    calls.push(true);
    if (calls.length === 1) return jsonResponse({ ok: false }, 503);
    return jsonResponse({ ok: true }, 202);
  }, async () => {
    const response = await onPublishRequest({
      env,
      request: jsonRequest('https://factory-signal.example/review/publish', {
        draft: 'sample-draft',
        action: 'publish_now',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(calls.length, 2);
  });
});

function jsonRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'node-test' },
    body: JSON.stringify(body),
  });
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function withFetchMock(mock, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}