const REVIEW_USERNAME = 'FS_REVIEW_USERNAME';
const REVIEW_PASSWORD = 'FS_REVIEW_PASSWORD';
const REVIEW_SESSION_SECRET = 'FS_REVIEW_SESSION_SECRET';
const ROBOT_HOST = 'robot.thefactorysignal.com';
const SESSION_COOKIE_NAME = '__Host-fs_review_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_PATH = '/login';
const LOGOUT_PATH = '/logout';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const isRobotHost = url.hostname.toLowerCase() === ROBOT_HOST;
  const isMainDomainReviewPath = isReviewPath(url.pathname);
  const isMainDomainTestPage = isTestPagePath(url.pathname);

  if (!isRobotHost && !isMainDomainReviewPath && !isMainDomainTestPage) {
    return context.next();
  }

  const username = context.env?.[REVIEW_USERNAME];
  const password = context.env?.[REVIEW_PASSWORD];
  const sessionSecret = context.env?.[REVIEW_SESSION_SECRET];

  if (!username || !password || !sessionSecret) {
    return new Response('Review credentials are not configured.', {
      status: 503,
      headers: securityHeaders({ 'Content-Type': 'text/plain; charset=UTF-8' }),
    });
  }

  if (isLogoutRequest(url, isRobotHost)) {
    return logoutResponse(url, isRobotHost);
  }

  if (isLoginRequest(url, isRobotHost)) {
    if (context.request.method === 'POST') {
      return handleLogin(context.request, username, password, sessionSecret, isRobotHost);
    }

    if (context.request.method === 'GET' || context.request.method === 'HEAD') {
      return loginPageResponse(url, isRobotHost, '', context.request.method === 'HEAD');
    }

    return new Response('Method not allowed.', {
      status: 405,
      headers: securityHeaders({ Allow: 'GET, HEAD, POST', 'Content-Type': 'text/plain; charset=UTF-8' }),
    });
  }

  const session = await readSession(context.request, sessionSecret);
  if (!session || !safeEqual(session.username, username)) {
    if (context.request.method === 'GET' || context.request.method === 'HEAD') {
      return loginPageResponse(url, isRobotHost, '', context.request.method === 'HEAD');
    }

    return redirectToLogin(url, isRobotHost);
  }

  const response = await nextReviewResponse(context, url, isRobotHost);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

async function handleLogin(request, expectedUsername, expectedPassword, sessionSecret, isRobotHost) {
  let formData;

  try {
    formData = await request.formData();
  } catch {
    return loginPageResponse(new URL(request.url), isRobotHost, 'Please submit the login form.');
  }

  const username = String(formData.get('username') || '');
  const password = String(formData.get('password') || '');
  const redirectPath = sanitizeRedirectPath(formData.get('redirect'));
  const requestUrl = new URL(request.url);

  if (!safeEqual(username, expectedUsername) || !safeEqual(password, expectedPassword)) {
    const retryUrl = new URL(requestUrl);
    retryUrl.searchParams.set('redirect', redirectPath);
    return loginPageResponse(retryUrl, isRobotHost, 'Invalid username or password.');
  }

  const cookie = await createSessionCookie(expectedUsername, sessionSecret);
  const redirectUrl = new URL(redirectPath, requestUrl.origin);

  return new Response(null, {
    status: 303,
    headers: securityHeaders({
      Location: redirectUrl.pathname + redirectUrl.search,
      'Set-Cookie': cookie,
    }),
  });
}

async function nextReviewResponse(context, url, isRobotHost) {
  if (!isRobotHost || shouldPassThroughRobotPath(url.pathname)) {
    return context.next();
  }

  const reviewUrl = new URL(context.request.url);
  reviewUrl.pathname = robotReviewPath(url.pathname);
  reviewUrl.search = '';
  return context.next(new Request(reviewUrl.toString(), context.request));
}

function robotReviewPath(pathname) {
  if (pathname === '/analytics' || pathname === '/analytics/') return '/review/analytics/';
  if (pathname === '/analytics/data' || pathname === '/analytics/data/') return '/review/analytics/data';
  if (pathname === '/sources' || pathname === '/sources/') return '/review/sources/';
  if (pathname === '/takeaways' || pathname === '/takeaways/') return '/review/takeaways/';
  return '/review/';
}

function isReviewPath(pathname) {
  return pathname === '/review' || pathname === '/review/' || pathname.startsWith('/review/');
}

function isTestPagePath(pathname) {
  return pathname === '/testpage' || pathname === '/testpage/';
}

function shouldPassThroughRobotPath(pathname) {
  return pathname === '/review'
    || pathname === '/review/'
    || pathname.startsWith('/review/')
    || isTestPagePath(pathname)
    || isStaticAssetPath(pathname);
}

function isStaticAssetPath(pathname) {
  return pathname.startsWith('/_astro/')
    || pathname.startsWith('/assets/')
    || pathname.startsWith('/generated-images/')
    || pathname === '/favicon.ico'
    || pathname === '/robots.txt'
    || pathname === '/ads.txt'
    || pathname === '/rss.xml'
    || pathname === '/sitemap-index.xml'
    || pathname === '/sitemap-0.xml'
    || /\.[a-z0-9]{2,8}$/i.test(pathname);
}

function isLoginRequest(url, isRobotHost) {
  return isRobotHost ? url.pathname === LOGIN_PATH : url.pathname === `/review${LOGIN_PATH}`;
}

function isLogoutRequest(url, isRobotHost) {
  return isRobotHost ? url.pathname === LOGOUT_PATH : url.pathname === `/review${LOGOUT_PATH}`;
}

function loginPath(isRobotHost) {
  return isRobotHost ? LOGIN_PATH : `/review${LOGIN_PATH}`;
}

function logoutPath(isRobotHost) {
  return isRobotHost ? LOGOUT_PATH : `/review${LOGOUT_PATH}`;
}

function loginPageResponse(url, isRobotHost, errorMessage = '', headOnly = false) {
  const redirectPath = sanitizeRedirectPath(url.searchParams.get('redirect') || `${url.pathname}${url.search}`);
  const body = headOnly ? null : renderLoginPage({
    action: loginPath(isRobotHost),
    logout: logoutPath(isRobotHost),
    redirectPath,
    errorMessage,
  });

  return new Response(body, {
    status: 200,
    headers: securityHeaders({ 'Content-Type': 'text/html; charset=UTF-8' }),
  });
}

function redirectToLogin(url, isRobotHost) {
  const loginUrl = new URL(loginPath(isRobotHost), url.origin);
  loginUrl.searchParams.set('redirect', sanitizeRedirectPath(`${url.pathname}${url.search}`));

  return new Response(null, {
    status: 303,
    headers: securityHeaders({ Location: loginUrl.pathname + loginUrl.search }),
  });
}

function logoutResponse(url, isRobotHost) {
  const loginUrl = new URL(loginPath(isRobotHost), url.origin);
  loginUrl.searchParams.set('redirect', isRobotHost ? '/' : '/review/');

  return new Response(null, {
    status: 303,
    headers: securityHeaders({
      Location: loginUrl.pathname + loginUrl.search,
      'Set-Cookie': `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    }),
  });
}

async function readSession(request, sessionSecret) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  if (!sessionCookie) return null;

  const [payload, signature] = sessionCookie.split('.');
  if (!payload || !signature) return null;

  const expectedSignature = await sign(payload, sessionSecret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (!session?.username || !session?.expiresAt || Date.now() > session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}

async function createSessionCookie(username, sessionSecret) {
  const payload = base64UrlEncode(JSON.stringify({
    username,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  }));
  const signature = await sign(payload, sessionSecret);
  return `${SESSION_COOKIE_NAME}=${payload}.${signature}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};

  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex === -1) return cookies;

    const name = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();
    if (name) cookies[name] = value;
    return cookies;
  }, {});
}

function sanitizeRedirectPath(value) {
  const path = String(value || '/');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return '/';
  if (path === LOGIN_PATH || path === `/review${LOGIN_PATH}` || path === LOGOUT_PATH || path === `/review${LOGOUT_PATH}`) return '/';
  return path;
}

function renderLoginPage({ action, logout, redirectPath, errorMessage }) {
  const safeAction = escapeHtml(action);
  const safeLogout = escapeHtml(logout);
  const safeRedirect = escapeHtml(redirectPath);
  const safeError = escapeHtml(errorMessage);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Factory Signal Review Login</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Orbitron:wght@700;800;900&display=swap');
    :root {
      color-scheme: light;
      --bg: #f7f9f6;
      --paper: #ffffff;
      --paper-strong: #f0f5ef;
      --ink: #262a2e;
      --ink-strong: #171a1d;
      --muted: #687176;
      --line: #d6ddd2;
      --accent: #39a935;
      --accent-bright: #49c743;
      --accent-dark: #237322;
      --accent-soft: #e8f6e6;
      --shadow: 0 18px 45px rgba(38, 42, 46, .08);
      --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --display: Orbitron, Inter, ui-sans-serif, system-ui, sans-serif;
      font-family: var(--sans);
    }
    * { box-sizing: border-box; }
    html {
      min-height: 100%;
      background:
        linear-gradient(90deg, rgba(57,169,53,.045) 1px, transparent 1px),
        linear-gradient(rgba(57,169,53,.035) 1px, transparent 1px),
        var(--bg);
      background-size: 42px 42px;
      color: var(--ink);
    }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; color: var(--ink); }
    main { width: min(100%, 430px); padding: clamp(1.35rem, 5vw, 2rem); border: 1px solid var(--line); border-top: 4px solid var(--accent); background: rgba(255,255,255,.9); box-shadow: var(--shadow); }
    .brand-lockup { display: grid; gap: 0.35rem; margin-bottom: 1.35rem; padding-bottom: 1rem; border-bottom: 1px solid var(--line); }
    .brand { font: 900 clamp(1rem, 4vw, 1.25rem)/.9 var(--display); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-strong); }
    .eyebrow { color: var(--accent-dark); font-size: .74rem; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0 0 0.55rem; color: var(--ink-strong); font-size: clamp(1.75rem, 5vw, 2.25rem); line-height: 1.05; letter-spacing: -0.045em; }
    p { margin: 0 0 1.5rem; color: var(--muted); line-height: 1.55; }
    label { display: block; margin: 1rem 0 0.4rem; color: var(--ink-strong); font-size: 0.9rem; font-weight: 800; }
    input { width: 100%; padding: 0.85rem 0.95rem; border: 1px solid var(--line); border-radius: 0; background: var(--paper); color: var(--ink-strong); font: inherit; }
    input:focus { border-color: var(--accent); outline: 3px solid rgba(57, 169, 53, 0.18); }
    button { width: 100%; margin-top: 1.4rem; padding: 0.9rem 1rem; border: 1px solid var(--accent-dark); border-radius: 0; background: var(--accent); color: #fff; font: inherit; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; cursor: pointer; box-shadow: inset 0 -2px 0 rgba(0,0,0,.12); }
    button:hover { background: var(--accent-bright); color: var(--ink-strong); }
    button:focus-visible { outline: 3px solid rgba(57, 169, 53, 0.25); outline-offset: 3px; }
    .error { margin: 0 0 1rem; padding: 0.8rem 0.9rem; border: 1px solid rgba(185, 28, 28, 0.24); background: #fff1f2; color: #9f1239; }
    .helper { margin-top: 1rem; margin-bottom: 0; font-size: 0.85rem; color: var(--muted); }
    a { color: var(--accent-dark); text-decoration-color: rgba(57,169,53,.55); text-underline-offset: .2em; }
    a:hover { color: var(--ink-strong); }
  </style>
</head>
<body>
  <main>
    <div class="brand-lockup" aria-label="Factory Signal">
      <span class="brand">Factory Signal</span>
      <span class="eyebrow">Private review access</span>
    </div>
    <h1>Review access</h1>
    <p>Sign in to view the private Factory Signal review site.</p>
    ${safeError ? `<div class="error" role="alert">${safeError}</div>` : ''}
    <form method="post" action="${safeAction}" autocomplete="on">
      <input type="hidden" name="redirect" value="${safeRedirect}">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
    <p class="helper">Finished reviewing? <a href="${safeLogout}">Clear this session</a>.</p>
  </main>
</body>
</html>`;
}

function securityHeaders(headers = {}) {
  return {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'same-origin',
    ...headers,
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function safeEqual(actual, expected) {
  const actualBytes = new TextEncoder().encode(String(actual));
  const expectedBytes = new TextEncoder().encode(String(expected));
  const maxLength = Math.max(actualBytes.length, expectedBytes.length);
  let mismatch = actualBytes.length === expectedBytes.length ? 0 : 1;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (actualBytes[index] || 0) ^ (expectedBytes[index] || 0);
  }

  return mismatch === 0;
}
