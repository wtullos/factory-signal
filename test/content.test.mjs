import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPublishMetadata, buildDailyTakeaway, getPinnedArticles, parseArticleMarkdown } from '../src/lib/content.js';

test('applyPublishMetadata materializes published status, pubDate, and 24-hour pinnedUntil', () => {
  const raw = `---\ntitle: Sample Article\nslug: sample-article\nstatus: draft\n---\n\nBody.`;
  const publishedAt = new Date('2026-05-19T18:00:00.000Z');
  const updated = applyPublishMetadata(raw, publishedAt);
  const article = parseArticleMarkdown('sample-article.md', updated);

  assert.equal(article.status, 'published');
  assert.equal(article.pubDate, '2026-05-19T18:00:00.000Z');
  assert.equal(article.pinnedUntil, '2026-05-20T18:00:00.000Z');
});

test('getPinnedArticles includes only articles still inside their pinned window', () => {
  const active = parseArticleMarkdown('active.md', `---\ntitle: Active\npubDate: 2026-05-19T17:00:00.000Z\npinnedUntil: 2026-05-20T18:00:00.000Z\n---\n\nActive body.`);
  const expired = parseArticleMarkdown('expired.md', `---\ntitle: Expired\npubDate: 2026-05-18T17:00:00.000Z\npinnedUntil: 2026-05-19T18:00:00.000Z\n---\n\nExpired body.`);

  assert.deepEqual(getPinnedArticles([expired, active], new Date('2026-05-20T12:00:00.000Z')).map((article) => article.title), ['Active']);
  assert.deepEqual(getPinnedArticles([active], new Date('2026-05-20T18:00:00.000Z')), []);
});

test('buildDailyTakeaway summarizes day-level concepts rather than individual story text', () => {
  const briefing = {
    date: '2026-05-19',
    slug: '2026-05-19',
    deck: 'Advanced Manufacturing · 3D Printing · CNC · Robotics · AI Vision',
    sections: [
      {
        title: 'News',
        items: [
          { title: 'Robot vision cell improves inspection', source: 'Automation News', topic: 'Robotics', score: '4.7', body: 'AI vision and robot automation for inspection.' },
          { title: 'CNC setup checklist reduces scrap', source: 'Machining Weekly', topic: 'CNC', score: '4.6', body: 'Tooling and fixturing matter.' },
          { title: 'Additive fixture design', source: '3DP Journal', topic: '3D Printing', score: '4.4', body: 'Printed fixtures need calibration.' },
        ],
      },
      {
        title: 'Reddit',
        items: [{ title: 'How do I pick a printer?', source: 'Reddit', topic: '3D Printing', score: '4.0', body: 'Beginner adoption friction.' }],
      },
    ],
  };

  const takeaway = buildDailyTakeaway(briefing);
  assert.equal(takeaway.storyCount, 4);
  assert.equal(takeaway.communityCount, 1);
  assert.ok(takeaway.topTopics.includes('Robotics'));
  assert.ok(takeaway.lessons.some((lesson) => lesson.concept === 'Patterns beat isolated headlines'));
  assert.ok(takeaway.lessons.some((lesson) => lesson.concept === 'Automation value is usually integration value'));
  assert.ok(takeaway.lessons.some((lesson) => lesson.concept === 'Community questions expose adoption friction'));
});
