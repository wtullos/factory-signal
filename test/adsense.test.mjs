import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { adsTxtPublisherId, getArticles } from '../src/lib/content.js';
import { onRequest } from '../functions/_middleware.js';

const publisherId = 'ca-pub-8559674558874559';
const adsenseScript = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`;
const adsenseMeta = `<meta name="google-adsense-account" content="${publisherId}">`;
const expectedAdsTxt = 'google.com, pub-8559674558874559, DIRECT, f08c47fec0942fa0\n';

test('adsTxtPublisherId converts AdSense client id to ads.txt seller id', () => {
  assert.equal(adsTxtPublisherId(publisherId), 'pub-8559674558874559');
});

test('AdSense verification renders only on indexed public pages and ads.txt uses pub id', { timeout: 120_000 }, () => {
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ADSENSE_PUBLISHER_ID: publisherId },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const home = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.ok(home.includes(adsenseScript));
  assert.ok(home.includes(adsenseMeta));
  assert.ok(home.includes('/dashboard/'));
  assert.ok(!home.includes('site-search-dropdown'));
  assert.ok(!home.includes('Latest signals'));
  assert.ok(!home.includes('Whitepaper library'));

  const dashboard = fs.readFileSync(new URL('../dist/dashboard/index.html', import.meta.url), 'utf8');
  assert.ok(dashboard.includes(adsenseScript));
  assert.ok(dashboard.includes(adsenseMeta));
  assert.ok(dashboard.includes('Dashboard'));
  assert.ok(dashboard.includes('site-search-dropdown'));
  assert.ok(dashboard.includes('aria-label="Open site search"'));
  assert.ok(!dashboard.includes('site-search-toggle-text'));
  assert.ok(!dashboard.includes('>Search</span>'));

  const article = getArticles()[0];
  assert.ok(article, 'expected at least one public article fixture');
  const articleHtml = fs.readFileSync(new URL(`../dist/articles/${article.slug}/index.html`, import.meta.url), 'utf8');
  assert.ok(articleHtml.includes(adsenseScript));
  assert.ok(articleHtml.includes(adsenseMeta));

  const review = fs.readFileSync(new URL('../dist/review/index.html', import.meta.url), 'utf8');
  assert.ok(!review.includes(adsenseScript));
  assert.ok(!review.includes('google-adsense-account'));

  const privacy = fs.readFileSync(new URL('../dist/privacy/index.html', import.meta.url), 'utf8');
  assert.ok(!privacy.includes(adsenseScript));
  assert.ok(!privacy.includes('google-adsense-account'));

  const about = fs.readFileSync(new URL('../dist/about/index.html', import.meta.url), 'utf8');
  assert.ok(!about.includes(adsenseScript));
  assert.ok(!about.includes('google-adsense-account'));

  const disclosure = fs.readFileSync(new URL('../dist/disclosure/index.html', import.meta.url), 'utf8');
  assert.ok(!disclosure.includes(adsenseScript));
  assert.ok(!disclosure.includes('google-adsense-account'));

  for (const utilityPath of ['contact', 'terms', 'cookie-policy', 'cookies', 'display']) {
    const utilityPage = fs.readFileSync(new URL(`../dist/${utilityPath}/index.html`, import.meta.url), 'utf8');
    assert.ok(!utilityPage.includes(adsenseScript), `${utilityPath} should not include AdSense script`);
    assert.ok(!utilityPage.includes('google-adsense-account'), `${utilityPath} should not include AdSense account meta`);
  }

  const notFound = fs.readFileSync(new URL('../dist/404.html', import.meta.url), 'utf8');
  assert.match(notFound, /<meta name="robots" content="noindex, nofollow"/);
  assert.ok(!notFound.includes(adsenseScript));
  assert.ok(!notFound.includes('google-adsense-account'));

  const testPage = fs.readFileSync(new URL('../dist/testpage/index.html', import.meta.url), 'utf8');
  assert.ok(!testPage.includes(adsenseScript));
  assert.ok(!testPage.includes('google-adsense-account'));

  const adsTxt = fs.readFileSync(new URL('../dist/ads.txt', import.meta.url), 'utf8');
  assert.equal(adsTxt, expectedAdsTxt);
});

test('review login middleware response is noindex and does not include AdSense', async () => {
  const response = await onRequest({
    env: {
      FS_REVIEW_USERNAME: 'wes',
      FS_REVIEW_PASSWORD: 'secret',
      FS_REVIEW_SESSION_SECRET: 'unit-test-session-secret',
    },
    request: new Request('https://thefactorysignal.com/review/login'),
    next: () => new Response('should not reach app'),
  });

  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.match(body, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(!body.includes(adsenseScript));
  assert.ok(!body.includes('google-adsense-account'));
});
