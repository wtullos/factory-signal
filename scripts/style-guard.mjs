#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArticleMarkdown } from '../src/lib/content.js';
import { aiTellContrastViolations } from '../src/lib/style-guard.js';
import { readabilityReview } from '../src/lib/readability.js';

const root = process.cwd();
const targets = process.argv.slice(2);
const pathsToCheck = targets.length > 0 ? targets : [
  path.join('content', 'drafts'),
  path.join('content', 'articles'),
  path.join('src', 'pages'),
  path.join('src', 'components'),
  path.join('src', 'layouts'),
];
const filesToCheck = pathsToCheck.flatMap((target) => collectStyleGuardFiles(path.resolve(root, target)));

let failureCount = 0;

for (const filePath of filesToCheck) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(root, filePath);
  const article = filePath.endsWith('.md') ? parseArticleMarkdown(path.basename(filePath), raw, { dir: path.dirname(relativePath) }) : null;
  const violations = aiTellContrastViolations(raw);
  const readability = article ? readabilityReview(article) : null;

  if (readability?.warnings?.length) {
    console.warn(`${relativePath}: readability review advised (${readability.warnings.join(', ')}; avg sentence ${readability.averageSentenceWords} words, max ${readability.maxSentenceWords}).`);
    console.warn('  Target 4th-grade plain English: short sentences, short paragraphs, active verbs, and simple explanations for hard manufacturing terms.');
  }

  if (violations.length === 0) continue;

  failureCount += violations.length;
  console.error(`${relativePath}: found ${violations.length} Factory Signal style guard violation(s)`);
  for (const violation of violations) {
    console.error(`  line ${violation.line}: ${violation.code}: ${JSON.stringify(violation.match)}`);
    console.error(`    ${violation.message}`);
  }
}

if (failureCount > 0) {
  console.error(`\nFactory Signal style guard failed with ${failureCount} AI-tell contrast framing violation(s).`);
  console.error('Rewrite with direct claims; avoid “This is not X, it is Y” and “not just X but Y” formulas.');
  process.exit(1);
}

console.log(`Factory Signal style guard passed (${filesToCheck.length} file${filesToCheck.length === 1 ? '' : 's'} checked).`);

function collectStyleGuardFiles(targetPath) {
  if (!fs.existsSync(targetPath)) return [];
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return isStyleGuardFile(targetPath) ? [targetPath] : [];
  if (!stat.isDirectory()) return [];

  return fs.readdirSync(targetPath)
    .flatMap((entry) => collectStyleGuardFiles(path.join(targetPath, entry)))
    .sort((a, b) => a.localeCompare(b));
}

function isStyleGuardFile(filePath) {
  return ['.md', '.astro'].includes(path.extname(filePath));
}
