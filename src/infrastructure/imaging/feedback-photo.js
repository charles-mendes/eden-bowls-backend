const sharp = require('sharp');
const {
  FEEDBACK_PHOTO_HEIGHT,
  FEEDBACK_PHOTO_OUTPUT_EXT,
  FEEDBACK_PHOTO_OUTPUT_MIME,
  FEEDBACK_PHOTO_WIDTH
} = require('../../core/feedbacks');

async function compressFeedbackPhoto(buffer) {
  const output = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(FEEDBACK_PHOTO_WIDTH, FEEDBACK_PHOTO_HEIGHT, {
      fit: 'cover',
      position: 'centre'
    })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

  return {
    buffer: output,
    mimeType: FEEDBACK_PHOTO_OUTPUT_MIME,
    ext: FEEDBACK_PHOTO_OUTPUT_EXT
  };
}

module.exports = {
  compressFeedbackPhoto
};
