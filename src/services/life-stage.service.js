const { resolveLifeStage } = require('../core/life-stage');
const { allowedLifeStages } = require('../core/life-stage-lines');
const { TtlCache } = require('../infrastructure/cache/ttl-cache');

const PUBLISHED_LINES_TTL_MS = 60 * 1000;

// The fields every payload carries for a dog (pet-life-stage spec).
function lifeStagePayload(result = {}, allowed) {
  return {
    life_stage: result.lifeStage ?? null,
    life_stage_next_at: result.lifeStageNextAt ?? null,
    size_class: result.sizeClass ?? null,
    current_age_years: result.currentAgeYears ?? null,
    current_age_months: result.currentAgeMonths ?? null,
    ...(allowed ? { allowed_life_stages: allowed } : {})
  };
}

function petId(pet = {}) {
  return String(pet.pet_id || pet.id || '').trim();
}

function marketFromStripeAccount(account) {
  return String(account || '').trim().toLowerCase() === 'br' ? 'BR' : 'US';
}

// The single source of a dog's stage: every API payload asks this service, never the client.
class LifeStageService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.recipeLinesRepository = options.recipeLinesRepository || null;
    this.cache = options.cache || new TtlCache();
    this.now = options.now || (() => new Date());
  }

  // Lines with at least one published recipe in the market, read from the catalog and kept for a minute.
  async publishedLines(market) {
    if (!this.recipeLinesRepository || typeof this.recipeLinesRepository.listRecipeLines !== 'function') {
      return null;
    }
    let lines = this.cache.get('recipe-lines');
    if (!lines) {
      lines = this.cache.set('recipe-lines', await this.recipeLinesRepository.listRecipeLines(), PUBLISHED_LINES_TTL_MS);
    }
    const entry = lines[String(market || '').toUpperCase()];
    return entry ? entry.publishedLines : new Set();
  }

  // The lines a dog may buy (design decision 4), or undefined when the catalog is not wired.
  async allowedFor(lifeStage, market) {
    const published = await this.publishedLines(market);
    return published ? allowedLifeStages(lifeStage, published) : undefined;
  }

  async resolve(pet, market) {
    const { limits, breedClasses } = await this.repository.forMarket(market);
    return resolveLifeStage(pet || {}, { limits, breedClasses, now: this.now() });
  }

  async resolveMany(pets, market) {
    const { limits, breedClasses } = await this.repository.forMarket(market);
    const now = this.now();
    return (Array.isArray(pets) ? pets : []).map((pet) => resolveLifeStage(pet || {}, { limits, breedClasses, now }));
  }

  // Adds the stage fields to each pet. `source(pet)` picks the record to age from (the account pet when known).
  async annotate(pets, market, source = (pet) => pet) {
    const list = Array.isArray(pets) ? pets : [];
    const results = await this.resolveMany(list.map((pet, index) => source(pet, index) || pet), market);
    const published = await this.publishedLines(market);
    return list.map((pet, index) => ({
      ...pet,
      ...lifeStagePayload(results[index], published ? allowedLifeStages(results[index].lifeStage, published) : undefined)
    }));
  }

  // Stage fields of the account pets by id, for payloads that only carry pet ids or snapshots.
  async stagesById(petsRepository, userId, market) {
    if (!petsRepository || typeof petsRepository.listPets !== 'function' || !userId) {
      return new Map();
    }
    const data = await petsRepository.listPets(userId);
    const pets = Array.isArray(data && data.pets) ? data.pets : [];
    const results = await this.resolveMany(pets, market);
    const published = await this.publishedLines(market);
    return new Map(pets.map((pet, index) => [
      petId(pet),
      lifeStagePayload(results[index], published ? allowedLifeStages(results[index].lifeStage, published) : undefined)
    ]));
  }
}

module.exports = {
  LifeStageService,
  lifeStagePayload,
  marketFromStripeAccount
};
