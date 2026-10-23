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
  RECIPE_IMAGE_WEBP_QUALITY,
  RECIPE_IMAGE_WIDTH
} = require('../../core/recipe-content');

function invalid(message, details) {
  return new HttpError(422, message, { code: RECIPE_IMAGE_INVALID, ...details });
}

// Checks type, weight and exact banner size, then re-encodes as WebP at the same size (no crop or resize).
async function processRecipeImage({ mimeType, buffer }) {
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

  if (metadata.width !== RECIPE_IMAGE_WIDTH || metadata.height !== RECIPE_IMAGE_HEIGHT) {
    throw invalid(`Image must be ${RECIPE_IMAGE_WIDTH} x ${RECIPE_IMAGE_HEIGHT} pixels.`, {
      reason: 'dimensions',
      width: metadata.width,
      height: metadata.height,
      expectedWidth: RECIPE_IMAGE_WIDTH,
      expectedHeight: RECIPE_IMAGE_HEIGHT
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
