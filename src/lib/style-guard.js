const TEXT_FIELD_KEYS = [
  'title',
  'description',
  'summary',
  'body',
  'deck',
  'source',
  'topic',
  'sectionTitle',
  'category',
];

export const AI_TELL_CONTRAST_RULES = [
  {
    code: 'not-just',
    pattern: /\bnot\s+(?:just|only|simply|merely)\b/gi,
    message: 'Prefer a direct claim instead of “not just/not only/not simply/not merely” framing.',
  },
  {
    code: 'not-x-but-y',
    pattern: /\bnot\s+[^\n.!?;:]{1,120}\s+but\b/gi,
    message: 'Prefer a direct claim instead of “not X but Y” contrast framing.',
  },
  {
    code: 'this-is-not',
    pattern: /\bthis\s+is\s+not\b/gi,
    message: 'Prefer a direct claim instead of “This is not X, it is Y” framing.',
  },
  {
    code: 'not-x-it-is-y',
    pattern: /\b(?:this|it)\s+is\s+not\s+[^\n.!?;:]{1,120}\s+(?:it\s+is|it's)\b/gi,
    message: 'Prefer a direct claim instead of “not X, it is Y” framing.',
  },
  {
    code: 'isnt-x-but-y',
    pattern: /\bisn['’]?t\s+[^\n.!?;:]{1,120}\s+but\b/gi,
    message: 'Prefer a direct claim instead of “isn’t X but Y” contrast framing.',
  },
];

export function styleGuardTextFor(item = {}) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';

  const values = TEXT_FIELD_KEYS.flatMap((key) => flattenTextFields(item[key]));
  return values
    .filter(Boolean)
    .join('\n')
    .replace(/\r\n/g, '\n');
}

export function aiTellContrastViolations(item = {}) {
  const text = styleGuardTextFor(item);
  if (!text) return [];

  return AI_TELL_CONTRAST_RULES.flatMap((rule) => {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const violations = [];
    for (const match of text.matchAll(pattern)) {
      violations.push({
        code: rule.code,
        message: rule.message,
        match: match[0],
        line: lineNumberAt(text, match.index || 0),
      });
    }
    return violations;
  });
}

export function isDirectStyleItem(item = {}) {
  return aiTellContrastViolations(item).length === 0;
}

function flattenTextFields(fields) {
  if (Array.isArray(fields)) return fields.flatMap((field) => flattenTextFields(field));
  if (fields && typeof fields === 'object') return Object.values(fields).flatMap((field) => flattenTextFields(field));
  return fields == null ? [] : String(fields);
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}
