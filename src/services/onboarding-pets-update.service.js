const { HttpError } = require('../core/http-error');
const { MARKETS, formatPetForMarket } = require('../core/market');

const AGE_FIELDS = ['age_years', 'age_months', 'birth_date'];

function ageOf(pet = {}) {
  return {
    age_years: Number(pet.age_years || 0),
    age_months: Number(pet.age_months || 0),
    birth_date: pet.birth_date || null
  };
}

class OnboardingPetUpdateService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.ageChangesRepository = options.ageChangesRepository || null;
    this.lifeStageService = options.lifeStageService || null;
    this.now = options.now || (() => new Date());
  }

  async stageOf(pet, market) {
    if (!this.lifeStageService || !pet) {
      return null;
    }
    const result = await this.lifeStageService.resolve(pet, market.country);
    return result.lifeStage;
  }

  async updatePet({ userId, petId, payload, market = MARKETS.US }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pet update repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const { change_source: changeSource, ...fields } = payload || {};
    const touchesAge = AGE_FIELDS.some((field) => fields[field] !== undefined);
    const current = touchesAge && typeof this.repository.findPet === 'function'
      ? await this.repository.findPet(userId, petId)
      : null;
    if (touchesAge && !current && typeof this.repository.findPet === 'function') {
      throw new HttpError(404, 'Pet not found.', { code: 'pet_not_found' });
    }

    const before = current ? ageOf(current) : null;
    const after = current ? ageOf({ ...current, ...fields }) : null;
    const ageChanged = Boolean(before) && (before.age_years !== after.age_years || before.age_months !== after.age_months);
    const birthDateChanged = Boolean(before) && before.birth_date !== after.birth_date;
    // age_recorded_at only moves when the registered age itself changes value (L-02).
    const update = ageChanged ? { ...fields, age_recorded_at: this.now() } : fields;

    const pet = await this.repository.updatePet(userId, petId, update);
    if (!pet) {
      throw new HttpError(404, 'Pet not found.', { code: 'pet_not_found' });
    }

    if ((ageChanged || birthDateChanged) && this.ageChangesRepository) {
      await this.ageChangesRepository.record({
        petId: String(petId),
        userId,
        oldAgeYears: before.age_years,
        oldAgeMonths: before.age_months,
        oldBirthDate: before.birth_date,
        newAgeYears: after.age_years,
        newAgeMonths: after.age_months,
        newBirthDate: after.birth_date,
        oldLifeStage: await this.stageOf(current, market),
        newLifeStage: await this.stageOf(pet, market),
        source: changeSource || 'onboarding'
      });
    }

    return {
      success: true,
      data: {
        country: market.country,
        pet: formatPetForMarket(pet, market)
      }
    };
  }
}

module.exports = {
  OnboardingPetUpdateService
};
