import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditArticle,
  buildSeoAudit,
  suggestDescription,
  suggestRelatedArticles,
  suggestTitle,
} from '../src/lib/seo-audit.js';

const strongArticle = {
  slug: 'ai-vision-inspection-plan',
  title: 'AI Vision Inspection Needs a Manufacturing Measurement Plan',
  description: 'A practical manufacturing guide to AI vision inspection, covering defect definitions, lighting, sampling, metrology links, workflow, and drift monitoring.',
  pubDate: '2026-05-20T12:00:00.000Z',
  author: 'Factory Signal Editorial',
  tags: ['AI vision', 'inspection', 'metrology'],
  sourceUrls: ['https://www.nist.gov/metrology', 'https://www.automate.org/vision'],
  imageUrl: '/assets/images/vision.png',
  imageAlt: 'Camera inspecting a manufactured part on a factory line',
  body: `AI vision inspection helps factories make more consistent quality decisions, but it only works when the team defines the measurement plan first. The useful question is not whether a model can find pixels; it is whether the process can connect images to defects, operator action, and measurable risk.

## Practical implementation

Use controlled lighting, stable fixtures, reviewed labels, and a pilot workflow before expanding scope. According to NIST metrology guidance, measurement context matters.

## Tradeoffs and risks

False accepts, false rejects, drift, and operator overrides should be reviewed before production release.

See [robot cell interfaces](/articles/robot-cell-interfaces-before-arm/) for integration context.`,
};

const relatedArticle = {
  slug: 'robot-cell-interfaces-before-arm',
  title: 'Robot Cell Interfaces Matter Before the Robot Arm',
  description: 'A practical manufacturing guide to robot cell interfaces, safety, tooling, and production workflow decisions for automation teams.',
  pubDate: '2026-05-19T12:00:00.000Z',
  author: 'Factory Signal Editorial',
  tags: ['robotics', 'automation', 'inspection'],
  sourceUrls: ['https://www.nist.gov/'],
  imageUrl: '/assets/images/robot.png',
  imageAlt: 'Industrial robot cell with guarded production equipment',
  body: 'Robot automation projects need tooling, controls, inspection feedback, and operator workflow.\n\n## Practical implementation\n\nConnect the cell before optimizing the arm.',
};

test('auditArticle scores transparent search-quality signals', () => {
  const audit = auditArticle(strongArticle, [strongArticle, relatedArticle]);

  assert.equal(audit.slug, strongArticle.slug);
  assert.equal(audit.url, '/articles/ai-vision-inspection-plan/');
  assert.ok(audit.wordCount > 60);
  assert.ok(audit.headings.some((heading) => heading.text === 'Practical implementation'));
  assert.equal(audit.sourcesCount, 2);
  assert.equal(audit.image.hasAlt, true);
  assert.equal(audit.structuredDataReady, true);
  assert.ok(audit.score >= 80);
  assert.ok(audit.internalLinks.length >= 1);
});

test('buildSeoAudit detects duplicate titles and descriptions', () => {
  const duplicateOne = { ...strongArticle, slug: 'duplicate-one' };
  const duplicateTwo = { ...strongArticle, slug: 'duplicate-two' };
  const audit = buildSeoAudit([duplicateOne, duplicateTwo]);

  assert.equal(audit.totals.articleCount, 2);
  assert.equal(audit.totals.duplicateTitles, 1);
  assert.equal(audit.totals.duplicateDescriptions, 1);
  assert.ok(audit.articles.every((article) => article.issues.some((issue) => issue.code === 'title-duplicate')));
  assert.ok(audit.articles.every((article) => article.issues.some((issue) => issue.code === 'description-duplicate')));
});

test('weak article gets useful non-spam recommendations and deterministic suggestions', () => {
  const weakArticle = {
    slug: 'widget',
    title: 'Best Best Best Widget',
    description: 'Best widget best widget best widget.',
    tags: ['CNC'],
    body: 'In this article, we dive into widgets.\n\nShort body.',
  };
  const audit = auditArticle(weakArticle, [weakArticle, relatedArticle]);

  assert.ok(audit.score < 75);
  assert.ok(audit.issues.some((issue) => issue.code === 'title-repetitive' || issue.code === 'title-hype'));
  assert.ok(audit.issues.some((issue) => issue.code === 'intro-answer-first'));
  assert.ok(audit.issues.some((issue) => issue.code === 'sources-missing'));
  assert.match(suggestTitle(weakArticle), /CNC Guide/);
  assert.ok(suggestDescription(weakArticle).length <= 170);
  assert.ok(audit.recommendations.some((recommendation) => recommendation.code === 'suggested-title'));
});

test('related article suggestions use tag and entity overlap without already-linked pages', () => {
  const articleWithoutLinks = { ...strongArticle, body: strongArticle.body.replace(/\n\nSee \[robot cell interfaces\]\([^)]+\) for integration context\./, '') };
  const suggestions = suggestRelatedArticles(articleWithoutLinks, [articleWithoutLinks, relatedArticle], []);

  assert.equal(suggestions[0].slug, relatedArticle.slug);

  const suggestionsWithExistingLink = suggestRelatedArticles(strongArticle, [strongArticle, relatedArticle], [{ href: '/articles/robot-cell-interfaces-before-arm/' }]);
  assert.equal(suggestionsWithExistingLink.some((item) => item.slug === relatedArticle.slug), false);
});
