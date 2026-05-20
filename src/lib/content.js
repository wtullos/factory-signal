import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { isSchoolFriendlyItem } from './school-friendly.js';

const root = process.cwd();
export const SITE_NAME = 'Factory Signal';
export const TAGLINE = 'Daily intelligence for the future of manufacturing.';
export const SITE_URL = (process.env.SITE_URL || 'https://thefactorysignal.com').replace(/\/$/, '');
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'hello@thefactorysignal.com';

export const ADSENSE_PUBLISHER_ID = process.env.ADSENSE_PUBLISHER_ID || '';
export const ADSENSE_ENABLED = ADSENSE_PUBLISHER_ID.startsWith('ca-pub-');

export function contentPath(...parts) {
  return path.join(root, 'content', ...parts);
}

export function getBriefings() {
  const dir = contentPath('briefings');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    .map((filename) => {
      const fullPath = path.join(dir, filename);
      const raw = fs.readFileSync(fullPath, 'utf8');
      const parsed = parseBriefing(filename, raw);
      const stat = fs.statSync(fullPath);
      return { ...parsed, raw, updatedAt: parsed.generatedAt || stat.mtime.toISOString() };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getArticles() {
  const dir = contentPath('articles');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((filename) => {
      const fullPath = path.join(dir, filename);
      const raw = fs.readFileSync(fullPath, 'utf8');
      const stat = fs.statSync(fullPath);
      return parseArticleMarkdown(filename, raw, { dir: 'content/articles', updatedAt: stat.mtime.toISOString() });
    })
    .filter(isSchoolFriendlyArticle)
    .sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)) || a.title.localeCompare(b.title));
}

export function getPinnedArticles(articles = getArticles(), now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (Number.isNaN(nowMs)) return [];
  return articles
    .filter((article) => {
      const pinnedUntilMs = Date.parse(article.pinnedUntil || '');
      return !Number.isNaN(pinnedUntilMs) && pinnedUntilMs > nowMs;
    })
    .sort((a, b) => String(b.pinnedUntil).localeCompare(String(a.pinnedUntil)) || String(b.pubDate).localeCompare(String(a.pubDate)));
}

export function getDraftArticles() {
  const dir = contentPath('drafts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((filename) => {
      const fullPath = path.join(dir, filename);
      const raw = fs.readFileSync(fullPath, 'utf8');
      const stat = fs.statSync(fullPath);
      return parseArticleMarkdown(filename, raw, { dir: 'content/drafts', updatedAt: stat.mtime.toISOString() });
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.title.localeCompare(b.title));
}

export function parseArticleMarkdown(filename, raw, options = {}) {
  const { data, body } = parseFrontmatter(raw);
  const fallbackSlug = filename.replace(/\.md$/, '');
  const slug = slugify(data.slug || fallbackSlug) || fallbackSlug;
  const pubDate = data.pubDate || data.date || '';
  return {
    slug,
    title: data.title || titleFromMarkdown(body) || slug,
    description: data.description || excerptFromMarkdown(body),
    pubDate,
    date: data.date || pubDate,
    author: data.author || SITE_NAME,
    tags: normalizeList(data.tags),
    status: data.status || 'draft',
    articleType: data.articleType || data.type || '',
    sourceUrls: normalizeList(data.sourceUrls || data.sources || data.sourceUrl),
    pinnedUntil: data.pinnedUntil || data.pinned_until || '',
    body,
    html: marked.parse(body),
    filename,
    path: options.dir ? `${options.dir}/${filename}` : filename,
    updatedAt: options.updatedAt || '',
  };
}

export function getDailyTakeaways(limit = 7) {
  return getBriefings().map((briefing) => buildDailyTakeaway(briefing, limit));
}

export function buildDailyTakeaway(briefing, limit = 7) {
  const stories = (briefing?.sections || []).flatMap((section) => section.items.map((item) => ({ ...item, sectionTitle: section.title })));
  const nonReddit = stories.filter((story) => story.sectionTitle !== 'Reddit');
  const reddit = stories.filter((story) => story.sectionTitle === 'Reddit');
  const topicCounts = countBy(nonReddit.map((story) => story.topic || story.source || story.sectionTitle).filter(Boolean));
  const sourceCounts = countBy(nonReddit.map((story) => story.source).filter(Boolean));
  const topTopics = topicCounts.slice(0, 5).map(([label]) => label);
  const topSources = sourceCounts.slice(0, 5).map(([label]) => label);
  const strongestStories = [...nonReddit]
    .sort((a, b) => (Number.parseFloat(b.score || '0') || 0) - (Number.parseFloat(a.score || '0') || 0))
    .slice(0, 6);
  const lessons = inferTakeawayLessons({ briefing, topTopics, topSources, strongestStories, reddit }).slice(0, limit);

  return {
    date: briefing.date,
    dateLabel: formatDate(briefing.date),
    slug: briefing.slug,
    title: `Daily takeaways - ${formatDate(briefing.date)}`,
    deck: briefing.deck,
    storyCount: stories.length,
    newsCount: nonReddit.length,
    communityCount: reddit.length,
    topTopics,
    topSources,
    strongestStories,
    lessons,
  };
}

export function applyPublishMetadata(raw, publishedAt = new Date()) {
  const publishedDate = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(publishedDate.getTime())) throw new Error('publishedAt must be a valid date.');
  const pinnedUntil = new Date(publishedDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return upsertFrontmatter(raw, {
    status: 'published',
    pubDate: publishedDate.toISOString(),
    pinnedUntil,
  });
}

export function parseFeedDate(value, fallback = new Date()) {
  if (value instanceof Date) return new Date(value.getTime());

  const raw = String(value || '').trim();
  const fallbackDate = fallback instanceof Date ? new Date(fallback.getTime()) : new Date(fallback);
  const safeFallback = Number.isNaN(fallbackDate.getTime()) ? new Date() : fallbackDate;
  if (!raw) return safeFallback;

  const dateInput = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw;
  const parsed = new Date(dateInput);
  return Number.isNaN(parsed.getTime()) ? safeFallback : parsed;
}

export function getAllStories() {
  return getBriefings()
    .flatMap((briefing) => briefing.sections.flatMap((section) => section.items.map((item, index) => ({
      ...item,
      date: briefing.date,
      dateLabel: formatDate(briefing.date),
      briefingSlug: briefing.slug,
      briefingTitle: briefing.title,
      sectionTitle: item.sectionTitle || section.title,
      archiveKey: `${briefing.slug}-${section.title}-${index}`,
    }))))
    .filter(isSchoolFriendlyStory)
    .sort((a, b) => b.date.localeCompare(a.date) || (Number.parseFloat(b.score || '0') || 0) - (Number.parseFloat(a.score || '0') || 0));
}

export function isSchoolFriendlyArticle(article = {}) {
  return isSchoolFriendlyItem(article);
}

export function isSchoolFriendlyStory(story = {}) {
  return isSchoolFriendlyItem(story);
}

export function getStoriesBySection(sectionTitle) {
  return getAllStories().filter((story) => story.sectionTitle === sectionTitle);
}

export function getNewsStories() {
  return getAllStories().filter((story) => story.sectionTitle !== 'Reddit');
}

export function getRedditStories() {
  return getStoriesBySection('Reddit');
}

const WHITEPAPER_ASSET_TERMS = /\b(white\s*paper|whitepaper|e-?book|case stud(?:y|ies)|research paper|technical paper|working paper|conference paper|study|survey|report|pdf)\b/i;
const WHITEPAPER_TITLE_URL_TERMS = WHITEPAPER_ASSET_TERMS;
const WHITEPAPER_SOURCE_TERMS = /\b(white\s*paper|whitepaper|e-?book|case stud(?:y|ies)|journal|arxiv)\b/i;
const WHITEPAPER_BODY_TERMS = /\b(white\s*paper|whitepaper|e-?book|case stud(?:y|ies)|research paper|technical paper|working paper|conference paper|peer[-\s]?reviewed paper|journal (?:article|paper|study)|(?:new|published|released|download(?:ed)?) (?:a |an |the )?(?:paper|report|study|white\s*paper|whitepaper|e-?book|case study|pdf)|study (?:published|appearing) in (?:a |an |the )?(?:journal|proceedings))\b/i;

export function isWhitepaperStory(story) {
  if (!story || story.sectionTitle === 'Reddit') return false;
  const titleAndUrl = [story.title, story.url].filter(Boolean).join(' ');
  const source = story.source || '';
  const body = story.body || '';

  return WHITEPAPER_TITLE_URL_TERMS.test(titleAndUrl)
    || WHITEPAPER_SOURCE_TERMS.test(source)
    || WHITEPAPER_BODY_TERMS.test(body);
}

const VIDEO_URL_TERMS = /(?:^|\/\/)(?:www\.)?(?:youtube\.com\/(?:watch\?|shorts\/|embed\/|live\/)|youtu\.be\/|vimeo\.com\/|player\.vimeo\.com\/video\/|dailymotion\.com\/video\/|twitch\.tv\/videos\/|v\.redd\.it\/)/i;
const VIDEO_MEDIA_TYPE_TERMS = /^video(?:\/|$)|\bvideo\b/i;

export function isVideoStory(story = {}) {
  if (!story || story.sectionTitle === 'Reddit') return false;
  const url = story.url || '';
  const mediaSignals = [
    story.mediaType,
    story.media_type,
    story.type,
    story.format,
  ].filter(Boolean).join(' ');

  return VIDEO_URL_TERMS.test(url)
    || Boolean(story.videoUrl || story.video_url || story.embedUrl || story.embed_url)
    || VIDEO_MEDIA_TYPE_TERMS.test(mediaSignals);
}

export function getWhitepaperStories(limit) {
  const stories = getNewsStories()
    .filter(isWhitepaperStory)
    .sort((a, b) => b.date.localeCompare(a.date) || whitepaperScore(b) - whitepaperScore(a))
    .filter((story, index, all) => all.findIndex((candidate) => (
      (candidate.url && candidate.url === story.url)
      || (candidate.title && candidate.title === story.title)
      || (candidate.archiveKey && candidate.archiveKey === story.archiveKey)
    )) === index);

  return Number.isFinite(limit) ? stories.slice(0, limit) : stories;
}

function whitepaperScore(story) {
  let score = 0;
  if (WHITEPAPER_ASSET_TERMS.test(story.title || '')) score += 6;
  if (WHITEPAPER_ASSET_TERMS.test(story.url || '')) score += 5;
  if (WHITEPAPER_TITLE_URL_TERMS.test(story.title || '')) score += 4;
  if (WHITEPAPER_TITLE_URL_TERMS.test(story.url || '')) score += 3;
  if (WHITEPAPER_SOURCE_TERMS.test(story.source || '')) score += 2;
  if (WHITEPAPER_BODY_TERMS.test(story.body || '')) score += 1;
  return score;
}

export function getStoryArchive(stories = getAllStories()) {
  const groups = [];
  for (const story of stories) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== story.date) {
      group = { date: story.date, dateLabel: story.dateLabel, briefingSlug: story.briefingSlug, stories: [] };
      groups.push(group);
    }
    group.stories.push(story);
  }
  return { stories, groups };
}

export function parseBriefing(filename, content) {
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : filename.replace('.md', '');
  const title = capture(content, /^# (.+)$/m) || `Factory Signal Briefing - ${date}`;
  const generatedTime = capture(content, /^> Generated:\s*(.+)$/m);
  const generatedAt = generatedTime ? `${date}T${generatedTime}` : '';
  const deck = capture(content, /^> (Advanced Manufacturing.+)$/m) || 'Advanced Manufacturing · 3D Printing · CNC · Robotics · AI Vision';
  const sections = [];
  const patterns = [
    { title: 'News', pattern: /## 📰 News & Articles\n\n([\s\S]*?)(?=\n---\n\n##\s|$)/ },
    { title: 'Reddit', pattern: /## 💬 Reddit Highlights\n\n([\s\S]*?)(?=\n---\n\n##\s|$)/ },
    { title: 'YouTube', pattern: /## 📺 YouTube Worth Watching\n\n([\s\S]*?)(?=\n---\n\n##\s|$)/ },
  ];
  for (const sectionPattern of patterns) {
    const match = content.match(sectionPattern.pattern);
    if (!match) continue;
    const isYouTubeSection = sectionPattern.title === 'YouTube';
    const items = parseItems(match[1], isYouTubeSection)
      .map((item) => ({ ...item, sectionTitle: sectionPattern.title }))
      .filter((item) => !isYouTubeSection || isVideoStory(item))
      .filter(isSchoolFriendlyStory);
    if (items.length) sections.push({ title: sectionPattern.title, items });
  }
  return { date, filename, slug: date, title, deck, generatedAt, sections, html: marked.parse(content) };
}

function parseItems(text, isYouTube) {
  const items = [];
  const pattern = /### \[(.+?)\]\((.+?)\)\n([\s\S]*?)(?=\n---\n\n### |\n---\s*$|$)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const bodyBlock = match[3].trim();
    const item = {
      title: match[1].trim(),
      url: match[2].trim(),
      source: isYouTube ? capture(bodyBlock, /\*\*Channel:\*\* (.+?) \|/) || 'YouTube' : capture(bodyBlock, /\*\*Source:\*\* (.+?) \|/) || 'Unknown',
      topic: capture(bodyBlock, /\*\*Topic:\*\* (.+?)(?:\s{2,}|\n|\|)/),
      rating: capture(bodyBlock, /\*\*Rating:\*\* ([⭐★☆]+)/),
      score: capture(bodyBlock, /\*\*Rating:\*\* [⭐★☆]+ ([\d.]+)\/5\.0/),
      views: capture(bodyBlock, /\*\*Views:\*\* (.+?) \|/),
      duration: capture(bodyBlock, /\*\*Duration:\*\* (.+?)$/m),
      published: capture(bodyBlock, /\*\*Published:\*\* (.+?)$/m),
      scoreCount: capture(bodyBlock, /\*\*Score:\*\* (.+?)(?:\s*\||$)/m),
      comments: capture(bodyBlock, /\*\*Comments:\*\* (.+?)(?:\s*$|\|)/m),
      image: capture(bodyBlock, /\*\*Image:\*\* (\S+)/),
      body: capture(bodyBlock, />\s+([\s\S]+)$/m),
    };
    if (item.body) item.body = item.body.replace(/\n>\s*/g, ' ').replace(/\.\.\.$/, '').trim();
    items.push(item);
  }
  return items;
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function inferTakeawayLessons({ briefing, topTopics, topSources, strongestStories, reddit }) {
  const lessons = [];
  const topicText = topTopics.slice(0, 3).join(', ');
  if (topicText) {
    lessons.push({
      concept: 'Patterns beat isolated headlines',
      takeaway: `${formatDate(briefing.date)} clustered around ${topicText}. Treat a cluster as a demand signal: repeated themes usually matter more than any one link.`,
    });
  }

  const sourceText = topSources.slice(0, 3).join(', ');
  if (sourceText) {
    lessons.push({
      concept: 'Source mix changes confidence',
      takeaway: `Coverage came most often from ${sourceText}. Vendor, trade-press, community, and research sources each carry different bias; compare them before calling a trend real.`,
    });
  }

  if (strongestStories.some((story) => /robot|automation|cobot|vision|ai/i.test([story.title, story.topic, story.body].join(' ')))) {
    lessons.push({
      concept: 'Automation value is usually integration value',
      takeaway: 'Robot, AI vision, and automation signals are strongest when they connect sensing, tooling, fixtures, software, and people into one repeatable workflow.',
    });
  }

  if (strongestStories.some((story) => /3d|print|additive|filament|resin|stl/i.test([story.title, story.topic, story.body].join(' ')))) {
    lessons.push({
      concept: 'Additive work is a process-control problem',
      takeaway: '3D printing stories are less about the printer alone and more about material choice, calibration, repeatability, post-processing, and design-for-manufacture decisions.',
    });
  }

  if (strongestStories.some((story) => /cnc|mill|machin|tool|insert|cam|g-code/i.test([story.title, story.topic, story.body].join(' ')))) {
    lessons.push({
      concept: 'Machining knowledge compounds through constraints',
      takeaway: 'CNC and tooling signals usually point back to constraints: material, fixturing, cutter geometry, feeds/speeds, tolerance, and inspection. Name the constraint before picking the fix.',
    });
  }

  if (reddit.length > 0) {
    lessons.push({
      concept: 'Community questions expose adoption friction',
      takeaway: `${reddit.length} community signal${reddit.length === 1 ? '' : 's'} showed where practitioners get stuck. Use these as a map of concepts worth teaching, documenting, or simplifying.`,
    });
  }

  lessons.push({
    concept: 'A daily briefing should end in a testable question',
    takeaway: 'Convert the day into one question: what would I inspect, measure, prototype, or ask an operator tomorrow to prove whether this signal matters?',
  });

  return lessons;
}

export function topItems(briefing, limit = 6) {
  return [...(briefing?.sections || []).flatMap((section) => section.items)]
    .sort((a, b) => (Number.parseFloat(b.score || '0') || 0) - (Number.parseFloat(a.score || '0') || 0))
    .slice(0, limit);
}

export function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function canonical(pathname = '/') {
  return `${SITE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function capture(text, regex) {
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const data = {};
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!value && lines[i + 1]?.trim().startsWith('- ')) {
      const list = [];
      while (lines[i + 1]?.trim().startsWith('- ')) {
        i += 1;
        list.push(lines[i].trim().slice(2).trim().replace(/^['"]|['"]$/g, ''));
      }
      data[key] = list.filter(Boolean);
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }
    data[key] = value;
  }
  return { data, body };
}

function titleFromMarkdown(markdown) {
  return capture(markdown, /^#\s+(.+)$/m);
}

function excerptFromMarkdown(markdown) {
  return markdown.replace(/[#>*_`\[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function upsertFrontmatter(raw, patch) {
  const lines = raw.split('\n');
  if (!raw.startsWith('---')) {
    const frontmatter = Object.entries(patch).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
    return `---\n${frontmatter}\n---\n\n${raw.trimStart()}`;
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIndex === -1) return upsertFrontmatter(raw.replace(/^---\s*/, ''), patch);

  const fmLines = lines.slice(1, endIndex);
  const bodyLines = lines.slice(endIndex + 1);
  for (const [key, value] of Object.entries(patch)) {
    const rendered = `${key}: ${JSON.stringify(value)}`;
    const existingIndex = fmLines.findIndex((line) => line.match(new RegExp(`^${key}:\\s*`)));
    if (existingIndex >= 0) fmLines[existingIndex] = rendered;
    else fmLines.push(rendered);
  }
  return ['---', ...fmLines, '---', ...bodyLines].join('\n');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
