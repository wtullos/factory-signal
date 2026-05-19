#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

export const DEFAULT_ROUTE = '/factory-signal/review-publish';
export const EVENT_NAME = 'factory_signal.review_publish_request';

const DRAFT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}(?:\.md)?$/;
const DEFAULT_PORT = 8765;
const DEFAULT_FRESHNESS_SECONDS = 300;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_STATE_DIR = path.join('.hermes', 'review-publish-receiver');

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = startReceiver({ env: process.env, cwd: process.cwd() });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export function startReceiver(options = {}) {
  const config = readConfig(options);
  if (!config.secret) {
    throw new Error('FS_REVIEW_PUBLISH_WEBHOOK_SECRET is required.');
  }
  ensureState(config);
  loadScheduledJobs(config);

  const server = http.createServer((req, res) => {
    handleRequest(req, res, config).catch((error) => {
      config.log.error('[receiver] unhandled_error', error);
      sendJson(res, 500, { ok: false, error: 'internal_error' });
    });
  });

  server.listen(config.port, config.host, () => {
    config.log.info(`[receiver] listening on http://${config.host}:${config.port}${config.route}`);
    config.log.info(`[receiver] mode=${config.execute ? 'EXECUTE' : 'DRY_RUN'} stateDir=${config.stateDir}`);
  });

  return server;
}

export async function handleRequest(req, res, config) {
  if (req.method === 'GET' && req.url === '/healthz') {
    return sendJson(res, 200, { ok: true, service: 'factory-signal-review-publish-receiver' });
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== config.route) {
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  if (!config.secret) {
    return sendJson(res, 503, { ok: false, error: 'missing_secret', message: 'Set FS_REVIEW_PUBLISH_WEBHOOK_SECRET.' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req, config.maxBodyBytes);
  } catch (error) {
    return sendJson(res, error.status || 400, { ok: false, error: error.code || 'invalid_body', message: error.message });
  }

  const verification = verifyWebhook(req.headers, rawBody, config);
  if (!verification.ok) {
    return sendJson(res, verification.status, { ok: false, error: verification.error, message: verification.message });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'invalid_json' });
  }

  const normalized = normalizePayload(payload, req.headers);
  if (!normalized.ok) {
    return sendJson(res, 400, { ok: false, error: normalized.error, message: normalized.message });
  }

  const idempotencyKey = String(req.headers['x-factory-signal-idempotency-key'] || payload.idempotencyKey || '').trim();
  const claim = claimIdempotencyKey(config, idempotencyKey, normalized.value);
  if (!claim.ok) {
    return sendJson(res, claim.status, { ok: false, error: claim.error, message: claim.message });
  }
  if (claim.duplicate) {
    return sendJson(res, 200, { ok: true, duplicate: true, idempotencyKey, status: claim.record.status });
  }

  const requestRecord = { ...normalized.value, idempotencyKey, receivedAt: new Date().toISOString(), execute: config.execute };
  if (requestRecord.action === 'schedule') {
    const scheduled = schedulePublish(config, requestRecord);
    updateIdempotencyRecord(config, idempotencyKey, { status: 'scheduled', scheduledFor: scheduled.publishAt });
    return sendJson(res, 202, { ok: true, scheduled: true, execute: config.execute, idempotencyKey, publishAt: scheduled.publishAt });
  }

  runPublishWorkflow(config, requestRecord, idempotencyKey).catch((error) => {
    config.log.error(`[receiver] workflow_failed idempotencyKey=${idempotencyKey}`, error);
  });

  return sendJson(res, 202, { ok: true, accepted: true, execute: config.execute, idempotencyKey });
}

export function verifyWebhook(headers, rawBody, config) {
  const event = String(headers['x-factory-signal-event'] || '').trim();
  if (event !== EVENT_NAME) return { ok: false, status: 400, error: 'invalid_event', message: `Expected ${EVENT_NAME}.` };

  const timestamp = String(headers['x-factory-signal-timestamp'] || '').trim();
  const timestampMs = Date.parse(timestamp);
  if (!timestamp || Number.isNaN(timestampMs)) return { ok: false, status: 400, error: 'invalid_timestamp', message: 'Missing or invalid timestamp.' };

  const skewSeconds = Math.abs(Date.now() - timestampMs) / 1000;
  if (skewSeconds > config.freshnessSeconds) {
    return { ok: false, status: 401, error: 'stale_timestamp', message: `Timestamp skew exceeds ${config.freshnessSeconds} seconds.` };
  }

  const signature = String(headers['x-factory-signal-signature'] || '').trim();
  if (!signature.startsWith('sha256=')) return { ok: false, status: 401, error: 'missing_signature', message: 'Missing sha256 signature.' };

  const expected = hmacSha256(config.secret, `${timestamp}.${rawBody}`);
  const provided = signature.slice('sha256='.length);
  if (!safeEqualHex(provided, expected)) return { ok: false, status: 401, error: 'bad_signature', message: 'Signature verification failed.' };

  return { ok: true };
}

export function normalizePayload(payload, headers = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'invalid_payload', message: 'JSON body must be an object.' };
  }

  const bodyEvent = String(payload.event || '').trim();
  if (bodyEvent && bodyEvent !== EVENT_NAME) return { ok: false, error: 'invalid_event', message: `Body event must be ${EVENT_NAME}.` };

  const draft = normalizeDraftIdentifier(payload.draft || payload.slug || payload.file || payload.filename);
  if (!draft) {
    return { ok: false, error: 'invalid_draft', message: 'Draft must be a simple slug/filename with no path separators.' };
  }

  const action = String(payload.action || '').trim();
  if (action !== 'publish_now' && action !== 'schedule') {
    return { ok: false, error: 'invalid_action', message: 'Action must be publish_now or schedule.' };
  }

  let publishAt = '';
  if (action === 'schedule') {
    publishAt = String(payload.publishAt || payload.publish_at || '').trim();
    const publishAtMs = Date.parse(publishAt);
    if (!publishAt || Number.isNaN(publishAtMs)) return { ok: false, error: 'invalid_publish_at', message: 'publishAt must be a parseable date/time.' };
    if (publishAtMs <= Date.now()) return { ok: false, error: 'publish_at_in_past', message: 'publishAt must be in the future.' };
  }

  const idempotencyKey = String(headers['x-factory-signal-idempotency-key'] || payload.idempotencyKey || '').trim();
  if (!/^[a-zA-Z0-9._:-]{8,240}$/.test(idempotencyKey)) {
    return { ok: false, error: 'invalid_idempotency_key', message: 'Missing or invalid idempotency key.' };
  }

  return {
    ok: true,
    value: {
      event: EVENT_NAME,
      action,
      draft,
      title: stringOrEmpty(payload.title),
      publishAt,
      requestedAt: stringOrEmpty(payload.requestedAt),
      source: payload.source && typeof payload.source === 'object' ? payload.source : undefined,
    },
  };
}

export async function runPublishWorkflow(config, requestRecord, idempotencyKey) {
  updateIdempotencyRecord(config, idempotencyKey, { status: config.execute ? 'processing' : 'dry_run', startedAt: new Date().toISOString() });

  try {
    if (!config.execute) {
      config.log.info(`[receiver] dry_run draft=${requestRecord.draft} action=${requestRecord.action} idempotencyKey=${idempotencyKey}`);
      updateIdempotencyRecord(config, idempotencyKey, { status: 'dry_run_complete', finishedAt: new Date().toISOString() });
      return;
    }

    await runCommand(config, 'node', ['scripts/publish-draft.mjs', requestRecord.draft]);
    await runCommand(config, 'npm', ['run', 'build']);
    await runCommand(config, 'git', ['add', 'content/articles', 'public/generated-images']);

    const commitMessage = `Publish review draft: ${requestRecord.draft}`;
    await runCommand(config, 'git', ['commit', '-m', commitMessage]);
    const commitHash = (await runCommand(config, 'git', ['rev-parse', 'HEAD'], { capture: true })).trim();

    await runCommand(config, 'npx', [
      'wrangler', 'pages', 'deploy', 'dist',
      '--project-name', 'factory-signal',
      '--branch', 'main',
      '--commit-hash', commitHash,
      '--commit-message', commitMessage,
    ]);

    updateIdempotencyRecord(config, idempotencyKey, { status: 'succeeded', commitHash, finishedAt: new Date().toISOString() });
  } catch (error) {
    updateIdempotencyRecord(config, idempotencyKey, { status: 'failed', error: error.message, finishedAt: new Date().toISOString() });
    throw error;
  }
}

function schedulePublish(config, requestRecord) {
  const publishAtMs = Date.parse(requestRecord.publishAt);
  const job = { ...requestRecord, status: 'scheduled' };
  const file = scheduledJobPath(config, requestRecord.idempotencyKey);
  writeJsonAtomic(file, job);
  armScheduledJob(config, job, Math.max(0, publishAtMs - Date.now()));
  config.log.info(`[receiver] scheduled draft=${requestRecord.draft} publishAt=${requestRecord.publishAt} execute=${config.execute}`);
  return job;
}

function loadScheduledJobs(config) {
  const dir = path.join(config.stateDir, 'scheduled');
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const job = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
      if (job?.idempotencyKey && job?.publishAt && Date.parse(job.publishAt) > Date.now()) {
        armScheduledJob(config, job, Date.parse(job.publishAt) - Date.now());
      }
    } catch (error) {
      config.log.error(`[receiver] failed_to_load_scheduled_job ${entry}`, error);
    }
  }
}

function armScheduledJob(config, job, delayMs) {
  const maxDelay = 2 ** 31 - 1;
  setTimeout(() => {
    if (delayMs > maxDelay) return armScheduledJob(config, job, delayMs - maxDelay);
    runPublishWorkflow(config, { ...job, action: 'publish_now' }, job.idempotencyKey)
      .then(() => fs.rmSync(scheduledJobPath(config, job.idempotencyKey), { force: true }))
      .catch((error) => config.log.error(`[receiver] scheduled_workflow_failed idempotencyKey=${job.idempotencyKey}`, error));
  }, Math.min(delayMs, maxDelay)).unref();
}

function readConfig({ env = process.env, cwd = process.cwd(), log = console } = {}) {
  return {
    cwd,
    log,
    host: env.FS_REVIEW_RECEIVER_HOST || '127.0.0.1',
    port: Number.parseInt(env.FS_REVIEW_RECEIVER_PORT || `${DEFAULT_PORT}`, 10),
    route: env.FS_REVIEW_RECEIVER_ROUTE || DEFAULT_ROUTE,
    secret: env.FS_REVIEW_PUBLISH_WEBHOOK_SECRET || '',
    execute: env.FS_REVIEW_RECEIVER_EXECUTE === 'true',
    stateDir: path.resolve(cwd, env.FS_REVIEW_RECEIVER_STATE_DIR || DEFAULT_STATE_DIR),
    freshnessSeconds: Number.parseInt(env.FS_REVIEW_RECEIVER_FRESHNESS_SECONDS || `${DEFAULT_FRESHNESS_SECONDS}`, 10),
    maxBodyBytes: Number.parseInt(env.FS_REVIEW_RECEIVER_MAX_BODY_BYTES || `${DEFAULT_MAX_BODY_BYTES}`, 10),
  };
}

function ensureState(config) {
  fs.mkdirSync(path.join(config.stateDir, 'idempotency'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(config.stateDir, 'scheduled'), { recursive: true, mode: 0o700 });
}

function claimIdempotencyKey(config, key, payload) {
  const file = idempotencyPath(config, key);
  const now = new Date().toISOString();
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ key, status: 'accepted', acceptedAt: now, payload }, null, 2));
    fs.closeSync(fd);
    return { ok: true };
  } catch (error) {
    if (error.code === 'EEXIST') {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ok: true, duplicate: true, record };
    }
    return { ok: false, status: 500, error: 'idempotency_store_error', message: error.message };
  }
}

function updateIdempotencyRecord(config, key, patch) {
  const file = idempotencyPath(config, key);
  let record = { key };
  if (fs.existsSync(file)) record = JSON.parse(fs.readFileSync(file, 'utf8'));
  writeJsonAtomic(file, { ...record, ...patch });
}

function idempotencyPath(config, key) {
  return path.join(config.stateDir, 'idempotency', `${hashName(key)}.json`);
}

function scheduledJobPath(config, key) {
  return path.join(config.stateDir, 'scheduled', `${hashName(key)}.json`);
}

function hashName(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hmacSha256(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function safeEqualHex(a, b) {
  if (!/^[a-fA-F0-9]+$/.test(a) || !/^[a-fA-F0-9]+$/.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeDraftIdentifier(value) {
  const draft = String(value || '').trim();
  if (!DRAFT_ID_PATTERN.test(draft)) return '';
  if (draft.includes('/') || draft.includes('\\') || draft.includes('..')) return '';
  return draft.replace(/\.md$/i, '');
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const error = new Error(`Body exceeds ${maxBytes} bytes.`);
        error.status = 413;
        error.code = 'body_too_large';
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function runCommand(config, command, args, options = {}) {
  config.log.info(`[receiver] $ ${[command, ...args].join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: config.cwd, stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell: false });
    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(options.capture ? stdout : undefined);
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}${stderr ? `: ${stderr}` : ''}`));
    });
  });
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  res.end(JSON.stringify(payload));
}
