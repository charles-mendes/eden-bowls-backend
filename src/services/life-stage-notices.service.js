const { HttpError } = require('../core/http-error');
const { allowedLifeStages, isOutsideAllowed, planLinesForPet, planPetIds } = require('../core/life-stage-lines');
const { lifeStagePayload, marketFromStripeAccount } = require('./life-stage.service');

function petId(pet = {}) {
  return String(pet.pet_id || pet.id || '').trim();
}

// Meu plano notice: whether each pet's plan line left its allowed line, and the customer-side state of that
// transition (design decision 7). The plan never changes here.
class LifeStageNoticesService {
  constructor(options = {}) {
    this.lifeStageService = options.lifeStageService;
    this.noticesRepository = options.noticesRepository || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.petsRepository = options.petsRepository || null;
    this.now = options.now || (() => new Date());
  }

  // Per ledger row id, the report of every pet on that plan.
  async reportForUser(userId, ledgerRows) {
    const rows = (Array.isArray(ledgerRows) ? ledgerRows : []).filter(Boolean);
    const reports = new Map();
    if (rows.length === 0 || !this.lifeStageService) {
      return reports;
    }
    const data = this.petsRepository && userId ? await this.petsRepository.listPets(userId) : { pets: [] };
    const accountPets = new Map((Array.isArray(data && data.pets) ? data.pets : []).map((pet) => [petId(pet), pet]));
    const at = this.now();

    for (const row of rows) {
      const market = marketFromStripeAccount(row.stripeAccount);
      const lines = (await this.lifeStageService.recipeLines(market)) || { lineByKey: {}, publishedLines: new Set(), publishedRecipes: [] };
      const petIds = planPetIds(row.planSelection);
      const pets = petIds.map((id) => accountPets.get(id)).filter(Boolean);
      const results = await this.lifeStageService.resolveMany(pets, market);
      const entries = [];
      for (const [index, pet] of pets.entries()) {
        const result = results[index];
        const allowed = allowedLifeStages(result.lifeStage, lines.publishedLines);
        const planLines = planLinesForPet(row.planSelection, petId(pet), lines.lineByKey);
        const mismatch = isOutsideAllowed(planLines, allowed);
        const entry = {
          pet_id: petId(pet),
          ...lifeStagePayload(result, allowed),
          plan_lines: planLines,
          life_stage_mismatch: mismatch,
          suggested_recipes: mismatch
            ? (lines.publishedRecipes || []).filter((recipe) => allowed.includes(recipe.life_stage)).map(({ key, label }) => ({ key, label }))
            : [],
          life_stage_notice: null
        };
        if (mismatch && this.noticesRepository) {
          const toLine = allowed[0];
          const announced = pet.life_stage_announced_stage && pet.life_stage_announced_stage === toLine
            ? { at: pet.life_stage_announced_at ? new Date(pet.life_stage_announced_at) : at, via: 'announcement' }
            : null;
          await this.noticesRepository.ensureDetected({
            subscriptionId: row.id,
            petId: petId(pet),
            fromLine: planLines.join(','),
            toLine,
            at,
            notified: announced
          });
        }
        entries.push(entry);
      }
      reports.set(row.id, entries);
    }

    if (this.noticesRepository) {
      const notices = await this.noticesRepository.listForSubscriptions(rows.map((row) => row.id));
      for (const row of rows) {
        for (const entry of reports.get(row.id) || []) {
          if (!entry.life_stage_mismatch) continue;
          const notice = notices.find((item) => Number(item.subscription_id) === Number(row.id)
            && String(item.pet_id) === entry.pet_id
            && item.from_line === entry.plan_lines.join(',')
            && item.to_line === entry.allowed_life_stages[0]);
          if (notice) {
            entry.life_stage_notice = {
              open: !notice.dismissed_at && !notice.resolved_at,
              from_line: notice.from_line,
              to_line: notice.to_line,
              detected_at: notice.detected_at ? new Date(notice.detected_at).toISOString() : null,
              notified_via: notice.notified_via || null
            };
          }
        }
      }
    }
    return reports;
  }

  async dismiss({ userId, subscriptionId, petId: dismissedPetId }) {
    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }
    if (!subscriptionId || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }
    if (!this.ledgerRepository || !this.noticesRepository) {
      throw new HttpError(503, 'Life stage notices are not available.');
    }
    const row = await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
    if (!row) {
      throw new HttpError(404, 'Subscription not found.', { code: 'subscription_not_found' });
    }
    const dismissed = await this.noticesRepository.dismissOpen(row.id, String(dismissedPetId || ''), this.now());
    return { success: true, data: { subscription_id: subscriptionId, pet_id: String(dismissedPetId || ''), dismissed: dismissed > 0 } };
  }

  async resolveAfterCommit(row) {
    if (this.noticesRepository && row && row.id) {
      await this.noticesRepository.resolveOpen(row.id, this.now());
    }
  }
}

module.exports = {
  LifeStageNoticesService
};
