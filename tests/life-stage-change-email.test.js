const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { LifeStageService } = require('../src/services/life-stage.service');
const { LifeStageNoticesService } = require('../src/services/life-stage-notices.service');
const { LifeStageChangeEmailService } = require('../src/services/life-stage-change-email.service');
const { createTransactionalMailer } = require('../src/infrastructure/mailers/transactional-mailer');
const { createJobDefinitions, JOB_INTERVALS } = require('../src/services/background-jobs.service');

const RECIPES = [
  { key: 'beef', label: 'Bovino', life_stage: 'adult' },
  { key: 'senior-beef', label: 'Receita de Carne para Cães Sênior', life_stage: 'senior' }
];
const DAY = 24 * 60 * 60 * 1000;
// Next BR charge on 2026-10-27: cutoff 2026-10-26 23:59:59 in Brasília; the following one two weeks later.
const CUTOFF = '2026-10-27T02:59:59.000Z';
const FOLLOWING_CUTOFF = '2026-11-10T02:59:59.000Z';

// In-memory notices with the same rules as the MySQL repository.
function memoryNotices() {
  const rows = [];
  const key = (row) => `${row.subscription_id}|${row.pet_id}|${row.from_line}|${row.to_line}`;
  return {
    rows,
    async ensureDetected({ subscriptionId, petId, fromLine, toLine, at, notified }) {
      const row = { subscription_id: subscriptionId, pet_id: petId, from_line: fromLine, to_line: toLine, detected_at: at, dismissed_at: null, resolved_at: null, notified_at: notified ? notified.at : null, notified_via: notified ? notified.via : null };
      if (!rows.some((item) => key(item) === key(row))) rows.push(row);
    },
    async upsertNotified({ subscriptionId, petId, fromLine, toLine, via, at }) {
      await this.ensureDetected({ subscriptionId, petId, fromLine, toLine, at, notified: { at, via } });
    },
    async listForSubscriptions(ids) {
      return rows.filter((row) => ids.includes(row.subscription_id));
    },
    async dismissOpen(subscriptionId, petId, at) {
      rows.filter((row) => row.subscription_id === subscriptionId && row.pet_id === petId && !row.dismissed_at && !row.resolved_at)
        .forEach((row) => { row.dismissed_at = at; });
    },
    async transitionNotified(petId, fromLine, toLine) {
      return rows.some((row) => row.pet_id === petId && row.from_line === fromLine && row.to_line === toLine && row.notified_at);
    },
    async markEmailed({ subscriptionId, petId, fromLine, toLine, at }) {
      rows.filter((row) => row.subscription_id === subscriptionId && row.pet_id === petId && row.from_line === fromLine && row.to_line === toLine && !row.notified_at)
        .forEach((row) => { row.notified_at = at; row.notified_via = 'email'; });
    }
  };
}

function ledgerRow(id, petIds, overrides = {}) {
  return {
    id,
    userId: 7,
    stripeSubscriptionId: `sub_${id}`,
    stripeAccount: 'br',
    customerEmail: 'ana@example.com',
    address: { name: 'Ana Mendes', country: 'BR' },
    planSelection: { pets: petIds.map((petId) => ({ pet_id: petId, selected_flavors: ['beef'], flavor_weights: [4] })) },
    ...overrides
  };
}

function setup({ pets, rows, usRows = [], sentAt = '2026-10-18T12:00:00Z', usSentAt = null, deadlines = [CUTOFF, FOLLOWING_CUTOFF], mailer, enabled, logger } = {}) {
  const clock = { now: new Date('2026-10-12T12:00:00Z') };
  const now = () => clock.now;
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  const lifeStageService = new LifeStageService({
    repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
    recipeLinesRepository: {
      listRecipeLines: async () => Object.fromEntries(['BR', 'US'].map((market) => [market, {
        lineByKey: Object.fromEntries(RECIPES.map((recipe) => [recipe.key, recipe.life_stage])),
        publishedLines: new Set(['adult', 'senior']),
        publishedRecipes: RECIPES
      }]))
    },
    now
  });
  const notices = memoryNotices();
  const petsRepository = { listPets: jest.fn(async () => ({ pets })) };
  const noticesService = new LifeStageNoticesService({ lifeStageService, noticesRepository: notices, petsRepository, now });
  const sent = [];
  const fakeMailer = {
    notifyLifeStageChange: jest.fn(async (input) => {
      sent.push(input);
      return { claimed: true };
    })
  };
  // The deliveries read names the delivery still editable now: the first cutoff not yet passed.
  const deliveriesService = {
    loadSubscription: jest.fn(async (id) => ({ id })),
    read: jest.fn(async () => {
      const index = deadlines.findIndex((deadline) => new Date(deadline).getTime() > clock.now.getTime());
      if (index < 0) return { delivery: { id: 'current', editableUntil: deadlines[0] }, actionTarget: null };
      const current = deadlines[Math.max(0, index - 1)];
      return {
        delivery: { id: 'current', editableUntil: current },
        actionTarget: { id: index === 0 ? 'current' : 'following', editableUntil: deadlines[index] }
      };
    })
  };
  const service = new LifeStageChangeEmailService({
    ledgerRepository: { listDeliverableByAccount: jest.fn(async (account) => (account === 'br' ? rows : usRows)) },
    noticesService,
    noticesRepository: notices,
    announcementsRepository: { findMarket: jest.fn(async (market) => ({ market, sent_at: market === 'BR' ? sentAt : usSentAt })) },
    deliveriesService,
    petsRepository,
    mailer: mailer || fakeMailer,
    // automated_email_settings read at each run; `enabled` stays live, as a row saved in the admin.
    ...(enabled ? { settings: { forMarket: jest.fn(async (market) => ({ lifeStageChangeEnabled: enabled[market] !== false })) } } : {}),
    ...(logger ? { logger } : {}),
    now
  });
  return { service, clock, notices, sent, noticesService, deliveriesService };
}

const registered = { breed: '', size: 'medium', age_recorded_at: '2026-10-12T09:00:00.000Z', birth_date: null };
const thor = { id: 'p-thor', name: 'Thor', age_years: 9, age_months: 0, ...registered };

describe('stage-change email job (2.12)', () => {
  test('waits until 7 days before the cutoff, then sends once with that cutoff', async () => {
    const { service, clock, sent, notices } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])] });

    expect((await service.runDaily()).BR).toMatchObject({ sent: 0, waiting: 1 });
    expect(notices.rows).toHaveLength(1);

    clock.now = new Date(new Date(CUTOFF).getTime() - 7 * DAY + 60 * 1000);
    expect((await service.runDaily()).BR).toMatchObject({ sent: 1 });
    expect(sent[0]).toMatchObject({ petId: 'p-thor', petName: 'Thor', fromLine: 'adult', toLine: 'senior', editableUntil: CUTOFF });
    expect(sent[0].suggestedRecipes).toEqual(['Receita de Carne para Cães Sênior']);
    expect(notices.rows[0]).toMatchObject({ notified_via: 'email' });

    clock.now = new Date(clock.now.getTime() + DAY);
    await service.runDaily();
    expect(sent).toHaveLength(1);
    expect(notices.rows[0].dismissed_at).toBeNull();
  });

  test('a transition detected 3 days before the cutoff is sent at the next run', async () => {
    const { service, clock, sent, noticesService } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])] });
    clock.now = new Date(new Date(CUTOFF).getTime() - 3 * DAY);
    await noticesService.reportForUser(7, [ledgerRow(1, ['p-thor'])]);

    clock.now = new Date(clock.now.getTime() + DAY);
    await service.runDaily();
    expect(sent).toHaveLength(1);
    expect(sent[0].editableUntil).toBe(CUTOFF);
  });

  test('detected a few hours before the cutoff, sent after it: carries the following delivery\'s cutoff', async () => {
    const { service, clock, sent, noticesService } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])] });
    clock.now = new Date(new Date(CUTOFF).getTime() - 3 * 60 * 60 * 1000);
    await noticesService.reportForUser(7, [ledgerRow(1, ['p-thor'])]);
    clock.now = new Date(new Date(CUTOFF).getTime() + 60 * 60 * 1000);
    await service.runDaily();
    expect(sent).toHaveLength(1);
    expect(sent[0].editableUntil).toBe(FOLLOWING_CUTOFF);
  });

  test('detected right after a cutoff, 14 days before the next: waits for the 7-day mark', async () => {
    const { service, clock, sent } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])] });
    clock.now = new Date(new Date(CUTOFF).getTime() + 60 * 60 * 1000);
    expect((await service.runDaily()).BR).toMatchObject({ sent: 0, waiting: 1 });
    clock.now = new Date(new Date(FOLLOWING_CUTOFF).getTime() - 6 * DAY);
    await service.runDaily();
    expect(sent).toHaveLength(1);
    expect(sent[0].editableUntil).toBe(FOLLOWING_CUTOFF);
  });

  test('none after the customer closed the notice', async () => {
    const { service, clock, sent, noticesService, notices } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])] });
    await noticesService.reportForUser(7, [ledgerRow(1, ['p-thor'])]);
    await notices.dismissOpen(1, 'p-thor', clock.now);
    clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);
    await service.runDaily();
    expect(sent).toHaveLength(0);
  });

  test('none for a pet named in the launch announcement for that stage', async () => {
    const announced = { ...thor, life_stage_announced_at: '2026-10-18T12:00:00.000Z', life_stage_announced_stage: 'senior' };
    const { service, clock, sent, notices } = setup({ pets: [announced], rows: [ledgerRow(1, ['p-thor'])] });
    clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);
    await service.runDaily();
    expect(sent).toHaveLength(0);
    expect(notices.rows[0]).toMatchObject({ notified_via: 'announcement', dismissed_at: null });
  });

  test('none after a confirmed age correction', async () => {
    const { service, clock, sent, notices } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])] });
    await notices.upsertNotified({ subscriptionId: 1, petId: 'p-thor', fromLine: 'adult', toLine: 'senior', via: 'manual_correction', at: clock.now });
    clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);
    await service.runDaily();
    expect(sent).toHaveLength(0);
  });

  test('one email for a pet on two subscriptions', async () => {
    const { service, clock, sent } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor']), ledgerRow(2, ['p-thor'])] });
    clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);
    const summary = await service.runDaily();
    expect(sent).toHaveLength(1);
    expect(summary.BR).toMatchObject({ sent: 1, skipped: 1 });
    await service.runDaily();
    expect(sent).toHaveLength(1);
  });

  test('none in a market before its launch announcement was sent', async () => {
    const { service, clock, sent } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])], sentAt: null });
    clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);
    const summary = await service.runDaily();
    expect(summary.BR).toEqual({ skipped: 'announcement_not_sent' });
    expect(sent).toHaveLength(0);
  });

  test('a failed send leaves the transition open for the next run', async () => {
    const mailer = { notifyLifeStageChange: jest.fn().mockResolvedValueOnce({ failed: true }).mockResolvedValue({ claimed: true }) };
    const { service, clock, notices } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])], mailer });
    clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);
    expect((await service.runDaily()).BR).toMatchObject({ failed: 1 });
    expect(notices.rows[0].notified_at).toBeNull();
    expect((await service.runDaily()).BR).toMatchObject({ sent: 1 });
    expect(mailer.notifyLifeStageChange).toHaveBeenCalledTimes(2);
  });

  test('the mailer sends the pt-BR letter with the deadline and Ajustar packs, claimed per pet transition', async () => {
    const otpMailer = { sendMail: jest.fn(async () => ({})) };
    const claimsRepository = {
      claimMailSend: jest.fn(async () => ({ claimed: true, id: 1 })),
      markSent: jest.fn(),
      rememberPayload: jest.fn()
    };
    const mailer = createTransactionalMailer({ otpMailer, claimsRepository, storeAppUrl: 'https://edenbowls.com' });
    const result = await mailer.notifyLifeStageChange({
      ledger: ledgerRow(1, ['p-thor']),
      petId: 'p-thor',
      petName: 'Thor',
      fromLine: 'adult',
      toLine: 'senior',
      suggestedRecipes: ['Receita de Carne para Cães Sênior'],
      editableUntil: CUTOFF
    });
    expect(result).toMatchObject({ claimed: true, to: 'ana@example.com' });
    expect(claimsRepository.claimMailSend).toHaveBeenCalledWith({ subscriptionId: 'sub_1', template: 'life_stage_change', referenceId: 'p-thor:adult>senior' });
    const payload = otpMailer.sendMail.mock.calls[0][0];
    expect(payload.subject).toBe('Thor está entrando na fase Sênior');
    expect(payload.text).toContain('Pela idade informada, Thor está entrando na fase Sênior.');
    expect(payload.text).toContain('Ajuste até: segunda-feira, 26 de outubro, às 23h59 (horário de Brasília)');
    expect(payload.text).toContain('https://edenbowls.com/dashboard/plans/sub_1/packs?pet=p-thor');
  });

  describe('per-market switch (2.16)', () => {
    const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

    test('a paused market sends nothing, logs it, and keeps sent_at and the notice rows', async () => {
      const log = logger();
      const { service, clock, sent, notices, noticesService } = setup({
        pets: [thor], rows: [ledgerRow(1, ['p-thor'])], enabled: { BR: false, US: true }, logger: log
      });
      await noticesService.reportForUser(7, [ledgerRow(1, ['p-thor'])]);
      const before = notices.rows.map((row) => ({ ...row }));
      clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);

      const summary = await service.runDaily();

      expect(summary.BR).toEqual({ skipped: 'paused' });
      expect(sent).toHaveLength(0);
      expect(notices.rows).toEqual(before);
      expect(log.warn).toHaveBeenCalledWith({ market: 'BR' }, 'Stage-change email paused in this market (Configurações > E-mails automáticos).');
      expect(service.announcementsRepository.findMarket).not.toHaveBeenCalledWith('BR');
      expect(service.ledgerRepository.listDeliverableByAccount).not.toHaveBeenCalledWith('br');
    });

    test('pausing BR does not stop US', async () => {
      const max = { ...thor, id: 'p-max', name: 'Max' };
      const usRow = ledgerRow(2, ['p-max'], { userId: 8, stripeAccount: 'us', address: { name: 'Ann Lee', country: 'US' } });
      const { service, clock, sent } = setup({
        pets: [thor, max], rows: [ledgerRow(1, ['p-thor'])], usRows: [usRow], usSentAt: '2026-10-18T12:00:00Z',
        enabled: { BR: false, US: true }, logger: logger()
      });
      clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);

      const summary = await service.runDaily();

      expect(summary.BR).toEqual({ skipped: 'paused' });
      expect(summary.US).toMatchObject({ sent: 1 });
      expect(sent.map((item) => item.petId)).toEqual(['p-max']);
    });

    test('Pause without restart: turned on again before the cutoff, the next run sends once with that cutoff', async () => {
      const enabled = { BR: false, US: true };
      const { service, clock, sent, noticesService } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])], enabled, logger: logger() });
      await noticesService.reportForUser(7, [ledgerRow(1, ['p-thor'])]);
      clock.now = new Date(new Date(CUTOFF).getTime() - 5 * DAY);
      await service.runDaily();
      expect(sent).toHaveLength(0);

      enabled.BR = true;
      clock.now = new Date(clock.now.getTime() + DAY);
      expect((await service.runDaily()).BR).toMatchObject({ sent: 1 });
      expect(sent[0].editableUntil).toBe(CUTOFF);

      clock.now = new Date(clock.now.getTime() + DAY);
      await service.runDaily();
      expect(sent).toHaveLength(1);
    });

    test('cutoff passed during the pause: the next run sends once with the following delivery', async () => {
      const enabled = { BR: false, US: true };
      const { service, clock, sent, noticesService } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])], enabled, logger: logger() });
      await noticesService.reportForUser(7, [ledgerRow(1, ['p-thor'])]);
      clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);
      await service.runDaily();

      enabled.BR = true;
      clock.now = new Date(new Date(CUTOFF).getTime() + DAY);
      expect((await service.runDaily()).BR).toMatchObject({ sent: 1 });
      expect(sent[0].editableUntil).toBe(FOLLOWING_CUTOFF);
      await service.runDaily();
      expect(sent).toHaveLength(1);
    });

    test('both markets on when the switch is not given', async () => {
      const { service, clock, sent } = setup({ pets: [thor], rows: [ledgerRow(1, ['p-thor'])] });
      clock.now = new Date(new Date(CUTOFF).getTime() - 2 * DAY);
      expect((await service.runDaily()).BR).toMatchObject({ sent: 1 });
      expect(sent).toHaveLength(1);
    });
  });

  test('runs daily in the background scheduler', () => {
    const runDaily = jest.fn(async () => ({}));
    const job = createJobDefinitions({ lifeStageChangeEmailService: { runDaily } }).find((item) => item.name === 'life_stage_change_email');
    expect(job.intervalMs).toBe(JOB_INTERVALS.life_stage_change_email);
    expect(JOB_INTERVALS.life_stage_change_email).toBe(DAY);
    job.run();
    expect(runDaily).toHaveBeenCalled();
  });
});
