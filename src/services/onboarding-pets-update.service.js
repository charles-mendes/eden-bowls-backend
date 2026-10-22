const { HttpError } = require('../core/http-error');
const { MARKETS, formatPetForMarket } = require('../core/market');
const { allowedLifeStages, isOutsideAllowed, planLinesForPet } = require('../core/life-stage-lines');

const DELIVERING_STATUSES = new Set(['active', 'trialing', 'past_due']);

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
    this.ledgerRepository = options.ledgerRepository || null;
    this.recipeLinesRepository = options.recipeLinesRepository || null;
    this.noticesRepository = options.noticesRepository || null;
    this.now = options.now || (() => new Date());
  }

  // Active plans of this pet that the new age moves outside its allowed line, in either direction (L-21).
  async affectedSubscriptions(userId, petId, before, after) {
    if (!this.lifeStageService || !this.ledgerRepository || !this.recipeLinesRepository) {
      return [];
    }
    const rows = await this.ledgerRepository.listByUserId(userId);
    const plans = (Array.isArray(rows) ? rows : []).filter((row) => DELIVERING_STATUSES.has(String(row.status || '')));
    if (plans.length === 0) {
      return [];
    }
    const catalog = await this.recipeLinesRepository.listRecipeLines();
    const affected = [];
    for (const row of plans) {
      const market = String(row.stripeAccount || '').toLowerCase() === 'br' ? 'BR' : 'US';
      const { lineByKey = {}, publishedLines = new Set() } = catalog[market] || {};
      const planLines = planLinesForPet(row.planSelection, petId, lineByKey);
      if (planLines.length === 0) {
        continue;
      }
      const [stageBefore, stageAfter] = await Promise.all([
        this.lifeStageService.resolve(before, market),
        this.lifeStageService.resolve(after, market)
      ]);
      const allowedBefore = allowedLifeStages(stageBefore.lifeStage, publishedLines);
      const allowedAfter = allowedLifeStages(stageAfter.lifeStage, publishedLines);
      if (isOutsideAllowed(planLines, allowedAfter) && !isOutsideAllowed(planLines, allowedBefore)) {
        affected.push({
          id: row.id,
          subscription_id: String(row.stripeSubscriptionId || ''),
          market,
          plan_line: planLines.join(','),
          life_stage: stageAfter.lifeStage,
          allowed_life_stages: allowedAfter
        });
      }
    }
    return affected;
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

    const { change_source: changeSource, confirm_life_stage_change: confirmed, ...fields } = payload || {};
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

    const affected = ageChanged || birthDateChanged
      ? await this.affectedSubscriptions(userId, String(petId), current, { ...current, ...update })
      : [];
    if (affected.length > 0 && confirmed !== true) {
      throw new HttpError(409, 'This age change puts an active plan outside the pet\'s recipe line. Confirm to save.', {
        code: 'life_stage_change_requires_confirmation',
        life_stage: affected[0].life_stage,
        affected_subscriptions: affected.map(({ id: _ledgerId, ...item }) => item)
      });
    }

    const pet = await this.repository.updatePet(userId, petId, update);
    if (!pet) {
      throw new HttpError(404, 'Pet not found.', { code: 'pet_not_found' });
    }

    // The confirmation already told the tutor: the notice opens, but no stage-change email goes out.
    if (affected.length > 0 && this.noticesRepository) {
      const at = this.now();
      for (const item of affected) {
        await this.noticesRepository.upsertNotified({
          subscriptionId: item.id,
          petId: String(petId),
          fromLine: item.plan_line,
          toLine: item.allowed_life_stages[0],
          via: 'manual_correction',
          at
        });
      }
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
