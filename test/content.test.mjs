import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPublishMetadata, buildDailyTakeaway, getPinnedArticles, isVideoStory, isWhitepaperStory, parseArticleMarkdown, parseBriefing, parseFeedDate } from '../src/lib/content.js';

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

test('parseFeedDate preserves date-only noon UTC behavior and accepts full ISO timestamps', () => {
  assert.equal(parseFeedDate('2026-05-19').toISOString(), '2026-05-19T12:00:00.000Z');
  assert.equal(parseFeedDate('2026-05-20T14:36:39.239Z').toISOString(), '2026-05-20T14:36:39.239Z');
});

test('parseFeedDate falls back for missing or invalid dates', () => {
  const fallback = new Date('2026-05-20T12:00:00.000Z');

  assert.equal(parseFeedDate('', fallback).toISOString(), '2026-05-20T12:00:00.000Z');
  assert.equal(parseFeedDate('not-a-date', fallback).toISOString(), '2026-05-20T12:00:00.000Z');
});

test('parseArticleMarkdown normalizes hero image frontmatter aliases', () => {
  const article = parseArticleMarkdown('image-alias.md', `---\ntitle: Image alias\npubDate: 2026-05-20T12:00:00.000Z\nheroImage: https://example.com/hero.jpg\nalt: Robot cell image\n---\n\nBody.`);

  assert.equal(article.imageUrl, 'https://example.com/hero.jpg');
  assert.equal(article.imageAlt, 'Robot cell image');
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

test('isVideoStory requires explicit video media indicators', () => {
  assert.equal(isVideoStory({ title: 'A related product resource', url: 'https://example.com/resource', sectionTitle: 'YouTube' }), false);
  assert.equal(isVideoStory({ title: 'Factory walkthrough', url: 'https://www.youtube.com/watch?v=abc123', sectionTitle: 'YouTube' }), true);
  assert.equal(isVideoStory({ title: 'Embedded demo', embedUrl: 'https://player.vimeo.com/video/123', sectionTitle: 'News' }), true);
  assert.equal(isVideoStory({ title: 'Reddit video is still community content', url: 'https://v.redd.it/abc123', sectionTitle: 'Reddit' }), false);
});

test('isWhitepaperStory catches paper resources while excluding Reddit/community noise', () => {
  assert.equal(isWhitepaperStory({ title: 'VoxelMatters Polymer AM Focus 2026 eBook', source: '3D Printing Media', sectionTitle: 'News' }), true);
  assert.equal(isWhitepaperStory({ title: 'VoxelMatters lists polymer AM paper on qualification', source: 'VoxelMatters', sectionTitle: 'News' }), true);
  assert.equal(isWhitepaperStory({ title: 'Download metal AM whitepaper', url: 'https://example.com/am-whitepaper.pdf', sectionTitle: 'News' }), true);
  assert.equal(isWhitepaperStory({ title: 'A new technical paper on 3D-stacked memory', source: 'Semiconductor Engineering', sectionTitle: 'News' }), true);
  assert.equal(isWhitepaperStory({ title: 'X-ray study reveals how microscopic pores drive fractures in 3D printed metals', source: '3D Printing Media', body: 'Researchers published a study in the Journal of Materials Research.', sectionTitle: 'News' }), true);
  assert.equal(isWhitepaperStory({ title: 'Packaging supplier lists paper products for factories', source: 'Automation News', sectionTitle: 'News' }), false);
  assert.equal(isWhitepaperStory({ title: '2026 RBR50 Robotics Innovation Awards', url: 'https://www.therobotreport.com/rbr50-2026-report/', source: 'Robotics Business Review', sectionTitle: 'News' }), false);
  assert.equal(isWhitepaperStory({ title: 'Johnson & Johnson completes clinical study for OTTAVA robotic surgical system', source: 'The Robot Report', body: 'Johnson & Johnson said it demonstrated feasibility in a clinical study.', sectionTitle: 'News' }), false);
  assert.equal(isWhitepaperStory({ title: 'Case Study: How an Enterprise Tech Team Went from Dozens to 2,000+ Fine-Tuning Configurations', source: 'Edge AI and Vision Alliance', body: 'The use case explains a deployment.', sectionTitle: 'News' }), false);
  assert.equal(isWhitepaperStory({ title: 'US programmer job growth nearly halved since ChatGPT launched, Fed study finds', source: 'The Decoder', body: 'A new study provides evidence of labor-market changes.', sectionTitle: 'News' }), false);
  assert.equal(isWhitepaperStory({ title: 'Reddit thread mentions a paper', source: 'Reddit', sectionTitle: 'Reddit' }), false);
  assert.equal(isWhitepaperStory({ title: 'Factory robots improve throughput', source: 'Automation News', body: 'Integrator shares deployment notes.', sectionTitle: 'News' }), false);
});

test('parseBriefing drops non-video items from YouTube section', () => {
  const briefing = parseBriefing('2026-05-19.md', `# Factory Signal Briefing - 2026-05-19
> Advanced Manufacturing · 3D Printing · CNC · Robotics · AI Vision
> Generated: 12:00:00

---

## 📺 YouTube Worth Watching

### [Actual machining video](https://www.youtube.com/watch?v=abc123)
**Channel:** Machine Shop | **Topic:** CNC  
**Rating:** ★★★★☆ 4.5/5.0 | **Views:** 1,200
**Duration:** 8:42

> A CNC setup walkthrough.

---

### [Related vendor download](https://example.com/whitepaper.pdf)
**Channel:** Vendor Resource | **Topic:** CNC  
**Rating:** ★★★★☆ 4.1/5.0

> A download that was accidentally placed in the video section.

---
`);

  const youtube = briefing.sections.find((section) => section.title === 'YouTube');
  assert.deepEqual(youtube.items.map((item) => item.title), ['Actual machining video']);
});
