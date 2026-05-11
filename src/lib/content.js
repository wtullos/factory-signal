import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

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
      const raw = fs.readFileSync(path.join(dir, filename), 'utf8');
      const { data, body } = parseFrontmatter(raw);
      const slug = filename.replace(/\.md$/, '');
      return {
        slug,
        title: data.title || titleFromMarkdown(body) || slug,
        description: data.description || excerptFromMarkdown(body),
        pubDate: data.pubDate || data.date || '',
        author: data.author || SITE_NAME,
        tags: Array.isArray(data.tags) ? data.tags : [],
        body,
        html: marked.parse(body),
      };
    })
    .sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)) || a.title.localeCompare(b.title));
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
    .sort((a, b) => b.date.localeCompare(a.date) || (Number.parseFloat(b.score || '0') || 0) - (Number.parseFloat(a.score || '0') || 0));
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
    const items = parseItems(match[1], sectionPattern.title === 'YouTube').map((item) => ({ ...item, sectionTitle: sectionPattern.title }));
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
  for (const line of fm.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
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
