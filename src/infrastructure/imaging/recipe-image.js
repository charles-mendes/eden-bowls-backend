const sharp = require('sharp');
const { HttpError } = require('../../core/http-error');
const {
  MAX_RECIPE_IMAGE_BYTES,
  RECIPE_IMAGE_FORMATS,
  RECIPE_IMAGE_HEIGHT,
  RECIPE_IMAGE_INVALID,
  RECIPE_IMAGE_MIME_TYPES,
  RECIPE_IMAGE_OUTPUT_EXT,
  RECIPE_IMAGE_OUTPUT_MIME,
  RECIPE_PLAN_IMAGE_SIZES,
  RECIPE_IMAGE_WEBP_QUALITY,
  RECIPE_IMAGE_WIDTH
} = require('../../core/recipe-content');

function invalid(message, details) {
  return new HttpError(422, message, { code: RECIPE_IMAGE_INVALID, ...details });
}

const BANNER_SIZES = [{ width: RECIPE_IMAGE_WIDTH, height: RECIPE_IMAGE_HEIGHT }];
const PLAN_SIZES = RECIPE_PLAN_IMAGE_SIZES.map((side) => ({ width: side, height: side }));

function sizeText(sizes) {
  return sizes.map(({ width, height }) => `${width} x ${height}`).join(' or ');
}

// Checks type, weight and one of the accepted exact sizes (the banner, or the plan thumbnail with
// kind 'plan'), then re-encodes as WebP at the same size (no crop or resize).
async function processRecipeImage({ mimeType, buffer, kind = 'banner' }) {
  const sizes = kind === 'plan' ? PLAN_SIZES : BANNER_SIZES;
  const type = String(mimeType || '').trim().toLowerCase();
  if (!RECIPE_IMAGE_MIME_TYPES.includes(type)) {
    throw invalid('Unsupported image type. Use PNG, JPEG, or WebP.', {
      reason: 'type',
      mimeType: type,
      acceptedTypes: RECIPE_IMAGE_MIME_TYPES
    });
  }

  if (!buffer || !buffer.length) {
    throw invalid('Invalid image data.', { reason: 'data' });
  }

  if (buffer.length > MAX_RECIPE_IMAGE_BYTES) {
    throw invalid('Image must be 5 MB or smaller.', {
      reason: 'bytes',
      bytes: buffer.length,
      maxBytes: MAX_RECIPE_IMAGE_BYTES
    });
  }

  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (_error) {
    throw invalid('Invalid image data.', { reason: 'data' });
  }

  if (metadata.format !== RECIPE_IMAGE_FORMATS[type]) {
    throw invalid('Unsupported image type. Use PNG, JPEG, or WebP.', {
      reason: 'type',
      mimeType: type,
      format: metadata.format || null,
      acceptedTypes: RECIPE_IMAGE_MIME_TYPES
    });
  }

  if (!sizes.some(({ width, height }) => metadata.width === width && metadata.height === height)) {
    throw invalid(`Image must be ${sizeText(sizes)} pixels.`, {
      reason: 'dimensions',
      width: metadata.width,
      height: metadata.height,
      expectedWidth: sizes[0].width,
      expectedHeight: sizes[0].height,
      ...(sizes.length > 1 ? { acceptedSizes: sizes } : {})
    });
  }

  const output = await sharp(buffer)
    .webp({ quality: RECIPE_IMAGE_WEBP_QUALITY, alphaQuality: 100 })
    .toBuffer();

  return {
    buffer: output,
    mimeType: RECIPE_IMAGE_OUTPUT_MIME,
    ext: RECIPE_IMAGE_OUTPUT_EXT
  };
}

module.exports = {
  processRecipeImage
};
