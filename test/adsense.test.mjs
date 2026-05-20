import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { adsTxtPublisherId } from '../src/lib/content.js';

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

  const review = fs.readFileSync(new URL('../dist/review/index.html', import.meta.url), 'utf8');
  assert.ok(!review.includes(adsenseScript));
  assert.ok(!review.includes('google-adsense-account'));

  const testPage = fs.readFileSync(new URL('../dist/testpage/index.html', import.meta.url), 'utf8');
  assert.ok(!testPage.includes(adsenseScript));
  assert.ok(!testPage.includes('google-adsense-account'));

  const adsTxt = fs.readFileSync(new URL('../dist/ads.txt', import.meta.url), 'utf8');
  assert.equal(adsTxt, expectedAdsTxt);
});
