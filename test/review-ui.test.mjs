import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reviewPagePath = new URL('../src/pages/review/[...slug].astro', import.meta.url);
const takeawaysPagePath = new URL('../src/pages/review/takeaways.astro', import.meta.url);
const sourcesPagePath = new URL('../src/pages/review/sources.astro', import.meta.url);

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

test('review page does not apply blank saved draft edits over existing article fields', async () => {
  const source = await readFile(reviewPagePath, 'utf8');

  assert.match(source, /const hasSavedDraftEditContent = \(draftEdits = \{\}, key\) =>/);
  assert.match(source, /typeof draftEdits\[key\] === 'string' && draftEdits\[key\]\.trim\(\)\.length > 0/);
  assert.match(source, /if \(key && hasSavedDraftEditContent\(draftEdits, key\)\) field\.value = draftEdits\[key\];/);
  assert.doesNotMatch(source, /if \(key && typeof draftEdits\[key\] === 'string'\) field\.value = draftEdits\[key\];/);
});

test('review backend has a protected editable sources tab in nav', async () => {
  const [reviewSource, takeawaysSource, sourcesSource] = await Promise.all([
    readFile(reviewPagePath, 'utf8'),
    readFile(takeawaysPagePath, 'utf8'),
    readFile(sourcesPagePath, 'utf8'),
  ]);

  assert.match(reviewSource, /href="\/review\/sources\/">Sources/);
  assert.match(takeawaysSource, /href="\/review\/sources\/">Sources/);
  assert.match(sourcesSource, /pathname="\/review\/sources\/" noindex=\{true\}/);
  assert.match(sourcesSource, /aria-current="page" href="\/review\/sources\/">Sources/);
  assert.match(sourcesSource, /data-sources-editor/);
  assert.match(sourcesSource, /data-add-source/);
  assert.match(sourcesSource, /data-remove-source/);
  assert.match(sourcesSource, /data-save-sources/);
  assert.match(sourcesSource, /\/review\/sources/);
});
