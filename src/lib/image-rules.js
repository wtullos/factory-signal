export const MIN_SOURCE_IMAGE_WIDTH = 600;
export const MIN_SOURCE_IMAGE_HEIGHT = 315;
export const MIN_DISPLAY_IMAGE_WIDTH = 1200;
export const MIN_DISPLAY_IMAGE_HEIGHT = 630;
export const MIN_RENDERABLE_DISPLAY_IMAGE_WIDTH = 120;
export const MIN_RENDERABLE_DISPLAY_IMAGE_HEIGHT = 90;
export const GENERATED_FALLBACK_WIDTH = 1600;
export const GENERATED_FALLBACK_HEIGHT = 900;

const IMAGE_EXTENSION_PATTERN = /\.(avif|jpe?g|png|webp)(?:[?#].*)?$/i;
const GENERATED_IMAGE_PATTERN = /^\/generated-images\/.+\.svg(?:[?#].*)?$/i;
const BAD_IMAGE_WORD_PATTERN = /(?:^|[\W_])(?:ad|ads|avatar|badge|blank|button|clear|favicon|icon|loader|logo|pixel|placeholder|profile|share|spacer|sprite|tracking|transparent)(?:[\W_]|$)/i;

export function isRenderableImageUrl(image) {
  if (typeof image !== 'string') return false;
  const candidate = image.trim();
  if (!candidate) return false;
  if (/^https?:\/\//i.test(candidate)) return true;
  return candidate.startsWith('/') && !candidate.startsWith('//') && /\.(avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(candidate);
}

export function isGeneratedFallbackImage(image) {
  return typeof image === 'string' && GENERATED_IMAGE_PATTERN.test(image.trim());
}

export function isAcceptableSourceImage(image, minimumWidth = MIN_SOURCE_IMAGE_WIDTH) {
  if (!isRenderableImageUrl(image)) return false;
  const candidate = image.trim();
  if (isGeneratedFallbackImage(candidate)) return true;
  if (/\.(svg|gif)(?:[?#]|$)/i.test(candidate) && /^https?:\/\//i.test(candidate)) return false;
  if (BAD_IMAGE_WORD_PATTERN.test(candidate)) return false;

  const dimensions = imageDimensionsFromUrl(candidate);
  if (dimensions.width && dimensions.width < minimumWidth) return false;
  if (dimensions.height && dimensions.height < MIN_SOURCE_IMAGE_HEIGHT) return false;
  if (dimensions.width && dimensions.height && dimensions.width * dimensions.height < minimumWidth * MIN_SOURCE_IMAGE_HEIGHT) return false;

  return true;
}

export function isAcceptableDisplayImage(image) {
  if (!isRenderableImageUrl(image)) return false;
  const candidate = image.trim();
  if (isGeneratedFallbackImage(candidate)) return true;
  if (/\.(svg|gif)(?:[?#]|$)/i.test(candidate) && /^https?:\/\//i.test(candidate)) return false;
  if (BAD_IMAGE_WORD_PATTERN.test(candidate)) return false;

  const dimensions = imageDimensionsFromUrl(candidate);
  if (dimensions.width && dimensions.width < MIN_RENDERABLE_DISPLAY_IMAGE_WIDTH) return false;
  if (dimensions.height && dimensions.height < MIN_RENDERABLE_DISPLAY_IMAGE_HEIGHT) return false;

  return true;
}

export function scoreImageCandidate({ url, score = 0, width = 0, height = 0, source = '' }) {
  const dimensions = mergeDimensions({ width, height }, imageDimensionsFromUrl(url));
  if (!isAcceptableSourceImage(url)) return Number.NEGATIVE_INFINITY;
  if (dimensions.width && dimensions.width < MIN_SOURCE_IMAGE_WIDTH) return Number.NEGATIVE_INFINITY;
  if (dimensions.height && dimensions.height < MIN_SOURCE_IMAGE_HEIGHT) return Number.NEGATIVE_INFINITY;

  let nextScore = score;
  if (source === 'meta') nextScore += 90;
  if (source === 'srcset') nextScore += 20;
  if (dimensions.width >= MIN_DISPLAY_IMAGE_WIDTH) nextScore += 90;
  else if (dimensions.width >= MIN_SOURCE_IMAGE_WIDTH) nextScore += 30;
  else if (!dimensions.width) nextScore += 12;
  if (dimensions.height >= MIN_DISPLAY_IMAGE_HEIGHT) nextScore += 35;
  if (dimensions.width && dimensions.height) nextScore += Math.min((dimensions.width * dimensions.height) / 50000, 80);
  return nextScore;
}

export function imageDimensionsFromUrl(value) {
  const result = { width: 0, height: 0 };
  if (typeof value !== 'string' || !value.trim()) return result;

  const decoded = decodeURIComponent(value).replace(/&amp;/g, '&');
  const pathMatches = [...decoded.matchAll(/(?:^|[^0-9])([1-9][0-9]{1,4})\s*[x×]\s*([1-9][0-9]{1,4})(?=[^0-9]|$)/gi)];
  for (const match of pathMatches) {
    const width = Number.parseInt(match[1], 10);
    const height = Number.parseInt(match[2], 10);
    if (width * height > result.width * result.height) {
      result.width = width;
      result.height = height;
    }
  }

  try {
    const url = new URL(decoded, 'https://example.invalid');
    const params = url.searchParams;
    const widthKeys = ['w', 'width', 'wid', 'resizeWidth', 'maxwidth'];
    const heightKeys = ['h', 'height', 'hei', 'resizeHeight', 'maxheight'];
    for (const key of widthKeys) {
      const width = Number.parseInt(params.get(key) || '0', 10);
      if (width > result.width) result.width = width;
    }
    for (const key of heightKeys) {
      const height = Number.parseInt(params.get(key) || '0', 10);
      if (height > result.height) result.height = height;
    }
  } catch {
    // Leave dimensions unknown when the URL cannot be parsed.
  }

  return result;
}

export function largestSrcsetCandidate(srcset) {
  if (typeof srcset !== 'string' || !srcset.trim()) return '';
  let best = { url: '', width: 0 };
  for (const entry of srcset.split(',')) {
    const parts = entry.trim().split(/\s+/);
    const url = parts[0] || '';
    const width = Number.parseInt(parts.find((part) => /\d+w$/i.test(part))?.replace(/w$/i, '') || '0', 10) || imageDimensionsFromUrl(url).width;
    if (url && width >= best.width) best = { url, width };
  }
  return best.url;
}

function mergeDimensions(primary, fallback) {
  return {
    width: Number.parseInt(primary.width || '0', 10) || fallback.width || 0,
    height: Number.parseInt(primary.height || '0', 10) || fallback.height || 0,
  };
}
