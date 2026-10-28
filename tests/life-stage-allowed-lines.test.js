const { MARKETS } = require('../src/core/market');
const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { LifeStageService } = require('../src/services/life-stage.service');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');
const { OnboardingPlanSnapshotRepository } = require('../src/infrastructure/repositories/onboarding-plan-snapshot.repository');
const { OnboardingPlanPreviewRepository } = require('../src/infrastructure/repositories/onboarding-plan-preview.repository');
const { listFallbackCatalogItems } = require('../src/core/plan-catalog-pricing');

const LINE_BY_KEY = { beef: 'adult', pork: 'adult', fish: 'adult', turkey: 'adult', 'puppy-chicken-pork': 'puppy', 'senior-beef': 'senior' };

// The seeded BR catalog plus one puppy and one senior recipe priced like beef.
function catalogWithNewRecipes() {
  const base = listFallbackCatalogItems('BR');
  const extra = base.filter((item) => item.flavor === 'beef').flatMap((item, index) => [
    { ...item, flavor: 'puppy-chicken-pork', flavor_label: 'Receita de Frango e Porco para Filhotes', aliases: [], variation_id: 9000 + index },
    { ...item, flavor: 'senior-beef', flavor_label: 'Receita de Carne para Cães Sênior', aliases: [], variation_id: 9100 + index }
  ]);
  return [...base, ...extra];
}

const NOW = new Date('2026-10-19T12:00:00Z');

function serviceWith(publishedByMarket) {
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  const recipeLinesRepository = {
    listRecipeLines: jest.fn(async () => Object.fromEntries(Object.entries(publishedByMarket)
      .map(([market, lines]) => [market, { lineByKey: LINE_BY_KEY, publishedLines: new Set(lines) }])))
  };
  const service = new LifeStageService({
    repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
    recipeLinesRepository,
    now: () => NOW
  });
  return { service, recipeLinesRepository };
}

const dogs = [
  { pet_id: 'puppy', name: 'Mel', size: 'medium', age_months: 5, weight: 6, activity_level: 'medium' },
  { pet_id: 'adult', name: 'Tobby', size: 'medium', age_years: 3, weight: 15, activity_level: 'medium' },
  { pet_id: 'senior', name: 'Thor', size: 'medium', age_years: 9, weight: 20, activity_level: 'medium' }
];

describe('allowed lines per pet (design decision 4)', () => {
  test('each stage buys only its own line once that line is published', async () => {
    const { service } = serviceWith({ BR: ['adult', 'puppy', 'senior'] });
    const annotated = await service.annotate(dogs, 'BR');
    expect(annotated.map((pet) => [pet.pet_id, pet.life_stage, pet.allowed_life_stages])).toEqual([
      ['puppy', 'puppy', ['puppy']],
      ['adult', 'adult', ['adult']],
      ['senior', 'senior', ['senior']]
    ]);
  });

  test('a senior never gets adult while senior recipes are published', async () => {
    const { service } = serviceWith({ BR: ['adult', 'senior'] });
    const [senior] = await service.annotate([dogs[2]], 'BR');
    expect(senior.allowed_life_stages).toEqual(['senior']);
  });

  test('a stage without a published recipe in the market falls back to adult', async () => {
    const { service } = serviceWith({ BR: ['adult', 'senior'], US: ['adult'] });
    expect((await service.annotate([dogs[0]], 'BR'))[0].allowed_life_stages).toEqual(['adult']);
    expect((await service.annotate([dogs[2]], 'US'))[0].allowed_life_stages).toEqual(['adult']);
  });

  test('reads the catalog lines once a minute', async () => {
    const { service, recipeLinesRepository } = serviceWith({ BR: ['adult'] });
    await service.annotate(dogs, 'BR');
    await service.annotate(dogs, 'US');
    expect(recipeLinesRepository.listRecipeLines).toHaveBeenCalledTimes(1);
  });
});

describe('allowed lines in plan snapshot and preview', () => {
  function recommendationRepository() {
    return new OnboardingRecommendationRepository(null, { lifeStageService: serviceWith({ BR: ['adult', 'puppy', 'senior'] }).service });
  }

  test('the snapshot returns allowed_life_stages per pet', async () => {
    const snapshot = await new OnboardingPlanSnapshotRepository({ recommendationRepository: recommendationRepository(), allowCatalogFallback: true })
      .getSnapshot(null, MARKETS.BR, dogs);
    expect(snapshot.pets.map((pet) => [pet.pet_id, pet.allowed_life_stages])).toEqual([
      ['puppy', ['puppy']], ['adult', ['adult']], ['senior', ['senior']]
    ]);
  });

  test('the preview returns allowed_life_stages per selected pet', async () => {
    const repository = new OnboardingPlanPreviewRepository({ recommendationRepository: recommendationRepository(), allowCatalogFallback: true });
    repository.loadCatalogItems = jest.fn().mockResolvedValue(catalogWithNewRecipes());
    const recipeFor = { puppy: 'puppy-chicken-pork', adult: 'beef', senior: 'senior-beef' };
    const preview = await repository.previewPlan(null, {
      subscription_term_months: 1,
      pets: dogs.map((dog) => ({ ...dog, pet_name: dog.name, enabled: true, selected_flavors: [recipeFor[dog.pet_id]], flavor_weights: [2] }))
    }, MARKETS.BR);
    expect(preview.pets.map((pet) => [pet.pet_id, pet.allowed_life_stages])).toEqual([
      ['puppy', ['puppy']], ['adult', ['adult']], ['senior', ['senior']]
    ]);
  });
});
