const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8888;
const BRIEFINGS_DIR = '/home/wtullos/.openclaw/workspace/memory/briefings';
const ADSENSE_PUBLISHER_ID = process.env.ADSENSE_PUBLISHER_ID || ''; // e.g. 'ca-pub-1234567890123456'
const ADSENSE_ENABLED = ADSENSE_PUBLISHER_ID.startsWith('ca-pub-');
const SITE_URL = process.env.SITE_URL || 'http://localhost:8888';
const SITE_NAME = 'The Daily Briefing';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'hello@example.com';
const LAST_UPDATED = '2026-04-21';
const HERO_ROTATION_HOURS = 5;
const HERO_ROTATION_POOL_SIZE = 6;

const STYLES = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Libre+Franklin:wght@400;500;700&family=Playfair+Display:wght@700;800&display=swap');

  :root {
    --text: #121212;
    --muted: #666;
    --rule: #e2e2e2;
    --paper: #fff;
    --headline: 'Playfair Display', Georgia, 'Times New Roman', serif;
    --body: 'Libre Baskerville', Georgia, 'Times New Roman', serif;
    --sans: 'Libre Franklin', Arial, Helvetica, sans-serif;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--paper); color: var(--text); }
  body { font-family: var(--body); }
  a { color: inherit; text-decoration: none; }
  a:hover { text-decoration: underline; }

  .shell { max-width: 1320px; margin: 0 auto; }

  .kiosk-topbar,
  .kiosk-ticker,
  .kiosk-front-lead,
  .kiosk-front-label,
  .kiosk-front-hero,
  .kiosk-front-secondary-list,
  .kiosk-meta,
  .kiosk-divider,
  .kiosk-section-label,
  .kiosk-thumb,
  .kiosk-thumb-placeholder {
    display: none;
  }
  .kiosk-copy {
    min-width: 0;
  }

  .masthead { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
  .masthead-top {
    padding: 10px 20px 8px;
    border-bottom: 1px solid var(--rule);
    text-align: center;
    font: 500 11px/1.3 var(--sans);
    color: var(--muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .masthead-main {
    padding: 18px 20px 14px;
    text-align: center;
    border-bottom: 3px double var(--text);
  }
  .masthead-logo {
    margin: 0;
    font: 800 70px/0.96 var(--headline);
    letter-spacing: -0.03em;
  }
  .masthead-tagline {
    margin: 6px 0 0;
    font: 400 12px/1.4 var(--body);
    color: var(--muted);
    font-style: italic;
  }
  .nav-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 20px;
    border-bottom: 1px solid var(--rule);
    overflow-x: auto;
  }
  .section-nav,
  .date-nav { display: flex; align-items: center; gap: 0; white-space: nowrap; }
  .section-nav a,
  .date-link {
    display: inline-block;
    padding: 12px 14px;
    font: 500 11px/1 var(--sans);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text);
  }

  .image-wrap {
    position: relative;
    margin-bottom: 10px;
    background: #f3f3f3;
    overflow: hidden;
  }
  .section-nav a + a::before {
    content: '|';
    color: #b4b4b4;
    margin-right: 14px;
  }
  .section-nav a + a { padding-left: 0; }
  .date-link {
    border-left: 1px solid var(--rule);
    color: var(--muted);
  }
  .date-link.active { color: var(--text); font-weight: 700; }

  .content { padding: 26px 20px 56px; }

  .front-lead {
    padding-bottom: 22px;
    margin-bottom: 34px;
    border-bottom: 1px solid var(--rule);
  }
  .kicker {
    margin: 0 0 12px;
    font: 700 11px/1 var(--sans);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .lead-grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    gap: 24px;
    align-items: start;
  }
  .side-stack { display: grid; gap: 0; }

  .story {
    padding: 0 0 18px;
    border-bottom: 1px solid var(--rule);
  }
  .story + .story { margin-top: 18px; }
  .story.with-rule { border-left: 1px solid var(--rule); padding-left: 24px; }
  .story.hero {
    padding-right: 6px;
    border-bottom: none;
  }
  .story.section-hero {
    border-bottom: none;
    padding-bottom: 0;
  }
  .story.grid,
  .story.video-card.grid,
  .story.reddit-card.grid {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 100%;
    padding: 0 0 18px;
    border-bottom: 1px solid var(--rule);
  }

  .headline {
    margin: 0 0 8px;
    font-family: var(--headline);
    font-weight: 700;
    line-height: 1.15;
  }
  .headline a { text-decoration: none; }
  .headline.hero-title { font-size: 42px; }
  .headline.secondary-title { font-size: 24px; }
  .headline.grid-title { font-size: 18px; }
  .headline.section-hero-title { font-size: 34px; }
  .page-title { font-size: 42px; margin: 0 0 16px; }

  .meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
    font: 500 11px/1.45 var(--sans);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .meta .source { color: var(--text); font-weight: 700; }
  .meta .rating-pill {
    margin-left: auto;
    border: 1px solid var(--rule);
    border-radius: 999px;
    padding: 3px 8px 2px;
    color: var(--text);
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: none;
    background: #fafafa;
  }
  .stats {
    margin: -2px 0 10px;
    font: 400 11px/1.45 var(--sans);
    color: var(--muted);
  }
  .summary {
    margin: 0;
    font: 400 15px/1.62 var(--body);
    color: #222;
  }
  .summary.clamp-3 {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
  }
  .quote {
    margin: 12px 0 0;
    padding-left: 14px;
    border-left: 3px solid var(--text);
    font: italic 400 14px/1.64 var(--body);
    color: #333;
  }

  .section-band {
    margin-bottom: 42px;
    padding-top: 4px;
  }
  .section-header {
    margin-bottom: 20px;
    padding-bottom: 8px;
    border-bottom: 3px solid var(--text);
  }
  .section-title {
    margin: 0;
    font: 700 12px/1 var(--headline);
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .section-layout {
    display: grid;
    gap: 28px;
  }
  .section-layout.with-hero {
    grid-template-columns: 1fr;
  }
  .section-top {
    display: grid;
    grid-template-columns: minmax(0, 1.9fr) minmax(280px, 1fr);
    gap: 28px;
    align-items: stretch;
    padding-bottom: 28px;
    margin-bottom: 6px;
    border-bottom: 1px solid var(--rule);
  }
  .section-secondary-list {
    display: grid;
    gap: 18px;
    align-content: start;
  }
  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 22px;
    grid-auto-rows: 1fr;
    align-items: stretch;
  }
  .section-layout.compact-layout .cards-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 18px;
  }
  .section-layout.reddit-layout .cards-grid,
  .section-layout.youtube-layout .cards-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .ad-wrapper {
    margin: 24px auto;
    max-width: 100%;
    text-align: center;
  }
  .ad-label {
    margin: 0 0 8px;
    font: 500 10px/1 var(--sans);
    color: #8a8a8a;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .ad-slot {
    margin: 0 auto;
    width: 100%;
  }
  .ad-leaderboard { min-height: 90px; }
  .ad-mid,
  .ad-between { min-height: 250px; }

  .page-copy {
    max-width: 760px;
    margin: 0 auto;
    padding-bottom: 16px;
  }
  .page-copy p,
  .page-copy li {
    font: 400 16px/1.8 var(--body);
    color: #222;
  }
  .page-copy p { margin: 0 0 18px; }
  .page-copy ul { margin: 0 0 18px 24px; }

  .briefing-list {
    display: grid;
    gap: 46px;
  }
  .briefing-day {
    padding-bottom: 42px;
    border-bottom: 3px double var(--rule);
  }
  .briefing-day:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .briefing-day-header {
    margin-bottom: 24px;
    padding-bottom: 10px;
    border-bottom: 3px solid var(--text);
  }
  .briefing-day-title {
    margin: 0;
    font: 700 12px/1 var(--sans);
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .briefing-day-title a { text-decoration: none; }

  .footer {
    border-top: 3px double var(--rule);
    margin: 0 20px 24px;
    padding-top: 18px;
    text-align: center;
    font: 400 11px/1.5 var(--sans);
    color: var(--muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .footer-line + .footer-line { margin-top: 8px; }
  .footer-links a { margin: 0 6px; }
  .footer-copy { letter-spacing: 0.1em; }

  .cookie-banner {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 16px;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border: 1px solid rgba(18, 18, 18, 0.12);
    background: rgba(250, 247, 240, 0.97);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    font: 400 14px/1.5 var(--body);
  }
  .cookie-banner p { margin: 0; }
  .cookie-banner a { text-decoration: underline; }
  .cookie-banner button {
    border: 1px solid var(--text);
    background: var(--text);
    color: #fff;
    padding: 9px 16px;
    cursor: pointer;
    font: 600 11px/1 var(--sans);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .empty {
    padding: 80px 20px;
    text-align: center;
    font: italic 400 18px/1.6 var(--body);
    color: var(--muted);
  }

  .hero-image {
    width: 100%;
    aspect-ratio: 16/9;
    object-fit: cover;
    display: block;
  }
  .card-image {
    width: 100%;
    aspect-ratio: 16/10;
    object-fit: cover;
    display: block;
  }
  .story.grid .image-wrap {
    margin-bottom: 12px;
    aspect-ratio: 16/10;
  }
  .story.grid .image-placeholder {
    background: linear-gradient(180deg, #f3f0ea, #ebe6dc);
    border: 1px solid #ece7de;
  }
  .story.grid .headline,
  .story.grid .meta,
  .story.grid .stats,
  .story.grid .summary,
  .story.grid .quote {
    width: 100%;
  }
  .story.grid .headline {
    min-height: 3.45em;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
  }
  .story.grid .summary {
    flex: 1;
  }
  .story.grid .meta {
    padding-top: 10px;
  }
  .story.grid .stats {
    min-height: 1.4em;
  }
  .story.video-card {
    position: relative;
  }
  .story.video-card.grid {
    min-height: 320px;
  }
  .story.video-card .image-wrap {
    max-width: 100%;
  }
  .story.video-card .card-image,
  .story.video-card .hero-image {
    aspect-ratio: 16/9;
  }
  .story.video-card .headline {
    font-size: 16px;
  }
  .story.reddit-card {
    position: relative;
    padding-left: 18px;
  }
  .story.reddit-card.grid {
    min-height: 340px;
    height: 100%;
    align-self: stretch;
    box-shadow: inset 5px 0 0 rgba(255, 102, 34, 0.92);
  }
  .story.reddit-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 5px;
    background: linear-gradient(180deg, rgba(255, 87, 0, 0.92), rgba(255, 135, 64, 0.72));
    border-radius: 3px;
  }
  .story.reddit-card.grid::before {
    display: none;
  }
  .story.reddit-card .image-wrap {
    max-width: 100%;
  }
  .story.reddit-card .card-image,
  .story.reddit-card .hero-image {
    aspect-ratio: 16/10;
  }
  .story.reddit-card .headline {
    font-size: 17px;
  }
  .play-overlay::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-42%, -50%);
    width: 0;
    height: 0;
    border-top: 26px solid transparent;
    border-bottom: 26px solid transparent;
    border-left: 42px solid rgba(210, 24, 24, 0.78);
    filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.28));
    pointer-events: none;
    z-index: 2;
  }
  .play-overlay::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 88px;
    height: 62px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(1px);
    pointer-events: none;
  }
  .video-badge,
  .reddit-badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 9px 3px;
    border-radius: 999px;
    font: 700 10px/1 var(--sans);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .video-badge {
    color: #a11414;
    background: rgba(210, 24, 24, 0.08);
    border: 1px solid rgba(210, 24, 24, 0.18);
  }
  .reddit-watermark::before {
    content: attr(data-subreddit);
    position: absolute;
    left: 12px;
    bottom: 12px;
    padding: 6px 10px 5px;
    border-radius: 999px;
    background: rgba(255, 87, 0, 0.88);
    color: rgba(255, 255, 255, 0.98);
    font: 700 11px/1 var(--sans);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
    pointer-events: none;
  }
  .reddit-badge {
    color: #b34700;
    background: rgba(255, 87, 0, 0.09);
    border: 1px solid rgba(255, 87, 0, 0.2);
  }

  @media (max-width: 1024px) {
    .masthead-logo { font-size: 56px; }
    .headline.hero-title { font-size: 36px; }
    .headline.section-hero-title { font-size: 30px; }
    .cards-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .section-layout.compact-layout .cards-grid,
    .section-layout.reddit-layout .cards-grid,
    .section-layout.youtube-layout .cards-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 768px) {
    .masthead-logo { font-size: 42px; }
    .nav-strip { flex-direction: column; align-items: flex-start; }
    .section-nav, .date-nav { flex-wrap: wrap; }
    .lead-grid,
    .section-top,
    .cards-grid { grid-template-columns: 1fr; }
    .story.with-rule,
    .cards-grid > *:not(:first-child),
    .cards-grid > *:nth-child(even) {
      border-left: none;
      padding-left: 0;
    }
    .headline.hero-title { font-size: 34px; }
    .headline.section-hero-title { font-size: 30px; }
    .headline.secondary-title { font-size: 22px; }
    .headline.grid-title { font-size: 20px; }
    .page-title { font-size: 34px; }
    .cookie-banner {
      left: 10px;
      right: 10px;
      bottom: 10px;
      flex-direction: column;
      align-items: flex-start;
    }
  }

  @media (max-width: 700px) {
    body { background: #f7f5ef; }
    .shell { max-width: none; }
    .masthead {
      position: sticky;
      top: 0;
      z-index: 30;
      border: none;
      background: #111;
      color: #f4efe2;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
    }
    .masthead-top,
    .masthead-main,
    .nav-strip { display: none; }
    .kiosk-topbar {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 10px;
      padding: 10px 14px 9px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.16);
      font: 600 10px/1 var(--sans);
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .kiosk-topbar .kiosk-wordmark {
      text-align: center;
      color: #fff;
      font-weight: 700;
    }
    .kiosk-topbar .kiosk-updated {
      text-align: right;
      color: #d7d1c2;
    }
    .kiosk-ticker {
      display: block;
      overflow: hidden;
      white-space: nowrap;
      background: #1a1a1a;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      font: 500 10px/1 var(--sans);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #d8d2c5;
    }
    .ticker-track {
      display: inline-block;
      padding: 8px 0;
      white-space: nowrap;
      min-width: 200%;
      animation: kiosk-marquee 34s linear infinite;
    }
    .ticker-item { display: inline-block; margin-right: 28px; }
    .content { padding: 14px 0 32px; }
    .front-lead,
    .ad-wrapper,
    .kicker,
    .lead-grid,
    .section-top { display: none; }
    .kiosk-front-lead {
      display: block;
      padding: 0 0 4px;
      background: #f7f5ef;
    }
    .kiosk-front-label {
      display: block;
      margin: 0;
      padding: 10px 14px 9px;
      background: #171717;
      color: #f5f1e6;
      font: 800 17px/1 var(--sans);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      border-top: 2px solid #0b0b0b;
      border-bottom: 2px solid #0b0b0b;
    }
    .kiosk-front-hero {
      display: block;
      padding: 14px;
      background: #fbfaf6;
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    }
    .kiosk-front-hero .story,
    .kiosk-front-hero .story.hero {
      display: block;
      padding: 0;
      background: transparent;
    }
    .kiosk-front-hero .image-wrap {
      display: block !important;
      margin: 0 0 12px;
      aspect-ratio: 16 / 9;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 2px;
      background: linear-gradient(180deg, #ece7dd, #ddd6c8);
    }
    .kiosk-front-hero .hero-image,
    .kiosk-front-hero .card-image {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .kiosk-front-hero .kiosk-thumb,
    .kiosk-front-hero .kiosk-thumb-placeholder,
    .kiosk-front-hero .kiosk-divider,
    .kiosk-front-hero .summary,
    .kiosk-front-hero .quote,
    .kiosk-front-hero .stats,
    .kiosk-front-hero .rating-pill,
    .kiosk-front-hero .meta .source,
    .kiosk-front-hero .meta span:not(.kiosk-meta) {
      display: none !important;
    }
    .kiosk-front-hero .kiosk-copy {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }
    .kiosk-front-hero .kiosk-thumb,
    .kiosk-front-hero .kiosk-thumb-placeholder {
      display: none !important;
    }
    .kiosk-front-hero .headline,
    .kiosk-front-hero .headline.hero-title,
    .kiosk-front-hero .headline.section-hero-title,
    .kiosk-front-hero .headline.secondary-title,
    .kiosk-front-hero .headline.grid-title {
      font: 800 clamp(28px, 7vw, 35px)/1.02 var(--headline);
      letter-spacing: -0.025em;
      -webkit-line-clamp: 4;
    }
    .kiosk-front-hero .meta {
      display: block;
      margin: 0;
      color: #5a564c;
      font: 700 10px/1.3 var(--sans);
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .kiosk-front-secondary-list {
      display: block;
    }
    .section-band { margin: 0; padding: 0; }
    .section-header { margin: 0; padding: 0; border: none; }
    .section-title { display: none; }
    .kiosk-section-label {
      display: block;
      margin: 0;
      padding: 10px 14px 9px;
      background: #171717;
      color: #f5f1e6;
      font: 800 17px/1 var(--sans);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      border-top: 2px solid #0b0b0b;
      border-bottom: 2px solid #0b0b0b;
    }
    .section-layout,
    .section-layout.with-hero,
    .section-layout.grid-only,
    .cards-grid,
    .section-layout.compact-layout .cards-grid,
    .section-layout.reddit-layout .cards-grid,
    .section-layout.youtube-layout .cards-grid {
      display: block;
      grid-template-columns: 1fr;
      gap: 0;
    }
    .story,
    .story.grid,
    .story.video-card.grid,
    .story.reddit-card.grid,
    .story.reddit-card {
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: 12px;
      min-height: 0;
      height: auto;
      margin: 0;
      padding: 14px 14px 12px;
      border: none;
      box-shadow: none;
      background: #fbfaf6;
    }
    .cards-grid > *:not(:first-child),
    .cards-grid > *:nth-child(even) { padding-left: 14px; }
    .story:nth-child(even) { background: #f1ede4; }
    .story.reddit-card::before,
    .play-overlay::before,
    .play-overlay::after,
    .reddit-watermark::before,
    .video-badge,
    .reddit-badge,
    .image-wrap,
    .stats,
    .summary,
    .quote,
    .rating-pill,
    .meta .source,
    .meta span:not(.kiosk-meta) { display: none !important; }
    .kiosk-thumb,
    .kiosk-thumb-placeholder {
      display: block;
      width: 86px;
      height: 86px;
      flex: 0 0 86px;
      border-radius: 2px;
      object-fit: cover;
      background: linear-gradient(180deg, #ece7dd, #ddd6c8);
      border: 1px solid rgba(0, 0, 0, 0.08);
    }
    .kiosk-copy {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .headline,
    .headline.hero-title,
    .headline.section-hero-title,
    .headline.secondary-title,
    .headline.grid-title {
      min-height: 0;
      margin: 0;
      font: 800 25px/1.06 var(--headline);
      letter-spacing: -0.02em;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      align-self: stretch;
    }
    .headline a { text-decoration: none; }
    .kiosk-divider {
      display: block;
      height: 1px;
      margin: 0;
      background: linear-gradient(90deg, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.12));
    }
    .meta {
      display: block;
      margin: 0;
      padding: 0;
      color: #5a564c;
      font: 700 10px/1.3 var(--sans);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      min-width: 0;
    }
    .kiosk-meta { display: inline; }
    .kiosk-meta.km-type.video { color: #b51f1f; }
    .kiosk-meta.km-source.reddit,
    .kiosk-meta.km-type.reddit { color: #c65a16; }
    .footer {
      margin: 0;
      padding: 16px 14px 24px;
      border-top: 1px solid #d5cec0;
      background: #f7f5ef;
    }
    @keyframes kiosk-marquee {
      0% { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }
  }
</style>
`;

function canonicalUrl(reqUrl) {
  const requestUrl = reqUrl || '/';
  return requestUrl.startsWith('http') ? requestUrl : `${SITE_URL}${requestUrl}`;
}

function buildHead({ title, description, reqUrl }) {
  return `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl(reqUrl))}">
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${escapeHtml(canonicalUrl(reqUrl))}">
  ${ADSENSE_ENABLED ? `<meta name="google-adsense-account" content="${escapeHtml(ADSENSE_PUBLISHER_ID)}">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${escapeHtml(ADSENSE_PUBLISHER_ID)}" crossorigin="anonymous"></script>` : ''}
  ${STYLES}`;
}

function renderMasthead({ pageDate, briefings = [], selected = '', showDateNav = true, updatedLabel = '' }) {
  return `
    <header class="masthead">
      <div class="kiosk-topbar">
        <span class="kiosk-date">${escapeHtml(pageDate).toUpperCase()}</span>
        <span class="kiosk-wordmark">BRIEFING</span>
        <span class="kiosk-updated">${updatedLabel ? `UPDATED ${escapeHtml(updatedLabel)}` : ''}</span>
      </div>
      <div class="masthead-top">${escapeHtml(pageDate).toUpperCase()}</div>
      <div class="masthead-main">
        <h1 class="masthead-logo"><a href="/">${escapeHtml(SITE_NAME)}</a></h1>
        <p class="masthead-tagline">Manufacturing, 3D Printing, CNC, Robotics, AI Vision</p>
      </div>
      <div class="nav-strip">
        <nav class="section-nav">
          <a href="/#section-news">News</a>
          <a href="/#section-reddit">Reddit</a>
          <a href="/#section-youtube">YouTube</a>
        </nav>
        ${showDateNav ? `<nav class="date-nav">
          <a class="date-link active" href="/">All Briefings</a>
        </nav>` : `<nav class="date-nav"><a class="date-link" href="/">All Briefings</a></nav>`}
      </div>
    </header>`;
}

function renderFooter() {
  return `
    <footer class="footer">
      <div class="footer-line">Generated automatically by Dock&#39;s News Briefing System</div>
      <div class="footer-line footer-links"><a href="/about">About</a> · <a href="/privacy">Privacy</a> · <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">Contact</a></div>
      <div class="footer-line footer-copy">© 2026 ${escapeHtml(SITE_NAME)}</div>
    </footer>`;
}

function renderCookieBanner() {
  if (!ADSENSE_ENABLED) return '';
  return `
    <div class="cookie-banner" id="cookie-banner" hidden>
      <p>This site uses cookies for analytics and advertising. Learn more in our <a href="/privacy">Privacy Policy</a>.</p>
      <button type="button" id="cookie-accept">Accept</button>
    </div>
    <script>
      (function () {
        try {
          var key = 'db_cookie_consent';
          if (localStorage.getItem(key) === 'accepted') return;
          var banner = document.getElementById('cookie-banner');
          var button = document.getElementById('cookie-accept');
          if (!banner || !button) return;
          banner.hidden = false;
          button.addEventListener('click', function () {
            localStorage.setItem(key, 'accepted');
            banner.hidden = true;
          });
        } catch (error) {}
      })();
    </script>`;
}

function renderAd(slotClass, slotId) {
  if (!ADSENSE_ENABLED) return '';
  return `
    <div class="ad-wrapper">
      <div class="ad-label">Advertisement</div>
      <ins class="adsbygoogle ad-slot ${slotClass}"
           style="display:block"
           data-ad-client="${escapeHtml(ADSENSE_PUBLISHER_ID)}"
           data-ad-slot="${escapeHtml(slotId)}"
           data-ad-format="auto"
           data-full-width-responsive="true"></ins>
      <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
    </div>`;
}

function renderLayout({ title, description, reqUrl, pageDate, mastheadOptions, content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>${buildHead({ title, description, reqUrl })}
</head>
<body>
  <div class="shell">
    ${renderMasthead({ pageDate, ...mastheadOptions })}
    ${content}
    ${renderFooter()}
  </div>
  ${renderCookieBanner()}
</body>
</html>`;
}

function renderBriefingPage(briefings, reqUrl) {
  const latest = briefings[0];
  const fallbackDate = new Date().toISOString().slice(0, 10);
  const pageDate = latest ? formatLongDate(latest.date) : formatLongDate(fallbackDate);
  const description = latest ? `All daily briefings, latest: ${latest.title}` : `${SITE_NAME} automated tech briefing`;

  return renderLayout({
    title: `${SITE_NAME} | All Briefings`,
    description,
    reqUrl,
    pageDate,
    mastheadOptions: { briefings, selected: '', showDateNav: true, updatedLabel: formatUpdatedLabel(latest) },
    content: `
    ${renderAd('ad-leaderboard', '1111111111')}
    <main class="content">
      ${renderBriefingList(briefings)}
    </main>`,
  });
}

function renderBriefingList(briefings) {
  if (!briefings.length) return '<div class="empty">No briefings found.</div>';

  return `
    <div class="briefing-list">
      ${briefings.map((briefing, index) => renderBriefingListItem(briefing, index)).join('')}
    </div>`;
}

function renderBriefingListItem(briefing, index) {
  const idPrefix = index === 0 ? '' : `briefing-${slugify(briefing.date)}-`;
  return `
    <article class="briefing-day" id="briefing-${escapeHtml(slugify(briefing.date))}">
      <header class="briefing-day-header">
        <h2 class="briefing-day-title"><a href="#briefing-${escapeHtml(slugify(briefing.date))}">${escapeHtml(formatLongDate(briefing.date))} · ${escapeHtml(briefing.title)}</a></h2>
      </header>
      ${renderBriefing(briefing, idPrefix)}
    </article>`;
}

function renderStaticPage({ reqUrl, title, description, heading, content }) {
  return renderLayout({
    title: `${title} | ${SITE_NAME}`,
    description,
    reqUrl,
    pageDate: formatLongDate(LAST_UPDATED),
    mastheadOptions: { showDateNav: false },
    content: `
    <main class="content">
      <article class="page-copy">
        <h2 class="headline page-title">${escapeHtml(heading)}</h2>
        ${content}
      </article>
    </main>`,
  });
}

function renderBriefing(briefing, idPrefix = '') {
  if (!briefing || !briefing.sections || briefing.sections.length === 0) {
    return '<div class="empty">No content in this briefing.</div>';
  }

  const allItems = briefing.sections.flatMap((section) =>
    section.items.map((item) => ({ ...item, sectionTitle: section.title }))
  );
  const frontPageItems = allItems.filter((item) => getItemTypeClass(item) !== 'reddit-card');
  const sortedFrontPage = sortItems(frontPageItems, true);
  const { rotatedItems, hero, secondaries } = getRotatedFrontPageSlots(sortedFrontPage);
  const featuredKeys = new Set([hero, ...secondaries].filter(Boolean).map((item) => getItemKey(item)));
  const tickerItems = rotatedItems.slice(0, HERO_ROTATION_POOL_SIZE).map((item) => item.title);

  let html = '';

  if (tickerItems.length) {
    const tape = tickerItems.concat(tickerItems);
    html += `
      <div class="kiosk-ticker" aria-hidden="true">
        <div class="ticker-track">${tape.map((title) => `<span class="ticker-item">${escapeHtml(title)}</span>`).join('')}</div>
      </div>`;
  }

  if (hero) {
    html += `
      <section class="front-lead">
        <p class="kicker">Top Story</p>
        <div class="lead-grid">
          ${renderStory(hero, 'hero', { titleClass: 'hero-title', showSummary: true, showQuote: true })}
          <div class="side-stack">
            ${secondaries.map((item) => renderStory(item, 'secondary with-rule', { titleClass: 'secondary-title', showSummary: true })).join('')}
          </div>
        </div>
      </section>
      <section class="kiosk-front-lead">
        <div class="kiosk-front-label">▌▌TOP STORIES▐▐</div>
        <div class="kiosk-front-hero">
          ${renderStory(hero, 'hero', { titleClass: 'hero-title', showSummary: true, showQuote: true })}
        </div>
        <div class="kiosk-front-secondary-list">
          ${secondaries.map((item) => renderStory(item, 'secondary', { titleClass: 'secondary-title', showSummary: true })).join('')}
        </div>
      </section>`;
  }

  html += renderAd('ad-mid', '2222222222');

  for (const section of briefing.sections) {
    html += renderSection(section, featuredKeys, idPrefix);
  }

  return html;
}

function renderSection(section, featuredKeys = new Set(), idPrefix = '') {
  const id = `${idPrefix}section-` + slugify(section.title);
  const items = sortItems(section.items);
  const compact = isCompactSection(section.title);
  const sectionItems = featuredKeys.size ? items.filter((item) => !featuredKeys.has(getItemKey(item))) : items;
  const hasHero = !compact && sectionItems.length > 3;
  const hero = hasHero ? sectionItems[0] : null;
  const sideItems = hasHero ? sectionItems.slice(1, 3) : [];
  const gridItems = hasHero ? sectionItems.slice(3) : sectionItems;

  return `
    <section class="section-band" id="${id}">
      <div class="section-header">
        <div class="kiosk-section-label">▌▌${escapeHtml(cleanSectionTitle(section.title).toUpperCase())}▐▐</div>
        <h2 class="section-title">${escapeHtml(cleanSectionTitle(section.title))}</h2>
      </div>
      <div class="section-layout ${hasHero ? 'with-hero' : 'grid-only'} ${compact ? 'compact-layout' : ''} ${slugify(cleanSectionTitle(section.title))}-layout">
        ${hasHero ? `
          <div class="section-top">
            ${renderStory(hero, 'section-hero', { titleClass: 'section-hero-title', showSummary: true, showQuote: true })}
            <div class="section-secondary-list">
              ${sideItems.map((item) => renderStory(item, 'secondary with-rule', { titleClass: 'secondary-title', showSummary: true })).join('')}
            </div>
          </div>` : ''}
        ${gridItems.length ? `<div class="cards-grid">${gridItems.map((item) => renderStory(item, 'grid', { titleClass: 'grid-title', showSummary: true, compact: true })).join('')}</div>` : ''}
      </div>
    </section>
    ${renderAd('ad-between', '3333333333')}`;
}

function renderStory(item, variant, options = {}) {
  const summary = selectSummary(item, options);
  const summaryClass = options.compact ? 'summary clamp-3' : 'summary';
  const typeClass = getItemTypeClass(item);
  const stats = [item.views, item.duration, item.scoreCount ? 'Score ' + item.scoreCount : null, item.comments ? item.comments + ' comments' : null]
    .filter(Boolean)
    .join(' · ');

  const isLarge = variant.includes('hero') || variant.includes('section-hero');
  const subreddit = typeClass === 'reddit-card' ? extractSubreddit(item.source) : '';
  const overlayClass = typeClass === 'video-card' ? 'play-overlay' : typeClass === 'reddit-card' ? 'reddit-watermark' : '';
  const overlayAttr = subreddit ? ` data-subreddit="${escapeHtml(subreddit)}"` : '';
  const kioskSource = getKioskSource(item, subreddit);
  const kioskType = getKioskType(item);
  const kioskTypeClass = typeClass === 'video-card' ? 'video' : typeClass === 'reddit-card' ? 'reddit' : 'article';
  const kioskAge = formatAgeLabel(item.ageMinutes);
  const imageHtml = item.image
    ? `<div class="image-wrap ${overlayClass}"${overlayAttr}><img class="${isLarge ? 'hero-image' : 'card-image'}" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy"></div>`
    : (!isLarge && variant.includes('grid') ? `<div class="image-wrap image-placeholder"></div>` : '');
  const kioskThumbHtml = item.image
    ? `<img class="kiosk-thumb" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy">`
    : '<div class="kiosk-thumb-placeholder" aria-hidden="true"></div>';
  const mediaBadge = typeClass === 'video-card'
    ? '<span class="video-badge">▶ Video</span>'
    : typeClass === 'reddit-card' && subreddit
      ? `<span class="reddit-badge">${escapeHtml(subreddit)}</span>`
      : '';

  return `
    <article class="story ${variant} ${typeClass}">
      ${imageHtml}
      ${kioskThumbHtml}
      <div class="kiosk-copy">
        <h3 class="headline ${options.titleClass || 'grid-title'}">
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
        </h3>
        <div class="kiosk-divider"></div>
        <div class="meta">
          <span class="source">${escapeHtml(item.source || item.sectionTitle || 'Source')}</span>
          ${mediaBadge}
          ${item.topic ? `<span>${escapeHtml(item.topic)}</span>` : ''}
          <span>${escapeHtml(cleanSectionTitle(item.sectionTitle || ''))}</span>
          ${item.rating ? `<span class="rating-pill">${escapeHtml(item.rating)} ${escapeHtml(item.score || '')}/5</span>` : ''}
          <span class="kiosk-meta km-source ${kioskTypeClass}">${escapeHtml(kioskSource)}</span>
          <span class="kiosk-meta"> · </span>
          <span class="kiosk-meta km-type ${kioskTypeClass}">${escapeHtml(kioskType)}</span>
          <span class="kiosk-meta"> · </span>
          <span class="kiosk-meta km-age">${escapeHtml(kioskAge)}</span>
        </div>
        ${stats ? `<div class="stats">${escapeHtml(stats)}</div>` : ''}
        ${summary ? `<p class="${summaryClass}">${escapeHtml(summary)}</p>` : ''}
        ${options.showQuote && item.transcript_preview ? `<p class="quote">“${escapeHtml(trimText(item.transcript_preview, 240))}”</p>` : ''}
      </div>
    </article>`;
}

function selectSummary(item, options = {}) {
  const candidates = [item.body, item.transcript_preview].filter(Boolean);
  if (!candidates.length) return '';
  const max = options.compact ? 150 : 220;
  return trimText(candidates[0], max);
}

function sortItems(items, preferArticles = false) {
  return [...items].sort((a, b) => getScore(b) - getScore(a) || (preferArticles ? getTypeRank(a) - getTypeRank(b) : 0) || a.title.localeCompare(b.title));
}

function getRotatedFrontPageSlots(sortedItems) {
  const topCandidates = sortedItems.slice(0, HERO_ROTATION_POOL_SIZE);
  if (!topCandidates.length) {
    return { rotatedItems: [], hero: null, secondaries: [] };
  }

  const hoursSinceEpoch = Math.floor(Date.now() / 3600000);
  const slot = Math.floor(hoursSinceEpoch / HERO_ROTATION_HOURS);
  const heroIdx = slot % topCandidates.length;
  const rotatedPool = topCandidates.map((_, index) => topCandidates[(heroIdx + index) % topCandidates.length]);
  const rotatedKeys = new Set(rotatedPool.map((item) => getItemKey(item)));
  const remainder = sortedItems.filter((item) => !rotatedKeys.has(getItemKey(item)));
  const rotatedItems = rotatedPool.concat(remainder);

  return {
    rotatedItems,
    hero: rotatedPool[0] || null,
    secondaries: rotatedPool.slice(1, 3),
  };
}

function getScore(item) {
  return Number.parseFloat(item.score || '0') || 0;
}

function getItemKey(item) {
  return `${String(item.url || '').trim()}::${String(item.title || '').trim()}`;
}

function getItemTypeClass(item) {
  const section = cleanSectionTitle(item.sectionTitle || '');
  const source = String(item.source || '');
  if (section === 'YouTube' || source === 'YouTube') return 'video-card';
  if (section === 'Reddit') return 'reddit-card';
  return 'article-card';
}

function getTypeRank(item) {
  const type = getItemTypeClass(item);
  if (type === 'article-card') return 0;
  if (type === 'reddit-card') return 1;
  return 2;
}

function isCompactSection(title) {
  const clean = cleanSectionTitle(title);
  return clean === 'YouTube' || clean === 'Reddit';
}

function extractSubreddit(source) {
  const match = String(source || '').match(/(r\/[A-Za-z0-9_]+)/);
  return match ? match[1] : '';
}

function cleanSectionTitle(title) {
  return String(title || '')
    .replace(/[📺💬📰]/g, '')
    .replace(/Worth Watching/gi, '')
    .replace(/Highlights/gi, '')
    .replace(/& Articles/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text) {
  return cleanSectionTitle(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function trimText(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, '') + '...';
}

function formatLongDate(dateInput) {
  const date = new Date(dateInput + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatUpdatedLabel(briefing) {
  const value = briefing && briefing.updatedAt ? new Date(briefing.updatedAt) : new Date();
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });
}

function formatAgeLabel(minutes) {
  const total = Math.max(0, Number(minutes) || 0);
  if (total < 60) return `${total}M AGO`;
  if (total < 1440) return `${Math.round(total / 60)}H AGO`;
  return `${Math.round(total / 1440)}D AGO`;
}

function getKioskSource(item, subreddit) {
  if (getItemTypeClass(item) === 'reddit-card') return (subreddit || 'REDDIT').toUpperCase();
  return String(item.source || item.sectionTitle || 'SOURCE').toUpperCase();
}

function getKioskType(item) {
  const type = getItemTypeClass(item);
  if (type === 'video-card') return '▶ VIDEO';
  if (type === 'reddit-card') return '⬤ REDDIT';
  return 'ARTICLE';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseBriefing(filename, content) {
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : filename.replace('.md', '');
  const titleMatch = content.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1] : 'Briefing - ' + date;
  const generatedTime = capture(content, /^> Generated:\s*(.+)$/m);
  const generatedAt = generatedTime ? `${date}T${generatedTime}` : '';

  const sections = [];
  const patterns = [
    { title: 'News', pattern: /## 📰 News & Articles\n\n([\s\S]*?)(?=\n---\n\n##\s|$)/ },
    { title: 'Reddit', pattern: /## 💬 Reddit Highlights\n\n([\s\S]*?)(?=\n---\n\n##\s|$)/ },
    { title: 'YouTube', pattern: /## 📺 YouTube Worth Watching\n\n([\s\S]*?)(?=\n---\n\n##\s|$)/ },
  ];

  for (const sectionPattern of patterns) {
    const match = content.match(sectionPattern.pattern);
    if (!match) continue;
    const items = parseItems(match[1], sectionPattern.title === 'YouTube').map((item) => ({ ...item, sectionTitle: sectionPattern.title }));
    if (items.length) sections.push({ title: sectionPattern.title, items });
  }

  return { date, filename, title, sections, generatedAt };
}

function parseItems(text, isYouTube) {
  const items = [];
  const pattern = /### \[(.+?)\]\((.+?)\)\n([\s\S]*?)(?=\n---\n\n### |\n---\s*$|$)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const bodyBlock = match[3].trim();
    const item = {
      title: match[1].trim(),
      url: match[2].trim(),
      source: isYouTube ? capture(bodyBlock, /\*\*Channel:\*\* (.+?) \|/) || 'YouTube' : capture(bodyBlock, /\*\*Source:\*\* (.+?) \|/) || 'Unknown',
      topic: capture(bodyBlock, /\*\*Topic:\*\* (.+?)(?:\s{2,}|\n|\|)/),
      rating: capture(bodyBlock, /\*\*Rating:\*\* ([⭐★☆]+)/),
      score: capture(bodyBlock, /\*\*Rating:\*\* [⭐★☆]+ ([\d.]+)\/5\.0/),
      views: capture(bodyBlock, /\*\*Views:\*\* (.+?) \|/),
      duration: capture(bodyBlock, /\*\*Duration:\*\* (.+?)$/m),
      published: capture(bodyBlock, /\*\*Published:\*\* (.+?)$/m),
      scoreCount: capture(bodyBlock, /\*\*Score:\*\* (.+?)(?:\s*\||$)/m),
      comments: capture(bodyBlock, /\*\*Comments:\*\* (.+?)(?:\s*$|\|)/m),
      transcript_preview: capture(bodyBlock, /📝 \*\*Transcript Preview:\*\* ([\s\S]+?)(?:\n|$)/),
      image: capture(bodyBlock, /\*\*Image:\*\* (\S+)/),
      body: capture(bodyBlock, />\s+([\s\S]+)$/m),
    };

    if (item.body) item.body = item.body.replace(/\n>\s*/g, ' ').replace(/\.\.\.$/, '').trim();
    if (item.transcript_preview && item.transcript_preview === item.body) item.transcript_preview = '';
    items.push(item);
  }

  return items;
}

function capture(text, regex) {
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function loadBriefings() {
  try {
    return fs.readdirSync(BRIEFINGS_DIR)
      .filter((file) => file.endsWith('.md') && file !== 'INDEX.md')
      .map((filename) => {
        const filePath = path.join(BRIEFINGS_DIR, filename);
        const content = fs.readFileSync(filePath, 'utf8');
        const briefing = parseBriefing(filename, content);
        const stat = fs.statSync(filePath);
        const updatedAt = briefing.generatedAt || stat.mtime.toISOString();
        const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 60000));

        briefing.updatedAt = updatedAt;
        briefing.ageMinutes = ageMinutes;
        briefing.sections = briefing.sections.map((section) => ({
          ...section,
          items: section.items.map((item) => {
            const publishedAt = item.published ? new Date(item.published) : null;
            const itemAgeMinutes = publishedAt && !Number.isNaN(publishedAt.getTime())
              ? Math.max(0, Math.round((Date.now() - publishedAt.getTime()) / 60000))
              : ageMinutes;
            return { ...item, ageMinutes: itemAgeMinutes };
          }),
        }));

        return briefing;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (error) {
    console.error('Error loading briefings:', error);
    return [];
  }
}

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSitemap(briefings) {
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/privacy`,
    `${SITE_URL}/about`,
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')}
</urlset>`;
}

const PRIVACY_CONTENT = `
<p>This Privacy Policy explains what information is collected when you visit ${escapeHtml(SITE_NAME)}, how that information is used, and what choices you have. This site is an automated news briefing that publishes summaries and links to publicly available content in manufacturing, robotics, AI vision, CNC, and 3D printing.</p>
<p>We do not directly collect personal information through forms, logins, or user accounts on this site. There is no account system, no newsletter signup, and no comment section. Standard web server logs may still record technical request data such as IP address, browser type, referral information, and page requests for routine hosting, troubleshooting, and security purposes.</p>
<p>If advertising is enabled on this site, third-party vendors, including Google, may use cookies to serve ads based on your prior visits to this site or other sites on the internet. Google may use the DoubleClick cookie or similar technologies to personalize advertising. Those cookies are controlled by Google and its partners, not by this site directly.</p>
<p>Cookies may also be used to remember basic site preferences, including whether you accepted the on-site cookie notice. The cookie banner itself stores a simple local browser preference under the key <strong>db_cookie_consent</strong> so the notice does not keep reappearing after acceptance.</p>
<p>If you are in the European Economic Area, United Kingdom, or another region with similar privacy rights, you may have rights relating to access, deletion, restriction, objection, or complaint depending on applicable law. For ad personalization controls, you can review or opt out of Google personalized advertising through <a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer">Google Ads Settings</a>. You can also learn more about how Google uses information from partner sites at <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">Google’s partner sites policy</a>.</p>
<p>This site may link to third-party websites, videos, and public social posts. Once you follow an outbound link, that destination’s own privacy practices apply. We are not responsible for the content, cookies, or policies of those outside services.</p>
<p>If you have privacy questions, concerns, or requests related to this site, contact <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>. This policy may be updated from time to time as the site changes. Last updated: ${escapeHtml(LAST_UPDATED)}.</p>`;

const ABOUT_CONTENT = `
<p>${escapeHtml(SITE_NAME)} is an automated daily tech-news briefing built to surface the most relevant stories in advanced manufacturing, 3D printing, CNC, robotics, and AI vision. The goal is simple: turn a noisy stream of public content into a cleaner front page that is fast to scan.</p>
<p>The briefing is assembled from public sources including Reddit discussions, YouTube videos, and RSS or publisher feeds. Items are automatically parsed, grouped, and rated for relevance so the strongest material rises to the top. The result is not hand-curated journalism, and it should be read as an automated digest rather than original reporting.</p>
<p>Every briefing links back to the original source so readers can verify context, dig deeper, and give credit to the creators and publications doing the underlying work. If something looks off, stale, or misclassified, that is a limitation of the automation pipeline, not a claim of authority.</p>
<p>Questions, corrections, or business inquiries can be sent to <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>.</p>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const briefings = loadBriefings();

  if (pathname === '/ads.txt') {
    if (!ADSENSE_ENABLED) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`google.com, ${ADSENSE_PUBLISHER_ID.replace('ca-pub-', '')}, DIRECT, f08c47fec0942fa0\n`);
    return;
  }

  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
    return;
  }

  if (pathname === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(buildSitemap(briefings));
    return;
  }

  if (pathname === '/privacy') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderStaticPage({
      reqUrl: req.url,
      title: 'Privacy Policy',
      description: 'Privacy Policy for The Daily Briefing, including cookie usage, advertising disclosures, and contact information.',
      heading: 'Privacy Policy',
      content: PRIVACY_CONTENT,
    }));
    return;
  }

  if (pathname === '/about') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderStaticPage({
      reqUrl: req.url,
      title: 'About',
      description: 'About The Daily Briefing, an automated daily roundup for manufacturing, robotics, CNC, 3D printing, and AI vision.',
      heading: 'About The Daily Briefing',
      content: ABOUT_CONTENT,
    }));
    return;
  }

  if (pathname !== '/') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderBriefingPage(briefings, req.url));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('Briefings app running at http://localhost:' + PORT);
  });
}
