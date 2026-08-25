const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const {
  FEEDBACK_PHOTO_MIME_TYPES,
  MAX_FEEDBACK_PHOTO_BYTES
} = require('../core/feedbacks');
const { compressFeedbackPhoto } = require('../infrastructure/imaging/feedback-photo');

function matchesMagicBytes(buffer, mimeType) {
  if (!buffer || !buffer.length) {
    return false;
  }

  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }

  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }

  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP';
  }

  return false;
}

function decodeImageBase64(imageBase64) {
  const raw = String(imageBase64 || '');
  if (!raw || /data:|,/.test(raw)) {
    throw new HttpError(422, 'Invalid image data.', { code: 'invalid_image' });
  }

  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) {
    throw new HttpError(422, 'Invalid image data.', { code: 'invalid_image' });
  }

  return buffer;
}

function toPublicItem(item) {
  if (!item) {
    return null;
  }

  return {
    id: item.id,
    name: item.name,
    category: item.category,
    country: item.country,
    place: item.place || '',
    photo: item.photo || '',
    comment: item.comment
  };
}

class FeedbacksService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.photoStorage = options.photoStorage || null;
    this.compressPhoto = options.compressPhoto || compressFeedbackPhoto;
  }

  async list(query = {}) {
    const { total, items } = await this.repository.list(query);
    return paginatedEnvelope({
      items,
      total,
      page: query.page,
      perPage: query.perPage
    });
  }

  async getById(id) {
    const item = await this.repository.findById(id);
    if (!item) {
      throw new HttpError(404, 'Feedback not found.');
    }
    return item;
  }

  async create(input) {
    const created = await this.repository.create({
      name: input.name,
      category: input.category,
      country: input.country,
      place: input.place,
      comment: input.comment,
      active: input.active,
      photo: ''
    });

    if (!input.photo) {
      return created;
    }

    try {
      const photo = await this.savePhoto(created.id, input.photo, created.photo);
      return this.repository.update(created.id, { photo });
    } catch (error) {
      await this.repository.delete(created.id);
      throw error;
    }
  }

  async update(id, input) {
    const current = await this.getById(id);
    const fields = {};

    if (Object.prototype.hasOwnProperty.call(input, 'name')) {
      fields.name = input.name;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'category')) {
      fields.category = input.category;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'country')) {
      fields.country = input.country;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'place')) {
      fields.place = input.place;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'comment')) {
      fields.comment = input.comment;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'active')) {
      fields.active = input.active;
    }

    if (input.photo === null) {
      if (current.photo && this.photoStorage && typeof this.photoStorage.delete === 'function') {
        try {
          await this.photoStorage.delete(current.photo);
        } catch (_error) {
          // best-effort cleanup
        }
      }
      fields.photo = '';
    } else if (input.photo) {
      fields.photo = await this.savePhoto(current.id, input.photo, current.photo);
    }

    return this.repository.update(id, fields);
  }

  async setActive(id, active) {
    await this.getById(id);
    return this.repository.update(id, { active: Boolean(active) });
  }

  async remove(id) {
    const current = await this.getById(id);
    await this.repository.delete(id);

    if (current.photo && this.photoStorage && typeof this.photoStorage.delete === 'function') {
      try {
        await this.photoStorage.delete(current.photo);
      } catch (_error) {
        // best-effort cleanup
      }
    }

    return { deleted: true, id: current.id };
  }

  async listPublic({ country }) {
    const items = await this.repository.listPublic({ country });
    return {
      success: true,
      data: {
        country,
        items: items.map(toPublicItem)
      }
    };
  }

  async savePhoto(feedbackId, photo, previousUrl) {
    if (!this.photoStorage || typeof this.photoStorage.write !== 'function') {
      throw new HttpError(503, 'Feedback photo storage is not available.');
    }

    const mimeType = String(photo.mimeType || 'image/jpeg').trim().toLowerCase();
    const ext = FEEDBACK_PHOTO_MIME_TYPES[mimeType];
    if (!ext) {
      throw new HttpError(422, 'Unsupported image type. Use PNG, JPEG, or WebP.', {
        code: 'invalid_mime'
      });
    }

    const buffer = decodeImageBase64(photo.imageBase64);
    if (buffer.length > MAX_FEEDBACK_PHOTO_BYTES) {
      throw new HttpError(422, 'Image must be smaller than 3 MB.', { code: 'image_too_large' });
    }

    if (!matchesMagicBytes(buffer, mimeType)) {
      throw new HttpError(422, 'Invalid image data.', { code: 'invalid_image' });
    }

    let compressed;
    try {
      compressed = await this.compressPhoto(buffer);
    } catch (_error) {
      throw new HttpError(422, 'Invalid image data.', { code: 'invalid_image' });
    }

    let photoUrl;
    try {
      photoUrl = await this.photoStorage.write({
        feedbackId,
        ext: compressed.ext || ext,
        buffer: compressed.buffer
      });
    } catch (_error) {
      throw new HttpError(500, 'Failed to save feedback photo.', { code: 'upload_failed' });
    }

    if (previousUrl && typeof this.photoStorage.delete === 'function') {
      try {
        await this.photoStorage.delete(previousUrl);
      } catch (_error) {
        // best-effort cleanup
      }
    }

    return photoUrl;
  }
}

module.exports = {
  FeedbacksService
};
