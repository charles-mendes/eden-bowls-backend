const { MARKETS } = require('../src/core/market');
const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { listFallbackCatalogItems } = require('../src/core/plan-catalog-pricing');
const { buildPackAdjustment } = require('../src/core/pack-adjustment');
const { resolveProposedPlan } = require('../src/core/subscription-edit-plan');
const { LifeStageService } = require('../src/services/life-stage.service');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');
const { OnboardingPlanPreviewRepository } = require('../src/infrastructure/repositories/onboarding-plan-preview.repository');

const NOW = new Date('2026-10-19T12:00:00Z');
const LINE_BY_KEY = { beef: 'adult', pork: 'adult', fish: 'adult', turkey: 'adult', 'puppy-chicken-pork': 'puppy', 'senior-beef': 'senior', 'senior-chicken': 'senior' };

function lifeStageService() {
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  return new LifeStageService({
    repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
    recipeLinesRepository: { listRecipeLines: async () => ({ BR: { lineByKey: LINE_BY_KEY, publishedLines: new Set(['adult', 'puppy', 'senior']) } }) },
    now: () => NOW
  });
}

function catalog() {
  const base = listFallbackCatalogItems('BR');
  const beef = base.filter((item) => item.flavor === 'beef');
  return [...base, ...beef.flatMap((item, index) => [
    { ...item, flavor: 'puppy-chicken-pork', flavor_label: 'Receita de Frango e Porco para Filhotes', aliases: [], variation_id: 9000 + index },
    { ...item, flavor: 'senior-beef', flavor_label: 'Receita de Carne para Cães Sênior', aliases: [], variation_id: 9100 + index },
    { ...item, flavor: 'senior-chicken', flavor_label: 'Receita de Frango para Cães Sênior', aliases: [], variation_id: 9200 + index }
  ])];
}

function previewRepository() {
  const repository = new OnboardingPlanPreviewRepository({
    recommendationRepository: new OnboardingRecommendationRepository(null, { lifeStageService: lifeStageService() }),
    allowCatalogFallback: true
  });
  repository.loadCatalogItems = jest.fn(async () => catalog());
  return repository;
}

// Thor turned senior while his plan holds beef and pork.
const thor = { pet_id: 'p-thor', pet_name: 'Thor', size: 'medium', age_years: 9, weight: 20, activity_level: 'medium' };
const adultPlan = { flavors_by_pet: [{ pet_id: 'p-thor', pet_name: 'Thor', flavors: { beef: 5, pork: 5 } }], pets: [{ pet_id: 'p-thor', selected_flavors: ['beef', 'pork'], flavor_weights: [5, 5] }] };

function edit(flavors, currentSelection = adultPlan, dog = thor) {
  return previewRepository().previewPlan(null, {
    subscription_term_months: 1,
    pets: [{ ...dog, enabled: true, selected_flavors: Object.keys(flavors), flavor_weights: Object.values(flavors) }]
  }, MARKETS.BR, { currentSelection });
}

describe('adjusting a plan outside the pet line (L-04)', () => {
  test('a senior keeps the adult recipes with new quantities', async () => {
    await expect(edit({ beef: 4, pork: 6 })).resolves.toMatchObject({ pets: [{ pet_id: 'p-thor' }] });
  });

  test('a senior drops one adult recipe', async () => {
    const result = await edit({ beef: 10, pork: 0 });
    expect(result.catalog_pricing.line_items.map((item) => item.flavor)).toEqual(['beef']);
  });

  test('dropping every recipe is refused', async () => {
    await expect(edit({ beef: 0, pork: 0 })).rejects.toMatchObject({ statusCode: 422 });
  });

  test('adding an adult recipe that was not in the plan is refused, naming it', async () => {
    await expect(edit({ beef: 4, pork: 4, fish: 2 })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'recipe_life_stage_mismatch', pets: [{ pet_id: 'p-thor', rejected_flavors: ['fish'] }] }
    });
  });

  test('a senior switches to the senior line', async () => {
    await expect(edit({ 'senior-beef': 5, 'senior-chicken': 5 })).resolves.toBeTruthy();
  });

  test('mixing an adult and a senior recipe is refused', async () => {
    await expect(edit({ beef: 5, 'senior-beef': 5 })).rejects.toMatchObject({
      details: { code: 'recipe_life_stage_mismatch', pets: [{ pet_id: 'p-thor', allowed_life_stages: ['senior'], rejected_flavors: ['beef'] }] }
    });
  });
});

describe('adjusting a plan inside the pet line', () => {
  const tobby = { pet_id: 'p-thor', pet_name: 'Tobby', size: 'medium', age_years: 3, weight: 15, activity_level: 'medium' };

  test('an adult on an adult plan cannot add a senior recipe', async () => {
    await expect(edit({ beef: 5, 'senior-beef': 5 }, adultPlan, tobby)).rejects.toMatchObject({
      details: { pets: [{ rejected_flavors: ['senior-beef'] }] }
    });
  });

  test('an adult on an adult plan can change its adult recipes', async () => {
    await expect(edit({ beef: 2, fish: 8 }, adultPlan, tobby)).resolves.toBeTruthy();
  });
});

describe('pack adjustment recipe list', () => {
  function listFor(allowed) {
    return buildPackAdjustment({
      deliveryId: 'next',
      payload: { pets: [] },
      resolved: { pets: [{ pet_id: 'p-thor', pet_name: 'Thor', pack_size_grams: 300, allowed_life_stages: allowed }], catalog_pricing: { line_items: [], subtotal: 0 } },
      currentSelection: adultPlan,
      catalogItems: catalog(),
      currency: 'BRL',
      lineByKey: LINE_BY_KEY
    }).pets[0];
  }

  test('a plan outside the line lists its current recipes and the allowed line', () => {
    const pet = listFor(['senior']);
    expect(pet).toMatchObject({ allowed_life_stages: ['senior'], outside_line: true, current_recipes: ['beef', 'pork'] });
    expect(pet.recipes.map((recipe) => recipe.flavor).sort()).toEqual(['beef', 'pork', 'senior-beef', 'senior-chicken']);
  });

  test('a plan inside the line lists only the allowed line', () => {
    const pet = listFor(['adult']);
    expect(pet.outside_line).toBe(false);
    expect(pet.recipes.map((recipe) => recipe.life_stage)).toEqual(expect.arrayContaining(['adult']));
    expect(pet.recipes.every((recipe) => recipe.life_stage === 'adult')).toBe(true);
  });
});

describe('subscription edit passes the current plan to the preview', () => {
  test('resolveProposedPlan forwards the current selection', async () => {
    const planPreviewRepository = { previewPlan: jest.fn().mockResolvedValue({ catalog_pricing: { line_items: [{ stripe_price_id: 'price_1', quantity: 1 }], currency: 'BRL' } }) };
    await resolveProposedPlan(planPreviewRepository, null, { userId: 7, payload: { country: 'BR', pets: [] }, currentSelection: adultPlan });
    expect(planPreviewRepository.previewPlan.mock.calls[0][3]).toEqual({ currentSelection: adultPlan });
  });
});
