const { createJobDefinitions, JOB_INTERVALS, LOCKS } = require('../src/services/background-jobs.service');
const { PlanNoticesService } = require('../src/services/plan-notices.service');
const { planNoticeReference, planNoticeFor } = require('../src/core/plan-notice');

const now = new Date('2026-11-02T12:00:00.000Z');
const inDays = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
const on = { renewalNoticeEnabled: true, planEndingNoticeEnabled: true, planNoticeDays: 7 };

function renewal(id, changes = {}) {
  return {
    stripeSubscriptionId: id,
    stripeAccount: 'br',
    status: 'active',
    autoRenew: true,
    cancelAtPeriodEnd: false,
    subscriptionTermMonths: 1,
    chargedDeliveries: 1,
    currentPeriodEnd: inDays(3),
    ...changes
  };
}

const ending = (id, changes = {}) => renewal(id, { autoRenew: false, cancelAtPeriodEnd: true, ...changes });

function setup({ br = [], us = [], settings = {}, claimed = new Set(), mailResult = () => ({ claimed: true }), preview } = {}) {
  const previewUpcomingInvoice = preview || jest.fn().mockResolvedValue({ amount: 8990, currency: 'brl' });
  const mailer = {
    notifyRenewalNotice: jest.fn(async (input) => mailResult(input)),
    notifyPlanEndingNotice: jest.fn(async (input) => mailResult(input))
  };
  const ledgerRepository = { listPlanNoticeCandidates: jest.fn(async (account) => (account === 'br' ? br : us)) };
  const service = new PlanNoticesService({
    ledgerRepository,
    claimsRepository: { hasClaim: jest.fn(async ({ subscriptionId }) => claimed.has(subscriptionId)) },
    settings: { forMarket: jest.fn(async (market) => ({ ...on, ...(settings[market] || {}) })) },
    mailer,
    billingFor: jest.fn(() => ({ previewUpcomingInvoice })),
    now: () => now
  });
  return { service, mailer, ledgerRepository, previewUpcomingInvoice };
}

describe('plan_notices job', () => {
  test('runs hourly with its own lock', async () => {
    const runDue = jest.fn().mockResolvedValue({});
    const job = createJobDefinitions({ planNoticesService: { runDue } }).find((item) => item.name === 'plan_notices');
    expect(JOB_INTERVALS.plan_notices).toBe(60 * 60 * 1000);
    expect(job.lockName).toBe(LOCKS.plan_notices);
    await job.run();
    expect(runDue).toHaveBeenCalled();
  });

  test('sends a renewal notice with the previewed amount and an ending notice without a preview', async () => {
    const { service, mailer, previewUpcomingInvoice } = setup({ br: [renewal('sub_1'), ending('sub_2')] });
    await expect(service.runDue()).resolves.toEqual({ scanned: 2, sent: 2, skipped: 0, failed: 0 });
    expect(mailer.notifyRenewalNotice).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_1', renewsOn: inDays(3), total: { amount: 8990, currency: 'brl' }
    }));
    expect(mailer.notifyPlanEndingNotice).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'sub_2', endsOn: inDays(3) }));
    expect(previewUpcomingInvoice).toHaveBeenCalledTimes(1);
    expect(previewUpcomingInvoice).toHaveBeenCalledWith('sub_1');
  });

  test('Pause one notice without restart', async () => {
    const { service, mailer } = setup({ br: [renewal('sub_1'), ending('sub_2')], settings: { BR: { renewalNoticeEnabled: false } } });
    await service.runDue();
    expect(mailer.notifyRenewalNotice).not.toHaveBeenCalled();
    expect(mailer.notifyPlanEndingNotice).toHaveBeenCalledTimes(1);
  });

  test('a market with both notices off is not read', async () => {
    const { service, ledgerRepository } = setup({ settings: { BR: { renewalNoticeEnabled: false, planEndingNoticeEnabled: false } } });
    await service.runDue();
    expect(ledgerRepository.listPlanNoticeCandidates.mock.calls.map(([account]) => account)).toEqual(['us']);
  });

  test('each market uses its own window', async () => {
    const { service, ledgerRepository } = setup({ settings: { US: { planNoticeDays: 10 } } });
    await service.runDue();
    expect(ledgerRepository.listPlanNoticeCandidates).toHaveBeenCalledWith('br', now, inDays(7));
    expect(ledgerRepository.listPlanNoticeCandidates).toHaveBeenCalledWith('us', now, inDays(10));
  });

  test('More notices than one tick allows', async () => {
    const rows = Array.from({ length: 150 }, (_, index) => renewal(`sub_${index}`));
    const claimed = new Set();
    const { service, mailer } = setup({ br: rows, claimed, mailResult: (input) => { claimed.add(input.subscriptionId); return {}; } });
    await expect(service.runDue()).resolves.toMatchObject({ sent: 100 });
    await expect(service.runDue()).resolves.toMatchObject({ sent: 50, skipped: 100 });
    expect(mailer.notifyRenewalNotice).toHaveBeenCalledTimes(150);
  });

  test('Earliest candidates were already notified', async () => {
    const notified = Array.from({ length: 100 }, (_, index) => renewal(`sub_${index}`, { currentPeriodEnd: inDays(1) }));
    const { service, mailer, previewUpcomingInvoice } = setup({
      br: [...notified, renewal('sub_next')],
      claimed: new Set(notified.map((row) => row.stripeSubscriptionId))
    });
    await expect(service.runDue()).resolves.toMatchObject({ scanned: 101, sent: 1, skipped: 100 });
    expect(mailer.notifyRenewalNotice.mock.calls[0][0].subscriptionId).toBe('sub_next');
    expect(previewUpcomingInvoice).toHaveBeenCalledTimes(1);
  });

  test('sends the nearest period end first across markets', async () => {
    const { service, mailer } = setup({
      br: [renewal('sub_late', { currentPeriodEnd: inDays(5) })],
      us: [renewal('sub_soon', { stripeAccount: 'us', currentPeriodEnd: inDays(2) })]
    });
    await service.runDue();
    expect(mailer.notifyRenewalNotice.mock.calls.map(([input]) => input.subscriptionId)).toEqual(['sub_soon', 'sub_late']);
  });

  test('One subscription fails: a failed result counts and the others go on', async () => {
    const { service, mailer } = setup({
      br: [renewal('sub_1'), renewal('sub_2')],
      mailResult: (input) => (input.subscriptionId === 'sub_1' ? { skipped: false, failed: true, claimed: false } : {})
    });
    await expect(service.runDue()).resolves.toMatchObject({ sent: 1, failed: 1 });
    expect(mailer.notifyRenewalNotice).toHaveBeenCalledTimes(2);
  });

  test('a throw counts as failed and the others go on', async () => {
    const { service } = setup({
      br: [renewal('sub_1'), renewal('sub_2')],
      mailResult: (input) => { if (input.subscriptionId === 'sub_1') throw new Error('boom'); return {}; }
    });
    await expect(service.runDue()).resolves.toMatchObject({ sent: 1, failed: 1 });
  });

  test('Preview fails', async () => {
    const preview = jest.fn().mockRejectedValue(new Error('stripe down'));
    const { service, mailer } = setup({ br: [renewal('sub_1')], preview });
    await expect(service.runDue()).resolves.toMatchObject({ sent: 1, failed: 0 });
    expect(mailer.notifyRenewalNotice.mock.calls[0][0].total).toBeNull();
  });

  test('a letter the mailer skipped does not count as sent', async () => {
    const { service } = setup({ br: [renewal('sub_1')], mailResult: () => ({ skipped: true, reason: 'missing_context' }) });
    await expect(service.runDue()).resolves.toMatchObject({ sent: 0, skipped: 1 });
  });

  test('Explicit cancellation and an unknown count are skipped without using the limit', async () => {
    const { service, mailer } = setup({
      br: [ending('sub_1', { autoRenew: null }), renewal('sub_2', { subscriptionTermMonths: 3, chargedDeliveries: null })]
    });
    await expect(service.runDue()).resolves.toMatchObject({ scanned: 2, sent: 0, skipped: 2 });
    expect(mailer.notifyPlanEndingNotice).not.toHaveBeenCalled();
  });

  test('Customer skips a delivery after the notice: the moved period end has a new reference', async () => {
    const before = planNoticeFor(renewal('sub_1'), { now, noticeDays: 7 });
    const after = planNoticeFor(renewal('sub_1', { currentPeriodEnd: inDays(5) }), { now, noticeDays: 7 });
    expect(planNoticeReference(after)).not.toBe(planNoticeReference(before));
    const { service, mailer } = setup({ br: [renewal('sub_1', { currentPeriodEnd: inDays(5) })] });
    await service.runDue();
    expect(mailer.notifyRenewalNotice.mock.calls[0][0].referenceId).toBe(planNoticeReference(after));
  });

  test('Customer turns renewal off after a failed send', async () => {
    const { service, mailer } = setup({ br: [renewal('sub_1', { autoRenew: false })] });
    await service.runDue();
    expect(mailer.notifyRenewalNotice).not.toHaveBeenCalled();
  });
});
