export function isRedditAmaDraft(draft = {}) {
  const articleType = String(draft.articleType || '').toLowerCase();
  const tags = Array.isArray(draft.tags) ? draft.tags : [];
  return articleType === 'reddit-ama-summary'
    || articleType === 'reddit-ama-preview'
    || tags.some((tag) => /\breddit\s+ama\b/i.test(String(tag)) || /\bama\b/i.test(String(tag)));
}

function isRedditAmaPreview(draft = {}) {
  return String(draft.articleType || '').toLowerCase() === 'reddit-ama-preview';
}

export function getAmaReviewBadgeLabel(draft = {}) {
  if (!isRedditAmaDraft(draft)) return '';
  const articleType = String(draft.articleType || '').toLowerCase();
  if (articleType === 'reddit-ama-preview') return 'Reddit AMA preview';
  if (articleType === 'reddit-ama-summary') return 'Reddit AMA summary';
  return 'Reddit AMA';
}

export function getAmaContext(draft = {}) {
  if (!isRedditAmaDraft(draft)) return null;
  const sourceUrls = Array.isArray(draft.sourceUrls) ? draft.sourceUrls : [];
  const redditSource = sourceUrls.find((url) => /reddit\.com|redd\.it/i.test(String(url))) || sourceUrls[0] || '';
  const isPreview = isRedditAmaPreview(draft);
  return {
    label: isPreview ? 'Reddit AMA preview draft' : 'Reddit AMA summary draft',
    summary: isPreview
      ? 'This draft was generated from a Reddit AMA thread that does not have enough official answers yet. Review the questions to watch, then add what Wes should revisit after answers land.'
      : 'This draft was generated from a Reddit AMA thread. Review the selected Q/A pairs against the source before publishing, then add Wes-authored context for Factory Signal readers.',
    sourceUrl: redditSource,
  };
}

export function getPersonalAdditionRecommendations(draft = {}) {
  const title = draft.title || 'this draft';
  const tags = normalizeTags(draft.tags);
  const sourceTopic = topicFromSources(draft.sourceUrls);
  const topic = readableTopic(tags, sourceTopic);

  if (isRedditAmaPreview(draft)) {
    return {
      opening: `Explain why the questions in ${title} matter to manufacturers, robotics/CNC programs, and classrooms before the official answers arrive.`,
      middle: 'Call out the highest-signal questions to watch: tooling, reliability, cost, lead times, safety, training, documentation, and what operators would ask as follow-up.',
      closing: 'Name what Wes should add after answers land: confirmed commitments, practical caveats, unanswered technical gaps, and whether the answers change the manufacturing/classroom takeaway.',
    };
  }

  if (isRedditAmaDraft(draft)) {
    return {
      opening: `Explain why ${title} matters to manufacturers, robotics/CNC programs, and classrooms right now.`,
      middle: 'Call out the AMA questions or answers that need shop-floor context: tooling, reliability, cost, lead times, safety, training, or what operators would ask next.',
      closing: 'Name what to watch next after the AMA: product follow-through, documentation, ecosystem support, classroom usefulness, or unanswered technical questions.',
    };
  }

  return {
    opening: `Frame why ${topic} is worth attention now and what made this draft stand out.`,
    middle: `Add one practical ${topic} angle: implementation friction, operator impact, training needs, quality risk, or where a shop would test it first.`,
    closing: `Close with a concise takeaway for manufacturers/classrooms and one next signal to monitor in ${topic}.`,
  };
}

function normalizeTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .filter((tag) => !/^reddit\s+ama$/i.test(tag));
}

function topicFromSources(sourceUrls = []) {
  const sourceText = (Array.isArray(sourceUrls) ? sourceUrls : []).join(' ');
  if (/raspberry|rpi/i.test(sourceText)) return 'Raspberry Pi and edge computing';
  if (/robot/i.test(sourceText)) return 'robotics';
  if (/cnc|machin/i.test(sourceText)) return 'CNC machining';
  if (/3dprint|3d-print|additive/i.test(sourceText)) return '3D printing';
  return '';
}

function readableTopic(tags, fallback) {
  const priority = ['manufacturing', 'automation', 'robotics', 'cnc', '3d printing', 'additive manufacturing', 'ai vision', 'machine vision', 'education'];
  const lowerTags = tags.map((tag) => tag.toLowerCase());
  const matched = priority.find((candidate) => lowerTags.includes(candidate));
  if (matched) return matched;
  if (tags.length > 0) return tags.slice(0, 2).join(' / ');
  return fallback || 'advanced manufacturing';
}
