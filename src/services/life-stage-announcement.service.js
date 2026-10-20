const { allowedLifeStages, isOutsideAllowed, planLinesForPet, planPetIds } = require('../core/life-stage-lines');
const { firstNameFrom } = require('../core/email/mail-context');

const ANNOUNCED_STAGES = ['puppy', 'senior'];

// Launch announcement (customer-life-stage-notice, design decision 9): per market, the opted-in customers whose
// delivering plans include a puppy or a senior not yet named and outside its allowed line, with the recipes of
// that dog's stage. A dog already on its line is left out.
class LifeStageAnnouncementService {
  constructor(options = {}) {
    this.lifeStageService = options.lifeStageService;
    this.repository = options.repository;
  }

  // Stages with a published recipe in the market: only those are announced.
  async announcedStages(market) {
    const lines = await this.lifeStageService.recipeLines(market);
    const published = lines && lines.publishedLines ? lines.publishedLines : new Set();
    return { lines, stages: ANNOUNCED_STAGES.filter((stage) => published.has(stage)) };
  }

  // One entry per customer, each dog named once even when it sits on two plans.
  async recipients(market) {
    const { lines, stages } = await this.announcedStages(market);
    if (stages.length === 0) {
      return [];
    }
    const recipes = (stage) => (lines.publishedRecipes || [])
      .filter((recipe) => recipe.life_stage === stage)
      .map((recipe) => String(recipe.label || recipe.key));

    const candidates = await this.repository.listCandidates(String(market).toLowerCase());
    const byUser = new Map();
    const named = new Set();
    for (const plan of candidates) {
      const onPlan = new Set(planPetIds(plan.planSelection));
      const pets = plan.pets.filter((pet) => onPlan.has(pet.id) && !named.has(pet.id));
      const results = await this.lifeStageService.resolveMany(pets, market);
      pets.forEach((pet, index) => {
        const stage = results[index] && results[index].lifeStage;
        if (!stages.includes(stage)) return;
        const allowed = allowedLifeStages(stage, lines.publishedLines);
        if (!isOutsideAllowed(planLinesForPet(plan.planSelection, pet.id, lines.lineByKey), allowed)) return;
        named.add(pet.id);
        const recipient = byUser.get(plan.userId) || {
          userId: plan.userId,
          email: plan.email,
          firstName: firstNameFrom({ address: plan.address }),
          dogs: []
        };
        recipient.dogs.push({
          petId: pet.id,
          petName: pet.name,
          stage,
          subscriptionRowId: plan.id,
          subscriptionId: plan.stripeSubscriptionId,
          recipes: recipes(stage)
        });
        byUser.set(plan.userId, recipient);
      });
    }
    return [...byUser.values()].filter((recipient) => recipient.email);
  }
}

module.exports = {
  ANNOUNCED_STAGES,
  LifeStageAnnouncementService
};
