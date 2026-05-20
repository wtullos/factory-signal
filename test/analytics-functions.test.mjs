import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as collect } from '../functions/analytics/collect.js';
import { onRequestGet as summary } from '../functions/review/analytics/data.js';
import { normalizeAnalyticsEvent } from '../functions/_analytics-lib.js';

test('analytics collection is graceful without D1 binding', async () => {
  const response = await collect({
    env: {},
    request: new Request('https://thefactorysignal.com/analytics/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pageview', path: '/news/', title: 'News' }),
    }),
  });

  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.stored, false);
  assert.equal(body.reason, 'missing_d1_binding');
});

test('analytics summary is graceful without D1 binding', async () => {
  const response = await summary({ env: {} });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.configured, false);
  assert.equal(body.totals.totalEvents, 0);
  assert.equal(body.heatmap.days.length, 7);
});

test('analytics summary heatmap keeps zero-event cells at level 0 alongside active cells', async () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const date = today.toISOString().slice(0, 10);
  const db = createFakeD1({
    heatmapRows: [
      { date, hour: 14, events: 3 },
    ],
  });

  const response = await summary({ env: { ANALYTICS_DB: db } });
  assert.equal(response.status, 200);
  const body = await response.json();
  const day = body.heatmap.days.find((entry) => entry.date === date);

  assert.ok(day);
  assert.equal(body.heatmap.max, 3);
  assert.equal(day.hours[14].events, 3);
  assert.ok(day.hours[14].level > 0);
  assert.equal(day.hours[13].events, 0);
  assert.equal(day.hours[13].level, 0);
});

test('analytics event normalization removes offsite personal-ish request data', () => {
  const normalized = normalizeAnalyticsEvent({
    type: 'click',
    path: 'https://thefactorysignal.com/articles/example/?secret=nope',
    title: 'Example title',
    href: 'javascript:alert(1)',
    text: '  Read   more  ',
    ip: '203.0.113.1',
    userAgent: 'Unit Test Browser',
  }, new Date('2026-05-20T12:15:00.000Z'));

  assert.deepEqual(normalized, {
    type: 'click',
    path: '/articles/example/',
    title: 'Example title',
    href: '',
    text: 'Read more',
    date: '2026-05-20',
    hour: 12,
  });
});

test('analytics collection writes schema and event to D1 binding', async () => {
  const db = createFakeD1();
  const response = await collect({
    env: { ANALYTICS_DB: db },
    request: new Request('https://thefactorysignal.com/analytics/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pageview', path: '/', title: 'Factory Signal' }),
    }),
  });

  assert.equal(response.status, 202);
  assert.equal((await response.json()).stored, true);
  assert.ok(db.statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS analytics_events')));
  assert.equal(db.inserts.length, 1);
  assert.equal(db.inserts[0][0], 'pageview');
  assert.equal(db.inserts[0][1], '/');
});

function createFakeD1({ heatmapRows = [] } = {}) {
  const db = {
    statements: [],
    inserts: [],
    prepare(statement) {
      this.statements.push(statement.trim());
      const sql = statement.trim();
      return {
        bind: (...values) => ({
          run: async () => {
            this.inserts.push(values);
            return { success: true };
          },
        }),
        run: async () => ({ success: true }),
        first: async () => ({ totalEvents: this.inserts.length, pageviews: this.inserts.length, clicks: 0 }),
        all: async () => ({
          results: sql.includes('SELECT event_date AS date') ? heatmapRows : [],
        }),
      };
    },
  };
  return db;
}
