const sharp = require('sharp');
const { HttpError } = require('../../core/http-error');
const {
  MAX_RECIPE_IMAGE_BYTES,
  RECIPE_IMAGE_FORMATS,
  RECIPE_IMAGE_HEIGHT,
  RECIPE_IMAGE_INVALID,
  RECIPE_IMAGE_MAX_CROP,
  RECIPE_IMAGE_MAX_UPSCALE,
  RECIPE_IMAGE_MIME_TYPES,
  RECIPE_IMAGE_OUTPUT_EXT,
  RECIPE_IMAGE_OUTPUT_MIME,
  RECIPE_PLAN_IMAGE_SIZES,
  RECIPE_IMAGE_WEBP_QUALITY,
  RECIPE_IMAGE_WIDTH,
  recipeBannerFit
} = require('../../core/recipe-content');

function invalid(message, details) {
  return new HttpError(422, message, { code: RECIPE_IMAGE_INVALID, ...details });
}

const PLAN_SIZES = RECIPE_PLAN_IMAGE_SIZES.map((side) => ({ width: side, height: side }));

function sizeText(sizes) {
  return sizes.map(({ width, height }) => `${width} x ${height}`).join(' or ');
}

function checkPlanSize(metadata) {
  if (!PLAN_SIZES.some(({ width, height }) => metadata.width === width && metadata.height === height)) {
    throw invalid(`Image must be ${sizeText(PLAN_SIZES)} pixels.`, {
      reason: 'dimensions',
      width: metadata.width,
      height: metadata.height,
      expectedWidth: PLAN_SIZES[0].width,
      expectedHeight: PLAN_SIZES[0].height,
      acceptedSizes: PLAN_SIZES
    });
  }
}

function checkBannerSize(metadata) {
  if (!recipeBannerFit(metadata.width, metadata.height).ok) {
    throw invalid(`Image must be ${RECIPE_IMAGE_WIDTH} x ${RECIPE_IMAGE_HEIGHT} pixels, or close enough to be resized to it.`, {
      reason: 'dimensions',
      width: metadata.width,
      height: metadata.height,
      expectedWidth: RECIPE_IMAGE_WIDTH,
      expectedHeight: RECIPE_IMAGE_HEIGHT,
      maxUpscale: RECIPE_IMAGE_MAX_UPSCALE,
      maxCrop: RECIPE_IMAGE_MAX_CROP
    });
  }
}

// Checks type, weight and size, then re-encodes as WebP. The plan thumbnail (kind 'plan') must have
// one of its exact sizes and keeps it; the banner is resized and centre-cropped to 1024 x 636.
async function processRecipeImage({ mimeType, buffer, kind = 'banner' }) {
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

  if (kind === 'plan') {
    checkPlanSize(metadata);
  } else {
    checkBannerSize(metadata);
  }

  let pipeline = sharp(buffer);
  if (kind !== 'plan') {
    pipeline = pipeline.resize(RECIPE_IMAGE_WIDTH, RECIPE_IMAGE_HEIGHT, { fit: 'cover', position: 'centre' });
  }
  const output = await pipeline
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
