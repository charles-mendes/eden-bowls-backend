const { HttpError } = require('../core/http-error');
const { MARKETS, formatPetForMarket } = require('../core/market');

function petIdentity(pet = {}) {
  return String(pet.pet_id || pet.id || pet.local_id || '').trim();
}

function mapPlanPetToRecord(pet = {}) {
  const id = petIdentity(pet);
  const name = String(pet.pet_name || pet.name || '').trim();
  if (!id && !name) {
    return null;
  }

  const ageYears = Number(pet.age_years || pet.age || 0);
  const ageMonths = Number(pet.age_months || 0);
  const weight = Number(pet.weight || pet.weight_input || 0);
  const weightUnit = pet.weight_unit === 'lb' ? 'lb' : 'kg';

  return {
    id: id || name,
    name: name || id,
    breed: String(pet.breed || ''),
    age_years: Number.isFinite(ageYears) ? ageYears : 0,
    age_months: Number.isFinite(ageMonths) ? ageMonths : 0,
    age: Number.isFinite(ageYears) ? ageYears : 0,
    weight_input: Number.isFinite(weight) ? weight : 0,
    weight_unit: weightUnit,
    weight: Number.isFinite(weight) ? weight : 0,
    size: String(pet.size || ''),
    activity_level: String(pet.activity_level || ''),
    pet_condition: String(pet.pet_condition || pet.weight_condition || ''),
    neutered: Boolean(pet.neutered),
    image_url: String(pet.image_url || '')
  };
}

function collectPlanSelectionPets(planSelection) {
  const plan = planSelection && planSelection.plan_selection ? planSelection.plan_selection : planSelection;
  const pets = plan && Array.isArray(plan.pets) ? plan.pets : [];
  return pets.map(mapPlanPetToRecord).filter(Boolean);
}

function collectLedgerPets(rows = []) {
  const byId = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    collectPlanSelectionPets(row && (row.planSelection || row.plan_selection)).forEach((pet) => {
      byId.set(String(pet.id), pet);
    });

    const snapshot = (row && (row.petsSnapshot || row.pets_snapshot)) || {};
    const snapshotPets = Array.isArray(snapshot.pets) ? snapshot.pets : [];
    snapshotPets.forEach((pet) => {
      const mapped = mapPlanPetToRecord(pet);
      if (mapped && mapped.id && !byId.has(String(mapped.id))) {
        byId.set(String(mapped.id), mapped);
      }
    });

    const ids = Array.isArray(snapshot.pet_ids) ? snapshot.pet_ids.map(String) : [];
    const names = Array.isArray(snapshot.pets_names) ? snapshot.pets_names : [];
    ids.forEach((id, index) => {
      if (!id || byId.has(id)) {
        return;
      }
      const mapped = mapPlanPetToRecord({
        pet_id: id,
        pet_name: names[index] || ''
      });
      if (mapped) {
        byId.set(id, mapped);
      }
    });
  }

  return [...byId.values()];
}

function mapRecordToSyncPayload(pet) {
  return {
    pet_id: pet.id,
    local_id: pet.id,
    name: pet.name,
    breed: pet.breed,
    age_years: pet.age_years,
    age_months: pet.age_months,
    weight: pet.weight,
    weight_unit: pet.weight_unit,
    size: pet.size || 'medium',
    activity_level: pet.activity_level || 'medium',
    pet_condition: pet.pet_condition || 'ideal',
    neutered: pet.neutered
  };
}

class OnboardingPetsService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.planSelectionRepository = options.planSelectionRepository || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.petsSyncRepository = options.petsSyncRepository || null;
  }

  async collectFallbackPets(userId) {
    const byId = new Map();

    if (this.planSelectionRepository && typeof this.planSelectionRepository.getPlanSelection === 'function') {
      const planSelection = await this.planSelectionRepository.getPlanSelection(userId);
      collectPlanSelectionPets(planSelection).forEach((pet) => {
        byId.set(String(pet.id), pet);
      });
    }

    if (this.ledgerRepository && typeof this.ledgerRepository.listByUserId === 'function') {
      const rows = await this.ledgerRepository.listByUserId(userId);
      collectLedgerPets(rows).forEach((pet) => {
        if (!byId.has(String(pet.id))) {
          byId.set(String(pet.id), pet);
        }
      });
    }

    return [...byId.values()];
  }

  async persistFallbackPets(userId, pets) {
    if (!this.petsSyncRepository || typeof this.petsSyncRepository.syncPets !== 'function' || pets.length === 0) {
      return pets;
    }

    try {
      await this.petsSyncRepository.syncPets(userId, pets.map(mapRecordToSyncPayload));
      const data = await this.repository.listPets(userId);
      if (Array.isArray(data.pets) && data.pets.length > 0) {
        return data.pets;
      }
    } catch (_error) {
      // Return in-memory fallback when repair insert fails.
    }

    return pets;
  }

  async listPets({ userId, market = MARKETS.US }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pets repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.listPets(userId);
    let pets = Array.isArray(data.pets) ? data.pets : [];

    if (pets.length === 0) {
      const fallbackPets = await this.collectFallbackPets(userId);
      pets = await this.persistFallbackPets(userId, fallbackPets);
    }

    return {
      success: true,
      data: {
        country: market.country,
        currency: market.currency,
        pets: pets.map((pet) => formatPetForMarket(pet, market))
      }
    };
  }
}

module.exports = {
  OnboardingPetsService
};
