import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as onSaveRequest } from '../functions/review/save.js';
import { onRequest as onPublishRequest } from '../functions/review/publish.js';
import { onRequest as onSourcesRequest } from '../functions/review/sources.js';

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

test('review sources load/save use signed receiver webhook and fail closed without config', async () => {
  const html = await onSourcesRequest({
    env: {},
    request: new Request('https://factory-signal.example/review/sources/', { method: 'GET', headers: { Accept: 'text/html,application/xhtml+xml' } }),
    next: () => new Response('<!doctype html><title>Watched sources</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
  });
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Watched sources/);

  const missing = await onSourcesRequest({
    env: {},
    request: new Request('https://factory-signal.example/review/sources', { method: 'GET', headers: { Accept: 'application/json' } }),
  });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, 'sources_receiver_not_configured');

  const calls = [];
  await withFetchMock(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ ok: true, sources: [{ name: 'Test feed', type: 'rss', topic: 'CNC', url: 'https://example.com/feed.xml', enabled: true }], savedAt: '2026-05-20T00:00:00.000Z' }, 200);
  }, async () => {
    const response = await onSourcesRequest({
      env,
      request: jsonRequest('https://factory-signal.example/review/sources', {
        action: 'save',
        sources: [{ name: 'Test feed', type: 'rss', topic: 'CNC', url: 'https://example.com/feed.xml', enabled: true }],
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.sources[0].name, 'Test feed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, env.FS_REVIEW_PUBLISH_WEBHOOK_URL);
    assert.equal(calls[0].options.headers['X-Factory-Signal-Event'], 'factory_signal.review_sources_request');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.event, 'factory_signal.review_sources_request');
    assert.equal(body.sources[0].type, 'rss');
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