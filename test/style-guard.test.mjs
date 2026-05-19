import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiTellContrastViolations, isDirectStyleItem } from '../src/lib/style-guard.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Factory Signal style guard catches AI-tell contrast formulas', () => {
  const examples = [
    'This is not a tooling update, it is a planning signal.',
    'The issue is not just machine uptime but repair access.',
    'This is not simply a robot launch.',
    'This is not merely software.',
    'This is not only about unit cost.',
    'The takeaway is not throughput but maintainability.',
    'It isn’t a dashboard but a workflow change.',
  ];

  for (const body of examples) {
    assert.notDeepEqual(aiTellContrastViolations({ title: 'Draft', body }), [], body);
  }
});

test('Factory Signal style guard allows direct manufacturing claims', () => {
  const draft = {
    title: 'Repair access now shapes downtime planning',
    description: 'Service constraints, parts availability, and documentation affect machine recovery time.',
    body: 'Manufacturers should track repair paths alongside uptime metrics because downtime now includes access to tools, parts, and vendor support.',
  };

  assert.equal(isDirectStyleItem(draft), true);
  assert.deepEqual(aiTellContrastViolations(draft), []);
});

test('style-guard CLI fails drafts with contrast framing and passes direct drafts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-signal-style-guard-'));

  try {
    const draftsDir = path.join(tempRoot, 'content', 'drafts');
    fs.mkdirSync(draftsDir, { recursive: true });
    fs.writeFileSync(path.join(draftsDir, 'bad.md'), `---
title: Bad draft
slug: bad-draft
description: This is not a tooling story, it is a service planning signal.
pubDate: 2026-05-19
---
# Bad draft

The issue is not just machine uptime but repair access.
`);

    const failResult = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'style-guard.mjs')], {
      cwd: tempRoot,
      encoding: 'utf8',
    });
    assert.notEqual(failResult.status, 0);
    assert.match(failResult.stderr, /Factory Signal style guard failed/);
    assert.match(failResult.stderr, /not-just/);

    fs.writeFileSync(path.join(draftsDir, 'bad.md'), `---
title: Direct draft
slug: direct-draft
description: Repair access changes downtime planning.
pubDate: 2026-05-19
---
# Direct draft

Machine recovery now depends on parts access, service documentation, and vendor support.
`);

    const passResult = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'style-guard.mjs')], {
      cwd: tempRoot,
      encoding: 'utf8',
    });
    assert.equal(passResult.status, 0, passResult.stderr);
    assert.match(passResult.stdout, /Factory Signal style guard passed/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('style-guard CLI checks Astro page copy by default', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-signal-style-guard-pages-'));

  try {
    const pagesDir = path.join(tempRoot, 'src', 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.writeFileSync(path.join(pagesDir, 'bad.astro'), `---\n---\n<h1>Learn the day, not just the stories</h1>\n`);

    const failResult = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'style-guard.mjs')], {
      cwd: tempRoot,
      encoding: 'utf8',
    });
    assert.notEqual(failResult.status, 0);
    assert.match(failResult.stderr, /src\/pages\/bad\.astro/);
    assert.match(failResult.stderr, /not-just/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
