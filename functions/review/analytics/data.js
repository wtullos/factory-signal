import { getAnalyticsSummary } from '../../_analytics-lib.js';

export async function onRequestGet(context) {
  try {
    const summary = await getAnalyticsSummary(context.env);
    return json({ ok: true, ...summary });
  } catch (error) {
    console.error('Analytics summary failed', error);
    return json({
      ok: false,
      configured: Boolean(context.env?.ANALYTICS_DB),
      message: 'Analytics summary is temporarily unavailable.',
      totals: { totalEvents: 0, pageviews: 0, clicks: 0 },
      topPages: [],
      topClicks: [],
      heatmap: { timezone: 'UTC', max: 0, days: [] },
    }, 200);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
