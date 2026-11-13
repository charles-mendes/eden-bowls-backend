const sharp = require('sharp');
const { processRecipeImage } = require('../src/infrastructure/imaging/recipe-image');
const { MAX_RECIPE_IMAGE_BYTES } = require('../src/core/recipe-content');

function image(width, height, { channels = 3, format = 'png' } = {}) {
  const background = channels === 4 ? { r: 200, g: 120, b: 90, alpha: 0.5 } : { r: 200, g: 120, b: 90 };
  return sharp({ create: { width, height, channels, background } })[format]().toBuffer();
}

async function refusal(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

describe('processRecipeImage', () => {
  test('re-encodes a 1024 x 636 PNG with alpha as WebP at the same size', async () => {
    const result = await processRecipeImage({ mimeType: 'image/png', buffer: await image(1024, 636, { channels: 4 }) });
    const metadata = await sharp(result.buffer).metadata();

    expect(result).toMatchObject({ mimeType: 'image/webp', ext: 'webp' });
    expect(metadata).toMatchObject({ format: 'webp', width: 1024, height: 636, hasAlpha: true });
  });

  test.each([400, 200])('accepts a %i px square plan thumbnail', async (side) => {
    const result = await processRecipeImage({ mimeType: 'image/png', buffer: await image(side, side), kind: 'plan' });
    expect(await sharp(result.buffer).metadata()).toMatchObject({ format: 'webp', width: side, height: side });
  });

  test('refuses the banner size as a plan thumbnail, naming the accepted sizes', async () => {
    const error = await refusal(processRecipeImage({ mimeType: 'image/png', buffer: await image(1024, 636), kind: 'plan' }));

    expect(error.message).toBe('Image must be 400 x 400 or 200 x 200 pixels.');
    expect(error.details).toMatchObject({
      reason: 'dimensions',
      expectedWidth: 400,
      expectedHeight: 400,
      acceptedSizes: [{ width: 400, height: 400 }, { width: 200, height: 200 }]
    });
  });

  test('accepts JPEG at the banner size', async () => {
    const result = await processRecipeImage({ mimeType: 'image/jpeg', buffer: await image(1024, 636, { format: 'jpeg' }) });
    expect((await sharp(result.buffer).metadata()).width).toBe(1024);
  });

  test.each([
    [1024, 576],
    [1200, 800],
    [2048, 1272],
    [820, 509]
  ])('resizes a %i x %i banner, close to the size, to exactly 1024 x 636', async (width, height) => {
    const result = await processRecipeImage({ mimeType: 'image/png', buffer: await image(width, height) });
    expect(await sharp(result.buffer).metadata()).toMatchObject({ format: 'webp', width: 1024, height: 636 });
  });

  test.each([
    [800, 497, 'needs more than 25% of enlargement'],
    [1024, 512, 'loses more than 15% of the width'],
    [1024, 800, 'loses more than 15% of the height']
  ])('refuses a %i x %i banner that %s, saying what was received and expected', async (width, height) => {
    const error = await refusal(processRecipeImage({ mimeType: 'image/png', buffer: await image(width, height) }));

    expect(error.statusCode).toBe(422);
    expect(error.message).toBe('Image must be 1024 x 636 pixels, or close enough to be resized to it.');
    expect(error.details).toEqual({
      code: 'recipe_image_invalid',
      reason: 'dimensions',
      width,
      height,
      expectedWidth: 1024,
      expectedHeight: 636,
      maxUpscale: 1.25,
      maxCrop: 0.15
    });
  });

  test('refuses GIF, including a GIF sent as PNG', async () => {
    const gif = await image(1024, 636, { format: 'gif' });

    const declared = await refusal(processRecipeImage({ mimeType: 'image/gif', buffer: gif }));
    expect(declared.details).toMatchObject({ code: 'recipe_image_invalid', reason: 'type', acceptedTypes: ['image/png', 'image/jpeg', 'image/webp'] });

    const renamed = await refusal(processRecipeImage({ mimeType: 'image/png', buffer: gif }));
    expect(renamed.details).toMatchObject({ reason: 'type', format: 'gif' });
  });

  test('refuses a file over 5 MB before decoding it', async () => {
    const error = await refusal(processRecipeImage({ mimeType: 'image/png', buffer: Buffer.alloc(MAX_RECIPE_IMAGE_BYTES + 1) }));
    expect(error.details).toEqual({ code: 'recipe_image_invalid', reason: 'bytes', bytes: MAX_RECIPE_IMAGE_BYTES + 1, maxBytes: MAX_RECIPE_IMAGE_BYTES });
  });

  test('refuses bytes that are not an image', async () => {
    const error = await refusal(processRecipeImage({ mimeType: 'image/png', buffer: Buffer.from('not an image') }));
    expect(error.details).toMatchObject({ code: 'recipe_image_invalid', reason: 'data' });
  });
});
