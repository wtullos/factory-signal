import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSchoolFriendlyItem, schoolFriendlyViolations } from '../src/lib/school-friendly.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('school-friendly guard rejects obvious unsafe items', () => {
  const unsafeExamples = [
    { title: 'NSFW image collection from the shop floor', body: 'adult content' },
    { title: 'How to build a homemade firearm with desktop tools' },
    { title: 'Graphic gore accident footage', body: 'contains bloodbath details' },
    { title: 'Online casino launches betting odds for robotics league' },
    { title: 'Drug cartel uses manufacturing supply chain' },
    { title: 'Neo-Nazi extremist manifesto printed on flyers' },
  ];

  for (const item of unsafeExamples) {
    assert.equal(isSchoolFriendlyItem(item), false, item.title);
    assert.ok(schoolFriendlyViolations(item).length > 0, item.title);
  }
});

test('school-friendly guard allows normal manufacturing language', () => {
  const safeExamples = [
    { title: 'Injection molding cell reduces scrap with robot tending', body: 'A screw feeder and vision inspection station improved cycle time.' },
    { title: 'Gun drill setup improves deep-hole machining accuracy', topic: 'CNC', body: 'Tooling, coolant, and fixturing tips for a school robotics sponsor.' },
    { title: 'Additive manufacturing class prints end-of-arm tooling', source: 'Robotics Business Review' },
    { title: 'Factory automation safety checklist for students', body: 'Guards, lockout procedures, and supervised labs.' },
  ];

  for (const item of safeExamples) {
    assert.equal(isSchoolFriendlyItem(item), true, item.title);
    assert.deepEqual(schoolFriendlyViolations(item), [], item.title);
  }
});

test('school-friendly guard rejects unsafe draft-shaped article fields', () => {
  const draft = {
    title: 'Robotics lab update',
    description: 'Clean copy in the deck.',
    body: 'Students reviewed fixturing and inspection notes.',
    sourceUrls: ['https://example.com/manufacturing/nsfw-case-study'],
    tags: ['automation', 'classroom'],
  };

  assert.equal(isSchoolFriendlyItem(draft), false);
  assert.deepEqual(schoolFriendlyViolations(draft), ['adult-sexual']);
});

test('rendered content getters exclude unsafe articles and parsed briefing items', async () => {
  const previousCwd = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-signal-school-friendly-'));

  try {
    fs.mkdirSync(path.join(tempRoot, 'content', 'articles'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'content', 'briefings'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'content', 'articles', 'safe.md'), `---
title: Safe robotics lab
slug: safe-robotics-lab
description: Students tune a robot tending cell.
pubDate: 2026-05-19
tags:
  - robotics
sourceUrls:
  - https://example.com/safe-robotics
---
# Safe robotics lab

Students tune a robot tending cell with supervised tooling.
`);
    fs.writeFileSync(path.join(tempRoot, 'content', 'articles', 'unsafe.md'), `---
title: Unsafe shop story
slug: unsafe-shop-story
description: NSFW material should never publish.
pubDate: 2026-05-19
tags:
  - automation
---
# Unsafe shop story

This draft includes NSFW material.
`);
    fs.writeFileSync(path.join(tempRoot, 'content', 'briefings', '2026-05-19.md'), `# Factory Signal Briefing - 2026-05-19
> Generated: 09:00:00
> Advanced Manufacturing · 3D Printing · CNC · Robotics · AI Vision

## 📰 News & Articles

### [Safe CNC fixture improves cycle time](https://example.com/safe-cnc)
**Source:** Manufacturing Daily | **Topic:** CNC | **Rating:** ★★★★★ 4.8/5.0

> A classroom-friendly fixture and inspection workflow improves uptime.

---

### [NSFW robot camera leak](https://example.com/unsafe)
**Source:** Example News | **Topic:** Robotics | **Rating:** ★★★★☆ 4.0/5.0

> This item contains NSFW material and should be filtered.

---
`);

    process.chdir(tempRoot);
    const content = await import(`../src/lib/content.js?school-friendly-test=${Date.now()}-${Math.random()}`);

    assert.deepEqual(content.getArticles().map((article) => article.slug), ['safe-robotics-lab']);
    assert.deepEqual(content.getAllStories().map((story) => story.title), ['Safe CNC fixture improves cycle time']);
    assert.deepEqual(content.getBriefings()[0].sections[0].items.map((story) => story.title), ['Safe CNC fixture improves cycle time']);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('publish-draft rejects unsafe drafts before moving them to articles', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-signal-publish-school-friendly-'));

  try {
    fs.mkdirSync(path.join(tempRoot, 'content', 'drafts'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'content', 'drafts', 'unsafe.md'), `---
title: Unsafe draft
slug: unsafe-draft
description: NSFW material should not publish.
pubDate: 2026-05-19
tags:
  - automation
---
# Unsafe draft

This draft includes NSFW material.
`);

    const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'publish-draft.mjs'), 'unsafe'], {
      cwd: tempRoot,
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /failed the school-friendly content guard/);
    assert.match(result.stderr, /adult-sexual/);
    assert.equal(fs.existsSync(path.join(tempRoot, 'content', 'drafts', 'unsafe.md')), true);
    assert.equal(fs.existsSync(path.join(tempRoot, 'content', 'articles', 'unsafe.md')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
