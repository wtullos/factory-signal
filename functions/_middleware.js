const REVIEW_REALM = 'Factory Signal Review';
const REVIEW_USERNAME = 'FS_REVIEW_USERNAME';
const REVIEW_PASSWORD = 'FS_REVIEW_PASSWORD';
const ROBOT_HOST = 'robot.thefactorysignal.com';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const isRobotHost = url.hostname.toLowerCase() === ROBOT_HOST;
  const isMainDomainReviewPath = isReviewPath(url.pathname);

  if (!isRobotHost && !isMainDomainReviewPath) {
    return context.next();
  }

  const username = context.env?.[REVIEW_USERNAME];
  const password = context.env?.[REVIEW_PASSWORD];

  if (!username || !password) {
    return new Response('Review credentials are not configured.', {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  const credentials = parseBasicAuth(context.request.headers.get('Authorization'));

  if (!credentials || !safeEqual(credentials.username, username) || !safeEqual(credentials.password, password)) {
    return unauthorizedResponse();
  }

  const response = await nextReviewResponse(context, url, isRobotHost);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

async function nextReviewResponse(context, url, isRobotHost) {
  if (!isRobotHost || shouldPassThroughRobotPath(url.pathname)) {
    return context.next();
  }

  const reviewUrl = new URL(context.request.url);
  reviewUrl.pathname = '/review/';
  reviewUrl.search = '';
  return context.next(new Request(reviewUrl.toString(), context.request));
}

function isReviewPath(pathname) {
  return pathname === '/review' || pathname === '/review/' || pathname.startsWith('/review/');
}

function shouldPassThroughRobotPath(pathname) {
  return pathname === '/review' || pathname === '/review/' || pathname.startsWith('/review/') || isStaticAssetPath(pathname);
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

function unauthorizedResponse() {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REVIEW_REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function parseBasicAuth(header) {
  if (!header || !header.startsWith('Basic ')) return null;

  try {
    const decoded = atob(header.slice('Basic '.length).trim());
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
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
