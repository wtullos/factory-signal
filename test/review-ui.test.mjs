import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reviewPagePath = new URL('../src/pages/review/[...slug].astro', import.meta.url);

test('review page keeps draft editing inline and removes Wes review copy block', async () => {
  const source = await readFile(reviewPagePath, 'utf8');

  assert.doesNotMatch(source, /Draft edits and Wes review edits/);
  assert.doesNotMatch(source, /Opening note|Mid-article note|Closing note/);
  assert.doesNotMatch(source, /Full Markdown body/);
  assert.doesNotMatch(source, /data-personal-additions/);

  assert.match(source, /data-review-editor/);
  assert.match(source, /data-draft-edit="title"/);
  assert.match(source, /data-draft-edit="author"/);
  assert.match(source, /data-draft-edit="body"/);
  assert.match(source, /<section class="body-preview markdown-body-editor">/);
});
