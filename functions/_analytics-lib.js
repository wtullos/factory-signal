const ANALYTICS_DB_BINDING = 'ANALYTICS_DB';
const MAX_TEXT_LENGTH = 140;
const MAX_PATH_LENGTH = 240;
const MAX_HREF_LENGTH = 360;

export function hasAnalyticsDb(env = {}) {
  return Boolean(env?.[ANALYTICS_DB_BINDING]?.prepare);
}

export async function recordAnalyticsEvent(env = {}, event = {}) {
  const db = env?.[ANALYTICS_DB_BINDING];
  if (!db?.prepare) {
    return { ok: true, stored: false, reason: 'missing_d1_binding' };
  }

  const normalized = normalizeAnalyticsEvent(event);
  if (!normalized) {
    return { ok: false, stored: false, reason: 'invalid_event' };
  }

  await ensureAnalyticsSchema(db);
  await db.prepare(`
    INSERT INTO analytics_events (event_type, page_path, page_title, click_href, click_text, event_date, event_hour, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    normalized.type,
    normalized.path,
    normalized.title,
    normalized.href,
    normalized.text,
    normalized.date,
    normalized.hour,
  ).run();

  return { ok: true, stored: true };
}

export async function getAnalyticsSummary(env = {}) {
  const db = env?.[ANALYTICS_DB_BINDING];
  if (!db?.prepare) {
    return emptySummary(false);
  }

  await ensureAnalyticsSchema(db);

  const [totals, topPages, topClicks, heatmap] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(*) AS totalEvents,
        SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS pageviews,
        SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks
      FROM analytics_events
      WHERE event_date >= date('now', '-6 days')
    `).first(),
    db.prepare(`
      SELECT page_path AS path, COALESCE(NULLIF(page_title, ''), page_path) AS title, COUNT(*) AS views
      FROM analytics_events
      WHERE event_type = 'pageview' AND event_date >= date('now', '-6 days')
      GROUP BY page_path, title
      ORDER BY views DESC, page_path ASC
      LIMIT 12
    `).all(),
    db.prepare(`
      SELECT page_path AS path, COALESCE(NULLIF(click_text, ''), click_href, 'Unlabeled click') AS label, click_href AS href, COUNT(*) AS clicks
      FROM analytics_events
      WHERE event_type = 'click' AND event_date >= date('now', '-6 days')
      GROUP BY page_path, label, href
      ORDER BY clicks DESC, page_path ASC, label ASC
      LIMIT 12
    `).all(),
    db.prepare(`
      SELECT event_date AS date, event_hour AS hour, COUNT(*) AS events
      FROM analytics_events
      WHERE event_date >= date('now', '-6 days')
      GROUP BY event_date, event_hour
      ORDER BY event_date ASC, event_hour ASC
    `).all(),
  ]);

  return {
    configured: true,
    generatedAt: new Date().toISOString(),
    totals: {
      totalEvents: Number(totals?.totalEvents || 0),
      pageviews: Number(totals?.pageviews || 0),
      clicks: Number(totals?.clicks || 0),
    },
    topPages: normalizeResultRows(topPages).map((row) => ({
      path: String(row.path || '/'),
      title: String(row.title || row.path || '/'),
      views: Number(row.views || 0),
    })),
    topClicks: normalizeResultRows(topClicks).map((row) => ({
      path: String(row.path || '/'),
      label: String(row.label || 'Unlabeled click'),
      href: row.href ? String(row.href) : '',
      clicks: Number(row.clicks || 0),
    })),
    heatmap: buildSevenDayHeatmap(normalizeResultRows(heatmap)),
  };
}

export function normalizeAnalyticsEvent(input = {}, now = new Date()) {
  const type = input.type === 'click' ? 'click' : input.type === 'pageview' ? 'pageview' : '';
  const path = normalizePath(input.path);
  if (!type || !path) return null;

  const eventDate = validClientDate(input.timestamp) || now;
  const title = truncateText(input.title, MAX_TEXT_LENGTH);
  const href = type === 'click' ? truncateText(normalizeHref(input.href), MAX_HREF_LENGTH) : '';
  const text = type === 'click' ? truncateText(cleanWhitespace(input.text), MAX_TEXT_LENGTH) : '';

  return {
    type,
    path,
    title,
    href,
    text,
    date: eventDate.toISOString().slice(0, 10),
    hour: eventDate.getUTCHours(),
  };
}

export async function ensureAnalyticsSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK (event_type IN ('pageview', 'click')),
      page_path TEXT NOT NULL,
      page_title TEXT,
      click_href TEXT,
      click_text TEXT,
      event_date TEXT NOT NULL,
      event_hour INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_analytics_events_date_type ON analytics_events (event_date, event_type)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_analytics_events_page ON analytics_events (page_path, event_type)').run();
}

function emptySummary(configured) {
  return {
    configured,
    generatedAt: new Date().toISOString(),
    totals: { totalEvents: 0, pageviews: 0, clicks: 0 },
    topPages: [],
    topClicks: [],
    heatmap: buildSevenDayHeatmap([]),
  };
}

function buildSevenDayHeatmap(rows) {
  const dates = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - offset);
    dates.push(date.toISOString().slice(0, 10));
  }

  const counts = new Map(rows.map((row) => [`${row.date}:${Number(row.hour)}`, Number(row.events || 0)]));
  let max = 0;
  const days = dates.map((date) => {
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const events = counts.get(`${date}:${hour}`) || 0;
      if (events > max) max = events;
      return { hour, events, level: 0 };
    });
    return { date, hours };
  });

  days.forEach((day) => {
    day.hours.forEach((cell) => {
      cell.level = cell.events > 0 && max > 0 ? Math.max(1, Math.ceil((cell.events / max) * 4)) : 0;
    });
  });

  return { timezone: 'UTC', max, days };
}

function normalizeResultRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function normalizePath(value) {
  let path = String(value || '').trim();
  if (!path) return '';
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return '';
  }
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/+/g, '/');
  return truncateText(path, MAX_PATH_LENGTH) || '/';
}

function normalizeHref(value) {
  const href = String(value || '').trim();
  if (!href) return '';
  try {
    const parsed = new URL(href, 'https://thefactorysignal.com');
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return '';
    return parsed.origin === 'https://thefactorysignal.com' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
  } catch {
    return '';
  }
}

function validClientDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const skewMs = Math.abs(Date.now() - date.getTime());
  return skewMs <= 24 * 60 * 60 * 1000 ? date : null;
}

function cleanWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength) {
  const text = cleanWhitespace(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
