import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

const env = {
  FS_REVIEW_USERNAME: 'wes',
  FS_REVIEW_PASSWORD: 'secret',
  FS_REVIEW_SESSION_SECRET: 'unit-test-session-secret',
};

test('authenticated robot /testpage passes through instead of rewriting to review', async () => {
  const cookie = await loginCookie('https://robot.thefactorysignal.com/login', '/testpage/');
  let nextRequest;

  const response = await onRequest({
    env,
    request: new Request('https://robot.thefactorysignal.com/testpage/', {
      headers: { Cookie: cookie },
    }),
    next: (request) => {
      nextRequest = request;
      return new Response('testpage ok');
    },
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'testpage ok');
  assert.equal(nextRequest, undefined);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('authenticated robot non-pass-through page still rewrites to /review/', async () => {
  const cookie = await loginCookie('https://robot.thefactorysignal.com/login', '/some-preview/');
  let nextRequest;

  await onRequest({
    env,
    request: new Request('https://robot.thefactorysignal.com/some-preview/', {
      headers: { Cookie: cookie },
    }),
    next: (request) => {
      nextRequest = request;
      return new Response('review ok');
    },
  });

  assert.ok(nextRequest instanceof Request);
  assert.equal(new URL(nextRequest.url).pathname, '/review/');
});

test('authenticated robot clean review tabs rewrite to their protected review pages', async () => {
  const cookie = await loginCookie('https://robot.thefactorysignal.com/login', '/sources/');

  for (const [path, expectedPath] of [['/sources/', '/review/sources/'], ['/takeaways/', '/review/takeaways/'], ['/analytics/', '/review/analytics/'], ['/analytics/data', '/review/analytics/data'], ['/seo/', '/review/seo/']]) {
    let nextRequest;
    const response = await onRequest({
      env,
      request: new Request(`https://robot.thefactorysignal.com${path}`, {
        headers: { Cookie: cookie, Accept: 'text/html' },
      }),
      next: (request) => {
        nextRequest = request;
        return new Response(`${expectedPath} ok`, { headers: { 'Content-Type': 'text/html' } });
      },
    });

    assert.equal(response.status, 200);
    assert.ok(nextRequest instanceof Request);
    assert.equal(new URL(nextRequest.url).pathname, expectedPath);
    assert.equal(await response.text(), `${expectedPath} ok`);
  }
});

test('unauthenticated robot /testpage shows protected login', async () => {
  const response = await onRequest({
    env,
    request: new Request('https://robot.thefactorysignal.com/testpage/'),
    next: () => new Response('should not reach app'),
  });

  assert.equal(response.status, 200);
  assert.match(await response.text(), /Review access/);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('main-domain /testpage is also protected and passes through after login', async () => {
  const unauthenticated = await onRequest({
    env,
    request: new Request('https://thefactorysignal.com/testpage/'),
    next: () => new Response('should not reach app'),
  });

  assert.equal(unauthenticated.status, 200);
  assert.match(await unauthenticated.text(), /Review access/);

  const cookie = await loginCookie('https://thefactorysignal.com/review/login', '/testpage/');
  let nextRequest;
  const authenticated = await onRequest({
    env,
    request: new Request('https://thefactorysignal.com/testpage/', {
      headers: { Cookie: cookie },
    }),
    next: (request) => {
      nextRequest = request;
      return new Response('main testpage ok');
    },
  });

  assert.equal(authenticated.status, 200);
  assert.equal(await authenticated.text(), 'main testpage ok');
  assert.equal(nextRequest, undefined);
});

async function loginCookie(url, redirect) {
  const response = await onRequest({
    env,
    request: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: env.FS_REVIEW_USERNAME,
        password: env.FS_REVIEW_PASSWORD,
        redirect,
      }),
    }),
    next: () => new Response('should not reach app'),
  });

  assert.equal(response.status, 303);
  const cookie = response.headers.get('Set-Cookie');
  assert.ok(cookie);
  return cookie;
}
