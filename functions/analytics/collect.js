import { recordAnalyticsEvent } from '../_analytics-lib.js';

export async function onRequestPost(context) {
  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ ok: false, stored: false, message: 'Invalid JSON payload.' }, 400);
  }

  try {
    const result = await recordAnalyticsEvent(context.env, payload);
    if (!result.ok) return json(result, 400);
    return json(result, 202);
  } catch (error) {
    console.error('Analytics collection failed', error);
    return json({ ok: true, stored: false, reason: 'collection_error' }, 202);
  }
}

export function onRequestGet() {
  return json({ ok: true, message: 'Factory Signal analytics collection endpoint.' });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
