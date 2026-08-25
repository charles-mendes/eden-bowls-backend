const sharp = require('sharp');
const { compressFeedbackPhoto } = require('../src/infrastructure/imaging/feedback-photo');
const {
  FEEDBACK_PHOTO_HEIGHT,
  FEEDBACK_PHOTO_OUTPUT_EXT,
  FEEDBACK_PHOTO_OUTPUT_MIME,
  FEEDBACK_PHOTO_WIDTH
} = require('../src/core/feedbacks');

describe('compressFeedbackPhoto', () => {
  test('cover-crops to 400x300 webp', async () => {
    const source = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 217, g: 207, b: 196 }
      }
    }).png().toBuffer();

    const result = await compressFeedbackPhoto(source);
    const metadata = await sharp(result.buffer).metadata();

    expect(result.ext).toBe(FEEDBACK_PHOTO_OUTPUT_EXT);
    expect(result.mimeType).toBe(FEEDBACK_PHOTO_OUTPUT_MIME);
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(FEEDBACK_PHOTO_WIDTH);
    expect(metadata.height).toBe(FEEDBACK_PHOTO_HEIGHT);
    expect(result.buffer.length).toBeLessThan(source.length);
  });
});
