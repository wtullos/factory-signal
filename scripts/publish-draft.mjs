#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArticleMarkdown } from '../src/lib/content.js';
import { schoolFriendlyViolations } from '../src/lib/school-friendly.js';

const root = process.cwd();
const input = process.argv[2];

if (!input) {
  console.error('Usage: node scripts/publish-draft.mjs <draft-slug-or-file>');
  process.exit(1);
}

const draftsDir = path.join(root, 'content', 'drafts');
const articlesDir = path.join(root, 'content', 'articles');

if (!fs.existsSync(draftsDir)) {
  console.error('No content/drafts directory found.');
  process.exit(1);
}

const normalizedInput = input.replace(/^content\/drafts\//, '').replace(/\.md$/, '');
const candidates = fs.readdirSync(draftsDir)
  .filter((file) => file.endsWith('.md'))
  .filter((file) => {
    const raw = fs.readFileSync(path.join(draftsDir, file), 'utf8');
    const frontmatterSlug = readFrontmatterValue(raw, 'slug');
    return file === input
      || file === `${input}.md`
      || file.replace(/\.md$/, '') === normalizedInput
      || slugify(file.replace(/\.md$/, '')) === slugify(normalizedInput)
      || (frontmatterSlug && slugify(frontmatterSlug) === slugify(normalizedInput));
  });

if (candidates.length === 0) {
  console.error(`No draft matched "${input}" in content/drafts/.`);
  process.exit(1);
}

if (candidates.length > 1) {
  console.error(`Multiple drafts matched "${input}": ${candidates.join(', ')}`);
  console.error('Use the exact filename to publish one draft.');
  process.exit(1);
}

fs.mkdirSync(articlesDir, { recursive: true });

const sourceFile = candidates[0];
const sourcePath = path.join(draftsDir, sourceFile);
const rawDraft = fs.readFileSync(sourcePath, 'utf8');
const draftArticle = parseArticleMarkdown(sourceFile, rawDraft, { dir: 'content/drafts' });
const violations = schoolFriendlyViolations(draftArticle);

if (violations.length > 0) {
  console.error(`Draft "${sourceFile}" was not published because it failed the school-friendly content guard.`);
  console.error(`Categories: ${[...new Set(violations)].join(', ')}`);
  console.error('Reason: draft text matched prohibited school-unfriendly content categories.');
  console.error('Review title, description, body, source URLs, and tags before trying again.');
  process.exit(1);
}

const targetFile = uniqueFilename(articlesDir, sourceFile);
const targetPath = path.join(articlesDir, targetFile);

fs.renameSync(sourcePath, targetPath);

console.log(`Moved content/drafts/${sourceFile} -> content/articles/${targetFile}`);
console.log('Review the article, then run npm run build/deploy when ready.');

function uniqueFilename(dir, filename) {
  const ext = path.extname(filename) || '.md';
  const base = slugify(path.basename(filename, ext)) || 'draft';
  let candidate = `${base}${ext}`;
  let counter = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}-${counter}${ext}`;
    counter += 1;
  }
  return candidate;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function readFrontmatterValue(raw, key) {
  if (!raw.startsWith('---')) return '';
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return '';
  const match = raw.slice(3, end).match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}
