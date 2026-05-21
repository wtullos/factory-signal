#!/usr/bin/env node
import { buildSeoAudit } from '../src/lib/seo-audit.js';
import { getArticles } from '../src/lib/content.js';

const jsonMode = process.argv.includes('--json');
const audit = buildSeoAudit(getArticles());

if (jsonMode) {
  console.log(JSON.stringify(audit, null, 2));
  process.exit(0);
}

const { totals } = audit;
console.log('Factory Signal SEO audit');
console.log('========================');
console.log(`Articles: ${totals.articleCount}`);
console.log(`Average score: ${totals.averageScore}`);
console.log(`Issues: ${totals.errors} errors · ${totals.warnings} warnings · ${totals.opportunities} opportunities`);
console.log(`Articles needing work: ${totals.articlesNeedingWork}`);
if (totals.duplicateTitles || totals.duplicateDescriptions) {
  console.log(`Duplicates: ${totals.duplicateTitles} title groups · ${totals.duplicateDescriptions} description groups`);
}
console.log('');

for (const article of audit.articles) {
  const status = article.score >= 90 ? 'strong' : article.score >= 75 ? 'review' : 'needs work';
  console.log(`${article.score}/100 (${status}) ${article.title}`);
  console.log(`  ${article.url} · ${article.wordCount} words · ${article.sourcesCount} sources · ${article.internalLinks.length} internal links`);
  const topIssues = article.issues.slice(0, 4);
  if (topIssues.length) {
    for (const issue of topIssues) console.log(`  - ${issue.severity}: ${issue.message}`);
  } else {
    console.log('  - No major SEO audit issues found.');
  }
  if (article.suggestedTitle !== article.title) console.log(`  Suggested title: ${article.suggestedTitle}`);
  if (article.suggestedDescription !== article.description) console.log(`  Suggested description: ${article.suggestedDescription}`);
  if (article.relatedArticles.length) console.log(`  Internal link candidates: ${article.relatedArticles.map((item) => item.title).join('; ')}`);
  console.log('');
}
