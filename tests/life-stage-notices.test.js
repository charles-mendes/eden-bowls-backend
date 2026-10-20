const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { LifeStageService } = require('../src/services/life-stage.service');
const { LifeStageNoticesService } = require('../src/services/life-stage-notices.service');
const { SubscriptionsDetailService } = require('../src/services/subscriptions-detail.service');
const { SubscriptionsService } = require('../src/services/subscriptions.service');
const { SubscriptionsEditCommitService } = require('../src/services/subscriptions-edit-commit.service');

const NOW = new Date('2026-10-19T12:00:00Z');
const LINE_BY_KEY = { beef: 'adult', pork: 'adult', 'puppy-chicken-pork': 'puppy', 'senior-beef': 'senior', 'senior-chicken': 'senior' };
const RECIPES = [
  { key: 'beef', label: 'Bovino', life_stage: 'adult' },
  { key: 'pork', label: 'Porco', life_stage: 'adult' },
  { key: 'puppy-chicken-pork', label: 'Receita de Frango e Porco para Filhotes', life_stage: 'puppy' },
  { key: 'senior-beef', label: 'Receita de Carne para Cães Sênior', life_stage: 'senior' },
  { key: 'senior-chicken', label: 'Receita de Frango para Cães Sênior', life_stage: 'senior' }
];

// In-memory notices with the same rules as the MySQL repository.
function memoryNotices() {
  const rows = [];
  const key = (row) => `${row.subscription_id}|${row.pet_id}|${row.from_line}|${row.to_line}`;
  return {
    rows,
    ensureDetected: jest.fn(async ({ subscriptionId, petId, fromLine, toLine, at, notified }) => {
      const row = { subscription_id: subscriptionId, pet_id: petId, from_line: fromLine, to_line: toLine, detected_at: at, dismissed_at: null, resolved_at: null, notified_at: notified ? notified.at : null, notified_via: notified ? notified.via : null };
      if (!rows.some((item) => key(item) === key(row))) rows.push(row);
    }),
    listForSubscriptions: jest.fn(async (ids) => rows.filter((row) => ids.includes(row.subscription_id))),
    dismissOpen: jest.fn(async (subscriptionId, petId, at) => {
      const open = rows.filter((row) => row.subscription_id === subscriptionId && row.pet_id === petId && !row.dismissed_at && !row.resolved_at);
      open.forEach((row) => { row.dismissed_at = at; });
      return open.length;
    }),
    resolveOpen: jest.fn(async (subscriptionId, at) => {
      rows.filter((row) => row.subscription_id === subscriptionId && !row.dismissed_at && !row.resolved_at).forEach((row) => { row.resolved_at = at; });
    })
  };
}

function setup({ pets, published = ['adult', 'puppy', 'senior'], notices = memoryNotices() }) {
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  const lifeStageService = new LifeStageService({
    repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
    recipeLinesRepository: {
      listRecipeLines: async () => ({
        BR: { lineByKey: LINE_BY_KEY, publishedLines: new Set(published), publishedRecipes: RECIPES.filter((recipe) => published.includes(recipe.life_stage)) }
      })
    },
    now: () => NOW
  });
  const ledgerRepository = {
    findByUserIdAndSubscriptionId: jest.fn(async (_userId, id) => (id === 'sub_1' ? ledgerRow : null)),
    listByUserId: jest.fn(async () => [ledgerRow])
  };
  const service = new LifeStageNoticesService({
    lifeStageService,
    noticesRepository: notices,
    ledgerRepository,
    petsRepository: { listPets: jest.fn(async () => ({ pets })) },
    now: () => NOW
  });
  return { service, notices, ledgerRepository, lifeStageService };
}

let ledgerRow;
function planOf(flavors) {
  return { pets: [{ pet_id: 'p-thor', selected_flavors: flavors, flavor_weights: flavors.map(() => 5) }] };
}
const registered = { age_recorded_at: '2026-10-19T09:00:00.000Z', birth_date: null };
const senior = { id: 'p-thor', name: 'Thor', size: 'medium', age_years: 9, age_months: 0, ...registered };
const adult = { id: 'p-thor', name: 'Thor', size: 'medium', age_years: 3, age_months: 0, ...registered };
const puppy = { id: 'p-thor', name: 'Thor', size: 'medium', age_years: 0, age_months: 5, ...registered };

async function reportFor(pets, flavors, options = {}) {
  ledgerRow = { id: 11, stripeSubscriptionId: 'sub_1', stripeAccount: 'br', status: 'active', planSelection: planOf(flavors) };
  const context = setup({ pets, ...options });
  const report = await context.service.reportForUser(7, [ledgerRow]);
  return { ...context, entry: report.get(11)[0] };
}

describe('mismatch reported by the API', () => {
  test('an adult turned senior with adult recipes: mismatch, senior suggestions and an open notice', async () => {
    const { entry, notices } = await reportFor([senior], ['beef', 'pork']);
    expect(entry).toMatchObject({
      pet_id: 'p-thor', life_stage: 'senior', allowed_life_stages: ['senior'], plan_lines: ['adult'], life_stage_mismatch: true,
      suggested_recipes: [{ key: 'senior-beef', label: 'Receita de Carne para Cães Sênior' }, { key: 'senior-chicken', label: 'Receita de Frango para Cães Sênior' }],
      life_stage_notice: { open: true, from_line: 'adult', to_line: 'senior', notified_via: null }
    });
    expect(notices.rows).toHaveLength(1);
  });

  test('a puppy turned adult with puppy recipes: mismatch with adult suggestions', async () => {
    const { entry } = await reportFor([adult], ['puppy-chicken-pork']);
    expect(entry).toMatchObject({ life_stage_mismatch: true, plan_lines: ['puppy'] });
    expect(entry.suggested_recipes.map((recipe) => recipe.key)).toEqual(['beef', 'pork']);
  });

  test('stage and line match: no mismatch, no suggestion, no notice row', async () => {
    const { entry, notices } = await reportFor([adult], ['beef']);
    expect(entry).toMatchObject({ life_stage_mismatch: false, suggested_recipes: [], life_stage_notice: null });
    expect(notices.rows).toHaveLength(0);
  });

  test('a puppy with adult recipes before publication has no mismatch', async () => {
    const { entry } = await reportFor([puppy], ['beef'], { published: ['adult'] });
    expect(entry).toMatchObject({ life_stage: 'puppy', allowed_life_stages: ['adult'], life_stage_mismatch: false });
  });
});

describe('notice state', () => {
  test('closing hides it for the same change, in later reads too', async () => {
    const first = await reportFor([senior], ['beef']);
    await first.service.dismiss({ userId: 7, subscriptionId: 'sub_1', petId: 'p-thor' });
    const again = await first.service.reportForUser(7, [ledgerRow]);
    expect(again.get(11)[0].life_stage_notice.open).toBe(false);
  });

  test('a saved adjustment resolves it, even keeping the adult recipes', async () => {
    const first = await reportFor([senior], ['beef']);
    await first.service.resolveAfterCommit(ledgerRow);
    const again = await first.service.reportForUser(7, [ledgerRow]);
    expect(again.get(11)[0]).toMatchObject({ life_stage_mismatch: true, life_stage_notice: { open: false } });
  });

  test('a notified row still shows the notice', async () => {
    const notices = memoryNotices();
    notices.rows.push({ subscription_id: 11, pet_id: 'p-thor', from_line: 'adult', to_line: 'senior', dismissed_at: null, resolved_at: null, notified_at: NOW, notified_via: 'manual_correction' });
    const { entry } = await reportFor([senior], ['beef'], { notices });
    expect(entry.life_stage_notice).toEqual({ open: true, from_line: 'adult', to_line: 'senior', notified_via: 'manual_correction' });
  });

  test('a pet announced for this stage gets its notice already notified by the announcement', async () => {
    const announced = { ...senior, life_stage_announced_stage: 'senior', life_stage_announced_at: '2026-10-10T10:00:00.000Z' };
    const { entry, notices } = await reportFor([announced], ['beef']);
    expect(notices.ensureDetected.mock.calls[0][0].notified).toEqual({ at: new Date('2026-10-10T10:00:00.000Z'), via: 'announcement' });
    expect(entry.life_stage_notice).toMatchObject({ open: true, notified_via: 'announcement' });
  });

  test('a later stage change opens a new notice after a closed one', async () => {
    const notices = memoryNotices();
    notices.rows.push({ subscription_id: 11, pet_id: 'p-thor', from_line: 'puppy', to_line: 'adult', dismissed_at: NOW, resolved_at: null, notified_at: null, notified_via: null });
    const { entry } = await reportFor([senior], ['beef'], { notices });
    expect(entry.life_stage_notice).toMatchObject({ open: true, from_line: 'adult', to_line: 'senior' });
    expect(notices.rows).toHaveLength(2);
  });
});

describe('notice endpoints and wiring', () => {
  const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
  const auth = () => `Bearer ${issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) })}`;

  test('POST dismiss closes the notice of the customer plan, and 404s another plan', async () => {
    const { service, notices } = await reportFor([senior], ['beef']);
    const app = createApp({ lifeStageNoticesService: service, corsOrigins: ['http://localhost:5173'], jwt });

    const closed = await request(app).post('/api/v1/subscriptions/sub_1/life-stage-notices/p-thor/dismiss').set('Authorization', auth());
    expect(closed.status).toBe(200);
    expect(closed.body.data).toEqual({ subscription_id: 'sub_1', pet_id: 'p-thor', dismissed: true });
    expect(notices.rows[0].dismissed_at).toEqual(NOW);

    const other = await request(app).post('/api/v1/subscriptions/sub_9/life-stage-notices/p-thor/dismiss').set('Authorization', auth());
    expect(other.status).toBe(404);
  });

  test('subscription list and detail carry the report per pet', async () => {
    const context = await reportFor([senior], ['beef']);
    const subscriptionsService = new SubscriptionsService({ listMine: jest.fn().mockResolvedValue({ subscriptions: [{ subscription_id: 'sub_1', stripe_account: 'br', pet_ids: ['p-thor'] }], count: 1 }) }, {
      lifeStageService: context.lifeStageService, lifeStageNoticesService: context.service, ledgerRepository: context.ledgerRepository
    });
    const subscriptionsDetailService = new SubscriptionsDetailService({ getDetail: jest.fn().mockResolvedValue({ subscription: { subscription_id: 'sub_1', stripe_account: 'br', pets: [{ id: 'p-thor', name: 'Thor' }] } }) }, {
      lifeStageService: context.lifeStageService, lifeStageNoticesService: context.service, ledgerRepository: context.ledgerRepository
    });

    const list = await subscriptionsService.listMine({ userId: 7 });
    const detail = await subscriptionsDetailService.getDetail({ subscriptionId: 'sub_1', userId: 7 });
    expect(list.data.subscriptions[0].pet_life_stages[0]).toMatchObject({ pet_id: 'p-thor', life_stage_mismatch: true });
    expect(detail.data.subscription.pets[0]).toMatchObject({ id: 'p-thor', name: 'Thor', life_stage_mismatch: true, life_stage_notice: { open: true } });
  });

  describe('only a save through the recipes and packs step resolves the notice', () => {
    const planSelection = { flavors_by_pet: [{ pet_id: 'p-thor', pet_name: 'Thor', flavors: { beef: 4 } }] };
    const thor = (flavors, weights) => ({ pet_id: 'p-thor', pet_name: 'Thor', enabled: true, selected_flavors: flavors, flavor_weights: weights });

    function commitWith(payload) {
      const row = { id: 11, status: 'active', editPaymentPending: false, planSelection };
      const lifeStageNoticesService = { resolveAfterCommit: jest.fn() };
      const deliveryGuard = {
        loadSubscription: jest.fn().mockResolvedValue({ id: 'sub_1' }),
        commitPacks: jest.fn().mockResolvedValue({ deferred: false })
      };
      const service = new SubscriptionsEditCommitService({ commit: jest.fn().mockResolvedValue({ ok: true }) }, {
        authService: { assertCriticalOperationAllowed: jest.fn() },
        ledgerRepository: { findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(row), listByUserId: jest.fn().mockResolvedValue([]) },
        lifeStageNoticesService,
        deliveryGuard
      });
      service.assertPetsNotBlocked = jest.fn();
      return service.commit({ subscriptionId: 'sub_1', userId: 7, payload: { subscription_term_months: 1, expected_current_hash: 'h', ...payload } })
        .then(() => ({ row, resolve: lifeStageNoticesService.resolveAfterCommit }));
    }

    test('an edit of only the address keeps the notice open', async () => {
      const { resolve } = await commitWith({ pets: [thor(['beef'], [4])], address: { country: 'BR', line1: 'Rua Nova, 10', postal_code: '01000-000' } });
      expect(resolve).not.toHaveBeenCalled();
    });

    test('an edit of only the payment method keeps the notice open', async () => {
      const { resolve } = await commitWith({ pets: [thor(['beef'], [4])], payment_method_id: 'pm_new' });
      expect(resolve).not.toHaveBeenCalled();
    });

    test('an edit that switches the recipes in the plan step resolves the notice', async () => {
      const { row, resolve } = await commitWith({ pets: [thor(['senior-beef'], [4])] });
      expect(resolve).toHaveBeenCalledWith(row);
    });

    test('an edit that keeps the recipes with new quantities resolves the notice', async () => {
      const { row, resolve } = await commitWith({ pets: [thor(['beef'], [6])] });
      expect(resolve).toHaveBeenCalledWith(row);
    });

    test('a pack adjustment resolves the notice even with the same packs', async () => {
      const { row, resolve } = await commitWith({ pets: [thor(['beef'], [4])], delivery_id: 'dlv_1' });
      expect(resolve).toHaveBeenCalledWith(row);
    });
  });
});
