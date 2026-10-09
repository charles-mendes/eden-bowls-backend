const { DeliveryCalendarStripeSyncService, idempotencyKey } = require('../src/services/delivery-calendar-stripe-sync.service');

const EXPECTED = '2027-12-23T05:00:00.000Z';
const TARGET = '2027-12-27T05:00:00.000Z';
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function setup({ trialEnd = unix(EXPECTED), retrieveError = null, updateError = null, attempts = 0, rows = null, recordError = null, markErrorError = null } = {}) {
  const row = { id: 5, stripeSubscriptionId: 'sub_5', expectedTrialEnd: EXPECTED, targetTrialEnd: TARGET, attempts, nextAttemptAt: null };
  const repository = {
    claimDue: jest.fn().mockResolvedValue(rows || [row]),
    markError: markErrorError ? jest.fn().mockRejectedValue(markErrorError) : jest.fn().mockResolvedValue(undefined),
    markSynced: jest.fn().mockResolvedValue(undefined),
    markConflict: jest.fn().mockResolvedValue(undefined),
    recordAttempt: recordError ? jest.fn().mockRejectedValue(recordError) : jest.fn(async (_id, { attempts: tried, maxAttempts }) => (
      tried + 1 >= maxAttempts ? { status: 'failed' } : { status: 'pending' }
    ))
  };
  const billing = {
    retrieveSubscription: retrieveError
      ? jest.fn().mockRejectedValue(retrieveError)
      : jest.fn().mockResolvedValue({ id: 'sub_5', trial_end: trialEnd }),
    setTrialEnd: updateError ? jest.fn().mockRejectedValue(updateError) : jest.fn().mockResolvedValue({})
  };
  const now = new Date('2027-12-22T12:00:00Z');
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new DeliveryCalendarStripeSyncService({ repository, billing, now: () => now, maxAttempts: 8, logger });
  return { service, repository, billing, row, now, logger };
}

describe('DeliveryCalendarStripeSyncService', () => {
  test('applies the target while Stripe still has the expected trial_end', async () => {
    const { service, repository, billing, now } = setup();
    expect(await service.runDue()).toEqual({ synced: 1, failed: 0, conflict: 0, retry: 0, error: 0 });
    expect(billing.setTrialEnd).toHaveBeenCalledWith({
      subscriptionId: 'sub_5',
      trial_end: unix(TARGET),
      proration_behavior: 'none',
      idempotencyKey: 'delivery-calendar-sync:5:0:0'
    });
    expect(repository.markSynced).toHaveBeenCalledWith(5, now);
  });

  test('a row already applied is marked synced without a second write', async () => {
    const { service, repository, billing } = setup({ trialEnd: unix(TARGET) });
    expect(await service.runDue()).toMatchObject({ synced: 1 });
    expect(billing.setTrialEnd).not.toHaveBeenCalled();
    expect(repository.markSynced).toHaveBeenCalled();
  });

  test('an unexpected trial_end is stored as found and nothing is written', async () => {
    const skipped = '2028-01-24T05:00:00.000Z';
    const { service, repository, billing } = setup({ trialEnd: unix(skipped) });
    expect(await service.runDue()).toMatchObject({ conflict: 1 });
    expect(repository.markConflict).toHaveBeenCalledWith(5, skipped);
    expect(billing.setTrialEnd).not.toHaveBeenCalled();
  });

  test('a subscription whose trial already ended is a conflict, not a new trial', async () => {
    const { service, repository, billing } = setup({ trialEnd: null });
    expect(await service.runDue()).toMatchObject({ conflict: 1 });
    expect(repository.markConflict).toHaveBeenCalledWith(5, null);
    expect(billing.setTrialEnd).not.toHaveBeenCalled();
  });

  test('a transient error records an attempt and keeps the row for a retry', async () => {
    const { service, repository, now } = setup({ updateError: new Error('Stripe timeout') });
    expect(await service.runDue()).toMatchObject({ retry: 1 });
    expect(repository.recordAttempt).toHaveBeenCalledWith(5, expect.objectContaining({ now, attempts: 0, maxAttempts: 8 }));
    expect(repository.markSynced).not.toHaveBeenCalled();
  });

  test('the last allowed attempt marks the row failed', async () => {
    const { service, repository } = setup({ retrieveError: new Error('Stripe down'), attempts: 7 });
    expect(await service.runDue()).toMatchObject({ failed: 1 });
    expect(repository.recordAttempt).toHaveBeenCalledWith(5, expect.objectContaining({ attempts: 7 }));
  });

  test('a resent row that finds Stripe already at the target is synced, not conflict', async () => {
    const resent = { id: 7, stripeSubscriptionId: 'sub_7', expectedTrialEnd: '2028-01-24T05:00:00.000Z', targetTrialEnd: TARGET, attempts: 0, nextAttemptAt: '2027-12-22T12:00:00.000Z' };
    const { service, repository, billing } = setup({ trialEnd: unix(TARGET), rows: [resent] });
    expect(await service.runDue()).toMatchObject({ synced: 1, conflict: 0 });
    expect(repository.markSynced).toHaveBeenCalledWith(7, expect.any(Date));
    expect(repository.markConflict).not.toHaveBeenCalled();
    expect(billing.setTrialEnd).not.toHaveBeenCalled();
  });

  test('the idempotency key changes with each retry and each resend, and stays for the same row state', () => {
    const first = { id: 5, attempts: 0, nextAttemptAt: null };
    const retry = { id: 5, attempts: 1, nextAttemptAt: '2027-12-22T12:01:00.000Z' };
    const resent = { id: 5, attempts: 0, nextAttemptAt: '2027-12-23T09:00:00.000Z' };
    const keys = [first, retry, resent].map(idempotencyKey);
    expect(new Set(keys).size).toBe(3);
    expect(idempotencyKey({ ...retry })).toBe(keys[1]);
    expect(keys[2]).toBe(`delivery-calendar-sync:5:0:${Date.parse('2027-12-23T09:00:00.000Z')}`);
  });

  test('a resent conflict writes with the new key', async () => {
    const resent = { id: 9, stripeSubscriptionId: 'sub_9', expectedTrialEnd: EXPECTED, targetTrialEnd: TARGET, attempts: 0, nextAttemptAt: '2027-12-22T11:59:00.000Z' };
    const { service, billing } = setup({ rows: [resent] });
    await service.runDue();
    expect(billing.setTrialEnd).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `delivery-calendar-sync:9:0:${Date.parse('2027-12-22T11:59:00.000Z')}`
    }));
  });

  test('a row that cannot record its attempt is marked as an error and the next row still runs', async () => {
    const broken = { id: 1, stripeSubscriptionId: 'sub_1', expectedTrialEnd: EXPECTED, targetTrialEnd: TARGET, attempts: 0, nextAttemptAt: null };
    const healthy = { id: 2, stripeSubscriptionId: 'sub_2', expectedTrialEnd: EXPECTED, targetTrialEnd: TARGET, attempts: 0, nextAttemptAt: null };
    const { service, repository, billing, logger } = setup({ rows: [broken, healthy], recordError: new Error('MySQL went away') });
    billing.setTrialEnd.mockRejectedValueOnce(new Error('Stripe timeout'));
    expect(await service.runDue()).toEqual({ synced: 1, failed: 0, conflict: 0, retry: 0, error: 1 });
    expect(repository.markError).toHaveBeenCalledWith(1, 'MySQL went away');
    expect(repository.markSynced).toHaveBeenCalledWith(2, expect.any(Date));
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ syncId: 1, err: 'Stripe timeout' }), 'Calendar sync attempt failed.');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ syncId: 1, err: 'MySQL went away' }), 'Calendar sync row could not be processed.');
  });

  test('even a failed error mark does not stop the tick', async () => {
    const rows = [1, 2].map((id) => ({ id, stripeSubscriptionId: `sub_${id}`, expectedTrialEnd: EXPECTED, targetTrialEnd: TARGET, attempts: 0, nextAttemptAt: null }));
    const { service, logger } = setup({ rows, retrieveError: new Error('Stripe down'), recordError: new Error('MySQL went away'), markErrorError: new Error('still down') });
    expect(await service.runDue()).toEqual({ synced: 0, failed: 0, conflict: 0, retry: 0, error: 2 });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ syncId: 2, err: 'still down' }), 'Calendar sync row could not be marked as an error.');
  });
});
