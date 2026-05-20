import assert from 'node:assert/strict';
import test from 'node:test';

import { subredditNameFromSource } from '../scripts/generate-daily-briefing.mjs';

test('subreddit sources prefer subreddit parsed from URL over friendly name', () => {
  assert.equal(
    subredditNameFromSource({
      name: 'Machining Forum',
      url: 'https://www.reddit.com/r/Machining/',
    }),
    'Machining',
  );
});

test('subreddit sources fall back to name when URL does not contain a subreddit', () => {
  assert.equal(
    subredditNameFromSource({
      name: 'r/CNC',
      url: 'https://example.com/not-reddit',
    }),
    'CNC',
  );
});
