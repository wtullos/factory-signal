#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArticleMarkdown } from '../src/lib/content.js';
import { schoolFriendlyViolations } from '../src/lib/school-friendly.js';

const DEFAULT_QA_LIMIT = 8;
const DEFAULT_PREVIEW_QUESTION_LIMIT = 10;

export function redditJsonUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid Reddit URL: ${input}`);
  }

  if (!/(^|\.)reddit\.com$/i.test(url.hostname) && !/(^|\.)redd\.it$/i.test(url.hostname)) {
    throw new Error('Expected a reddit.com or redd.it thread URL.');
  }

  if (!url.pathname.endsWith('.json')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}.json`;
  }
  url.searchParams.set('limit', url.searchParams.get('limit') || '500');
  url.searchParams.set('sort', url.searchParams.get('sort') || 'top');
  return url.toString();
}

export async function fetchRedditThread(inputUrl, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available in this Node runtime.');
  }
  const url = redditJsonUrl(inputUrl);
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'FactorySignalAMA/1.0 (+https://thefactorysignal.com)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Reddit request failed with HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

export function extractAmaSummary(redditJson, { title, qaLimit = DEFAULT_QA_LIMIT, previewQuestionLimit = DEFAULT_PREVIEW_QUESTION_LIMIT, mode = 'auto' } = {}) {
  if (!Array.isArray(redditJson) || redditJson.length < 2) {
    throw new Error('Unexpected Reddit JSON shape: expected post listing and comment listing.');
  }

  const post = redditJson[0]?.data?.children?.find((child) => child?.kind === 't3')?.data;
  const comments = redditJson[1]?.data?.children || [];
  if (!post) throw new Error('Could not find Reddit post data in JSON response.');

  const opAuthor = normalizeAuthor(post.author);
  const qaPairs = comments
    .filter((child) => child?.kind === 't1')
    .map((child) => extractQuestionAnswer(child.data, opAuthor))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, qaLimit);

  const previewQuestions = comments
    .filter((child) => child?.kind === 't1')
    .map((child) => extractPreviewQuestion(child.data))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, previewQuestionLimit);

  const articleType = mode === 'preview' || qaPairs.length === 0 ? 'reddit-ama-preview' : 'reddit-ama-summary';

  if (articleType === 'reddit-ama-preview' && previewQuestions.length === 0) {
    throw new Error('No Reddit questions found for AMA preview mode.');
  }

  return {
    title: title || `${articleType === 'reddit-ama-preview' ? 'Reddit AMA preview' : 'Reddit AMA summary'}: ${cleanTitle(post.title || 'AMA thread')}`,
    articleType,
    originalTitle: post.title || '',
    author: post.author || '',
    subreddit: post.subreddit_name_prefixed || (post.subreddit ? `r/${post.subreddit}` : ''),
    permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : '',
    selftext: cleanText(post.selftext || ''),
    score: Number(post.score || 0),
    commentCount: Number(post.num_comments || 0),
    createdUtc: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : '',
    qaPairs,
    previewQuestions,
  };
}

export function buildAmaDraftMarkdown(summary, { date = todayIsoDate(), sourceUrl = '' } = {}) {
  const slug = slugify(`${date}-${summary.title}`);
  const sourceUrls = [sourceUrl || summary.permalink].filter(Boolean);
  const isPreview = summary.articleType === 'reddit-ama-preview';
  const description = isPreview
    ? `A classroom-friendly preview of high-signal questions to watch in ${summary.subreddit || 'a Reddit'} AMA with ${summary.author || 'the original poster'}.`
    : `A classroom-friendly summary of ${summary.subreddit || 'a Reddit'} AMA with ${summary.author || 'the original poster'}, focused on manufacturing, education, and practical technology takeaways.`;
  const topics = inferTags(summary);
  const body = isPreview ? buildPreviewBody(summary, sourceUrls) : buildSummaryBody(summary, sourceUrls);

  return `---\ntitle: ${yamlQuote(summary.title)}\nslug: ${yamlQuote(slug)}\ndescription: ${yamlQuote(description)}\npubDate: ${date}\nauthor: Factory Signal\nstatus: draft\narticleType: ${summary.articleType || 'reddit-ama-summary'}\ntags:\n${topics.map((tag) => `  - ${yamlQuote(tag)}`).join('\n')}\nsourceUrls:\n${sourceUrls.map((url) => `  - ${yamlQuote(url)}`).join('\n')}\n---\n\n${body}\n`;
}

function buildSummaryBody(summary, sourceUrls) {
  return [
    `# ${summary.title}`,
    '',
    `Reddit AMAs can surface the practical questions that official announcements miss. This draft summarizes the strongest Q/A threads from ${summary.subreddit || 'the source thread'} and keeps the focus on what manufacturers, classrooms, and technical teams can learn from it.`,
    '',
    '## Source context',
    '',
    `- Official thread: ${sourceUrls[0] || summary.permalink || 'Add source URL before publishing.'}`,
    `- Original Reddit title: ${summary.originalTitle || summary.title}`,
    summary.author ? `- AMA author: u/${summary.author}` : null,
    summary.subreddit ? `- Community: ${summary.subreddit}` : null,
    Number.isFinite(summary.score) ? `- Reddit score at capture: ${summary.score}` : null,
    Number.isFinite(summary.commentCount) ? `- Comments at capture: ${summary.commentCount}` : null,
    summary.createdUtc ? `- Thread created: ${summary.createdUtc.slice(0, 10)}` : null,
    '',
    '## Key Q/A takeaways',
    '',
    ...summary.qaPairs.flatMap((pair, index) => [
      `### ${index + 1}. ${truncateMarkdown(pair.question, 92)}`,
      '',
      `**Question:** ${pair.question}`,
      '',
      `**Answer from u/${summary.author || pair.answerAuthor}:** ${pair.answer}`,
      '',
      `**Factory Signal angle:** Add Wes's context here: what this answer changes for a shop, lab, classroom, or technology roadmap.`,
      '',
    ]),
    '## What to watch next',
    '',
    'Track which AMA answers turn into shipped documentation, stable supply, classroom-ready examples, maintainable tooling, or clearer guidance for teams adopting the technology.',
    '',
    '> Editor note: Verify all summarized Q/A excerpts against the Reddit source before publishing.',
  ].filter((line) => line !== null).join('\n');
}

function buildPreviewBody(summary, sourceUrls) {
  return [
    `# ${summary.title}`,
    '',
    'This Reddit AMA thread has not produced enough official answers yet, so this draft is a preview: the questions to watch, not a completed AMA summary. Use it to frame what manufacturers, classrooms, and technical teams should look for once answers land.',
    '',
    '## Source context',
    '',
    `- Official thread: ${sourceUrls[0] || summary.permalink || 'Add source URL before publishing.'}`,
    `- Original Reddit title: ${summary.originalTitle || summary.title}`,
    summary.author ? `- Source post author: u/${summary.author}` : null,
    summary.subreddit ? `- Community: ${summary.subreddit}` : null,
    Number.isFinite(summary.score) ? `- Reddit score at capture: ${summary.score}` : null,
    Number.isFinite(summary.commentCount) ? `- Comments at capture: ${summary.commentCount}` : null,
    summary.createdUtc ? `- Thread created: ${summary.createdUtc.slice(0, 10)}` : null,
    '',
    '## AMA questions to watch',
    '',
    ...summary.previewQuestions.flatMap((question, index) => [
      `### ${index + 1}. ${truncateMarkdown(question.question, 92)}`,
      '',
      `**Question from u/${question.author || 'redditor'}:** ${question.question}`,
      '',
      `**Why it matters:** Add Wes's context here: what this question could reveal about manufacturing use, classroom adoption, reliability, cost, maintainability, or where the official answer needs practical follow-up.`,
      '',
    ]),
    '## What Wes should add after answers land',
    '',
    'Replace or supplement this preview with confirmed answers from the AMA participants. Watch for commitments on availability, documentation, industrial support, classroom examples, software maintenance, and any gaps between community needs and official guidance.',
    '',
    '> Editor note: This is a preview draft, not a completed AMA summary. Verify the thread status and add official answers before publishing as a recap.',
  ].filter((line) => line !== null).join('\n');
}

export async function generateAmaDraft(inputUrl, options = {}) {
  const redditJson = options.redditJson || await fetchRedditThread(inputUrl, options);
  const summary = extractAmaSummary(redditJson, { title: options.title, qaLimit: options.qaLimit, previewQuestionLimit: options.previewQuestionLimit, mode: options.mode });
  const markdown = buildAmaDraftMarkdown(summary, { date: options.date, sourceUrl: inputUrl });
  const article = parseArticleMarkdown(`${summary.title}.md`, markdown, { dir: 'content/drafts' });
  const violations = schoolFriendlyViolations(article);
  if (violations.length > 0) {
    throw new Error(`Generated AMA draft failed the school-friendly content guard. Categories: ${[...new Set(violations)].join(', ')}`);
  }
  return { summary, markdown, filename: `${slugify(`${options.date || todayIsoDate()}-${summary.title}`)}.md` };
}

export async function writeAmaDraft(inputUrl, options = {}) {
  const { markdown, filename } = await generateAmaDraft(inputUrl, options);
  const draftsDir = options.draftsDir || path.join(process.cwd(), 'content', 'drafts');
  fs.mkdirSync(draftsDir, { recursive: true });
  const targetPath = uniquePath(draftsDir, filename);
  fs.writeFileSync(targetPath, markdown, 'utf8');
  return targetPath;
}

function extractQuestionAnswer(comment, opAuthor) {
  if (!comment || comment.body === '[deleted]' || comment.body === '[removed]') return null;
  const answer = findAuthorReply(comment.replies, opAuthor);
  if (!answer) return null;
  return {
    question: truncateMarkdown(cleanText(comment.body), 420),
    answer: truncateMarkdown(cleanText(answer.body), 520),
    answerAuthor: answer.author || '',
    score: Number(comment.score || 0) + Number(answer.score || 0),
    questionPermalink: comment.permalink ? `https://www.reddit.com${comment.permalink}` : '',
  };
}

function extractPreviewQuestion(comment) {
  if (!comment || comment.body === '[deleted]' || comment.body === '[removed]') return null;
  const question = cleanText(comment.body);
  if (!question) return null;
  return {
    question: truncateMarkdown(question, 520),
    author: comment.author || '',
    score: Number(comment.score || 0),
    permalink: comment.permalink ? `https://www.reddit.com${comment.permalink}` : '',
  };
}

function findAuthorReply(replies, opAuthor) {
  const children = replies?.data?.children || [];
  const stack = [...children];
  while (stack.length > 0) {
    const child = stack.shift();
    if (child?.kind !== 't1') continue;
    const data = child.data || {};
    if (normalizeAuthor(data.author) === opAuthor && data.body && data.body !== '[deleted]' && data.body !== '[removed]') {
      return data;
    }
    stack.push(...(data.replies?.data?.children || []));
  }
  return null;
}

function normalizeAuthor(value) {
  return String(value || '').trim().toLowerCase();
}

function inferTags(summary) {
  const text = `${summary.title} ${summary.originalTitle} ${summary.selftext}`.toLowerCase();
  const tags = ['reddit ama'];
  if (/raspberry\s*pi|\brpi\b/.test(text)) tags.push('Raspberry Pi', 'edge computing', 'education');
  if (/robot/.test(text)) tags.push('robotics');
  if (/cnc|machin/.test(text)) tags.push('CNC');
  if (/3d\s*print|additive/.test(text)) tags.push('3D printing');
  if (/manufactur|factory|shop/.test(text)) tags.push('manufacturing');
  return [...new Set([...tags, 'community signal'])];
}

function cleanText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function cleanTitle(value) {
  return cleanText(value).replace(/^I am A?\s*/i, '').trim();
}

function truncateMarkdown(value, maxLength) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function yamlQuote(value) {
  return JSON.stringify(String(value || ''));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function uniquePath(dir, filename) {
  const ext = path.extname(filename) || '.md';
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, `${base}${ext}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'reddit-ama-summary';
}

function parseArgs(argv) {
  const [inputUrl, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--title') options.title = rest[++i];
    else if (arg === '--date') options.date = rest[++i];
    else if (arg === '--qa-limit') options.qaLimit = Number(rest[++i]);
    else if (arg === '--preview-question-limit') options.previewQuestionLimit = Number(rest[++i]);
    else if (arg === '--mode') options.mode = rest[++i];
    else if (arg === '--allow-unanswered') options.mode = 'preview';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!inputUrl) throw new Error('Usage: node scripts/generate-reddit-ama-draft.mjs <reddit-thread-url> [--title "..."] [--date YYYY-MM-DD] [--qa-limit 8] [--mode auto|preview] [--allow-unanswered]');
  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('--date must be YYYY-MM-DD.');
  if (options.mode && !['auto', 'preview'].includes(options.mode)) throw new Error('--mode must be auto or preview.');
  return { inputUrl, options };
}

async function main() {
  try {
    const { inputUrl, options } = parseArgs(process.argv.slice(2));
    const targetPath = await writeAmaDraft(inputUrl, options);
    console.log(`Created AMA draft: ${path.relative(process.cwd(), targetPath)}`);
    console.log('Draft only. Review and publish from /review/ when ready.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) await main();
