import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startReceiver, DEFAULT_ROUTE, EVENT_NAME, SAVE_EVENT_NAME, normalizeAdditions, applyPersonalAdditionsToMarkdown, applyReviewEditsToMarkdown, applyDraftEditsToMarkdown } from '../scripts/review-publish-receiver.mjs';

const secret = 'unit-test-secret';

test('accepts a signed publish_now webhook in dry-run mode and persists idempotency', async () => {
  const fixture = await createServerFixture();
  try {
    const payload = {
      event: EVENT_NAME,
      action: 'publish_now',
      draft: 'sample-draft',
      reviewEdits: {
        opening: 'Opening perspective',
        middle: 'Shop-floor angle',
        closing: 'Closing takeaway',
      },
      requestedAt: new Date().toISOString(),
      idempotencyKey: 'sample-draft-publish-now-0001',
    };

    const first = await postSigned(fixture.url, payload, payload.idempotencyKey);
    assert.equal(first.status, 202);
    const firstJson = await first.json();
    assert.equal(firstJson.ok, true);
    assert.equal(firstJson.execute, false);

    const record = await waitForStatus(fixture.stateDir, 'dry_run_complete');
    assert.deepEqual(record.payload.reviewEdits, payload.reviewEdits);

    const duplicate = await postSigned(fixture.url, payload, payload.idempotencyKey);
    assert.equal(duplicate.status, 200);
    const duplicateJson = await duplicate.json();
    assert.equal(duplicateJson.duplicate, true);
  } finally {
    await closeServer(fixture.server);
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }
});

test('rejects bad signatures before accepting a webhook', async () => {
  const fixture = await createServerFixture();
  try {
    const payload = {
      event: EVENT_NAME,
      action: 'publish_now',
      draft: 'sample-draft',
      idempotencyKey: 'sample-draft-publish-now-0002',
    };
    const body = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const response = await fetch(fixture.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Factory-Signal-Event': EVENT_NAME,
        'X-Factory-Signal-Timestamp': timestamp,
        'X-Factory-Signal-Idempotency-Key': payload.idempotencyKey,
        'X-Factory-Signal-Signature': 'sha256=deadbeef',
      },
      body,
    });

    assert.equal(response.status, 401);
    const json = await response.json();
    assert.equal(json.error, 'bad_signature');
  } finally {
    await closeServer(fixture.server);
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }
});

test('rejects stale timestamps and unsafe draft identifiers', async () => {
  const fixture = await createServerFixture();
  try {
    const stalePayload = {
      event: EVENT_NAME,
      action: 'publish_now',
      draft: 'sample-draft',
      idempotencyKey: 'sample-draft-publish-now-0003',
    };
    const stale = await postSigned(fixture.url, stalePayload, stalePayload.idempotencyKey, new Date(Date.now() - 60_000).toISOString());
    assert.equal(stale.status, 401);
    assert.equal((await stale.json()).error, 'stale_timestamp');

    const unsafePayload = {
      event: EVENT_NAME,
      action: 'publish_now',
      draft: '../secret',
      idempotencyKey: 'sample-draft-publish-now-0004',
    };
    const unsafe = await postSigned(fixture.url, unsafePayload, unsafePayload.idempotencyKey);
    assert.equal(unsafe.status, 400);
    assert.equal((await unsafe.json()).error, 'invalid_draft');
  } finally {
    await closeServer(fixture.server);
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }
});

test('accepts a signed future schedule request without executing immediately', async () => {
  const fixture = await createServerFixture();
  try {
    const payload = {
      event: EVENT_NAME,
      action: 'schedule',
      draft: 'sample-draft',
      publishAt: new Date(Date.now() + 3_600_000).toISOString(),
      reviewEdits: { opening: 'Scheduled opener', middle: '', closing: 'Scheduled closer' },
      draftEdits: { title: 'Scheduled title', author: 'Factory Signal Test', body: 'Scheduled body.' },
      idempotencyKey: 'sample-draft-schedule-0001',
    };

    const response = await postSigned(fixture.url, payload, payload.idempotencyKey);
    assert.equal(response.status, 202);
    const json = await response.json();
    assert.equal(json.scheduled, true);

    const scheduledDir = path.join(fixture.stateDir, 'scheduled');
    assert.equal(fs.readdirSync(scheduledDir).length, 1);
    const [scheduledFile] = fs.readdirSync(scheduledDir);
    const scheduledJob = JSON.parse(fs.readFileSync(path.join(scheduledDir, scheduledFile), 'utf8'));
    assert.deepEqual(scheduledJob.reviewEdits, { opening: 'Scheduled opener', middle: '', closing: 'Scheduled closer' });
    assert.deepEqual(scheduledJob.draftEdits, { title: 'Scheduled title', author: 'Factory Signal Test', body: 'Scheduled body.' });
  } finally {
    await closeServer(fixture.server);
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }
});

test('normalizes and applies Wes review edits as natural markdown paragraphs', () => {
  const normalized = normalizeAdditions({
    opening: '  Opener\r\nwith detail  ',
    middle: 'M'.repeat(1300),
    closing: 123,
  });
  assert.equal(normalized.opening, 'Opener\nwith detail');
  assert.equal(normalized.middle.length, 1200);
  assert.equal(normalized.closing, '');

  const raw = `---\ntitle: Sample\nslug: sample\n---\n\nIntro paragraph.\n\n## First section\n\nFirst body.\n\n## Later section\n\nMore body.\n`;
  const updated = applyPersonalAdditionsToMarkdown(raw, {
    opening: 'Why this matters.',
    middle: 'Use this on the floor.\nWatch quality escapes.',
    closing: 'Bottom line.',
  });

  assert.match(updated, /^---\ntitle: Sample\nslug: sample\n---\nIntro paragraph\./);
  assert.match(updated, /Intro paragraph\.\n\nWhy this matters\./);
  assert.match(updated, /Use this on the floor\. Watch quality escapes\./);
  assert.match(updated, /Bottom line\.\n$/);
  assert.equal(updated.includes("Wes's opening note"), false);
  assert.equal(updated.includes('>'), false);
  assert.ok(updated.indexOf('Why this matters.') > updated.indexOf('Intro paragraph.'));
  assert.ok(updated.indexOf('Use this on the floor.') < updated.indexOf('## Later section'));
});

test('applies draft title, author, and markdown body edits to frontmatter and body', () => {
  const raw = `---\ntitle: Original title\nauthor: Old Author\nslug: sample\n---\n\nOld body.\n\n## Old section\n`;
  const updated = applyDraftEditsToMarkdown(raw, {
    title: 'Edited title: standard work wins',
    author: 'Factory Signal Editorial, Wes',
    body: 'New opening paragraph.\n\n## New section\n\nNew body.',
  });

  assert.match(updated, /^---\ntitle: "Edited title: standard work wins"\nauthor: "Factory Signal Editorial, Wes"\nslug: sample\n---\n/);
  assert.match(updated, /---\nNew opening paragraph\.\n\n## New section\n\nNew body\.\n$/);
  assert.equal(updated.includes('Original title'), false);
  assert.equal(updated.includes('Old Author'), false);
  assert.equal(updated.includes('Old body.'), false);
});

test('saves and loads review edits through signed receiver event', async () => {
  const fixture = await createServerFixture();
  try {
    const savePayload = {
      event: SAVE_EVENT_NAME,
      action: 'save',
      draft: 'sample-draft',
      reviewEdits: { opening: 'Opening: real plant context', middle: 'Middle: watch the handoff', closing: 'Closing: do the boring check' },
      draftEdits: { title: 'Edited title', author: 'Factory Signal Editorial, Wes', body: 'Edited **markdown** body.' },
      idempotencyKey: 'sample-draft-save-0001',
    };
    const save = await postSigned(fixture.url, savePayload, savePayload.idempotencyKey, new Date().toISOString(), SAVE_EVENT_NAME);
    assert.equal(save.status, 200);
    const saveJson = await save.json();
    assert.equal(saveJson.ok, true);
    assert.deepEqual(saveJson.draftEdits, savePayload.draftEdits);
    assert.deepEqual(saveJson.reviewEdits, savePayload.reviewEdits);

    const loadPayload = {
      event: SAVE_EVENT_NAME,
      action: 'load',
      draft: 'sample-draft',
      idempotencyKey: 'sample-draft-load-0001',
    };
    const load = await postSigned(fixture.url, loadPayload, loadPayload.idempotencyKey, new Date().toISOString(), SAVE_EVENT_NAME);
    assert.equal(load.status, 200);
    const loadJson = await load.json();
    assert.equal(loadJson.ok, true);
    assert.deepEqual(loadJson.draftEdits, savePayload.draftEdits);
    assert.deepEqual(loadJson.reviewEdits, savePayload.reviewEdits);
  } finally {
    await closeServer(fixture.server);
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }
});

test('deterministic natural cleanup strips labels and adds punctuation', () => {
  const raw = `Intro one\n\n## Body\n\nOriginal body`;
  const updated = applyReviewEditsToMarkdown(raw, { opening: 'Opening: no label please', closing: '> Closing: final check' });
  assert.match(updated, /Intro one\n\nno label please\./);
  assert.match(updated, /final check\./);
  assert.equal(updated.includes('Opening:'), false);
  assert.equal(updated.includes('>'), false);
});

async function createServerFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-review-receiver-'));
  const stateDir = path.join(tmp, 'state');
  const server = startReceiver({
    cwd: tmp,
    env: {
      FS_REVIEW_RECEIVER_HOST: '127.0.0.1',
      FS_REVIEW_RECEIVER_PORT: '0',
      FS_REVIEW_RECEIVER_STATE_DIR: stateDir,
      FS_REVIEW_PUBLISH_WEBHOOK_SECRET: secret,
      FS_REVIEW_RECEIVER_FRESHNESS_SECONDS: '5',
    },
    log: { info() {}, error() {} },
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { tmp, stateDir, server, url: `http://127.0.0.1:${port}${DEFAULT_ROUTE}` };
}

function postSigned(url, payload, idempotencyKey, timestamp = new Date().toISOString(), eventName = EVENT_NAME) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Factory-Signal-Event': eventName,
      'X-Factory-Signal-Timestamp': timestamp,
      'X-Factory-Signal-Idempotency-Key': idempotencyKey,
      'X-Factory-Signal-Signature': `sha256=${signature}`,
    },
    body,
  });
}

async function waitForStatus(stateDir, expected) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const files = fs.readdirSync(path.join(stateDir, 'idempotency'));
    for (const file of files) {
      const record = JSON.parse(fs.readFileSync(path.join(stateDir, 'idempotency', file), 'utf8'));
      if (record.status === expected) return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for idempotency status ${expected}`);
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
