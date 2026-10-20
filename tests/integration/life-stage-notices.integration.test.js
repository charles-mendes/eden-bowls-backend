const { buildSizeClassSeedRows } = require('../../src/core/life-stage-seed');
const { LifeStageService } = require('../../src/services/life-stage.service');
const { LifeStageNoticesService } = require('../../src/services/life-stage-notices.service');
const { PetLifeStageNoticesRepository } = require('../../src/infrastructure/repositories/pet-life-stage-notices.repository');
const { createScratchDatabase } = require('./helpers/scratch-database');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const NOW = new Date('2026-10-19T12:00:00Z');

describeIntegration('stage-change notice rows (MySQL)', () => {
  let scratch;

  beforeAll(async () => {
    scratch = await createScratchDatabase('notices', ['pet_life_stage_notices']);
  });

  afterAll(async () => {
    if (scratch) await scratch.drop();
  });

  test('two simultaneous first reads of a plan create a single notice', async () => {
    const limits = {};
    for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
      limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
    }
    const lifeStageService = new LifeStageService({
      repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
      recipeLinesRepository: {
        listRecipeLines: async () => ({
          BR: {
            lineByKey: { beef: 'adult', 'senior-beef': 'senior' },
            publishedLines: new Set(['adult', 'senior']),
            publishedRecipes: [
              { key: 'beef', label: 'Bovino', life_stage: 'adult' },
              { key: 'senior-beef', label: 'Receita de Carne para Cães Sênior', life_stage: 'senior' }
            ]
          }
        })
      },
      now: () => NOW
    });
    const thor = { id: 'p-thor', name: 'Thor', size: 'medium', age_years: 9, age_months: 0, age_recorded_at: '2026-10-19T09:00:00.000Z', birth_date: null };
    const service = new LifeStageNoticesService({
      lifeStageService,
      noticesRepository: new PetLifeStageNoticesRepository(scratch.dataSource),
      petsRepository: { listPets: async () => ({ pets: [thor] }) },
      now: () => NOW
    });
    const row = {
      id: 41,
      stripeAccount: 'br',
      planSelection: { pets: [{ pet_id: 'p-thor', selected_flavors: ['beef'], flavor_weights: [5] }] }
    };

    const [list, detail] = await Promise.all([
      service.reportForUser(7, [row]),
      service.reportForUser(7, [row])
    ]);

    const rows = await scratch.query('SELECT pet_id, from_line, to_line FROM pet_life_stage_notices WHERE subscription_id = 41');
    expect(rows).toEqual([{ pet_id: 'p-thor', from_line: 'adult', to_line: 'senior' }]);
    expect(list.get(41)[0].life_stage_notice).toMatchObject({ open: true });
    expect(detail.get(41)[0].life_stage_notice).toMatchObject({ open: true });
  });

  test('an emailed transition is marked once and blocks the same pet on another plan', async () => {
    const repository = new PetLifeStageNoticesRepository(scratch.dataSource);
    const at = new Date('2026-10-20T12:00:00Z');
    await repository.ensureDetected({ subscriptionId: 51, petId: 'p-bob', fromLine: 'adult', toLine: 'senior', at });
    await repository.ensureDetected({ subscriptionId: 52, petId: 'p-bob', fromLine: 'adult', toLine: 'senior', at });
    expect(await repository.transitionNotified('p-bob', 'adult', 'senior')).toBe(false);

    await repository.markEmailed({ subscriptionId: 51, petId: 'p-bob', fromLine: 'adult', toLine: 'senior', at });
    await repository.markEmailed({ subscriptionId: 51, petId: 'p-bob', fromLine: 'adult', toLine: 'senior', at: new Date('2026-10-21T12:00:00Z') });

    expect(await repository.transitionNotified('p-bob', 'adult', 'senior')).toBe(true);
    expect(await repository.transitionNotified('p-bob', 'puppy', 'adult')).toBe(false);
    const rows = await scratch.query("SELECT subscription_id, notified_at, notified_via FROM pet_life_stage_notices WHERE pet_id = 'p-bob' ORDER BY subscription_id");
    expect(rows.map((row) => [Number(row.subscription_id), row.notified_via])).toEqual([[51, 'email'], [52, null]]);
    expect(new Date(rows[0].notified_at).toISOString()).toBe('2026-10-20T12:00:00.000Z');
  });
});
