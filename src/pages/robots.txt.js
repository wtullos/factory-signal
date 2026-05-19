import { SITE_URL } from '../lib/content.js';

export function GET() {
  return new Response(`User-agent: *\nDisallow: /review/\nAllow: /\nSitemap: ${SITE_URL}/sitemap-index.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
