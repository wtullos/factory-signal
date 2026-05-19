import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const site = process.env.SITE_URL || 'https://thefactorysignal.com';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith('/review/'),
    }),
  ],
});
