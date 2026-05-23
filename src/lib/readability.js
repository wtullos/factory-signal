const TEXT_FIELD_KEYS = [
  'title',
  'description',
  'summary',
  'body',
  'deck',
];

const TECH_TERMS = new Set([
  'additive',
  'automation',
  'calibration',
  'certification',
  'cnc',
  'composite',
  'diagnostics',
  'fixture',
  'inspection',
  'machining',
  'manufacturing',
  'metrology',
  'qualification',
  'robotics',
  'simulation',
  'supplier',
  'traceability',
]);

export function readabilityTextFor(item = {}) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';

  return TEXT_FIELD_KEYS
    .flatMap((key) => flattenTextFields(item[key]))
    .filter(Boolean)
    .join('\n')
    .replace(/\r\n/g, '\n');
}

export function readabilityReview(item = {}) {
  const text = stripMarkdown(readabilityTextFor(item));
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const sentences = splitSentences(text);
  const sentenceWordCounts = sentences.map(wordCount);
  const paragraphWordCounts = paragraphs.map(wordCount);
  const words = wordsIn(text);
  const longWords = words.filter((word) => word.length >= 10 && !TECH_TERMS.has(word.toLowerCase()));

  return {
    sentenceCount: sentences.length,
    wordCount: words.length,
    averageSentenceWords: average(sentenceWordCounts),
    maxSentenceWords: max(sentenceWordCounts),
    longSentenceCount: sentenceWordCounts.filter((count) => count > 24).length,
    longParagraphCount: paragraphWordCounts.filter((count) => count > 95).length,
    longWordRatio: words.length ? longWords.length / words.length : 0,
    warnings: readabilityWarnings({ sentenceWordCounts, paragraphWordCounts, words, longWords }),
  };
}

export function readabilityWarnings({ sentenceWordCounts = [], paragraphWordCounts = [], words = [], longWords = [] } = {}) {
  const warnings = [];
  const averageSentenceWords = average(sentenceWordCounts);
  const maxSentenceWords = max(sentenceWordCounts);
  const longSentenceCount = sentenceWordCounts.filter((count) => count > 24).length;
  const longParagraphCount = paragraphWordCounts.filter((count) => count > 95).length;
  const longWordRatio = words.length ? longWords.length / words.length : 0;

  if (averageSentenceWords > 17) warnings.push('average-sentence-length');
  if (maxSentenceWords > 36) warnings.push('very-long-sentence');
  if (longSentenceCount > Math.max(2, Math.ceil(sentenceWordCounts.length * 0.12))) warnings.push('many-long-sentences');
  if (longParagraphCount > 0) warnings.push('long-paragraph');
  if (longWordRatio > 0.18) warnings.push('many-long-words');

  return warnings;
}

export function isReadableDraft(item = {}) {
  return readabilityReview(item).warnings.length === 0;
}

function flattenTextFields(fields) {
  if (Array.isArray(fields)) return fields.flatMap((field) => flattenTextFields(field));
  if (fields && typeof fields === 'object') return Object.values(fields).flatMap((field) => flattenTextFields(field));
  return fields == null ? [] : String(fields);
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~#|]/g, '')
    .replace(/https?:\/\/\S+/g, ' ');
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordsIn(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [];
}

function wordCount(text) {
  return wordsIn(text).length;
}

function average(values) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function max(values) {
  return values.length ? Math.max(...values) : 0;
}
