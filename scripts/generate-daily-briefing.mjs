import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIME_ZONE = 'America/Chicago';
const MAX_NEWS_ITEMS = 12;
const MAX_REDDIT_ITEMS = 10;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'content', 'briefings');

const rssFeeds = [
  { name: '3D Printing Media', topic: '3D Printing', url: 'https://www.voxelmatters.com/feed/' },
  { name: 'Robotics Business Review', topic: 'Robotics', url: 'https://www.therobotreport.com/feed/' },
  { name: 'The Decoder', topic: 'AI Vision', url: 'https://the-decoder.com/feed/' },
  { name: 'Hackaday', topic: 'Engineering', url: 'https://hackaday.com/blog/feed/' },
  { name: 'TechCrunch AI', topic: 'AI Vision', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'Adafruit Blog', topic: 'Electronics', url: 'https://blog.adafruit.com/feed/' },
  { name: 'Fabbaloo', topic: '3D Printing', url: 'https://www.fabbaloo.com/feed/' },
  { name: 'Hacker News', topic: 'Technology', url: 'https://news.ycombinator.com/rss' },
];

const subreddits = [
  { name: '3Dprinting', topic: '3D Printing' },
  { name: 'CNC', topic: 'CNC' },
  { name: 'Machining', topic: 'CNC' },
  { name: 'robotics', topic: 'Robotics' },
  { name: 'manufacturing', topic: 'Manufacturing' },
];

const targetDate = process.argv[2] || chicagoDate(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error('Usage: npm run generate:daily-briefing -- [YYYY-MM-DD]');
  process.exit(1);
}

const generatedTime = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(new Date());

const outputPath = path.join(outputDir, `${targetDate}.md`);

const [newsItems, redditItems] = await Promise.all([collectNews(targetDate), collectReddit(targetDate)]);

if (newsItems.length < 3 && redditItems.length < 3) {
  console.error(`Refusing to write ${outputPath}: only ${newsItems.length} news items and ${redditItems.length} Reddit items found.`);
  process.exit(1);
}

const markdown = renderBriefing(targetDate, generatedTime, redditItems, newsItems);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, markdown, 'utf8');
console.log(`Wrote ${outputPath}`);
console.log(`Included ${newsItems.length} news items and ${redditItems.length} Reddit items for ${targetDate}.`);

async function collectNews(date) {
  const settled = await Promise.allSettled(rssFeeds.map((feed) => fetchFeed(feed, date)));
  const items = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn(`Feed failed: ${rssFeeds[index].name}: ${result.reason?.message || result.reason}`);
    return [];
  });
  return dedupeByUrl(items)
    .sort((a, b) => b.scoreValue - a.scoreValue || a.title.localeCompare(b.title))
    .slice(0, MAX_NEWS_ITEMS)
    .map((item, index) => ({ ...item, rating: ratingFor(index, MAX_NEWS_ITEMS, item.scoreValue) }));
}

async function fetchFeed(feed, date) {
  const xml = await fetchText(feed.url);
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const entryBlocks = itemBlocks.length ? itemBlocks : [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]);

  return entryBlocks.map((block) => parseFeedItem(block, feed))
    .filter((item) => item.title && item.url)
    .filter((item) => !item.date || item.date === date)
    .filter(isRelevantNews)
    .map((item) => ({ ...item, scoreValue: scoreNews(item) }));
}

function parseFeedItem(block, feed) {
  const title = cleanText(tagValue(block, 'title'));
  const link = cleanText(tagValue(block, 'link')) || cleanText(attrValue(block, 'link', 'href'));
  const description = cleanSummary(tagValue(block, 'description') || tagValue(block, 'summary') || tagValue(block, 'content:encoded') || tagValue(block, 'content'));
  const pubDateRaw = cleanText(tagValue(block, 'pubDate') || tagValue(block, 'published') || tagValue(block, 'updated') || tagValue(block, 'dc:date'));
  const image = findImage(block, description);
  const date = pubDateRaw ? chicagoDate(new Date(pubDateRaw)) : '';
  return {
    title,
    url: link,
    source: feed.name,
    topic: topicFor(`${feed.topic} ${title} ${description}`) || feed.topic,
    body: description,
    image,
    date,
  };
}

async function collectReddit(date) {
  const settled = await Promise.allSettled(subreddits.map((subreddit) => fetchSubreddit(subreddit, date)));
  const items = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn(`Reddit failed: r/${subreddits[index].name}: ${result.reason?.message || result.reason}`);
    return [];
  });
  return dedupeByUrl(items)
    .sort((a, b) => b.scoreValue - a.scoreValue || a.title.localeCompare(b.title))
    .slice(0, MAX_REDDIT_ITEMS)
    .map((item, index) => ({ ...item, rating: ratingFor(index, MAX_REDDIT_ITEMS, item.scoreValue) }));
}

async function fetchSubreddit(subreddit, date) {
  const json = await fetchJson(`https://www.reddit.com/r/${subreddit.name}/hot.json?limit=40`);
  const children = json?.data?.children || [];
  return children.map(({ data }) => parseRedditPost(data, subreddit))
    .filter((item) => item.title && item.url)
    .filter((item) => item.date === date)
    .map((item) => ({ ...item, scoreValue: scoreReddit(item) }));
}

function parseRedditPost(post, subreddit) {
  const permalink = post.permalink ? `https://reddit.com${post.permalink}` : post.url;
  const previewImage = post.thumbnail && /^https?:\/\//.test(post.thumbnail) ? post.thumbnail : '';
  const image = htmlDecode(post.preview?.images?.[0]?.source?.url || previewImage || '');
  const body = cleanSummary(post.selftext || (post.is_video ? post.url : '') || post.url_overridden_by_dest || '');
  return {
    title: cleanText(post.title || ''),
    url: permalink,
    source: `r/${subreddit.name}`,
    topic: subreddit.topic,
    body,
    image,
    score: Number(post.score || 0),
    comments: Number(post.num_comments || 0),
    date: chicagoDate(new Date(Number(post.created_utc || 0) * 1000)),
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'FactorySignalBriefingBot/1.0 (+https://thefactorysignal.com)',
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'FactorySignalBriefingBot/1.0 (+https://thefactorysignal.com)',
      accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function renderBriefing(date, time, reddit, news) {
  return [
    `# Tech Briefing — ${formatLongDate(date)}`,
    '',
    '> Advanced Manufacturing · 3D Printing · CNC · Robotics · AI Vision',
    `> Generated: ${time}`,
    '',
    '---',
    '',
    '## 💬 Reddit Highlights',
    '',
    ...reddit.flatMap(renderRedditItem),
    '## 📰 News & Articles',
    '',
    ...news.flatMap(renderNewsItem),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderRedditItem(item) {
  return [
    `### [${escapeMarkdownTitle(item.title)}](${item.url})`,
    `**Source:** ${item.source} | **Topic:** ${item.topic}  `,
    `**Rating:** ${item.rating.stars} ${item.rating.value}/5.0 | **Score:** ${item.score} | **Comments:** ${item.comments}`,
    '',
    ...(item.image ? [`**Image:** ${item.image}`, ''] : []),
    `> ${truncate(item.body || item.url, 220)}`,
    '',
    '---',
    '',
  ];
}

function renderNewsItem(item) {
  return [
    `### [${escapeMarkdownTitle(item.title)}](${item.url})`,
    `**Source:** ${item.source} | **Topic:** ${item.topic}  `,
    `**Rating:** ${item.rating.stars} ${item.rating.value}/5.0`,
    '',
    ...(item.image ? [`**Image:** ${item.image}`, ''] : []),
    `> ${truncate(item.body || item.title, 240)}`,
    '',
    '---',
    '',
  ];
}

function tagValue(xml, tag) {
  const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? match[1] : '';
}

function attrValue(xml, tag, attr) {
  const tagMatch = xml.match(new RegExp(`<${tag}\\b[^>]*>`, 'i'));
  if (!tagMatch) return '';
  const attrMatch = tagMatch[0].match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
  return attrMatch ? attrMatch[1] : '';
}

function findImage(block, description) {
  const patterns = [
    /<media:content\b[^>]*\burl=["']([^"']+)["']/i,
    /<media:thumbnail\b[^>]*\burl=["']([^"']+)["']/i,
    /<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*>/i,
    /<img\b[^>]*\bsrc=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = block.match(pattern) || description.match(pattern);
    if (match) return htmlDecode(match[1]);
  }
  return '';
}

function cleanSummary(value) {
  return cleanText(value)
    .replace(/The post .+? appeared (?:first )?on .+?\s*\.?$/i, '')
    .replace(/Continue reading.*$/i, '')
    .trim();
}

function cleanText(value) {
  return htmlDecode(stripCdata(value || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCdata(value) {
  return value.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function isRelevantNews(item) {
  const haystack = `${item.title} ${item.body}`.toLowerCase();
  const terms = [
    '3d print', 'additive', 'manufactur', 'cnc', 'machining', 'robot', 'automation',
    'factory', 'industrial', 'ai', 'machine learning', 'computer vision', 'hardware',
    'electronics', 'supply chain', 'cad', 'engineering', 'hacker news',
  ];
  return terms.some((term) => haystack.includes(term));
}

function topicFor(text) {
  const lower = text.toLowerCase();
  if (lower.includes('robot') || lower.includes('automation')) return 'Robotics';
  if (lower.includes('3d print') || lower.includes('additive') || lower.includes('filament')) return '3D Printing';
  if (lower.includes('vision') || lower.includes('ai') || lower.includes('machine learning')) return 'AI Vision';
  if (/\b(cnc|machining|machine tool|milling|lathe)\b/.test(lower)) return 'CNC';
  if (lower.includes('manufactur') || lower.includes('factory')) return 'Manufacturing';
  if (lower.includes('electronics') || lower.includes('hardware')) return 'Electronics';
  return '';
}

function scoreNews(item) {
  const text = `${item.title} ${item.body}`.toLowerCase();
  let score = 20;
  for (const term of ['manufactur', 'robot', '3d print', 'additive', 'cnc', 'machin', 'automation', 'factory', 'industrial']) {
    if (text.includes(term)) score += 10;
  }
  if (item.image) score += 5;
  if (item.body.length > 80) score += 3;
  return score;
}

function scoreReddit(item) {
  return Number(item.score || 0) + Number(item.comments || 0) * 4;
}

function ratingFor(index, total, scoreValue) {
  const base = 4.2 - index * (1.1 / Math.max(1, total - 1));
  const bump = Math.min(0.3, Math.log10(Math.max(1, scoreValue)) / 20);
  const value = Math.max(3.0, Math.min(4.8, base + bump)).toFixed(1);
  const filled = Math.max(1, Math.min(5, Math.round(Number(value))));
  return { value, stars: '★'.repeat(filled) + '☆'.repeat(5 - filled) };
}

function dedupeByUrl(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = normalizeUrl(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_|^fbclid$|^gclid$/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function chicagoDate(date) {
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}

function truncate(value, limit) {
  const text = cleanText(value).replace(/\|/g, '\\|');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3).trim()}...`;
}

function escapeMarkdownTitle(value) {
  return cleanText(value).replace(/\]/g, '\\]');
}
