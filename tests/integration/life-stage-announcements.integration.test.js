const { buildSizeClassSeedRows } = require('../../src/core/life-stage-seed');
const { LifeStageService } = require('../../src/services/life-stage.service');
const { LifeStageAnnouncementService } = require('../../src/services/life-stage-announcement.service');
const { LifeStageAnnouncementsRepository } = require('../../src/infrastructure/repositories/life-stage-announcements.repository');
const { createScratchDatabase } = require('./helpers/scratch-database');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('launch announcement candidates (MySQL)', () => {
  let scratch;
  let repository;

  async function user(id, optIn) {
    await scratch.query(
      "INSERT INTO wp_users (ID, user_login, user_pass, user_nicename, user_email) VALUES (?, ?, '', '', ?)",
      [id, `user${id}`, `user${id}@example.com`]
    );
    if (optIn !== undefined) {
      await scratch.query("INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'hsr_marketing_opt_in', ?)", [id, optIn]);
    }
  }

  async function pet(id, userId, extra = {}) {
    await scratch.query(
      `INSERT INTO onboarding_pets (id, user_id, name, weight_unit, size, age_years, age_months, life_stage_announced_at, life_stage_announced_stage, deleted_at)
       VALUES (?, ?, ?, 'kg', 'medium', ?, ?, ?, ?, ?)`,
      [id, userId, extra.name || `Pet ${id}`, extra.ageYears ?? 9, extra.ageMonths ?? 0, extra.announcedAt || null, extra.announcedAt ? 'senior' : null, extra.deletedAt || null]
    );
  }

  async function subscription(id, userId, { status = 'active', account = 'br', petIds = [], flavors = {} } = {}) {
    await scratch.query(
      `INSERT INTO stripe_subscriptions (id, user_id, customer_email, stripe_subscription_id, stripe_customer_id, status, stripe_account, plan_selection, address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, `user${userId}@example.com`, `sub_${id}`, `cus_${userId}`, status, account,
        JSON.stringify({ pets: petIds.map((petId) => ({ pet_id: String(petId), selected_flavors: flavors[petId] || ['beef'], flavor_weights: (flavors[petId] || ['beef']).map(() => 4) })) }), JSON.stringify({ name: 'Ana Mendes' })]
    );
  }

  beforeAll(async () => {
    scratch = await createScratchDatabase('announce', ['stripe_subscriptions', 'onboarding_pets', 'wp_users', 'wp_usermeta']);
    repository = new LifeStageAnnouncementsRepository(scratch.dataSource);

    await user(1, '1');
    await pet(11, 1);
    await pet(12, 1, { announcedAt: '2026-10-18 10:00:00' });
    await pet(13, 1, { deletedAt: '2026-10-01 10:00:00' });
    await subscription(101, 1, { petIds: [11, 12, 13] });

    await user(2, '0');
    await pet(21, 2);
    await subscription(201, 2, { petIds: [21] });

    await user(3);
    await pet(31, 3);
    await subscription(301, 3, { petIds: [31] });

    await user(4, '1');
    await pet(41, 4);
    await subscription(401, 4, { status: 'canceled', petIds: [41] });
    await subscription(402, 4, { account: 'us', petIds: [41] });
    await subscription(403, 4, { status: 'past_due', petIds: [41] });

    // A senior already on senior recipes.
    await user(5, '1');
    await pet(51, 5, { name: 'Thor' });
    await subscription(501, 5, { petIds: [51], flavors: { 51: ['senior-beef'] } });

    // A puppy already on puppy recipes and a senior still on adult recipes, on one plan.
    await user(6, '1');
    await pet(61, 6, { name: 'Luna', ageYears: 0, ageMonths: 5 });
    await pet(62, 6, { name: 'Bob' });
    await subscription(601, 6, { petIds: [61, 62], flavors: { 61: ['puppy-chicken-pork'], 62: ['beef'] } });
  });

  afterAll(async () => {
    if (scratch) await scratch.drop();
  });

  test('only opted-in customers with delivering plans in the market, with pets not yet announced', async () => {
    const candidates = await repository.listCandidates('br');
    expect(candidates.map((plan) => [plan.id, plan.userId, plan.email, plan.pets.map((item) => item.id)])).toEqual([
      [101, 1, 'user1@example.com', ['11']],
      [403, 4, 'user4@example.com', ['41']],
      [501, 5, 'user5@example.com', ['51']],
      [601, 6, 'user6@example.com', ['61', '62']]
    ]);
    expect(candidates[0].planSelection.pets).toHaveLength(3);
    expect(candidates[0].address).toEqual({ name: 'Ana Mendes' });
  });

  test('the other market sees only its own plans', async () => {
    const candidates = await repository.listCandidates('us');
    expect(candidates.map((plan) => plan.id)).toEqual([402]);
  });

  test('recipients name only dogs outside their allowed line (service on MySQL candidates)', async () => {
    const limits = {};
    for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
      limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
    }
    const recipes = [
      { key: 'beef', label: 'Bovino', life_stage: 'adult' },
      { key: 'puppy-chicken-pork', label: 'Receita de Frango e Porco para Filhotes', life_stage: 'puppy' },
      { key: 'senior-beef', label: 'Receita de Carne para Cães Sênior', life_stage: 'senior' }
    ];
    const lifeStageService = new LifeStageService({
      repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
      recipeLinesRepository: {
        listRecipeLines: async () => ({
          BR: {
            lineByKey: Object.fromEntries(recipes.map((recipe) => [recipe.key, recipe.life_stage])),
            publishedLines: new Set(['adult', 'puppy', 'senior']),
            publishedRecipes: recipes
          }
        })
      }
    });
    const service = new LifeStageAnnouncementService({ lifeStageService, repository });

    const recipients = await service.recipients('BR');

    expect(recipients.map((recipient) => [recipient.userId, recipient.dogs.map((dog) => [dog.petId, dog.stage])])).toEqual([
      [1, [['11', 'senior']]],
      [4, [['41', 'senior']]],
      [6, [['62', 'senior']]]
    ]);
  });
});
