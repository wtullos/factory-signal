#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  GENERATED_FALLBACK_HEIGHT,
  GENERATED_FALLBACK_WIDTH,
  MIN_DISPLAY_IMAGE_WIDTH,
  isAcceptableSourceImage,
  largestSrcsetCandidate,
  scoreImageCandidate,
} from '../src/lib/image-rules.js';

const root = process.cwd();
const briefingsDir = path.join(root, 'content', 'briefings');
const outputDir = path.join(root, 'public', 'generated-images');
const cachePath = path.join(root, 'content', 'image-cache.json');
const publicPrefix = '/generated-images';
const scrapeTimeoutMs = Number.parseInt(process.env.IMAGE_SCRAPE_TIMEOUT_MS || '2500', 10);
const userAgent = 'FactorySignalBot/1.0 (+https://thefactorysignal.com)';
const model = process.env.OPENAI_IMAGE_FALLBACK_MODEL || 'gpt-5.5';
const apiKey = process.env.OPENAI_API_KEY || '';

const sectionTitles = [
  'News & Articles',
  'Reddit Highlights',
  'YouTube Worth Watching',
];

const palettes = [
  ['#0f172a', '#f59e0b', '#fde68a', '#38bdf8'],
  ['#102a43', '#2dd4bf', '#ccfbf1', '#f97316'],
  ['#1e1b4b', '#a78bfa', '#ede9fe', '#22c55e'],
  ['#3b1d0f', '#fb923c', '#ffedd5', '#60a5fa'],
  ['#134e4a', '#14b8a6', '#ccfbf1', '#facc15'],
  ['#431407', '#ef4444', '#fee2e2', '#38bdf8'],
];

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const files = (await safeReadDir(briefingsDir))
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    .sort();

  let changedFiles = 0;
  let generated = 0;
  let reused = 0;
  let apiGenerated = 0;
  let fallbackGenerated = 0;
  let scraped = 0;
  let replaced = 0;
  let scrapeFailures = 0;
  const imageCache = await readImageCache();

  for (const file of files) {
    const fullPath = path.join(briefingsDir, file);
    const original = await fs.readFile(fullPath, 'utf8');
    const { content, stats } = await processBriefing(file, original, imageCache);
    generated += stats.generated;
    reused += stats.reused;
    apiGenerated += stats.apiGenerated;
    fallbackGenerated += stats.fallbackGenerated;
    scraped += stats.scraped;
    replaced += stats.replaced;
    scrapeFailures += stats.scrapeFailures;
    if (content !== original) {
      await fs.writeFile(fullPath, content);
      changedFiles += 1;
      console.log(`updated ${path.relative(root, fullPath)} (${stats.inserted} inserted, ${stats.replaced} replaced image refs)`);
    }
    if (stats.cacheTouched) await writeImageCache(imageCache);
  }

  await writeImageCache(imageCache);
  console.log(`fallback image prep complete: ${scraped} scraped article photos, ${replaced} generated refs replaced, ${scrapeFailures} scrape misses/failures, ${generated} generated/updated, ${reused} reused, ${apiGenerated} OpenAI, ${fallbackGenerated} local fallback, ${changedFiles} markdown files changed`);
}

async function processBriefing(filename, content, imageCache) {
  const stats = { generated: 0, reused: 0, inserted: 0, replaced: 0, scraped: 0, scrapeFailures: 0, apiGenerated: 0, fallbackGenerated: 0, cacheTouched: false };
  const blocks = storyBlocks(content);
  let nextContent = content;
  let offset = 0;

  for (const block of blocks) {
    const story = { ...parseStory(block.text, filename), sectionTitle: block.sectionTitle };
    if (!story.title || !story.url) continue;

    const existingImage = story.image;
    const hasExternalImage = existingImage && !existingImage.startsWith(`${publicPrefix}/`);
    if (hasExternalImage) continue;

    if (!isRedditStory(story)) {
      const scrapedImage = await findArticleImage(story.url, imageCache, stats);
      if (scrapedImage) {
        const updatedBlock = upsertImageLine(block.text, scrapedImage);
        const start = block.start + offset;
        const end = block.end + offset;
        nextContent = `${nextContent.slice(0, start)}${updatedBlock}${nextContent.slice(end)}`;
        offset += updatedBlock.length - block.text.length;
        stats.scraped += 1;
        if (existingImage?.startsWith(`${publicPrefix}/`)) stats.replaced += 1;
        else stats.inserted += 1;
        continue;
      }
    }

    const slug = stableSlug(filename, story);
    const publicPath = `${publicPrefix}/${slug}.svg`;
    const outputPath = path.join(outputDir, `${slug}.svg`);
    const hash = contentHash({
      ...story,
      sectionTitle: undefined,
      image: undefined,
      generatedFallbackSize: `${GENERATED_FALLBACK_WIDTH}x${GENERATED_FALLBACK_HEIGHT}`,
    });
    const currentHash = await readGeneratedHash(outputPath);

    if (currentHash === hash) {
      stats.reused += 1;
    } else {
      const { svg, source } = await createSvg(story, hash);
      await fs.writeFile(outputPath, svg);
      stats.generated += 1;
      if (source === 'openai') stats.apiGenerated += 1;
      else stats.fallbackGenerated += 1;
      console.log(`${source === 'openai' ? 'generated' : 'fallback'} ${path.relative(root, outputPath)}`);
    }

    if (!existingImage) {
      const updatedBlock = insertImageLine(block.text, publicPath);
      const start = block.start + offset;
      const end = block.end + offset;
      nextContent = `${nextContent.slice(0, start)}${updatedBlock}${nextContent.slice(end)}`;
      offset += updatedBlock.length - block.text.length;
      stats.inserted += 1;
    }
  }

  return { content: nextContent, stats };
}

function storyBlocks(content) {
  const blocks = [];
  const heading = /^### \[(.+?)\]\((.+?)\)\s*$/gm;
  const matches = [...content.matchAll(heading)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index : content.length;
    let end = nextStart;
    const separator = content.slice(start, nextStart).match(/\n---\s*(?=\n(?:### |## |$))/);
    if (separator?.index !== undefined) end = start + separator.index + separator[0].length;
    blocks.push({ start, end, text: content.slice(start, end), sectionTitle: nearestSectionTitle(content, start) });
  }
  return blocks;
}

function parseStory(block, filename) {
  const heading = block.match(/^### \[(.+?)\]\((.+?)\)\s*$/m);
  const meta = block.match(/\*\*(?:Source|Channel):\*\*\s*(.+?)(?:\s*\||\n)/);
  return {
    date: filename.replace(/\.md$/, ''),
    title: heading?.[1]?.trim() || '',
    url: heading?.[2]?.trim() || '',
    source: meta?.[1]?.trim() || '',
    topic: capture(block, /\*\*Topic:\*\*\s*(.+?)(?:\s{2,}|\n|\|)/),
    rating: capture(block, /\*\*Rating:\*\*\s*([^\n|]+)/),
    image: capture(block, /\*\*Image:\*\*\s*(\S+)/),
    body: capture(block, />\s+([\s\S]*?)(?:\n---\s*$|$)/).replace(/\n>\s*/g, ' ').trim(),
  };
}

function insertImageLine(block, imagePath) {
  const lines = block.split('\n');
  let insertAt = lines.findIndex((line, index) => index > 0 && line.trim() === '');
  if (insertAt === -1) insertAt = Math.min(lines.length, 4);
  while (insertAt + 1 < lines.length && lines[insertAt + 1].trim() === '') insertAt += 1;
  lines.splice(insertAt + 1, 0, `**Image:** ${imagePath}`, '');
  return lines.join('\n');
}

function upsertImageLine(block, imagePath) {
  if (/^\*\*Image:\*\*\s*\S+\s*$/m.test(block)) {
    return block.replace(/^\*\*Image:\*\*\s*\S+\s*$/m, `**Image:** ${imagePath}`);
  }
  return insertImageLine(block, imagePath);
}

function nearestSectionTitle(content, start) {
  const before = content.slice(0, start);
  const sections = [...before.matchAll(/^##\s+(.+)$/gm)];
  const title = sections.at(-1)?.[1] || '';
  if (/Reddit/i.test(title)) return 'Reddit';
  if (/YouTube/i.test(title)) return 'YouTube';
  if (/News|Articles/i.test(title)) return 'News';
  return title.replace(/^[^\w]+\s*/, '').trim();
}

function isRedditStory(story) {
  return story.sectionTitle === 'Reddit' || /(^|\.)reddit\.com$/i.test(hostnameFromUrl(story.url)) || /(^|\.)redd\.it$/i.test(hostnameFromUrl(story.url));
}

async function findArticleImage(url, cache, stats) {
  const key = normalizeUrl(url);
  if (!key) return '';
  if (Object.hasOwn(cache, key)) {
    const cachedImage = cache[key]?.image || '';
    return isAcceptableSourceImage(cachedImage) ? cachedImage : '';
  }

  try {
    const image = await scrapeArticleImage(key);
    cache[key] = { image: image || null, checkedAt: new Date().toISOString() };
    stats.cacheTouched = true;
    if (!image) stats.scrapeFailures += 1;
    return image;
  } catch (error) {
    cache[key] = { image: null, checkedAt: new Date().toISOString(), error: error.message.slice(0, 160) };
    stats.cacheTouched = true;
    stats.scrapeFailures += 1;
    return '';
  }
}

async function scrapeArticleImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), scrapeTimeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) return '';
    const html = (await response.text()).slice(0, 600000);
    return extractBestImage(html, response.url || url);
  } finally {
    clearTimeout(timeout);
  }
}

function extractBestImage(html, baseUrl) {
  const candidates = [];
  const metaPatterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/gi,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/gi,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/gi,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["'][^>]*>/gi,
  ];
  const metaWidth = metaDimension(html, /(?:og:image:width|twitter:image:width)/i);
  const metaHeight = metaDimension(html, /(?:og:image:height|twitter:image:height)/i);
  for (const pattern of metaPatterns) {
    for (const match of html.matchAll(pattern)) {
      candidates.push({ url: decodeHtml(match[1]), score: 100, width: metaWidth, height: metaHeight, source: 'meta' });
    }
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = largestSrcsetCandidate(attr(tag, 'srcset') || attr(tag, 'data-srcset'))
      || attr(tag, 'src')
      || attr(tag, 'data-src')
      || attr(tag, 'data-original')
      || attr(tag, 'data-lazy-src');
    if (!src) continue;
    const width = Number.parseInt(attr(tag, 'width') || '0', 10);
    const height = Number.parseInt(attr(tag, 'height') || '0', 10);
    const alt = attr(tag, 'alt');
    const area = width * height;
    const score = (area >= MIN_DISPLAY_IMAGE_WIDTH * 500 ? 80 : 35) + (alt ? 8 : 0) + Math.min(area / 10000, 30);
    candidates.push({ url: decodeHtml(src), score, width, height, source: attr(tag, 'srcset') ? 'srcset' : 'img' });
  }

  return candidates
    .map((candidate) => ({ ...candidate, url: absolutize(candidate.url, baseUrl) }))
    .map((candidate) => ({ ...candidate, score: scoreImageCandidate(candidate) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score)[0]?.url || '';
}

function metaDimension(html, namePattern) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const property = attr(tag, 'property') || attr(tag, 'name');
    if (!namePattern.test(property)) continue;
    const value = Number.parseInt(attr(tag, 'content') || '0', 10);
    if (value > 0) return value;
  }
  return 0;
}

function attr(tag, name) {
  return tag.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))?.[1]?.trim() || '';
}

function absolutize(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return '';
  }
}

function isUsableImageUrl(value) {
  return isAcceptableSourceImage(value);
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

async function readImageCache() {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    console.warn(`Could not read image cache: ${error.message}`);
    return {};
  }
}

async function writeImageCache(cache) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

async function createSvg(story, hash) {
  if (apiKey) {
    try {
      const raw = await generateWithOpenAI(story);
      const sanitized = sanitizeSvg(raw, hash);
      if (sanitized) return { svg: sanitized, source: 'openai' };
      console.warn(`OpenAI returned unsafe/invalid SVG for "${story.title}"; using local fallback`);
    } catch (error) {
      console.warn(`OpenAI image fallback failed for "${story.title}": ${error.message}; using local fallback`);
    }
  }
  return { svg: localSvg(story, hash), source: 'local' };
}

async function generateWithOpenAI(story) {
  const prompt = `Create a safe, original, editorial SVG illustration for a Factory Signal story card.\n\nBrand: Factory Signal, daily intelligence for the future of manufacturing.\nStyle: clean vector, modern manufacturing trade publication, dark navy background with amber/cyan accents, no logos except small text "Factory Signal", no copyrighted characters, no photorealistic faces, no political symbols.\nSubject: ${story.topic || 'advanced manufacturing'}\nTitle: ${story.title}\nSource: ${story.source}\nSummary: ${story.body || 'Manufacturing, automation, robotics, CNC, 3D printing, or industrial AI story.'}\n\nReturn only complete inline SVG markup. Requirements: <svg xmlns="http://www.w3.org/2000/svg" width="${GENERATED_FALLBACK_WIDTH}" height="${GENERATED_FALLBACK_HEIGHT}" viewBox="0 0 ${GENERATED_FALLBACK_WIDTH} ${GENERATED_FALLBACK_HEIGHT}">, no Markdown fences, no scripts, no foreignObject, no external images, no remote links, no event handlers, accessible <title> and <desc>.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: 'You create safe standalone SVG editorial illustrations only. Return SVG markup and nothing else.' },
        { role: 'user', content: prompt },
      ],
      max_output_tokens: 3500,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return extractResponseText(data);
}

function extractResponseText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('\n');
}

function sanitizeSvg(raw, hash) {
  if (!raw || typeof raw !== 'string') return '';
  const match = raw.match(/<svg\b[\s\S]*<\/svg>/i);
  if (!match) return '';
  let svg = match[0]
    .replace(/```(?:svg)?/gi, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();

  const unsafe = [/<script\b/i, /<foreignObject\b/i, /<iframe\b/i, /<object\b/i, /<embed\b/i, /<image\b/i, /\son[a-z]+\s*=/i, /javascript:/i, /data:/i, /https?:\/\//i, /<a\b/i];
  if (unsafe.some((regex) => regex.test(svg))) return '';

  const allowedTags = new Set(['svg', 'title', 'desc', 'defs', 'linearGradient', 'radialGradient', 'stop', 'filter', 'feDropShadow', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'clipPath', 'mask', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan']);
  for (const tag of svg.matchAll(/<\/?([a-zA-Z][\w:-]*)\b/g)) {
    if (!allowedTags.has(tag[1])) return '';
  }

  if (!/<svg\b[^>]*xmlns=/i.test(svg)) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/<svg\b[^>]*viewBox=/i.test(svg)) svg = svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${GENERATED_FALLBACK_WIDTH} ${GENERATED_FALLBACK_HEIGHT}"`);
  if (!/<svg\b[^>]*\swidth=/i.test(svg)) svg = svg.replace(/<svg\b/i, `<svg width="${GENERATED_FALLBACK_WIDTH}"`);
  if (!/<svg\b[^>]*\sheight=/i.test(svg)) svg = svg.replace(/<svg\b/i, `<svg height="${GENERATED_FALLBACK_HEIGHT}"`);
  if (!/<title>/i.test(svg)) svg = svg.replace(/(<svg\b[^>]*>)/i, '$1<title>Factory Signal generated story illustration</title>');
  return `<!-- factory-signal-generated hash:${hash} source:openai -->\n${svg}\n`;
}

function localSvg(story, hash) {
  const palette = palettes[Number.parseInt(hash.slice(0, 8), 16) % palettes.length];
  const label = labelFrom(story.topic || story.source || story.title);
  const title = escapeXml(story.title);
  const topic = escapeXml(story.topic || story.source || 'Manufacturing intelligence');
  const a = Number.parseInt(hash.slice(8, 10), 16);
  const b = Number.parseInt(hash.slice(10, 12), 16);
  const c = Number.parseInt(hash.slice(12, 14), 16);
  const arm = 160 + (a % 120);
  const gear = 70 + (b % 55);
  const shift = c % 90;

  return `<!-- factory-signal-generated hash:${hash} source:local -->
<svg xmlns="http://www.w3.org/2000/svg" width="${GENERATED_FALLBACK_WIDTH}" height="${GENERATED_FALLBACK_HEIGHT}" viewBox="0 0 ${GENERATED_FALLBACK_WIDTH} ${GENERATED_FALLBACK_HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">Factory Signal illustration for ${title}</title>
  <desc id="desc">Branded editorial vector artwork for a manufacturing story about ${topic}.</desc>
  <g transform="scale(${GENERATED_FALLBACK_WIDTH / 1200})">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette[0]}"/><stop offset="1" stop-color="#020617"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette[1]}"/><stop offset="1" stop-color="${palette[3]}"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.35"/></filter>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <path d="M0 520 C220 440 340 595 560 520 S920 405 1200 500 V675 H0Z" fill="${palette[2]}" opacity="0.12"/>
  <g opacity="0.18" stroke="${palette[2]}" stroke-width="2"><path d="M85 95H1115M85 205H1115M85 315H1115M85 425H1115M85 535H1115"/><path d="M170 60V600M340 60V600M510 60V600M680 60V600M850 60V600M1020 60V600"/></g>
  <g transform="translate(${130 + shift} 120)" filter="url(#shadow)">
    <rect x="0" y="260" width="720" height="190" rx="28" fill="#0b1220" stroke="${palette[1]}" stroke-width="6"/>
    <rect x="52" y="305" width="165" height="90" rx="14" fill="${palette[2]}" opacity="0.16"/>
    <rect x="252" y="305" width="165" height="90" rx="14" fill="${palette[2]}" opacity="0.16"/>
    <rect x="452" y="305" width="165" height="90" rx="14" fill="${palette[2]}" opacity="0.16"/>
    <path d="M92 260 L150 170 H620 L685 260Z" fill="#111827" stroke="${palette[3]}" stroke-width="5"/>
    <path d="M215 166 V86 H300 V166M465 166 V70 H550 V166" fill="none" stroke="${palette[1]}" stroke-width="16" stroke-linejoin="round"/>
    <circle cx="815" cy="352" r="${gear}" fill="url(#accent)" opacity="0.95"/>
    <circle cx="815" cy="352" r="${Math.round(gear * 0.48)}" fill="#0f172a"/>
    <g stroke="${palette[2]}" stroke-width="16" stroke-linecap="round"><path d="M815 ${352 - gear - 36}v34M815 ${352 + gear + 36}v-34M${815 - gear - 36} 352h34M${815 + gear + 36} 352h-34"/><path d="M${815 - gear * 0.72} ${352 - gear * 0.72}l25 25M${815 + gear * 0.72} ${352 - gear * 0.72}l-25 25M${815 - gear * 0.72} ${352 + gear * 0.72}l25-25M${815 + gear * 0.72} ${352 + gear * 0.72}l-25-25"/></g>
    <path d="M835 284 C910 210 1010 245 1030 330" fill="none" stroke="${palette[1]}" stroke-width="30" stroke-linecap="round"/>
    <path d="M1030 330 l${arm} 58" stroke="${palette[3]}" stroke-width="34" stroke-linecap="round"/>
    <circle cx="1030" cy="330" r="38" fill="#0f172a" stroke="${palette[2]}" stroke-width="12"/>
    <path d="M${1030 + arm} 388 l54 -35M${1030 + arm} 388 l46 45" stroke="${palette[1]}" stroke-width="18" stroke-linecap="round"/>
  </g>
  <g transform="translate(76 70)">
    <text x="0" y="0" fill="${palette[1]}" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="4">FACTORY SIGNAL</text>
    <rect x="0" y="30" width="150" height="8" rx="4" fill="${palette[1]}"/>
  </g>
  <g transform="translate(76 535)">
    <rect x="0" y="-66" width="170" height="96" rx="22" fill="${palette[1]}"/>
    <text x="85" y="0" text-anchor="middle" fill="#111827" font-family="Inter, Arial, sans-serif" font-size="54" font-weight="900">${escapeXml(label)}</text>
    <text x="205" y="-26" fill="#f8fafc" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800">${topic}</text>
    <text x="205" y="18" fill="#cbd5e1" font-family="Inter, Arial, sans-serif" font-size="22">Generated editorial artwork</text>
  </g>
  </g>
</svg>
`;
}

async function readGeneratedHash(file) {
  try {
    const svg = await fs.readFile(file, 'utf8');
    return svg.match(/factory-signal-generated hash:([a-f0-9]{64})/)?.[1] || '';
  } catch {
    return '';
  }
}

function stableSlug(filename, story) {
  const date = filename.replace(/\.md$/, '');
  const base = slugify(story.title).slice(0, 64) || 'story';
  const id = shortHash(story.url || story.title);
  return `${date}-${base}-${id}`;
}

function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function shortHash(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function labelFrom(value) {
  return String(value)
    .replace(/[^a-z0-9&/ ]/gi, ' ')
    .split(/[\s/&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || 'FS';
}

function capture(text, regex) {
  return text.match(regex)?.[1]?.trim() || '';
}

function escapeXml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

async function safeReadDir(dir) {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
