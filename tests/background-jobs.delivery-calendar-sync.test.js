const { runTick } = require('../src/core/job-scheduler');
const { JOB_INTERVALS, LOCKS, createJobDefinitions } = require('../src/services/background-jobs.service');

function lockedRunner() {
  const query = jest.fn()
    .mockResolvedValueOnce([{ locked: 1 }])
    .mockResolvedValueOnce([]);
  return {
    dataSource: {
      createQueryRunner: () => ({
        connect: jest.fn().mockResolvedValue(undefined),
        query,
        release: jest.fn().mockResolvedValue(undefined)
      })
    },
    query
  };
}

function baseDeps(overrides = {}) {
  return {
    refreshTokenRepository: { deleteExpired: jest.fn() },
    eventsRepository: { deleteProcessedBefore: jest.fn() },
    stripeWebhookService: { retryPending: jest.fn() },
    transactionalMailer: { resendUnsent: jest.fn() },
    ledgerRepository: {},
    cursorRepository: { get: jest.fn(), set: jest.fn() },
    upsShipmentRepository: {},
    upsClient: {},
    ...overrides
  };
}

describe('delivery calendar Stripe sync job', () => {
  test('is listed with its own lock and a one-minute interval', () => {
    const job = createJobDefinitions(baseDeps()).find((item) => item.name === 'delivery_calendar_stripe_sync');
    expect(job).toBeDefined();
    expect(job.lockName).toBe(LOCKS.delivery_calendar_stripe_sync);
    expect(new Set(Object.values(LOCKS)).size).toBe(Object.keys(LOCKS).length);
    expect(JOB_INTERVALS.delivery_calendar_stripe_sync).toBe(60 * 1000);
  });

  test('one tick drains due rows through the sync service, per market account', async () => {
    const rows = [
      { id: 1, market: 'US', stripeSubscriptionId: 'sub_us', expectedTrialEnd: '2027-12-23T05:00:00.000Z', targetTrialEnd: '2027-12-27T05:00:00.000Z', attempts: 0 },
      { id: 2, market: 'BR', stripeSubscriptionId: 'sub_br', expectedTrialEnd: '2027-02-08T03:00:00.000Z', targetTrialEnd: '2027-02-10T03:00:00.000Z', attempts: 0 }
    ];
    const repository = {
      claimDue: jest.fn().mockResolvedValue(rows),
      markSynced: jest.fn(),
      markConflict: jest.fn(),
      recordAttempt: jest.fn()
    };
    const billing = (expected) => ({
      retrieveSubscription: jest.fn().mockResolvedValue({ trial_end: Math.floor(Date.parse(expected) / 1000) }),
      setTrialEnd: jest.fn().mockResolvedValue({})
    });
    const us = billing(rows[0].expectedTrialEnd);
    const br = billing(rows[1].expectedTrialEnd);
    const stripeAccounts = { get: jest.fn((account) => (account === 'br' ? br : us)) };
    const job = createJobDefinitions(baseDeps({ deliveryCalendarSyncsRepository: repository, stripeAccounts }))
      .find((item) => item.name === 'delivery_calendar_stripe_sync');
    const { dataSource, query } = lockedRunner();

    const result = await runTick({
      dataSource,
      lockName: job.lockName,
      jobName: job.name,
      run: job.run,
      logger: { info: jest.fn(), error: jest.fn() },
      metrics: { recordSuccess: jest.fn(), recordFailure: jest.fn() }
    });

    expect(query.mock.calls[0][1]).toEqual([LOCKS.delivery_calendar_stripe_sync]);
    expect(result.counts).toEqual({ synced: 2, failed: 0, conflict: 0, retry: 0 });
    expect(us.setTrialEnd).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'sub_us' }));
    expect(br.setTrialEnd).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'sub_br' }));
    expect(repository.markSynced).toHaveBeenCalledTimes(2);
  });
});
