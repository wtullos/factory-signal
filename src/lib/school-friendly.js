const WORD_BOUNDARY = String.raw`(?:^|[^a-z0-9])`;
const WORD_END = String.raw`(?=$|[^a-z0-9])`;

export const SCHOOL_UNFRIENDLY_PATTERNS = [
  // Adult / sexual / NSFW content.
  { category: 'adult-sexual', pattern: new RegExp(`${WORD_BOUNDARY}(?:porn(?:ography)?|xxx|nsfw|onlyfans|fetish|escort|stripper|brothel|prostitut(?:e|ion)|sex(?:ual)?(?:ly)? explicit|erotic|nude|nudity|naked|orgy)${WORD_END}`, 'i') },
  { category: 'adult-sexual', pattern: new RegExp(`${WORD_BOUNDARY}(?:rape|incest|bestiality|molest(?:ation)?|child sexual abuse|csam)${WORD_END}`, 'i') },

  // Graphic violence / gore.
  { category: 'graphic-violence', pattern: new RegExp(`${WORD_BOUNDARY}(?:gore|gory|behead(?:ed|ing)?|decapitat(?:ed|ion)|dismember(?:ed|ment)?|mutilat(?:ed|ion)|graphic violence|snuff)${WORD_END}`, 'i') },
  { category: 'graphic-violence', pattern: new RegExp(`${WORD_BOUNDARY}(?:bloodbath|massacre|slaughter)${WORD_END}`, 'i') },

  // Weapons in unsafe contexts. Avoid common manufacturing terms such as gun drill.
  { category: 'unsafe-weapons', pattern: new RegExp(`${WORD_BOUNDARY}(?:ghost gun|3d[ -]?printed gun|homemade firearm|unregistered firearm|school shooting|mass shooting|active shooter|bomb(?:making)?|pipe bomb|ied|explosive device|weaponized drone)${WORD_END}`, 'i') },
  { category: 'unsafe-weapons', pattern: new RegExp(`${WORD_BOUNDARY}(?:how to (?:make|build|print|assemble) (?:a |an )?(?:gun|firearm|bomb|explosive|weapon)|(?:gun|firearm|bomb|explosive|weapon) tutorial)${WORD_END}`, 'i') },

  // Drugs / regulated intoxicants.
  { category: 'drugs', pattern: new RegExp(`${WORD_BOUNDARY}(?:cocaine|heroin|meth(?:amphetamine)?|fentanyl|opioid abuse|illegal drugs?|drug cartel|drug deal(?:er|ing)?|getting high|bong|marijuana|cannabis|weed|thc|vape|vaping)${WORD_END}`, 'i') },

  // Profanity / slurs (compact list; maintainable and intentionally exact).
  { category: 'profanity', pattern: new RegExp(`${WORD_BOUNDARY}(?:fuck|fucking|shit|bullshit|bitch|bastard|asshole|dickhead|piss off)${WORD_END}`, 'i') },
  { category: 'slurs-hate', pattern: new RegExp(`${WORD_BOUNDARY}(?:nazi|neo-nazi|white supremac(?:y|ist)|kkk|antisemitic|racial slur|homophobic slur|transphobic slur)${WORD_END}`, 'i') },

  // Gambling / extremism.
  { category: 'gambling', pattern: new RegExp(`${WORD_BOUNDARY}(?:casino|sportsbook|betting odds|online gambling|poker tournament|slot machine|lottery jackpot)${WORD_END}`, 'i') },
  { category: 'extremism', pattern: new RegExp(`${WORD_BOUNDARY}(?:terrorist|terrorism|isis|al-qaeda|violent extremist|extremist manifesto)${WORD_END}`, 'i') },
];

export function schoolFriendlyTextFor(item = {}) {
  return flattenTextFields([
    item.title,
    item.source,
    item.topic,
    item.sectionTitle,
    item.category,
    item.body,
    item.description,
    item.summary,
    item.tags,
    item.sourceUrls,
    item.sources,
    item.sourceUrl,
    item.url,
  ])
    .filter(Boolean)
    .join(' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenTextFields(fields) {
  return fields.flatMap((field) => {
    if (Array.isArray(field)) return flattenTextFields(field);
    if (field && typeof field === 'object') return flattenTextFields(Object.values(field));
    return field == null ? [] : String(field);
  });
}

export function schoolFriendlyViolations(item = {}) {
  const text = schoolFriendlyTextFor(item);
  return SCHOOL_UNFRIENDLY_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ category }) => category);
}

export function isSchoolFriendlyItem(item = {}) {
  return schoolFriendlyViolations(item).length === 0;
}
