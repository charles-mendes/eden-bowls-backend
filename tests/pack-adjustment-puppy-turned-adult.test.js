const { MARKETS } = require('../src/core/market');
const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { listFallbackCatalogItems } = require('../src/core/plan-catalog-pricing');
const { LifeStageService } = require('../src/services/life-stage.service');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');
const { OnboardingPlanPreviewRepository } = require('../src/infrastructure/repositories/onboarding-plan-preview.repository');

// L-04, provisional until the nutritionist confirms: a puppy turned adult follows the senior keep-or-switch rule.
const NOW = new Date('2026-10-19T12:00:00Z');
const LINE_BY_KEY = { beef: 'adult', pork: 'adult', fish: 'adult', turkey: 'adult', 'puppy-chicken-pork': 'puppy', 'puppy-beef-chicken': 'puppy' };

function previewRepository() {
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  const lifeStageService = new LifeStageService({
    repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
    recipeLinesRepository: { listRecipeLines: async () => ({ BR: { lineByKey: LINE_BY_KEY, publishedLines: new Set(['adult', 'puppy']) } }) },
    now: () => NOW
  });
  const repository = new OnboardingPlanPreviewRepository({
    recommendationRepository: new OnboardingRecommendationRepository(null, { lifeStageService }),
    allowCatalogFallback: true
  });
  const base = listFallbackCatalogItems('BR');
  repository.loadCatalogItems = jest.fn(async () => [...base, ...base.filter((item) => item.flavor === 'beef').flatMap((item, index) => [
    { ...item, flavor: 'puppy-chicken-pork', flavor_label: 'Receita de Frango e Porco para Filhotes', aliases: [], variation_id: 9000 + index },
    { ...item, flavor: 'puppy-beef-chicken', flavor_label: 'Receita de Carne e Frango para Filhotes', aliases: [], variation_id: 9100 + index }
  ])]);
  return repository;
}

// Luna is now a 14-month-old medium adult whose plan still holds both puppy recipes.
const luna = { pet_id: 'p-luna', pet_name: 'Luna', size: 'medium', age_years: 1, age_months: 2, weight: 12, activity_level: 'medium' };
const puppyPlan = { pets: [{ pet_id: 'p-luna', selected_flavors: ['puppy-chicken-pork', 'puppy-beef-chicken'], flavor_weights: [5, 5] }] };

function edit(flavors) {
  return previewRepository().previewPlan(null, {
    subscription_term_months: 1,
    pets: [{ ...luna, enabled: true, selected_flavors: Object.keys(flavors), flavor_weights: Object.values(flavors) }]
  }, MARKETS.BR, { currentSelection: puppyPlan });
}

describe('puppy turned adult holding puppy recipes', () => {
  test('keeps the puppy recipes with new quantities', async () => {
    const result = await edit({ 'puppy-chicken-pork': 3, 'puppy-beef-chicken': 7 });
    expect(result.pets[0]).toMatchObject({ pet_id: 'p-luna', life_stage: 'adult', allowed_life_stages: ['adult'] });
  });

  test('drops one puppy recipe', async () => {
    const result = await edit({ 'puppy-chicken-pork': 10, 'puppy-beef-chicken': 0 });
    expect(result.catalog_pricing.line_items.map((item) => item.flavor)).toEqual(['puppy-chicken-pork']);
  });

  test('mixing a puppy recipe with an adult one is refused', async () => {
    await expect(edit({ 'puppy-chicken-pork': 5, beef: 5 })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'recipe_life_stage_mismatch', pets: [{ pet_id: 'p-luna', allowed_life_stages: ['adult'], rejected_flavors: ['puppy-chicken-pork'] }] }
    });
  });

  test('switches to the adult line', async () => {
    await expect(edit({ beef: 5, pork: 5 })).resolves.toBeTruthy();
  });
});
