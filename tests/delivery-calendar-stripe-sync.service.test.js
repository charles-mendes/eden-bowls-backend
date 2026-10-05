const { DeliveryCalendarStripeSyncService } = require('../src/services/delivery-calendar-stripe-sync.service');

const EXPECTED = '2027-12-23T05:00:00.000Z';
const TARGET = '2027-12-27T05:00:00.000Z';
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function setup({ trialEnd = unix(EXPECTED), retrieveError = null, updateError = null, attempts = 0 } = {}) {
  const row = { id: 5, stripeSubscriptionId: 'sub_5', expectedTrialEnd: EXPECTED, targetTrialEnd: TARGET, attempts };
  const repository = {
    claimDue: jest.fn().mockResolvedValue([row]),
    markSynced: jest.fn().mockResolvedValue(undefined),
    markConflict: jest.fn().mockResolvedValue(undefined),
    recordAttempt: jest.fn(async (_id, { attempts: tried, maxAttempts }) => (
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
  const service = new DeliveryCalendarStripeSyncService({ repository, billing, now: () => now, maxAttempts: 8 });
  return { service, repository, billing, row, now };
}

describe('DeliveryCalendarStripeSyncService', () => {
  test('applies the target while Stripe still has the expected trial_end', async () => {
    const { service, repository, billing, now } = setup();
    expect(await service.runDue()).toEqual({ synced: 1, failed: 0, conflict: 0, retry: 0 });
    expect(billing.setTrialEnd).toHaveBeenCalledWith({
      subscriptionId: 'sub_5',
      trial_end: unix(TARGET),
      proration_behavior: 'none',
      idempotencyKey: 'delivery-calendar-sync:5'
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
});
