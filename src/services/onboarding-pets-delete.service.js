const { HttpError } = require('../core/http-error');

class OnboardingPetDeleteService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.findPet = typeof options.findPet === 'function' ? options.findPet : null;
    this.petPhotoStorage = options.petPhotoStorage || null;
  }

  async deletePet({ userId, petId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pet delete repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const existing = this.findPet ? await this.findPet(userId, petId) : null;
    const deletedAt = new Date().toISOString();
    const result = await this.repository.deletePet(userId, petId, deletedAt);
    if (!result) {
      throw new HttpError(404, 'Pet not found.', { code: 'pet_not_found' });
    }

    const imageUrl = existing && String(existing.image_url || '').trim();
    if (imageUrl && this.petPhotoStorage && typeof this.petPhotoStorage.delete === 'function') {
      try {
        await this.petPhotoStorage.delete(imageUrl);
      } catch (_error) {
        // best-effort cleanup
      }
    }

    return {
      success: true,
      data: result
    };
  }
}

module.exports = {
  OnboardingPetDeleteService
};
