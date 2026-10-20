const { resolveLifeStage } = require('../core/life-stage');
const { allowedLifeStages } = require('../core/life-stage-lines');
const { TtlCache } = require('../infrastructure/cache/ttl-cache');
const { HttpError } = require('../core/http-error');
const { canonicalFlavorKey } = require('../core/flavors');

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

  // Line of each recipe key and the lines with a published recipe, per market, kept for a minute.
  async recipeLines(market) {
    if (!this.recipeLinesRepository || typeof this.recipeLinesRepository.listRecipeLines !== 'function') {
      return null;
    }
    let lines = this.cache.get('recipe-lines');
    if (!lines) {
      lines = this.cache.set('recipe-lines', await this.recipeLinesRepository.listRecipeLines(), PUBLISHED_LINES_TTL_MS);
    }
    return lines[String(market || '').toUpperCase()] || { lineByKey: {}, publishedLines: new Set() };
  }

  async publishedLines(market) {
    const lines = await this.recipeLines(market);
    return lines ? lines.publishedLines : null;
  }

  // Refuses a selection where a pet holds a recipe outside its allowed line, or mixes lines, listing only the
  // failing pets (design decision 4). Each entry: { pet_id, life_stage, allowed_life_stages, flavors }.
  async assertWithinLines(entries, market) {
    const lines = await this.recipeLines(market);
    if (!lines) {
      return;
    }
    const failing = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const allowed = Array.isArray(entry.allowed_life_stages) ? entry.allowed_life_stages : ['adult'];
      const rejected = [...new Set((entry.flavors || []).map((flavor) => canonicalFlavorKey(flavor) || String(flavor)))]
        .filter((key) => key && !allowed.includes(lines.lineByKey[key] || 'adult'));
      if (rejected.length > 0) {
        failing.push({
          pet_id: String(entry.pet_id || ''),
          life_stage: entry.life_stage ?? null,
          allowed_life_stages: allowed,
          rejected_flavors: rejected
        });
      }
    }
    if (failing.length > 0) {
      throw new HttpError(422, 'Some recipes are outside the life-stage line of their pet.', {
        code: 'recipe_life_stage_mismatch',
        pets: failing
      });
    }
  }

  // Checkout check over a saved plan: account pets age from their records.
  async assertPlanWithinLines({ planSelection, market, userId, petsRepository }) {
    if (!(await this.recipeLines(market))) {
      return;
    }
    const plan = planSelection && typeof planSelection === 'object' ? planSelection : {};
    const pets = (Array.isArray(plan.pets) ? plan.pets : []).filter((pet) => pet && pet.enabled !== false);
    const stages = await this.stagesById(petsRepository, userId, market);
    const unknown = pets.filter((pet) => !stages.has(petId(pet)));
    const annotated = unknown.length > 0 ? await this.annotate(unknown, market) : [];
    const fromPlan = new Map(annotated.map((pet) => [petId(pet), pet]));
    const entries = pets.map((pet) => {
      const stage = stages.get(petId(pet)) || fromPlan.get(petId(pet)) || {};
      const flavors = Array.isArray(pet.selected_flavors) ? pet.selected_flavors : [];
      const weights = Array.isArray(pet.flavor_weights) ? pet.flavor_weights : [];
      return {
        pet_id: petId(pet),
        life_stage: stage.life_stage,
        allowed_life_stages: stage.allowed_life_stages,
        flavors: flavors.filter((_flavor, index) => weights[index] == null || Number(weights[index]) > 0)
      };
    });
    await this.assertWithinLines(entries, market);
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
