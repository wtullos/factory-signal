import { canonical, getArticles } from './content.js';

const MANUFACTURING_TERMS = /\b(factory|manufactur(?:e|ing)|industrial|cnc|robot|automation|quality|inspection|metrology|additive|3d printing|machining|shop|production|plant|cell)\b/i;
const SPAMMY_TERMS = /\b(best|ultimate|guaranteed|secret|shocking|insane|unbelievable|#\s*1|rank(?:s|ed)?\s*#?1)\b/i;
const USEFUL_SECTION_TERMS = /\b(takeaway|practical|implementation|trade[- ]?off|why it matters|pilot|workflow|plan|risk|constraint|measurement|operator|source|evidence)\b/i;
const TRUST_TERMS = /\b(source|according to|nist|standard|research|data|evidence|measured|metric|validated|citation|study)\b/i;
const VAGUE_INTRO_TERMS = /\b(today'?s?\s+(world|landscape)|rapidly evolving|game changer|revolutionary|in this article|dive into|delve into)\b/i;
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'before', 'after', 'that', 'this', 'needs', 'need', 'when', 'what', 'why', 'how', 'a', 'an', 'to', 'of', 'in', 'on', 'it', 'is', 'are', 'as', 'by']);

export function buildSeoAudit(articles = getArticles(), options = {}) {
  const normalized = articles.map(normalizeArticle);
  const titleCounts = countBy(normalized.map((article) => normalizeComparable(article.title)).filter(Boolean));
  const descriptionCounts = countBy(normalized.map((article) => normalizeComparable(article.description)).filter(Boolean));
  const articleAudits = normalized.map((article) => auditArticle(article, normalized, { ...options, titleCounts, descriptionCounts }));
  const totals = summarizeAudit(articleAudits, titleCounts, descriptionCounts);

  return {
    generatedAt: new Date().toISOString(),
    totals,
    articles: articleAudits,
    duplicates: {
      titles: duplicateValues(titleCounts),
      descriptions: duplicateValues(descriptionCounts),
    },
  };
}

export function auditArticle(articleInput, allArticlesInput = [articleInput], options = {}) {
  const article = normalizeArticle(articleInput);
  const allArticles = allArticlesInput.map(normalizeArticle);
  const issues = [];
  const recommendations = [];
  let score = 100;

  const headings = extractHeadings(article.body);
  const links = extractMarkdownLinks(article.body);
  const internalLinks = links.filter((link) => isInternalArticleLink(link.href));
  const externalLinks = links.filter((link) => /^https?:\/\//i.test(link.href));
  const wordCount = countWords(article.body);
  const titleWords = tokenize(article.title);
  const sourceCount = article.sourceUrls.length;
  const firstParagraph = extractFirstParagraph(article.body);
  const titleCounts = options.titleCounts || countBy(allArticles.map((candidate) => normalizeComparable(candidate.title)).filter(Boolean));
  const descriptionCounts = options.descriptionCounts || countBy(allArticles.map((candidate) => normalizeComparable(candidate.description)).filter(Boolean));

  const addIssue = (severity, code, message, points = 0) => {
    issues.push({ severity, code, message });
    score -= points;
  };
  const addRecommendation = (code, message) => recommendations.push({ code, message });

  if (!article.title) addIssue('error', 'title-missing', 'Add a clear article title.', 18);
  else {
    if ((titleCounts.get(normalizeComparable(article.title)) || 0) > 1) addIssue('error', 'title-duplicate', 'Title duplicates another article; make the title specific to this page.', 14);
    if (article.title.length < 35) addIssue('warning', 'title-short', 'Title is under the 35 character soft target; clarify the manufacturing angle.', 7);
    if (article.title.length > 65) addIssue('warning', 'title-long', 'Title is over the 65 character soft target; consider a tighter title link.', 6);
    if (!MANUFACTURING_TERMS.test(article.title)) addIssue('opportunity', 'title-entity', 'Title should name a manufacturing entity, process, or audience.', 5);
    if (looksRepetitive(titleWords)) addIssue('warning', 'title-repetitive', 'Title repeats terms in a way that may look over-optimized.', 8);
    if (SPAMMY_TERMS.test(article.title)) addIssue('warning', 'title-hype', 'Avoid superlative or ranking-style title language unless directly supported.', 8);
  }

  if (!article.description) addIssue('error', 'description-missing', 'Add a concise meta description that matches the page.', 14);
  else {
    if ((descriptionCounts.get(normalizeComparable(article.description)) || 0) > 1) addIssue('error', 'description-duplicate', 'Meta description duplicates another article; write a unique summary.', 12);
    if (article.description.length < 120) addIssue('opportunity', 'description-short', 'Description is under the 120 character soft target; add useful specifics.', 4);
    if (article.description.length > 170) addIssue('warning', 'description-long', 'Description is over the 170 character soft target; tighten the snippet.', 5);
    if (looksRepetitive(tokenize(article.description)) || SPAMMY_TERMS.test(article.description)) addIssue('warning', 'description-stuffing', 'Description may read like stuffing or hype; keep it factual and helpful.', 8);
  }

  if (wordCount < 600) addIssue('warning', 'content-thin', 'Article is short for a technical manufacturing explainer; add useful examples, constraints, or evidence.', 10);
  if (headings.filter((heading) => heading.level === 2).length === 0) addIssue('warning', 'h2-missing', 'Add H2 sections so readers and search systems can parse the structure.', 9);
  if (!headings.some((heading) => USEFUL_SECTION_TERMS.test(heading.text)) && !USEFUL_SECTION_TERMS.test(article.body)) {
    addIssue('opportunity', 'practical-sections', 'Add practical sections such as tradeoffs, implementation, why it matters, workflow, or takeaways.', 6);
  }

  if (!firstParagraph || countWords(firstParagraph) < 35 || VAGUE_INTRO_TERMS.test(firstParagraph)) {
    addIssue('warning', 'intro-answer-first', 'Make the opening paragraph answer-first: directly state what the page explains and why it matters.', 8);
  }

  if (!article.author) addIssue('warning', 'author-missing', 'Add a visible author for trust and accountability.', 7);
  if (!article.pubDate && !article.date) addIssue('warning', 'date-missing', 'Add a publication date for freshness and trust context.', 6);
  if (sourceCount === 0) addIssue('warning', 'sources-missing', 'Add sourceUrls for technical claims and visible citations.', 10);
  else if (sourceCount < 2 && /\b(nist|standard|research|study|data|claims?|performance|metric)\b/i.test(article.body)) addIssue('opportunity', 'sources-light', 'Consider more than one source for technical claims or standards references.', 4);
  if (!TRUST_TERMS.test(article.body) && sourceCount === 0) addIssue('opportunity', 'trust-signals', 'Add evidence, sources, measurement context, or named standards where claims need support.', 5);
  if (SPAMMY_TERMS.test(article.body)) addIssue('warning', 'unsupported-superlatives', 'Review unsupported superlatives or hype language in the body.', 6);

  if (article.imageUrl && !article.imageAlt) addIssue('warning', 'image-alt-missing', 'Hero image has no alt text.', 6);
  if (!article.imageUrl) addIssue('opportunity', 'image-missing', 'Consider a relevant image with descriptive alt text when it improves the article.', 2);

  if (internalLinks.length === 0 && allArticles.length > 1) addIssue('opportunity', 'internal-links-missing', 'Add at least one crawlable internal article link where it genuinely helps the reader.', 6);
  if (externalLinks.length === 0 && sourceCount === 0) addIssue('opportunity', 'external-context-missing', 'Add citations or source links for technical context.', 4);

  const structuredDataReady = Boolean(article.title && article.description && article.pubDate && article.author);
  if (!structuredDataReady) addIssue('opportunity', 'structured-data-fields', 'Article schema needs title, description, date, and author fields.', 4);

  const relatedArticles = suggestRelatedArticles(article, allArticles, internalLinks).slice(0, 3);
  if (relatedArticles.length > 0) addRecommendation('internal-link-candidates', `Consider contextual links to: ${relatedArticles.map((item) => item.title).join('; ')}.`);
  if (headings.filter((heading) => heading.level === 2).length < 2) addRecommendation('add-headings', 'Use descriptive H2s for questions, tasks, constraints, and next steps.');
  if (sourceCount > 0) addRecommendation('sources-visible', 'Keep visible source links near the article footer and ensure claims match citations.');
  addRecommendation('suggested-title', `Suggested title: ${suggestTitle(article)}`);
  addRecommendation('suggested-description', `Suggested description: ${suggestDescription(article)}`);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const missingSections = inferMissingSections(article, headings);

  return {
    slug: article.slug,
    url: `/articles/${article.slug}/`,
    canonicalUrl: canonical(`/articles/${article.slug}/`),
    title: article.title,
    description: article.description,
    pubDate: article.pubDate,
    date: article.date,
    author: article.author,
    tags: article.tags,
    wordCount,
    headings,
    sourcesCount: sourceCount,
    image: { url: article.imageUrl, alt: article.imageAlt, hasAlt: Boolean(article.imageUrl && article.imageAlt) },
    internalLinks,
    externalLinks,
    structuredDataReady,
    suggestedTitle: suggestTitle(article),
    suggestedDescription: suggestDescription(article),
    relatedArticles,
    missingSections,
    score,
    issues,
    recommendations,
  };
}

export function suggestTitle(articleInput) {
  const article = normalizeArticle(articleInput);
  const base = cleanTitle(article.title || titleFromSlug(article.slug));
  if (base.length >= 35 && base.length <= 65 && MANUFACTURING_TERMS.test(base) && !SPAMMY_TERMS.test(base)) return base;
  const tag = article.tags.find((item) => MANUFACTURING_TERMS.test(item)) || article.tags[0] || 'Manufacturing';
  const candidate = `${base.replace(/\s+\|\s+Factory Signal$/i, '')}: ${tag} Guide`;
  return truncateAtWord(candidate, 65);
}

export function suggestDescription(articleInput) {
  const article = normalizeArticle(articleInput);
  const current = normalizeWhitespace(article.description);
  if (current.length >= 120 && current.length <= 170 && !looksRepetitive(tokenize(current)) && !SPAMMY_TERMS.test(current)) return current;
  const intro = normalizeWhitespace(extractFirstParagraph(article.body));
  const seed = current || intro || `${article.title} explains practical manufacturing decisions, constraints, and signals.`;
  const suffix = article.tags.length ? ` Covers ${article.tags.slice(0, 3).join(', ')} with a practical factory lens.` : ' Covers practical factory context, tradeoffs, and next steps.';
  return truncateAtWord(`${stripMarkdown(seed)}${suffix}`, 170, 120);
}

export function suggestRelatedArticles(articleInput, allArticlesInput = [], existingInternalLinks = []) {
  const article = normalizeArticle(articleInput);
  const existingSlugs = new Set(existingInternalLinks.map((link) => extractArticleSlug(link.href)).filter(Boolean));
  const terms = new Set([...article.tags.map(normalizeComparable), ...keywords(article.title), ...keywords(article.body).slice(0, 12)].filter(Boolean));
  return allArticlesInput
    .map(normalizeArticle)
    .filter((candidate) => candidate.slug && candidate.slug !== article.slug && !existingSlugs.has(candidate.slug))
    .map((candidate) => {
      const candidateTerms = new Set([...candidate.tags.map(normalizeComparable), ...keywords(candidate.title), ...keywords(candidate.body).slice(0, 12)].filter(Boolean));
      let overlap = 0;
      terms.forEach((term) => { if (candidateTerms.has(term)) overlap += 1; });
      return { slug: candidate.slug, title: candidate.title, url: `/articles/${candidate.slug}/`, overlap };
    })
    .filter((candidate) => candidate.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.title.localeCompare(b.title));
}

function summarizeAudit(articles, titleCounts, descriptionCounts) {
  const issueCounts = articles.flatMap((article) => article.issues).reduce((counts, issue) => {
    counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    return counts;
  }, { error: 0, warning: 0, opportunity: 0 });
  const articlesNeedingWork = articles.filter((article) => article.score < 85 || article.issues.some((issue) => issue.severity === 'error')).length;
  return {
    articleCount: articles.length,
    averageScore: articles.length ? Math.round(articles.reduce((sum, article) => sum + article.score, 0) / articles.length) : 0,
    errors: issueCounts.error || 0,
    warnings: issueCounts.warning || 0,
    opportunities: issueCounts.opportunity || 0,
    articlesNeedingWork,
    duplicateTitles: duplicateValues(titleCounts).length,
    duplicateDescriptions: duplicateValues(descriptionCounts).length,
    lowInternalLinkItems: articles.filter((article) => article.internalLinks.length === 0).map((article) => article.slug),
  };
}

function normalizeArticle(article = {}) {
  return {
    slug: String(article.slug || '').trim(),
    title: normalizeWhitespace(article.title),
    description: normalizeWhitespace(article.description),
    pubDate: String(article.pubDate || '').trim(),
    date: String(article.date || article.pubDate || '').trim(),
    author: normalizeWhitespace(article.author),
    tags: Array.isArray(article.tags) ? article.tags.map((tag) => normalizeWhitespace(tag)).filter(Boolean) : [],
    sourceUrls: Array.isArray(article.sourceUrls) ? article.sourceUrls.filter(Boolean) : [],
    imageUrl: String(article.imageUrl || '').trim(),
    imageAlt: normalizeWhitespace(article.imageAlt),
    body: String(article.body || ''),
  };
}

function extractHeadings(markdown = '') {
  return [...String(markdown).matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
    level: match[1].length,
    text: stripMarkdown(match[2]).trim(),
  }));
}

function extractMarkdownLinks(markdown = '') {
  return [...String(markdown).matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]+")?\)/g)].map((match) => ({ text: stripMarkdown(match[1]).trim(), href: match[2].trim() }));
}

function isInternalArticleLink(href) {
  return /^\/articles\/[^/]+\/?(?:#.*)?$/i.test(href) || /^https?:\/\/thefactorysignal\.com\/articles\/[^/]+\/?(?:#.*)?$/i.test(href);
}

function extractArticleSlug(href = '') {
  const match = String(href).match(/\/articles\/([^/#?]+)\/?/i);
  return match ? match[1] : '';
}

function extractFirstParagraph(markdown = '') {
  const withoutFrontmatter = String(markdown).replace(/^---[\s\S]*?---\s*/, '');
  return withoutFrontmatter.split(/\n\s*\n/).map((block) => block.trim()).find((block) => block && !block.startsWith('#') && !block.startsWith('![') && !block.startsWith('- ')) || '';
}

function inferMissingSections(article, headings) {
  const text = `${headings.map((heading) => heading.text).join(' ')} ${article.body}`;
  const candidates = [
    ['answer-first intro', extractFirstParagraph(article.body) && countWords(extractFirstParagraph(article.body)) >= 35],
    ['practical implementation', /\b(implementation|workflow|pilot|plan|steps|practical)\b/i.test(text)],
    ['tradeoffs or risks', /\b(trade[- ]?off|risk|constraint|false accept|false reject|cost)\b/i.test(text)],
    ['why it matters', /\b(why it matters|matters|important|because|value)\b/i.test(text)],
    ['sources/citations', article.sourceUrls.length > 0 || /\b(source|according to|citation)\b/i.test(text)],
  ];
  return candidates.filter(([, present]) => !present).map(([label]) => label);
}

function countWords(value = '') {
  const words = stripMarkdown(value).match(/\b[a-z0-9][a-z0-9'-]*\b/gi);
  return words ? words.length : 0;
}

function tokenize(value = '') {
  return normalizeComparable(value).split(/\s+/).filter(Boolean);
}

function keywords(value = '') {
  return tokenize(stripMarkdown(value)).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function looksRepetitive(words) {
  if (words.length < 6) return false;
  const counts = countBy(words.filter((word) => !STOP_WORDS.has(word)));
  return [...counts.values()].some((count) => count >= 3);
}

function countBy(values) {
  const map = new Map();
  values.forEach((value) => map.set(value, (map.get(value) || 0) + 1));
  return map;
}

function duplicateValues(counts) {
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

function normalizeComparable(value = '') {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripMarkdown(value = '') {
  return String(value).replace(/!\[[^\]]*\]\([^)]+\)/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#>*_`~|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanTitle(value = '') {
  return normalizeWhitespace(stripMarkdown(value)).replace(/[.!?]+$/g, '');
}

function titleFromSlug(slug = '') {
  return String(slug || 'manufacturing article').replace(/^\d{4}-\d{2}-\d{2}-?/, '').split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function truncateAtWord(value, maxLength, minLength = 0) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength && text.length >= minLength) return text;
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength + 1).replace(/\s+\S*$/, '').replace(/[,:;\-–—]+$/g, '').trim();
  return truncated || text.slice(0, maxLength).trim();
}
