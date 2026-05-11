import { ADSENSE_ENABLED, ADSENSE_PUBLISHER_ID } from '../lib/content.js';

export function GET() {
  if (!ADSENSE_ENABLED) return new Response('Not configured\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(`google.com, ${ADSENSE_PUBLISHER_ID.replace('ca-pub-', '')}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
