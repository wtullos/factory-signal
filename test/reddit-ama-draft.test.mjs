import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAmaDraftMarkdown, extractAmaSummary, redditJsonUrl } from '../scripts/generate-reddit-ama-draft.mjs';
import { parseArticleMarkdown } from '../src/lib/content.js';
import { getAmaContext, getAmaReviewBadgeLabel, getPersonalAdditionRecommendations, isRedditAmaDraft } from '../src/lib/review-prompts.js';
import { schoolFriendlyViolations } from '../src/lib/school-friendly.js';
import { aiTellContrastViolations } from '../src/lib/style-guard.js';

test('redditJsonUrl converts Reddit thread URLs to JSON listing URLs', () => {
  const url = redditJsonUrl('https://www.reddit.com/r/raspberry_pi/comments/abc123/example_ama/');
  assert.equal(url, 'https://www.reddit.com/r/raspberry_pi/comments/abc123/example_ama.json?limit=500&sort=top');
  assert.throws(() => redditJsonUrl('https://example.com/not-reddit'), /Expected a reddit\.com or redd\.it/);
});

test('extractAmaSummary finds top-level questions answered by the AMA author', () => {
  const summary = extractAmaSummary(sampleRedditJson(), { title: 'Raspberry Pi AMA: practical signals', qaLimit: 2 });

  assert.equal(summary.title, 'Raspberry Pi AMA: practical signals');
  assert.equal(summary.articleType, 'reddit-ama-summary');
  assert.equal(summary.author, 'raspberrypi_official');
  assert.equal(summary.subreddit, 'r/IAmA');
  assert.equal(summary.qaPairs.length, 2);
  assert.equal(summary.qaPairs[0].question, 'How should schools think about using Pi boards for machine vision labs?');
  assert.match(summary.qaPairs[0].answer, /start with supported camera modules/);
});

test('buildAmaDraftMarkdown writes school-friendly Reddit AMA frontmatter and body', () => {
  const summary = extractAmaSummary(sampleRedditJson(), { title: 'Raspberry Pi AMA: practical signals' });
  const markdown = buildAmaDraftMarkdown(summary, { date: '2026-05-19', sourceUrl: 'https://www.reddit.com/r/IAmA/comments/abc123/pi_ama/' });
  const article = parseArticleMarkdown('pi-ama.md', markdown, { dir: 'content/drafts' });

  assert.equal(article.articleType, 'reddit-ama-summary');
  assert.ok(article.tags.includes('reddit ama'));
  assert.ok(article.tags.includes('Raspberry Pi'));
  assert.deepEqual(schoolFriendlyViolations(article), []);
  assert.deepEqual(aiTellContrastViolations(article), []);
  assert.match(markdown, /## Key Q\/A takeaways/);
  assert.match(markdown, /Factory Signal angle/);
  assert.match(markdown, /Official thread: https:\/\/www\.reddit\.com\/r\/IAmA\/comments\/abc123\/pi_ama\//);
});

test('extractAmaSummary falls back to AMA preview when official answers are unavailable', () => {
  const summary = extractAmaSummary(sampleUnansweredRedditJson(), { previewQuestionLimit: 2 });

  assert.equal(summary.articleType, 'reddit-ama-preview');
  assert.match(summary.title, /^Reddit AMA preview:/);
  assert.equal(summary.qaPairs.length, 0);
  assert.equal(summary.previewQuestions.length, 2);
  assert.equal(summary.previewQuestions[0].question, 'What matters most for industrial users choosing between boards?');
});

test('buildAmaDraftMarkdown writes school-friendly AMA preview frontmatter and body', () => {
  const summary = extractAmaSummary(sampleUnansweredRedditJson(), { title: 'Raspberry Pi AMA questions to watch', previewQuestionLimit: 2 });
  const markdown = buildAmaDraftMarkdown(summary, { date: '2026-05-19', sourceUrl: 'https://reddit.com/r/engineering/comments/1tcyfvk/hello_rengineering_were_eben_upton_ceo_james/' });
  const article = parseArticleMarkdown('pi-ama-preview.md', markdown, { dir: 'content/drafts' });

  assert.equal(article.articleType, 'reddit-ama-preview');
  assert.ok(article.tags.includes('reddit ama'));
  assert.deepEqual(schoolFriendlyViolations(article), []);
  assert.deepEqual(aiTellContrastViolations(article), []);
  assert.match(markdown, /Use this preview to frame the questions/);
  assert.match(markdown, /## AMA questions to watch/);
  assert.match(markdown, /## What Wes should add after answers land/);
  assert.match(markdown, /Official thread: https:\/\/reddit\.com\/r\/engineering\/comments\/1tcyfvk\/hello_rengineering_were_eben_upton_ceo_james\//);
});

test('review prompt helpers identify AMA drafts and produce specific recommendations', () => {
  const draft = {
    title: 'Raspberry Pi AMA: practical signals',
    articleType: 'reddit-ama-summary',
    tags: ['reddit ama', 'Raspberry Pi'],
    sourceUrls: ['https://www.reddit.com/r/IAmA/comments/abc123/pi_ama/'],
  };

  assert.equal(isRedditAmaDraft(draft), true);
  assert.equal(getAmaReviewBadgeLabel(draft), 'Reddit AMA summary');
  assert.equal(getAmaContext(draft).label, 'Reddit AMA summary draft');
  const prompts = getPersonalAdditionRecommendations(draft);
  assert.match(prompts.opening, /matters to manufacturers/);
  assert.match(prompts.middle, /shop-floor context/);
  assert.match(prompts.closing, /what to watch next/i);

  const previewDraft = {
    title: 'Raspberry Pi AMA questions to watch',
    articleType: 'reddit-ama-preview',
    tags: ['reddit ama', 'Raspberry Pi'],
    sourceUrls: ['https://reddit.com/r/engineering/comments/1tcyfvk/hello_rengineering_were_eben_upton_ceo_james/'],
  };

  assert.equal(isRedditAmaDraft(previewDraft), true);
  assert.equal(getAmaReviewBadgeLabel(previewDraft), 'Reddit AMA preview');
  assert.equal(getAmaContext(previewDraft).label, 'Reddit AMA preview draft');
  const previewPrompts = getPersonalAdditionRecommendations(previewDraft);
  assert.match(previewPrompts.opening, /before the official answers arrive/);
  assert.match(previewPrompts.middle, /questions to watch/);
  assert.match(previewPrompts.closing, /after answers land/);

  const ordinary = getPersonalAdditionRecommendations({ title: 'Robot tending notes', tags: ['robotics'] });
  assert.match(ordinary.middle, /robotics angle/);
});

function sampleRedditJson() {
  return [
    {
      data: {
        children: [
          {
            kind: 't3',
            data: {
              title: 'We are Raspberry Pi engineers, ask us anything about education and industrial uses',
              author: 'raspberrypi_official',
              subreddit: 'IAmA',
              subreddit_name_prefixed: 'r/IAmA',
              permalink: '/r/IAmA/comments/abc123/pi_ama/',
              selftext: 'We work on Raspberry Pi hardware, software, and education programs.',
              score: 3200,
              num_comments: 900,
              created_utc: 1779190800,
            },
          },
        ],
      },
    },
    {
      data: {
        children: [
          {
            kind: 't1',
            data: {
              author: 'teacher_cnc',
              body: 'How should schools think about using Pi boards for machine vision labs?',
              score: 150,
              replies: {
                data: {
                  children: [
                    {
                      kind: 't1',
                      data: {
                        author: 'raspberrypi_official',
                        body: 'We suggest educators start with supported camera modules, clear lighting, and small inspection examples before moving into production-style systems.',
                        score: 88,
                      },
                    },
                  ],
                },
              },
            },
          },
          {
            kind: 't1',
            data: {
              author: 'shop_owner',
              body: 'What matters most for industrial users choosing between boards?',
              score: 120,
              replies: {
                data: {
                  children: [
                    {
                      kind: 't1',
                      data: {
                        author: 'raspberrypi_official',
                        body: 'Long-term availability, documentation, and thermal design usually matter more than peak benchmark numbers.',
                        score: 70,
                      },
                    },
                  ],
                },
              },
            },
          },
          {
            kind: 't1',
            data: {
              author: 'curious_user',
              body: 'A question without an official answer should be ignored.',
              score: 999,
              replies: '',
            },
          },
        ],
      },
    },
  ];
}

function sampleUnansweredRedditJson() {
  const data = sampleRedditJson();
  data[0].data.children[0].data.title = 'Hello r/engineering, we are Raspberry Pi leadership. Ask us anything.';
  data[0].data.children[0].data.author = 'Official_RaspberryPi';
  data[0].data.children[0].data.subreddit = 'engineering';
  data[0].data.children[0].data.subreddit_name_prefixed = 'r/engineering';
  data[0].data.children[0].data.permalink = '/r/engineering/comments/1tcyfvk/hello_rengineering_were_eben_upton_ceo_james/';
  data[1].data.children = [
    {
      kind: 't1',
      data: {
        author: 'shop_owner',
        body: 'What matters most for industrial users choosing between boards?',
        score: 120,
        replies: '',
      },
    },
    {
      kind: 't1',
      data: {
        author: 'teacher_cnc',
        body: 'How should schools think about using Pi boards for machine vision labs?',
        score: 90,
        replies: '',
      },
    },
    {
      kind: 't1',
      data: {
        author: 'maintenance_lead',
        body: 'Will documentation cover thermal design and long-term availability?',
        score: 70,
        replies: '',
      },
    },
  ];
  return data;
}
