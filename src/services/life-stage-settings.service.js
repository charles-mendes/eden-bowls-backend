const { HttpError } = require('../core/http-error');
const { resolveLifeStage } = require('../core/life-stage');
const { parseLifeStageBreed, parseLifeStageLimits } = require('../core/life-stage-settings');

function actorIdOf(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

function limitsOf(sizeClasses) {
  const limits = {};
  for (const row of sizeClasses) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  return limits;
}

function breedClassesOf(breeds) {
  const classes = new Map();
  for (const breed of breeds) {
    if (!breed.active) continue;
    for (const name of [breed.namePtNormalized, breed.nameEnNormalized]) {
      if (name && !classes.has(name)) classes.set(name, breed.sizeClass);
    }
  }
  return classes;
}

// Life-stage limits and giant breeds per market, edited by the veterinarian (nutrition-parameters, design
// decision 3): direct edits recorded in the admin audit log, and a preview that changes nothing.
class LifeStageSettingsService {
  constructor({ repository, auditRepository = null, dataSource = null, now = () => new Date() } = {}) {
    this.repository = repository;
    this.auditRepository = auditRepository;
    this.dataSource = dataSource;
    this.now = now;
  }

  async overview(market) {
    return this.repository.listMarket(market);
  }

  async inTransaction(work) {
    if (this.dataSource && typeof this.dataSource.transaction === 'function') {
      return this.dataSource.transaction(work);
    }
    return work(this.dataSource);
  }

  async audit(manager, actor, action, metadata) {
    if (this.auditRepository && typeof this.auditRepository.createIn === 'function') {
      await this.auditRepository.createIn(manager, {
        actorUserId: actorIdOf(actor),
        actorEmail: (actor && actor.email) || null,
        action,
        metadata
      });
    }
  }

  async updateLimits(market, input, actor = {}) {
    const limits = parseLifeStageLimits(input);
    const before = limitsOf((await this.repository.listMarket(market)).sizeClasses);
    await this.inTransaction(async (manager) => {
      await this.repository.saveLimits(market, limits, actorIdOf(actor), manager);
      await this.audit(manager, actor, 'life_stage.limits.update', {
        market,
        before: Object.fromEntries(Object.keys(limits).map((key) => [key, before[key] || null])),
        after: limits
      });
    });
    return this.repository.listMarket(market);
  }

  async createBreed(market, input, actor = {}) {
    const breed = parseLifeStageBreed(input);
    return this.inTransaction(async (manager) => {
      const created = await this.repository.createBreed(market, breed, actorIdOf(actor), manager);
      await this.audit(manager, actor, 'life_stage.breed.update', { market, breed_id: created && created.id, before: null, after: created });
      return created;
    });
  }

  // Edits or deactivates a breed of the market; a breed of another market is not found.
  async updateBreed(market, id, input, actor = {}) {
    const changes = parseLifeStageBreed(input, { partial: true });
    const current = await this.repository.findBreed(id);
    if (!current || current.market !== market) {
      throw new HttpError(404, 'Life-stage breed not found.', { code: 'life_stage_breed_not_found' });
    }
    return this.inTransaction(async (manager) => {
      const updated = await this.repository.updateBreed(id, changes, actorIdOf(actor), manager);
      await this.audit(manager, actor, 'life_stage.breed.update', { market, breed_id: current.id, before: current, after: updated });
      return updated;
    });
  }

  /**
   * How many pets with a delivering plan in the market would change stage with the proposed limits (and,
   * optionally, one breed added or changed), counted per transition. Nothing is written.
   */
  async preview(market, stripeAccount, input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const proposedLimits = source.limits === undefined ? {} : parseLifeStageLimits(source.limits);
    const stored = await this.repository.listMarket(market);
    const currentLimits = limitsOf(stored.sizeClasses);
    const currentBreeds = stored.breeds;

    let proposedBreeds = currentBreeds;
    if (source.breed !== undefined) {
      const breedInput = source.breed && typeof source.breed === 'object' ? source.breed : {};
      const id = breedInput.id == null ? null : Number(breedInput.id);
      if (id) {
        const existing = currentBreeds.find((breed) => breed.id === id);
        if (!existing) {
          throw new HttpError(404, 'Life-stage breed not found.', { code: 'life_stage_breed_not_found' });
        }
        const changes = parseLifeStageBreed(breedInput, { partial: true });
        proposedBreeds = currentBreeds.map((breed) => (breed.id === id ? { ...breed, ...changes } : breed));
      } else {
        // A new breed goes first so it wins over a listed name, as it would once saved under its own row.
        proposedBreeds = [{ id: null, ...parseLifeStageBreed(breedInput) }, ...currentBreeds];
      }
    }

    const now = this.now();
    const current = { limits: currentLimits, breedClasses: breedClassesOf(currentBreeds), now };
    const proposed = {
      limits: { ...currentLimits, ...proposedLimits },
      breedClasses: breedClassesOf(proposedBreeds),
      now
    };
    const pets = await this.repository.listSubscribedPets(stripeAccount);
    const counts = new Map();
    for (const pet of pets) {
      const from = resolveLifeStage(pet, current).lifeStage;
      const to = resolveLifeStage(pet, proposed).lifeStage;
      if (from === to) continue;
      const key = `${from}→${to}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const transitions = [...counts.entries()]
      .map(([key, count]) => {
        const [from, to] = key.split('→');
        return { from: from === 'null' ? null : from, to: to === 'null' ? null : to, count };
      })
      .sort((a, b) => b.count - a.count);
    return {
      market,
      pets_evaluated: pets.length,
      pets_changing: transitions.reduce((total, item) => total + item.count, 0),
      transitions
    };
  }
}

module.exports = {
  LifeStageSettingsService
};
