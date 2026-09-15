const { HttpError } = require('../core/http-error');
const { MARKETS, formatPetForMarket } = require('../core/market');

const PET_PHOTO_MIME_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};
const MAX_PET_PHOTO_BYTES = 3 * 1024 * 1024;

function matchesMagicBytes(buffer, mimeType) {
  if (!buffer || buffer.length < 4) {
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

function presentImageUrl(value) {
  const url = String(value || '').trim();
  return url || null;
}

class OnboardingPetImageService {
  constructor(repository, petPhotoStorage) {
    this.repository = repository;
    this.petPhotoStorage = petPhotoStorage;
  }

  async requirePet(userId, petId) {
    if (!this.repository || typeof this.repository.findPet !== 'function') {
      throw new HttpError(503, 'Onboarding pet image repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const pet = await this.repository.findPet(userId, petId);
    if (!pet) {
      throw new HttpError(404, 'Pet not found.', { code: 'pet_not_found' });
    }

    return pet;
  }

  async uploadImage({ userId, petId, payload = {}, market = MARKETS.US }) {
    const pet = await this.requirePet(userId, petId);

    if (!this.petPhotoStorage || typeof this.petPhotoStorage.write !== 'function') {
      throw new HttpError(503, 'Pet photo storage is not available.');
    }

    const mimeType = String(payload.mimeType || 'image/jpeg').trim().toLowerCase();
    const ext = PET_PHOTO_MIME_TYPES[mimeType];
    if (!ext) {
      throw new HttpError(422, 'Unsupported image type. Use PNG, JPEG, or WebP.', {
        code: 'invalid_mime'
      });
    }

    const buffer = decodeImageBase64(payload.imageBase64);
    if (buffer.length > MAX_PET_PHOTO_BYTES) {
      throw new HttpError(422, 'Image must be smaller than 3 MB.', { code: 'image_too_large' });
    }

    if (!matchesMagicBytes(buffer, mimeType)) {
      throw new HttpError(422, 'Invalid image data.', { code: 'invalid_image' });
    }

    let imageUrl;
    try {
      imageUrl = await this.petPhotoStorage.write({ petId: pet.id, ext, buffer });
    } catch (_error) {
      throw new HttpError(500, 'Failed to save pet image.', { code: 'upload_failed' });
    }

    let updated;
    try {
      updated = await this.repository.setImageUrl(userId, petId, imageUrl);
      if (!updated) {
        throw new HttpError(404, 'Pet not found.', { code: 'pet_not_found' });
      }
    } catch (error) {
      if (typeof this.petPhotoStorage.delete === 'function') {
        try {
          await this.petPhotoStorage.delete(imageUrl);
        } catch (_cleanupError) {
          // ignore
        }
      }
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(500, 'Failed to save pet image.', { code: 'upload_failed' });
    }

    const previousUrl = presentImageUrl(pet.image_url);
    if (previousUrl && typeof this.petPhotoStorage.delete === 'function') {
      try {
        await this.petPhotoStorage.delete(previousUrl);
      } catch (_error) {
        // best-effort cleanup
      }
    }

    return {
      success: true,
      data: {
        country: market.country,
        pet: formatPetForMarket(updated, market),
        image_url: presentImageUrl(updated.image_url)
      }
    };
  }

  async deleteImage({ userId, petId, market = MARKETS.US }) {
    const pet = await this.requirePet(userId, petId);
    const updated = await this.repository.setImageUrl(userId, petId, null);
    if (!updated) {
      throw new HttpError(404, 'Pet not found.', { code: 'pet_not_found' });
    }

    const previousUrl = presentImageUrl(pet.image_url);
    if (previousUrl && this.petPhotoStorage && typeof this.petPhotoStorage.delete === 'function') {
      try {
        await this.petPhotoStorage.delete(previousUrl);
      } catch (_error) {
        // best-effort cleanup
      }
    }

    return {
      success: true,
      data: {
        country: market.country,
        pet: formatPetForMarket(updated, market),
        image_url: null
      }
    };
  }
}

module.exports = {
  OnboardingPetImageService,
  MAX_PET_PHOTO_BYTES
};
