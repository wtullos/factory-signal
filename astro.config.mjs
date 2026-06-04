import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const site = process.env.SITE_URL || 'https://thefactorysignal.com';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  redirects: {
    '/': '/dashboard/',
  },
  integrations: [
    sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname;
        return !pathname.startsWith('/review/') && pathname !== '/testpage/';
      },
    }),
  ],
});
