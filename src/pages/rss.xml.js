import rss from '@astrojs/rss';
import { getBriefings, getArticles, SITE_NAME, TAGLINE, SITE_URL, formatDate, parseFeedDate } from '../lib/content.js';

export function GET(context) {
  const briefingItems = getBriefings().map((briefing) => ({
    title: briefing.title.replace(/^Tech Briefing/, 'Factory Signal Briefing'),
    description: `${formatDate(briefing.date)} briefing: ${briefing.deck}`,
    pubDate: parseFeedDate(briefing.date),
    link: `/briefings/${briefing.slug}/`,
  }));
  const articleItems = getArticles().map((article) => ({
    title: article.title,
    description: article.description,
    pubDate: parseFeedDate(article.pubDate),
    link: `/articles/${article.slug}/`,
  }));

  return rss({
    title: SITE_NAME,
    description: TAGLINE,
    site: context.site || SITE_URL,
    items: [...briefingItems, ...articleItems].sort((a, b) => b.pubDate - a.pubDate),
  });
}
