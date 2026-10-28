const { COMPANY_PROFILE_SEED } = require('../src/core/company-profile');
const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { LifeStageService } = require('../src/services/life-stage.service');
const { LifeStageNoticesService } = require('../src/services/life-stage-notices.service');
const { LifeStageChangeEmailService } = require('../src/services/life-stage-change-email.service');
const { AnnouncementRefused, LifeStageAnnouncementService } = require('../src/services/life-stage-announcement.service');
const { formatSummary, parseArgs } = require('../src/scripts/life-stage-announcement');

const RECIPES = [
  { key: 'beef', label: 'Bovino', life_stage: 'adult' },
  { key: 'senior-beef', label: 'Receita de Carne para Cães Sênior', life_stage: 'senior' }
];
const COMPANY = { ...COMPANY_PROFILE_SEED.BR };
const registered = { breed: '', size: 'medium', age_recorded_at: '2026-10-19T09:00:00.000Z', birth_date: null };
const senior = (id, name) => ({ id, name, age_years: 9, age_months: 0, ...registered });

// In-memory candidates that drop announced pets, like the MySQL query, and record every write.
function memoryRepository(customers) {
  const announced = new Map();
  const state = { market: 'BR', started_at: null, sent_at: null };
  const writes = [];
  return {
    announced,
    state,
    writes,
    async findMarket() { return state.started_at || state.sent_at ? { ...state } : null; },
    async listCandidates() {
      return customers.map((customer) => ({ ...customer, pets: customer.pets.filter((pet) => !announced.has(pet.id)) }));
    },
    async markStarted(market, at) { writes.push('markStarted'); state.started_at = state.started_at || at; },
    async markSent(market, at) { writes.push('markSent'); state.sent_at = at; },
    async countAnnouncedCustomersSince(account, since) {
      const users = new Set();
      for (const [petId, entry] of announced) {
        if (entry.at >= since) users.add(customers.find((customer) => customer.pets.some((pet) => pet.id === petId)).userId);
      }
      return users.size;
    },
    async markPetsAnnounced(dogs, at) {
      writes.push('markPetsAnnounced');
      dogs.forEach((dog) => announced.set(dog.petId, { at, stage: dog.stage }));
    }
  };
}

function customer(userId, petId, name) {
  return {
    id: userId * 10,
    userId,
    stripeSubscriptionId: `sub_${userId}`,
    stripeAccount: 'br',
    email: `user${userId}@example.com`,
    address: { name: `Cliente ${userId}` },
    planSelection: { pets: [{ pet_id: petId, selected_flavors: ['beef'], flavor_weights: [4] }] },
    pets: [senior(petId, name)]
  };
}

function setup({ customers, company = COMPANY, published = ['adult', 'senior'], cap, batch } = {}) {
  // automated_email_settings of the market, read at the start of each send.
  const settings = {
    forMarket: jest.fn(async () => ({ lifeStageChangeEnabled: true, announcementBatchSize: batch || 50, announcementDailyCap: cap || 300 }))
  };
  const clock = { now: new Date('2026-10-20T12:00:00Z') };
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  const lifeStageService = new LifeStageService({
    repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
    recipeLinesRepository: {
      listRecipeLines: async () => ({
        BR: {
          lineByKey: Object.fromEntries(RECIPES.map((recipe) => [recipe.key, recipe.life_stage])),
          publishedLines: new Set(published),
          publishedRecipes: RECIPES.filter((recipe) => published.includes(recipe.life_stage))
        }
      })
    },
    now: () => clock.now
  });
  const repository = memoryRepository(customers);
  const noticesRepository = { markAnnounced: jest.fn(async () => {}) };
  const mailer = { sendClaimed: jest.fn(async ({ to }) => ({ claimed: true, to })) };
  const wait = jest.fn(async () => {});
  const service = new LifeStageAnnouncementService({
    lifeStageService,
    repository,
    noticesRepository,
    mailer,
    storeAppUrl: 'https://edenbowls.com',
    companyProfiles: { forMarket: async () => company },
    settings,
    wait,
    now: () => clock.now
  });
  return { service, repository, noticesRepository, mailer, clock, wait, lifeStageService, settings };
}

describe('launch announcement command (2.14)', () => {
  test('the simulation reports customers and pets and sends or writes nothing', async () => {
    const { service, repository, noticesRepository, mailer } = setup({
      customers: [customer(1, 'p-thor', 'Thor'), customer(2, 'p-bob', 'Bob')]
    });
    const summary = await service.run({ market: 'BR' });
    expect(summary).toMatchObject({ mode: 'simulation', customers: 2, pets: 2 });
    expect(summary.recipients[0]).toEqual({ user_id: 1, email: 'user1@example.com', dogs: [{ pet_id: 'p-thor', name: 'Thor', stage: 'senior', subscription_id: 'sub_1' }] });
    expect(mailer.sendClaimed).not.toHaveBeenCalled();
    expect(noticesRepository.markAnnounced).not.toHaveBeenCalled();
    expect(repository.writes).toEqual([]);
    expect(formatSummary(summary)).toContain('Simulação BR (nada foi enviado nem marcado): 2 cliente(s), 2 pet(s).');
  });

  test('the real send emails each customer once, marks pets and notices, and closes the market', async () => {
    const { service, repository, noticesRepository, mailer } = setup({ customers: [customer(1, 'p-thor', 'Thor'), customer(2, 'p-bob', 'Bob')] });
    const summary = await service.run({ market: 'BR', send: true });

    expect(summary).toMatchObject({ mode: 'send', sent: 2, failed: 0, remaining: 0 });
    expect(mailer.sendClaimed).toHaveBeenCalledTimes(2);
    const first = mailer.sendClaimed.mock.calls[0][0];
    expect(first).toMatchObject({ subscriptionId: 'sub_1', template: 'life_stage_announcement', referenceId: 'BR:user:1', to: 'user1@example.com' });
    expect(first.content.html).toContain('/dashboard/plans/sub_1/packs?pet=p-thor');
    expect(first.content.html).toContain('C. C. J. Lovato Ltda · CNPJ 65.291.985/0001-05');
    expect(first.content.html).not.toContain('Nunca compartilhe');
    expect([...repository.announced.keys()]).toEqual(['p-thor', 'p-bob']);
    expect(noticesRepository.markAnnounced).toHaveBeenCalledWith('p-thor', 'senior', expect.any(Date));
    expect(repository.state.sent_at).not.toBeNull();
    expect(repository.writes[repository.writes.length - 1]).toBe('markSent');
  });

  test('the daily cap stops a run, the market stays open, and the next day resumes', async () => {
    const { service, repository, mailer, clock } = setup({
      customers: [customer(1, 'p-a', 'A'), customer(2, 'p-b', 'B'), customer(3, 'p-c', 'C')],
      cap: 2
    });
    const first = await service.run({ market: 'BR', send: true });
    expect(first).toMatchObject({ sent: 2, remaining: 1, sent_at: null });
    expect(repository.state.sent_at).toBeNull();
    expect(formatSummary(first)).toContain('Faltam 1 cliente(s). Rode de novo com --send em outro dia para continuar.');

    const sameDay = await service.run({ market: 'BR', send: true });
    expect(sameDay).toMatchObject({ sent: 0, remaining: 1 });

    clock.now = new Date('2026-10-21T09:00:00Z');
    const second = await service.run({ market: 'BR', send: true });
    expect(second).toMatchObject({ customers: 1, sent: 1, remaining: 0 });
    expect(mailer.sendClaimed.mock.calls.map((call) => call[0].to)).toEqual(['user1@example.com', 'user2@example.com', 'user3@example.com']);
    expect(repository.state.sent_at).toEqual(new Date('2026-10-21T09:00:00Z'));
  });

  test('a cap saved in the admin applies to the next send, read at its start', async () => {
    const { service, settings, mailer, clock } = setup({ customers: [customer(1, 'p-a', 'A'), customer(2, 'p-b', 'B'), customer(3, 'p-c', 'C')], cap: 1 });
    await service.run({ market: 'BR', send: true });
    expect(mailer.sendClaimed).toHaveBeenCalledTimes(1);

    settings.forMarket.mockResolvedValue({ lifeStageChangeEnabled: true, announcementBatchSize: 50, announcementDailyCap: 3 });
    clock.now = new Date(clock.now.getTime() + 60 * 1000);
    await service.run({ market: 'BR', send: true });

    expect(mailer.sendClaimed).toHaveBeenCalledTimes(3);
    expect(settings.forMarket).toHaveBeenCalledTimes(2);
    expect(settings.forMarket).toHaveBeenCalledWith('BR');
  });

  test('batches pause between them', async () => {
    const { service, wait } = setup({ customers: [customer(1, 'p-a', 'A'), customer(2, 'p-b', 'B'), customer(3, 'p-c', 'C')], batch: 2 });
    await service.run({ market: 'BR', send: true });
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test('a failed send is not marked and keeps the market open', async () => {
    const { service, repository, mailer } = setup({ customers: [customer(1, 'p-thor', 'Thor')] });
    mailer.sendClaimed.mockResolvedValueOnce({ failed: true });
    const summary = await service.run({ market: 'BR', send: true });
    expect(summary).toMatchObject({ sent: 0, failed: 1, remaining: 1 });
    expect(repository.announced.size).toBe(0);
    expect(repository.state.sent_at).toBeNull();
  });

  test('--send without the company name or street is refused; the simulation still runs', async () => {
    const { service, repository, mailer } = setup({
      customers: [customer(1, 'p-thor', 'Thor')],
      company: { ...COMPANY, street: '' }
    });
    await expect(service.run({ market: 'BR', send: true })).rejects.toMatchObject({
      code: 'company_address_missing',
      message: 'Envio recusado: preencha street no perfil da empresa de BR (Configurações > Empresa); é o rodapé do anúncio. Nada foi enviado.'
    });
    expect(mailer.sendClaimed).not.toHaveBeenCalled();
    expect(repository.writes).toEqual([]);
    expect(await service.run({ market: 'BR' })).toMatchObject({ mode: 'simulation', customers: 1 });
  });

  test('a market with no published puppy or senior recipe is refused', async () => {
    const { service } = setup({ customers: [customer(1, 'p-thor', 'Thor')], published: ['adult'] });
    await expect(service.run({ market: 'BR' })).rejects.toBeInstanceOf(AnnouncementRefused);
    await expect(service.run({ market: 'BR', send: true })).rejects.toMatchObject({ code: 'no_published_recipes' });
  });

  test('an announcement already concluded is not sent again', async () => {
    const { service, repository, mailer } = setup({ customers: [customer(1, 'p-thor', 'Thor')] });
    repository.state.sent_at = new Date('2026-10-19T12:00:00Z');
    await expect(service.run({ market: 'BR', send: true })).rejects.toMatchObject({
      code: 'already_sent',
      message: 'O anúncio de BR já foi concluído em 2026-10-19T12:00:00.000Z. Nada foi enviado.'
    });
    expect(mailer.sendClaimed).not.toHaveBeenCalled();
    expect(repository.writes).toEqual([]);
  });

  test('an announced pet still shows its notice, and the stage-change job skips it', async () => {
    const thor = senior('p-thor', 'Thor');
    const { service, lifeStageService, clock } = setup({ customers: [customer(1, 'p-thor', 'Thor')] });
    await service.run({ market: 'BR', send: true });
    const announcedThor = { ...thor, life_stage_announced_at: clock.now.toISOString(), life_stage_announced_stage: 'senior' };

    const rows = [];
    const notices = {
      async ensureDetected({ subscriptionId, petId, fromLine, toLine, at, notified }) {
        rows.push({ subscription_id: subscriptionId, pet_id: petId, from_line: fromLine, to_line: toLine, detected_at: at, dismissed_at: null, resolved_at: null, notified_at: notified ? notified.at : null, notified_via: notified ? notified.via : null });
      },
      async listForSubscriptions() { return rows; },
      async transitionNotified() { return rows.some((row) => row.notified_at); },
      markEmailed: jest.fn()
    };
    const petsRepository = { listPets: async () => ({ pets: [announcedThor] }) };
    const noticesService = new LifeStageNoticesService({ lifeStageService, noticesRepository: notices, petsRepository, now: () => clock.now });
    const ledger = { id: 10, userId: 1, stripeSubscriptionId: 'sub_1', stripeAccount: 'br', planSelection: customer(1, 'p-thor', 'Thor').planSelection };
    const mailer = { notifyLifeStageChange: jest.fn() };
    const job = new LifeStageChangeEmailService({
      ledgerRepository: { listDeliverableByAccount: async (account) => (account === 'br' ? [ledger] : []) },
      noticesService,
      noticesRepository: notices,
      announcementsRepository: { findMarket: async (market) => ({ market, sent_at: market === 'BR' ? clock.now : null }) },
      deliveriesService: { loadSubscription: async () => ({}), read: async () => ({ actionTarget: { id: 'current', editableUntil: '2026-10-22T02:59:59.000Z' } }) },
      petsRepository,
      mailer,
      now: () => clock.now
    });

    await job.runDaily();
    const report = await noticesService.reportForUser(1, [ledger]);
    expect(report.get(10)[0].life_stage_notice).toMatchObject({ open: true, notified_via: 'announcement' });
    expect(mailer.notifyLifeStageChange).not.toHaveBeenCalled();
  });

  test('parses --market and --send', () => {
    expect(parseArgs(['--market', 'br'])).toEqual({ market: 'BR', send: false });
    expect(parseArgs(['--market=US', '--send'])).toEqual({ market: 'US', send: true });
  });
});
