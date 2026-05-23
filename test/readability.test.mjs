import test from 'node:test';
import assert from 'node:assert/strict';
import { readabilityReview, isReadableDraft } from '../src/lib/readability.js';

test('readability review accepts plain manufacturing copy with useful terms', () => {
  const draft = {
    title: 'Robot cell setup needs clear handoffs',
    description: 'A short guide for shops that add a robot cell.',
    body: [
      'A robot cell needs more than a robot arm.',
      'The shop needs a safe gate, a clear part handoff, and a trained worker.',
      'Use inspection data to prove the cell can make good parts each shift.',
    ].join('\n\n'),
  };

  assert.equal(isReadableDraft(draft), true);
  assert.deepEqual(readabilityReview(draft).warnings, []);
});

test('readability review flags long sentence and paragraph patterns without blocking technical words', () => {
  const draft = {
    title: 'Hard draft',
    body: 'Manufacturers evaluating additive manufacturing qualification programs should coordinate engineering, operations, purchasing, inspection, maintenance, supplier management, documentation, risk review, customer approval teams, plant finance teams, machine vendors, and outside auditors before committing production capacity to new part families. This is a short sentence.\n\n' +
      'The team wrote a very long paragraph. '.repeat(40),
  };

  const review = readabilityReview(draft);
  assert.ok(review.warnings.includes('very-long-sentence'));
  assert.ok(review.warnings.includes('long-paragraph'));
  assert.equal(review.warnings.includes('many-long-words'), false);
});
