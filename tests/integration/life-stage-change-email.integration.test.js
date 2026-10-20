const { buildSizeClassSeedRows } = require('../../src/core/life-stage-seed');
const { LifeStageService } = require('../../src/services/life-stage.service');
const { LifeStageNoticesService } = require('../../src/services/life-stage-notices.service');
const { LifeStageChangeEmailService } = require('../../src/services/life-stage-change-email.service');
const { PetLifeStageNoticesRepository } = require('../../src/infrastructure/repositories/pet-life-stage-notices.repository');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');
const { createScratchDatabase } = require('./helpers/scratch-database');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const NOW = new Date('2026-10-20T12:00:00Z');
const CUTOFF = '2026-10-27T02:59:59.000Z';

describeIntegration('stage-change email job on MySQL plans', () => {
  let scratch;

  beforeAll(async () => {
    scratch = await createScratchDatabase('change_email', ['stripe_subscriptions', 'wp_usermeta', 'pet_life_stage_notices']);
    const plan = JSON.stringify({ pets: [{ pet_id: 'p-thor', selected_flavors: ['beef'], flavor_weights: [4] }] });
    for (const [id, cancel] of [[71, 0], [72, 1]]) {
      await scratch.query(
        `INSERT INTO stripe_subscriptions (id, user_id, customer_email, stripe_subscription_id, stripe_customer_id, status, stripe_account, plan_selection, address, cancel_at_period_end)
         VALUES (?, 7, 'ana@example.com', ?, 'cus_7', 'active', 'br', ?, ?, ?)`,
        [id, `sub_${id}`, plan, JSON.stringify({ name: 'Ana Mendes', country: 'BR' }), cancel]
      );
    }
  });

  afterAll(async () => {
    if (scratch) await scratch.drop();
  });

  test('a plan with renewal turned off gets no email and still shows the notice', async () => {
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
            publishedRecipes: [{ key: 'senior-beef', label: 'Receita de Carne para Cães Sênior', life_stage: 'senior' }]
          }
        })
      },
      now: () => NOW
    });
    const thor = { id: 'p-thor', name: 'Thor', size: 'medium', breed: '', age_years: 9, age_months: 0, age_recorded_at: '2026-10-19T09:00:00.000Z', birth_date: null };
    const petsRepository = { listPets: async () => ({ pets: [thor] }) };
    const ledgerRepository = new SubscriptionLedgerRepository(scratch.dataSource);
    const noticesRepository = new PetLifeStageNoticesRepository(scratch.dataSource);
    const noticesService = new LifeStageNoticesService({ lifeStageService, noticesRepository, petsRepository, now: () => NOW });
    const mailer = { notifyLifeStageChange: jest.fn(async () => ({ claimed: true })) };
    const job = new LifeStageChangeEmailService({
      ledgerRepository,
      noticesService,
      noticesRepository,
      announcementsRepository: { findMarket: async (market) => ({ market, sent_at: market === 'BR' ? '2026-10-18T12:00:00Z' : null }) },
      deliveriesService: { loadSubscription: async () => ({}), read: async () => ({ actionTarget: { id: 'current', editableUntil: CUTOFF } }) },
      petsRepository,
      mailer,
      now: () => NOW
    });

    await job.runDaily();

    expect(mailer.notifyLifeStageChange).toHaveBeenCalledTimes(1);
    expect(mailer.notifyLifeStageChange.mock.calls[0][0].ledger.stripeSubscriptionId).toBe('sub_71');

    const renewalOff = await ledgerRepository.findByStripeSubscriptionId('sub_72');
    const report = await noticesService.reportForUser(7, [renewalOff]);
    expect(report.get(72)[0]).toMatchObject({ life_stage_mismatch: true, life_stage_notice: { open: true, notified_via: null } });
  });
});
